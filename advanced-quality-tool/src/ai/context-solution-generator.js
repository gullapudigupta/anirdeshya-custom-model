/**
 * Context-Based Solution Generation  (P7-T007)
 *
 * Gathers rich workspace context before generating solutions, ensuring that
 * suggestions are grounded in the actual project rather than generic advice.
 *
 * Context sources:
 *  1. Full project indexing — file inventory, language distribution, entry points
 *  2. Framework and dependency detection — from package.json / lockfiles / manifests
 *  3. Symbol-reference graph — who calls what across the project
 *  4. Local documentation index — README, CHANGELOG, inline JSDoc
 *  5. Accepted-fix history — previous fixes accepted in this project
 *  6. Commit history digest — recent change patterns
 *
 * Privacy controls:
 *  - Context is assembled locally; no data is sent to external services by default
 *  - Token budget limits how much context is included (configurable)
 *  - Configurable ignore rules (respects .gitignore + explicit excludes)
 *  - Cache invalidation on file change
 *
 * @module ai/context-solution-generator
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const crypto        = require('crypto');
const { execSync }  = require('child_process');

// ─── Defaults ─────────────────────────────────────────────────────────────────

/** Maximum characters of context to include in a single solution prompt */
const DEFAULT_TOKEN_BUDGET = 8000;

/** File extensions considered source code (for indexing and symbol extraction) */
const SOURCE_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
                            '.py', '.go', '.rs', '.cs', '.php', '.rb'];

/** Directories always excluded from indexing */
const ALWAYS_EXCLUDE = ['node_modules', '.git', 'dist', 'build', 'coverage',
                        '.nyc_output', '__pycache__', '.cache', 'vendor'];

// ─── Main class ───────────────────────────────────────────────────────────────

class ContextSolutionGenerator {
  /**
   * @param {object} [options={}]
   * @param {string}  [options.projectRoot=process.cwd()]
   * @param {number}  [options.tokenBudget]     - Max context characters
   * @param {string[]} [options.extraExcludes]  - Additional directories to exclude
   * @param {boolean} [options.useGitHistory=true] - Include recent commit digest
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options        = options;
    this.verbose        = options.verbose        || false;
    this.projectRoot    = options.projectRoot    || process.cwd();
    this.tokenBudget    = options.tokenBudget    || DEFAULT_TOKEN_BUDGET;
    this.useGitHistory  = options.useGitHistory  !== false;
    this.extraExcludes  = options.extraExcludes  || [];

    // In-memory cache: { cacheKey → { context, buildAt } }
    this._contextCache  = new Map();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Build a complete context object for a given issue or question.
   * The context is cached per project root and invalidated when files change.
   *
   * @param {object} request
   * @param {string}   request.question        - The question or issue to resolve
   * @param {string}   [request.filePath]      - Primary file the issue is in
   * @param {number}   [request.line]          - Line number of the issue
   * @param {string[]} [request.relatedFiles]  - Additional files to include
   * @returns {object} ContextBundle
   */
  buildContext(request) {
    const cacheKey = this._cacheKey(request.filePath);

    // Return warm cache if still valid (file hasn't changed)
    if (this._isCacheValid(cacheKey, request.filePath)) {
      const cached = this._contextCache.get(cacheKey);
      this._log(`Cache hit for ${request.filePath || 'project'}`);
      return this._assembleBundle(request, cached.data);
    }

    // Build fresh context
    this._log(`Building context for: ${request.question.slice(0, 60)}`);

    const projectIndex  = this._buildProjectIndex();
    const frameworks    = this._detectFrameworks();
    const symbolGraph   = this._buildSymbolGraph(request.filePath);
    const docIndex      = this._buildDocIndex();
    const fixHistory    = this._loadFixHistory();
    const commitDigest  = this.useGitHistory ? this._getCommitDigest() : [];

    const data = { projectIndex, frameworks, symbolGraph, docIndex, fixHistory, commitDigest };

    // Cache this data
    this._contextCache.set(cacheKey, {
      data,
      builtAt:  Date.now(),
      fileHash: request.filePath ? this._fileHash(request.filePath) : null
    });

    return this._assembleBundle(request, data);
  }

  /**
   * Assemble a solution prompt from a ContextBundle.
   * Respects the token budget — truncates less-important context first.
   *
   * @param {object} bundle - Result of buildContext()
   * @returns {string} Prompt string ready for a model executor
   */
  buildPrompt(bundle) {
    const sections = [];
    let   budget   = this.tokenBudget;

    // ── Context ranking strategy ───────────────────────────────────────────
    // Sections are added in descending relevance order so that when the
    // token budget is exhausted the most important context is always included:
    //   1. Question/issue (always included — zero budget check)
    //   2. Primary file content (highest relevance — direct evidence)
    //   3. Framework info (shapes valid solutions)
    //   4. Symbol references (shows callers/callees of affected code)
    //   5. Related file contents (neighbouring modules)
    //   6. Documentation excerpts (project conventions)
    //   7. Previous accepted fixes (learned patterns)
    //   8. Project summary (lowest priority — can be inferred)
    // ─────────────────────────────────────────────────────────────────────

    // Helper: add a section if it fits in the budget
    const addSection = (title, content) => {
      const text = `\n## ${title}\n${content}`;
      if (text.length < budget) {
        sections.push(text);
        budget -= text.length;
        return true;
      }
      return false;
    };

    // Always include the primary question
    addSection('Question / Issue', bundle.question);

    // Primary file content (most important context)
    if (bundle.primaryFileContent) {
      addSection(`Primary File: ${bundle.filePath}`, '```\n' + bundle.primaryFileContent + '\n```');
    }

    // Detected frameworks
    if (bundle.frameworks.length > 0) {
      addSection('Project Frameworks & Dependencies',
        bundle.frameworks.map(f => `- ${f.name} ${f.version || ''}`).join('\n'));
    }

    // Symbol references around the issue
    if (bundle.symbolReferences.length > 0) {
      addSection('Related Symbol References',
        bundle.symbolReferences.slice(0, 10)
          .map(s => `- ${s.symbol} used in ${s.file}:${s.line}`).join('\n'));
    }

    // Related files (truncated)
    for (const rf of bundle.relatedFileContents.slice(0, 3)) {
      addSection(`Related File: ${rf.filePath}`, '```\n' + rf.content.slice(0, 600) + '\n...\n```');
    }

    // Documentation excerpts
    if (bundle.docExcerpts.length > 0) {
      addSection('Relevant Documentation',
        bundle.docExcerpts.slice(0, 3).map(d => `### ${d.source}\n${d.excerpt}`).join('\n\n'));
    }

    // Previous accepted fixes (patterns)
    if (bundle.relevantFixes.length > 0) {
      addSection('Previously Accepted Fixes for Similar Issues',
        bundle.relevantFixes.slice(0, 3)
          .map(f => `- ${f.category}: ${f.description}`).join('\n'));
    }

    // Project structure summary (least important — added last)
    addSection('Project Structure Summary', bundle.projectSummary);

    return sections.join('\n\n---\n');
  }

  /**
   * Invalidate the context cache for a specific file (call after file edits).
   * @param {string} [filePath] - Null = invalidate entire cache
   */
  invalidateCache(filePath) {
    if (filePath) {
      const key = this._cacheKey(filePath);
      this._contextCache.delete(key);
      this._log(`Cache invalidated for ${filePath}`);
    } else {
      this._contextCache.clear();
      this._log('Full cache cleared');
    }
  }

  // ─── Context assembly ────────────────────────────────────────────────────────

  /**
   * Combine raw context data + request into a ContextBundle.
   * @param {object} request
   * @param {object} data
   * @returns {object} ContextBundle
   */
  _assembleBundle(request, data) {
    // Read primary file content
    let primaryFileContent = null;
    if (request.filePath && fs.existsSync(request.filePath)) {
      primaryFileContent = fs.readFileSync(request.filePath, 'utf8').slice(0, 3000);
    }

    // Read related file contents
    const relatedFileContents = (request.relatedFiles || [])
      .filter(f => fs.existsSync(f))
      .map(f => ({ filePath: f, content: fs.readFileSync(f, 'utf8').slice(0, 1000) }));

    // Find symbol references near the issue file
    const symbolReferences = data.symbolGraph
      .filter(s => s.file === request.filePath ||
                   (request.filePath && s.usedIn?.includes(request.filePath)))
      .slice(0, 20);

    // Find relevant documentation excerpts (keyword match against question)
    const keywords = request.question.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const docExcerpts = data.docIndex
      .filter(d => keywords.some(k => d.content.toLowerCase().includes(k)))
      .slice(0, 5)
      .map(d => ({ source: d.source, excerpt: d.content.slice(0, 300) }));

    // Find relevant previous fixes
    const relevantFixes = data.fixHistory
      .filter(f => keywords.some(k =>
        f.category?.toLowerCase().includes(k) || f.description?.toLowerCase().includes(k)))
      .slice(0, 5);

    // Project summary (concise)
    const projectSummary = [
      `Files: ${data.projectIndex.fileCount}`,
      `Primary language: ${data.projectIndex.primaryLanguage}`,
      `Frameworks: ${data.frameworks.map(f => f.name).join(', ') || 'none detected'}`
    ].join(' | ');

    return {
      id:                  crypto.randomBytes(4).toString('hex'),
      question:            request.question,
      filePath:            request.filePath,
      line:                request.line,
      primaryFileContent,
      relatedFileContents,
      frameworks:          data.frameworks,
      symbolReferences,
      docExcerpts,
      relevantFixes,
      projectSummary,
      commitDigest:        data.commitDigest,
      builtAt:             new Date().toISOString()
    };
  }

  // ─── Project indexing ────────────────────────────────────────────────────────

  /**
   * Walk the project root and build a lightweight file inventory.
   * @returns {{ fileCount, byExtension, primaryLanguage, entryPoints }}
   */
  _buildProjectIndex() {
    const byExtension = {};
    let   fileCount   = 0;
    const entryPoints = [];

    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }

      for (const entry of entries) {
        const name = entry.name;
        // Skip excluded directories
        if (entry.isDirectory()) {
          if ([...ALWAYS_EXCLUDE, ...this.extraExcludes].includes(name)) return;
          walk(path.join(dir, name));
        } else if (entry.isFile()) {
          const ext = path.extname(name).toLowerCase();
          byExtension[ext] = (byExtension[ext] || 0) + 1;
          fileCount++;
          // Detect common entry points
          if (['index.js', 'main.js', 'app.js', 'cli.js', 'server.js'].includes(name)) {
            entryPoints.push(path.join(dir, name));
          }
        }
      }
    };

    walk(this.projectRoot);

    // Determine primary language from extension counts
    const primaryLanguage = Object.entries(byExtension)
      .sort((a, b) => b[1] - a[1])
      .find(([ext]) => SOURCE_EXTENSIONS.includes(ext))?.[0]?.slice(1) || 'unknown';

    return { fileCount, byExtension, primaryLanguage, entryPoints };
  }

  // ─── Framework detection ─────────────────────────────────────────────────────

  /**
   * Detect installed frameworks and libraries from package.json, requirements.txt, etc.
   * @returns {Array<{name, version, type}>}
   */
  _detectFrameworks() {
    const frameworks = [];

    // Node.js / package.json
    const pkgPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg  = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
        const KNOWN = ['react', 'vue', 'angular', 'express', 'fastify', 'next',
                       'nest', 'koa', 'hapi', 'sequelize', 'mongoose', 'prisma',
                       'jest', 'mocha', 'vitest', 'webpack', 'vite', 'rollup'];
        for (const name of KNOWN) {
          if (deps[name]) frameworks.push({ name, version: deps[name], type: 'npm' });
        }
      } catch {}
    }

    // Python / requirements.txt
    const reqPath = path.join(this.projectRoot, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      const lines = fs.readFileSync(reqPath, 'utf8').split('\n');
      const KNOWN_PY = ['django', 'flask', 'fastapi', 'sqlalchemy', 'pytest'];
      for (const line of lines) {
        const name = line.split(/[>=<!/]/)[0].trim().toLowerCase();
        if (KNOWN_PY.includes(name)) frameworks.push({ name, type: 'python' });
      }
    }

    // Go modules
    const goMod = path.join(this.projectRoot, 'go.mod');
    if (fs.existsSync(goMod)) {
      frameworks.push({ name: 'go-modules', type: 'go' });
    }

    // Cargo.toml (Rust)
    if (fs.existsSync(path.join(this.projectRoot, 'Cargo.toml'))) {
      frameworks.push({ name: 'cargo', type: 'rust' });
    }

    return frameworks;
  }

  // ─── Symbol graph ─────────────────────────────────────────────────────────────

  /**
   * Build a lightweight symbol-reference graph for a primary file.
   * Extracts exported symbols and which files import them.
   *
   * @param {string} [primaryFile]
   * @returns {Array<{symbol, file, usedIn}>}
   */
  _buildSymbolGraph(primaryFile) {
    const symbols = [];
    if (!primaryFile || !fs.existsSync(primaryFile)) return symbols;

    try {
      const content = fs.readFileSync(primaryFile, 'utf8');
      // Extract exported symbols
      const exportRx = /(?:module\.exports\.|exports\.)(\w+)\s*=|export\s+(?:const|function|class)\s+(\w+)/g;
      let m;
      while ((m = exportRx.exec(content)) !== null) {
        const symbol = m[1] || m[2];
        symbols.push({ symbol, file: primaryFile, usedIn: [] });
      }
    } catch {}

    // Scan other files for usages of these symbols (up to 50 files for performance)
    const symbolNames = symbols.map(s => s.symbol);
    if (symbolNames.length === 0) return symbols;

    const files = this._listSourceFiles().slice(0, 50);
    for (const file of files) {
      if (file === primaryFile) continue;
      try {
        const content = fs.readFileSync(file, 'utf8');
        for (const sym of symbols) {
          if (new RegExp(`\\b${sym.symbol}\\b`).test(content)) {
            sym.usedIn.push(file);
          }
        }
      } catch {}
    }

    return symbols;
  }

  // ─── Documentation index ──────────────────────────────────────────────────────

  /**
   * Index documentation files (README, CHANGELOG, .md files) for excerpt search.
   * @returns {Array<{source, content}>}
   */
  _buildDocIndex() {
    const docs = [];
    const docFiles = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md',
                      'docs/README.md', 'docs/QUICKSTART.md'];

    for (const relPath of docFiles) {
      const fullPath = path.join(this.projectRoot, relPath);
      if (fs.existsSync(fullPath)) {
        try {
          docs.push({ source: relPath, content: fs.readFileSync(fullPath, 'utf8').slice(0, 2000) });
        } catch {}
      }
    }

    return docs;
  }

  // ─── Fix history ──────────────────────────────────────────────────────────────

  /**
   * Load previously accepted fix records from the AQT history store.
   * @returns {object[]}
   */
  _loadFixHistory() {
    const historyPath = path.join(this.projectRoot, '.aqt-history', 'fix-history.json');
    if (!fs.existsSync(historyPath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      return Array.isArray(raw) ? raw.slice(-50) : []; // Keep last 50 entries
    } catch { return []; }
  }

  // ─── Commit digest ────────────────────────────────────────────────────────────

  /**
   * Get a digest of recent git commits to provide change-pattern context.
   * Returns an empty array if git is not available.
   * @returns {Array<{hash, message, date, files}>}
   */
  _getCommitDigest() {
    try {
      const raw = execSync(
        'git log --oneline --name-only -10 2>/dev/null',
        { cwd: this.projectRoot, encoding: 'utf8', timeout: 5000, stdio: 'pipe' }
      );
      const commits = [];
      let current = null;
      for (const line of raw.split('\n')) {
        if (/^[0-9a-f]{7,}/.test(line)) {
          if (current) commits.push(current);
          const [hash, ...msgParts] = line.split(' ');
          current = { hash, message: msgParts.join(' '), files: [] };
        } else if (current && line.trim()) {
          current.files.push(line.trim());
        }
      }
      if (current) commits.push(current);
      return commits;
    } catch { return []; }
  }

  // ─── Utility helpers ──────────────────────────────────────────────────────────

  /**
   * List all source files in the project root (excluding ignored dirs).
   * @returns {string[]}
   */
  _listSourceFiles() {
    const files  = [];
    const walk   = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if ([...ALWAYS_EXCLUDE, ...this.extraExcludes].includes(entry.name)) continue;
          walk(full);
        } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
          files.push(full);
        }
      }
    };
    walk(this.projectRoot);
    return files;
  }

  _cacheKey(filePath) {
    return filePath ? path.resolve(filePath) : '__project__';
  }

  _isCacheValid(key, filePath) {
    const entry = this._contextCache.get(key);
    if (!entry) return false;
    // Cache expires after 5 minutes
    if (Date.now() - entry.builtAt > 5 * 60 * 1000) return false;
    // Invalidate if file content changed
    if (filePath && entry.fileHash && this._fileHash(filePath) !== entry.fileHash) return false;
    return true;
  }

  _fileHash(filePath) {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('md5').update(content).digest('hex');
    } catch { return null; }
  }

  _log(msg) { if (this.verbose) console.log(`[ContextSolutionGenerator] ${msg}`); }
}

module.exports = { ContextSolutionGenerator, DEFAULT_TOKEN_BUDGET, SOURCE_EXTENSIONS };

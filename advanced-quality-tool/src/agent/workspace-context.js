'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORES = new Set([
  '.git', 'node_modules', '.aqt', '.aqt-cache', '.aqt-history',
  '.aqt-reports', 'dist', 'build', 'coverage', '.env', 'secrets',
  'credentials', '.ssh'
]);

const SEARCHABLE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html',
  '.java', '.js', '.jsx', '.json', '.md', '.php', '.py', '.rb', '.rs',
  '.scss', '.sh', '.sql', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml'
]);

const SEARCH_STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'build', 'change', 'code',
  'could', 'create', 'feature', 'features', 'fix', 'from', 'have',
  'implement', 'implementation', 'into', 'make', 'requested', 'should',
  'support', 'system', 'task', 'that', 'this', 'update', 'use', 'using',
  'with', 'work', 'workspace', 'would'
]);

class WorkspaceContext {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.maxFiles = options.maxFiles ?? 40;
    this.maxFileBytes = options.maxFileBytes ?? 128 * 1024;
    this.maxTotalBytes = options.maxTotalBytes ?? 512 * 1024;
    this.maxTokens = options.maxTokens ?? 8000;
    this.countTokens = options.countTokens || (content => Math.ceil(content.length / 4));
    this.maxSearchFiles = options.maxSearchFiles ?? 1000;
    this.maxSearchBytes = options.maxSearchBytes ?? 5 * 1024 * 1024;
    this.maxSearchResults = options.maxSearchResults ?? 20;
    this.ignoreNames = new Set([...DEFAULT_IGNORES, ...(options.ignoreNames || [])]);

    for (const [name, value] of Object.entries({
      maxFiles: this.maxFiles,
      maxFileBytes: this.maxFileBytes,
      maxTotalBytes: this.maxTotalBytes,
      maxTokens: this.maxTokens,
      maxSearchFiles: this.maxSearchFiles,
      maxSearchBytes: this.maxSearchBytes,
      maxSearchResults: this.maxSearchResults
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive safe integer`);
      }
    }
  }

  collect(files = [], options = {}) {
    if (!Array.isArray(files)) {
      throw new Error('Context files must be an array');
    }

    const context = {
      files: [],
      missing: [],
      excluded: [],
      truncated: [],
      search: { query: options.query || '', matches: [], scannedFiles: 0, scannedBytes: 0, truncated: false },
      totalBytes: 0,
      totalTokens: 0,
      provenance: []
    };
    const selected = files.map((entry) => {
      const relativePath = typeof entry === 'string' ? entry : entry && entry.path;
      if (typeof relativePath !== 'string' || relativePath.length === 0) {
        throw new Error('Each context file must be a non-empty path or an object with a path');
      }
      return {
        path: relativePath,
        providedContent: entry && typeof entry === 'object' ? entry.content : undefined
      };
    });
    if (selected.length > this.maxFiles) {
      throw new Error(`Context file limit exceeded (${selected.length} > ${this.maxFiles})`);
    }

    const search = this._search(options.query || '', selected.length === 0);
    context.search = search;
    const selectedPaths = new Set(selected.map(file => path.resolve(this.workspace, file.path)));
    for (const discoveredPath of search.paths) {
      if (selected.length >= this.maxFiles) break;
      if (!selectedPaths.has(discoveredPath)) {
        selected.push({ path: path.relative(this.workspace, discoveredPath) });
        selectedPaths.add(discoveredPath);
      }
    }
    delete context.search.paths;

    for (const entry of selected) {
      const absolutePath = path.resolve(this.workspace, entry.path);
      if (!this._isWithinWorkspace(absolutePath)) {
        throw new Error(`Context path is outside the workspace: ${entry.path}`);
      }
      if (this._isIgnored(entry.path)) {
        context.excluded.push({ path: entry.path, reason: 'ignored path' });
        continue;
      }
      if (!fs.existsSync(absolutePath)) {
        if (typeof entry.providedContent !== 'string') {
          context.missing.push(entry.path);
          continue;
        }
        context.missing.push(entry.path);
        this._addContent(context, entry.path, entry.providedContent, 'provided');
        continue;
      }

      const realPath = fs.realpathSync(absolutePath);
      if (!this._isWithinWorkspace(realPath)) {
        throw new Error(`Context path resolves outside the workspace: ${entry.path}`);
      }
      const stat = fs.statSync(realPath);
      if (!stat.isFile()) {
        context.excluded.push({ path: entry.path, reason: 'not a file' });
        continue;
      }
      if (stat.size > this.maxFileBytes) {
        context.truncated.push({ path: entry.path, reason: 'context file byte limit exceeded' });
        continue;
      }

      const content = fs.readFileSync(realPath, 'utf8');
      this._addContent(context, path.relative(this.workspace, realPath), content, 'workspace');
    }

    context.totalBytes = context.files.reduce((sum, file) => sum + file.bytes, 0);
    context.totalTokens = context.files.reduce((sum, file) => sum + file.tokens, 0);
    context.provenance = context.files.map(({ path: filePath, hash, bytes, tokens, language, source, truncated }) => ({
      path: filePath, hash, bytes, tokens, language, source, truncated
    }));
    return context;
  }

  _addContent(context, relativePath, content, source) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const availableBytes = Math.max(0, this.maxTotalBytes - context.totalBytes);
    const availableTokens = Math.max(0, this.maxTokens - context.totalTokens);
    const originalTokens = this.countTokens(content, relativePath);
    if (!Number.isFinite(originalTokens) || originalTokens < 0) {
      throw new Error(`Token counter returned an invalid count for ${relativePath}`);
    }
    if (originalTokens > availableTokens) {
      context.truncated.push({ path: relativePath, reason: 'context token limit exceeded' });
      return;
    }
    const byteLimit = Math.min(this.maxFileBytes, availableBytes);
    let includedContent = content.slice(0, Math.min(content.length, byteLimit));
    while (Buffer.byteLength(includedContent, 'utf8') > byteLimit) includedContent = includedContent.slice(0, -1);
    const truncated = includedContent.length < content.length;

    if (truncated) {
      const reason = Buffer.byteLength(content, 'utf8') > this.maxFileBytes
        ? 'context file byte limit exceeded'
        : 'context total byte or token limit exceeded';
      context.truncated.push({ path: relativePath, reason });
    }

    if (includedContent.length === 0 && content.length > 0) return;
    const bytes = Buffer.byteLength(includedContent, 'utf8');
    const tokens = this.countTokens(includedContent, relativePath);
    const language = this._detectLanguage(relativePath);
    const file = {
      path: (path.isAbsolute(relativePath) ? path.relative(this.workspace, relativePath) : relativePath)
        .split(path.sep).join('/'),
      content: includedContent,
      hash,
      bytes,
      tokens,
      language,
      symbols: this._extractSymbols(includedContent, language),
      source,
      truncated
    };
    context.files.push(file);
    context.totalBytes += bytes;
    context.totalTokens += tokens;
  }

  _search(query, enabled) {
    const search = {
      query,
      matches: [],
      scannedFiles: 0,
      scannedBytes: 0,
      truncated: false,
      paths: []
    };
    if (!enabled) return search;
    const terms = [...new Set((String(query).match(/[a-zA-Z_$][\w$.-]{2,}/g) || [])
      .map(term => term.toLowerCase())
      .filter(term => !SEARCH_STOP_WORDS.has(term)))].slice(0, 8);
    if (!terms.length) return search;

    const scores = new Map();
    const scan = (directory) => {
      if (search.truncated) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (search.truncated) return;
        const fullPath = path.join(directory, entry.name);
        const relativePath = path.relative(this.workspace, fullPath);
        if (this._isIgnored(relativePath) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          scan(fullPath);
          continue;
        }
        if (!entry.isFile() || !SEARCHABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        if (search.scannedFiles >= this.maxSearchFiles || search.scannedBytes >= this.maxSearchBytes) {
          search.truncated = true;
          return;
        }

        search.scannedFiles += 1;
        const stat = fs.statSync(fullPath);
        if (stat.size > this.maxFileBytes || search.scannedBytes + stat.size > this.maxSearchBytes) {
          search.truncated = true;
          return;
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        search.scannedBytes += stat.size;
        const lowerContent = content.toLowerCase();
        const matchedTerms = terms.filter(term => lowerContent.includes(term));
        if (!matchedTerms.length) continue;

        scores.set(fullPath, matchedTerms.length);
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length && search.matches.length < this.maxSearchResults; i += 1) {
          const matchingTerms = terms.filter(term => lines[i].toLowerCase().includes(term));
          if (matchingTerms.length) {
            search.matches.push({
              path: relativePath.split(path.sep).join('/'),
              line: i + 1,
              text: lines[i].trim().slice(0, 300),
              terms: matchingTerms
            });
          }
        }
        if (search.matches.length >= this.maxSearchResults) search.truncated = true;
      }
    };

    scan(this.workspace);
    search.paths = [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, this.maxFiles)
      .map(([filePath]) => filePath);
    return search;
  }

  _isIgnored(relativePath) {
    return relativePath.split(/[\\/]/).some((part) =>
      this.ignoreNames.has(part) || part.startsWith('.env.')
    );
  }

  _detectLanguage(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const languages = {
      '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cs': 'csharp',
      '.css': 'css', '.go': 'go', '.h': 'c', '.hpp': 'cpp',
      '.html': 'html', '.java': 'java', '.js': 'javascript',
      '.jsx': 'javascript', '.json': 'json', '.md': 'markdown',
      '.php': 'php', '.py': 'python', '.rb': 'ruby', '.rs': 'rust',
      '.scss': 'scss', '.sh': 'shell', '.sql': 'sql', '.ts': 'typescript',
      '.tsx': 'typescript', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml'
    };
    return languages[extension] || 'text';
  }

  _extractSymbols(content, language) {
    const pattern = language === 'python'
      ? /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_$][\w$]*)/gm
      : /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
    const symbols = [];
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const kind = match[0].trim().match(/(?:async\s+)?(function|class|interface|type|enum|const|let|var|def)\b/);
      symbols.push({
        name: match[1],
        kind: kind ? kind[1] : 'symbol',
        line: content.slice(0, match.index).split(/\r?\n/).length
      });
    }
    return symbols;
  }

  _isWithinWorkspace(candidate) {
    const relative = path.relative(this.workspace, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }
}

module.exports = { WorkspaceContext };

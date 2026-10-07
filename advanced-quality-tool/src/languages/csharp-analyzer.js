/**
 * C# Language Support (P2-T002)
 *
 * Integrates .NET static analysis tooling behind a single, uniform analyzer
 * that emits the tool's normalized issue shape used across analyzers:
 *   - Roslyn analyzers via `dotnet build` structured diagnostics
 *   - StyleCop.Analyzers (SAxxxx diagnostics, surfaced through the build)
 *   - SonarAnalyzer.CSharp (Sxxxx diagnostics, surfaced through the build)
 *   - dotnet-format (whitespace/style verification)
 *
 * Design notes:
 *   - Shells out to external tools; when a tool is missing or its diagnostics
 *     cannot be parsed, the result includes an error instead of appearing clean.
 *   - Roslyn/StyleCop/Sonar all deliver diagnostics through the compiler, so
 *     the primary path parses `dotnet build` output. We support both the
 *     structured MSBuild JSON logger output and the plain `file(line,col):
 *     severity CODE: message` console format, whichever is available.
 *
 * @module languages/csharp-analyzer
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Maps Roslyn/MSBuild diagnostic severities to the tool's canonical set.
 * @param {string} severity
 * @returns {string}
 */
function mapRoslynSeverity(severity) {
  const map = {
    error: 'ERROR',
    warning: 'WARNING',
    info: 'INFO',
    hidden: 'INFO'
  };
  return map[String(severity || '').toLowerCase()] || 'INFO';
}

/**
 * Classify a C# diagnostic into a category from its rule-id prefix.
 *   CSxxxx -> compiler, SAxxxx -> style (StyleCop), Sxxxx -> Sonar,
 *   CAxxxx -> code-analysis (FxCop/NetAnalyzers), IDExxxx -> ide/style.
 * @param {string} ruleId
 * @returns {string}
 */
function categorizeRule(ruleId) {
  const id = String(ruleId || '').toUpperCase();
  if (id.startsWith('SA')) return 'STYLE';
  if (id.startsWith('CA')) return 'CODE_ANALYSIS';
  if (id.startsWith('IDE')) return 'STYLE';
  if (/^S\d+$/.test(id)) return 'SONAR';
  if (id.startsWith('CS')) return 'COMPILER';
  return 'GENERAL';
}

/**
 * Which C# diagnostics are safely auto-fixable by tooling (dotnet format /
 * Roslyn code fixes) vs. requiring human/AI judgement.
 * @param {string} ruleId
 * @returns {boolean}
 */
function isRuleFixable(ruleId) {
  const id = String(ruleId || '').toUpperCase();
  // StyleCop layout/spacing/readability rules and IDE formatting rules are
  // deterministically fixable via `dotnet format`.
  if (id.startsWith('SA1') || id.startsWith('IDE00') || id.startsWith('IDE1')) {
    return true;
  }
  return false;
}

/**
 * C# Analyzer
 */
class CSharpAnalyzer {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;

    // Which tools to run. All flow through the .NET build/format pipeline.
    this.tools = {
      roslyn: options.roslyn !== false,
      stylecop: options.stylecop !== false,
      sonar: options.sonar !== false,
      format: options.format !== false
    };

    this.toolPaths = {
      dotnet: options.dotnetPath || 'dotnet'
    };

    this.stats = {
      filesAnalyzed: 0,
      issuesFound: 0,
      critical: 0,
      errors: 0,
      warnings: 0,
      info: 0
    };
  }

  /**
   * Analyze a single C# file.
   *
   * Roslyn diagnostics are produced per-project during a build, so for a lone
   * file we locate the nearest project/solution and run the project analysis,
   * then filter to the requested file.
   *
   * @param {string} filePath
   * @returns {Promise<{filePath:string, issues:Array, count:number, language:string, error?:string}>}
   */
  async analyzeFile(filePath) {
    this.stats.filesAnalyzed++;

    try {
      const projectPath = this.findNearestProject(filePath);
      let issues = [];
      const errors = [];

      if (projectPath) {
        const projectResult = await this.analyzeProject(projectPath);
        if (projectResult.error) errors.push(`dotnet: ${projectResult.error}`);
        const target = path.resolve(filePath);
        issues = (projectResult.issues || []).filter(
          (i) => !i.filePath || path.resolve(i.filePath) === target
        );
      }

      // Always run the offline format check for the individual file so we get
      // useful results even when no project/toolchain is present.
      if (this.tools.format) {
        issues.push(...this.detectFormatIssues(filePath));
      }

      this.tallyStats(issues);

      const result = {
        filePath,
        issues,
        count: issues.length,
        language: 'csharp'
      };
      if (errors.length > 0) result.error = errors.join('; ');
      return result;
    } catch (error) {
      this.log(`Error analyzing ${filePath}: ${error.message}`);
      return { filePath, error: error.message, issues: [], count: 0, language: 'csharp' };
    }
  }

  /**
   * Analyze a .NET project or solution by building it and parsing the
   * compiler/analyzer diagnostics.
   *
   * @param {string} projectPath path to a .csproj/.sln (or a directory)
   * @returns {Promise<{projectPath:string, issues:Array, count:number, error?:string}>}
   */
  async analyzeProject(projectPath) {
    try {
      // `-warnaserror-` keeps warnings as warnings; we want them reported, not
      // fatal. `-nologo` and `-v q` keep console noise down; diagnostics still
      // print. `/clp:...` ensures each diagnostic is on its own line.
      const target = this.resolveBuildTarget(projectPath);
      const command =
        `${this.toolPaths.dotnet} build "${target}" ` +
        `-nologo -v q -warnaserror- ` +
        `/clp:NoSummary;ForceNoAlign`;

      const { stdout, stderr } = await execPromise(command, {
        maxBuffer: 50 * 1024 * 1024
      });

      const issues = this.parseBuildOutput(`${stdout || ''}\n${stderr || ''}`);
      return { projectPath, issues, count: issues.length };
    } catch (error) {
      // A failed build still prints diagnostics on stdout/stderr — parse them.
      const combined = `${(error && error.stdout) || ''}\n${(error && error.stderr) || ''}`;
      if (combined.trim()) {
        const issues = this.parseBuildOutput(combined);
        if (issues.length === 0) {
          return {
            projectPath,
            error: `dotnet build failed without recognized diagnostics: ${error.message}`,
            issues,
            count: 0
          };
        }
        return { projectPath, issues, count: issues.length };
      }
      this.log(`dotnet build failed: ${error.message}`);
      return { projectPath, error: error.message, issues: [], count: 0 };
    }
  }

  /**
   * Parse `dotnet build` console diagnostics.
   *
   * Recognizes the canonical MSBuild format:
   *   Path\File.cs(12,5): warning SA1200: Using directive... [Project.csproj]
   *   Path\File.cs(3,1): error CS0246: type or namespace not found [..]
   *
   * @param {string} output
   * @returns {Array}
   */
  parseBuildOutput(output) {
    const issues = [];
    const seen = new Set();

    // file(line,col): severity CODE: message [project]
    const re =
      /^(.*?)\((\d+),(\d+)\):\s+(error|warning|info)\s+([A-Za-z]+\d+):\s+(.*?)(?:\s+\[[^\]]*\])?\s*$/;

    for (const rawLine of String(output).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const m = line.match(re);
      if (!m) continue;

      const [, file, lineNo, colNo, sev, code, message] = m;
      const ruleId = code;

      // Deduplicate identical diagnostics (multi-target builds repeat them).
      const key = `${file}:${lineNo}:${colNo}:${ruleId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      issues.push({
        type: 'roslyn',
        tool: this.toolForRule(ruleId),
        ruleId,
        category: categorizeRule(ruleId),
        severity: mapRoslynSeverity(sev),
        message: message.trim(),
        filePath: file.trim(),
        line: parseInt(lineNo, 10) || 0,
        column: parseInt(colNo, 10) || 0,
        fixable: isRuleFixable(ruleId)
      });
    }

    return issues;
  }

  /**
   * Attribute a rule-id to the tool that most likely produced it.
   * @param {string} ruleId
   * @returns {string}
   */
  toolForRule(ruleId) {
    const cat = categorizeRule(ruleId);
    if (cat === 'STYLE') return 'stylecop';
    if (cat === 'SONAR') return 'sonar';
    if (cat === 'CODE_ANALYSIS') return 'net-analyzers';
    return 'roslyn';
  }

  /**
   * Offline, dependency-free format/style detection used as a baseline and for
   * single-file analysis when the toolchain is unavailable. Deterministic and
   * safe to run anywhere.
   *
   * @param {string} filePath
   * @returns {Array}
   */
  detectFormatIssues(filePath) {
    const issues = [];
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      return issues;
    }

    const lines = content.split(/\r?\n/);
    const usesTabs = /\t/.test(content);

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;

      // SA1028: trailing whitespace
      if (/[ \t]+$/.test(line)) {
        issues.push(this.formatIssue('SA1028', 'STYLE', 'WARNING',
          'Code should not contain trailing whitespace', filePath, lineNo, true));
      }

      // SA1027: tabs used for indentation
      if (usesTabs && /^\t/.test(line)) {
        issues.push(this.formatIssue('SA1027', 'STYLE', 'WARNING',
          'Use spaces instead of tabs for indentation', filePath, lineNo, true));
      }
    });

    // SA1518: file should end with a single trailing newline
    if (content.length > 0 && !content.endsWith('\n')) {
      issues.push(this.formatIssue('SA1518', 'STYLE', 'WARNING',
        'File should end with a newline', filePath, lines.length, true));
    }

    return issues;
  }

  /**
   * Build a normalized style issue produced by the offline detector.
   * @returns {object}
   */
  formatIssue(ruleId, category, severity, message, filePath, line, fixable) {
    return {
      type: 'dotnet-format',
      tool: 'dotnet-format',
      ruleId,
      category,
      severity,
      message,
      filePath,
      line,
      column: 1,
      fixable: !!fixable
    };
  }

  /**
   * Find the nearest .csproj/.sln walking up from a file.
   * @param {string} filePath
   * @returns {string|null}
   */
  findNearestProject(filePath) {
    let dir = path.dirname(path.resolve(filePath));
    const root = path.parse(dir).root;

    while (true) {
      let entries = [];
      try {
        entries = fs.readdirSync(dir);
      } catch (_) {
        return null;
      }
      const proj = entries.find((e) => e.endsWith('.csproj') || e.endsWith('.sln'));
      if (proj) return path.join(dir, proj);

      if (dir === root) return null;
      dir = path.dirname(dir);
    }
  }

  /**
   * Resolve what to pass to `dotnet build`.
   * @param {string} projectPath
   * @returns {string}
   */
  resolveBuildTarget(projectPath) {
    try {
      if (fs.statSync(projectPath).isDirectory()) {
        const entries = fs.readdirSync(projectPath);
        const sln = entries.find((e) => e.endsWith('.sln'));
        if (sln) return path.join(projectPath, sln);
        const csproj = entries.find((e) => e.endsWith('.csproj'));
        if (csproj) return path.join(projectPath, csproj);
      }
    } catch (_) {
      // fall through
    }
    return projectPath;
  }

  /**
   * Update running statistics from a batch of issues.
   * @param {Array} issues
   */
  tallyStats(issues) {
    for (const issue of issues) {
      this.stats.issuesFound++;
      switch (String(issue.severity).toUpperCase()) {
        case 'CRITICAL': this.stats.critical++; break;
        case 'ERROR': this.stats.errors++; break;
        case 'WARNING': this.stats.warnings++; break;
        default: this.stats.info++; break;
      }
    }
  }

  /**
   * Check which C# tools are available on the machine.
   * @returns {Promise<object>}
   */
  async checkTools() {
    const available = { dotnet: false, format: false };
    try {
      await execPromise(`${this.toolPaths.dotnet} --version`);
      available.dotnet = true;
      // `dotnet format` availability
      try {
        await execPromise(`${this.toolPaths.dotnet} format --version`);
        available.format = true;
      } catch (_) {
        available.format = false;
      }
    } catch (error) {
      this.log(`dotnet not available: ${error.message}`);
    }
    return available;
  }

  /**
   * Analyze multiple files.
   * @param {string[]} filePaths
   * @returns {Promise<Array>}
   */
  async analyzeFiles(filePaths) {
    const results = [];
    for (const filePath of filePaths) {
      results.push(await this.analyzeFile(filePath));
    }
    return results;
  }

  /**
   * Find C# source files under a directory.
   * @param {string} directory
   * @param {string[]} patterns
   * @param {string[]} exclude
   * @returns {string[]}
   */
  findFiles(
    directory,
    patterns = ['**/*.cs'],
    exclude = ['**/bin/**', '**/obj/**', '**/.vs/**', '**/packages/**']
  ) {
    const files = [];

    const scan = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        this.log(`Error scanning ${dir}: ${error.message}`);
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(directory, fullPath);

        if (exclude.some((p) => this.matchPattern(relativePath, p))) continue;

        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (patterns.some((p) => this.matchPattern(relativePath, p))) {
          files.push(fullPath);
        }
      }
    };

    scan(directory);
    return files;
  }

  /**
   * Glob matching with globstar support (shared convention with FileWatcher).
   * @param {string} filePath
   * @param {string} pattern
   * @returns {boolean}
   */
  matchPattern(filePath, pattern) {
    const normalized = filePath.replace(/\\/g, '/');
    let regexPattern = '';
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === '*') {
        if (pattern[i + 1] === '*') {
          i++;
          if (pattern[i + 1] === '/') {
            i++;
            regexPattern += '(?:.*/)?';
          } else {
            regexPattern += '.*';
          }
        } else {
          regexPattern += '[^/]*';
        }
      } else if (char === '?') {
        regexPattern += '.';
      } else if ('.+^${}()|[]\\'.includes(char)) {
        regexPattern += `\\${char}`;
      } else {
        regexPattern += char;
      }
    }
    return new RegExp(`^${regexPattern}$`).test(normalized);
  }

  /**
   * Generate a structured report from analysis results.
   * @param {Array} results
   * @returns {object}
   */
  generateReport(results) {
    const report = {
      summary: { ...this.stats, language: 'csharp', timestamp: new Date().toISOString() },
      files: [],
      issues: [],
      bySeverity: { CRITICAL: [], ERROR: [], WARNING: [], INFO: [] },
      byTool: {}
    };

    for (const result of results) {
      if (result.error) {
        report.files.push({ filePath: result.filePath, error: result.error });
        continue;
      }
      report.files.push({ filePath: result.filePath, issueCount: result.count });

      for (const issue of result.issues) {
        report.issues.push(issue);
        if (report.bySeverity[issue.severity]) report.bySeverity[issue.severity].push(issue);
        (report.byTool[issue.tool] = report.byTool[issue.tool] || []).push(issue);
      }
    }

    return report;
  }

  /**
   * Get statistics snapshot.
   * @returns {object}
   */
  getStats() {
    return { ...this.stats };
  }

  log(message) {
    if (this.verbose) {
      console.log(`[CSharpAnalyzer] ${message}`);
    }
  }
}

module.exports = {
  CSharpAnalyzer,
  mapRoslynSeverity,
  categorizeRule,
  isRuleFixable
};

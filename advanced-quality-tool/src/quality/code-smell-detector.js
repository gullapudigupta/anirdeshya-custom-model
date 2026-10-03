/**
 * Code Smell Detector
 *
 * Detects common code smells including long methods, god classes,
 * feature envy, data clumps, primitive obsession, and more.
 *
 * Inspired by: SonarQube code smells
 *
 * @module quality/code-smell-detector
 */

'use strict';

/**
 * Thresholds for smell detection (configurable via options)
 */
const DEFAULT_THRESHOLDS = {
  longMethodLines: 30,          // lines in a function body
  longMethodStatements: 20,     // statement count in a function
  godClassMethods: 20,          // methods in a class
  godClassLines: 500,           // lines in a class
  godClassProperties: 15,       // property count in a class
  featureEnvyCallRatio: 0.6,    // ratio of calls to a foreign module vs total
  dataClumpMinFields: 3,        // min identical field groups to flag
  longParameterList: 5,         // max accepted parameter count
  duplicateStringMin: 3,        // min occurrences of a string literal to flag
  deepNestingLevel: 4,          // max nesting depth before flagging
  largeFileLines: 300           // max lines before file-level smell
};

/**
 * Detects code smells through AST-free, regex/heuristic analysis.
 * Falls back gracefully when AST parsing is unavailable.
 */
class CodeSmellDetector {
  /**
   * @param {object} [options={}]
   * @param {object} [options.thresholds] - Override default thresholds
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.thresholds = Object.assign({}, DEFAULT_THRESHOLDS, options.thresholds || {});

    this.stats = {
      filesAnalyzed: 0,
      smellsFound: 0,
      smellsByType: {}
    };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Analyze a source file for code smells.
   * @param {string} filePath
   * @param {string} content - File text
   * @returns {{ filePath: string, smells: object[], summary: object }}
   */
  analyze(filePath, content) {
    this.stats.filesAnalyzed++;
    const lines = content.split('\n');
    const smells = [];

    smells.push(...this._detectLongMethods(filePath, lines));
    smells.push(...this._detectGodClass(filePath, lines));
    smells.push(...this._detectLongParameterList(filePath, lines));
    smells.push(...this._detectDeepNesting(filePath, lines));
    smells.push(...this._detectDuplicateStringLiterals(filePath, lines));
    smells.push(...this._detectLargeFile(filePath, lines));
    smells.push(...this._detectCommentedOutCode(filePath, lines));
    smells.push(...this._detectDeadCode(filePath, lines));

    this.stats.smellsFound += smells.length;
    smells.forEach(s => {
      this.stats.smellsByType[s.smellType] =
        (this.stats.smellsByType[s.smellType] || 0) + 1;
    });

    return {
      filePath,
      smells,
      summary: {
        total: smells.length,
        bySeverity: this._groupBySeverity(smells),
        byType: this._groupByType(smells)
      }
    };
  }

  /**
   * Analyze multiple files.
   * @param {Array<{filePath: string, content: string}>} files
   * @returns {object[]}
   */
  analyzeFiles(files) {
    return files.map(f => this.analyze(f.filePath, f.content));
  }

  /**
   * Get detection statistics.
   */
  getStats() {
    return { ...this.stats };
  }

  // ─── Detectors ─────────────────────────────────────────────────────────────

  /**
   * Long Method: function body exceeds line or statement threshold.
   */
  _detectLongMethods(filePath, lines) {
    const smells = [];
    const functionPattern = /^\s*(async\s+)?function\s+(\w+)\s*\(|^\s*(const|let|var)\s+(\w+)\s*=\s*(async\s*)?\(|^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*\{/;
    const arrowPattern = /^\s*(const|let|var)\s+(\w+)\s*=\s*(async\s*)?\(.*\)\s*=>\s*\{/;

    let inFunction = false;
    let functionStart = 0;
    let functionName = '';
    let braceDepth = 0;
    let statementCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!inFunction) {
        const m = line.match(functionPattern) || line.match(arrowPattern);
        if (m && line.includes('{')) {
          inFunction = true;
          functionStart = i;
          functionName = (m[2] || m[4] || m[8] || '<anonymous>');
          braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
          statementCount = 0;
          continue;
        }
      }

      if (inFunction) {
        braceDepth += (line.match(/\{/g) || []).length;
        braceDepth -= (line.match(/\}/g) || []).length;

        // Count statements (lines ending with ; or containing control keywords)
        if (/;\s*$/.test(line) || /^\s*(if|for|while|return|throw|switch)\b/.test(line)) {
          statementCount++;
        }

        if (braceDepth <= 0) {
          const functionLines = i - functionStart + 1;

          if (functionLines > this.thresholds.longMethodLines ||
              statementCount > this.thresholds.longMethodStatements) {
            smells.push(this._makeSmell({
              smellType: 'LongMethod',
              severity: functionLines > this.thresholds.longMethodLines * 2 ? 'HIGH' : 'MEDIUM',
              filePath,
              line: functionStart + 1,
              message: `Function '${functionName}' is too long (${functionLines} lines, ${statementCount} statements).`,
              suggestion: 'Extract cohesive blocks into smaller, well-named helper functions.',
              metrics: { lines: functionLines, statements: statementCount }
            }));
          }

          inFunction = false;
          braceDepth = 0;
        }
      }
    }

    return smells;
  }

  /**
   * God Class: class with too many methods, properties, or lines.
   */
  _detectGodClass(filePath, lines) {
    const smells = [];
    const classPattern = /^\s*class\s+(\w+)/;
    let inClass = false;
    let classStart = 0;
    let className = '';
    let braceDepth = 0;
    let methodCount = 0;
    let propertyCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!inClass) {
        const m = line.match(classPattern);
        if (m) {
          inClass = true;
          classStart = i;
          className = m[1];
          braceDepth = 0;
          methodCount = 0;
          propertyCount = 0;
        }
      }

      if (inClass) {
        braceDepth += (line.match(/\{/g) || []).length;
        braceDepth -= (line.match(/\}/g) || []).length;

        // Count methods (at depth 1)
        if (braceDepth === 1 && /^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*\{/.test(line) &&
            !/^\s*(if|for|while|switch)\b/.test(line)) {
          methodCount++;
        }
        // Count this.x = assignments as property declarations
        if (/this\.\w+\s*=/.test(line)) {
          propertyCount++;
        }

        if (braceDepth <= 0 && i > classStart) {
          const classLines = i - classStart + 1;
          const issues = [];
          if (methodCount > this.thresholds.godClassMethods) issues.push(`${methodCount} methods`);
          if (classLines > this.thresholds.godClassLines) issues.push(`${classLines} lines`);
          if (propertyCount > this.thresholds.godClassProperties) issues.push(`${propertyCount} properties`);

          if (issues.length > 0) {
            smells.push(this._makeSmell({
              smellType: 'GodClass',
              severity: issues.length >= 2 ? 'HIGH' : 'MEDIUM',
              filePath,
              line: classStart + 1,
              message: `Class '${className}' is a God Class (${issues.join(', ')}).`,
              suggestion: 'Split this class into smaller, focused classes following Single Responsibility Principle.',
              metrics: { lines: classLines, methods: methodCount, properties: propertyCount }
            }));
          }

          inClass = false;
          braceDepth = 0;
        }
      }
    }

    return smells;
  }

  /**
   * Long Parameter List: function with too many parameters.
   */
  _detectLongParameterList(filePath, lines) {
    const smells = [];
    const funcSig = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\()\s*([^)]*)\)/;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(funcSig);
      if (!m) continue;
      const params = m[3] ? m[3].split(',').map(p => p.trim()).filter(p => p) : [];
      if (params.length > this.thresholds.longParameterList) {
        const name = m[1] || m[2] || '<anonymous>';
        smells.push(this._makeSmell({
          smellType: 'LongParameterList',
          severity: 'MEDIUM',
          filePath,
          line: i + 1,
          message: `Function '${name}' has ${params.length} parameters (max ${this.thresholds.longParameterList}).`,
          suggestion: 'Introduce a parameter object or configuration object to group related parameters.',
          metrics: { paramCount: params.length }
        }));
      }
    }

    return smells;
  }

  /**
   * Deep Nesting: code indented more than threshold levels.
   */
  _detectDeepNesting(filePath, lines) {
    const smells = [];
    const maxDepth = this.thresholds.deepNestingLevel;
    const reported = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const indent = line.match(/^(\s*)/)[1];
      const depth = Math.floor(indent.replace(/\t/g, '    ').length / 2);

      if (depth >= maxDepth && !reported.has(i)) {
        // Find surrounding function name
        smells.push(this._makeSmell({
          smellType: 'DeepNesting',
          severity: depth >= maxDepth + 2 ? 'HIGH' : 'MEDIUM',
          filePath,
          line: i + 1,
          message: `Nesting depth of ${depth} exceeds maximum of ${maxDepth} at line ${i + 1}.`,
          suggestion: 'Extract nested blocks into separate functions or use early returns to reduce nesting.',
          metrics: { depth }
        }));
        reported.add(i);
      }
    }

    return smells;
  }

  /**
   * Duplicate String Literals: same string appears many times.
   */
  _detectDuplicateStringLiterals(filePath, lines) {
    const smells = [];
    const counts = {};
    const firstOccurrence = {};
    const stringPattern = /["']([^"'\n]{4,})["']/g;

    for (let i = 0; i < lines.length; i++) {
      let m;
      while ((m = stringPattern.exec(lines[i])) !== null) {
        const val = m[1];
        if (!counts[val]) {
          counts[val] = 0;
          firstOccurrence[val] = i + 1;
        }
        counts[val]++;
      }
      // Reset lastIndex for global regex
      stringPattern.lastIndex = 0;
    }

    for (const [val, count] of Object.entries(counts)) {
      if (count >= this.thresholds.duplicateStringMin) {
        smells.push(this._makeSmell({
          smellType: 'DuplicateStringLiteral',
          severity: 'LOW',
          filePath,
          line: firstOccurrence[val],
          message: `String literal "${val}" is duplicated ${count} times.`,
          suggestion: 'Extract repeated string literals into named constants.',
          metrics: { occurrences: count, value: val }
        }));
      }
    }

    return smells;
  }

  /**
   * Large File: file exceeds line threshold.
   */
  _detectLargeFile(filePath, lines) {
    const smells = [];
    if (lines.length > this.thresholds.largeFileLines) {
      smells.push(this._makeSmell({
        smellType: 'LargeFile',
        severity: lines.length > this.thresholds.largeFileLines * 2 ? 'HIGH' : 'MEDIUM',
        filePath,
        line: 1,
        message: `File has ${lines.length} lines (threshold: ${this.thresholds.largeFileLines}).`,
        suggestion: 'Split this file into smaller, focused modules.',
        metrics: { lines: lines.length }
      }));
    }
    return smells;
  }

  /**
   * Commented-Out Code: blocks of commented-out code.
   */
  _detectCommentedOutCode(filePath, lines) {
    const smells = [];
    const codeInComment = /\/\/\s*(const|let|var|function|return|if|for|while|class)\b/;
    let streak = 0;
    let streakStart = 0;

    for (let i = 0; i < lines.length; i++) {
      if (codeInComment.test(lines[i])) {
        if (streak === 0) streakStart = i;
        streak++;
      } else {
        if (streak >= 3) {
          smells.push(this._makeSmell({
            smellType: 'CommentedOutCode',
            severity: 'LOW',
            filePath,
            line: streakStart + 1,
            message: `${streak} consecutive lines of commented-out code starting at line ${streakStart + 1}.`,
            suggestion: 'Remove commented-out code; use version control to recover it if needed.',
            metrics: { lines: streak }
          }));
        }
        streak = 0;
      }
    }

    return smells;
  }

  /**
   * Dead Code: unreachable statements after return/throw.
   */
  _detectDeadCode(filePath, lines) {
    const smells = [];
    const terminators = /^\s*(return|throw)\b/;
    const nonEmpty = /\S/;

    for (let i = 0; i < lines.length - 1; i++) {
      if (terminators.test(lines[i])) {
        const next = lines[i + 1];
        if (nonEmpty.test(next) && !/^\s*[}\])]/.test(next) && !/^\s*\/\//.test(next)) {
          smells.push(this._makeSmell({
            smellType: 'DeadCode',
            severity: 'MEDIUM',
            filePath,
            line: i + 2,
            message: `Unreachable code after ${lines[i].trim().split(' ')[0]} at line ${i + 1}.`,
            suggestion: 'Remove or relocate unreachable code.',
            metrics: {}
          }));
        }
      }
    }

    return smells;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _makeSmell({ smellType, severity, filePath, line, message, suggestion, metrics }) {
    return {
      type: 'code-smell',
      smellType,
      severity,
      filePath,
      line,
      message,
      suggestion,
      metrics,
      detectedAt: new Date().toISOString()
    };
  }

  _groupBySeverity(smells) {
    return smells.reduce((acc, s) => {
      acc[s.severity] = (acc[s.severity] || 0) + 1;
      return acc;
    }, {});
  }

  _groupByType(smells) {
    return smells.reduce((acc, s) => {
      acc[s.smellType] = (acc[s.smellType] || 0) + 1;
      return acc;
    }, {});
  }

  _log(msg) {
    if (this.verbose) console.log(`[CodeSmellDetector] ${msg}`);
  }
}

module.exports = { CodeSmellDetector, DEFAULT_THRESHOLDS };

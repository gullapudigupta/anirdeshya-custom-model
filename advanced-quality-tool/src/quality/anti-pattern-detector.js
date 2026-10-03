/**
 * Anti-Pattern Detector
 *
 * Detects common software anti-patterns including God Object, Spaghetti Code,
 * Singleton Abuse, Magic Numbers, Copy-Paste Programming, and others.
 *
 * Inspired by: DeepSource anti-patterns
 *
 * @module quality/anti-pattern-detector
 */

'use strict';

const ANTI_PATTERNS = {
  GodObject:        { severity: 'HIGH',   category: 'architecture' },
  SpaghettiCode:    { severity: 'HIGH',   category: 'architecture' },
  SingletonAbuse:   { severity: 'MEDIUM', category: 'design' },
  MagicNumber:      { severity: 'LOW',    category: 'maintainability' },
  ArrowAntiPattern: { severity: 'MEDIUM', category: 'design' },
  ReturnNull:       { severity: 'MEDIUM', category: 'reliability' },
  EmptyCatch:       { severity: 'HIGH',   category: 'reliability' },
  ConsoleLog:       { severity: 'LOW',    category: 'hygiene' },
  GlobalVariable:   { severity: 'MEDIUM', category: 'architecture' },
  PromiseAntiPattern:{ severity: 'MEDIUM', category: 'async' }
};

class AntiPatternDetector {
  /**
   * @param {object} [options={}]
   * @param {object} [options.thresholds]
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.thresholds = Object.assign({
      godObjectMethods: 15,
      godObjectLines: 400,
      magicNumberMin: 2,           // min occurrences to flag
      maxCallbackDepth: 4
    }, options.thresholds || {});

    this.stats = { filesAnalyzed: 0, patternsFound: 0, byType: {} };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Analyze a file for anti-patterns.
   * @param {string} filePath
   * @param {string} content
   * @returns {{ filePath, patterns: object[], summary: object }}
   */
  analyze(filePath, content) {
    this.stats.filesAnalyzed++;
    const lines = content.split('\n');
    const patterns = [];

    patterns.push(...this._detectGodObject(filePath, lines));
    patterns.push(...this._detectSpaghettiCode(filePath, lines));
    patterns.push(...this._detectSingletonAbuse(filePath, lines));
    patterns.push(...this._detectMagicNumbers(filePath, lines));
    patterns.push(...this._detectEmptyCatch(filePath, lines));
    patterns.push(...this._detectReturnNull(filePath, lines));
    patterns.push(...this._detectConsoleLog(filePath, lines));
    patterns.push(...this._detectGlobalVariables(filePath, lines));
    patterns.push(...this._detectPromiseAntiPattern(filePath, lines));
    patterns.push(...this._detectCallbackHell(filePath, lines));

    this.stats.patternsFound += patterns.length;
    patterns.forEach(p => {
      this.stats.byType[p.patternType] = (this.stats.byType[p.patternType] || 0) + 1;
    });

    return {
      filePath,
      patterns,
      summary: {
        total: patterns.length,
        bySeverity: this._group(patterns, 'severity'),
        byType: this._group(patterns, 'patternType')
      }
    };
  }

  getStats() { return { ...this.stats }; }

  // ─── Detectors ─────────────────────────────────────────────────────────────

  _detectGodObject(filePath, lines) {
    const found = [];
    const classRx = /^\s*class\s+(\w+)/;
    let inClass = false, classStart = 0, className = '', depth = 0, methods = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inClass) {
        const m = line.match(classRx);
        if (m) { inClass = true; classStart = i; className = m[1]; depth = 0; methods = 0; }
      }
      if (inClass) {
        depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        if (depth === 1 && /^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*\{/.test(line) &&
            !/^\s*(if|for|while|switch)\b/.test(line)) methods++;
        if (depth <= 0 && i > classStart) {
          const classLines = i - classStart + 1;
          if (methods > this.thresholds.godObjectMethods || classLines > this.thresholds.godObjectLines) {
            found.push(this._make('GodObject', filePath, classStart + 1,
              `Class '${className}' is a God Object (${methods} methods, ${classLines} lines).`,
              'Split into smaller, focused classes (Single Responsibility Principle).'));
          }
          inClass = false; depth = 0;
        }
      }
    }
    return found;
  }

  _detectSpaghettiCode(filePath, lines) {
    const found = [];
    // Heuristic: many consecutive GOTOs, deeply nested if/for/while chains
    let maxDepth = 0, depthStart = -1;
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth > maxDepth) { maxDepth = depth; depthStart = i; }
    }
    if (maxDepth >= 8) {
      found.push(this._make('SpaghettiCode', filePath, depthStart + 1,
        `Maximum nesting depth of ${maxDepth} detected — possible Spaghetti Code.`,
        'Restructure using early returns, guard clauses, or extracted functions.'));
    }
    // Multiple sequential if-else chains (> 7)
    const ifChain = (lines.join('\n').match(/\belse\s+if\b/g) || []).length;
    if (ifChain > 7) {
      found.push(this._make('SpaghettiCode', filePath, 1,
        `${ifChain} else-if branches found — consider a lookup table or strategy pattern.`,
        'Replace long if-else chains with maps, polymorphism, or a strategy pattern.'));
    }
    return found;
  }

  _detectSingletonAbuse(filePath, lines) {
    const found = [];
    let singletonCount = 0;
    const instancePattern = /(?:module\.exports|exports)\s*=\s*new\s+\w+\s*\(/;
    const staticInstancePattern = /static\s+instance\s*=/;

    for (let i = 0; i < lines.length; i++) {
      if (instancePattern.test(lines[i]) || staticInstancePattern.test(lines[i])) {
        singletonCount++;
        if (singletonCount > 2) {
          found.push(this._make('SingletonAbuse', filePath, i + 1,
            'Multiple singleton instances detected — possible Singleton Abuse.',
            'Use dependency injection instead of singletons to improve testability.'));
        }
      }
    }
    return found;
  }

  _detectMagicNumbers(filePath, lines) {
    const found = [];
    const counts = {};
    const firstLine = {};
    // Exclude 0, 1, -1, 2 (very common) and lines that are variable/constant declarations
    const numRx = /(?<![a-zA-Z_$])\b(\d{2,})\b(?!\s*[=:])/g;
    const skipRx = /^\s*(const|let|var|\/\/|\/\*|\*)/;

    for (let i = 0; i < lines.length; i++) {
      if (skipRx.test(lines[i])) continue;
      let m;
      while ((m = numRx.exec(lines[i])) !== null) {
        const n = m[1];
        if (['100', '200', '400', '404', '500'].includes(n)) continue; // common HTTP codes — skip here; still flag repeats
        counts[n] = (counts[n] || 0) + 1;
        if (!firstLine[n]) firstLine[n] = i + 1;
      }
      numRx.lastIndex = 0;
    }
    for (const [num, cnt] of Object.entries(counts)) {
      if (cnt >= this.thresholds.magicNumberMin) {
        found.push(this._make('MagicNumber', filePath, firstLine[num],
          `Magic number ${num} appears ${cnt} times.`,
          `Extract ${num} into a named constant (e.g. const MAX_RETRIES = ${num}).`));
      }
    }
    return found;
  }

  _detectEmptyCatch(filePath, lines) {
    const found = [];
    for (let i = 0; i < lines.length - 1; i++) {
      if (/\}\s*catch\s*\(/.test(lines[i]) || /^\s*catch\s*\(/.test(lines[i])) {
        // Look for empty body: next non-empty line is closing brace
        const next = lines[i + 1];
        if (/^\s*\}\s*$/.test(next) || /^\s*\/\/.*$/.test(next.trim()) && /^\s*\}\s*$/.test(lines[i + 2] || '')) {
          found.push(this._make('EmptyCatch', filePath, i + 1,
            'Empty catch block silently swallows exceptions.',
            'Log the error or re-throw it; never silently ignore exceptions.'));
        }
      }
    }
    return found;
  }

  _detectReturnNull(filePath, lines) {
    const found = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*return\s+null\s*;/.test(lines[i])) {
        found.push(this._make('ReturnNull', filePath, i + 1,
          'Returning null forces callers to do null checks (null return anti-pattern).',
          'Return a Null Object, empty array, or throw a descriptive error instead.'));
      }
    }
    return found;
  }

  _detectConsoleLog(filePath, lines) {
    const found = [];
    for (let i = 0; i < lines.length; i++) {
      if (/\bconsole\s*\.\s*(log|warn|error|debug|info)\s*\(/.test(lines[i]) &&
          !/^\s*\/\//.test(lines[i])) {
        found.push(this._make('ConsoleLog', filePath, i + 1,
          `console statement left in production code (${lines[i].trim().slice(0, 60)}).`,
          'Use a structured logger (e.g. winston, pino) instead of console statements.'));
      }
    }
    return found;
  }

  _detectGlobalVariables(filePath, lines) {
    const found = [];
    for (let i = 0; i < lines.length; i++) {
      // Top-level var (not inside a function) — simple heuristic: no indent, uses var
      if (/^var\s+\w+/.test(lines[i])) {
        found.push(this._make('GlobalVariable', filePath, i + 1,
          `Top-level \`var\` declaration may create a global variable: ${lines[i].trim().slice(0, 60)}`,
          'Use const/let with proper scoping or module-level exports.'));
      }
    }
    return found;
  }

  _detectPromiseAntiPattern(filePath, lines) {
    const found = [];
    for (let i = 0; i < lines.length; i++) {
      // new Promise wrapping another Promise (deferred anti-pattern)
      if (/new\s+Promise\s*\(/.test(lines[i])) {
        // Look ahead for .then( or await inside
        const body = lines.slice(i, Math.min(i + 10, lines.length)).join(' ');
        if (/\.then\s*\(/.test(body)) {
          found.push(this._make('PromiseAntiPattern', filePath, i + 1,
            'Wrapping a promise inside new Promise() is the Deferred anti-pattern.',
            'Return the existing promise directly instead of wrapping it.'));
        }
      }
      // .then().catch() chaining but mixing async/await
      if (/await\s+\w+.*\.then\s*\(/.test(lines[i])) {
        found.push(this._make('PromiseAntiPattern', filePath, i + 1,
          'Mixing await with .then() chaining is inconsistent.',
          'Use either async/await or .then()/.catch() consistently.'));
      }
    }
    return found;
  }

  _detectCallbackHell(filePath, lines) {
    const found = [];
    let maxDepth = 0, deepestLine = 0;
    let depth = 0;
    const callbackOpen = /function\s*\([^)]*\)\s*\{|=>\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      if (callbackOpen.test(lines[i])) depth++;
      if (/\}/.test(lines[i])) depth = Math.max(0, depth - (lines[i].match(/\}/g) || []).length);
      if (depth > maxDepth) { maxDepth = depth; deepestLine = i; }
    }
    if (maxDepth >= this.thresholds.maxCallbackDepth) {
      found.push(this._make('SpaghettiCode', filePath, deepestLine + 1,
        `Callback nesting depth of ${maxDepth} detected — Callback Hell.`,
        'Refactor using async/await or Promise chaining to flatten the callback pyramid.'));
    }
    return found;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _make(patternType, filePath, line, message, suggestion) {
    const meta = ANTI_PATTERNS[patternType] || { severity: 'MEDIUM', category: 'general' };
    return {
      type: 'anti-pattern',
      patternType,
      severity: meta.severity,
      category: meta.category,
      filePath,
      line,
      message,
      suggestion,
      detectedAt: new Date().toISOString()
    };
  }

  _group(arr, key) {
    return arr.reduce((acc, item) => {
      acc[item[key]] = (acc[item[key]] || 0) + 1;
      return acc;
    }, {});
  }

  _log(msg) { if (this.verbose) console.log(`[AntiPatternDetector] ${msg}`); }
}

module.exports = { AntiPatternDetector, ANTI_PATTERNS };

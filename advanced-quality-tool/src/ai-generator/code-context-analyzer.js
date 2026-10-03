/**
 * Code Context Analyzer with Symbol Queries (P6-T002)
 *
 * Extracts the minimal amount of code context an AI model needs to fix an issue.
 * It leans on the code-analyzer QueryEngine for LINQ-style symbol queries so the
 * context stays small (target: <300 tokens) instead of dumping whole files.
 *
 * Provided context for a single issue:
 *   - the offending lines plus a tight window of surrounding source
 *   - the enclosing symbol (function/class) discovered via symbol queries
 *   - related symbols referenced on the offending lines
 *   - the file's import chain
 *
 * The QueryEngine is optional. When absent, the analyzer degrades gracefully to
 * a line-window extractor so it still works standalone.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { estimateTokens } = require('./issue-classifier');

const DEFAULT_OPTIONS = {
  windowBefore: 4,       // lines of context above the issue
  windowAfter: 4,        // lines of context below the issue
  tokenBudget: 300,      // target max tokens for the whole context bundle
  maxRelatedSymbols: 5,
  rootDir: process.cwd()
};

class CodeContextAnalyzer {
  /**
   * @param {object} [options]
   * @param {object} [options.queryEngine] code-analyzer QueryEngine (optional)
   * @param {string} [options.rootDir] project root for resolving relative files
   */
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.queryEngine = options.queryEngine || null;
  }

  /**
   * Build minimal context for an issue.
   * @param {object} issue Normalized issue
   * @returns {object} context bundle
   */
  analyze(issue) {
    const source = this._readSource(issue.file);
    const lines = source ? source.split(/\r?\n/) : [];

    const snippet = this._extractWindow(lines, issue.startLine, issue.endLine || issue.startLine);
    const imports = this._extractImports(lines);
    const enclosingSymbol = this._findEnclosingSymbol(issue);
    const relatedSymbols = this._findRelatedSymbols(snippet.text);

    const bundle = {
      file: issue.file,
      line: issue.startLine,
      snippet,
      enclosingSymbol,
      relatedSymbols,
      imports: imports.slice(0, 10)
    };

    bundle.tokens = this._estimateBundleTokens(bundle);

    // If over budget, progressively trim the least important parts.
    if (bundle.tokens > this.options.tokenBudget) {
      this._trimToBudget(bundle);
      bundle.tokens = this._estimateBundleTokens(bundle);
    }

    return bundle;
  }

  // ─── Extraction helpers ─────────────────────────────────────────────────────

  _readSource(file) {
    if (!file) return null;
    const abs = path.isAbsolute(file) ? file : path.join(this.options.rootDir, file);
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Extract a line window around the issue. Lines are 1-based.
   */
  _extractWindow(lines, startLine, endLine) {
    if (!lines.length) {
      return { startLine, endLine, text: '', lineCount: 0, truncated: false };
    }
    const from = Math.max(1, startLine - this.options.windowBefore);
    const to = Math.min(lines.length, endLine + this.options.windowAfter);
    const text = lines.slice(from - 1, to).join('\n');
    return { startLine: from, endLine: to, text, lineCount: to - from + 1, truncated: false };
  }

  /**
   * Grab the import chain from the top of the file.
   */
  _extractImports(lines) {
    const imports = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^import\s|^const\s+\w+\s*=\s*require\(/.test(trimmed)) {
        imports.push(trimmed);
      } else if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
        // First real statement that isn't an import ends the chain.
        if (imports.length) break;
      }
    }
    return imports;
  }

  /**
   * Use the QueryEngine to find the symbol enclosing the issue line.
   */
  _findEnclosingSymbol(issue) {
    if (!this.queryEngine || typeof this.queryEngine.getFileSymbols !== 'function') return null;
    try {
      const symbols = this.queryEngine.getFileSymbols(issue.file) || [];
      const candidates = symbols
        .filter((s) => typeof s.line === 'number' && s.line <= issue.startLine)
        .sort((a, b) => b.line - a.line);
      const best = candidates[0];
      return best ? { name: best.name, type: best.type, line: best.line } : null;
    } catch {
      return null;
    }
  }

  /**
   * LINQ-style discovery of symbols referenced in the snippet.
   * Pulls identifiers from the snippet then resolves each via findByName.
   */
  _findRelatedSymbols(snippetText) {
    if (!snippetText) return [];
    const identifiers = this._extractIdentifiers(snippetText);
    const results = [];

    for (const name of identifiers) {
      if (results.length >= this.options.maxRelatedSymbols) break;
      if (this.queryEngine && typeof this.queryEngine.findByName === 'function') {
        try {
          const matches = this.queryEngine.findByName(name) || [];
          const m = matches[0];
          if (m) {
            results.push({ name: m.name, type: m.type, file: m.file, line: m.line });
            continue;
          }
        } catch {
          /* ignore and fall through */
        }
      }
      // No engine or no match: still record the identifier as an unresolved reference.
      results.push({ name, type: 'unresolved' });
    }
    return results.slice(0, this.options.maxRelatedSymbols);
  }

  /**
   * Pull distinct capitalized/camelCase identifiers likely to be symbols.
   */
  _extractIdentifiers(text) {
    const seen = new Set();
    const RESERVED = new Set([
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
      'this', 'new', 'class', 'import', 'export', 'from', 'require', 'await', 'async',
      'true', 'false', 'null', 'undefined', 'typeof', 'void'
    ]);
    const matches = text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
    for (const id of matches) {
      if (RESERVED.has(id)) continue;
      // Prefer identifiers that look like symbols (contain uppercase or are >2 chars).
      if (/[A-Z]/.test(id) || id.length > 3) seen.add(id);
    }
    return Array.from(seen);
  }

  // ─── Budget management ───────────────────────────────────────────────────────

  _estimateBundleTokens(bundle) {
    let text = bundle.snippet?.text || '';
    text += '\n' + (bundle.imports || []).join('\n');
    text += '\n' + (bundle.relatedSymbols || []).map((s) => s.name).join(' ');
    return estimateTokens(text);
  }

  /**
   * Trim, in order of least importance, until under budget.
   */
  _trimToBudget(bundle) {
    // 1. Drop imports first.
    if (this._estimateBundleTokens(bundle) > this.options.tokenBudget) {
      bundle.imports = [];
    }
    // 2. Shrink related symbols.
    if (this._estimateBundleTokens(bundle) > this.options.tokenBudget) {
      bundle.relatedSymbols = (bundle.relatedSymbols || []).slice(0, 2);
    }
    // 3. As a last resort, hard-truncate the snippet to fit the budget.
    if (this._estimateBundleTokens(bundle) > this.options.tokenBudget && bundle.snippet?.text) {
      const maxChars = this.options.tokenBudget * 4;
      bundle.snippet.text = bundle.snippet.text.slice(0, maxChars) + '\n/* …truncated for token budget… */';
      bundle.snippet.truncated = true;
    }
  }
}

module.exports = { CodeContextAnalyzer };

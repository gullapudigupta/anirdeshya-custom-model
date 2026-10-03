/**
 * Error Context Generator & Recovery (P6-T011)
 *
 * After a fix is applied, detects build/lint errors, generates an enhanced context
 * describing the failure (using code-analyzer when available, AQ-SF-006), and drives
 * a bounded retry loop with error-specific guidance.
 *
 * Pure-logic + injectable validators, so it's network-free and testable:
 *   - buildErrorDetector / lintErrorDetector are injectable fns returning
 *     { ok:boolean, errors:[{file,line,message,code?}] }.
 *   - retry(attemptFn) re-runs a caller-supplied fix attempt (max 3 by default),
 *     enriching the prompt/context between attempts.
 */

'use strict';

const DEFAULT_OPTIONS = {
  maxAttempts: 3,
  queryEngine: null,          // optional code-analyzer QueryEngine for enhanced context
  buildValidator: null,       // async (files) => { ok, errors }
  lintValidator: null         // async (files) => { ok, errors }
};

class ErrorRecovery {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.queryEngine = options.queryEngine || null;
  }

  /**
   * Run validators over the affected files and classify any errors.
   * @returns {Promise<{ok:boolean, errors:Array, kinds:string[]}>}
   */
  async detect(files) {
    const errors = [];
    let ok = true;

    if (typeof this.options.buildValidator === 'function') {
      const r = await this._safe(this.options.buildValidator, files);
      if (r && r.ok === false) { ok = false; for (const e of r.errors || []) errors.push({ ...e, kind: 'build' }); }
    }
    if (typeof this.options.lintValidator === 'function') {
      const r = await this._safe(this.options.lintValidator, files);
      if (r && r.ok === false) { ok = false; for (const e of r.errors || []) errors.push({ ...e, kind: 'lint' }); }
    }

    const kinds = Array.from(new Set(errors.map((e) => e.kind)));
    return { ok: ok && errors.length === 0, errors, kinds };
  }

  /**
   * Build an enhanced context object for a detected error, adding symbol info
   * from the QueryEngine when available (AQ-SF-006).
   */
  buildEnhancedContext(error) {
    const context = {
      kind: error.kind || 'error',
      file: error.file,
      line: error.line,
      message: error.message,
      code: error.code || null,
      searchQuery: this._errorSearchQuery(error),
      relatedSymbols: []
    };

    if (this.queryEngine && error.file) {
      try {
        const symbols = typeof this.queryEngine.getFileSymbols === 'function'
          ? (this.queryEngine.getFileSymbols(error.file) || [])
          : [];
        const enclosing = symbols
          .filter((s) => typeof s.line === 'number' && s.line <= (error.line || Infinity))
          .sort((a, b) => b.line - a.line)[0];
        if (enclosing) context.enclosingSymbol = { name: enclosing.name, type: enclosing.type, line: enclosing.line };
        context.relatedSymbols = symbols.slice(0, 5).map((s) => ({ name: s.name, type: s.type, line: s.line }));
      } catch { /* degrade silently */ }
    }
    return context;
  }

  /**
   * Bounded retry orchestrator.
   * @param {object} params
   * @param {function} params.attempt  async (enhancedContext|null, attemptNo) => { files:string[], ...result }
   *        Runs one fix attempt; on the first call enhancedContext is null.
   * @returns {Promise<{success, attempts, history, lastErrors}>}
   */
  async retry({ attempt }) {
    if (typeof attempt !== 'function') throw new Error('retry requires an attempt() function');

    const history = [];
    let enhanced = null;
    let lastErrors = [];

    for (let n = 1; n <= this.options.maxAttempts; n++) {
      const result = await attempt(enhanced, n);
      const files = (result && result.files) || [];
      const detection = await this.detect(files);
      history.push({ attempt: n, ok: detection.ok, errorCount: detection.errors.length });

      if (detection.ok) {
        return { success: true, attempts: n, history, lastErrors: [] };
      }

      lastErrors = detection.errors;
      // Enrich context from the highest-priority error for the next attempt.
      enhanced = this.buildEnhancedContext(detection.errors[0]);
    }

    return { success: false, attempts: this.options.maxAttempts, history, lastErrors };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Build a focused search query for an error-specific lookup (AQ-SF-006).
   */
  _errorSearchQuery(error) {
    return String(error.message || '')
      .replace(/[A-Za-z]:\\[^\s]+/g, '')
      .replace(/\/[^\s]+\.[a-z]+/gi, '')
      .replace(/:\d+(:\d+)?/g, '')
      .replace(/['"`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 10)
      .join(' ');
  }

  async _safe(fn, arg) {
    try { return await fn(arg); } catch (err) { return { ok: false, errors: [{ message: err.message, kind: 'validator-error' }] }; }
  }
}

module.exports = { ErrorRecovery };

/**
 * Self-Explanatory Issue Classifier (P6-T001)
 *
 * Turns a normalized issue into a self-explanatory description that answers
 * three questions in plain English:
 *   - WHAT is the issue?
 *   - WHY is it a problem?
 *   - HOW should it be fixed?
 *
 * It also produces a compact summary (<100 tokens), a priority/complexity score,
 * and optional symbol context pulled from the code-analyzer QueryEngine.
 *
 * Design goals:
 *   - Zero hard dependencies. code-analyzer is used only if supplied.
 *   - Deterministic, template-driven output (no network / model calls here).
 *   - Matches the normalized issue schema from integrations/issue-normalizer.js.
 */

'use strict';

// Rough token estimate: ~4 chars per token. Good enough for budget checks.
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/**
 * Knowledge base: maps issue characteristics to plain-English explanations.
 * Keyed loosely; the classifier picks the most specific match it can find.
 */
const EXPLANATION_RULES = [
  {
    match: (i) => /no-unused-vars|unused/i.test(i.rule || i.type || i.message || ''),
    why: 'Unused code adds noise, can hide bugs, and makes the file harder to read.',
    how: 'Remove the unused declaration, or use it if it was meant to be referenced.',
    complexity: 'low'
  },
  {
    match: (i) => /(^|[^a-z])(semi|quotes|indent|comma-dangle|eol-last|no-trailing-spaces)([^a-z]|$)/i.test(i.rule || ''),
    why: 'Style inconsistencies reduce readability and cause noisy diffs across the team.',
    how: 'Apply the formatter (Prettier/ESLint --fix) to normalize the style automatically.',
    complexity: 'trivial'
  },
  {
    match: (i) => i.category === 'SECURITY' || /injection|xss|eval|hardcoded|secret|password/i.test(i.message || ''),
    why: 'This pattern can be exploited by an attacker to leak data or run untrusted code.',
    how: 'Validate/sanitize inputs, avoid dynamic execution, and move secrets to configuration or a vault.',
    complexity: 'high'
  },
  {
    match: (i) => i.category === 'PERFORMANCE' || /slow|memory leak|inefficient|blocking/i.test(i.message || ''),
    why: 'This code path is doing more work than needed, which slows the app or wastes resources.',
    how: 'Cache repeated work, avoid blocking calls, and prefer batched or lazy operations.',
    complexity: 'medium'
  },
  {
    match: (i) => i.category === 'ACCESSIBILITY' || /aria|alt text|contrast|screen reader/i.test(i.message || ''),
    why: 'Users relying on assistive technology cannot use this element correctly.',
    how: 'Add the missing semantic attributes (alt, aria-*, labels) so the element is announced properly.',
    complexity: 'low'
  },
  {
    match: (i) => i.category === 'BUG' || /undefined|null reference|is not defined|exception/i.test(i.message || ''),
    why: 'This can throw at runtime and break the feature for end users.',
    how: 'Guard the value before use, initialize it, or fix the reference so it always resolves.',
    complexity: 'medium'
  },
  {
    match: (i) => i.category === 'MAINTAINABILITY' || /complex|duplicate|refactor|smell/i.test(i.message || ''),
    why: 'High complexity or duplication makes future changes slow and error-prone.',
    how: 'Extract shared logic into a well-named function and simplify the control flow.',
    complexity: 'medium'
  }
];

const DEFAULT_EXPLANATION = {
  why: 'This flags a deviation from the expected coding standard for the project.',
  how: 'Review the flagged line and adjust it to satisfy the rule.',
  complexity: 'medium'
};

// Complexity -> numeric weight used in the fix-complexity score.
const COMPLEXITY_WEIGHT = { trivial: 1, low: 2, medium: 4, high: 7 };

class IssueClassifier {
  /**
   * @param {object} [options]
   * @param {object} [options.queryEngine] Optional code-analyzer QueryEngine instance
   *   (must expose findByName / getFileSymbols). Used for symbol context only.
   */
  constructor(options = {}) {
    this.options = { summaryTokenLimit: 100, ...options };
    this.queryEngine = options.queryEngine || null;
  }

  /**
   * Classify a single normalized issue.
   * @param {object} issue Normalized issue (see integrations/issue-normalizer.js)
   * @returns {object} classification result
   */
  classify(issue) {
    const rule = EXPLANATION_RULES.find((r) => {
      try { return r.match(issue); } catch { return false; }
    }) || DEFAULT_EXPLANATION;

    const what = this._describeWhat(issue);
    const why = rule.why;
    const how = rule.how;
    const complexity = rule.complexity || 'medium';

    const symbolContext = this._analyzeSymbolContext(issue);
    const summary = this._summarize(issue, what);

    return {
      id: issue.id,
      file: issue.file,
      line: issue.startLine,
      severity: issue.severity,
      category: issue.category,
      explanation: { what, why, how },
      summary,
      summaryTokens: estimateTokens(summary),
      fixComplexity: complexity,
      score: this._score(issue, complexity),
      symbolContext,
      autoFixLevel: issue.autoFixLevel
    };
  }

  /**
   * Classify a batch of issues, sorted by descending score.
   */
  classifyAll(issues) {
    return issues.map((i) => this.classify(i)).sort((a, b) => b.score - a.score);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  _describeWhat(issue) {
    const loc = `${issue.file}:${issue.startLine}`;
    const label = issue.title || issue.message || issue.type || 'Code quality issue';
    return `${label} at ${loc}` + (issue.rule ? ` (rule: ${issue.rule})` : '');
  }

  /**
   * Build a compact summary that stays under the token limit.
   */
  _summarize(issue, what) {
    const base = `[${issue.severity}/${issue.category}] ${issue.message || issue.title || issue.type}`;
    let summary = base;
    const limit = this.options.summaryTokenLimit;

    if (estimateTokens(summary) > limit) {
      const maxChars = limit * 4;
      summary = summary.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
    }
    return summary;
  }

  /**
   * Priority/complexity score. Higher = fix sooner.
   * Blends the normalized priority with an inverse complexity factor so that
   * high-value, low-effort fixes rank first.
   */
  _score(issue, complexity) {
    const priority = typeof issue.priority === 'number' ? issue.priority : 0;
    const effort = COMPLEXITY_WEIGHT[complexity] || 4;
    // Reward low effort: divide priority by a mild effort penalty.
    return Math.round((priority * 10) / effort);
  }

  /**
   * Use the code-analyzer QueryEngine (if provided) to attach symbol context.
   * Never throws; returns null when unavailable.
   */
  _analyzeSymbolContext(issue) {
    if (!this.queryEngine || !issue.file) return null;
    try {
      const fileSymbols = typeof this.queryEngine.getFileSymbols === 'function'
        ? this.queryEngine.getFileSymbols(issue.file)
        : [];

      // Find the symbol enclosing the issue line, if any.
      const enclosing = (fileSymbols || [])
        .filter((s) => typeof s.line === 'number')
        .filter((s) => s.line <= issue.startLine)
        .sort((a, b) => b.line - a.line)[0] || null;

      return {
        enclosingSymbol: enclosing ? { name: enclosing.name, type: enclosing.type, line: enclosing.line } : null,
        symbolsInFile: (fileSymbols || []).length
      };
    } catch {
      return null;
    }
  }
}

module.exports = { IssueClassifier, estimateTokens, EXPLANATION_RULES };

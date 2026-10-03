/**
 * Documentation Search Engine (P6-T003)
 *
 * Searches official documentation sources (ESLint, TypeScript, Angular, React)
 * for the rule/error behind an issue, with local caching (AQ-SF-002).
 *
 * Design:
 *   - Detects the most likely doc source from the issue's rule/message.
 *   - Builds a source-specific search URL and parses the response into fragments.
 *   - Network-free by default: without an injected `fetchImpl`, it still returns
 *     a useful *offline* fragment for well-known rules (e.g. ESLint rule pages)
 *     so the aggregator has something to work with even without connectivity.
 */

'use strict';

const { BaseSearcher } = require('./base-searcher');

// Known documentation homes and how to build a lookup URL / offline hint.
const DOC_SOURCES = {
  eslint: {
    match: (i) => /eslint|no-|semi|quotes|indent|prefer-|camelcase/i.test(_ruleText(i)),
    ruleUrl: (rule) => `https://eslint.org/docs/latest/rules/${encodeURIComponent(rule)}`,
    searchUrl: (q) => `https://eslint.org/docs/latest/rules/?search=${encodeURIComponent(q)}`
  },
  typescript: {
    match: (i) => /typescript|ts\(\d+\)|TS\d+|type|interface/i.test(_ruleText(i)),
    ruleUrl: () => 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html',
    searchUrl: (q) => `https://www.typescriptlang.org/docs/search?q=${encodeURIComponent(q)}`
  },
  angular: {
    match: (i) => /angular|ng[A-Z]|@angular|template|directive/i.test(_ruleText(i)),
    ruleUrl: () => 'https://angular.dev/guide',
    searchUrl: (q) => `https://angular.dev/search?q=${encodeURIComponent(q)}`
  },
  react: {
    match: (i) => /react|jsx|hook|useState|useEffect/i.test(_ruleText(i)),
    ruleUrl: () => 'https://react.dev/reference/react',
    searchUrl: (q) => `https://react.dev/search?q=${encodeURIComponent(q)}`
  }
};

function _ruleText(issueOrClassification) {
  const i = issueOrClassification || {};
  return [i.rule, i.type, i.message, i.summary, i.category].filter(Boolean).join(' ');
}

class DocSearcher extends BaseSearcher {
  constructor(options = {}) {
    super(options);
    this.source = 'docs';
  }

  /**
   * Detect which documentation source best fits the issue.
   */
  detectSource(input) {
    for (const [name, def] of Object.entries(DOC_SOURCES)) {
      try { if (def.match(input)) return name; } catch { /* skip */ }
    }
    return null;
  }

  buildQuery(input) {
    if (typeof input === 'string') return input;
    const rule = (input && input.rule) || '';
    const label = (input && (input.summary || input.message || input.title)) || '';
    return [rule, label].filter(Boolean).join(' ').trim();
  }

  requestUrl(query) {
    const detected = this._lastDetected || 'eslint';
    const def = DOC_SOURCES[detected];
    return def.searchUrl(query);
  }

  parse(raw, query) {
    // Real doc sites return HTML/JSON that varies; keep the parser defensive.
    if (Array.isArray(raw)) {
      return raw.map((r) => ({
        source: 'docs',
        title: r.title || r.name || query,
        text: r.excerpt || r.text || r.description || '',
        url: r.url || r.href
      }));
    }
    if (raw && typeof raw === 'object' && Array.isArray(raw.results)) {
      return raw.results.map((r) => ({
        source: 'docs',
        title: r.title || query,
        text: r.snippet || r.text || '',
        url: r.url
      }));
    }
    return [];
  }

  /**
   * Overrides search to add an offline fallback fragment for known rules.
   */
  async search(input) {
    this._lastDetected = this.detectSource(input);
    const result = await super.search(input);

    // Provide an offline hint when nothing came back (no transport / miss).
    if (!result.fragments.length && this._lastDetected) {
      const rule = (input && input.rule) || result.query;
      const def = DOC_SOURCES[this._lastDetected];
      const url = def.ruleUrl(rule);
      result.fragments = [{
        source: 'docs',
        title: `${this._lastDetected} documentation for "${rule}"`,
        text: `Refer to the official ${this._lastDetected} documentation for guidance on "${rule}".`,
        url,
        score: 0.4,
        offline: true
      }];
    }
    return result;
  }
}

module.exports = { DocSearcher, DOC_SOURCES };

/**
 * Base Searcher — shared behavior for the P6-T003..T005 search adapters.
 *
 * Provides:
 *   - Injectable transport (`fetchImpl`) so adapters are network-free by default
 *     and fully testable. When no transport is supplied, `search()` resolves to
 *     an empty result instead of making a real network call.
 *   - Local caching via SearchCache (AQ-SF-002).
 *   - A uniform result shape (context "fragments") the ContextAggregator (P6-T006)
 *     already understands: { source, title, text, url, score }.
 *   - A relevance ranking helper based on query-keyword overlap.
 *
 * Subclasses implement:
 *   - source (string identifier)
 *   - buildQuery(classification|issue) -> string
 *   - requestUrl(query) -> string
 *   - parse(rawResponse, query) -> Array<fragment>
 */

'use strict';

const { SearchCache } = require('./search-cache');

const DEFAULT_OPTIONS = {
  fetchImpl: null,       // async (url, opts) => { ok, status, json(), text() }
  cache: null,           // SearchCache instance (created if absent)
  cacheDir: null,
  rootDir: process.cwd(),
  maxResults: 5,
  timeoutMs: 8000,
  enabled: true
};

class BaseSearcher {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.fetchImpl = this.options.fetchImpl || null;
    this.cache = this.options.cache ||
      new SearchCache({ cacheDir: this.options.cacheDir, rootDir: this.options.rootDir });
    this.source = 'unknown';
  }

  /** Subclasses override. */
  buildQuery(input) {
    if (typeof input === 'string') return input;
    return (input && (input.summary || input.message || input.title)) || '';
  }

  /** Subclasses override. */
  requestUrl(_query) {
    throw new Error('requestUrl not implemented');
  }

  /** Subclasses override. */
  parse(_raw, _query) {
    return [];
  }

  /**
   * Run a search. Returns { source, query, fragments, fromCache, error? }.
   * Never throws — failures degrade to an empty fragment list.
   */
  async search(input) {
    const query = this.buildQuery(input);
    if (!this.options.enabled || !query) {
      return { source: this.source, query, fragments: [], fromCache: false };
    }

    const cached = this.cache.get(this.source, query);
    if (cached) {
      return { source: this.source, query, fragments: cached, fromCache: true };
    }

    if (typeof this.fetchImpl !== 'function') {
      // No transport wired: network-free mode. Return empty, do not cache.
      return {
        source: this.source, query, fragments: [], fromCache: false,
        error: 'no transport configured (network-free mode)'
      };
    }

    try {
      const raw = await this._fetch(this.requestUrl(query));
      const fragments = this._rank(this.parse(raw, query), query).slice(0, this.options.maxResults);
      this.cache.set(this.source, query, fragments);
      return { source: this.source, query, fragments, fromCache: false };
    } catch (err) {
      return { source: this.source, query, fragments: [], fromCache: false, error: err.message };
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  async _fetch(url) {
    const res = await this.fetchImpl(url, { timeoutMs: this.options.timeoutMs });
    if (res && res.ok === false) {
      throw new Error(`HTTP ${res.status} from ${this.source}`);
    }
    if (res && typeof res.json === 'function') return res.json();
    if (res && typeof res.text === 'function') return res.text();
    return res;
  }

  /**
   * Rank fragments by keyword overlap with the query, preserving any explicit
   * score the parser supplied.
   */
  _rank(fragments, query) {
    const keywords = this._keywords(query);
    return fragments
      .map((f) => {
        const overlap = this._overlap(`${f.title || ''} ${f.text || ''}`, keywords);
        const base = typeof f.score === 'number' ? f.score : 0.5;
        return { ...f, source: f.source || this.source, score: Number((base * (1 + overlap)).toFixed(4)) };
      })
      .sort((a, b) => b.score - a.score);
  }

  _keywords(query) {
    const words = String(query).toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [];
    return Array.from(new Set(words)).slice(0, 12);
  }

  _overlap(text, keywords) {
    if (!keywords.length) return 0;
    const lower = String(text).toLowerCase();
    const hits = keywords.filter((k) => lower.includes(k)).length;
    return hits / keywords.length;
  }
}

module.exports = { BaseSearcher, DEFAULT_SEARCHER_OPTIONS: DEFAULT_OPTIONS };

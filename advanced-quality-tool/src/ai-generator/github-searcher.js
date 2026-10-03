/**
 * GitHub Issues Search Integration (P6-T004)
 *
 * Searches GitHub issues for problems similar to the one being fixed and extracts
 * candidate solutions from issue bodies / top comments.
 *
 * Uses the GitHub Search API:
 *   GET https://api.github.com/search/issues?q=<query>
 *
 * - Injectable transport (network-free by default).
 * - Optional token via options.token (sent as Authorization header hint through
 *   the fetch layer; the transport is responsible for applying headers).
 * - Query optimizer trims noisy tokens and scopes to issues.
 */

'use strict';

const { BaseSearcher } = require('./base-searcher');

const DEFAULT_OPTIONS = {
  apiBase: 'https://api.github.com',
  repos: [],          // optional list like ['eslint/eslint'] to scope the search
  token: null
};

class GitHubSearcher extends BaseSearcher {
  constructor(options = {}) {
    super(options);
    this.source = 'github';
    this.ghOptions = { ...DEFAULT_OPTIONS, ...options };
  }

  buildQuery(input) {
    const base = typeof input === 'string'
      ? input
      : (input && (input.message || input.summary || input.title)) || '';
    return this._optimizeQuery(base);
  }

  requestUrl(query) {
    const repoScope = this.ghOptions.repos.length
      ? ' ' + this.ghOptions.repos.map((r) => `repo:${r}`).join(' ')
      : '';
    const q = encodeURIComponent(`${query}${repoScope} is:issue`);
    return `${this.ghOptions.apiBase}/search/issues?q=${q}&sort=reactions&per_page=${this.options.maxResults}`;
  }

  parse(raw, _query) {
    const items = (raw && Array.isArray(raw.items)) ? raw.items : [];
    return items.map((it) => ({
      source: 'github',
      title: it.title || 'GitHub issue',
      text: this._extractSolution(it),
      url: it.html_url,
      // Reactions/comments as a light popularity signal.
      score: this._popularityScore(it)
    }));
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Strip file paths, line numbers, and quotes so the query matches prose issues.
   */
  _optimizeQuery(text) {
    return String(text)
      .replace(/[A-Za-z]:\\[^\s]+/g, '')     // windows paths
      .replace(/\/[^\s]+\.[a-z]+/gi, '')     // unix file paths
      .replace(/:\d+(:\d+)?/g, '')           // :line:col
      .replace(/["'`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 10)
      .join(' ');
  }

  _extractSolution(item) {
    const body = String(item.body || '');
    // Prefer a fenced code block (likely the fix), else the first paragraph.
    const fence = body.match(/```[\s\S]*?```/);
    if (fence) return fence[0].slice(0, 600);
    const firstPara = body.split(/\n\s*\n/)[0] || '';
    return firstPara.slice(0, 400);
  }

  _popularityScore(item) {
    const reactions = (item.reactions && item.reactions.total_count) || 0;
    const comments = item.comments || 0;
    // Normalize into a small 0..1 bump.
    return Math.min(1, 0.4 + (reactions + comments) / 100);
  }
}

module.exports = { GitHubSearcher };

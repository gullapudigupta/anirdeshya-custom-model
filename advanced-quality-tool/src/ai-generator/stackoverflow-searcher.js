/**
 * StackOverflow Search Integration (P6-T005)
 *
 * Searches StackOverflow (via the StackExchange API) for related questions and
 * their accepted answers, then extracts code snippets from those answers.
 *
 * StackExchange API:
 *   GET https://api.stackexchange.com/2.3/search/advanced
 *       ?order=desc&sort=relevance&q=<query>&accepted=True&site=stackoverflow
 *
 * - Injectable transport (network-free by default).
 * - Answer parser prefers accepted answers and pulls fenced/`<pre><code>` snippets.
 */

'use strict';

const { BaseSearcher } = require('./base-searcher');

const DEFAULT_OPTIONS = {
  apiBase: 'https://api.stackexchange.com/2.3',
  site: 'stackoverflow',
  acceptedOnly: true
};

class StackOverflowSearcher extends BaseSearcher {
  constructor(options = {}) {
    super(options);
    this.source = 'stackoverflow';
    this.soOptions = { ...DEFAULT_OPTIONS, ...options };
  }

  buildQuery(input) {
    const base = typeof input === 'string'
      ? input
      : (input && (input.message || input.summary || input.title)) || '';
    return String(base).replace(/["'`]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 12).join(' ');
  }

  requestUrl(query) {
    const params = [
      'order=desc',
      'sort=relevance',
      `q=${encodeURIComponent(query)}`,
      this.soOptions.acceptedOnly ? 'accepted=True' : '',
      'filter=withbody',
      `pagesize=${this.options.maxResults}`,
      `site=${encodeURIComponent(this.soOptions.site)}`
    ].filter(Boolean).join('&');
    return `${this.soOptions.apiBase}/search/advanced?${params}`;
  }

  parse(raw, _query) {
    const items = (raw && Array.isArray(raw.items)) ? raw.items : [];
    return items.map((q) => {
      const snippet = this._extractCode(q.body || '');
      return {
        source: 'stackoverflow',
        title: this._decode(q.title || 'StackOverflow question'),
        text: snippet || this._plain(q.body || '').slice(0, 400),
        url: q.link,
        score: this._answerScore(q)
      };
    });
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  _extractCode(html) {
    // <pre><code>...</code></pre> is how SO wraps code blocks.
    const m = html.match(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/i);
    if (!m) return '';
    return this._decode(m[1]).slice(0, 600);
  }

  _plain(html) {
    return this._decode(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  _decode(text) {
    return String(text)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  _answerScore(q) {
    const isAccepted = q.is_answered && (q.accepted_answer_id != null);
    const votes = typeof q.score === 'number' ? q.score : 0;
    return Math.min(1, (isAccepted ? 0.6 : 0.4) + votes / 50);
  }
}

module.exports = { StackOverflowSearcher };

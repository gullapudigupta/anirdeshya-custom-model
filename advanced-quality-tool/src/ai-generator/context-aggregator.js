/**
 * Context Aggregator & Summarizer (P6-T006)
 *
 * Aggregates heterogeneous context fragments (code context, doc/GitHub/SO search
 * results, symbol analysis) into a single deduplicated, relevance-ranked bundle
 * that fits within a token budget (target: <2000 tokens total).
 *
 * Search adapters (P6-T003..T005) are not implemented yet, so this module accepts
 * whatever fragments callers can supply today (at minimum the CodeContextAnalyzer
 * bundle) and is shaped to absorb search results later without changes.
 *
 * A "fragment" is a plain object:
 *   { source: 'code'|'docs'|'github'|'stackoverflow'|'symbol', title, text, url?, score? }
 */

'use strict';

const { estimateTokens } = require('./issue-classifier');

const DEFAULT_OPTIONS = {
  tokenBudget: 2000,
  maxFragments: 12
};

// Base trust weight per source; combined with caller-supplied score.
const SOURCE_WEIGHT = {
  code: 1.0,
  symbol: 0.9,
  docs: 0.8,
  stackoverflow: 0.6,
  github: 0.5,
  unknown: 0.3
};

class ContextAggregator {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Aggregate fragments plus an optional code-context bundle into one result.
   * @param {object} input
   * @param {object} [input.codeContext] Result of CodeContextAnalyzer.analyze()
   * @param {Array}  [input.fragments] Additional context fragments
   * @param {object} [input.classification] IssueClassifier result (used for relevance seed)
   * @returns {object} { fragments, summary, tokens, droppedCount, withinBudget }
   */
  aggregate(input = {}) {
    const fragments = this._collect(input);
    const deduped = this._deduplicate(fragments);
    const ranked = this._rank(deduped, input.classification);
    const { kept, dropped } = this._fitToBudget(ranked);

    const summary = this._summarize(kept);
    const tokens = this._totalTokens(kept);

    return {
      fragments: kept,
      summary,
      tokens,
      droppedCount: dropped,
      withinBudget: tokens <= this.options.tokenBudget
    };
  }

  // ─── Collection ──────────────────────────────────────────────────────────────

  _collect(input) {
    const fragments = [];

    if (input.codeContext && input.codeContext.snippet) {
      const cc = input.codeContext;
      fragments.push({
        source: 'code',
        title: `Source context ${cc.file}:${cc.snippet.startLine}-${cc.snippet.endLine}`,
        text: cc.snippet.text,
        score: 1
      });
      if (cc.enclosingSymbol) {
        fragments.push({
          source: 'symbol',
          title: `Enclosing ${cc.enclosingSymbol.type} ${cc.enclosingSymbol.name}`,
          text: `${cc.enclosingSymbol.type} ${cc.enclosingSymbol.name} @ line ${cc.enclosingSymbol.line}`,
          score: 0.9
        });
      }
    }

    for (const f of input.fragments || []) {
      if (!f || !f.text) continue;
      fragments.push({
        source: f.source || 'unknown',
        title: f.title || f.source || 'fragment',
        text: String(f.text),
        url: f.url,
        score: typeof f.score === 'number' ? f.score : 0.5
      });
    }

    return fragments;
  }

  // ─── Deduplication ───────────────────────────────────────────────────────────

  /**
   * Remove near-duplicate fragments using a normalized-text signature.
   */
  _deduplicate(fragments) {
    const seen = new Map();
    const unique = [];
    for (const f of fragments) {
      const sig = this._signature(f.text);
      if (seen.has(sig)) {
        // Keep the higher-scored / longer-text variant.
        const existing = seen.get(sig);
        if ((f.score || 0) > (existing.score || 0) || f.text.length > existing.text.length) {
          const idx = unique.indexOf(existing);
          unique[idx] = f;
          seen.set(sig, f);
        }
      } else {
        seen.set(sig, f);
        unique.push(f);
      }
    }
    return unique;
  }

  _signature(text) {
    return String(text)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
      .trim()
      .slice(0, 200);
  }

  // ─── Ranking ─────────────────────────────────────────────────────────────────

  /**
   * Relevance score = source weight * caller score * keyword-overlap boost.
   */
  _rank(fragments, classification) {
    const keywords = this._keywords(classification);
    return fragments
      .map((f) => {
        const weight = SOURCE_WEIGHT[f.source] || SOURCE_WEIGHT.unknown;
        const overlap = this._keywordOverlap(f.text, keywords);
        const relevance = weight * (f.score || 0.5) * (1 + overlap);
        return { ...f, relevance: Number(relevance.toFixed(4)) };
      })
      .sort((a, b) => b.relevance - a.relevance);
  }

  _keywords(classification) {
    if (!classification) return [];
    const text = [
      classification.summary,
      classification.explanation?.what,
      classification.category
    ].filter(Boolean).join(' ').toLowerCase();
    const words = text.match(/[a-z][a-z0-9]{3,}/g) || [];
    return Array.from(new Set(words)).slice(0, 12);
  }

  _keywordOverlap(text, keywords) {
    if (!keywords.length) return 0;
    const lower = String(text).toLowerCase();
    const hits = keywords.filter((k) => lower.includes(k)).length;
    return hits / keywords.length; // 0..1
  }

  // ─── Budget ──────────────────────────────────────────────────────────────────

  _fitToBudget(ranked) {
    const kept = [];
    let dropped = 0;
    let running = 0;

    for (const f of ranked) {
      if (kept.length >= this.options.maxFragments) { dropped++; continue; }
      const cost = estimateTokens(f.text) + estimateTokens(f.title);
      if (running + cost > this.options.tokenBudget) {
        dropped++;
        continue;
      }
      running += cost;
      kept.push(f);
    }
    return { kept, dropped };
  }

  _totalTokens(fragments) {
    return fragments.reduce((sum, f) => sum + estimateTokens(f.text) + estimateTokens(f.title), 0);
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────

  _summarize(fragments) {
    if (!fragments.length) return 'No supporting context available.';
    const bySource = {};
    for (const f of fragments) {
      bySource[f.source] = (bySource[f.source] || 0) + 1;
    }
    const parts = Object.entries(bySource).map(([s, n]) => `${n} ${s}`);
    return `Aggregated ${fragments.length} context fragment(s): ${parts.join(', ')}.`;
  }
}

module.exports = { ContextAggregator, SOURCE_WEIGHT };

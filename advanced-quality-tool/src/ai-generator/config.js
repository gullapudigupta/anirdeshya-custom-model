/**
 * Configuration & Cost Monitoring (P6-T014)
 *
 * Loads AI-generator config (with sane defaults), enforces rate limits, tracks
 * cumulative cost against a budget, and writes daily cost reports (AQ-SF-004).
 *
 * Filesystem + in-memory only; no network.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  execution: {
    strategy: 'local-first',        // 'local-first' | 'local-only' | 'cloud-only'
    localModel: 'codellama:7b',
    cloudProvider: 'openai',
    cloudModel: 'gpt-4o-mini',
    maxAttempts: 3
  },
  search: {
    enabled: true,
    sources: ['docs', 'github', 'stackoverflow'],
    maxResults: 5,
    // Configurable dependency->docs patterns consumed by DependencyDocResolver (T016).
    docPatterns: []
  },
  limits: {
    maxFixesPerRun: 50,
    requestsPerMinute: 20,
    dailyBudgetUsd: 5.0
  },
  reportsDir: null                  // defaults to <rootDir>/.aqt-reports/ai-generator
};

/**
 * Simple token-bucket-ish rate limiter (requests per window).
 */
class RateLimiter {
  constructor({ requestsPerMinute = 20 } = {}) {
    this.capacity = requestsPerMinute;
    this.windowMs = 60000;
    this.hits = [];
  }
  /** @returns {{allowed:boolean, retryAfterMs:number}} */
  check() {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length < this.capacity) {
      this.hits.push(now);
      return { allowed: true, retryAfterMs: 0 };
    }
    const oldest = this.hits[0];
    return { allowed: false, retryAfterMs: this.windowMs - (now - oldest) };
  }
}

/**
 * Tracks spend and enforces a daily budget (AQ-SF-004).
 */
class CostTracker {
  constructor({ dailyBudgetUsd = 5.0, reportsDir = null, rootDir = process.cwd() } = {}) {
    this.dailyBudgetUsd = dailyBudgetUsd;
    this.reportsDir = reportsDir || path.join(rootDir, '.aqt-reports', 'ai-generator');
    this.spentToday = this._loadToday();
  }

  get remaining() { return Math.max(0, this.dailyBudgetUsd - this.spentToday); }
  get withinBudget() { return this.spentToday < this.dailyBudgetUsd; }

  /** Would spending `cost` exceed the daily budget? */
  canSpend(cost = 0) { return this.spentToday + cost <= this.dailyBudgetUsd; }

  /** Record spend and persist the daily report. */
  record(cost = 0, meta = {}) {
    this.spentToday = Number((this.spentToday + cost).toFixed(6));
    this._persist(cost, meta);
    return this.spentToday;
  }

  getReport() {
    return {
      date: this._today(),
      spentUsd: Number(this.spentToday.toFixed(6)),
      budgetUsd: this.dailyBudgetUsd,
      remainingUsd: Number(this.remaining.toFixed(6)),
      withinBudget: this.withinBudget
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  _today() { return new Date().toISOString().slice(0, 10); }
  _reportFile() { return path.join(this.reportsDir, `cost-${this._today()}.json`); }

  _loadToday() {
    try {
      const data = JSON.parse(fs.readFileSync(this._reportFile(), 'utf8'));
      return typeof data.spentUsd === 'number' ? data.spentUsd : 0;
    } catch { return 0; }
  }

  _persist(cost, meta) {
    try {
      fs.mkdirSync(this.reportsDir, { recursive: true });
      let data = { date: this._today(), spentUsd: 0, budgetUsd: this.dailyBudgetUsd, entries: [] };
      try { data = JSON.parse(fs.readFileSync(this._reportFile(), 'utf8')); } catch { /* new file */ }
      data.spentUsd = this.spentToday;
      data.budgetUsd = this.dailyBudgetUsd;
      data.entries = data.entries || [];
      if (cost > 0) data.entries.push({ at: new Date().toISOString(), cost: Number(cost.toFixed(6)), ...meta });
      fs.writeFileSync(this._reportFile(), JSON.stringify(data, null, 2), 'utf8');
    } catch { /* reporting is best-effort */ }
  }
}

/**
 * Load config: deep-merge defaults with a JSON file and inline overrides.
 */
function loadConfig(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  let fileConfig = {};
  const configPath = options.configPath || path.join(rootDir, '.aqt', 'ai-generator.json');
  try { fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { /* optional */ }

  const merged = _deepMerge(_deepMerge(_clone(DEFAULT_CONFIG), fileConfig), options.overrides || {});
  merged.rootDir = rootDir;
  return merged;
}

function _clone(o) { return JSON.parse(JSON.stringify(o)); }
function _deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) base[k] = _deepMerge(base[k] || {}, v);
    else base[k] = v;
  }
  return base;
}

module.exports = { DEFAULT_CONFIG, RateLimiter, CostTracker, loadConfig };

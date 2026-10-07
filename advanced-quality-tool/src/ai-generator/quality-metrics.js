'use strict';

class AIGenerationQualityMetrics {
  constructor() {
    this.reset();
  }

  reset() {
    this.totals = { processed: 0, fixed: 0, failed: 0, skipped: 0, recovered: 0, totalCostUsd: 0, totalDurationMs: 0 };
    this.categories = {};
  }

  record(outcome = {}) {
    const durationMs = outcome.durationMs === undefined ? 0 : outcome.durationMs;
    const costUsd = outcome.costUsd === undefined ? 0 : outcome.costUsd;
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('durationMs must be non-negative');
    if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error('costUsd must be non-negative');

    this.totals.processed++;
    this.totals.totalDurationMs += durationMs;
    this.totals.totalCostUsd = Number((this.totals.totalCostUsd + costUsd).toFixed(6));
    if (outcome.skipped) this.totals.skipped++;
    else if (outcome.success) this.totals.fixed++;
    else this.totals.failed++;
    if (outcome.recovered) this.totals.recovered++;

    const category = String(outcome.category || 'uncategorized').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'uncategorized';
    const metric = this.categories[category] || (this.categories[category] = { processed: 0, fixed: 0, failed: 0, skipped: 0 });
    metric.processed++;
    if (outcome.skipped) metric.skipped++;
    else if (outcome.success) metric.fixed++;
    else metric.failed++;
  }

  report() {
    const { processed, fixed, failed, skipped, recovered, totalCostUsd, totalDurationMs } = this.totals;
    return {
      ...this.totals,
      successRate: processed ? Number((fixed / processed * 100).toFixed(2)) : 0,
      averageDurationMs: processed ? Number((totalDurationMs / processed).toFixed(2)) : 0,
      categories: Object.fromEntries(Object.entries(this.categories).map(([category, metric]) => [
        category,
        {
          ...metric,
          successRate: metric.processed ? Number((metric.fixed / metric.processed * 100).toFixed(2)) : 0
        }
      ]))
    };
  }
}

module.exports = { AIGenerationQualityMetrics };

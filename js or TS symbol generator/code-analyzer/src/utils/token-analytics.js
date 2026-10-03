/**
 * CAT-021: Token Analytics
 * 
 * Measure token savings per request vs whole-file baseline.
 * Track reduction % per endpoint. Helps justify and optimize
 * the context-serving approach.
 * 
 * Maps to sidecar /analytics endpoint pattern.
 * 
 * Usage:
 *   analytics.recordRequest('snippet', { inputTokens: 50, outputTokens: 120, baselineTokens: 2400 })
 *   analytics.getReport()
 *   analytics.getSavings('compose')
 */

const fs = require('fs');
const path = require('path');

class TokenAnalytics {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.requests = [];
    this.endpointStats = new Map();
    this.sessionStart = Date.now();
  }

  /**
   * Record a request and its token usage.
   * @param {string} endpoint - Service name: 'snippet', 'signature', 'outline', 'callers', 'compose', 'diff'
   * @param {object} metrics - { inputTokens, outputTokens, baselineTokens, file, symbol }
   */
  recordRequest(endpoint, metrics) {
    const { inputTokens = 0, outputTokens = 0, baselineTokens = 0, file = null, symbol = null } = metrics;

    const record = {
      endpoint,
      timestamp: Date.now(),
      inputTokens,
      outputTokens,
      baselineTokens,
      savedTokens: baselineTokens - outputTokens,
      reductionPct: baselineTokens > 0 ? Math.round((1 - outputTokens / baselineTokens) * 100) : 0,
      file,
      symbol,
    };

    this.requests.push(record);
    this._updateEndpointStats(endpoint, record);

    return record;
  }

  /**
   * Estimate the token cost of reading an entire file (baseline).
   * @param {string} filePath
   * @returns {number} Estimated tokens for the whole file
   */
  estimateFileTokens(filePath) {
    const resolvedPath = path.isAbsolute(filePath) 
      ? filePath 
      : path.resolve(this.rootDir, filePath);
    
    try {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      return this._countTokens(content);
    } catch (e) {
      return 0;
    }
  }

  /**
   * Estimate tokens for a text string.
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text) {
    return this._countTokens(text);
  }

  /**
   * Get savings stats for a specific endpoint.
   * @param {string} endpoint
   * @returns {object}
   */
  getSavings(endpoint) {
    const stats = this.endpointStats.get(endpoint);
    if (!stats) return { endpoint, requests: 0, avgReduction: 0, totalSaved: 0 };
    return { endpoint, ...stats };
  }

  /**
   * Get overall analytics report.
   * @returns {object}
   */
  getReport() {
    const totalRequests = this.requests.length;
    const totalOutputTokens = this.requests.reduce((sum, r) => sum + r.outputTokens, 0);
    const totalBaselineTokens = this.requests.reduce((sum, r) => sum + r.baselineTokens, 0);
    const totalSavedTokens = totalBaselineTokens - totalOutputTokens;
    const overallReduction = totalBaselineTokens > 0 
      ? Math.round((1 - totalOutputTokens / totalBaselineTokens) * 100) 
      : 0;

    const endpointSummary = {};
    for (const [name, stats] of this.endpointStats.entries()) {
      endpointSummary[name] = {
        requests: stats.requests,
        avgOutputTokens: Math.round(stats.totalOutputTokens / stats.requests),
        avgBaselineTokens: Math.round(stats.totalBaselineTokens / stats.requests),
        avgReductionPct: Math.round(stats.totalReductionPct / stats.requests),
        totalSaved: stats.totalSavedTokens,
      };
    }

    const sessionDuration = Date.now() - this.sessionStart;

    return {
      session: {
        startTime: new Date(this.sessionStart).toISOString(),
        durationMs: sessionDuration,
        durationFormatted: this._formatDuration(sessionDuration),
      },
      totals: {
        requests: totalRequests,
        outputTokens: totalOutputTokens,
        baselineTokens: totalBaselineTokens,
        savedTokens: totalSavedTokens,
        overallReductionPct: overallReduction,
      },
      byEndpoint: endpointSummary,
      topSavings: this._getTopSavings(5),
      text: this._formatReport(totalRequests, totalOutputTokens, totalBaselineTokens, overallReduction, endpointSummary),
    };
  }

  /**
   * Get recent request history.
   * @param {number} limit
   * @returns {Array}
   */
  getHistory(limit = 20) {
    return this.requests.slice(-limit);
  }

  /**
   * Reset all analytics data.
   */
  reset() {
    this.requests = [];
    this.endpointStats.clear();
    this.sessionStart = Date.now();
  }

  /**
   * Save analytics report to a JSON file.
   * @returns {string} Path to saved report
   */
  saveReport() {
    const report = this.getReport();
    const reportsDir = path.join(this.rootDir, 'tools', 'code-analyzer', 'reports');
    
    try { fs.mkdirSync(reportsDir, { recursive: true }); } catch (e) { /* ok */ }
    
    const reportPath = path.join(reportsDir, 'token-analytics.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return reportPath;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _updateEndpointStats(endpoint, record) {
    if (!this.endpointStats.has(endpoint)) {
      this.endpointStats.set(endpoint, {
        requests: 0,
        totalOutputTokens: 0,
        totalBaselineTokens: 0,
        totalSavedTokens: 0,
        totalReductionPct: 0,
        maxReduction: 0,
        minReduction: 100,
      });
    }

    const stats = this.endpointStats.get(endpoint);
    stats.requests++;
    stats.totalOutputTokens += record.outputTokens;
    stats.totalBaselineTokens += record.baselineTokens;
    stats.totalSavedTokens += record.savedTokens;
    stats.totalReductionPct += record.reductionPct;
    stats.maxReduction = Math.max(stats.maxReduction, record.reductionPct);
    stats.minReduction = Math.min(stats.minReduction, record.reductionPct);
  }

  _countTokens(text) {
    if (!text) return 0;
    // Approximation: ~4 characters per token for code (slightly more generous than prose)
    // This matches common tokenizer behavior for code content
    return Math.ceil(text.length / 4);
  }

  _getTopSavings(limit) {
    return [...this.requests]
      .sort((a, b) => b.savedTokens - a.savedTokens)
      .slice(0, limit)
      .map(r => ({
        endpoint: r.endpoint,
        file: r.file,
        symbol: r.symbol,
        saved: r.savedTokens,
        reduction: `${r.reductionPct}%`,
      }));
  }

  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  _formatReport(totalReqs, outputTokens, baselineTokens, reduction, byEndpoint) {
    const lines = [
      `Token Analytics Report`,
      `═══════════════════════`,
      `Total Requests:    ${totalReqs}`,
      `Output Tokens:     ${outputTokens.toLocaleString()}`,
      `Baseline Tokens:   ${baselineTokens.toLocaleString()}`,
      `Tokens Saved:      ${(baselineTokens - outputTokens).toLocaleString()}`,
      `Overall Reduction: ${reduction}%`,
      ``,
      `By Endpoint:`,
    ];

    for (const [name, stats] of Object.entries(byEndpoint)) {
      lines.push(`  ${name.padEnd(12)} ${stats.requests} reqs, avg ${stats.avgReductionPct}% reduction, saved ${stats.totalSaved} tokens`);
    }

    return lines.join('\n');
  }
}

module.exports = { TokenAnalytics };

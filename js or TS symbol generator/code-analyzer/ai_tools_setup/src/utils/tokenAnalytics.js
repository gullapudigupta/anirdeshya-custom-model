// src/utils/tokenAnalytics.js
//
// Token-reduction analytics middleware + in-process store.
// Measures response size vs "whole-file baseline" for each endpoint.

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const BASELINE_TOKENS = {
  '/search':          3750,
  '/symbols':         3750,
  '/snippet':         3750,
  '/signature':       3750,
  '/outline':         3750,
  '/callers':         3750,
  '/diff-context':   15000,
  '/ast-node':        3750,
  '/compose-context': 3750,
};

function estimateTokens(data) {
  if (data === null || data === undefined) return 0;
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return Math.ceil(str.length / 4);
}

const stats = {
  totalRequests: 0,
  totalActualTokens: 0,
  totalBaselineTokens: 0,
  totalTokensSaved: 0,
  byEndpoint: {},
  reductions: [],
};

const MAX_RECENT = 200;

function recordReduction(endpoint, method, actualTokens, baselineTokens, query) {
  const saved = Math.max(0, baselineTokens - actualTokens);
  const reductionPct = baselineTokens > 0
    ? Math.round((saved / baselineTokens) * 100)
    : 0;

  stats.totalRequests++;
  stats.totalActualTokens += actualTokens;
  stats.totalBaselineTokens += baselineTokens;
  stats.totalTokensSaved += saved;

  if (!stats.byEndpoint[endpoint]) {
    stats.byEndpoint[endpoint] = { requests: 0, actualTokens: 0, baselineTokens: 0, tokensSaved: 0 };
  }
  const ep = stats.byEndpoint[endpoint];
  ep.requests++;
  ep.actualTokens += actualTokens;
  ep.baselineTokens += baselineTokens;
  ep.tokensSaved += saved;

  const record = {
    ts: new Date().toISOString(),
    endpoint, method, query: query || null,
    actualTokens, baselineTokens, tokensSaved: saved, reductionPct,
  };
  stats.reductions.push(record);
  if (stats.reductions.length > MAX_RECENT) stats.reductions.shift();

  try {
    const logFile = path.join(__dirname, '../../logs/token-analytics.jsonl');
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf-8');
  } catch (_) { /* non-fatal */ }

  logger.info('Token reduction', { endpoint, actualTokens, baselineTokens, tokensSaved: saved, reductionPct: `${reductionPct}%` });
  return record;
}

function tokenAnalyticsMiddleware(req, res, next) {
  const endpoint = req.path;
  const baseline = BASELINE_TOKENS[endpoint];
  if (!baseline) return next();

  const originalJson = res.json.bind(res);
  res.json = function(body) {
    try {
      const actualTokens = estimateTokens(body);
      const query = req.query.q || req.query.query || req.query.name || req.query.file || req.body?.query || endpoint;
      recordReduction(endpoint, req.method, actualTokens, baseline, query);
    } catch (_) { /* never break the response */ }
    return originalJson(body);
  };
  next();
}

function getAnalyticsSummary() {
  const overallReductionPct = stats.totalBaselineTokens > 0
    ? Math.round((stats.totalTokensSaved / stats.totalBaselineTokens) * 100) : 0;

  const byEndpointSummary = {};
  for (const [ep, epStats] of Object.entries(stats.byEndpoint)) {
    const pct = epStats.baselineTokens > 0
      ? Math.round((epStats.tokensSaved / epStats.baselineTokens) * 100) : 0;
    byEndpointSummary[ep] = {
      ...epStats,
      avgActualTokens: epStats.requests > 0 ? Math.round(epStats.actualTokens / epStats.requests) : 0,
      avgBaselineTokens: epStats.requests > 0 ? Math.round(epStats.baselineTokens / epStats.requests) : 0,
      reductionPct: `${pct}%`,
    };
  }

  return {
    summary: {
      totalRequests: stats.totalRequests,
      totalActualTokens: stats.totalActualTokens,
      totalBaselineTokens: stats.totalBaselineTokens,
      totalTokensSaved: stats.totalTokensSaved,
      overallReductionPct: `${overallReductionPct}%`,
      avgTokensPerRequest: stats.totalRequests > 0 ? Math.round(stats.totalActualTokens / stats.totalRequests) : 0,
      avgBaselinePerRequest: stats.totalRequests > 0 ? Math.round(stats.totalBaselineTokens / stats.totalRequests) : 0,
    },
    byEndpoint: byEndpointSummary,
    baselines: Object.fromEntries(Object.entries(BASELINE_TOKENS)),
    recent: stats.reductions.slice(-20),
  };
}

module.exports = { tokenAnalyticsMiddleware, getAnalyticsSummary, recordReduction, estimateTokens };

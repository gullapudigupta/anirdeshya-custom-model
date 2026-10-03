/**
 * Extension configuration (P3-T006)
 *
 * `normalizeConfig(raw)` turns a raw `advancedQualityTool.*` settings object
 * (as returned by `vscode.workspace.getConfiguration('advancedQualityTool')`)
 * into a validated, fully-defaulted config. Kept free of the `vscode` module so
 * it can be unit-tested directly.
 *
 * @module extension/lib/config
 */

const KNOWN_LINTERS = ['eslint', 'typescript-eslint', 'prettier', 'stylelint'];
const FIX_STRATEGIES = ['rule-only', 'ai-only', 'three-tier'];
const SEVERITIES = ['CRITICAL', 'ERROR', 'WARNING', 'INFO', 'SUGGESTION'];

const DEFAULTS = {
  enable: true,
  runOnSave: false,
  linters: [], // empty => all available
  fixStrategy: 'rule-only',
  minConfidence: 0.7,
  backup: true,
  severityFloor: 'SUGGESTION'
};

/**
 * Clamp a number into [min, max]; fall back to `fallback` when not finite.
 */
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/**
 * Normalize raw settings into a safe config object.
 *
 * @param {object} [raw]
 * @returns {{enable:boolean,runOnSave:boolean,linters:string[],fixStrategy:string,minConfidence:number,backup:boolean,severityFloor:string}}
 */
function normalizeConfig(raw = {}) {
  const linters = Array.isArray(raw.linters)
    ? raw.linters.filter((l) => KNOWN_LINTERS.includes(l))
    : DEFAULTS.linters.slice();

  return {
    enable: toBool(raw.enable, DEFAULTS.enable),
    runOnSave: toBool(raw.runOnSave, DEFAULTS.runOnSave),
    linters,
    fixStrategy: oneOf(raw.fixStrategy, FIX_STRATEGIES, DEFAULTS.fixStrategy),
    minConfidence: clampNumber(raw.minConfidence, 0, 1, DEFAULTS.minConfidence),
    backup: toBool(raw.backup, DEFAULTS.backup),
    severityFloor: oneOf(raw.severityFloor, SEVERITIES, DEFAULTS.severityFloor)
  };
}

/**
 * Rank of a severity for floor comparisons. Higher = more severe.
 */
function severityRank(severity) {
  const idx = SEVERITIES.indexOf(severity);
  // SEVERITIES is ordered most->least severe; invert so CRITICAL is highest.
  return idx === -1 ? 0 : SEVERITIES.length - idx;
}

/**
 * True when `severity` is at or above the configured floor.
 */
function meetsSeverityFloor(severity, floor) {
  return severityRank(severity) >= severityRank(floor);
}

module.exports = {
  normalizeConfig,
  meetsSeverityFloor,
  severityRank,
  DEFAULTS,
  KNOWN_LINTERS,
  FIX_STRATEGIES,
  SEVERITIES
};

/**
 * Coverage Integrator
 *
 * Integrates Istanbul/NYC coverage reports (JSON summary and full JSON)
 * and highlights uncovered code by file and line.
 *
 * Inspired by: SonarQube code coverage
 *
 * @module integrations/coverage-integrator
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/** Coverage thresholds — override via options */
const DEFAULT_THRESHOLDS = {
  statements: 80,
  branches: 75,
  functions: 80,
  lines: 80
};

class CoverageIntegrator {
  /**
   * @param {object} [options={}]
   * @param {string} [options.coverageDir='.coverage'] - Directory holding coverage output
   * @param {object} [options.thresholds] - Minimum coverage percentages
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.coverageDir = options.coverageDir || path.join(process.cwd(), 'coverage');
    this.thresholds = Object.assign({}, DEFAULT_THRESHOLDS, options.thresholds || {});
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Load the latest coverage report.
   * Looks for coverage/coverage-summary.json (NYC) or coverage/lcov.info.
   * @returns {{ loaded: boolean, source: string, report: object|null, error: string|null }}
   */
  loadReport() {
    const summaryPath = path.join(this.coverageDir, 'coverage-summary.json');
    const finalPath = path.join(this.coverageDir, 'coverage-final.json');

    if (fs.existsSync(summaryPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
        this._log(`Loaded coverage summary from ${summaryPath}`);
        return { loaded: true, source: 'coverage-summary.json', report: raw, error: null };
      } catch (e) {
        return { loaded: false, source: summaryPath, report: null, error: e.message };
      }
    }

    if (fs.existsSync(finalPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
        const summary = this._buildSummaryFromFinal(raw);
        this._log(`Loaded coverage-final.json and built summary`);
        return { loaded: true, source: 'coverage-final.json', report: summary, error: null };
      } catch (e) {
        return { loaded: false, source: finalPath, report: null, error: e.message };
      }
    }

    return {
      loaded: false,
      source: null,
      report: null,
      error: `No coverage report found in ${this.coverageDir}. Run your test suite with --coverage first.`
    };
  }

  /**
   * Run NYC (Istanbul) coverage and capture results.
   * @param {string} [testCommand='node test/run.js'] - The test command to instrument
   * @param {string} [cwd=process.cwd()]
   * @returns {{ success: boolean, stdout: string, stderr: string }}
   */
  runCoverage(testCommand = 'node test/run.js', cwd = process.cwd()) {
    const cmd = `npx nyc --reporter=json-summary --reporter=json ${testCommand}`;
    this._log(`Running: ${cmd}`);
    try {
      const stdout = execSync(cmd, { cwd, timeout: 120000, encoding: 'utf8' });
      return { success: true, stdout, stderr: '' };
    } catch (err) {
      return { success: false, stdout: err.stdout || '', stderr: err.stderr || err.message };
    }
  }

  /**
   * Get per-file coverage issues (files below threshold).
   * @param {object} summaryReport - The coverage-summary.json object
   * @returns {object[]} Array of coverage issue objects
   */
  getIssues(summaryReport) {
    const issues = [];

    for (const [filePath, metrics] of Object.entries(summaryReport)) {
      if (filePath === 'total') continue;

      const checks = ['statements', 'branches', 'functions', 'lines'];
      for (const check of checks) {
        const pct = metrics[check] && metrics[check].pct != null ? metrics[check].pct : null;
        if (pct === null) continue;
        if (pct < this.thresholds[check]) {
          issues.push({
            type: 'coverage',
            filePath: filePath.replace(/\\/g, '/'),
            severity: pct < this.thresholds[check] - 20 ? 'HIGH' : 'MEDIUM',
            category: check,
            actual: pct,
            threshold: this.thresholds[check],
            message: `${check} coverage ${pct.toFixed(1)}% is below threshold ${this.thresholds[check]}%.`,
            suggestion: `Add tests to cover ${check} in ${path.basename(filePath)}.`,
            uncovered: metrics[check].uncovered || 0
          });
        }
      }
    }

    return issues;
  }

  /**
   * Get the total (aggregate) coverage summary.
   * @param {object} summaryReport
   * @returns {{ statements: number, branches: number, functions: number, lines: number, passes: boolean }}
   */
  getTotals(summaryReport) {
    const total = summaryReport.total || {};
    const totals = {};
    const categories = ['statements', 'branches', 'functions', 'lines'];

    let passes = true;
    for (const cat of categories) {
      const pct = total[cat] && total[cat].pct != null ? total[cat].pct : null;
      totals[cat] = pct;
      if (pct !== null && pct < this.thresholds[cat]) passes = false;
    }

    return { ...totals, passes };
  }

  /**
   * Get uncovered line ranges from coverage-final.json (detailed).
   * @param {string} filePath - Absolute or relative path to target file
   * @returns {{ uncoveredLines: number[], uncoveredBranches: number[] }}
   */
  getUncoveredLines(filePath) {
    const finalPath = path.join(this.coverageDir, 'coverage-final.json');
    if (!fs.existsSync(finalPath)) {
      return { uncoveredLines: [], uncoveredBranches: [] };
    }

    try {
      const raw = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
      // Normalize paths for lookup
      const key = Object.keys(raw).find(k =>
        path.resolve(k) === path.resolve(filePath) ||
        k.endsWith(filePath.replace(/\\/g, '/'))
      );

      if (!key) return { uncoveredLines: [], uncoveredBranches: [] };

      const fileData = raw[key];
      const uncoveredLines = Object.entries(fileData.s || {})
        .filter(([, count]) => count === 0)
        .map(([idx]) => {
          const stmt = fileData.statementMap && fileData.statementMap[idx];
          return stmt ? stmt.start.line : null;
        })
        .filter(Boolean);

      const uncoveredBranches = Object.entries(fileData.b || {})
        .filter(([, counts]) => counts.some(c => c === 0))
        .map(([idx]) => {
          const branch = fileData.branchMap && fileData.branchMap[idx];
          return branch ? branch.loc.start.line : null;
        })
        .filter(Boolean);

      return {
        uncoveredLines: [...new Set(uncoveredLines)].sort((a, b) => a - b),
        uncoveredBranches: [...new Set(uncoveredBranches)].sort((a, b) => a - b)
      };
    } catch {
      return { uncoveredLines: [], uncoveredBranches: [] };
    }
  }

  /**
   * Generate a human-readable coverage report.
   * @param {object} summaryReport
   * @returns {string}
   */
  generateReport(summaryReport) {
    const totals = this.getTotals(summaryReport);
    const issues = this.getIssues(summaryReport);

    const lines = [
      '# Coverage Report',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Totals',
      `- Statements : ${totals.statements != null ? totals.statements.toFixed(1) + '%' : 'N/A'}`,
      `- Branches   : ${totals.branches != null ? totals.branches.toFixed(1) + '%' : 'N/A'}`,
      `- Functions  : ${totals.functions != null ? totals.functions.toFixed(1) + '%' : 'N/A'}`,
      `- Lines      : ${totals.lines != null ? totals.lines.toFixed(1) + '%' : 'N/A'}`,
      `- Status     : ${totals.passes ? '✅ PASS' : '❌ FAIL'}`,
      ''
    ];

    if (issues.length > 0) {
      lines.push('## Files Below Threshold');
      const byFile = {};
      for (const issue of issues) {
        if (!byFile[issue.filePath]) byFile[issue.filePath] = [];
        byFile[issue.filePath].push(issue);
      }
      for (const [fp, fileIssues] of Object.entries(byFile)) {
        lines.push(`\n### ${fp}`);
        for (const i of fileIssues) {
          lines.push(`  - ${i.category}: ${i.actual.toFixed(1)}% (threshold: ${i.threshold}%)`);
        }
      }
    } else {
      lines.push('## All files meet coverage thresholds ✅');
    }

    return lines.join('\n');
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Build a summary-format object from coverage-final.json */
  _buildSummaryFromFinal(finalData) {
    const summary = {};
    const totals = { statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
                     branches:   { total: 0, covered: 0, skipped: 0, pct: 0 },
                     functions:  { total: 0, covered: 0, skipped: 0, pct: 0 },
                     lines:      { total: 0, covered: 0, skipped: 0, pct: 0 } };

    for (const [filePath, data] of Object.entries(finalData)) {
      const stmts   = Object.values(data.s || {});
      const branches = Object.values(data.b || {}).flat();
      const funcs   = Object.values(data.f || {});
      const lineHits = Object.values(data.l || {});

      const calc = (arr) => {
        const total   = arr.length;
        const covered = arr.filter(c => c > 0).length;
        return { total, covered, skipped: 0, pct: total ? (covered / total) * 100 : 100 };
      };

      summary[filePath] = {
        statements: calc(stmts),
        branches:   calc(branches),
        functions:  calc(funcs),
        lines:      calc(lineHits)
      };

      for (const key of ['statements', 'branches', 'functions', 'lines']) {
        totals[key].total   += summary[filePath][key].total;
        totals[key].covered += summary[filePath][key].covered;
      }
    }

    for (const key of Object.keys(totals)) {
      totals[key].pct = totals[key].total
        ? (totals[key].covered / totals[key].total) * 100
        : 100;
    }

    summary.total = totals;
    return summary;
  }

  _log(msg) {
    if (this.verbose) console.log(`[CoverageIntegrator] ${msg}`);
  }
}

module.exports = { CoverageIntegrator, DEFAULT_THRESHOLDS };

/**
 * Reporter — Aggregates all analysis results into formatted reports
 * 
 * Output formats:
 * - Console (colored terminal output)
 * - JSON (machine-readable)
 * - Summary (condensed overview)
 */

const fs = require('fs');
const path = require('path');

// ─── Colors ──────────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

const SEVERITY_COLORS = {
  blocker: c.bgRed + c.white,
  critical: c.red,
  major: c.yellow,
  minor: c.cyan,
  info: c.dim,
};

const SEVERITY_ICONS = {
  blocker: '🚨',
  critical: '❌',
  major: '⚠️',
  minor: 'ℹ️',
  info: '💡',
};

const RATING_COLORS = {
  A: c.green,
  B: c.green,
  C: c.yellow,
  D: c.red,
  E: c.bgRed + c.white,
};

// ─── Reporter ────────────────────────────────────────────────────────────────

class Reporter {
  constructor(outputDir) {
    this.outputDir = outputDir || path.join(process.cwd(), 'tools', 'code-analyzer', 'reports');
  }

  /**
   * Print full console report
   */
  printConsoleReport(results) {
    this._printHeader();
    this._printProjectOverview(results);
    this._printQualityGate(results.qualityGate);
    this._printRatings(results);
    this._printIssueSummary(results);
    this._printTopIssues(results);
    this._printSymbolStats(results.symbols);
    this._printMetrics(results);
    this._printFooter(results);
  }

  /**
   * Print condensed summary
   */
  printSummary(results) {
    this._printHeader();
    this._printQualityGate(results.qualityGate);
    this._printRatings(results);
    console.log(`\n  ${c.dim}Run with --verbose for full report${c.reset}\n`);
  }

  /**
   * Save JSON report
   */
  saveJsonReport(results, filename = 'analysis-report.json') {
    const outputPath = path.join(this.outputDir, filename);
    
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    return outputPath;
  }

  // ─── Private Print Methods ─────────────────────────────────────────────────

  _printHeader() {
    console.log('');
    console.log(`${c.magenta}${c.bold}╔══════════════════════════════════════════════════════════════╗${c.reset}`);
    console.log(`${c.magenta}${c.bold}║     🕉️  PARIKRAMA CODE ANALYZER — Analysis Report          ║${c.reset}`);
    console.log(`${c.magenta}${c.bold}╚══════════════════════════════════════════════════════════════╝${c.reset}`);
    console.log('');
  }

  _printProjectOverview(results) {
    console.log(`  ${c.bold}Project Overview${c.reset}`);
    console.log(`  ${'─'.repeat(55)}`);
    console.log(`  Files analyzed:     ${c.cyan}${results.filesAnalyzed || 0}${c.reset}`);
    console.log(`  Lines of code:      ${c.cyan}${results.totalLines || 0}${c.reset}`);
    console.log(`  TypeScript files:   ${results.tsFiles || 0}`);
    console.log(`  HTML templates:     ${results.htmlFiles || 0}`);
    console.log(`  SCSS/CSS files:     ${results.scssFiles || 0}`);
    console.log(`  Analysis time:      ${results.duration || '?'}ms`);
    console.log('');
  }

  _printQualityGate(gateResult) {
    if (!gateResult) return;
    
    const statusColor = gateResult.status === 'PASSED' ? c.bgGreen : c.bgRed;
    const statusIcon = gateResult.status === 'PASSED' ? '✓ PASSED' : '✗ FAILED';
    
    console.log(`  ${c.bold}Quality Gate: ${gateResult.gateName}${c.reset}`);
    console.log(`  ${'─'.repeat(55)}`);
    console.log(`  Status: ${statusColor}${c.bold} ${statusIcon} ${c.reset}`);
    console.log('');
    
    if (gateResult.failedConditions && gateResult.failedConditions.length > 0) {
      console.log(`  ${c.red}Failed conditions:${c.reset}`);
      for (const cond of gateResult.failedConditions) {
        console.log(`    ${c.red}✗${c.reset} ${cond.metric}: ${cond.actualValue} (threshold: ${cond.operator} ${cond.threshold})`);
      }
      console.log('');
    }
    
    console.log(`  Conditions: ${c.green}${gateResult.summary?.passed || 0} passed${c.reset}, ${c.red}${gateResult.summary?.failed || 0} failed${c.reset}, ${c.dim}${gateResult.summary?.skipped || 0} skipped${c.reset}`);
    console.log('');
  }

  _printRatings(results) {
    console.log(`  ${c.bold}Ratings${c.reset}`);
    console.log(`  ${'─'.repeat(55)}`);
    
    const ratings = [
      { label: 'Reliability', value: results.reliabilityRating || 'N/A' },
      { label: 'Security', value: results.securityRating || 'N/A' },
      { label: 'Maintainability', value: results.maintainabilityRating || 'N/A' },
    ];
    
    for (const rating of ratings) {
      const color = RATING_COLORS[rating.value] || c.dim;
      console.log(`  ${rating.label.padEnd(20)} ${color}${c.bold}${rating.value}${c.reset}`);
    }
    console.log('');
  }

  _printIssueSummary(results) {
    const allIssues = results.allIssues || [];
    
    console.log(`  ${c.bold}Issue Summary${c.reset}`);
    console.log(`  ${'─'.repeat(55)}`);
    
    const bySeverity = {};
    for (const issue of allIssues) {
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }
    
    const severityOrder = ['blocker', 'critical', 'major', 'minor', 'info'];
    for (const sev of severityOrder) {
      const count = bySeverity[sev] || 0;
      const color = SEVERITY_COLORS[sev] || c.dim;
      const icon = SEVERITY_ICONS[sev] || '•';
      console.log(`  ${icon} ${color}${sev.padEnd(12)}${c.reset} ${count}`);
    }
    
    console.log(`  ${'─'.repeat(30)}`);
    console.log(`  Total issues:      ${c.bold}${allIssues.length}${c.reset}`);
    
    if (results.technicalDebt) {
      console.log(`  Technical debt:    ${c.yellow}${results.technicalDebt}${c.reset}`);
    }
    console.log('');
  }

  _printTopIssues(results, limit = 10) {
    const allIssues = results.allIssues || [];
    if (allIssues.length === 0) return;
    
    // Sort by severity
    const severityWeight = { blocker: 5, critical: 4, major: 3, minor: 2, info: 1 };
    const sorted = [...allIssues].sort((a, b) => 
      (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0)
    );
    
    console.log(`  ${c.bold}Top Issues (${Math.min(limit, sorted.length)} of ${sorted.length})${c.reset}`);
    console.log(`  ${'─'.repeat(55)}`);
    
    for (let i = 0; i < Math.min(limit, sorted.length); i++) {
      const issue = sorted[i];
      const color = SEVERITY_COLORS[issue.severity] || c.dim;
      const icon = SEVERITY_ICONS[issue.severity] || '•';
      const file = issue.file ? `${c.dim}${issue.file}${issue.line ? `:${issue.line}` : ''}${c.reset}` : '';
      console.log(`  ${icon} ${color}[${issue.severity}]${c.reset} ${issue.title}`);
      if (file) console.log(`     ${file}`);
    }
    console.log('');
  }

  _printSymbolStats(symbolStats) {
    if (!symbolStats) return;
    
    console.log(`  ${c.bold}Symbol Statistics${c.reset}`);
    console.log(`  ${'─'.repeat(55)}`);
    
    const stats = symbolStats.byType || {};
    const order = ['component', 'service', 'module', 'pipe', 'directive', 'interface', 'enum', 'function', 'class'];
    
    for (const type of order) {
      if (stats[type]) {
        console.log(`  ${type.padEnd(15)} ${c.cyan}${stats[type]}${c.reset}`);
      }
    }
    
    console.log(`  ${'─'.repeat(30)}`);
    console.log(`  Total symbols:     ${c.bold}${symbolStats.totalSymbols || 0}${c.reset}`);
    console.log('');
  }

  _printMetrics(results) {
    if (!results.complexity) return;
    
    console.log(`  ${c.bold}Complexity Metrics${c.reset}`);
    console.log(`  ${'─'.repeat(55)}`);
    console.log(`  Max cyclomatic:    ${results.complexity.maxCyclomatic || 0}`);
    console.log(`  Max cognitive:     ${results.complexity.maxCognitive || 0}`);
    console.log(`  Avg maintainability: ${results.complexity.avgMaintainability || 'N/A'}`);
    console.log('');
  }

  _printFooter(results) {
    console.log(`  ${c.dim}${'─'.repeat(55)}${c.reset}`);
    console.log(`  ${c.dim}Analysis completed at ${new Date().toISOString()}${c.reset}`);
    console.log(`  ${c.dim}Report saved to: tools/code-analyzer/reports/${c.reset}`);
    console.log('');
  }
}

module.exports = { Reporter };

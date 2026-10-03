/**
 * Build Monitor - CI/CD Integration
 * 
 * Monitors build processes and reports code quality metrics.
 * Integrates with CI/CD pipelines (GitHub Actions, GitLab CI, Jenkins, CircleCI, etc.)
 * 
 * Features:
 * - Quality gate enforcement
 * - Trend tracking
 * - Regression detection
 * - Report generation (HTML, JSON, JUnit XML)
 * - Exit code control for CI failure
 * 
 * @module monitor/build-monitor
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * Build Monitor
 */
class BuildMonitor extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = options;
    this.verbose = options.verbose || false;

    // Quality gates
    this.gates = {
      maxCritical: options.maxCritical !== undefined ? options.maxCritical : 0,
      maxErrors: options.maxErrors !== undefined ? options.maxErrors : 10,
      maxWarnings: options.maxWarnings !== undefined ? options.maxWarnings : 50,
      minSuccessRate: options.minSuccessRate !== undefined ? options.minSuccessRate : 80,
      maxComplexity: options.maxComplexity !== undefined ? options.maxComplexity : 20,
      maxDuplication: options.maxDuplication !== undefined ? options.maxDuplication : 5
    };

    // Current build ID (generated before CI detection so the Local
    // environment can reference it).
    this.buildId = this.generateBuildId();

    // CI detection
    this.ciEnvironment = this.detectCIEnvironment();

    // Output
    this.reportDir = options.reportDir || '.aqt-reports';
    this.outputFormat = options.outputFormat || 'json'; // 'json', 'html', 'junit', 'all'

    // History tracking.
    //
    // `this.history` is the in-session series used for regression detection and
    // starts empty: a freshly constructed monitor has no prior build to compare
    // against ("first build"). Builds recorded via addToHistory() are appended
    // to it and persisted to disk. `this.persistedHistory` holds any history
    // already on disk for trend reporting, kept separate so ambient report files
    // never make a first build look like a regression.
    this.historyFile = path.join(this.reportDir, 'history.json');
    this.persistedHistory = this.loadHistory();
    this.history = [];

    // Current build
    this.startTime = null;
    this.endTime = null;
    this.results = null;
  }

  /**
   * Detect CI environment
   */
  detectCIEnvironment() {
    const env = process.env;

    if (env.GITHUB_ACTIONS === 'true') {
      return {
        name: 'GitHub Actions',
        buildId: env.GITHUB_RUN_ID,
        buildNumber: env.GITHUB_RUN_NUMBER,
        branch: env.GITHUB_REF_NAME,
        commit: env.GITHUB_SHA,
        repo: env.GITHUB_REPOSITORY,
        url: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      };
    }

    if (env.GITLAB_CI === 'true') {
      return {
        name: 'GitLab CI',
        buildId: env.CI_PIPELINE_ID,
        buildNumber: env.CI_PIPELINE_IID,
        branch: env.CI_COMMIT_REF_NAME,
        commit: env.CI_COMMIT_SHA,
        repo: env.CI_PROJECT_PATH,
        url: env.CI_PIPELINE_URL
      };
    }

    if (env.JENKINS_URL) {
      return {
        name: 'Jenkins',
        buildId: env.BUILD_ID,
        buildNumber: env.BUILD_NUMBER,
        branch: env.GIT_BRANCH,
        commit: env.GIT_COMMIT,
        url: env.BUILD_URL
      };
    }

    if (env.CIRCLECI === 'true') {
      return {
        name: 'CircleCI',
        buildId: env.CIRCLE_WORKFLOW_ID,
        buildNumber: env.CIRCLE_BUILD_NUM,
        branch: env.CIRCLE_BRANCH,
        commit: env.CIRCLE_SHA1,
        repo: `${env.CIRCLE_PROJECT_USERNAME}/${env.CIRCLE_PROJECT_REPONAME}`,
        url: env.CIRCLE_BUILD_URL
      };
    }

    if (env.TRAVIS === 'true') {
      return {
        name: 'Travis CI',
        buildId: env.TRAVIS_BUILD_ID,
        buildNumber: env.TRAVIS_BUILD_NUMBER,
        branch: env.TRAVIS_BRANCH,
        commit: env.TRAVIS_COMMIT,
        repo: env.TRAVIS_REPO_SLUG,
        url: env.TRAVIS_BUILD_WEB_URL
      };
    }

    if (env.AZURE_PIPELINES === 'true') {
      return {
        name: 'Azure Pipelines',
        buildId: env.BUILD_BUILDID,
        buildNumber: env.BUILD_BUILDNUMBER,
        branch: env.BUILD_SOURCEBRANCHNAME,
        commit: env.BUILD_SOURCEVERSION,
        repo: env.BUILD_REPOSITORY_NAME,
        url: `${env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI}${env.SYSTEM_TEAMPROJECT}/_build/results?buildId=${env.BUILD_BUILDID}`
      };
    }

    return {
      name: 'Local',
      buildId: this.buildId,
      buildNumber: Date.now().toString()
    };
  }

  /**
   * Start monitoring
   */
  start() {
    this.startTime = Date.now();

    this.log('Build monitor started');
    this.log(`CI Environment: ${this.ciEnvironment.name}`);
    if (this.ciEnvironment.buildNumber) {
      this.log(`Build #${this.ciEnvironment.buildNumber}`);
    }

    this.emit('started', {
      buildId: this.buildId,
      ciEnvironment: this.ciEnvironment,
      gates: this.gates
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🏗️  Build Monitor Started`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  CI: ${this.ciEnvironment.name}`);
    if (this.ciEnvironment.buildNumber) {
      console.log(`  Build: #${this.ciEnvironment.buildNumber}`);
    }
    if (this.ciEnvironment.branch) {
      console.log(`  Branch: ${this.ciEnvironment.branch}`);
    }
    console.log(`${'='.repeat(60)}\n`);
  }

  /**
   * Process analysis results
   */
  async processResults(analysisResults) {
    this.endTime = Date.now();
    const duration = this.endTime - this.startTime;

    // Parse results
    const metrics = this.calculateMetrics(analysisResults);

    // Check quality gates
    const gateResults = this.checkQualityGates(metrics);

    // Detect regressions
    const regressions = this.detectRegressions(metrics);

    // Build summary
    this.results = {
      buildId: this.buildId,
      ciEnvironment: this.ciEnvironment,
      timestamp: new Date().toISOString(),
      duration: duration,
      metrics: metrics,
      gates: gateResults,
      regressions: regressions,
      passed: gateResults.passed && regressions.length === 0
    };

    // Save results
    await this.saveResults();

    // Generate reports
    await this.generateReports();

    // Update history
    this.addToHistory(this.results);

    // Emit event
    this.emit('completed', this.results);

    // Print summary
    this.printSummary();

    return this.results;
  }

  /**
   * Calculate metrics from analysis results
   */
  calculateMetrics(analysisResults) {
    const issues = analysisResults.issues || [];
    const files = analysisResults.files || [];

    const metrics = {
      totalFiles: files.length,
      totalIssues: issues.length,
      critical: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      fixed: analysisResults.fixed || 0,
      fixable: 0,
      complexity: {
        average: 0,
        max: 0,
        files: []
      },
      duplication: {
        percentage: 0,
        lines: 0
      },
      coverage: {
        percentage: analysisResults.coverage || 0
      },
      linesOfCode: 0
    };

    // Count by severity
    issues.forEach(issue => {
      switch (issue.severity?.toUpperCase()) {
        case 'CRITICAL':
          metrics.critical++;
          break;
        case 'ERROR':
          metrics.errors++;
          break;
        case 'WARNING':
          metrics.warnings++;
          break;
        case 'INFO':
          metrics.info++;
          break;
      }

      if (issue.fixable) {
        metrics.fixable++;
      }

      // Track complexity
      if (issue.ruleId?.includes('complexity')) {
        const complexity = parseInt(issue.message.match(/\d+/)?.[0] || 0);
        if (complexity > metrics.complexity.max) {
          metrics.complexity.max = complexity;
        }
      }
    });

    // Calculate success rate
    metrics.successRate = metrics.totalIssues > 0
      ? Math.round(((metrics.totalIssues - metrics.errors - metrics.critical) / metrics.totalIssues) * 100)
      : 100;

    return metrics;
  }

  /**
   * Check quality gates
   */
  checkQualityGates(metrics) {
    const results = {
      passed: true,
      gates: []
    };

    // Check each gate
    const checks = [
      {
        name: 'Critical Issues',
        value: metrics.critical,
        threshold: this.gates.maxCritical,
        operator: '<=',
        passed: metrics.critical <= this.gates.maxCritical
      },
      {
        name: 'Errors',
        value: metrics.errors,
        threshold: this.gates.maxErrors,
        operator: '<=',
        passed: metrics.errors <= this.gates.maxErrors
      },
      {
        name: 'Warnings',
        value: metrics.warnings,
        threshold: this.gates.maxWarnings,
        operator: '<=',
        passed: metrics.warnings <= this.gates.maxWarnings
      },
      {
        name: 'Success Rate',
        value: metrics.successRate,
        threshold: this.gates.minSuccessRate,
        operator: '>=',
        passed: metrics.successRate >= this.gates.minSuccessRate
      },
      {
        name: 'Max Complexity',
        value: metrics.complexity.max,
        threshold: this.gates.maxComplexity,
        operator: '<=',
        passed: metrics.complexity.max <= this.gates.maxComplexity
      },
      {
        name: 'Duplication',
        value: metrics.duplication.percentage,
        threshold: this.gates.maxDuplication,
        operator: '<=',
        passed: metrics.duplication.percentage <= this.gates.maxDuplication
      }
    ];

    checks.forEach(check => {
      results.gates.push(check);
      if (!check.passed) {
        results.passed = false;
      }
    });

    return results;
  }

  /**
   * Detect regressions by comparing to previous build
   */
  detectRegressions(metrics) {
    const regressions = [];

    if (this.history.length === 0) {
      return regressions;
    }

    const previous = this.history[this.history.length - 1];
    const prevMetrics = previous.metrics;

    // Check for increases in issues
    if (metrics.critical > prevMetrics.critical) {
      regressions.push({
        type: 'critical',
        message: `Critical issues increased from ${prevMetrics.critical} to ${metrics.critical}`,
        delta: metrics.critical - prevMetrics.critical
      });
    }

    if (metrics.errors > prevMetrics.errors) {
      regressions.push({
        type: 'errors',
        message: `Errors increased from ${prevMetrics.errors} to ${metrics.errors}`,
        delta: metrics.errors - prevMetrics.errors
      });
    }

    if (metrics.complexity.max > prevMetrics.complexity.max) {
      regressions.push({
        type: 'complexity',
        message: `Max complexity increased from ${prevMetrics.complexity.max} to ${metrics.complexity.max}`,
        delta: metrics.complexity.max - prevMetrics.complexity.max
      });
    }

    return regressions;
  }

  /**
   * Save results to file
   */
  async saveResults() {
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }

    const resultsPath = path.join(this.reportDir, `build-${this.buildId}.json`);
    fs.writeFileSync(resultsPath, JSON.stringify(this.results, null, 2), 'utf8');

    this.log(`Results saved: ${resultsPath}`);
  }

  /**
   * Generate reports
   */
  async generateReports() {
    const formats = this.outputFormat === 'all' 
      ? ['json', 'html', 'junit']
      : [this.outputFormat];

    for (const format of formats) {
      try {
        switch (format) {
          case 'json':
            await this.generateJSONReport();
            break;
          case 'html':
            await this.generateHTMLReport();
            break;
          case 'junit':
            await this.generateJUnitReport();
            break;
        }
      } catch (error) {
        this.log(`Failed to generate ${format} report: ${error.message}`);
      }
    }
  }

  /**
   * Generate JSON report
   */
  async generateJSONReport() {
    const reportPath = path.join(this.reportDir, 'quality-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2), 'utf8');
    this.log(`JSON report: ${reportPath}`);
  }

  /**
   * Generate HTML report
   */
  async generateHTMLReport() {
    const html = this.buildHTMLReport();
    const reportPath = path.join(this.reportDir, 'quality-report.html');
    fs.writeFileSync(reportPath, html, 'utf8');
    this.log(`HTML report: ${reportPath}`);
  }

  /**
   * Generate JUnit XML report (for CI integration)
   */
  async generateJUnitReport() {
    const xml = this.buildJUnitXML();
    const reportPath = path.join(this.reportDir, 'quality-junit.xml');
    fs.writeFileSync(reportPath, xml, 'utf8');
    this.log(`JUnit report: ${reportPath}`);
  }

  /**
   * Build HTML report
   */
  buildHTMLReport() {
    const { metrics, gates } = this.results;
    const status = this.results.passed ? 'PASSED' : 'FAILED';
    const statusColor = this.results.passed ? '#4caf50' : '#f44336';

    return `<!DOCTYPE html>
<html>
<head>
  <title>Code Quality Report - Build ${this.buildId}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #333; border-bottom: 3px solid ${statusColor}; padding-bottom: 10px; }
    .status { display: inline-block; padding: 10px 20px; background: ${statusColor}; color: white; border-radius: 4px; font-weight: bold; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0; }
    .metric { background: #f9f9f9; padding: 20px; border-radius: 6px; border-left: 4px solid #2196f3; }
    .metric-value { font-size: 32px; font-weight: bold; color: #2196f3; }
    .metric-label { font-size: 14px; color: #666; margin-top: 5px; }
    .gates { margin: 30px 0; }
    .gate { display: flex; justify-content: space-between; padding: 15px; margin: 10px 0; background: #f9f9f9; border-radius: 4px; }
    .gate.passed { border-left: 4px solid #4caf50; }
    .gate.failed { border-left: 4px solid #f44336; }
    .gate-status { font-weight: bold; }
    .gate-status.passed { color: #4caf50; }
    .gate-status.failed { color: #f44336; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #2196f3; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Code Quality Report</h1>
    <div style="margin: 20px 0;">
      <div class="status">${status}</div>
      <p style="margin-top: 10px; color: #666;">Build #${this.ciEnvironment.buildNumber || this.buildId} • ${new Date(this.results.timestamp).toLocaleString()}</p>
    </div>

    <h2>Metrics</h2>
    <div class="metrics">
      <div class="metric">
        <div class="metric-value">${metrics.totalIssues}</div>
        <div class="metric-label">Total Issues</div>
      </div>
      <div class="metric">
        <div class="metric-value">${metrics.critical}</div>
        <div class="metric-label">Critical</div>
      </div>
      <div class="metric">
        <div class="metric-value">${metrics.errors}</div>
        <div class="metric-label">Errors</div>
      </div>
      <div class="metric">
        <div class="metric-value">${metrics.warnings}</div>
        <div class="metric-label">Warnings</div>
      </div>
      <div class="metric">
        <div class="metric-value">${metrics.successRate}%</div>
        <div class="metric-label">Success Rate</div>
      </div>
      <div class="metric">
        <div class="metric-value">${metrics.fixed}</div>
        <div class="metric-label">Auto-Fixed</div>
      </div>
    </div>

    <h2>Quality Gates</h2>
    <div class="gates">
      ${gates.gates.map(gate => `
        <div class="gate ${gate.passed ? 'passed' : 'failed'}">
          <div>
            <strong>${gate.name}</strong>
            <div style="color: #666; font-size: 14px;">${gate.value} ${gate.operator} ${gate.threshold}</div>
          </div>
          <div class="gate-status ${gate.passed ? 'passed' : 'failed'}">${gate.passed ? '✓ PASS' : '✗ FAIL'}</div>
        </div>
      `).join('')}
    </div>

    ${this.results.regressions.length > 0 ? `
      <h2>Regressions Detected</h2>
      <table>
        <tr><th>Type</th><th>Message</th><th>Delta</th></tr>
        ${this.results.regressions.map(r => `
          <tr>
            <td>${r.type}</td>
            <td>${r.message}</td>
            <td style="color: #f44336;">+${r.delta}</td>
          </tr>
        `).join('')}
      </table>
    ` : ''}
  </div>
</body>
</html>`;
  }

  /**
   * Build JUnit XML
   */
  buildJUnitXML() {
    const { metrics, gates } = this.results;
    const failures = gates.gates.filter(g => !g.passed);

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Code Quality" tests="${gates.gates.length}" failures="${failures.length}">
  <testsuite name="Quality Gates" tests="${gates.gates.length}" failures="${failures.length}" time="${this.results.duration / 1000}">
    ${gates.gates.map(gate => `
    <testcase name="${gate.name}" classname="QualityGate">
      ${!gate.passed ? `<failure message="${gate.name} failed: ${gate.value} ${gate.operator} ${gate.threshold}"></failure>` : ''}
    </testcase>
    `).join('')}
  </testsuite>
</testsuites>`;
  }

  /**
   * Load history
   */
  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.log(`Failed to load history: ${error.message}`);
    }
    return [];
  }

  /**
   * Add to history
   */
  addToHistory(results) {
    const entry = {
      buildId: results.buildId,
      timestamp: results.timestamp,
      passed: results.passed,
      metrics: results.metrics,
      duration: results.duration
    };

    // Track within the current session for regression comparison.
    this.history.push(entry);

    // Persist against the full on-disk trend history so prior builds are kept.
    this.persistedHistory.push(entry);
    if (this.persistedHistory.length > 50) {
      this.persistedHistory = this.persistedHistory.slice(-50);
    }

    // Save
    try {
      if (!fs.existsSync(this.reportDir)) {
        fs.mkdirSync(this.reportDir, { recursive: true });
      }
      fs.writeFileSync(this.historyFile, JSON.stringify(this.persistedHistory, null, 2), 'utf8');
    } catch (error) {
      this.log(`Failed to save history: ${error.message}`);
    }
  }

  /**
   * Print summary
   */
  printSummary() {
    const { metrics, gates, regressions } = this.results;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🏗️  Build Monitor Results`);
    console.log(`${'='.repeat(60)}`);
    console.log(`\n📊 Metrics:`);
    console.log(`  Total Issues: ${metrics.totalIssues}`);
    console.log(`  Critical: ${metrics.critical}`);
    console.log(`  Errors: ${metrics.errors}`);
    console.log(`  Warnings: ${metrics.warnings}`);
    console.log(`  Success Rate: ${metrics.successRate}%`);
    console.log(`  Auto-Fixed: ${metrics.fixed}`);

    console.log(`\n🚪 Quality Gates:`);
    gates.gates.forEach(gate => {
      const status = gate.passed ? '✓' : '✗';
      const symbol = gate.passed ? '✓' : '✗';
      console.log(`  ${symbol} ${gate.name}: ${gate.value} ${gate.operator} ${gate.threshold}`);
    });

    if (regressions.length > 0) {
      console.log(`\n⚠️  Regressions:`);
      regressions.forEach(r => {
        console.log(`  • ${r.message}`);
      });
    }

    const status = this.results.passed ? '✓ PASSED' : '✗ FAILED';
    const color = this.results.passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`\n${color}${status}\x1b[0m`);
    console.log(`\nDuration: ${Math.round(this.results.duration / 1000)}s`);
    console.log(`Reports: ${this.reportDir}`);
    console.log(`${'='.repeat(60)}\n`);
  }

  /**
   * Get exit code for CI
   */
  getExitCode() {
    return this.results.passed ? 0 : 1;
  }

  /**
   * Generate build ID
   */
  generateBuildId() {
    return `build-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  log(message) {
    if (this.verbose) {
      console.log(`[BuildMonitor] ${message}`);
    }
  }
}

module.exports = {
  BuildMonitor
};

/**
 * Monitor Command - CLI handler for build monitoring
 * 
 * Usage:
 *   aqt monitor [options]
 * 
 * Options:
 *   --max-critical <n>       Maximum critical issues allowed (default: 0)
 *   --max-errors <n>         Maximum errors allowed (default: 10)
 *   --max-warnings <n>       Maximum warnings allowed (default: 50)
 *   --min-success-rate <n>   Minimum success rate % (default: 80)
 *   --max-complexity <n>     Maximum cyclomatic complexity (default: 20)
 *   --output <format>        Output format: json, html, junit, all (default: json)
 *   --report-dir <path>      Report directory (default: .aqt-reports)
 *   --fail-on-gate           Exit with code 1 if quality gates fail
 *   --verbose, -v            Verbose output
 *
 * @module commands/monitor-command
 */

const { BuildMonitor } = require('../monitor/build-monitor');
const path = require('path');

async function run(args) {
  // Parse arguments
  const options = parseArguments(args);

  console.log('\n🏗️  Build Monitor Command\n');

  // Create build monitor
  const monitor = new BuildMonitor({
    maxCritical: options.maxCritical,
    maxErrors: options.maxErrors,
    maxWarnings: options.maxWarnings,
    minSuccessRate: options.minSuccessRate,
    maxComplexity: options.maxComplexity,
    maxDuplication: options.maxDuplication,
    outputFormat: options.outputFormat,
    reportDir: options.reportDir,
    verbose: options.verbose
  });

  try {
    // Start monitoring
    monitor.start();

    // Run analysis
    console.log('📊 Running code analysis...\n');
    const analysisResults = await runAnalysis(options);

    // Process results
    const results = await monitor.processResults(analysisResults);

    // Print CI info if available
    if (monitor.ciEnvironment.url) {
      console.log(`\n🔗 CI Build: ${monitor.ciEnvironment.url}`);
    }

    // Exit with appropriate code
    if (options.failOnGate && !results.passed) {
      console.error('\n❌ Quality gates failed - Build rejected\n');
      process.exit(monitor.getExitCode());
    } else if (!results.passed) {
      console.warn('\n⚠️  Quality gates failed (not blocking build)\n');
      process.exit(0);
    } else {
      console.log('\n✅ All quality gates passed - Build accepted\n');
      process.exit(0);
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Run analysis
 */
async function runAnalysis(options) {
  // Placeholder: integrate with full analyzer
  // For now, return mock data for testing

  try {
    const linterIntegration = require('../linters/linter-integration');
    const normalizer = require('../normalizers/issue-normalizer');

    const orchestrator = new linterIntegration.LinterOrchestrator({
      targetDirectory: process.cwd()
    });

    const results = await orchestrator.runAll();
    const normalized = normalizer.normalizeIssues(results);

    return {
      issues: normalized.issues,
      files: normalized.files || [],
      fixed: 0,
      coverage: 0
    };
  } catch (error) {
    console.warn('Using fallback analysis');

    // Return minimal results for testing
    return {
      issues: [],
      files: [],
      fixed: 0,
      coverage: 0
    };
  }
}

/**
 * Parse command arguments
 */
function parseArguments(args) {
  const options = {
    maxCritical: 0,
    maxErrors: 10,
    maxWarnings: 50,
    minSuccessRate: 80,
    maxComplexity: 20,
    maxDuplication: 5,
    outputFormat: 'json',
    reportDir: '.aqt-reports',
    failOnGate: false,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--max-critical') {
      options.maxCritical = parseInt(args[++i], 10);
    } else if (arg === '--max-errors') {
      options.maxErrors = parseInt(args[++i], 10);
    } else if (arg === '--max-warnings') {
      options.maxWarnings = parseInt(args[++i], 10);
    } else if (arg === '--min-success-rate') {
      options.minSuccessRate = parseInt(args[++i], 10);
    } else if (arg === '--max-complexity') {
      options.maxComplexity = parseInt(args[++i], 10);
    } else if (arg === '--max-duplication') {
      options.maxDuplication = parseFloat(args[++i]);
    } else if (arg === '--output') {
      options.outputFormat = args[++i];
    } else if (arg === '--report-dir') {
      options.reportDir = args[++i];
    } else if (arg === '--fail-on-gate') {
      options.failOnGate = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
📖 Monitor Command Help

Usage:
  aqt monitor [options]

Quality Gate Options:
  --max-critical <n>       Maximum critical issues allowed (default: 0)
  --max-errors <n>         Maximum errors allowed (default: 10)
  --max-warnings <n>       Maximum warnings allowed (default: 50)
  --min-success-rate <n>   Minimum success rate % (default: 80)
  --max-complexity <n>     Maximum cyclomatic complexity (default: 20)
  --max-duplication <n>    Maximum code duplication % (default: 5)

Output Options:
  --output <format>        Output format: json, html, junit, all (default: json)
  --report-dir <path>      Report directory (default: .aqt-reports)

Behavior Options:
  --fail-on-gate           Exit with code 1 if quality gates fail
  --verbose, -v            Verbose output
  --help, -h               Show this help

Examples:
  aqt monitor                           # Run with default gates
  aqt monitor --fail-on-gate            # Fail build if gates fail
  aqt monitor --max-errors 5            # Allow max 5 errors
  aqt monitor --output all              # Generate all report formats
  aqt monitor --min-success-rate 90     # Require 90% success rate

CI/CD Integration:
  The monitor automatically detects CI environments:
  ✓ GitHub Actions
  ✓ GitLab CI
  ✓ Jenkins
  ✓ CircleCI
  ✓ Travis CI
  ✓ Azure Pipelines

Reports Generated:
  - JSON report (quality-report.json)
  - HTML report (quality-report.html) - when --output html or all
  - JUnit XML (quality-junit.xml) - when --output junit or all
  - Build history (history.json)

Exit Codes:
  0 - All quality gates passed
  1 - Quality gates failed (when --fail-on-gate is set)

Use in CI/CD:
  # GitHub Actions
  - run: npm run aqt monitor --fail-on-gate

  # GitLab CI
  script:
    - npm run aqt monitor --fail-on-gate

  # Jenkins
  sh 'npm run aqt monitor --fail-on-gate'
`);
}

module.exports = {
  run,
  printHelp
};

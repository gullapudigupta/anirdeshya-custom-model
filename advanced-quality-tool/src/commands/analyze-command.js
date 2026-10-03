'use strict';
/**
 * aqt analyze - Run full workspace code quality analysis
 *
 * P11-T021: Analyze Command
 */

const path = require('path');
const fs   = require('fs');

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  brightRed: '\x1b[91m'
};

const SEVERITY_COLOR = {
  critical: c.red,
  high:     c.brightRed,
  medium:   c.yellow,
  low:      c.green,
  info:     c.gray
};

// ─── Run ────────────────────────────────────────────────────────────────────

async function run(args) {
  const options = parseOptions(args);
  if (options.help) { printHelp(); return; }

  const workspace = path.resolve(options.workspace || process.cwd());

  console.log(`\n🔬 Analyzing: ${workspace}\n`);
  if (options.files && options.files.length > 0) {
    console.log(`  Files: ${options.files.join(', ')}`);
  }

  try {
    const { SharedAppServices } = require('../core/shared-app-services');
    const services = await SharedAppServices.create({
      projectRoot: workspace,
      verbose: options.verbose
    });

    const analyzeOpts = {};
    if (options.files && options.files.length > 0) analyzeOpts.files = options.files;

    console.log('  Running analysis...\n');
    const result = await services.analyze(analyzeOpts);

    if (!result.success) {
      console.error(`${c.red}❌ Analysis failed: ${result.error}${c.reset}\n`);
      process.exit(1);
    }

    const { issues, issueCount } = result.data;

    // ── format: json ──────────────────────────────────────────────────────────
    if (options.format === 'json') {
      const output = JSON.stringify(
        { issues, issueCount, workspace, timestamp: new Date().toISOString() },
        null, 2
      );
      if (options.output) {
        fs.writeFileSync(options.output, output, 'utf8');
        console.log(`✅ Results written to: ${options.output}\n`);
      } else {
        console.log(output);
      }
      return;
    }

    // ── format: markdown / sarif ─────────────────────────────────────────────
    if (options.format === 'markdown' || options.format === 'sarif') {
      const reportResult = await services.generateReport(result.data, options.format);
      const report = (reportResult.data && reportResult.data.report) ? reportResult.data.report : '';
      if (options.output) {
        fs.writeFileSync(options.output, report, 'utf8');
        console.log(`✅ Report written to: ${options.output}\n`);
      } else {
        console.log(report);
      }
      return;
    }

    // ── format: table (default) ───────────────────────────────────────────────
    displayResults(issues, issueCount, workspace);

    if (options.output) {
      const output = JSON.stringify(
        { issues, issueCount, workspace, timestamp: new Date().toISOString() },
        null, 2
      );
      fs.writeFileSync(options.output, output, 'utf8');
      console.log(`\n📄 Results saved to: ${options.output}`);
    }

    console.log('');

    // Exit code reflects severity
    const critical = issues.filter(i => i.severity === 'critical').length;
    const high     = issues.filter(i => i.severity === 'high').length;
    if (critical > 0) process.exit(2);
    if (high > 0)     process.exit(1);

  } catch (error) {
    console.error(`\n${c.red}❌ Analysis error: ${error.message}${c.reset}\n`);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
}

// ─── Display helpers ─────────────────────────────────────────────────────────

function displayResults(issues, issueCount, workspace) {
  if (!issues || issues.length === 0) {
    console.log(`${c.green}✅ No issues found!${c.reset}\n`);
    return;
  }

  // Breakdown by severity
  const bySeverity = {};
  for (const issue of issues) {
    const sev = issue.severity || 'info';
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
  }

  const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
  console.log(`${c.bold}Found ${issueCount} issue(s):${c.reset}`);
  for (const sev of severityOrder) {
    if (!bySeverity[sev]) continue;
    const col = SEVERITY_COLOR[sev] || c.gray;
    console.log(`  ${col}${sev.padEnd(10)}${c.reset} ${bySeverity[sev]}`);
  }

  // Issue list (capped at 50 for readability)
  console.log(`\n${c.bold}Top Issues:${c.reset}`);
  console.log('─'.repeat(80));

  const displayed = issues.slice(0, 50);
  for (const issue of displayed) {
    const sev  = issue.severity || 'info';
    const col  = SEVERITY_COLOR[sev] || c.gray;
    const file = issue.file
      ? path.relative(workspace, path.resolve(issue.file))
      : '(unknown)';
    const loc  = issue.line ? `:${issue.line}` : '';
    console.log(`  ${col}[${sev.toUpperCase()}]${c.reset} ${file}${loc}`);
    console.log(`         ${issue.message || issue.description || '(no message)'}`);
    if (issue.ruleId) {
      console.log(`         ${c.gray}Rule: ${issue.ruleId}${c.reset}`);
    }
  }

  if (issues.length > 50) {
    console.log(
      `\n  ${c.gray}… and ${issues.length - 50} more. ` +
      `Use ${c.reset}--format json${c.gray} for full output.${c.reset}`
    );
  }
}

// ─── Options parser ──────────────────────────────────────────────────────────

function parseOptions(args) {
  const opts = {
    workspace: null,
    files:     [],
    format:    'table',
    output:    null,
    verbose:   false,
    help:      false
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if      (arg === '--help'    || arg === '-h')  opts.help    = true;
    else if (arg === '--verbose' || arg === '-v')  opts.verbose = true;
    else if ((arg === '--workspace' || arg === '-w') && args[i + 1])
      opts.workspace = args[++i];
    else if ((arg === '--format'    || arg === '-f') && args[i + 1])
      opts.format = args[++i];
    else if ((arg === '--output'    || arg === '-o') && args[i + 1])
      opts.output = args[++i];
    else if (arg === '--files' && args[i + 1])
      opts.files = args[++i].split(',').map(f => f.trim()).filter(Boolean);
    else if (!arg.startsWith('-') && !opts.workspace)
      opts.workspace = arg;
  }
  return opts;
}

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
aqt analyze - Run full workspace code quality analysis

${c.bold}Usage:${c.reset}
  aqt analyze [workspace] [options]

${c.bold}Options:${c.reset}
  --workspace, -w    Project directory (default: current directory)
  --files            Comma-separated list of files to analyze
  --format, -f       Output format: table, json, markdown, sarif (default: table)
  --output, -o       Save report to file
  --verbose, -v      Verbose output
  --help, -h         Show this help

${c.bold}Examples:${c.reset}
  aqt analyze
  aqt analyze --workspace /path/to/project
  aqt analyze --format json --output report.json
  aqt analyze --format sarif --output results.sarif
  aqt analyze --files src/app.js,src/utils.js

${c.bold}Exit Codes:${c.reset}
  0    No issues found
  1    High severity issues found
  2    Critical issues found
`);
}

module.exports = { run };

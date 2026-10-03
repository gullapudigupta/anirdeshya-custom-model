'use strict';
/**
 * aqt categorize - Categorize and classify issues from a JSON input file
 *
 * P11-T023: Categorize Command
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

const SEVERITY_COLORS = {
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

  if (!options.input) {
    console.error(`\n${c.red}❌ Input file required. Use --input <file>${c.reset}\n`);
    printHelp();
    process.exit(1);
  }

  const inputPath = path.resolve(options.input);
  console.log(`\n🏷️  Categorizing issues from: ${inputPath}\n`);

  try {
    // ── Read & parse input ────────────────────────────────────────────────────
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    const raw     = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const issues  = Array.isArray(raw) ? raw : (raw.issues || raw.findings || []);

    if (issues.length === 0) {
      console.log(`${c.yellow}⚠️  No issues found in input file${c.reset}\n`);
      return;
    }

    console.log(`  Input: ${issues.length} issue(s)\n`);

    // ── Categorize ────────────────────────────────────────────────────────────
    const { IssueCategorizationEngine } = require('../core/issue-categorizer');
    const engine     = new IssueCategorizationEngine({ autoEnrich: true });
    const categorized = engine.categorizeAll(issues);

    // ── Output ────────────────────────────────────────────────────────────────
    if (options.format === 'json' || options.json) {
      const output = JSON.stringify(categorized, null, 2);
      if (options.output) {
        fs.writeFileSync(options.output, output, 'utf8');
        console.log(`✅ Categorized output written to: ${options.output}\n`);
      } else {
        console.log(output);
      }
      return;
    }

    // Table display
    displaySummary(categorized);

    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(categorized, null, 2), 'utf8');
      console.log(`\n📄 Full results saved to: ${options.output}`);
    }

    console.log('');

  } catch (error) {
    console.error(`\n${c.red}❌ Categorization failed: ${error.message}${c.reset}\n`);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
}

// ─── Display helpers ─────────────────────────────────────────────────────────

function displaySummary(issues) {
  const bySeverity  = {};
  const byCategory  = {};
  const byAutoFix   = {};
  const byFileType  = {};

  for (const issue of issues) {
    const sev  = issue.severity    || 'info';
    const cat  = issue.category    || 'uncategorized';
    const fix  = issue.autoFixLevel || 'manual';
    const ft   = issue.fileType    || 'unknown';

    bySeverity[sev]  = (bySeverity[sev]  || 0) + 1;
    byCategory[cat]  = (byCategory[cat]  || 0) + 1;
    byAutoFix[fix]   = (byAutoFix[fix]   || 0) + 1;
    byFileType[ft]   = (byFileType[ft]   || 0) + 1;
  }

  console.log(`${c.bold}Categorization Summary${c.reset}`);
  console.log('─'.repeat(50));
  console.log(`  Total: ${issues.length} issues\n`);

  // By Severity
  console.log(`${c.bold}By Severity:${c.reset}`);
  const sevOrder = ['critical', 'high', 'medium', 'low', 'info'];
  for (const sev of sevOrder) {
    if (!bySeverity[sev]) continue;
    const col = SEVERITY_COLORS[sev] || c.gray;
    console.log(`  ${col}${sev.padEnd(12)}${c.reset} ${bySeverity[sev]}`);
  }
  // any unlisted
  for (const [sev, cnt] of Object.entries(bySeverity)) {
    if (!sevOrder.includes(sev)) console.log(`  ${sev.padEnd(12)} ${cnt}`);
  }

  // By Category
  console.log(`\n${c.bold}By Category:${c.reset}`);
  for (const [cat, cnt] of sortedDesc(byCategory)) {
    console.log(`  ${c.cyan}${cat.padEnd(22)}${c.reset} ${cnt}`);
  }

  // By Auto-Fix Level
  console.log(`\n${c.bold}By Auto-Fix Level:${c.reset}`);
  for (const [level, cnt] of sortedDesc(byAutoFix)) {
    console.log(`  ${level.padEnd(18)} ${cnt}`);
  }

  // By File Type (condensed)
  const ftEntries = sortedDesc(byFileType).slice(0, 8);
  if (ftEntries.length > 0) {
    console.log(`\n${c.bold}By File Type (top 8):${c.reset}`);
    for (const [ft, cnt] of ftEntries) {
      console.log(`  ${ft.padEnd(18)} ${cnt}`);
    }
  }
}

function sortedDesc(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

// ─── Options parser ──────────────────────────────────────────────────────────

function parseOptions(args) {
  const opts = {
    input:   null,
    output:  null,
    format:  'table',
    json:    false,
    help:    false,
    verbose: false
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if      (arg === '--help'    || arg === '-h')  opts.help    = true;
    else if (arg === '--json')                     opts.json    = true;
    else if (arg === '--verbose' || arg === '-v')  opts.verbose = true;
    else if ((arg === '--input'  || arg === '-i') && args[i + 1])
      opts.input = args[++i];
    else if ((arg === '--output' || arg === '-o') && args[i + 1])
      opts.output = args[++i];
    else if ((arg === '--format' || arg === '-f') && args[i + 1])
      opts.format = args[++i];
    else if (!arg.startsWith('-') && !opts.input)
      opts.input = arg;
  }
  return opts;
}

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
aqt categorize - Categorize and classify issues from a JSON report

${c.bold}Usage:${c.reset}
  aqt categorize <input-file> [options]
  aqt categorize --input <file> [options]

${c.bold}Options:${c.reset}
  --input, -i        Input JSON file (issues array or {issues:[...]} object)
  --output, -o       Write categorized output to file
  --format, -f       Output format: table, json (default: table)
  --json             Shorthand for --format json
  --verbose, -v      Verbose output
  --help, -h         Show this help

${c.bold}Examples:${c.reset}
  aqt categorize report.json
  aqt categorize --input report.json --output categorized.json
  aqt categorize report.json --format json
`);
}

module.exports = { run };

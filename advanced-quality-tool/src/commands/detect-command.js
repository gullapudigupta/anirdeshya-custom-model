'use strict';
/**
 * aqt detect - Detect available linters and quality tools
 *
 * P11-T022: Detect Command
 */

const path = require('path');
const fs   = require('fs');

// Lazy-require so the module loads even if linter-cli has a bad env
let _detectFn = null;
function getDetectFn() {
  if (!_detectFn) {
    const mod = require('../integrations/linter-cli');
    _detectFn = mod.detectAvailableLinters || (mod.LinterOrchestrator && mod.LinterOrchestrator.detectAvailableLinters);
    if (!_detectFn && mod.LinterOrchestrator) {
      // instance method fallback
      _detectFn = (root) => new mod.LinterOrchestrator(root).detectAvailableLinters();
    }
  }
  return _detectFn;
}

const c = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  red:   '\x1b[31m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  cyan:  '\x1b[36m',
  gray:  '\x1b[90m'
};

// ─── Run ────────────────────────────────────────────────────────────────────

async function run(args) {
  const options = parseOptions(args);
  if (options.help) { printHelp(); return; }

  const workspace = path.resolve(options.workspace || process.cwd());
  console.log(`\n🔍 Detecting tools in: ${workspace}\n`);

  try {
    const detect = getDetectFn();
    const linters = detect ? detect(workspace) : {};

    if (options.json) {
      const configs = detectConfigFiles(workspace);
      console.log(JSON.stringify({ linters, configs, workspace }, null, 2));
      return;
    }

    displayLinters(linters);
    displayConfigs(workspace);
    console.log('');

  } catch (error) {
    console.error(`\n${c.red}❌ Detection failed: ${error.message}${c.reset}\n`);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
}

// ─── Display helpers ────────────────────────────────────────────────────────

function displayLinters(linters) {
  const entries = Object.entries(linters);
  if (entries.length === 0) {
    console.log(`${c.yellow}⚠️  No linter information available (no package.json found?)${c.reset}`);
    return;
  }

  console.log(`${c.bold}Available Linters:${c.reset}`);
  for (const [name, available] of entries) {
    const icon   = available ? `${c.green}✓${c.reset}` : `${c.gray}✗${c.reset}`;
    const status = available ? `${c.green}available${c.reset}` : `${c.gray}not installed${c.reset}`;
    console.log(`  ${icon} ${name.padEnd(16)} ${status}`);
  }

  const count = entries.filter(([, v]) => v).length;
  console.log(`\n  ${count}/${entries.length} tools available`);
}

function displayConfigs(workspace) {
  const configs = detectConfigFiles(workspace);
  const entries = Object.entries(configs);
  if (entries.length === 0) return;

  console.log(`\n${c.bold}Config Files:${c.reset}`);
  for (const [label, found] of entries) {
    const icon = found ? `${c.green}✓${c.reset}` : `${c.gray}○${c.reset}`;
    console.log(`  ${icon} ${label}`);
  }
}

function detectConfigFiles(workspace) {
  const candidates = {
    '.eslintrc / .eslintrc.js / .eslintrc.json': ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml'],
    '.prettierrc / prettier.config.js':          ['.prettierrc', '.prettierrc.js', 'prettier.config.js'],
    '.stylelintrc':                              ['.stylelintrc', 'stylelint.config.js'],
    'tsconfig.json':                             ['tsconfig.json'],
    '.aqt/config.json (AQT config)':             ['.aqt/config.json']
  };
  const result = {};
  for (const [label, files] of Object.entries(candidates)) {
    result[label] = files.some(f => fs.existsSync(path.join(workspace, f)));
  }
  return result;
}

// ─── Options parser ─────────────────────────────────────────────────────────

function parseOptions(args) {
  const opts = { workspace: null, json: false, help: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if      (arg === '--help'    || arg === '-h')  opts.help    = true;
    else if (arg === '--json')                     opts.json    = true;
    else if (arg === '--verbose' || arg === '-v')  opts.verbose = true;
    else if ((arg === '--workspace' || arg === '-w') && args[i + 1])
      opts.workspace = args[++i];
    else if (!arg.startsWith('-') && !opts.workspace)
      opts.workspace = arg;
  }
  return opts;
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
aqt detect - Detect available linters and quality tools

${c.bold}Usage:${c.reset}
  aqt detect [workspace] [options]

${c.bold}Options:${c.reset}
  --workspace, -w    Project directory (default: current directory)
  --json             Output as JSON
  --verbose, -v      Verbose output
  --help, -h         Show this help

${c.bold}Examples:${c.reset}
  aqt detect
  aqt detect --workspace /path/to/project
  aqt detect --json
`);
}

module.exports = { run };

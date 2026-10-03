'use strict';
/**
 * aqt config - Manage AQT configuration
 *
 * P11-T024: Config Command
 *
 * Reads/writes .aqt/config.json in the workspace directory.
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
  gray:   '\x1b[90m'
};

const CONFIG_FILE    = path.join('.aqt', 'config.json');
const DEFAULT_CONFIG = {
  verbose:         false,
  autoFix:         false,
  severity:        'low',
  categories:      ['security', 'performance', 'maintainability', 'reliability', 'style'],
  excludePatterns: ['node_modules/**', 'dist/**', 'build/**', '.git/**'],
  thresholds: {
    maxComplexity:          10,
    maxCognitive:           15,
    maxMaintainabilityIndex: 65,
    maxLines:               300,
    maxParameters:          5
  },
  plugins: [],
  ai: {
    provider: 'openai',
    model:    'gpt-4o-mini',
    budget:   100
  }
};

// ─── Run ────────────────────────────────────────────────────────────────────

async function run(args) {
  const [subcommand, ...subArgs] = args;
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  switch (subcommand) {
    case 'list':
    case 'show':
      return listConfig(subArgs);

    case 'get':
      return getConfig(subArgs);

    case 'set':
      return setConfig(subArgs);

    case 'reset':
      return resetConfig(subArgs);

    case 'validate':
      return validateConfig(subArgs);

    default:
      console.error(`\n${c.red}❌ Unknown subcommand: ${subcommand}${c.reset}\n`);
      printHelp();
      process.exit(1);
  }
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

function listConfig(args) {
  try {
    const configPath = resolveConfigPath(args);
    const config     = readConfigFile(configPath);
    const json       = args.includes('--json');

    if (json) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    console.log(`\n${c.bold}Configuration${c.reset}  ${c.gray}(${configPath})${c.reset}\n`);
    printConfigFlat(config);
    console.log('');
  } catch (err) {
    console.error(`\n${c.red}❌ ${err.message}${c.reset}\n`);
    process.exit(1);
  }
}

function getConfig(args) {
  try {
    const positional = args.filter(a => !a.startsWith('-'));
    const key        = positional[0];
    if (!key) {
      console.error(`\n${c.red}❌ Key required.  Usage: aqt config get <key>${c.reset}\n`);
      process.exit(1);
    }

    const configPath = resolveConfigPath(args);
    const config     = readConfigFile(configPath);
    const value      = getNestedValue(config, key);

    if (value === undefined) {
      console.log(`${c.yellow}(not set)${c.reset}`);
    } else {
      console.log(JSON.stringify(value, null, 2));
    }
  } catch (err) {
    console.error(`\n${c.red}❌ ${err.message}${c.reset}\n`);
    process.exit(1);
  }
}

function setConfig(args) {
  try {
    const positional = args.filter(a => !a.startsWith('-'));
    const [key, rawValue] = positional;

    if (!key || rawValue === undefined) {
      console.error(
        `\n${c.red}❌ Key and value required.  ` +
        `Usage: aqt config set <key> <value>${c.reset}\n`
      );
      process.exit(1);
    }

    const configPath = resolveConfigPath(args);
    const config     = readConfigFile(configPath);

    // Parse value: try JSON first, then treat as string
    let parsed;
    try   { parsed = JSON.parse(rawValue); }
    catch { parsed = rawValue; }

    setNestedValue(config, key, parsed);
    writeConfigFile(configPath, config);

    console.log(
      `\n${c.green}✓${c.reset}  Set ${c.cyan}${key}${c.reset}` +
      ` = ${JSON.stringify(parsed)}\n`
    );
  } catch (err) {
    console.error(`\n${c.red}❌ ${err.message}${c.reset}\n`);
    process.exit(1);
  }
}

function resetConfig(args) {
  const configPath = resolveConfigPath(args);
  const force      = args.includes('--force') || args.includes('-f');

  if (!force) {
    console.log(
      `\n${c.yellow}⚠️  This will reset ${configPath} to defaults.` +
      `\n    Pass --force to confirm.${c.reset}\n`
    );
    return;
  }

  writeConfigFile(configPath, Object.assign({}, DEFAULT_CONFIG));
  console.log(`\n${c.green}✅ Config reset to defaults.${c.reset}  (${configPath})\n`);
}

function validateConfig(args) {
  try {
    const configPath = resolveConfigPath(args);
    const config     = readConfigFile(configPath);
    const errors     = [];

    // Severity
    const validSeverities = ['critical', 'high', 'medium', 'low', 'info'];
    if (config.severity && !validSeverities.includes(config.severity)) {
      errors.push(`Invalid severity "${config.severity}". Valid: ${validSeverities.join(', ')}`);
    }

    // Thresholds
    if (config.thresholds) {
      const nums = ['maxComplexity', 'maxCognitive', 'maxMaintainabilityIndex', 'maxLines', 'maxParameters'];
      for (const k of nums) {
        if (config.thresholds[k] !== undefined && typeof config.thresholds[k] !== 'number') {
          errors.push(`thresholds.${k} must be a number`);
        }
      }
    }

    // Categories
    const validCats = ['security', 'performance', 'maintainability', 'reliability', 'style', 'complexity'];
    if (config.categories && Array.isArray(config.categories)) {
      for (const cat of config.categories) {
        if (!validCats.includes(cat)) {
          errors.push(`Unknown category "${cat}". Valid: ${validCats.join(', ')}`);
        }
      }
    }

    if (errors.length > 0) {
      console.log(`\n${c.red}❌ Config validation failed:${c.reset}`);
      for (const e of errors) console.log(`   • ${e}`);
      console.log('');
      process.exit(1);
    } else {
      console.log(`\n${c.green}✅ Config is valid.${c.reset}  (${configPath})\n`);
    }
  } catch (err) {
    console.error(`\n${c.red}❌ ${err.message}${c.reset}\n`);
    process.exit(1);
  }
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function resolveConfigPath(args) {
  const idx = args.findIndex(a => a === '--workspace' || a === '-w');
  const workspace = idx >= 0 ? path.resolve(args[idx + 1]) : process.cwd();
  return path.join(workspace, CONFIG_FILE);
}

function readConfigFile(configPath) {
  if (!fs.existsSync(configPath)) return Object.assign({}, DEFAULT_CONFIG);
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new Error(`Invalid JSON in ${configPath}: ${e.message}`);
  }
}

function writeConfigFile(configPath, config) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ─── Nested key helpers ───────────────────────────────────────────────────────

function getNestedValue(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

function setNestedValue(obj, key, value) {
  const parts = key.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null || Array.isArray(o[parts[i]])) {
      o[parts[i]] = {};
    }
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function printConfigFlat(obj, prefix) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      printConfigFlat(v, key);
    } else {
      const val = Array.isArray(v) ? v.join(', ') : String(v);
      console.log(`  ${c.cyan}${key.padEnd(35)}${c.reset} ${val}`);
    }
  }
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
aqt config - Manage AQT configuration

${c.bold}Usage:${c.reset}
  aqt config <subcommand> [options]

${c.bold}Subcommands:${c.reset}
  list [--json]              Show all config values
  get <key>                  Get a specific config value
  set <key> <value>          Set a config value
  reset [--force]            Reset config to defaults
  validate                   Validate the current config

${c.bold}Options:${c.reset}
  --workspace, -w            Project directory (default: current directory)
  --json                     Output as JSON (for list/get)
  --help, -h                 Show this help

${c.bold}Config file location:${c.reset}
  .aqt/config.json  (relative to workspace)

${c.bold}Examples:${c.reset}
  aqt config list
  aqt config get severity
  aqt config set severity high
  aqt config set thresholds.maxComplexity 15
  aqt config set categories '["security","performance"]'
  aqt config reset --force
  aqt config validate
`);
}

module.exports = { run };

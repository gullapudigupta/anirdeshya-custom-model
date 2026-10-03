#!/usr/bin/env node
/**
 * Advanced Quality Tool - CLI Entry Point
 * 
 * Main command-line interface for the advanced quality tool.
 */

const path = require('path');
const fs = require('fs');

// Color codes
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function printBanner() {
  console.log(`
${c.cyan}${c.bold}╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   Advanced Quality Tool (AQT)                            ║
║   AI-Powered Code Analysis & Auto-Fix                    ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝${c.reset}
`);
}

function printHelp() {
  console.log(`
${c.bold}Usage:${c.reset}
  aqt <command> [options]

${c.bold}Commands:${c.reset}
  ${c.green}detect${c.reset}              Detect available linters
  ${c.green}analyze${c.reset}             Run full code analysis
  ${c.green}categorize${c.reset}          Categorize and filter issues
  ${c.green}fix${c.reset}                 Auto-fix issues
  ${c.green}generate-fixes${c.reset}      AI-powered issue fixing (Phase 6)
  ${c.green}watch${c.reset}               Watch files for changes
  ${c.green}ui${c.reset}                  Launch chat interface
  ${c.green}monitor${c.reset}             Build monitoring & CI/CD integration
  ${c.green}security${c.reset}            Security scanning and vulnerability detection
  ${c.green}config${c.reset}              Manage tool configuration (.aqt/config.json)
  ${c.green}plugin${c.reset}              Manage plugins (.aqt/plugins/)
  ${c.green}help${c.reset}                Show this help message

${c.bold}Examples:${c.reset}
  ${c.cyan}aqt detect${c.reset}           # Detect which linters are available
  ${c.cyan}aqt analyze${c.reset}          # Run analysis with all available linters
  ${c.cyan}aqt categorize${c.reset}       # Categorize and filter issues
  ${c.cyan}aqt fix --dry-run${c.reset}    # Preview fixes without applying them
  ${c.cyan}aqt watch --auto-fix${c.reset} # Watch files and auto-fix on save
  ${c.cyan}aqt ui${c.reset}               # Launch interactive chat UI
  ${c.cyan}aqt monitor${c.reset}          # Run quality checks for CI/CD
  ${c.cyan}aqt config list${c.reset}      # Show current configuration
  ${c.cyan}aqt config set severity high${c.reset}  # Update a config value
  ${c.cyan}aqt plugin list${c.reset}      # List installed plugins

${c.bold}Options:${c.reset}
  --help, -h          Show help for a command
  --version, -v       Show version

${c.bold}Configuration:${c.reset}
  Create ${c.cyan}.aqt/config.json${c.reset} to customize settings

${c.bold}Documentation:${c.reset}
  See ${c.cyan}docs/${c.reset} folder for detailed documentation

${c.bold}Phase Status:${c.reset}
  ✅ Phase 0: Foundation (Complete)
     - Feasibility analysis
     - Issue taxonomy
     - Linter integration
     - Categorization engine

  ✅ Phase 1: Core Features (Complete)
     - Rule-based auto-fix engine
     - AI-powered fix generation
     - Chat UI with WebSocket
     - File watcher with auto-fix
     - Build monitor for CI/CD

  🔮 Phase 2: VS Code Extension
  🔮 Phase 3: Multi-Language Support
`);
}

async function runCommand(command, args) {
  try {
    switch (command) {
      case 'detect':
        await require('./src/commands/detect-command').run(args);
        break;

      case 'analyze':
        await require('./src/commands/analyze-command').run(args);
        break;

      case 'categorize':
        await require('./src/commands/categorize-command').run(args);
        break;

      case 'fix':
        const fixCommand = require('./src/commands/fix-command');
        await fixCommand.run(args);
        break;

      case 'generate-fixes':
        const generateFixesCommand = require('./src/commands/generate-fixes-command');
        await generateFixesCommand.run(args);
        break;

      case 'watch':
        const watchCommand = require('./src/commands/watch-command');
        await watchCommand.run(args);
        break;

      case 'ui':
        const uiCommand = require('./src/commands/ui-command');
        await uiCommand.run(args);
        break;

      case 'monitor':
        const monitorCommand = require('./src/commands/monitor-command');
        await monitorCommand.run(args);
        break;

      case 'security':
        const securityCommand = require('./src/commands/security-command');
        await securityCommand.run(args);
        break;

      case 'config':
        await require('./src/commands/config-command').run(args);
        break;

      case 'plugin':
        await require('./src/commands/plugin-command').run(args);
        break;

      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;

      case 'version':
      case '--version':
      case '-v':
        const pkg = require('./package.json');
        console.log(`\nAdvanced Quality Tool v${pkg.version}\n`);
        break;

      default:
        console.log(`${c.red}Unknown command: ${command}${c.reset}`);
        console.log(`Run ${c.cyan}aqt help${c.reset} for available commands\n`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`\n${c.red}Error: ${error.message}${c.reset}\n`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printBanner();
    printHelp();
    return;
  }

  await runCommand(command, args.slice(1));
}

// Run CLI
if (require.main === module) {
  main().catch(error => {
    console.error(`${c.red}Fatal error:${c.reset}`, error);
    process.exit(1);
  });
}

module.exports = { main, runCommand };

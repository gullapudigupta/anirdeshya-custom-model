/**
 * Watch Command - CLI handler for file watching
 * 
 * Usage:
 *   aqt watch [directory] [options]
 * 
 * Options:
 *   --auto-fix        Auto-fix issues on file change
 *   --debounce <ms>   Debounce delay in milliseconds (default: 500)
 *   --include <glob>  Include pattern (can be specified multiple times)
 *   --exclude <glob>  Exclude pattern (can be specified multiple times)
 *   --verbose, -v     Verbose output
 *
 * @module commands/watch-command
 */

const { FileWatcher } = require('../watcher/file-watcher');
const path = require('path');

async function run(args) {
  // Parse arguments
  const options = parseArguments(args);

  console.log('\n👁️  Watch Command\n');

  // Create file watcher
  const watcher = new FileWatcher({
    directory: options.directory,
    autoFix: options.autoFix,
    debounceMs: options.debounce,
    include: options.include,
    exclude: options.exclude,
    verbose: options.verbose
  });

  // Attach event handlers
  watcher.on('started', (data) => {
    console.log(`✅ Watching ${data.filesWatched} file(s) for changes...`);
    if (options.autoFix) {
      console.log('🔧 Auto-fix is ENABLED - Changes will be applied automatically');
    }
    console.log('\nPress Ctrl+C to stop\n');
  });

  watcher.on('fileChanged', (data) => {
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    console.log(`[${timestamp}] 📝 ${data.relativePath} changed`);
  });

  watcher.on('analysisComplete', (data) => {
    if (data.issueCount > 0) {
      console.log(`   Found ${data.issueCount} issue(s)`);
    } else {
      console.log('   ✓ No issues found');
    }
  });

  watcher.on('autoFixComplete', (data) => {
    console.log(`   🔧 Auto-fixed ${data.fixed} issue(s)`);
  });

  watcher.on('autoFixError', (data) => {
    console.error(`   ❌ Auto-fix failed: ${data.error.message}`);
  });

  watcher.on('error', (data) => {
    console.error(`   ❌ Error: ${data.error.message}`);
  });

  watcher.on('stopped', (data) => {
    console.log('\n👁️  Watcher stopped');
    watcher.printStats();
    process.exit(0);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    watcher.stop();
  });

  process.on('SIGTERM', () => {
    console.log('\n\nShutting down...');
    watcher.stop();
  });

  // Start watching
  try {
    await watcher.start();

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Parse command arguments
 */
function parseArguments(args) {
  const options = {
    directory: process.cwd(),
    autoFix: false,
    debounce: 500,
    include: null,
    exclude: null,
    verbose: false
  };

  const includePatterns = [];
  const excludePatterns = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--auto-fix') {
      options.autoFix = true;
    } else if (arg === '--debounce') {
      options.debounce = parseInt(args[++i], 10);
    } else if (arg === '--include') {
      includePatterns.push(args[++i]);
    } else if (arg === '--exclude') {
      excludePatterns.push(args[++i]);
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('--')) {
      options.directory = path.resolve(arg);
    }
  }

  if (includePatterns.length > 0) {
    options.include = includePatterns;
  }

  if (excludePatterns.length > 0) {
    options.exclude = excludePatterns;
  }

  return options;
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
📖 Watch Command Help

Usage:
  aqt watch [directory] [options]

Options:
  --auto-fix              Auto-fix issues on file change
  --debounce <ms>         Debounce delay in milliseconds (default: 500)
  --include <glob>        Include pattern (can be specified multiple times)
  --exclude <glob>        Exclude pattern (can be specified multiple times)
  --verbose, -v           Verbose output
  --help, -h              Show this help

Examples:
  aqt watch                           # Watch current directory
  aqt watch src/                      # Watch src/ directory
  aqt watch --auto-fix                # Watch and auto-fix issues
  aqt watch --debounce 1000           # Watch with 1 second debounce
  aqt watch --include "**/*.ts"       # Watch only TypeScript files
  aqt watch --exclude "**/test/**"    # Exclude test files

Default Patterns:
  Include: **/*.js, **/*.ts, **/*.jsx, **/*.tsx
  Exclude: **/node_modules/**, **/dist/**, **/build/**

How It Works:
  1. Watches files for changes
  2. Runs analysis when files are modified
  3. Optionally applies auto-fixes
  4. Provides real-time feedback

Press Ctrl+C to stop watching.
`);
}

module.exports = {
  run,
  printHelp
};

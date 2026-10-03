#!/usr/bin/env node

/**
 * Advanced Quality Tool - CLI Entry Point
 * 
 * This is the main entry point for the AQT CLI. It instantiates the
 * StandaloneCliAdapter and runs the requested command.
 * 
 * Usage:
 *   aqt analyze [files...]
 *   aqt fix [files...] [--dry-run]
 *   aqt review [files...]
 *   aqt report [--format json|md|sarif]
 *   aqt config [get|set] [key] [value]
 *   aqt health
 *   aqt help
 * 
 * Configuration:
 *   - ~/.aqt-config.json (user-level)
 *   - ./aqt-config.json (project-level)
 *   - AQT_* environment variables
 *   - CLI arguments (highest priority)
 * 
 * @module bin/aqt
 */

'use strict';

const { StandaloneCliAdapter } = require('../src/commands/standalone-cli');

/**
 * Main entry point.
 */
async function main() {
  const cli = new StandaloneCliAdapter({
    verbose: process.env.AQT_VERBOSE === 'true'
  });

  try {
    const exitCode = await cli.run(process.argv);
    process.exit(exitCode);
  } catch (err) {
    console.error('Fatal error:', err.message);
    if (process.env.AQT_VERBOSE === 'true') {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Run main
main().catch(err => {
  console.error('Uncaught error:', err.message);
  process.exit(1);
});

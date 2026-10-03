/**
 * CLI Usage Examples - Standalone CLI Adapter (P8-T004)
 *
 * This file demonstrates how to use the StandaloneCliAdapter
 * programmatically or as a CLI entry point.
 *
 * @module examples/cli-usage
 */

'use strict';

const { StandaloneCliAdapter } = require('../src/commands/standalone-cli');

/**
 * Example 1: Basic CLI usage
 *
 * Run from command line:
 *   node examples/cli-usage.js analyze src/
 *   node examples/cli-usage.js fix --dry-run
 *   node examples/cli-usage.js health
 */
async function example1_basicUsage() {
  console.log('Example 1: Basic CLI Usage\n');

  const cli = new StandaloneCliAdapter({ verbose: true });

  // Simulate: aqt analyze src/
  const exitCode = await cli.run(['aqt', 'analyze', 'src/']);
  console.log(`Exit code: ${exitCode}\n`);
}

/**
 * Example 2: Programmatic usage with custom config
 *
 * Use the adapter in code without CLI args.
 */
async function example2_programmaticUsage() {
  console.log('Example 2: Programmatic Usage\n');

  const cli = new StandaloneCliAdapter({
    verbose: true,
    appConfig: {
      linters: ['eslint', 'pylint'],
      autoFix: true
    }
  });

  await cli.start();

  // Analyze directly
  const result = await cli.dispatch('analyze', {
    files: ['src/'],
    projectRoot: process.cwd()
  });

  console.log('Analysis result:', result);
  await cli.stop();
}

/**
 * Example 3: Error handling with model requirements
 *
 * Demonstrate how MODEL_REQUIRED errors are handled.
 */
async function example3_errorHandling() {
  console.log('Example 3: Error Handling\n');

  const cli = new StandaloneCliAdapter({ verbose: false });

  // Simulate: aqt health --json
  const exitCode = await cli.run(['aqt', 'health', '--json']);

  // Exit code 3 indicates MODEL_REQUIRED
  if (exitCode === 3) {
    console.log('Model configuration needed. Exit code: 3\n');
  }
}

/**
 * Example 4: Configuration loading
 *
 * Show the configuration priority order.
 */
async function example4_configurationLoading() {
  console.log('Example 4: Configuration Loading\n');

  // Set some environment variables
  process.env.AQT_VERBOSE = 'true';
  process.env.AQT_LINTERS = 'eslint,pylint';

  const cli = new StandaloneCliAdapter();

  // Simulate: aqt config --verbose --linters=jshint
  await cli._parseArguments(['aqt', 'config']);
  cli._loadConfiguration({
    verbose: true,
    linters: 'jshint'  // CLI arg (highest priority)
  });

  console.log('Final config:', cli.cliConfig);
  console.log('Verbose:', cli.verbose);
  // Note: linters will be 'jshint' (CLI arg) not 'eslint,pylint' (env var)
}

/**
 * Example 5: Machine-readable output
 *
 * Generate JSON output for scripting.
 */
async function example5_machineReadable() {
  console.log('Example 5: Machine-Readable Output\n');

  const cli = new StandaloneCliAdapter();

  // Simulate: aqt analyze --json
  console.log('Running: aqt analyze --json\n');
  console.log('Expected JSON output structure:');
  console.log(JSON.stringify({
    command: 'analyze',
    success: true,
    issueCount: 3,
    issues: [
      {
        file: 'src/index.js',
        line: 42,
        column: 10,
        severity: 'error',
        message: 'Unexpected token',
        rule: 'syntax-error'
      }
    ]
  }, null, 2));
}

/**
 * Example 6: Exit codes and CI integration
 *
 * Show how exit codes map to CI/CD integration scenarios.
 */
async function example6_exitCodes() {
  console.log('Example 6: Exit Codes for CI/CD\n');

  const exitCodes = {
    0: 'Success - no issues or all fixed',
    1: 'General error - unexpected failure',
    2: 'Configuration error - invalid config',
    3: 'Model required - AI setup needed',
    4: 'Operation cancelled - user interruption',
    5: 'Invalid input - bad arguments'
  };

  console.log('Exit Code Mapping:\n');
  for (const [code, meaning] of Object.entries(exitCodes)) {
    console.log(`  ${code}  →  ${meaning}`);
  }

  console.log('\nCI/CD Integration Example:');
  console.log(`
    if ! aqt analyze; then
      echo "Analysis failed"
      exit 1
    fi

    if ! aqt health | grep -q "healthy"; then
      echo "System not healthy"
      exit 1
    fi

    aqt fix
    exit $?
  `);
}

/**
 * Example 7: Configuration file loading
 *
 * Show how config files are discovered and loaded.
 */
async function example7_configFiles() {
  console.log('Example 7: Configuration Files\n');

  const cli = new StandaloneCliAdapter();

  console.log('Config file search order:');
  const locations = [
    './aqt-config.json (project-level)',
    './.aqt-config.json (hidden project-level)',
    '~/.aqt-config.json (user-level)',
    '~/.config/aqt/config.json (XDG user-level)'
  ];

  locations.forEach((loc, idx) => {
    console.log(`  ${idx + 1}. ${loc}`);
  });

  console.log('\nExample config file (aqt-config.json):');
  console.log(JSON.stringify({
    linters: ['eslint', 'pylint'],
    autoFix: true,
    strategy: 'three-tier',
    exclude: ['node_modules/**', 'dist/**'],
    customRules: './rules.json',
    verbose: false
  }, null, 2));
}

/**
 * Example 8: Commands and subcommands
 *
 * Reference all available commands.
 */
async function example8_commands() {
  console.log('Example 8: Available Commands\n');

  const commands = {
    'analyze [files...]': 'Analyze code and report issues',
    'fix [files...]': 'Apply fixes to issues',
    'review [files...]': 'Perform code review',
    'report': 'Generate quality report',
    'config [get|set]': 'Manage configuration',
    'health': 'Check system health',
    'help': 'Display help'
  };

  console.log('Commands:\n');
  for (const [cmd, desc] of Object.entries(commands)) {
    console.log(`  aqt ${cmd}`);
    console.log(`    ${desc}\n`);
  }
}

/**
 * Main: Run all examples
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('  Standalone CLI Adapter - Usage Examples (P8-T004)\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Note: Examples 1-3 require actual SharedAppServices setup,
  // so we'll only run the reference examples here.

  example4_configurationLoading();
  console.log('\n' + '═'.repeat(59) + '\n');

  example5_machineReadable();
  console.log('\n' + '═'.repeat(59) + '\n');

  example6_exitCodes();
  console.log('\n' + '═'.repeat(59) + '\n');

  example7_configFiles();
  console.log('\n' + '═'.repeat(59) + '\n');

  example8_commands();
  console.log('\n' + '═'.repeat(59) + '\n');

  console.log('✅ Examples complete\n');
}

// Run
if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  example1_basicUsage,
  example2_programmaticUsage,
  example3_errorHandling,
  example4_configurationLoading,
  example5_machineReadable,
  example6_exitCodes,
  example7_configFiles,
  example8_commands
};

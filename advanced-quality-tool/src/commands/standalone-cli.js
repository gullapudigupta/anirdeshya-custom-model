/**
 * Standalone CLI Access Point (P8-T004)
 *
 * Dedicated CLI entry point for supported application workflows.
 * Extends InterfaceAdapter to provide command-line interface over SharedAppServices.
 *
 * Usage:
 *   aqt analyze [files...]
 *   aqt fix [files...]
 *   aqt review [files...]
 *   aqt report [--format json|md|sarif]
 *   aqt config [get|set] [key] [value]
 *   aqt health
 *
 * Configuration hierarchy (later overrides earlier):
 *   1. Default config
 *   2. File-based config (~/.aqt-config.json or ./aqt-config.json)
 *   3. Environment variables (AQT_*)
 *   4. CLI arguments
 *
 * Exit codes:
 *   0  = Success
 *   1  = General error
 *   2  = Configuration error
 *   3  = Model required / setup needed
 *   4  = Operation cancelled
 *   5  = Invalid input
 *
 * @module commands/standalone-cli
 */

'use strict';

const { InterfaceAdapter } = require('../core/interface-adapter');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─────────────────────────────────────────────────────────────────────────────
// CLI Runner
// ─────────────────────────────────────────────────────────────────────────────

class StandaloneCliAdapter extends InterfaceAdapter {
  /**
   * @param {object} config
   * @param {boolean} [config.verbose=false]
   * @param {string}  [config.configFilePath] - Path to config file
   * @param {object}  [config.appConfig] - Passed to SharedAppServices
   */
  constructor(config = {}) {
    super(config);
    this.configFilePath = config.configFilePath || this._findConfigFile();
    this.cliConfig = {};
    this.machineReadable = false;
  }

  /**
   * Run a CLI command with arguments.
   * Returns exit code (0 = success, non-zero = error).
   *
   * @param {string[]} argv - Command line arguments
   * @returns {Promise<number>} Exit code
   */
  async run(argv) {
    try {
      // Parse CLI args
      const { command, args, options } = this._parseArguments(argv);

      // Load configuration
      this._loadConfiguration(options);

      // Check for machine-readable flag
      this.machineReadable = options.json || options.machine;

      // Start services
      await this.start();

      // Dispatch command
      const exitCode = await this._handleCommand(command, args, options);
      await this.stop();
      return exitCode;
    } catch (err) {
      this._logError(`Unexpected error: ${err.message}`);
      if (this.verbose) console.error(err.stack);
      return 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle a specific command.
   * @private
   */
  async _handleCommand(command, args, options) {
    switch (command) {
      case 'analyze':
        return this._cmdAnalyze(args, options);
      case 'fix':
        return this._cmdFix(args, options);
      case 'review':
        return this._cmdReview(args, options);
      case 'report':
        return this._cmdReport(args, options);
      case 'config':
        return this._cmdConfig(args, options);
      case 'health':
        return this._cmdHealth(args, options);
      case 'help':
      case '--help':
      case '-h':
        return this._cmdHelp(args, options);
      case undefined:
      case '':
        this._printHelp();
        return 0;
      default:
        this._logError(`Unknown command: ${command}`);
        this._printHelp();
        return 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Command: analyze
   * Analyzes target files and reports issues.
   */
  async _cmdAnalyze(args, options) {
    const files = args.length > 0 ? args : ['.'];

    if (this.verbose) {
      this._log(`Analyzing ${files.join(', ')}`);
    }

    const result = await this.dispatch('analyze', {
      files,
      projectRoot: options.projectRoot || process.cwd(),
      linters: options.linters || [],
      exclude: options.exclude || [],
      verbose: this.verbose
    });

    if (!result.success) {
      return this._handleServiceError(result);
    }

    // Output issues
    const issues = result.data?.issues || [];

    if (this.machineReadable) {
      console.log(JSON.stringify({
        command: 'analyze',
        success: true,
        issueCount: issues.length,
        issues
      }, null, 2));
    } else {
      if (issues.length === 0) {
        this._logSuccess('✅ No issues found!');
      } else {
        console.log(`\n📋 Found ${issues.length} issue(s):\n`);
        issues.forEach((issue, idx) => {
          console.log(`  [${idx + 1}] ${issue.severity.toUpperCase()} - ${issue.message}`);
          console.log(`      File: ${issue.file}:${issue.line}:${issue.column}`);
          console.log(`      Rule: ${issue.rule}`);
          console.log();
        });
      }
    }

    return 0;
  }

  /**
   * Command: fix
   * Applies fixes to issues.
   */
  async _cmdFix(args, options) {
    const files = args.length > 0 ? args : ['.'];

    if (this.verbose) {
      this._log(`Fixing issues in ${files.join(', ')}`);
    }

    // First, analyze to get issues
    const analyzeResult = await this.dispatch('analyze', {
      files,
      projectRoot: options.projectRoot || process.cwd(),
      verbose: this.verbose
    });

    if (!analyzeResult.success) {
      return this._handleServiceError(analyzeResult);
    }

    const issues = analyzeResult.data?.issues || [];

    if (issues.length === 0) {
      if (!this.machineReadable) {
        this._logSuccess('✅ No issues to fix!');
      }
      return 0;
    }

    // Apply fixes
    const fixResult = await this.dispatch('fix', {
      issues,
      dryRun: options['dry-run'] || options.dryRun,
      strategy: options.strategy || 'three-tier',
      verbose: this.verbose
    });

    if (!fixResult.success) {
      return this._handleServiceError(fixResult);
    }

    const fixed = fixResult.data?.fixed || [];

    if (this.machineReadable) {
      console.log(JSON.stringify({
        command: 'fix',
        success: true,
        dryRun: options['dry-run'] || options.dryRun,
        fixedCount: fixed.length,
        fixed
      }, null, 2));
    } else {
      console.log(`\n🔧 Fixed ${fixed.length} issue(s):\n`);
      fixed.forEach((f, idx) => {
        console.log(`  [${idx + 1}] ${f.file}`);
        console.log(`      Applied: ${f.appliedFixes.join(', ')}`);
      });

      if (options['dry-run'] || options.dryRun) {
        console.log('\n⚠️  DRY RUN - No files were actually modified.');
      } else {
        console.log('\n✅ Fixes applied successfully.');
      }
    }

    return 0;
  }

  /**
   * Command: review
   * Performs code review on files.
   */
  async _cmdReview(args, options) {
    const files = args.length > 0 ? args : ['.'];

    if (this.verbose) {
      this._log(`Reviewing ${files.join(', ')}`);
    }

    const result = await this.dispatch('review', {
      files,
      projectRoot: options.projectRoot || process.cwd(),
      verbose: this.verbose
    });

    if (!result.success) {
      return this._handleServiceError(result);
    }

    const findings = result.data?.findings || [];

    if (this.machineReadable) {
      console.log(JSON.stringify({
        command: 'review',
        success: true,
        findingCount: findings.length,
        findings
      }, null, 2));
    } else {
      if (findings.length === 0) {
        this._logSuccess('✅ Code review passed!');
      } else {
        console.log(`\n🔍 Review findings (${findings.length}):\n`);
        findings.forEach((f, idx) => {
          console.log(`  [${idx + 1}] ${f.severity.toUpperCase()} - ${f.message}`);
          console.log(`      File: ${f.file}:${f.line}`);
          console.log();
        });
      }
    }

    return 0;
  }

  /**
   * Command: report
   * Generates a quality report.
   */
  async _cmdReport(args, options) {
    const format = options.format || options.f || 'json';

    if (!['json', 'md', 'sarif'].includes(format)) {
      this._logError(`Invalid format: ${format}. Valid: json, md, sarif`);
      return 5;
    }

    if (this.verbose) {
      this._log(`Generating ${format} report`);
    }

    // Analyze first
    const analyzeResult = await this.dispatch('analyze', {
      projectRoot: options.projectRoot || process.cwd(),
      verbose: this.verbose
    });

    if (!analyzeResult.success) {
      return this._handleServiceError(analyzeResult);
    }

    // Generate report
    const reportResult = await this.dispatch('generateReport', {
      results: analyzeResult.data || {},
      format
    });

    if (!reportResult.success) {
      return this._handleServiceError(reportResult);
    }

    const report = reportResult.data || '';

    if (this.machineReadable && format === 'json') {
      console.log(JSON.stringify({
        command: 'report',
        success: true,
        format,
        report: typeof report === 'string' ? JSON.parse(report) : report
      }, null, 2));
    } else {
      console.log(report);
    }

    return 0;
  }

  /**
   * Command: config
   * Get/set configuration.
   */
  async _cmdConfig(args, options) {
    const subcommand = args[0];

    if (!subcommand) {
      // Show current config
      const result = this.dispatch('getConfig');
      const config = result.data || {};

      if (this.machineReadable) {
        console.log(JSON.stringify({ command: 'config', config }, null, 2));
      } else {
        console.log('\n📋 Current Configuration:\n');
        console.log(JSON.stringify(config, null, 2));
      }
      return 0;
    }

    if (subcommand === 'get') {
      const key = args[1];
      if (!key) {
        this._logError('config get requires a key');
        return 5;
      }

      const result = this.dispatch('getConfig');
      const config = result.data || {};
      const value = config[key];

      if (this.machineReadable) {
        console.log(JSON.stringify({ key, value }, null, 2));
      } else {
        console.log(`${key} = ${JSON.stringify(value)}`);
      }
      return 0;
    }

    if (subcommand === 'set') {
      const key = args[1];
      const value = args[2];

      if (!key || value === undefined) {
        this._logError('config set requires key and value');
        return 5;
      }

      const result = this.dispatch('updateConfig', {
        [key]: this._parseConfigValue(value)
      });

      if (!result.success) {
        return this._handleServiceError(result);
      }

      if (!this.machineReadable) {
        this._logSuccess(`✅ Config updated: ${key} = ${value}`);
      }
      return 0;
    }

    this._logError(`Unknown config subcommand: ${subcommand}`);
    return 1;
  }

  /**
   * Command: health
   * Check system health and availability.
   */
  async _cmdHealth(args, options) {
    if (this.verbose) {
      this._log('Checking system health');
    }

    const result = await this.dispatch('getHealth');

    if (!result.success) {
      return this._handleServiceError(result);
    }

    const health = result.data || {};

    if (this.machineReadable) {
      console.log(JSON.stringify({
        command: 'health',
        success: true,
        health
      }, null, 2));
    } else {
      console.log('\n🏥 System Health:\n');
      console.log(JSON.stringify(health, null, 2));

      // Check for model requirements
      if (health.modelsRequired && health.modelsRequired.length > 0) {
        console.log('\n⚠️  Models Required:');
        health.modelsRequired.forEach(m => {
          console.log(`   - ${m.capability}: ${m.provider}`);
          if (m.setupGuide) {
            console.log(`     Setup: ${m.setupGuide}`);
          }
        });
      }
    }

    return 0;
  }

  /**
   * Command: help
   * Display help text.
   */
  async _cmdHelp(args, options) {
    this._printHelp();
    return 0;
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle errors from service layer.
   * @private
   */
  _handleServiceError(result) {
    const { errorCode, error, modelRequired } = result;

    if (errorCode === 'MODEL_REQUIRED' && modelRequired) {
      if (!this.machineReadable) {
        this._logError(`❌ Model Required: ${modelRequired.capability}`);
        this._log(`Provider: ${modelRequired.provider}`);
        if (modelRequired.setupGuide) {
          this._log(`Setup Instructions:\n${modelRequired.setupGuide}`);
        }
      } else {
        console.log(JSON.stringify({
          success: false,
          errorCode,
          error,
          modelRequired
        }, null, 2));
      }
      return 3; // Model required exit code
    }

    this._logError(`❌ ${error || 'Operation failed'}`);
    if (!this.machineReadable && errorCode) {
      this._log(`Error code: ${errorCode}`);
    }

    if (this.machineReadable) {
      console.log(JSON.stringify({
        success: false,
        errorCode,
        error
      }, null, 2));
    }

    return errorCode === 'INVALID_INPUT' ? 5 : 1;
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Parse command-line arguments.
   * @private
   */
  _parseArguments(argv) {
    // Skip node and script name
    const args = argv.slice(2);

    if (args.length === 0) {
      return { command: '', args: [], options: {} };
    }

    const command = args[0];
    const rest = args.slice(1);
    const positional = [];
    const options = {};

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];

      if (arg.startsWith('--')) {
        const [key, val] = arg.slice(2).split('=');
        options[key] = val === undefined ? true : val;
      } else if (arg.startsWith('-') && arg.length === 2) {
        const key = arg[1];
        options[key] = rest[i + 1] !== undefined && !rest[i + 1].startsWith('-')
          ? rest[++i]
          : true;
      } else {
        positional.push(arg);
      }
    }

    return {
      command,
      args: positional,
      options
    };
  }

  /**
   * Load configuration from files, env, and options.
   * @private
   */
  _loadConfiguration(options) {
    const config = {};

    // 1. Load from file
    if (this.configFilePath && fs.existsSync(this.configFilePath)) {
      try {
        const fileConfig = JSON.parse(fs.readFileSync(this.configFilePath, 'utf8'));
        Object.assign(config, fileConfig);
        if (this.verbose) {
          this._log(`Loaded config from ${this.configFilePath}`);
        }
      } catch (err) {
        if (this.verbose) {
          this._log(`Warning: Failed to parse config file: ${err.message}`);
        }
      }
    }

    // 2. Load from environment
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('AQT_')) {
        const configKey = key.slice(4).toLowerCase();
        config[configKey] = this._parseConfigValue(value);
      }
    }

    // 3. Apply CLI options (highest priority)
    for (const [key, value] of Object.entries(options)) {
      // Skip internal flags
      if (!['json', 'machine', 'v', 'verbose', 'projectRoot'].includes(key)) {
        config[key] = value;
      }
    }

    // 4. Store and pass to services
    this.cliConfig = config;
    if (this.services) {
      this.services.updateConfig(config);
    }

    // 5. Apply verbose flag
    if (options.v || options.verbose) {
      this.verbose = true;
    }

    if (this.verbose) {
      this._log(`Configuration: ${JSON.stringify(config, null, 2)}`);
    }
  }

  /**
   * Find config file in standard locations.
   * @private
   */
  _findConfigFile() {
    const locations = [
      path.join(process.cwd(), 'aqt-config.json'),
      path.join(process.cwd(), '.aqt-config.json'),
      path.join(os.homedir(), '.aqt-config.json'),
      path.join(os.homedir(), '.config', 'aqt', 'config.json')
    ];

    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        return loc;
      }
    }

    return null;
  }

  /**
   * Parse configuration value (handle types).
   * @private
   */
  _parseConfigValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
    return value;
  }

  /**
   * Print help text.
   * @private
   */
  _printHelp() {
    const help = `
Advanced Quality Tool - Standalone CLI
=======================================

Usage:
  aqt <command> [args] [options]

Commands:
  analyze [files...]      Analyze code and report issues
  fix [files...]          Apply fixes to issues
  review [files...]       Perform code review
  report                  Generate quality report
  config [get|set]        Manage configuration
  health                  Check system health
  help                    Show this help text

Common Options:
  --verbose, -v           Enable verbose output
  --json, --machine       Machine-readable output (JSON)
  --config <path>         Use specific config file
  --project-root <path>   Set project root
  --exclude <pattern>     Exclude files matching pattern
  --dry-run               Preview changes without applying
  --format <fmt>          Report format: json, md, sarif
  --strategy <str>        Fix strategy: rule-only, ai-only, three-tier
  --linters <list>        Comma-separated linters to enable

Configuration:
  Config is loaded from (in order):
  1. ~/.aqt-config.json or ./aqt-config.json
  2. Environment variables (AQT_* prefix)
  3. CLI options (highest priority)

Exit Codes:
  0  = Success
  1  = General error
  2  = Configuration error
  3  = Model required / setup needed
  4  = Operation cancelled
  5  = Invalid input

Examples:
  aqt analyze src/
  aqt fix src/ --dry-run
  aqt review --verbose
  aqt report --format json > report.json
  aqt config get linters
  aqt health
`;
    console.log(help);
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Translate CLI input to service operation.
   * @private
   * @override
   */
  _translateInput(rawInput) {
    // This adapter doesn't use the generic dispatch pattern;
    // it uses direct command handlers instead.
    return { operation: undefined, params: {} };
  }

  /**
   * Translate service output to CLI format.
   * @private
   * @override
   */
  _translateOutput(serviceResult) {
    // CLI output is handled per-command
    return serviceResult;
  }

  // ─────────────────────────────────────────────────────────────────────────

  _log(msg) {
    if (this.verbose) {
      console.log(`[CLI] ${msg}`);
    }
  }

  _logError(msg) {
    console.error(`❌ Error: ${msg}`);
  }

  _logSuccess(msg) {
    console.log(`✅ ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  StandaloneCliAdapter,

  /**
   * Main entry point for CLI execution.
   * Usage: node bin/aqt.js analyze src/
   */
  async main(argv) {
    const cli = new StandaloneCliAdapter({ verbose: false });
    const exitCode = await cli.run(argv || process.argv);
    process.exit(exitCode);
  },

  /**
   * Programmatic usage:
   * const { StandaloneCliAdapter } = require('./src/commands/standalone-cli');
   * const cli = new StandaloneCliAdapter({ verbose: true });
   * const code = await cli.run(['aqt', 'analyze', 'src/']);
   */
};

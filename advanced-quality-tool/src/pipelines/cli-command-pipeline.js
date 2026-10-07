/**
 * CLI Command Execution Pipelines (P9-T037)
 *
 * Defines common lifecycle and result contracts for analyze, fix, generate-fixes,
 * watch, monitor, and UI commands.
 *
 * @module pipelines/cli-command-pipeline
 */

'use strict';

const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');
const path = require('path');
const fs = require('fs');

/**
 * CLI command types
 */
const CommandType = {
  ANALYZE: 'analyze',
  FIX: 'fix',
  GENERATE_FIXES: 'generate-fixes',
  WATCH: 'watch',
  MONITOR: 'monitor',
  UI: 'ui',
  HELP: 'help',
  VERSION: 'version'
};

/**
 * Output formats
 */
const OutputFormat = {
  JSON: 'json',
  PRETTY: 'pretty',
  COMPACT: 'compact',
  MARKDOWN: 'markdown'
};

/**
 * CLI Command Pipeline
 */
class CLICommandPipeline {
  constructor(options = {}) {
    this.executor = options.executor || new PipelineExecutor();
    this.registry = options.registry || getRegistry();
    
    // Configuration
    this.defaultFormat = options.defaultFormat || OutputFormat.PRETTY;
    this.colors = options.colors !== false;
    this.verbose = options.verbose || false;
    
    // Output stream
    this.output = options.output || process.stdout;
  }

  /**
   * Execute CLI command pipeline
   * @param {Object} params
   * @param {string[]} params.args - Command line arguments
   * @param {string} params.cwd - Current working directory
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const { args, cwd } = params;

    const stageHandlers = {
      'parse-arguments': async (ctx) => this._parseArguments(ctx, args),
      'resolve-workspace': async (ctx) => this._resolveWorkspace(ctx, cwd),
      'load-config': async (ctx) => this._loadConfig(ctx),
      'dispatch-command': async (ctx) => this._dispatchCommand(ctx),
      'execute-operation': async (ctx) => this._executeOperation(ctx),
      'format-output': async (ctx) => this._formatOutput(ctx),
      'set-exit-code': async (ctx) => this._setExitCode(ctx),
      'record-run': async (ctx) => this._recordRun(ctx)
    };

    const result = await this.executor.execute('cli-command', {
      input: { args, cwd },
      workspace: cwd,
      stageHandlers
    });

    return {
      ...result,
      run: result.output,
      output: result.stageResults?.['format-output']?.output?.output || ''
    };
  }

  /**
   * Run analyze command
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async analyze(options = {}) {
    return this.execute({
      args: ['analyze', ...(options.files || [])],
      cwd: options.cwd || process.cwd()
    });
  }

  /**
   * Run fix command
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async fix(options = {}) {
    return this.execute({
      args: ['fix', ...(options.files || []), ...(options.dryRun ? ['--dry-run'] : [])],
      cwd: options.cwd || process.cwd()
    });
  }

  /**
   * Run watch command
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async watch(options = {}) {
    return this.execute({
      args: ['watch'],
      cwd: options.cwd || process.cwd()
    });
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _parseArguments(ctx, args) {
    const parsed = {
      command: null,
      options: {},
      files: [],
      flags: {}
    };
    
    // Parse arguments
    let i = 0;
    
    while (i < args.length) {
      const arg = args[i];
      
      if (arg.startsWith('--')) {
        // Long option
        const [key, value] = arg.slice(2).split('=');
        
        if (value !== undefined) {
          parsed.options[key] = value;
        } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          parsed.options[key] = args[i + 1];
          i++;
        } else {
          parsed.flags[key] = true;
        }
      } else if (arg.startsWith('-')) {
        // Short option
        const key = arg.slice(1);
        parsed.flags[key] = true;
      } else if (!parsed.command) {
        // First non-option is the command
        parsed.command = arg;
      } else {
        // Files
        parsed.files.push(arg);
      }
      
      i++;
    }
    
    // Set defaults
    parsed.format = parsed.options.format || this.defaultFormat;
    parsed.verbose = parsed.flags.verbose || parsed.flags.v || this.verbose;
    parsed.dryRun = parsed.flags['dry-run'] || parsed.flags.d || false;
    
    return { parsed };
  }

  async _resolveWorkspace(ctx, cwd) {
    const { parsed } = ctx.previousResults?.['parse-arguments'] || {};
    
    let workspace = cwd;
    
    // Check for workspace option
    if (parsed?.options.workspace) {
      workspace = path.resolve(cwd, parsed.options.workspace);
    }
    
    // Validate workspace
    if (!fs.existsSync(workspace)) {
      return {
        resolved: false,
        reason: `Workspace not found: ${workspace}`
      };
    }
    
    // Check for project root markers
    const markers = ['package.json', '.git', 'tsconfig.json', 'Cargo.toml', 'go.mod'];
    const isProject = markers.some(m => fs.existsSync(path.join(workspace, m)));
    
    return {
      resolved: true,
      workspace,
      isProject,
      packageJson: this._loadPackageJson(workspace)
    };
  }

  async _loadConfig(ctx) {
    const { workspace } = ctx.previousResults?.['resolve-workspace'] || {};
    
    if (!workspace) {
      return { config: {}, loaded: false };
    }
    
    const configPath = path.join(workspace, '.aqt', 'config.json');
    
    if (!fs.existsSync(configPath)) {
      return { config: {}, loaded: false };
    }
    
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { config, loaded: true };
    } catch {
      return { config: {}, loaded: false, error: 'Failed to parse config' };
    }
  }

  async _dispatchCommand(ctx) {
    const { parsed } = ctx.previousResults?.['parse-arguments'] || {};
    
    const command = parsed?.command || 'help';
    
    // Validate command
    const validCommands = Object.values(CommandType);
    
    if (!validCommands.includes(command)) {
      return {
        dispatched: false,
        reason: `Unknown command: ${command}`,
        validCommands
      };
    }
    
    // Get command handler
    const handler = this._getCommandHandler(command);
    
    return {
      dispatched: true,
      command,
      handler: handler ? 'defined' : 'default'
    };
  }

  async _executeOperation(ctx) {
    const { parsed, files } = ctx.previousResults?.['parse-arguments'] || {};
    const { workspace, packageJson } = ctx.previousResults?.['resolve-workspace'] || {};
    const { config } = ctx.previousResults?.['load-config'] || {};
    const { command } = ctx.previousResults?.['dispatch-command'] || {};
    
    const result = {
      command,
      success: false,
      data: null,
      error: null
    };
    
    try {
      switch (command) {
        case CommandType.ANALYZE:
          result.data = await this._executeAnalyze(workspace, parsed, config);
          result.success = true;
          break;
          
        case CommandType.FIX:
          result.data = await this._executeFix(workspace, parsed, config);
          result.success = true;
          break;
          
        case CommandType.GENERATE_FIXES:
          result.data = await this._executeGenerateFixes(workspace, parsed, config);
          result.success = true;
          break;
          
        case CommandType.WATCH:
          result.data = await this._executeWatch(workspace, parsed, config);
          result.success = true;
          break;
          
        case CommandType.MONITOR:
          result.data = await this._executeMonitor(workspace, parsed, config);
          result.success = true;
          break;
          
        case CommandType.HELP:
          result.data = this._generateHelp();
          result.success = true;
          break;
          
        case CommandType.VERSION:
          result.data = this._getVersion();
          result.success = true;
          break;
          
        default:
          result.error = `Command not implemented: ${command}`;
      }
    } catch (error) {
      result.error = error.message;
    }
    
    return { result };
  }

  async _formatOutput(ctx) {
    const { result } = ctx.previousResults?.['execute-operation'] || {};
    const { parsed } = ctx.previousResults?.['parse-arguments'] || {};
    
    if (!result) {
      return { output: '', formatted: false };
    }
    
    const format = parsed?.format || this.defaultFormat;
    let output = '';
    
    switch (format) {
      case OutputFormat.JSON:
        output = JSON.stringify(result, null, 2);
        break;
        
      case OutputFormat.COMPACT:
        output = this._formatCompact(result);
        break;
        
      case OutputFormat.MARKDOWN:
        output = this._formatMarkdown(result);
        break;
        
      case OutputFormat.PRETTY:
      default:
        output = this._formatPretty(result);
    }
    
    return { output, format, formatted: true };
  }

  async _setExitCode(ctx) {
    const { result } = ctx.previousResults?.['execute-operation'] || {};
    
    let exitCode = 0;
    const reasons = [];
    
    if (!result?.success) {
      exitCode = 1;
      reasons.push('Command failed');
    }
    
    if (result?.data?.issues?.length > 0) {
      const errors = result.data.issues.filter(i => i.severity === 'error');
      if (errors.length > 0) {
        exitCode = 1;
        reasons.push(`${errors.length} errors found`);
      }
    }
    
    return {
      exitCode,
      reasons,
      success: exitCode === 0
    };
  }

  async _recordRun(ctx) {
    const { result, exitCode } = Object.assign({},
      ctx.previousResults?.['execute-operation'] || {},
      ctx.previousResults?.['set-exit-code'] || {}
    );
    
    return {
      recorded: true,
      runId: ctx.runId,
      timestamp: Date.now(),
      exitCode
    };
  }

  // ─── Command Implementations ───────────────────────────────────────────────────

  async _executeAnalyze(workspace, parsed, config) {
    // Placeholder - would integrate with workspace quality pipeline
    return {
      workspace,
      files: parsed?.files?.length || 0,
      issues: [],
      summary: {
        errors: 0,
        warnings: 0,
        info: 0
      }
    };
  }

  async _executeFix(workspace, parsed, config) {
    // Placeholder - would integrate with auto-fix pipeline
    return {
      workspace,
      dryRun: parsed?.dryRun || false,
      fixed: 0,
      failed: 0
    };
  }

  async _executeGenerateFixes(workspace, parsed, config) {
    // Generate fixes without applying
    return {
      workspace,
      fixes: [],
      total: 0
    };
  }

  async _executeWatch(workspace, parsed, config) {
    // Start watch mode
    return {
      workspace,
      watching: true,
      message: 'Watch mode started. Press Ctrl+C to stop.'
    };
  }

  async _executeMonitor(workspace, parsed, config) {
    // CI monitoring
    return {
      workspace,
      monitoring: true
    };
  }

  _generateHelp() {
    return `
AQT - Advanced Quality Tool

Usage: aqt <command> [options] [files]

Commands:
  analyze         Analyze code quality
  fix             Automatically fix issues
  generate-fixes  Generate fixes without applying
  watch           Watch for file changes
  monitor         CI/CD monitoring mode
  ui              Start web UI
  help            Show this help
  version         Show version

Options:
  --format <fmt>  Output format: json, pretty, compact, markdown
  --workspace     Workspace directory
  --dry-run       Preview changes without applying
  --verbose, -v   Verbose output

Examples:
  aqt analyze src/
  aqt fix --dry-run
  aqt watch
`;
  }

  _getVersion() {
    return '1.0.0';
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────────

  _getCommandHandler(command) {
    const handlers = {
      analyze: this._executeAnalyze,
      fix: this._executeFix,
      watch: this._executeWatch
    };
    
    return handlers[command];
  }

  _loadPackageJson(workspace) {
    const packagePath = path.join(workspace, 'package.json');
    
    if (!fs.existsSync(packagePath)) {
      return null;
    }
    
    try {
      return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    } catch {
      return null;
    }
  }

  _formatCompact(result) {
    if (!result?.success) {
      return `Error: ${result?.error || 'Unknown error'}`;
    }
    
    const data = result.data || {};
    return `${data.issues?.length || 0} issues (${data.summary?.errors || 0} errors, ${data.summary?.warnings || 0} warnings)`;
  }

  _formatPretty(result) {
    const lines = [];
    
    if (!result?.success) {
      lines.push(`❌ Error: ${result?.error || 'Unknown error'}`);
      return lines.join('\n');
    }
    
    const data = result.data || {};
    if (typeof data === 'string') return data;
    
    lines.push(`✓ Command: ${result.command}`);
    
    if (data.summary) {
      lines.push('');
      lines.push('Summary:');
      lines.push(`  Errors:   ${data.summary.errors || 0}`);
      lines.push(`  Warnings: ${data.summary.warnings || 0}`);
      lines.push(`  Info:     ${data.summary.info || 0}`);
    }
    
    if (data.issues?.length > 0) {
      lines.push('');
      lines.push('Issues:');
      
      for (const issue of data.issues.slice(0, 10)) {
        const icon = issue.severity === 'error' ? '❌' : 
                     issue.severity === 'warning' ? '⚠️' : 'ℹ️';
        lines.push(`  ${icon} ${issue.file}:${issue.line} - ${issue.message}`);
      }
      
      if (data.issues.length > 10) {
        lines.push(`  ... and ${data.issues.length - 10} more`);
      }
    }
    
    return lines.join('\n');
  }

  _formatMarkdown(result) {
    const lines = [];
    
    lines.push(`# AQT ${result.command} Results`);
    lines.push('');
    
    if (!result?.success) {
      lines.push(`**Error**: ${result?.error || 'Unknown error'}`);
      return lines.join('\n');
    }
    
    const data = result.data || {};
    
    if (data.summary) {
      lines.push('## Summary');
      lines.push('');
      lines.push(`| Severity | Count |`);
      lines.push(`|----------|-------|`);
      lines.push(`| Errors   | ${data.summary.errors || 0} |`);
      lines.push(`| Warnings | ${data.summary.warnings || 0} |`);
      lines.push(`| Info     | ${data.summary.info || 0} |`);
      lines.push('');
    }
    
    return lines.join('\n');
  }
}

module.exports = {
  CLICommandPipeline,
  CommandType,
  OutputFormat
};

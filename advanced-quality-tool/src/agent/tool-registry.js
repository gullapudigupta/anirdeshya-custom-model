/**
 * Coding Agent Tool Registry (P9-T013, P12-T003)
 *
 * Exposes typed agent tools for file operations, searching, editing,
 * diagnostics, and allowlisted verification checks. All tools have validated
 * inputs, structured outputs, and bounded execution. No tool reachable by the
 * agent executes arbitrary model-supplied shell text: terminal-shaped
 * operations are limited to a fixed set of check ids (see `run_check`).
 *
 * @module agent/tool-registry
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const { PermissionManager } = require('./permissions');
const { LinterOrchestrator } = require('../integrations/linter-cli');

/** Check ids accepted by the `run_check` tool. The model supplies only an id; it never supplies shell text. */
const ALLOWED_CHECK_IDS = Object.freeze(['lint', 'typecheck', 'test', 'build']);

/**
 * Tool execution result
 * @typedef {Object} ToolResult
 * @property {boolean} success
 * @property {*} data - Tool-specific output data
 * @property {string} [error] - Error message if failed
 * @property {string} [code] - Machine-readable failure classification
 * @property {number} duration - Execution duration in ms
 */

/**
 * Tool Registry
 */
class ToolRegistry {
  constructor(options = {}) {
    const workspacePath = path.resolve(options.workspace || process.cwd());
    this.workspace = fs.existsSync(workspacePath) ? fs.realpathSync(workspacePath) : workspacePath;
    this.tools = new Map();
    this.executionLog = [];
    this.maxLogSize = options.maxLogSize || 1000;
    this.permissionManager = options.permissionManager || new PermissionManager({ workspace: this.workspace });
    // Injectable for tests; defaults to the real check runners below.
    this.checkRunners = options.checkRunners || null;
    this.taskBudgets = new Map();

    // Execution limits
    this.limits = {
      maxFileSize: options.maxFileSize || 1024 * 1024, // 1MB
      maxOutputSize: options.maxOutputSize || 100 * 1024, // 100KB
      checkTimeout: options.checkTimeout || options.terminalTimeout || 30000, // 30s
      maxSearchResults: options.maxSearchResults || 100,
      maxCallsPerTask: options.maxCallsPerTask || 100,
      maxOutputPerTask: options.maxOutputPerTask || 10 * 1024 * 1024
    };

    this._registerBuiltInTools();
  }

  /**
   * Execute a tool
   * @param {string} toolName
   * @param {Object} args
   * @param {Object} [context]
   * @returns {Promise<ToolResult>}
   */
  async execute(toolName, args = {}, context = {}) {
    const tool = this.tools.get(toolName);
    if (!tool) {
      const result = this._result(false, null, `Tool '${toolName}' not found`, 0, 'UNKNOWN_TOOL');
      this._logExecution(toolName, args, result, context);
      return result;
    }

    const startTime = Date.now();
    let argsValidated = false;

    try {
      const budgetKey = context.taskId || 'unscoped';
      const budget = this.taskBudgets.get(budgetKey) || { calls: 0, outputBytes: 0 };
      if (budget.calls >= this.limits.maxCallsPerTask) {
        const exhausted = this._result(false, null, 'Per-task tool-call budget exhausted', Date.now() - startTime);
        this._logExecution(toolName, args, exhausted, context);
        return exhausted;
      }
      if (budget.outputBytes >= this.limits.maxOutputPerTask) {
        const exhausted = this._result(false, null, 'Per-task tool output budget exhausted', Date.now() - startTime);
        this._logExecution(toolName, args, exhausted, context, false);
        return exhausted;
      }
      budget.calls++;
      this.taskBudgets.set(budgetKey, budget);

      if (context.signal?.aborted) {
        const cancelled = this._result(false, null, 'Tool execution cancelled', Date.now() - startTime);
        this._logExecution(toolName, args, cancelled, context, false);
        return cancelled;
      }

      if (Array.isArray(context.allowedTools) && !context.allowedTools.includes(toolName)) {
        const denied = this._result(false, null, `Tool '${toolName}' is not allowed in this execution context`, Date.now() - startTime);
        this._logExecution(toolName, args, denied, context, false);
        return denied;
      }

      // Validate arguments
      const validation = this._validateArgs(tool, args);
      if (!validation.valid) {
        const result = this._result(
          false, null, `Invalid arguments: ${validation.errors.join(', ')}`,
          Date.now() - startTime, 'INVALID_ARGUMENTS'
        );
        this._logExecution(toolName, args, result, context);
        return result;
      }
      argsValidated = true;

      // Execute tool
      const rawData = await tool.handler({ ...args, workspace: this.workspace }, context);
      const data = this._boundOutput(rawData);
      if (toolName === 'get_diagnostics' && data && data.available === false) {
        const unavailable = this._result(false, data, `Diagnostics are not configured: ${data.reason || 'no linter is available'}`, Date.now() - startTime, 'DIAGNOSTICS_UNAVAILABLE');
        this._logExecution(toolName, args, unavailable, context, argsValidated);
        return unavailable;
      }
      const outputBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
      budget.outputBytes += outputBytes;
      if (budget.outputBytes > this.limits.maxOutputPerTask) {
        budget.outputBytes = this.limits.maxOutputPerTask;
        const exhausted = this._result(false, null, 'Per-task tool output budget exhausted', Date.now() - startTime);
        this._logExecution(toolName, args, exhausted, context, argsValidated);
        return exhausted;
      }
      const duration = Date.now() - startTime;

      const result = this._result(true, data, null, duration, null);
      this._logExecution(toolName, args, result, context, argsValidated);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const result = this._result(false, null, error.message, duration, error.code || 'TOOL_EXECUTION_FAILED');
      this._logExecution(toolName, args, result, context, argsValidated);

      return result;
    }
  }

  /**
   * Get tool definition
   * @param {string} toolName
   * @returns {Object|null}
   */
  getTool(toolName) {
    return this.tools.get(toolName) || null;
  }

  /**
   * List all registered tools (including ones not exposed to a model executor)
   * @returns {Array<Object>}
   */
  listTools() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      parameters: tool.parameters,
      exposed: tool.exposed !== false
    }));
  }

  getModelTools() {
    const modelToolNames = new Set([
      'read_file', 'list_files', 'search_files', 'search_text', 'edit_file', 'run_check'
    ]);
    return Array.from(this.tools.values()).filter(tool => modelToolNames.has(tool.name)).map(tool => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      parameters: tool.parameters
    }));
  }

  /**
   * List only the tool schemas a model executor is allowed to call.
   * This is the allowlist enforced by agent execution: read/search/edit/check tools only.
   * @returns {Array<Object>}
   */
  listExposedTools() {
    return this.listTools().filter(tool => tool.exposed);
  }

  /**
   * Get execution log
   * @param {number} [limit]
   * @returns {Array<Object>}
   */
  getExecutionLog(limit = 100) {
    return this.executionLog.slice(-limit);
  }

  /**
   * Register a custom tool
   * @param {Object} tool
   */
  register(tool) {
    if (!tool.name || !tool.handler) {
      throw new Error('Tool must have name and handler');
    }
    this.tools.set(tool.name, tool);
  }

  // ─── Built-in Tools ───────────────────────────────────────────────────────────

  _registerBuiltInTools() {
    // File operations
    this.register({
      name: 'read_file',
      description: 'Read contents of a file',
      category: 'file',
      parameters: {
        path: { type: 'string', required: true, description: 'Relative file path' },
        offset: { type: 'number', required: false, description: 'Line offset (0-indexed)' },
        limit: { type: 'number', required: false, description: 'Maximum lines to read' }
      },
      handler: async (args) => {
        const filePath = this._resolvePath(args.path);
        this._validateWorkspacePath(filePath);
        const fileStats = fs.statSync(filePath);
        if (!fileStats.isFile()) throw new Error('Path is not a file');
        if (fileStats.size > this.limits.maxFileSize) {
          throw new Error(`File exceeds size limit (${fileStats.size} > ${this.limits.maxFileSize})`);
        }
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        
        const offset = args.offset || 0;
        const limit = args.limit || lines.length;
        const selectedLines = lines.slice(offset, offset + limit);
        
        return {
          path: args.path,
          content: selectedLines.join('\n'),
          totalLines: lines.length,
          offset,
          linesRead: selectedLines.length,
          // Hash of the full current file content, to be echoed back as
          // `expectedHash` on a subsequent edit_file call.
          fileHash: this._hashContent(content)
        };
      }
    });

    // write_file is kept for internal/back-compat callers but is not exposed
    // to agent-executed model calls: it has no staleness guard. Use edit_file instead.
    this.register({
      name: 'write_file',
      description: 'Write content to a file (no staleness guard; not exposed to model execution)',
      category: 'file',
      exposed: false,
      parameters: {
        path: { type: 'string', required: true, description: 'Relative file path' },
        content: { type: 'string', required: true, description: 'File content' }
      },
      handler: async (args) => {
        throw new Error(`Direct file writes are unavailable to agent tools; use edit_file with a hash-guarded patch approval (${args.path})`);
      }
    });

    // Hash-guarded edit: the only file-write tool exposed to model execution.
    // Rejects the edit outright if the file changed since `expectedHash` was read.
    this.register({
      name: 'edit_file',
      description: 'Create or overwrite a file, rejecting the edit if the file changed since it was last read',
      category: 'edit',
      parameters: {
        path: { type: 'string', required: true, description: 'Relative file path' },
        content: { type: 'string', required: true, description: 'New full file content' },
        expectedHash: {
          type: 'string',
          required: false,
          description: 'sha256 hex digest from a prior read_file call; omit only when creating a new file'
        }
      },
      handler: async (args) => {
        const filePath = this._resolvePath(args.path);
        this._validateWorkspacePath(filePath);

        const exists = fs.existsSync(filePath);
        if (exists) {
          const currentContent = fs.readFileSync(filePath, 'utf8');
          const currentHash = this._hashContent(currentContent);
          if (!args.expectedHash) {
            const error = new Error(
              `File '${args.path}' already exists; provide expectedHash from a prior read_file call to edit it`
            );
            error.code = 'HASH_REQUIRED';
            throw error;
          }
          if (currentHash !== args.expectedHash) {
            const error = new Error(
              `Stale source: file '${args.path}' changed since it was last read (expected ${args.expectedHash}, found ${currentHash}); re-read before editing`
            );
            error.code = 'STALE_FILE';
            throw error;
          }
        } else if (args.expectedHash) {
          const error = new Error(
            `File '${args.path}' does not exist but expectedHash was provided; omit expectedHash to create a new file`
          );
          error.code = 'STALE_FILE';
          throw error;
        }

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, args.content, 'utf8');

        return {
          path: args.path,
          created: !exists,
          bytesWritten: Buffer.byteLength(args.content, 'utf8'),
          newHash: this._hashContent(args.content)
        };
      }
    });

    this.register({
      name: 'list_files',
      description: 'List files in a directory',
      category: 'file',
      parameters: {
        path: { type: 'string', required: true, description: 'Relative directory path' },
        recursive: { type: 'boolean', required: false, description: 'Recursive listing' },
        pattern: { type: 'string', required: false, description: 'File pattern (glob)' }
      },
      handler: async (args) => {
        const dirPath = this._resolvePath(args.path);
        this._validateWorkspacePath(dirPath);
        
        const files = [];
        const recursive = args.recursive || false;
        
        const scan = (dir, prefix = '') => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          
          for (const entry of entries) {
            const relativePath = path.join(prefix, entry.name);
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
              if (recursive) {
                scan(fullPath, relativePath);
              }
            } else {
              if (!args.pattern || this._matchPattern(entry.name, args.pattern)) {
                const stats = fs.statSync(fullPath);
                files.push({
                  path: relativePath,
                  name: entry.name,
                  size: stats.size,
                  modified: stats.mtime.toISOString()
                });
              }
            }
          }
        };
        
        scan(dirPath);
        
        return {
          path: args.path,
          files,
          count: files.length
        };
      }
    });

    // Search operations
    this.register({
      name: 'search_files',
      description: 'Search for files by name pattern',
      category: 'search',
      parameters: {
        pattern: { type: 'string', required: true, description: 'File name pattern' },
        path: { type: 'string', required: false, description: 'Directory to search (default: workspace)' }
      },
      handler: async (args) => {
        const searchPath = args.path ? this._resolvePath(args.path) : this.workspace;
        this._validateWorkspacePath(searchPath);
        
        const matches = [];
        
        const scan = (dir, prefix = '') => {
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
              const relativePath = path.join(prefix, entry.name);
              const fullPath = path.join(dir, entry.name);
              
              if (entry.isDirectory()) {
                scan(fullPath, relativePath);
              } else if (this._matchPattern(entry.name, args.pattern)) {
                matches.push(relativePath);
                if (matches.length >= this.limits.maxSearchResults) {
                  return;
                }
              }
            }
          } catch (err) {
            // Skip directories we can't read
          }
        };
        
        scan(searchPath);
        
        return {
          pattern: args.pattern,
          matches,
          count: matches.length,
          truncated: matches.length >= this.limits.maxSearchResults
        };
      }
    });

    this.register({
      name: 'search_text',
      description: 'Search for text pattern in files',
      category: 'search',
      parameters: {
        pattern: { type: 'string', required: true, description: 'Text pattern to search' },
        path: { type: 'string', required: false, description: 'Directory to search' },
        filePattern: { type: 'string', required: false, description: 'File pattern to include' },
        caseSensitive: { type: 'boolean', required: false, description: 'Case sensitive search' }
      },
      handler: async (args) => {
        const searchPath = args.path ? this._resolvePath(args.path) : this.workspace;
        this._validateWorkspacePath(searchPath);
        
        const matches = [];
        const regex = new RegExp(args.pattern, args.caseSensitive ? 'g' : 'gi');
        
        const scan = (dir, prefix = '') => {
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
              const relativePath = path.join(prefix, entry.name);
              const fullPath = path.join(dir, entry.name);
              
              if (entry.isDirectory()) {
                scan(fullPath, relativePath);
              } else {
                if (args.filePattern && !this._matchPattern(entry.name, args.filePattern)) {
                  continue;
                }
                
                try {
                  const content = fs.readFileSync(fullPath, 'utf8');
                  const lines = content.split('\n');
                  
                  lines.forEach((line, lineNum) => {
                    if (regex.test(line)) {
                      matches.push({
                        file: relativePath,
                        line: lineNum + 1,
                        text: line.trim()
                      });
                      
                      if (matches.length >= this.limits.maxSearchResults) {
                        return;
                      }
                    }
                  });
                } catch (err) {
                  // Skip files we can't read
                }
              }
              
              if (matches.length >= this.limits.maxSearchResults) {
                return;
              }
            }
          } catch (err) {
            // Skip directories we can't read
          }
        };
        
        scan(searchPath);
        
        return {
          pattern: args.pattern,
          matches,
          count: matches.length,
          truncated: matches.length >= this.limits.maxSearchResults
        };
      }
    });

    // Allowlisted check runner: the model supplies only a check id (never shell
    // text). Replaces the former execute_command tool, which allowed arbitrary
    // model-supplied shell commands.
    this.register({
      name: 'run_check',
      description: `Run an allowlisted verification check by id (${ALLOWED_CHECK_IDS.join(', ')}). Does not accept shell text.`,
      category: 'check',
      parameters: {
        checkId: { type: 'string', required: true, description: `One of: ${ALLOWED_CHECK_IDS.join(', ')}` },
        files: { type: 'array', required: false, description: 'Workspace-relative files to scope the check to (lint only)' }
      },
      handler: async (args) => {
        if (!ALLOWED_CHECK_IDS.includes(args.checkId)) {
          const error = new Error(
            `Unknown check id '${args.checkId}'. Allowed check ids: ${ALLOWED_CHECK_IDS.join(', ')}`
          );
          error.code = 'UNKNOWN_CHECK';
          throw error;
        }

        const files = Array.isArray(args.files) ? args.files : [];
        for (const file of files) {
          this._validateWorkspacePath(this._resolvePath(file));
        }

        return this._runCheck(args.checkId, files);
      }
    });

    // Diagnostics: real linter output, or an explicit unavailable result.
    // Never reports zero issues when diagnostics were not actually collected.
    this.register({
      name: 'get_diagnostics',
      description: 'Get real linter diagnostics for files, or report that diagnostics are unavailable',
      category: 'diagnostics',
      parameters: {
        files: { type: 'array', required: false, description: 'Files to analyze (default: all)' }
      },
      handler: async (args) => {
        const files = Array.isArray(args.files) ? args.files : [];
        for (const file of files) {
          this._validateWorkspacePath(this._resolvePath(file));
        }
        return this._collectDiagnostics(files);
      }
    });
  }

  // ─── Check runners ────────────────────────────────────────────────────────────

  async _runCheck(checkId, files) {
    if (this.checkRunners && typeof this.checkRunners[checkId] === 'function') {
      return this.checkRunners[checkId](files, this);
    }
    switch (checkId) {
      case 'lint':
        return this._collectDiagnostics(files, 'lint');
      case 'typecheck':
        return this._runTypecheckCheck();
      case 'test':
        return this._runNpmScriptCheck('test', 'test');
      case 'build':
        return this._runNpmScriptCheck('build', 'build');
      default:
        throw new Error(`No runner configured for check id '${checkId}'`);
    }
  }

  async _collectDiagnostics(files, checkId = 'diagnostics') {
    const orchestrator = new LinterOrchestrator(this.workspace);
    const availableLinters = orchestrator.detectAvailableLinters();
    const anyAvailable = Object.values(availableLinters).some(Boolean);

    if (!anyAvailable) {
      return {
        checkId,
        available: false,
        reason: 'No linters are configured or installed in this workspace',
        files,
        diagnostics: null,
        summary: null
      };
    }

    const result = await orchestrator.runAll(files, {});
    const diagnostics = result.issues.slice(0, this.limits.maxSearchResults);
    const errors = result.issues.filter(issue => issue.severity === 'ERROR').length;
    const warnings = result.issues.filter(issue => issue.severity === 'WARNING').length;

    return {
      checkId,
      available: true,
      passed: result.totalIssues === 0,
      files,
      diagnostics,
      truncated: result.issues.length > diagnostics.length,
      summary: { total: result.totalIssues, errors, warnings }
    };
  }

  async _runTypecheckCheck() {
    const packageJson = this._readPackageJson();
    const hasTypescript = !!(packageJson &&
      ((packageJson.dependencies && packageJson.dependencies.typescript) ||
       (packageJson.devDependencies && packageJson.devDependencies.typescript)));
    if (!hasTypescript) {
      return { checkId: 'typecheck', available: false, reason: 'TypeScript is not configured for this workspace' };
    }

    const tscBin = path.join(this.workspace, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
    if (!fs.existsSync(tscBin)) {
      return { checkId: 'typecheck', available: false, reason: 'tsc binary not found in node_modules/.bin' };
    }

    try {
      const { stdout, stderr } = await execFileAsync(tscBin, ['--noEmit'], {
        cwd: this.workspace,
        timeout: this.limits.checkTimeout,
        maxBuffer: this.limits.maxOutputSize,
        // .cmd shims require a shell on Windows; args remain a fixed literal array.
        shell: process.platform === 'win32'
      });
      return {
        checkId: 'typecheck',
        available: true,
        passed: true,
        stdout: stdout.substring(0, this.limits.maxOutputSize),
        stderr: stderr.substring(0, this.limits.maxOutputSize)
      };
    } catch (error) {
      return {
        checkId: 'typecheck',
        available: true,
        passed: false,
        exitCode: typeof error.code === 'number' ? error.code : 1,
        stdout: (error.stdout || '').substring(0, this.limits.maxOutputSize),
        stderr: (error.stderr || error.message).substring(0, this.limits.maxOutputSize)
      };
    }
  }

  async _runNpmScriptCheck(checkId, scriptName) {
    const packageJson = this._readPackageJson();
    if (!packageJson) {
      return { checkId, available: false, reason: 'No package.json found in this workspace' };
    }
    if (!packageJson.scripts || !packageJson.scripts[scriptName]) {
      return { checkId, available: false, reason: `No npm script named '${scriptName}' is configured` };
    }

    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
      const { stdout, stderr } = await execFileAsync(npmBin, ['run', scriptName], {
        cwd: this.workspace,
        timeout: this.limits.checkTimeout,
        maxBuffer: this.limits.maxOutputSize,
        // .cmd shims require a shell on Windows; args remain a fixed literal array.
        shell: process.platform === 'win32'
      });
      return {
        checkId,
        available: true,
        passed: true,
        stdout: stdout.substring(0, this.limits.maxOutputSize),
        stderr: stderr.substring(0, this.limits.maxOutputSize)
      };
    } catch (error) {
      return {
        checkId,
        available: true,
        passed: false,
        exitCode: typeof error.code === 'number' ? error.code : 1,
        stdout: (error.stdout || '').substring(0, this.limits.maxOutputSize),
        stderr: (error.stderr || error.message).substring(0, this.limits.maxOutputSize)
      };
    }
  }

  _readPackageJson() {
    const packageJsonPath = path.join(this.workspace, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch (error) {
      return null;
    }
  }

  _hashContent(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  // ─── Helper methods ───────────────────────────────────────────────────────────

  _resolvePath(relativePath) {
    return path.resolve(this.workspace, relativePath);
  }

  _validateWorkspacePath(absolutePath) {
    const check = this.permissionManager.validatePath(path.normalize(absolutePath));
    if (!check.valid) {
      const error = new Error(check.reason);
      error.code = 'PATH_DENIED';
      throw error;
    }
    const normalized = path.resolve(absolutePath);
    let existingPath = normalized;
    while (!fs.existsSync(existingPath)) {
      const parent = path.dirname(existingPath);
      if (parent === existingPath) break;
      existingPath = parent;
    }
    const realPath = fs.realpathSync(existingPath);
    const realRelative = path.relative(this.workspace, realPath);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      throw new Error(`Path '${absolutePath}' resolves outside workspace`);
    }
  }

  _validateArgs(tool, args) {
    const errors = [];
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { valid: false, errors: ['Arguments must be an object'] };
    }
    
    for (const [paramName, paramDef] of Object.entries(tool.parameters || {})) {
      const value = args[paramName];
      
      if (paramDef.required && value === undefined) {
        errors.push(`Missing required parameter '${paramName}'`);
        continue;
      }
      
      if (value !== undefined) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== paramDef.type) {
          errors.push(`Parameter '${paramName}' must be ${paramDef.type}, got ${actualType}`);
        } else if (typeof value === 'string' && paramDef.required && !value.trim()) {
          errors.push(`Parameter '${paramName}' must not be empty`);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  _boundOutput(data) {
    let serialized;
    try { serialized = JSON.stringify(data); }
    catch (error) { throw new Error(`Tool returned non-serializable output: ${error.message}`); }
    if (Buffer.byteLength(serialized, 'utf8') <= this.limits.maxOutputSize) return data;
    return { truncated: true, preview: serialized.slice(0, this.limits.maxOutputSize) };
  }

  _matchPattern(name, pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    return regex.test(name);
  }

  _result(success, data, error, duration, code = null) {
    return { success, data, error: error || null, code: success ? null : (code || null), duration };
  }

  _logExecution(toolName, args, result, context = {}, argsValidated = false) {
    this.executionLog.push({
      tool: toolName,
      args: this._sanitizeArgs(args),
      argsValidated,
      success: result.success,
      code: result.code || null,
      duration: result.duration,
      output: this._boundLoggedOutput(result.data),
      itemId: context.itemId || null,
      taskId: context.taskId || null,
      stepId: context.stepId || null,
      timestamp: new Date().toISOString()
    });
    
    // Trim log if too large
    if (this.executionLog.length > this.maxLogSize) {
      this.executionLog = this.executionLog.slice(-this.maxLogSize);
    }
  }

  _sanitizeArgs(args) {
    return this._sanitizeForLog(args);
  }

  _sanitizeForLog(value, key = '') {
    if (/password|secret|token|api.?key|authorization|credential/i.test(key)) return '[REDACTED]';
    if (typeof value === 'string') {
      const redacted = (this.permissionManager?.redactSecrets(value) || value)
        .replace(/(api[_-]?key|password|secret|token)\s*([:=])\s*(['"]?)[^\s,'"}]+/gi, '$1$2[REDACTED]')
        .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
      return key === 'workspace' ? undefined :
        (key === 'content' && redacted.length > 100 ? `${redacted.slice(0, 100)}...` : redacted);
    }
    if (Array.isArray(value)) return value.map(item => this._sanitizeForLog(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value)
        .filter(([entryKey]) => entryKey !== 'workspace')
        .map(([entryKey, entryValue]) => [entryKey, this._sanitizeForLog(entryValue, entryKey)]));
    }
    return value;
  }

  /**
   * Bound a tool result's data for the execution log so logs cannot grow unbounded.
   * @param {*} data
   * @returns {*}
   */
  _boundLoggedOutput(data) {
    if (data === null || data === undefined) return data;
    let serialized;
    try {
      serialized = JSON.stringify(data);
    } catch (error) {
      return '[unserializable output]';
    }
    if (serialized.length <= this.limits.maxOutputSize) {
      return data;
    }
    return {
      truncated: true,
      preview: serialized.substring(0, this.limits.maxOutputSize)
    };
  }
}

module.exports = {
  ToolRegistry,
  ALLOWED_CHECK_IDS
};

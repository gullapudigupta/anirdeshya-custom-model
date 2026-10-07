/**
 * Coding Agent Tool Registry (P9-T013)
 *
 * Exposes typed agent tools for file operations, searching, editing,
 * diagnostics, terminal execution, and more. All tools have validated
 * inputs, structured outputs, and bounded execution.
 *
 * @module agent/tool-registry
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Tool execution result
 * @typedef {Object} ToolResult
 * @property {boolean} success
 * @property {*} data - Tool-specific output data
 * @property {string} [error] - Error message if failed
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
    this.permissionManager = options.permissionManager || null;
    this.checkRunners = options.checkRunners || {};
    this.taskBudgets = new Map();
    
    // Execution limits
    this.limits = {
      maxFileSize: options.maxFileSize || 1024 * 1024, // 1MB
      maxOutputSize: options.maxOutputSize || 100 * 1024, // 100KB
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
      const missing = this._result(false, null, `Tool '${toolName}' not found`, 0);
      this._logExecution(toolName, args, missing, context, false);
      return missing;
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
        const invalid = this._result(false, null, `Invalid arguments: ${validation.errors.join(', ')}`, Date.now() - startTime);
        this._logExecution(toolName, args, invalid, context, false);
        return invalid;
      }
      argsValidated = true;

      if (this.permissionManager) {
        const permission = await this.permissionManager.checkPermission({
          type: toolName,
          params: args,
          taskId: context.taskId,
          planStepId: context.planStepId
        });
        if (!permission.allowed) {
          const denied = this._result(false, null, permission.reason || 'Permission denied', Date.now() - startTime);
          this._logExecution(toolName, args, denied, context, argsValidated);
          return denied;
        }
      }

      // Execute tool
      const rawData = await tool.handler({ ...args, workspace: this.workspace }, context);
      const data = this._boundOutput(rawData);
      const outputBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
      budget.outputBytes += outputBytes;
      if (budget.outputBytes > this.limits.maxOutputPerTask) {
        budget.outputBytes = this.limits.maxOutputPerTask;
        const exhausted = this._result(false, null, 'Per-task tool output budget exhausted', Date.now() - startTime);
        this._logExecution(toolName, args, exhausted, context, argsValidated);
        return exhausted;
      }
      const duration = Date.now() - startTime;
      
      const result = this._result(true, data, null, duration);
      this._logExecution(toolName, args, result, context, argsValidated);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const result = this._result(false, null, error.message, duration);
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
   * List all available tools
   * @returns {Array<Object>}
   */
  listTools() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      parameters: tool.parameters
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
          hash: crypto.createHash('sha256').update(content).digest('hex')
        };
      }
    });

    this.register({
      name: 'write_file',
      description: 'Write content to a file',
      category: 'file',
      parameters: {
        path: { type: 'string', required: true, description: 'Relative file path' },
        content: { type: 'string', required: true, description: 'File content' }
      },
      handler: async (args) => {
        throw new Error(`Direct file writes are unavailable to agent tools; use edit_file with a hash-guarded patch approval (${args.path})`);
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

    this.register({
      name: 'edit_file',
      description: 'Apply a hash-guarded content replacement through the approval-gated patch handler',
      category: 'file',
      parameters: {
        path: { type: 'string', required: true, description: 'Relative file path' },
        expectedHash: { type: 'string', required: true, description: 'SHA-256 hash returned by read_file' },
        content: { type: 'string', required: true, description: 'Complete replacement content' }
      },
      handler: async (args, context) => {
        if (Buffer.byteLength(args.content, 'utf8') > this.limits.maxFileSize) {
          throw new Error(`File content exceeds size limit (${this.limits.maxFileSize} bytes)`);
        }
        const filePath = this._resolvePath(args.path);
        this._validateWorkspacePath(filePath);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          throw new Error(`Cannot edit missing file: ${args.path}`);
        }
        const originalContent = fs.readFileSync(filePath, 'utf8');
        const actualHash = crypto.createHash('sha256').update(originalContent).digest('hex');
        if (actualHash !== args.expectedHash) {
          throw new Error(`Stale source for ${args.path}: expected hash does not match current content`);
        }
        if (typeof context.applyPatch !== 'function') {
          throw new Error('Approval-gated patch application is unavailable');
        }
        return context.applyPatch({
          path: args.path,
          expectedHash: actualHash,
          originalContent,
          content: args.content,
          taskId: context.taskId,
          planStepId: context.planStepId
        });
      }
    });

    this.register({
      name: 'run_check',
      description: 'Run a configured verification check by its registered check ID',
      category: 'verification',
      parameters: {
        checkId: { type: 'string', required: true, description: 'Registered check ID; no shell text is accepted' }
      },
      handler: async (args, context) => {
        const runner = this.checkRunners[args.checkId];
        if (typeof runner !== 'function') {
          throw new Error(`Verification check '${args.checkId}' is not configured`);
        }
        return runner({ workspace: this.workspace, taskId: context.taskId, signal: context.signal });
      }
    });

    this.register({
      name: 'get_diagnostics',
      description: 'Get code diagnostics/issues for files',
      category: 'diagnostics',
      parameters: {
        files: { type: 'array', required: false, description: 'Files to analyze (default: all)' }
      },
      handler: async () => {
        throw new Error('Diagnostics provider is not configured');
      }
    });
  }

  // ─── Helper methods ───────────────────────────────────────────────────────────

  _resolvePath(relativePath) {
    return path.resolve(this.workspace, relativePath);
  }

  _validateWorkspacePath(absolutePath) {
    const normalized = path.resolve(absolutePath);
    const relative = path.relative(this.workspace, normalized);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Path '${absolutePath}' is outside workspace`);
    }
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

  _matchPattern(name, pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    return regex.test(name);
  }

  _result(success, data, error, duration) {
    return { success, data, error: error || null, duration };
  }

  _boundOutput(data) {
    let serialized;
    try {
      serialized = JSON.stringify(data);
    } catch (error) {
      throw new Error(`Tool returned non-serializable output: ${error.message}`);
    }
    if (Buffer.byteLength(serialized, 'utf8') <= this.limits.maxOutputSize) return data;
    return {
      truncated: true,
      preview: serialized.slice(0, this.limits.maxOutputSize)
    };
  }

  _logExecution(toolName, args, result, context = {}, argsValidated = false) {
    const output = this._sanitizeForLog(result.success ? result.data : { error: result.error });
    const boundedOutput = this._boundOutput(output);
    const serializedOutput = JSON.stringify(boundedOutput);
    this.executionLog.push({
      tool: toolName,
      args: this._sanitizeArgs(args),
      argsValidated,
      success: result.success,
      status: result.success ? 'succeeded' : 'failed',
      duration: result.duration,
      durationMs: result.duration,
      outputBytes: Buffer.byteLength(serializedOutput, 'utf8'),
      output: boundedOutput,
      taskId: context.taskId || null,
      planStepId: context.planStepId || null,
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
}

module.exports = {
  ToolRegistry
};

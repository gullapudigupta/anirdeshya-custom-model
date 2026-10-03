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
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

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
    this.workspace = options.workspace || process.cwd();
    this.tools = new Map();
    this.executionLog = [];
    this.maxLogSize = options.maxLogSize || 1000;
    
    // Execution limits
    this.limits = {
      maxFileSize: options.maxFileSize || 1024 * 1024, // 1MB
      maxOutputSize: options.maxOutputSize || 100 * 1024, // 100KB
      terminalTimeout: options.terminalTimeout || 30000, // 30s
      maxSearchResults: options.maxSearchResults || 100
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
      return this._result(false, null, `Tool '${toolName}' not found`, 0);
    }

    const startTime = Date.now();
    
    try {
      // Validate arguments
      const validation = this._validateArgs(tool, args);
      if (!validation.valid) {
        return this._result(false, null, `Invalid arguments: ${validation.errors.join(', ')}`, Date.now() - startTime);
      }

      // Execute tool
      const data = await tool.handler({ ...args, workspace: this.workspace }, context);
      const duration = Date.now() - startTime;
      
      const result = this._result(true, data, null, duration);
      this._logExecution(toolName, args, result);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const result = this._result(false, null, error.message, duration);
      this._logExecution(toolName, args, result);
      
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
          linesRead: selectedLines.length
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
        const filePath = this._resolvePath(args.path);
        this._validateWorkspacePath(filePath);
        
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, args.content, 'utf8');
        
        return {
          path: args.path,
          bytesWritten: Buffer.byteLength(args.content, 'utf8')
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

    // Terminal operations
    this.register({
      name: 'execute_command',
      description: 'Execute a terminal command',
      category: 'terminal',
      parameters: {
        command: { type: 'string', required: true, description: 'Command to execute' },
        cwd: { type: 'string', required: false, description: 'Working directory' },
        timeout: { type: 'number', required: false, description: 'Timeout in milliseconds' }
      },
      handler: async (args) => {
        const cwd = args.cwd ? this._resolvePath(args.cwd) : this.workspace;
        this._validateWorkspacePath(cwd);
        
        const timeout = args.timeout || this.limits.terminalTimeout;
        
        try {
          const { stdout, stderr } = await execAsync(args.command, {
            cwd,
            timeout,
            maxBuffer: this.limits.maxOutputSize
          });
          
          return {
            command: args.command,
            exitCode: 0,
            stdout: stdout.substring(0, this.limits.maxOutputSize),
            stderr: stderr.substring(0, this.limits.maxOutputSize),
            truncated: stdout.length > this.limits.maxOutputSize || stderr.length > this.limits.maxOutputSize
          };
        } catch (error) {
          return {
            command: args.command,
            exitCode: error.code || 1,
            stdout: (error.stdout || '').substring(0, this.limits.maxOutputSize),
            stderr: (error.stderr || error.message).substring(0, this.limits.maxOutputSize),
            truncated: false
          };
        }
      }
    });

    // Diagnostics
    this.register({
      name: 'get_diagnostics',
      description: 'Get code diagnostics/issues for files',
      category: 'diagnostics',
      parameters: {
        files: { type: 'array', required: false, description: 'Files to analyze (default: all)' }
      },
      handler: async (args) => {
        // Stub: would integrate with linter orchestrator
        return {
          files: args.files || [],
          diagnostics: [],
          summary: { total: 0, errors: 0, warnings: 0 }
        };
      }
    });
  }

  // ─── Helper methods ───────────────────────────────────────────────────────────

  _resolvePath(relativePath) {
    return path.resolve(this.workspace, relativePath);
  }

  _validateWorkspacePath(absolutePath) {
    const normalized = path.normalize(absolutePath);
    const workspaceNormalized = path.normalize(this.workspace);
    
    if (!normalized.startsWith(workspaceNormalized)) {
      throw new Error(`Path '${absolutePath}' is outside workspace`);
    }
  }

  _validateArgs(tool, args) {
    const errors = [];
    
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

  _logExecution(toolName, args, result) {
    this.executionLog.push({
      tool: toolName,
      args: this._sanitizeArgs(args),
      success: result.success,
      duration: result.duration,
      timestamp: new Date().toISOString()
    });
    
    // Trim log if too large
    if (this.executionLog.length > this.maxLogSize) {
      this.executionLog = this.executionLog.slice(-this.maxLogSize);
    }
  }

  _sanitizeArgs(args) {
    // Remove sensitive data from logs
    const sanitized = { ...args };
    delete sanitized.workspace;
    if (sanitized.content && sanitized.content.length > 100) {
      sanitized.content = sanitized.content.substring(0, 100) + '...';
    }
    return sanitized;
  }
}

module.exports = {
  ToolRegistry
};

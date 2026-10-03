/**
 * Workspace Context and Instruction Assembly (P9-T012)
 *
 * Gathers context from workspace:
 * - Current file, editor selection, task file, diagnostics
 * - Repository guidance (AGENTS.md, .kiro/steering, etc.)
 * - Workspace search with symbol references
 * - Respects ignore rules, size limits, token budgets
 *
 * @module workspace/context-assembler
 */

'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

/**
 * Context source types
 */
const ContextSourceType = {
  CURRENT_FILE: 'current-file',
  EDITOR_SELECTION: 'editor-selection',
  TASK_FILE: 'task-file',
  DIAGNOSTICS: 'diagnostics',
  EXPLICIT_FILE: 'explicit-file',
  REPOSITORY_GUIDANCE: 'repository-guidance',
  WORKSPACE_SEARCH: 'workspace-search',
  SYMBOL_REFERENCES: 'symbol-references'
};

/**
 * Context Assembler
 */
class ContextAssembler extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.workspace = options.workspace || process.cwd();
    this.maxFileSize = options.maxFileSize || 100 * 1024; // 100KB
    this.maxContextTokens = options.maxContextTokens || 50000;
    this.maxSearchResults = options.maxSearchResults || 20;
    
    // Ignore rules
    this.ignorePatterns = options.ignorePatterns || [
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      '*.min.js',
      '*.bundle.js',
      '.env',
      '.env.*',
      '**/*.secret',
      '**/credentials.json',
      '**/.aqt-cache/**'
    ];
    
    // Token estimation (rough: 1 token ≈ 4 characters)
    this.charsPerToken = 4;
  }

  // ─── Context Attachment ────────────────────────────────────────────────────────

  /**
   * Attach current file content
   * @param {string} filePath
   * @param {Object} options
   * @returns {Object}
   */
  attachCurrentFile(filePath, options = {}) {
    const resolvedPath = this._resolveWorkspacePath(filePath);
    
    if (!this._isWithinWorkspace(resolvedPath)) {
      throw new Error(`File '${filePath}' is outside workspace`);
    }
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File '${filePath}' not found`);
    }
    
    const stats = fs.statSync(resolvedPath);
    if (stats.size > this.maxFileSize) {
      // Truncate large files
      return this._attachTruncatedFile(resolvedPath, 'current-file', options);
    }
    
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const lines = content.split('\n');
    
    const contextSource = {
      type: ContextSourceType.CURRENT_FILE,
      path: this._relativePath(resolvedPath),
      content,
      lineCount: lines.length,
      size: stats.size,
      estimatedTokens: this._estimateTokens(content),
      language: this._detectLanguage(resolvedPath),
      selectedRange: options.selection || null
    };
    
    this.emit('context-attached', contextSource);
    return contextSource;
  }

  /**
   * Attach editor selection
   * @param {string} filePath
   * @param {Object} selection
   * @returns {Object}
   */
  attachEditorSelection(filePath, selection) {
    const resolvedPath = this._resolveWorkspacePath(filePath);
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const lines = content.split('\n');
    
    const selectedLines = lines.slice(selection.startLine - 1, selection.endLine);
    const selectedContent = selectedLines.join('\n');
    
    const contextSource = {
      type: ContextSourceType.EDITOR_SELECTION,
      path: this._relativePath(resolvedPath),
      content: selectedContent,
      range: {
        startLine: selection.startLine,
        endLine: selection.endLine,
        startColumn: selection.startColumn || 0,
        endColumn: selection.endColumn || selectedLines[selectedLines.length - 1]?.length || 0
      },
      estimatedTokens: this._estimateTokens(selectedContent),
      language: this._detectLanguage(resolvedPath)
    };
    
    this.emit('context-attached', contextSource);
    return contextSource;
  }

  /**
   * Attach task file
   * @param {string} taskFilePath
   * @returns {Object}
   */
  attachTaskFile(taskFilePath) {
    const resolvedPath = this._resolveWorkspacePath(taskFilePath);
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Task file '${taskFilePath}' not found`);
    }
    
    const content = fs.readFileSync(resolvedPath, 'utf8');
    let tasks = null;
    
    try {
      const parsed = JSON.parse(content);
      tasks = parsed.tasks || [parsed];
    } catch (error) {
      throw new Error(`Invalid task file format: ${error.message}`);
    }
    
    const contextSource = {
      type: ContextSourceType.TASK_FILE,
      path: this._relativePath(resolvedPath),
      content,
      tasks,
      taskCount: tasks.length,
      estimatedTokens: this._estimateTokens(content)
    };
    
    this.emit('context-attached', contextSource);
    return contextSource;
  }

  /**
   * Attach diagnostics
   * @param {Array<Object>} diagnostics
   * @returns {Object}
   */
  attachDiagnostics(diagnostics) {
    const formatted = diagnostics.map(d => ({
      file: d.file || d.filePath,
      line: d.line || d.startLine,
      column: d.column || d.startColumn,
      severity: d.severity,
      message: d.message,
      rule: d.rule || d.code,
      source: d.source
    }));
    
    const content = JSON.stringify(formatted, null, 2);
    
    const contextSource = {
      type: ContextSourceType.DIAGNOSTICS,
      diagnostics: formatted,
      content,
      count: formatted.length,
      estimatedTokens: this._estimateTokens(content)
    };
    
    this.emit('context-attached', contextSource);
    return contextSource;
  }

  /**
   * Attach explicit file
   * @param {string} filePath
   * @returns {Object}
   */
  attachExplicitFile(filePath) {
    const resolvedPath = this._resolveWorkspacePath(filePath);
    
    if (!this._isWithinWorkspace(resolvedPath)) {
      throw new Error(`File '${filePath}' is outside workspace`);
    }
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File '${filePath}' not found`);
    }
    
    if (this._shouldIgnore(resolvedPath)) {
      throw new Error(`File '${filePath}' is excluded by ignore rules`);
    }
    
    const stats = fs.statSync(resolvedPath);
    if (stats.size > this.maxFileSize) {
      return this._attachTruncatedFile(resolvedPath, 'explicit-file', {});
    }
    
    const content = fs.readFileSync(resolvedPath, 'utf8');
    
    const contextSource = {
      type: ContextSourceType.EXPLICIT_FILE,
      path: this._relativePath(resolvedPath),
      content,
      size: stats.size,
      estimatedTokens: this._estimateTokens(content),
      language: this._detectLanguage(resolvedPath)
    };
    
    this.emit('context-attached', contextSource);
    return contextSource;
  }

  // ─── Repository Guidance ────────────────────────────────────────────────────────

  /**
   * Load repository guidance files
   * @returns {Object}
   */
  loadRepositoryGuidance() {
    const guidanceFiles = [
      { path: 'AGENTS.md', description: 'Agent instructions' },
      { path: '.kiro/steering/AGENTS.md', description: 'Kiro agent steering' },
      { path: 'CONTRIBUTING.md', description: 'Contribution guidelines' },
      { path: 'DEVELOPMENT.md', description: 'Development guide' },
      { path: '.cursorrules', description: 'Cursor rules' },
      { path: '.claude/CLAUDE.md', description: 'Claude instructions' }
    ];
    
    const loaded = [];
    let totalTokens = 0;
    
    for (const guidance of guidanceFiles) {
      const fullPath = path.join(this.workspace, guidance.path);
      
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        
        if (stats.size > this.maxFileSize) {
          continue; // Skip large guidance files
        }
        
        const content = fs.readFileSync(fullPath, 'utf8');
        const tokens = this._estimateTokens(content);
        
        if (totalTokens + tokens > this.maxContextTokens / 4) {
          // Guidance shouldn't exceed 25% of context budget
          continue;
        }
        
        loaded.push({
          type: ContextSourceType.REPOSITORY_GUIDANCE,
          path: guidance.path,
          description: guidance.description,
          content,
          estimatedTokens: tokens
        });
        
        totalTokens += tokens;
      }
    }
    
    const contextSource = {
      type: ContextSourceType.REPOSITORY_GUIDANCE,
      files: loaded,
      count: loaded.length,
      estimatedTokens: totalTokens,
      applied: loaded.map(g => g.path)
    };
    
    this.emit('guidance-loaded', contextSource);
    return contextSource;
  }

  // ─── Workspace Search ──────────────────────────────────────────────────────────

  /**
   * Search workspace for pattern
   * @param {string} pattern
   * @param {Object} options
   * @returns {Object}
   */
  async searchWorkspace(pattern, options = {}) {
    const results = [];
    const fileTypes = options.fileTypes || ['js', 'ts', 'jsx', 'tsx', 'json', 'md'];
    const maxResults = options.maxResults || this.maxSearchResults;
    
    const files = this._findFiles(fileTypes);
    
    for (const file of files) {
      if (results.length >= maxResults) break;
      
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) break;
        
        if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
          const context = this._getLineContext(lines, i, 2);
          
          results.push({
            file: this._relativePath(file),
            line: i + 1,
            content: lines[i],
            context: context.join('\n'),
            language: this._detectLanguage(file)
          });
        }
      }
    }
    
    const contextSource = {
      type: ContextSourceType.WORKSPACE_SEARCH,
      pattern,
      results,
      count: results.length,
      estimatedTokens: this._estimateTokens(JSON.stringify(results))
    };
    
    this.emit('search-completed', contextSource);
    return contextSource;
  }

  /**
   * Find symbol references
   * @param {string} symbol
   * @param {string} sourceFile
   * @returns {Object}
   */
  findSymbolReferences(symbol, sourceFile = null) {
    const results = [];
    const files = this._findFiles(['js', 'ts', 'jsx', 'tsx']);
    
    // Pattern to match symbol usage
    const patterns = [
      new RegExp(`\\b${symbol}\\b`, 'g'),
      new RegExp(`\\b${symbol}\\s*\\(`, 'g'), // Function call
      new RegExp(`\\b${symbol}\\s*:`, 'g'),   // Object property
      new RegExp(`import.*${symbol}`, 'g')    // Import
    ];
    
    for (const file of files) {
      if (sourceFile && this._relativePath(file) === sourceFile) continue;
      
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of patterns) {
          if (pattern.test(lines[i])) {
            results.push({
              file: this._relativePath(file),
              line: i + 1,
              content: lines[i].trim(),
              language: this._detectLanguage(file)
            });
            break; // Only one match per line
          }
        }
      }
    }
    
    const contextSource = {
      type: ContextSourceType.SYMBOL_REFERENCES,
      symbol,
      results: results.slice(0, this.maxSearchResults),
      count: Math.min(results.length, this.maxSearchResults),
      estimatedTokens: this._estimateTokens(JSON.stringify(results.slice(0, 20)))
    };
    
    this.emit('references-found', contextSource);
    return contextSource;
  }

  // ─── Context Assembly ───────────────────────────────────────────────────────────

  /**
   * Assemble context for request
   * @param {Object} request
   * @returns {Object}
   */
  assembleContext(request) {
    const context = {
      sources: [],
      estimatedTokens: 0,
      warnings: []
    };
    
    // Attach current file if provided
    if (request.currentFile) {
      try {
        const source = this.attachCurrentFile(request.currentFile, {
          selection: request.selection
        });
        context.sources.push(source);
        context.estimatedTokens += source.estimatedTokens;
      } catch (error) {
        context.warnings.push(`Failed to attach current file: ${error.message}`);
      }
    }
    
    // Attach task file if provided
    if (request.taskFile) {
      try {
        const source = this.attachTaskFile(request.taskFile);
        context.sources.push(source);
        context.estimatedTokens += source.estimatedTokens;
      } catch (error) {
        context.warnings.push(`Failed to attach task file: ${error.message}`);
      }
    }
    
    // Attach diagnostics if provided
    if (request.diagnostics && request.diagnostics.length > 0) {
      const source = this.attachDiagnostics(request.diagnostics);
      context.sources.push(source);
      context.estimatedTokens += source.estimatedTokens;
    }
    
    // Attach explicit files
    if (request.files && request.files.length > 0) {
      for (const file of request.files) {
        try {
          const source = this.attachExplicitFile(file);
          context.sources.push(source);
          context.estimatedTokens += source.estimatedTokens;
        } catch (error) {
          context.warnings.push(`Failed to attach file '${file}': ${error.message}`);
        }
      }
    }
    
    // Load repository guidance
    const guidance = this.loadRepositoryGuidance();
    if (guidance.count > 0) {
      context.sources.push(guidance);
      context.estimatedTokens += guidance.estimatedTokens;
      context.guidanceApplied = guidance.applied;
    }
    
    // Check token budget
    if (context.estimatedTokens > this.maxContextTokens) {
      context.warnings.push(
        `Context exceeds token budget (${context.estimatedTokens} > ${this.maxContextTokens}). ` +
        `Some content may be truncated.`
      );
    }
    
    // Build prompt context
    context.promptContext = this._buildPromptContext(context);
    
    this.emit('context-assembled', context);
    return context;
  }

  /**
   * Show context sources and token usage
   * @param {Object} context
   * @returns {Object}
   */
  getContextSummary(context) {
    return {
      sources: context.sources.map(s => ({
        type: s.type,
        path: s.path || null,
        description: s.description || null,
        estimatedTokens: s.estimatedTokens,
        lines: s.lineCount || s.count || null
      })),
      totalEstimatedTokens: context.estimatedTokens,
      warnings: context.warnings,
      guidanceApplied: context.guidanceApplied || []
    };
  }

  // ─── Private Methods ───────────────────────────────────────────────────────────

  /**
   * Resolve path relative to workspace
   */
  _resolveWorkspacePath(filePath) {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.workspace, filePath);
  }

  /**
   * Check if path is within workspace
   */
  _isWithinWorkspace(filePath) {
    const resolved = path.resolve(filePath);
    const workspaceResolved = path.resolve(this.workspace);
    return resolved.startsWith(workspaceResolved);
  }

  /**
   * Get relative path from workspace
   */
  _relativePath(filePath) {
    return path.relative(this.workspace, filePath);
  }

  /**
   * Check if file should be ignored
   */
  _shouldIgnore(filePath) {
    const relative = this._relativePath(filePath);
    
    for (const pattern of this.ignorePatterns) {
      if (this._matchesPattern(relative, pattern)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Simple pattern matching
   */
  _matchesPattern(filePath, pattern) {
    if (pattern.includes('**')) {
      const base = pattern.replace('**/', '').replace('/**', '');
      return filePath.includes(base);
    }
    
    if (pattern.startsWith('*')) {
      const ext = pattern.slice(1);
      return filePath.endsWith(ext);
    }
    
    return filePath.includes(pattern);
  }

  /**
   * Estimate token count
   */
  _estimateTokens(content) {
    return Math.ceil(content.length / this.charsPerToken);
  }

  /**
   * Detect language from file extension
   */
  _detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.json': 'json',
      '.md': 'markdown',
      '.py': 'python',
      '.java': 'java',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.php': 'php'
    };
    
    return languageMap[ext] || 'text';
  }

  /**
   * Attach truncated file
   */
  _attachTruncatedFile(filePath, type, options) {
    const stats = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(this.maxFileSize);
    
    fs.readSync(fd, buffer, 0, this.maxFileSize, 0);
    fs.closeSync(fd);
    
    const content = buffer.toString('utf8');
    
    return {
      type,
      path: this._relativePath(filePath),
      content,
      size: stats.size,
      truncated: true,
      truncatedSize: this.maxFileSize,
      estimatedTokens: this._estimateTokens(content),
      language: this._detectLanguage(filePath),
      warning: `File truncated (${stats.size} > ${this.maxFileSize} bytes)`
    };
  }

  /**
   * Get line context
   */
  _getLineContext(lines, lineIndex, contextLines) {
    const start = Math.max(0, lineIndex - contextLines);
    const end = Math.min(lines.length, lineIndex + contextLines + 1);
    return lines.slice(start, end);
  }

  /**
   * Find files by type
   */
  _findFiles(fileTypes) {
    const results = [];
    const extensions = fileTypes.map(t => t.startsWith('.') ? t : `.${t}`);
    
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (!this._shouldIgnore(fullPath)) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext) && !this._shouldIgnore(fullPath)) {
            results.push(fullPath);
          }
        }
      }
    };
    
    walk(this.workspace);
    return results;
  }

  /**
   * Build prompt context string
   */
  _buildPromptContext(context) {
    const parts = [];
    
    // Add repository guidance first
    const guidance = context.sources.find(s => s.type === ContextSourceType.REPOSITORY_GUIDANCE);
    if (guidance && guidance.files) {
      parts.push('## Repository Guidance\n');
      for (const file of guidance.files) {
        parts.push(`### ${file.path}\n${file.content}\n\n`);
      }
    }
    
    // Add current file
    const currentFile = context.sources.find(s => s.type === ContextSourceType.CURRENT_FILE);
    if (currentFile) {
      parts.push(`## Current File: ${currentFile.path}\n\`\`\`${currentFile.language}\n${currentFile.content}\n\`\`\`\n\n`);
    }
    
    // Add diagnostics
    const diagnostics = context.sources.find(s => s.type === ContextSourceType.DIAGNOSTICS);
    if (diagnostics) {
      parts.push(`## Diagnostics\n${diagnostics.content}\n\n`);
    }
    
    // Add task file
    const taskFile = context.sources.find(s => s.type === ContextSourceType.TASK_FILE);
    if (taskFile) {
      parts.push(`## Tasks\n${taskFile.content}\n\n`);
    }
    
    // Add explicit files
    for (const source of context.sources) {
      if (source.type === ContextSourceType.EXPLICIT_FILE) {
        parts.push(`## File: ${source.path}\n\`\`\`${source.language}\n${source.content}\n\`\`\`\n\n`);
      }
    }
    
    return parts.join('');
  }
}

module.exports = {
  ContextAssembler,
  ContextSourceType
};

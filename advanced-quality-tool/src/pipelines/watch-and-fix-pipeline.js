/**
 * Continuous Watch and Auto-Fix Pipeline (P9-T030)
 *
 * Instruments FileWatcher events, debouncing, changed-file analysis,
 * and optional auto-fix as a pipeline.
 *
 * @module pipelines/watch-and-fix-pipeline
 */

'use strict';

const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');
const fs = require('fs');
const path = require('path');

/**
 * Watch event types
 */
const WatchEventType = {
  CREATE: 'create',
  MODIFY: 'modify',
  DELETE: 'delete',
  RENAME: 'rename'
};

/**
 * Watch and Auto-Fix Pipeline
 */
class WatchAndFixPipeline {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.executor = options.executor || new PipelineExecutor();
    
    // Configuration
    this.patterns = options.patterns || ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'];
    this.excludePatterns = options.excludePatterns || ['node_modules/**', 'dist/**', '.git/**'];
    this.debounceMs = options.debounceMs || 500;
    this.autoFix = options.autoFix !== false;
    this.maxConcurrentRuns = options.maxConcurrentRuns || 1;
    
    // State
    this.watching = false;
    this.watchers = [];
    this.pendingChanges = new Map();
    this.debounceTimers = new Map();
    this.activeRuns = 0;
    this.eventHistory = [];
    
    // Handlers
    this.onAnalysisComplete = options.onAnalysisComplete || null;
    this.onFixComplete = options.onFixComplete || null;
    this.onError = options.onError || null;
  }

  /**
   * Start watching for file changes
   * @returns {Object} Start result
   */
  start() {
    if (this.watching) {
      return { alreadyWatching: true };
    }
    
    // Discover files to watch
    const files = this._discoverFiles();
    
    // Set up watchers
    this._setupWatchers(files);
    
    this.watching = true;
    
    return {
      watching: true,
      filesWatched: files.length,
      patterns: this.patterns,
      autoFix: this.autoFix
    };
  }

  /**
   * Stop watching
   */
  stop() {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch (error) {
        // Ignore close errors
      }
    }
    
    // Clear timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    
    this.watchers = [];
    this.debounceTimers.clear();
    this.watching = false;
    
    return { stopped: true };
  }

  /**
   * Execute the watch pipeline for a change event
   * @param {Object} event
   * @returns {Promise<Object>}
   */
  async execute(event) {
    const stageHandlers = {
      'discover-files': async (ctx) => this._discoverFiles(ctx),
      'subscribe': async (ctx) => this._subscribe(ctx),
      'detect-change': async (ctx) => this._detectChange(ctx, event),
      'debounce': async (ctx) => this._debounce(ctx),
      'analyze-changed-files': async (ctx) => this._analyzeChangedFiles(ctx),
      'optionally-fix': async (ctx) => this._optionallyFix(ctx),
      'publish-event': async (ctx) => this._publishEvent(ctx),
      'record-run': async (ctx) => this._recordRun(ctx)
    };

    const result = await this.executor.execute('watch-and-fix', {
      input: { event, autoFix: this.autoFix },
      workspace: this.workspace,
      stageHandlers
    });

    return result;
  }

  /**
   * Get current status
   * @returns {Object}
   */
  getStatus() {
    return {
      watching: this.watching,
      filesWatched: this.watchers.length,
      pendingChanges: this.pendingChanges.size,
      activeRuns: this.activeRuns,
      autoFix: this.autoFix,
      lastEvent: this.eventHistory[this.eventHistory.length - 1] || null
    };
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _discoverFiles(ctx) {
    const files = [];
    
    const walk = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            if (!this._isExcluded(fullPath)) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            if (this._matchesPattern(fullPath)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        // Ignore permission errors
      }
    };
    
    walk(this.workspace);
    
    return { files, count: files.length };
  }

  async _subscribe(ctx) {
    const files = ctx.previousResults?.['discover-files']?.files || [];
    
    return {
      subscribed: this.watching,
      patterns: this.patterns,
      excludePatterns: this.excludePatterns
    };
  }

  async _detectChange(ctx, event) {
    const { file, type } = event;
    
    // Validate file is within workspace
    const absolutePath = path.isAbsolute(file) ? file : path.join(this.workspace, file);
    
    if (!absolutePath.startsWith(this.workspace)) {
      return { valid: false, reason: 'File outside workspace' };
    }
    
    // Check if file matches patterns
    const matches = this._matchesPattern(absolutePath);
    
    return {
      file: absolutePath,
      type,
      valid: matches,
      excluded: this._isExcluded(absolutePath)
    };
  }

  async _debounce(ctx) {
    const change = ctx.previousResults?.['detect-change'];
    
    if (!change?.valid) {
      return { debounced: false, reason: 'Invalid change' };
    }
    
    const file = change.file;
    
    // Add to pending changes
    this.pendingChanges.set(file, {
      file,
      type: change.type,
      timestamp: Date.now()
    });
    
    // Wait for debounce period
    await new Promise(resolve => {
      const existingTimer = this.debounceTimers.get(file);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      
      const timer = setTimeout(() => {
        this.debounceTimers.delete(file);
        resolve();
      }, this.debounceMs);
      
      this.debounceTimers.set(file, timer);
    });
    
    return {
      debounced: true,
      pendingFiles: Array.from(this.pendingChanges.keys())
    };
  }

  async _analyzeChangedFiles(ctx) {
    const pendingFiles = Array.from(this.pendingChanges.values());
    
    if (pendingFiles.length === 0) {
      return { issues: [], files: [] };
    }
    
    // Analyze each changed file
    const issues = [];
    const analyzedFiles = [];
    
    for (const change of pendingFiles) {
      if (!fs.existsSync(change.file)) {
        continue;
      }
      
      try {
        const content = fs.readFileSync(change.file, 'utf8');
        const fileIssues = this._quickAnalyze(change.file, content);
        issues.push(...fileIssues);
        analyzedFiles.push(change.file);
      } catch (error) {
        // Skip files that can't be read
      }
    }
    
    return { issues, files: analyzedFiles };
  }

  async _optionallyFix(ctx) {
    const { issues, files } = ctx.previousResults?.['analyze-changed-files'] || {};
    
    if (!this.autoFix || !issues || issues.length === 0) {
      return { 
        fixed: false, 
        reason: this.autoFix ? 'No issues to fix' : 'Auto-fix disabled' 
      };
    }
    
    // Check concurrent run limit
    if (this.activeRuns >= this.maxConcurrentRuns) {
      return { 
        fixed: false, 
        reason: 'Max concurrent runs reached' 
      };
    }
    
    this.activeRuns++;
    
    try {
      // Apply simple fixes
      const fixed = [];
      
      for (const issue of issues) {
        if (issue.quickFix) {
          const result = await this._applyQuickFix(issue);
          if (result.success) {
            fixed.push(issue);
          }
        }
      }
      
      return {
        fixed: true,
        fixedIssues: fixed.length,
        remainingIssues: issues.length - fixed.length
      };
    } finally {
      this.activeRuns--;
    }
  }

  async _publishEvent(ctx) {
    const event = {
      timestamp: Date.now(),
      files: ctx.previousResults?.['analyze-changed-files']?.files || [],
      issues: ctx.previousResults?.['analyze-changed-files']?.issues?.length || 0,
      fixed: ctx.previousResults?.['optionally-fix']?.fixedIssues || 0
    };
    
    this.eventHistory.push(event);
    
    // Keep only last 100 events
    if (this.eventHistory.length > 100) {
      this.eventHistory = this.eventHistory.slice(-100);
    }
    
    // Clear pending changes
    this.pendingChanges.clear();
    
    // Call handler if set
    if (this.onAnalysisComplete) {
      try {
        this.onAnalysisComplete(event);
      } catch (error) {
        // Ignore handler errors
      }
    }
    
    return { published: true, event };
  }

  async _recordRun(ctx) {
    return {
      recorded: true,
      runId: ctx.runId,
      completedAt: Date.now()
    };
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────────

  _setupWatchers(files) {
    // Set up directory watchers
    const dirs = new Set([this.workspace]);
    
    for (const file of files) {
      const dir = path.dirname(file);
      dirs.add(dir);
    }
    
    for (const dir of dirs) {
      try {
        const watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
          if (filename) {
            const filePath = path.join(dir, filename);
            this._handleFileChange(filePath, eventType);
          }
        });
        
        this.watchers.push(watcher);
      } catch (error) {
        // Some directories may not be watchable
      }
    }
  }

  _handleFileChange(filePath, eventType) {
    const type = eventType === 'rename' ? WatchEventType.RENAME : WatchEventType.MODIFY;
    
    // Execute pipeline for change
    this.execute({
      file: filePath,
      type
    }).catch(error => {
      if (this.onError) {
        this.onError(error, filePath);
      }
    });
  }

  _discoverFiles() {
    const files = [];
    
    const walk = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            if (!this._isExcluded(fullPath)) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            if (this._matchesPattern(fullPath)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        // Ignore errors
      }
    };
    
    walk(this.workspace);
    return files;
  }

  _matchesPattern(filePath) {
    const relative = path.relative(this.workspace, filePath);
    
    for (const pattern of this.patterns) {
      if (this._matchGlob(relative, pattern)) {
        return true;
      }
    }
    
    return false;
  }

  _isExcluded(filePath) {
    const relative = path.relative(this.workspace, filePath);
    
    for (const pattern of this.excludePatterns) {
      if (this._matchGlob(relative, pattern)) {
        return true;
      }
    }
    
    // Check common exclusions
    const parts = relative.split(/[/\\]/);
    return parts.includes('node_modules') || 
           parts.includes('.git') ||
           parts.includes('dist') ||
           parts.includes('build');
  }

  _matchGlob(str, pattern) {
    // Simple glob matching
    const regex = pattern
      .replace(/\*\*/g, '<<DOUBLESTAR>>')
      .replace(/\*/g, '[^/\\\\]*')
      .replace(/<<DOUBLESTAR>>/g, '.*')
      .replace(/\?/g, '.');
    
    return new RegExp(`^${regex}$`).test(str);
  }

  _quickAnalyze(file, content) {
    const issues = [];
    const lines = content.split('\n');
    
    // Simple pattern-based analysis
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for common issues
      if (line.includes('console.log')) {
        issues.push({
          file,
          line: i + 1,
          message: 'Unexpected console.log',
          severity: 'warning',
          quickFix: true
        });
      }
      
      if (line.includes('TODO') || line.includes('FIXME')) {
        issues.push({
          file,
          line: i + 1,
          message: 'Unresolved TODO comment',
          severity: 'info',
          quickFix: false
        });
      }
    }
    
    return issues;
  }

  async _applyQuickFix(issue) {
    // Placeholder for quick fix logic
    return { success: false, reason: 'No quick fix available' };
  }
}

module.exports = {
  WatchAndFixPipeline,
  WatchEventType
};

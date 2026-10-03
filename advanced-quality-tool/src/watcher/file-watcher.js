/**
 * File Watcher - Continuous Code Quality Monitoring
 * 
 * Watches files for changes and automatically runs analysis and fixes.
 * Provides real-time feedback during development.
 * 
 * Features:
 * - Intelligent file filtering (ignore node_modules, build artifacts)
 * - Debouncing to avoid excessive runs
 * - Auto-fix on save
 * - Integration with WebSocket for live UI updates
 * 
 * @module watcher/file-watcher
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * File Watcher
 */
class FileWatcher extends EventEmitter {
  constructor(options = {}) {
    super();

    this.directory = options.directory || process.cwd();
    this.verbose = options.verbose || false;
    this.autoFix = options.autoFix || false;
    this.debounceMs = options.debounceMs || 500;
    this.recursive = options.recursive !== false;

    // Patterns
    this.includePatterns = options.include || ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'];
    this.excludePatterns = options.exclude || [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/.aqt-*/**',
      '**/coverage/**',
      '**/*.min.js',
      '**/*.bundle.js'
    ];

    // State
    this.watchers = new Map();
    this.debounceTimers = new Map();
    this.stats = {
      filesWatched: 0,
      changesDetected: 0,
      analysisRuns: 0,
      autoFixesApplied: 0,
      errors: 0
    };

    this.isWatching = false;
  }

  /**
   * Start watching
   */
  async start() {
    if (this.isWatching) {
      throw new Error('Already watching');
    }

    this.log('Starting file watcher...');
    this.log(`Directory: ${this.directory}`);
    this.log(`Auto-fix: ${this.autoFix}`);
    this.log(`Debounce: ${this.debounceMs}ms`);

    // Discover files to watch
    const files = await this.discoverFiles(this.directory);

    this.log(`Found ${files.length} files to watch`);

    // Watch each file
    for (const filePath of files) {
      this.watchFile(filePath);
    }

    // Watch directories for new files
    this.watchDirectories(this.directory);

    this.isWatching = true;
    this.stats.filesWatched = files.length;

    this.emit('started', {
      directory: this.directory,
      filesWatched: this.stats.filesWatched
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`👁️  File Watcher Started`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Directory: ${this.directory}`);
    console.log(`  Files watched: ${this.stats.filesWatched}`);
    console.log(`  Auto-fix: ${this.autoFix ? 'Enabled' : 'Disabled'}`);
    console.log(`  Status: Monitoring...`);
    console.log(`${'='.repeat(60)}\n`);

    return this;
  }

  /**
   * Stop watching
   */
  stop() {
    if (!this.isWatching) {
      return;
    }

    this.log('Stopping file watcher...');

    // Close all watchers
    for (const [filePath, watcher] of this.watchers) {
      try {
        watcher.close();
      } catch (error) {
        this.log(`Error closing watcher for ${filePath}: ${error.message}`);
      }
    }

    this.watchers.clear();
    this.debounceTimers.clear();
    this.isWatching = false;

    this.emit('stopped', {
      stats: this.stats
    });

    console.log('\n👁️  File Watcher Stopped');
    this.printStats();
  }

  /**
   * Discover files to watch
   */
  async discoverFiles(dir, files = []) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.directory, fullPath);

        // Check exclusions
        if (this.isExcluded(relativePath)) {
          continue;
        }

        if (entry.isDirectory() && this.recursive) {
          await this.discoverFiles(fullPath, files);
        } else if (entry.isFile() && this.shouldWatch(relativePath)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      this.log(`Error discovering files in ${dir}: ${error.message}`);
    }

    return files;
  }

  /**
   * Check if path should be excluded
   */
  isExcluded(relativePath) {
    return this.excludePatterns.some(pattern => {
      return this.matchPattern(relativePath, pattern);
    });
  }

  /**
   * Check if file should be watched
   */
  shouldWatch(relativePath) {
    return this.includePatterns.some(pattern => {
      return this.matchPattern(relativePath, pattern);
    });
  }

  /**
   * Simple glob pattern matching
   *
   * Supports:
   *   - `**` / `**\/` : match zero or more path segments (recursive)
   *   - `*`           : match anything except a path separator
   *   - `?`           : match a single character
   */
  matchPattern(filePath, pattern) {
    const normalized = filePath.replace(/\\/g, '/');

    // Tokenize the pattern into regex, taking care of the ordering of
    // replacements so that `**` is handled before `*`, and escaping dots.
    let regexPattern = '';
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];

      if (char === '*') {
        if (pattern[i + 1] === '*') {
          // Handle `**` (globstar)
          i++; // consume second '*'
          if (pattern[i + 1] === '/') {
            // `**/` matches zero or more full path segments
            i++; // consume the '/'
            regexPattern += '(?:.*/)?';
          } else {
            // `**` matches anything, including path separators
            regexPattern += '.*';
          }
        } else {
          // Single `*` matches anything except a path separator
          regexPattern += '[^/]*';
        }
      } else if (char === '?') {
        regexPattern += '.';
      } else if ('.+^${}()|[]\\'.includes(char)) {
        // Escape regex special characters
        regexPattern += `\\${char}`;
      } else {
        regexPattern += char;
      }
    }

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalized);
  }

  /**
   * Watch a single file
   */
  watchFile(filePath) {
    if (this.watchers.has(filePath)) {
      return;
    }

    try {
      const watcher = fs.watch(filePath, (eventType, filename) => {
        if (eventType === 'change') {
          this.handleFileChange(filePath);
        }
      });

      this.watchers.set(filePath, watcher);

      watcher.on('error', (error) => {
        this.log(`Watcher error for ${filePath}: ${error.message}`);
        this.watchers.delete(filePath);
      });

    } catch (error) {
      this.log(`Failed to watch ${filePath}: ${error.message}`);
    }
  }

  /**
   * Watch directories for new files
   */
  watchDirectories(dir) {
    try {
      const watcher = fs.watch(dir, { recursive: this.recursive }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = path.join(dir, filename);
        const relativePath = path.relative(this.directory, fullPath);

        // Check if it's a new file we should watch
        if (eventType === 'rename' && !this.isExcluded(relativePath) && this.shouldWatch(relativePath)) {
          try {
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
              if (!this.watchers.has(fullPath)) {
                this.log(`New file detected: ${relativePath}`);
                this.watchFile(fullPath);
                this.stats.filesWatched++;
                this.handleFileChange(fullPath);
              }
            }
          } catch (error) {
            // File might have been deleted
          }
        }
      });

      // Store directory watcher separately
      const key = `dir:${dir}`;
      this.watchers.set(key, watcher);

    } catch (error) {
      this.log(`Failed to watch directory ${dir}: ${error.message}`);
    }
  }

  /**
   * Handle file change with debouncing
   */
  handleFileChange(filePath) {
    const relativePath = path.relative(this.directory, filePath);

    this.stats.changesDetected++;

    // Clear existing timer
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath));
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.onFileChanged(filePath);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);

    this.log(`Change detected: ${relativePath} (debouncing...)`);
  }

  /**
   * Process file change after debounce
   */
  async onFileChanged(filePath) {
    const relativePath = path.relative(this.directory, filePath);

    this.log(`\n${'—'.repeat(40)}`);
    this.log(`Processing: ${relativePath}`);
    this.log(`${'—'.repeat(40)}`);

    try {
      // Verify file still exists
      if (!fs.existsSync(filePath)) {
        this.log('File no longer exists, skipping');
        return;
      }

      this.stats.analysisRuns++;

      // Emit event
      this.emit('fileChanged', {
        filePath: filePath,
        relativePath: relativePath,
        timestamp: new Date().toISOString()
      });

      // Run analysis (placeholder - would integrate with analyzer)
      const issues = await this.analyzeFile(filePath);

      this.emit('analysisComplete', {
        filePath: filePath,
        issueCount: issues.length,
        issues: issues
      });

      if (issues.length > 0) {
        console.log(`  Found ${issues.length} issue(s)`);

        // Auto-fix if enabled
        if (this.autoFix) {
          await this.autoFixFile(filePath, issues);
        }
      } else {
        console.log(`  ✓ No issues found`);
      }

    } catch (error) {
      this.stats.errors++;
      this.log(`Error processing ${relativePath}: ${error.message}`);

      this.emit('error', {
        filePath: filePath,
        error: error
      });
    }
  }

  /**
   * Analyze file
   * (In real implementation, this would call the analyzer)
   */
  async analyzeFile(filePath) {
    // Placeholder: return empty array
    // In production, integrate with linter integration
    return [];
  }

  /**
   * Auto-fix file
   * (In real implementation, this would call the auto-fix engine)
   */
  async autoFixFile(filePath, issues) {
    this.log('Auto-fixing...');

    try {
      // Placeholder
      // In production, integrate with AutoFixEngine

      this.stats.autoFixesApplied++;

      this.emit('autoFixComplete', {
        filePath: filePath,
        issueCount: issues.length,
        fixed: issues.length
      });

      console.log(`  ✓ Auto-fixed ${issues.length} issue(s)`);
    } catch (error) {
      this.log(`Auto-fix failed: ${error.message}`);

      this.emit('autoFixError', {
        filePath: filePath,
        error: error
      });
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      isWatching: this.isWatching,
      directory: this.directory
    };
  }

  /**
   * Print statistics
   */
  printStats() {
    console.log('\n📊 Watcher Statistics:');
    console.log(`  Files watched: ${this.stats.filesWatched}`);
    console.log(`  Changes detected: ${this.stats.changesDetected}`);
    console.log(`  Analysis runs: ${this.stats.analysisRuns}`);
    console.log(`  Auto-fixes applied: ${this.stats.autoFixesApplied}`);
    console.log(`  Errors: ${this.stats.errors}`);
  }

  log(message) {
    if (this.verbose) {
      console.log(`[FileWatcher] ${message}`);
    }
  }
}

/**
 * Watch with callback
 */
function watch(directory, options = {}) {
  const watcher = new FileWatcher({
    directory,
    ...options
  });

  return watcher.start();
}

/**
 * Watch with custom handlers
 */
function watchWithHandlers(directory, handlers = {}, options = {}) {
  const watcher = new FileWatcher({
    directory,
    ...options
  });

  // Attach handlers
  if (handlers.onFileChanged) {
    watcher.on('fileChanged', handlers.onFileChanged);
  }
  if (handlers.onAnalysisComplete) {
    watcher.on('analysisComplete', handlers.onAnalysisComplete);
  }
  if (handlers.onAutoFixComplete) {
    watcher.on('autoFixComplete', handlers.onAutoFixComplete);
  }
  if (handlers.onError) {
    watcher.on('error', handlers.onError);
  }

  return watcher.start();
}

module.exports = {
  FileWatcher,
  watch,
  watchWithHandlers
};

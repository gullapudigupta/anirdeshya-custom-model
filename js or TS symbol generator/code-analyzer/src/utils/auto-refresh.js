/**
 * CAT-023: Auto-Refresh on Source Change
 * 
 * Detect .ts/.html/.scss changes via git diff and re-index.
 * 30-second debounce. Designed for long-running server mode.
 * 
 * Maps to sidecar auto-refresh middleware pattern.
 * 
 * Usage:
 *   const refresh = new AutoRefresh(rootDir, { onRefresh: (changedFiles) => reindex(changedFiles) });
 *   refresh.start();
 *   // ... later
 *   refresh.stop();
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class AutoRefresh {
  /**
   * @param {string} rootDir - Project root directory
   * @param {object} options - Configuration
   * @param {Function} options.onRefresh - Callback when changes detected: (changedFiles) => void
   * @param {number} options.debounceMs - Debounce interval (default: 30000ms)
   * @param {number} options.pollIntervalMs - Polling interval (default: 5000ms)
   * @param {Array<string>} options.extensions - File extensions to watch (default: .ts,.html,.scss)
   * @param {boolean} options.useGitDiff - Use git diff for change detection (default: true)
   * @param {boolean} options.useFsWatch - Use fs.watch for real-time (default: false, more resource-intensive)
   */
  constructor(rootDir, options = {}) {
    const {
      onRefresh = null,
      debounceMs = 30000,
      pollIntervalMs = 5000,
      extensions = ['.ts', '.html', '.scss', '.css'],
      useGitDiff = true,
      useFsWatch = false,
    } = options;

    this.rootDir = rootDir;
    this.onRefresh = onRefresh;
    this.debounceMs = debounceMs;
    this.pollIntervalMs = pollIntervalMs;
    this.extensions = extensions;
    this.useGitDiff = useGitDiff;
    this.useFsWatch = useFsWatch;

    // State
    this.running = false;
    this.pollTimer = null;
    this.debounceTimer = null;
    this.lastCheckTimestamp = null;
    this.lastKnownState = new Map(); // file -> mtime
    this.pendingChanges = new Set();
    this.watchers = [];

    // Statistics
    this.stats = {
      checksPerformed: 0,
      refreshesTriggered: 0,
      filesDetected: 0,
      lastRefreshTime: null,
      errors: 0,
    };
  }

  /**
   * Start watching for changes.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.lastCheckTimestamp = new Date().toISOString();

    if (this.useFsWatch) {
      this._startFsWatch();
    } else {
      this._startPolling();
    }

    return this;
  }

  /**
   * Stop watching.
   */
  stop() {
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    for (const watcher of this.watchers) {
      try { watcher.close(); } catch (e) { /* ok */ }
    }
    this.watchers = [];
  }

  /**
   * Manually trigger a check (useful for testing or explicit refresh).
   * @returns {Array<string>} Changed files, or empty array
   */
  checkNow() {
    const changedFiles = this._detectChanges();
    if (changedFiles.length > 0) {
      this._triggerRefresh(changedFiles);
    }
    return changedFiles;
  }

  /**
   * Get current status.
   */
  getStatus() {
    return {
      running: this.running,
      mode: this.useFsWatch ? 'fs.watch' : 'git-poll',
      pollInterval: this.pollIntervalMs,
      debounce: this.debounceMs,
      extensions: this.extensions,
      pendingChanges: [...this.pendingChanges],
      stats: { ...this.stats },
    };
  }

  /**
   * Force a full re-index (bypass change detection).
   */
  forceRefresh() {
    if (this.onRefresh) {
      this.onRefresh([]);
      this.stats.refreshesTriggered++;
      this.stats.lastRefreshTime = new Date().toISOString();
    }
  }

  // ─── Private: Polling Mode ───────────────────────────────────────────────

  _startPolling() {
    this.pollTimer = setInterval(() => {
      if (!this.running) return;
      
      const changedFiles = this._detectChanges();
      if (changedFiles.length > 0) {
        for (const f of changedFiles) this.pendingChanges.add(f);
        this._debouncedRefresh();
      }
    }, this.pollIntervalMs);
  }

  _detectChanges() {
    this.stats.checksPerformed++;
    
    if (this.useGitDiff) {
      return this._detectViaGit();
    }
    return this._detectViaMtime();
  }

  _detectViaGit() {
    try {
      // Get files changed since last check
      const cmd = 'git diff --name-only';
      const output = execSync(cmd, { cwd: this.rootDir, encoding: 'utf-8', timeout: 5000 });
      
      const changedFiles = output.trim().split('\n')
        .filter(Boolean)
        .filter(f => this.extensions.some(ext => f.endsWith(ext)))
        .filter(f => !f.includes('.spec.') && !f.includes('node_modules'));

      return changedFiles;
    } catch (e) {
      this.stats.errors++;
      return [];
    }
  }

  _detectViaMtime() {
    const changedFiles = [];
    const srcDir = path.join(this.rootDir, 'src');
    
    try {
      this._walkDir(srcDir, (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (!this.extensions.includes(ext)) return;
        if (filePath.includes('.spec.')) return;

        try {
          const stat = fs.statSync(filePath);
          const mtime = stat.mtimeMs;
          const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
          
          const lastMtime = this.lastKnownState.get(relativePath);
          if (lastMtime && mtime > lastMtime) {
            changedFiles.push(relativePath);
          }
          this.lastKnownState.set(relativePath, mtime);
        } catch (e) { /* file may have been deleted */ }
      });
    } catch (e) {
      this.stats.errors++;
    }

    return changedFiles;
  }

  // ─── Private: fs.watch Mode ──────────────────────────────────────────────

  _startFsWatch() {
    const srcDir = path.join(this.rootDir, 'src');
    
    try {
      const watcher = fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
        if (!filename || !this.running) return;
        
        const ext = path.extname(filename).toLowerCase();
        if (!this.extensions.includes(ext)) return;
        if (filename.includes('.spec.') || filename.includes('node_modules')) return;
        
        const relativePath = `src/${filename}`.replace(/\\/g, '/');
        this.pendingChanges.add(relativePath);
        this._debouncedRefresh();
      });

      this.watchers.push(watcher);
    } catch (e) {
      // Fallback to polling if fs.watch isn't supported
      this.stats.errors++;
      this._startPolling();
    }
  }

  // ─── Private: Debounce & Trigger ─────────────────────────────────────────

  _debouncedRefresh() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      const files = [...this.pendingChanges];
      this.pendingChanges.clear();
      
      if (files.length > 0) {
        this._triggerRefresh(files);
      }
    }, this.debounceMs);
  }

  _triggerRefresh(changedFiles) {
    this.stats.refreshesTriggered++;
    this.stats.filesDetected += changedFiles.length;
    this.stats.lastRefreshTime = new Date().toISOString();
    this.lastCheckTimestamp = new Date().toISOString();

    if (this.onRefresh) {
      try {
        this.onRefresh(changedFiles);
      } catch (e) {
        this.stats.errors++;
      }
    }
  }

  // ─── Private: Utilities ──────────────────────────────────────────────────

  _walkDir(dir, callback) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) { return; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.angular', '.git', 'www'].includes(entry.name)) {
          this._walkDir(fullPath, callback);
        }
      } else if (entry.isFile()) {
        callback(fullPath);
      }
    }
  }
}

module.exports = { AutoRefresh };

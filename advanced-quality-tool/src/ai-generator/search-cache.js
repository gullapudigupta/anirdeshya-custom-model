/**
 * Local Search Cache (AQ-SF-002)
 *
 * Small filesystem-backed cache shared by the search adapters (P6-T003..T005).
 * Keeps network use down by memoizing search responses keyed by a stable hash of
 * (source + query). Entries expire after a configurable TTL.
 *
 * Network-free by itself; adapters read/write through it.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_OPTIONS = {
  cacheDir: null,                 // defaults to <rootDir>/.aqt-cache/ai-generator
  rootDir: process.cwd(),
  ttlMs: 7 * 24 * 60 * 60 * 1000  // 7 days
};

class SearchCache {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.dir = this.options.cacheDir ||
      path.join(this.options.rootDir, '.aqt-cache', 'ai-generator');
  }

  /**
   * Build a stable cache key for a source + query pair.
   */
  key(source, query) {
    const hash = crypto.createHash('sha1').update(`${source}::${query}`).digest('hex');
    return `${source}-${hash}.json`;
  }

  /**
   * Return the cached value or null when missing/expired.
   */
  get(source, query) {
    const file = path.join(this.dir, this.key(source, query));
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const entry = JSON.parse(raw);
      if (typeof entry.expires === 'number' && entry.expires < Date.now()) {
        return null;
      }
      return entry.value;
    } catch {
      return null;
    }
  }

  /**
   * Persist a value for a source + query pair.
   */
  set(source, query, value) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, this.key(source, query));
      const entry = { source, query, value, cachedAt: Date.now(), expires: Date.now() + this.options.ttlMs };
      fs.writeFileSync(file, JSON.stringify(entry), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove all cached entries. Returns count deleted.
   */
  clear() {
    let count = 0;
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (f.endsWith('.json')) {
          fs.unlinkSync(path.join(this.dir, f));
          count++;
        }
      }
    } catch {
      /* nothing to clear */
    }
    return count;
  }
}

module.exports = { SearchCache };

/**
 * CAT-022: LRU Cache with TTL
 * 
 * Replace current 60s index rebuild with proper LRU cache.
 * Generated key per query, configurable TTL.
 * 
 * Features:
 * - LRU eviction when capacity exceeded
 * - Per-entry TTL (time-to-live)
 * - Optional global TTL default
 * - Hit/miss statistics
 * - Manual invalidation (by key or pattern)
 * - Size-aware caching option
 * 
 * Usage:
 *   const cache = new LRUCache({ maxSize: 200, defaultTTL: 60000 });
 *   cache.set('symbols:AuthService', data);
 *   cache.get('symbols:AuthService');
 *   cache.invalidatePattern(/^symbols:/);
 */

class LRUCache {
  /**
   * @param {object} options - { maxSize: 100, defaultTTL: 60000 (ms), onEvict: null }
   */
  constructor(options = {}) {
    const { maxSize = 100, defaultTTL = 60000, onEvict = null } = options;
    
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.onEvict = onEvict;
    
    // Internal storage: Map preserves insertion order
    this.store = new Map();
    
    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      sets: 0,
      invalidations: 0,
    };
  }

  /**
   * Get a value from the cache.
   * @param {string} key
   * @returns {*} Cached value or undefined
   */
  get(key) {
    const entry = this.store.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL
    if (this._isExpired(entry)) {
      this.store.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);
    
    this.stats.hits++;
    entry.lastAccess = Date.now();
    entry.accessCount++;
    
    return entry.value;
  }

  /**
   * Set a value in the cache.
   * @param {string} key
   * @param {*} value
   * @param {object} options - { ttl: ms, size: bytes }
   */
  set(key, value, options = {}) {
    const { ttl = this.defaultTTL, size = 0 } = options;

    // If key exists, delete it first (to update position)
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict if at capacity
    while (this.store.size >= this.maxSize) {
      this._evictLRU();
    }

    const entry = {
      value,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      accessCount: 0,
      ttl,
      size,
    };

    this.store.set(key, entry);
    this.stats.sets++;
  }

  /**
   * Check if a key exists and is not expired.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this._isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a specific key.
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    return this.store.delete(key);
  }

  /**
   * Invalidate all entries matching a pattern.
   * @param {RegExp|string} pattern - Regex or string prefix
   * @returns {number} Number of entries invalidated
   */
  invalidatePattern(pattern) {
    let count = 0;
    const regex = pattern instanceof RegExp ? pattern : new RegExp(`^${pattern}`);
    
    for (const key of [...this.store.keys()]) {
      if (regex.test(key)) {
        this.store.delete(key);
        count++;
      }
    }
    
    this.stats.invalidations += count;
    return count;
  }

  /**
   * Invalidate entries associated with a file.
   * @param {string} filePath
   * @returns {number}
   */
  invalidateFile(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return this.invalidatePattern(new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  /**
   * Clear the entire cache.
   */
  clear() {
    this.store.clear();
  }

  /**
   * Get cache statistics.
   * @returns {object}
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? Math.round(this.stats.hits / totalRequests * 100) : 0;

    return {
      size: this.store.size,
      maxSize: this.maxSize,
      ...this.stats,
      hitRate: `${hitRate}%`,
      totalRequests,
    };
  }

  /**
   * Get all keys (for debugging).
   * @returns {Array<string>}
   */
  keys() {
    return [...this.store.keys()];
  }

  /**
   * Get or set: if key exists return cached value, otherwise compute and cache.
   * @param {string} key
   * @param {Function} computeFn - () => value
   * @param {object} options - { ttl }
   * @returns {*}
   */
  getOrSet(key, computeFn, options = {}) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const value = computeFn();
    this.set(key, value, options);
    return value;
  }

  /**
   * Generate a cache key from multiple parts.
   * @param {...string} parts
   * @returns {string}
   */
  static makeKey(...parts) {
    return parts.filter(Boolean).join(':');
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _isExpired(entry) {
    if (entry.ttl === 0 || entry.ttl === Infinity) return false;
    return Date.now() - entry.createdAt > entry.ttl;
  }

  _evictLRU() {
    // Map preserves insertion order — first key is least recently used
    const firstKey = this.store.keys().next().value;
    if (firstKey === undefined) return;
    
    const entry = this.store.get(firstKey);
    this.store.delete(firstKey);
    this.stats.evictions++;

    if (this.onEvict) {
      this.onEvict(firstKey, entry?.value);
    }
  }
}

/**
 * Specialized cache for the code analyzer index.
 * Wraps LRUCache with analyzer-specific key generation and TTL policies.
 */
class AnalyzerCache {
  constructor(options = {}) {
    const {
      symbolCacheTTL = 120000,   // 2 minutes for symbol queries
      outlineCacheTTL = 120000,  // 2 minutes for outlines
      snippetCacheTTL = 60000,   // 1 minute for snippets (files change)
      analysisCacheTTL = 300000, // 5 minutes for analysis results
      maxSize = 500,
    } = options;

    this.ttls = {
      symbol: symbolCacheTTL,
      outline: outlineCacheTTL,
      snippet: snippetCacheTTL,
      analysis: analysisCacheTTL,
    };

    this.cache = new LRUCache({ maxSize, defaultTTL: symbolCacheTTL });
  }

  // Convenience methods with automatic key generation and TTL
  
  getSymbol(name) {
    return this.cache.get(`sym:${name}`);
  }

  setSymbol(name, data) {
    this.cache.set(`sym:${name}`, data, { ttl: this.ttls.symbol });
  }

  getOutline(filePath) {
    return this.cache.get(`outline:${filePath}`);
  }

  setOutline(filePath, data) {
    this.cache.set(`outline:${filePath}`, data, { ttl: this.ttls.outline });
  }

  getSnippet(filePath, line, context) {
    return this.cache.get(`snip:${filePath}:${line}:${context}`);
  }

  setSnippet(filePath, line, context, data) {
    this.cache.set(`snip:${filePath}:${line}:${context}`, data, { ttl: this.ttls.snippet });
  }

  getAnalysis(type, target) {
    return this.cache.get(`analysis:${type}:${target}`);
  }

  setAnalysis(type, target, data) {
    this.cache.set(`analysis:${type}:${target}`, data, { ttl: this.ttls.analysis });
  }

  /**
   * Invalidate all cache entries related to a file.
   */
  onFileChange(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    this.cache.invalidatePattern(new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // Also invalidate outlines and snippets that reference this file
    this.cache.invalidatePattern(/^outline:/);
    this.cache.invalidatePattern(/^snip:/);
  }

  getStats() {
    return this.cache.getStats();
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = { LRUCache, AnalyzerCache };

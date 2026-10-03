/**
 * Documentation Link Ingestion and Evidence Context (P9-T020)
 *
 * Accepts explicit documentation URLs from imported tasks or user input.
 * Fetches, validates, caches, and refreshes documentation content.
 * Restricts requests according to allowed-domain, network, and privacy policy.
 *
 * @module workspace/documentation-ingestion
 */

'use strict';

const https = require('https');
const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Documentation source status
 */
const SourceStatus = {
  PENDING: 'pending',
  FETCHING: 'fetching',
  VALID: 'valid',
  INVALID: 'invalid',
  BLOCKED: 'blocked',
  UNAVAILABLE: 'unavailable',
  RATE_LIMITED: 'rate-limited'
};

/**
 * Documentation ingestion configuration
 */
const DEFAULT_CONFIG = {
  allowedDomains: null, // null = all allowed, array = whitelist
  blockedDomains: ['localhost', '127.0.0.1', '0.0.0.0', 'internal.*'],
  maxRedirects: 5,
  timeout: 30000,
  maxContentSize: 10 * 1024 * 1024, // 10MB
  cacheEnabled: true,
  cacheTTL: 24 * 60 * 60 * 1000, // 24 hours
  respectRobotsTxt: true,
  userAgent: 'AQT-DocumentationFetcher/1.0',
  privacyPolicy: {
    allowRemoteRequests: true,
    sendContextToRemote: false,
    redactSensitivePaths: true
  }
};

/**
 * Documentation Ingestion Manager
 */
class DocumentationIngestion {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.cache = new Map();
    this.cacheDir = options.cacheDir || path.join(process.cwd(), '.aqt-cache', 'docs');
    this.rateLimits = new Map(); // domain -> last request time
    
    this._ensureCacheDir();
  }

  /**
   * Ingest documentation from URLs
   * @param {Object} params
   * @param {string[]} params.urls - Documentation URLs
   * @param {string} [params.taskId] - Associated task ID
   * @param {Object} [params.policy] - Override privacy policy
   * @returns {Promise<Object>} Ingestion result
   */
  async ingest(params) {
    const { urls, taskId = null, policy = {} } = params;
    
    const effectivePolicy = {
      ...this.config.privacyPolicy,
      ...policy
    };
    
    const results = {
      taskId,
      sources: [],
      errors: [],
      warnings: [],
      stats: {
        total: urls.length,
        fetched: 0,
        cached: 0,
        blocked: 0,
        failed: 0
      }
    };
    
    for (const docUrl of urls) {
      try {
        const source = await this._processUrl(docUrl, effectivePolicy);
        results.sources.push(source);
        
        if (source.fromCache) {
          results.stats.cached++;
        } else if (source.status === SourceStatus.VALID) {
          results.stats.fetched++;
        } else if (source.status === SourceStatus.BLOCKED) {
          results.stats.blocked++;
        } else {
          results.stats.failed++;
        }
        
      } catch (error) {
        results.errors.push({
          url: docUrl,
          error: error.message
        });
        results.stats.failed++;
      }
    }
    
    return results;
  }

  /**
   * Get cached documentation
   * @param {string} url
   * @returns {Object|null}
   */
  getCached(url) {
    const cacheKey = this._getCacheKey(url);
    
    // Check memory cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() < cached.expiresAt) {
        return cached;
      }
      this.cache.delete(cacheKey);
    }
    
    // Check file cache
    const cachePath = this._getCachePath(cacheKey);
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (Date.now() < data.expiresAt) {
          this.cache.set(cacheKey, data);
          return data;
        }
        // Expired, remove
        fs.unlinkSync(cachePath);
      } catch {
        // Invalid cache file, ignore
      }
    }
    
    return null;
  }

  /**
   * Clear cache
   * @param {boolean} [all] - Clear all cache including files
   */
  clearCache(all = false) {
    this.cache.clear();
    
    if (all && fs.existsSync(this.cacheDir)) {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.cacheDir, file));
      }
    }
  }

  /**
   * Check if URL is allowed
   * @param {string} docUrl
   * @returns {Object} { allowed: boolean, reason?: string }
   */
  isUrlAllowed(docUrl) {
    try {
      const parsed = new URL(docUrl);
      
      // Check protocol
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { allowed: false, reason: 'Invalid protocol' };
      }
      
      // Check blocked domains
      for (const blocked of this.config.blockedDomains) {
        if (blocked.includes('*')) {
          const regex = new RegExp(blocked.replace(/\*/g, '.*'));
          if (regex.test(parsed.hostname)) {
            return { allowed: false, reason: `Domain ${parsed.hostname} is blocked` };
          }
        } else if (parsed.hostname === blocked) {
          return { allowed: false, reason: `Domain ${blocked} is blocked` };
        }
      }
      
      // Check allowed domains whitelist
      if (this.config.allowedDomains && this.config.allowedDomains.length > 0) {
        if (!this.config.allowedDomains.includes(parsed.hostname)) {
          return { allowed: false, reason: `Domain ${parsed.hostname} not in allowed list` };
        }
      }
      
      // Check for internal IPs (basic check)
      if (this._isInternalIP(parsed.hostname)) {
        return { allowed: false, reason: 'Internal IP addresses are blocked' };
      }
      
      return { allowed: true };
      
    } catch (error) {
      return { allowed: false, reason: `Invalid URL: ${error.message}` };
    }
  }

  /**
   * Extract relevant sections from content
   * @param {string} content
   * @param {string[]} keywords
   * @param {Object} options
   * @returns {Object[]} Extracted sections
   */
  extractSections(content, keywords = [], options = {}) {
    const maxSections = options.maxSections || 5;
    const contextLines = options.contextLines || 3;
    
    const sections = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length && sections.length < maxSections; i++) {
      const line = lines[i];
      
      // Check if line contains any keyword
      const matchedKeyword = keywords.find(kw => 
        line.toLowerCase().includes(kw.toLowerCase())
      );
      
      if (matchedKeyword) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        
        sections.push({
          keyword: matchedKeyword,
          line: i + 1,
          content: lines.slice(start, end).join('\n'),
          context: {
            before: lines.slice(start, i).join('\n'),
            match: line,
            after: lines.slice(i + 1, end).join('\n')
          }
        });
      }
    }
    
    return sections;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────────

  async _processUrl(docUrl, policy) {
    // Check privacy policy
    if (!policy.allowRemoteRequests) {
      return {
        url: docUrl,
        status: SourceStatus.BLOCKED,
        reason: 'Remote requests disabled by privacy policy',
        content: null
      };
    }
    
    // Check if URL is allowed
    const urlCheck = this.isUrlAllowed(docUrl);
    if (!urlCheck.allowed) {
      return {
        url: docUrl,
        status: SourceStatus.BLOCKED,
        reason: urlCheck.reason,
        content: null
      };
    }
    
    // Check cache
    const cached = this.getCached(docUrl);
    if (cached) {
      return {
        url: docUrl,
        status: SourceStatus.VALID,
        fromCache: true,
        cachedAt: cached.cachedAt,
        content: cached.content,
        metadata: cached.metadata
      };
    }
    
    // Check rate limit
    const domain = new URL(docUrl).hostname;
    if (!this._checkRateLimit(domain)) {
      return {
        url: docUrl,
        status: SourceStatus.RATE_LIMITED,
        reason: 'Rate limit exceeded for domain',
        retryAfter: this._getRateLimitReset(domain),
        content: null
      };
    }
    
    // Fetch content
    const fetchResult = await this._fetch(docUrl);
    
    if (!fetchResult.success) {
      return {
        url: docUrl,
        status: SourceStatus.UNAVAILABLE,
        error: fetchResult.error,
        content: null
      };
    }
    
    // Validate content
    const validation = this._validateContent(fetchResult.content);
    
    if (!validation.valid) {
      return {
        url: docUrl,
        status: SourceStatus.INVALID,
        reason: validation.reason,
        content: null
      };
    }
    
    // Cache content
    const metadata = {
      contentType: fetchResult.contentType,
      size: fetchResult.content.length,
      fetchedAt: Date.now()
    };
    
    this._cache(docUrl, fetchResult.content, metadata);
    this._recordRequest(domain);
    
    return {
      url: docUrl,
      status: SourceStatus.VALID,
      fromCache: false,
      content: fetchResult.content,
      metadata
    };
  }

  async _fetch(docUrl) {
    return new Promise((resolve) => {
      const parsed = new URL(docUrl);
      const protocol = parsed.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'text/html, text/plain, text/markdown, application/json'
        },
        timeout: this.config.timeout
      };
      
      let redirects = 0;
      let content = '';
      
      const request = protocol.request(options, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400) {
          const location = response.headers.location;
          if (location && redirects < this.config.maxRedirects) {
            redirects++;
            return this._fetch(location).then(resolve);
          }
        }
        
        if (response.statusCode !== 200) {
          return resolve({
            success: false,
            error: `HTTP ${response.statusCode}`
          });
        }
        
        const contentType = response.headers['content-type'] || 'text/plain';
        
        response.on('data', (chunk) => {
          content += chunk.toString();
          
          // Check size limit
          if (content.length > this.config.maxContentSize) {
            request.destroy();
            resolve({
              success: false,
              error: 'Content size exceeds limit'
            });
          }
        });
        
        response.on('end', () => {
          resolve({
            success: true,
            content,
            contentType
          });
        });
        
        response.on('error', (error) => {
          resolve({
            success: false,
            error: error.message
          });
        });
      });
      
      request.on('error', (error) => {
        resolve({
          success: false,
          error: error.message
        });
      });
      
      request.on('timeout', () => {
        request.destroy();
        resolve({
          success: false,
          error: 'Request timeout'
        });
      });
      
      request.end();
    });
  }

  _validateContent(content) {
    if (!content || content.length === 0) {
      return { valid: false, reason: 'Empty content' };
    }
    
    // Check for HTML error pages
    if (content.includes('<html') && content.includes('Error')) {
      return { valid: false, reason: 'Appears to be an error page' };
    }
    
    return { valid: true };
  }

  _getCacheKey(docUrl) {
    return crypto.createHash('sha256').update(docUrl).digest('hex');
  }

  _getCachePath(cacheKey) {
    return path.join(this.cacheDir, `${cacheKey}.json`);
  }

  _cache(docUrl, content, metadata) {
    const cacheKey = this._getCacheKey(docUrl);
    const cacheData = {
      url: docUrl,
      content,
      metadata,
      cachedAt: Date.now(),
      expiresAt: Date.now() + this.config.cacheTTL
    };
    
    // Memory cache
    this.cache.set(cacheKey, cacheData);
    
    // File cache
    if (this.config.cacheEnabled) {
      const cachePath = this._getCachePath(cacheKey);
      fs.writeFileSync(cachePath, JSON.stringify(cacheData), 'utf8');
    }
  }

  _ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  _checkRateLimit(domain) {
    const lastRequest = this.rateLimits.get(domain);
    if (!lastRequest) return true;
    
    // Minimum 1 second between requests to same domain
    const minInterval = 1000;
    return Date.now() - lastRequest >= minInterval;
  }

  _getRateLimitReset(domain) {
    const lastRequest = this.rateLimits.get(domain);
    if (!lastRequest) return 0;
    
    return Math.max(0, 1000 - (Date.now() - lastRequest));
  }

  _recordRequest(domain) {
    this.rateLimits.set(domain, Date.now());
  }

  _isInternalIP(hostname) {
    const internalPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^0\.0\.0\.0$/,
      /^::1$/,
      /^fc00:/i,
      /^fe80:/i
    ];
    
    return internalPatterns.some(pattern => pattern.test(hostname));
  }
}

module.exports = {
  DocumentationIngestion,
  SourceStatus,
  DEFAULT_CONFIG
};

/**
 * Rule Pack Marketplace
 *
 * Allows users to discover, download, publish, and manage community
 * rule packs. Rule packs are bundles of custom rules that can be
 * shared via a registry (local file-system or remote URL).
 *
 * Features:
 * - Browse available packs from a registry
 * - Install / uninstall packs locally
 * - Publish local packs to the registry
 * - Offline-first: works without network when cache is warm
 *
 * @module rules/rule-pack-marketplace
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

/** Default public registry endpoint (can be overridden in options) */
const DEFAULT_REGISTRY_URL = 'https://registry.advanced-quality-tool.dev/packs';

/** Local cache TTL in milliseconds (1 hour) */
const CACHE_TTL_MS = 60 * 60 * 1000;

class RulePackMarketplace {
  /**
   * @param {object} [options={}]
   * @param {string} [options.registryUrl]       - Remote registry base URL
   * @param {string} [options.packsDir]          - Local directory for installed packs
   * @param {string} [options.cacheDir]          - Directory for cached registry data
   * @param {boolean} [options.offline=false]    - Force offline mode
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options      = options;
    this.verbose      = options.verbose      || false;
    this.offline      = options.offline      || false;
    this.registryUrl  = options.registryUrl  || DEFAULT_REGISTRY_URL;

    const base        = options.baseDir || process.cwd();
    this.packsDir     = options.packsDir  || path.join(base, '.quality-tool', 'packs');
    this.cacheDir     = options.cacheDir  || path.join(base, '.aqt-cache', 'marketplace');
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * List all packs available in the registry.
   * Returns cached data if offline or cache is fresh.
   * @returns {Promise<{ packs: object[], source: 'remote'|'cache'|'empty', error?: string }>}
   */
  async listAvailable() {
    const cacheFile = path.join(this.cacheDir, 'index.json');

    // Try cache first if offline or cache is fresh
    if (this._isCacheFresh(cacheFile) || this.offline) {
      const cached = this._readCache(cacheFile);
      if (cached) return { packs: cached.packs || [], source: 'cache' };
      if (this.offline) return { packs: [], source: 'empty', error: 'Offline and no cache available.' };
    }

    // Fetch from registry
    try {
      const data = await this._fetchJSON(`${this.registryUrl}/index.json`);
      const packs = data.packs || [];
      this._writeCache(cacheFile, { packs, fetchedAt: Date.now() });
      return { packs, source: 'remote' };
    } catch (err) {
      // Fallback to stale cache
      const cached = this._readCache(cacheFile);
      if (cached) return { packs: cached.packs || [], source: 'cache', error: `Registry unreachable: ${err.message}` };
      return { packs: [], source: 'empty', error: err.message };
    }
  }

  /**
   * List locally installed packs.
   * @returns {object[]}
   */
  listInstalled() {
    if (!fs.existsSync(this.packsDir)) return [];
    return fs.readdirSync(this.packsDir)
      .filter(d => fs.statSync(path.join(this.packsDir, d)).isDirectory())
      .map(d => {
        const manifestPath = path.join(this.packsDir, d, 'pack.json');
        if (!fs.existsSync(manifestPath)) return null;
        try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean);
  }

  /**
   * Install a pack by ID from the registry.
   * @param {string} packId
   * @returns {Promise<{ success: boolean, pack?: object, error?: string }>}
   */
  async install(packId) {
    this._log(`Installing pack: ${packId}`);

    try {
      // Fetch pack manifest
      const manifest = await this._fetchJSON(`${this.registryUrl}/${packId}/pack.json`);
      this._validateManifest(manifest);

      // Fetch rules
      const rulesUrl = `${this.registryUrl}/${packId}/rules.json`;
      const rules    = await this._fetchJSON(rulesUrl);

      // Write to local packs directory
      const packDir = path.join(this.packsDir, packId);
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(path.join(packDir, 'pack.json'),  JSON.stringify(manifest, null, 2));
      fs.writeFileSync(path.join(packDir, 'rules.json'), JSON.stringify(rules,    null, 2));

      this._log(`Pack '${packId}' installed to ${packDir}`);
      return { success: true, pack: manifest };

    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Uninstall a locally installed pack.
   * @param {string} packId
   * @returns {{ success: boolean, error?: string }}
   */
  uninstall(packId) {
    const packDir = path.join(this.packsDir, packId);
    if (!fs.existsSync(packDir)) {
      return { success: false, error: `Pack '${packId}' is not installed.` };
    }
    this._removeDir(packDir);
    this._log(`Pack '${packId}' uninstalled.`);
    return { success: true };
  }

  /**
   * Load all rules from a specific installed pack into the given rule engine.
   * @param {string} packId
   * @param {object} engine - CustomRuleEngine instance
   * @returns {{ loaded: number, failed: number }}
   */
  loadPackIntoEngine(packId, engine) {
    const rulesFile = path.join(this.packsDir, packId, 'rules.json');
    if (!fs.existsSync(rulesFile)) {
      throw new Error(`Pack '${packId}' rules file not found. Is it installed?`);
    }

    const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
    let loaded = 0, failed = 0;

    for (const rule of (Array.isArray(rules) ? rules : [rules])) {
      if (engine.validateRule(rule)) {
        engine.addRule(rule);
        loaded++;
      } else {
        this._log(`Invalid rule in pack ${packId}: ${rule.id || '(no id)'}`);
        failed++;
      }
    }
    return { loaded, failed };
  }

  /**
   * Publish a local pack to the registry.
   * This creates a publishable archive and POSTs it to the registry endpoint.
   * Requires AQT_REGISTRY_TOKEN env var for authentication.
   *
   * @param {string} packDir - Path to a directory containing pack.json + rules.json
   * @returns {Promise<{ success: boolean, url?: string, error?: string }>}
   */
  async publish(packDir) {
    const manifestPath = path.join(packDir, 'pack.json');
    const rulesPath    = path.join(packDir, 'rules.json');

    if (!fs.existsSync(manifestPath)) return { success: false, error: 'pack.json not found in directory.' };
    if (!fs.existsSync(rulesPath))    return { success: false, error: 'rules.json not found in directory.' };

    let manifest, rules;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      rules    = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    } catch (e) {
      return { success: false, error: `Failed to parse pack files: ${e.message}` };
    }

    this._validateManifest(manifest);

    const token = process.env.AQT_REGISTRY_TOKEN || '';
    if (!token) {
      return { success: false, error: 'AQT_REGISTRY_TOKEN environment variable is required to publish.' };
    }

    const payload = JSON.stringify({ manifest, rules });

    try {
      const result = await this._postJSON(`${this.registryUrl}/publish`, payload, token);
      return { success: true, url: result.url || `${this.registryUrl}/${manifest.id}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Search available packs by keyword.
   * @param {string} query
   * @returns {Promise<object[]>}
   */
  async search(query) {
    const { packs } = await this.listAvailable();
    const q = query.toLowerCase();
    return packs.filter(p =>
      (p.name         || '').toLowerCase().includes(q) ||
      (p.description  || '').toLowerCase().includes(q) ||
      (p.tags         || []).some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * Get details for a specific pack (from cache or registry).
   * @param {string} packId
   * @returns {Promise<object|null>}
   */
  async getPackInfo(packId) {
    // Check installed first
    const installed = this.listInstalled().find(p => p.id === packId);
    if (installed) return { ...installed, installedLocally: true };

    try {
      const manifest = await this._fetchJSON(`${this.registryUrl}/${packId}/pack.json`);
      return { ...manifest, installedLocally: false };
    } catch {
      return null;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _validateManifest(manifest) {
    const required = ['id', 'name', 'version', 'author'];
    for (const field of required) {
      if (!manifest[field]) throw new Error(`Pack manifest missing required field: '${field}'`);
    }
  }

  _isCacheFresh(cacheFile) {
    if (!fs.existsSync(cacheFile)) return false;
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return Date.now() - (cached.fetchedAt || 0) < CACHE_TTL_MS;
    } catch { return false; }
  }

  _readCache(cacheFile) {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); }
    catch { return null; }
  }

  _writeCache(cacheFile, data) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    } catch (e) { this._log(`Cache write failed: ${e.message}`); }
  }

  _fetchJSON(url) {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https') ? https : http;
      lib.get(url, { headers: { 'User-Agent': 'advanced-quality-tool/1.0' } }, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          }
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error(`Invalid JSON from ${url}: ${e.message}`)); }
        });
      }).on('error', reject);
    });
  }

  _postJSON(url, payload, token) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'advanced-quality-tool/1.0'
        }
      }, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
          }
          try { resolve(JSON.parse(raw)); }
          catch { resolve({}); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  _removeDir(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      if (fs.statSync(full).isDirectory()) this._removeDir(full);
      else fs.unlinkSync(full);
    }
    fs.rmdirSync(dirPath);
  }

  _log(msg) { if (this.verbose) console.log(`[RulePackMarketplace] ${msg}`); }
}

/**
 * Create a minimal pack.json manifest skeleton.
 * @param {object} options
 * @returns {object}
 */
function createPackManifest({ id, name, version = '1.0.0', author, description = '', tags = [] }) {
  return { id, name, version, author, description, tags, createdAt: new Date().toISOString() };
}

module.exports = { RulePackMarketplace, createPackManifest, DEFAULT_REGISTRY_URL };

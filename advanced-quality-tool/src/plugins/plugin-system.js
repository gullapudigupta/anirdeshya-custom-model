/**
 * Plugin System
 * 
 * Extensible plugin architecture for custom rules and analyzers.
 * 
 * Features:
 * - Plugin discovery and loading
 * - Lifecycle management
 * - Hook system
 * - Custom rule registration
 * - Plugin validation
 * - Sandboxed execution
 * 
 * @module plugins/plugin-system
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Plugin Manager
 */
class PluginManager {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.pluginDirs = options.pluginDirs || [
      path.join(process.cwd(), 'plugins'),
      path.join(process.cwd(), '.quality-tool', 'plugins')
    ];

    // Loaded plugins
    this.plugins = new Map();
    this.hooks = new Map();
    this.customRules = new Map();

    // Plugin API version
    this.apiVersion = '1.0.0';

    // Statistics
    this.stats = {
      pluginsLoaded: 0,
      pluginsFailed: 0,
      hooksRegistered: 0,
      rulesRegistered: 0
    };
  }

  /**
   * Initialize plugin system
   */
  async initialize() {
    this.log('Initializing plugin system...');

    // Create plugin directories if they don't exist
    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          this.log(`Created plugin directory: ${dir}`);
        } catch (error) {
          this.log(`Failed to create plugin directory ${dir}: ${error.message}`);
        }
      }
    }

    // Discover and load plugins
    await this.discoverPlugins();

    this.log(`Plugin system initialized: ${this.stats.pluginsLoaded} plugins loaded`);
  }

  /**
   * Discover plugins
   */
  async discoverPlugins() {
    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) continue;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            await this.loadPlugin(path.join(dir, entry.name));
          } else if (entry.isFile() && entry.name.endsWith('.js')) {
            await this.loadPlugin(path.join(dir, entry.name));
          }
        }
      } catch (error) {
        this.log(`Error discovering plugins in ${dir}: ${error.message}`);
      }
    }
  }

  /**
   * Load plugin
   */
  async loadPlugin(pluginPath) {
    try {
      let manifest;
      let pluginCode;

      // Check if directory or file
      const stats = fs.statSync(pluginPath);

      if (stats.isDirectory()) {
        // Load from directory (with package.json)
        const manifestPath = path.join(pluginPath, 'plugin.json');
        const indexPath = path.join(pluginPath, 'index.js');

        if (!fs.existsSync(manifestPath)) {
          this.log(`No plugin.json found in ${pluginPath}`);
          return;
        }

        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        pluginCode = fs.readFileSync(indexPath, 'utf8');
      } else {
        // Single file plugin
        pluginCode = fs.readFileSync(pluginPath, 'utf8');

        // Extract manifest from comment block
        manifest = this.extractManifest(pluginCode);
        if (!manifest) {
          this.log(`No valid manifest found in ${pluginPath}`);
          return;
        }
      }

      // Validate manifest
      if (!this.validateManifest(manifest)) {
        this.log(`Invalid manifest in ${pluginPath}`);
        this.stats.pluginsFailed++;
        return;
      }

      // Check if already loaded
      if (this.plugins.has(manifest.id)) {
        this.log(`Plugin ${manifest.id} already loaded`);
        return;
      }

      // Create plugin context
      const plugin = await this.createPlugin(manifest, pluginCode, pluginPath);

      // Register plugin
      this.plugins.set(manifest.id, plugin);
      this.stats.pluginsLoaded++;

      // Initialize plugin
      if (plugin.instance && typeof plugin.instance.onLoad === 'function') {
        await plugin.instance.onLoad();
      }

      this.log(`Loaded plugin: ${manifest.name} v${manifest.version}`);

    } catch (error) {
      this.log(`Error loading plugin ${pluginPath}: ${error.message}`);
      this.stats.pluginsFailed++;
    }
  }

  /**
   * Extract manifest from code comments
   */
  extractManifest(code) {
    const manifestMatch = code.match(/\/\*\s*@plugin\s*\n([\s\S]*?)\*\//);

    if (!manifestMatch) return null;

    try {
      const manifestText = manifestMatch[1]
        .split('\n')
        .map(line => line.trim().replace(/^\*\s*/, ''))
        .join('\n');

      return JSON.parse(manifestText);
    } catch (error) {
      this.log(`Failed to parse manifest: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate manifest
   */
  validateManifest(manifest) {
    const required = ['id', 'name', 'version', 'apiVersion'];

    for (const field of required) {
      if (!manifest[field]) {
        this.log(`Missing required field: ${field}`);
        return false;
      }
    }

    // Check API compatibility
    if (!this.isCompatibleVersion(manifest.apiVersion)) {
      this.log(`Incompatible API version: ${manifest.apiVersion} (current: ${this.apiVersion})`);
      return false;
    }

    return true;
  }

  /**
   * Check version compatibility
   */
  isCompatibleVersion(pluginVersion) {
    const [major] = this.apiVersion.split('.');
    const [pluginMajor] = pluginVersion.split('.');

    return major === pluginMajor;
  }

  /**
   * Create plugin instance
   */
  async createPlugin(manifest, code, pluginPath) {
    // Create sandboxed context
    const context = this.createPluginContext(manifest);

    try {
      // Execute plugin code in sandbox
      const script = new vm.Script(code, {
        filename: pluginPath
      });

      script.runInNewContext(context, {
        timeout: 5000 // 5 second timeout
      });

      // Get plugin export
      const PluginClass = context.exports || context.module.exports;

      // Instantiate plugin
      const instance = typeof PluginClass === 'function' 
        ? new PluginClass(context.api) 
        : PluginClass;

      return {
        manifest,
        instance,
        context,
        path: pluginPath
      };

    } catch (error) {
      throw new Error(`Failed to create plugin instance: ${error.message}`);
    }
  }

  /**
   * Create plugin context (sandbox)
   */
  createPluginContext(manifest) {
    const api = {
      // Plugin info
      plugin: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version
      },

      // Hook registration
      registerHook: (hookName, callback) => {
        this.registerHook(manifest.id, hookName, callback);
      },

      // Custom rule registration
      registerRule: (rule) => {
        this.registerRule(manifest.id, rule);
      },

      // Utility functions
      log: (message) => {
        this.log(`[${manifest.name}] ${message}`);
      },

      // File system (restricted)
      fs: {
        readFile: (filePath) => {
          // Only allow reading files, not writing
          return fs.readFileSync(filePath, 'utf8');
        }
      },

      // Path utilities
      path: {
        join: path.join,
        resolve: path.resolve,
        dirname: path.dirname,
        basename: path.basename,
        extname: path.extname
      }
    };

    return {
      console,
      require: (name) => {
        // Whitelist safe modules
        const allowed = ['path', 'crypto'];
        if (allowed.includes(name)) {
          return require(name);
        }
        throw new Error(`Module '${name}' not allowed in plugins`);
      },
      module: { exports: {} },
      exports: {},
      api,
      Buffer,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval
    };
  }

  /**
   * Register hook
   */
  registerHook(pluginId, hookName, callback) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }

    this.hooks.get(hookName).push({
      pluginId,
      callback
    });

    this.stats.hooksRegistered++;
    this.log(`Registered hook: ${hookName} from ${pluginId}`);
  }

  /**
   * Register custom rule
   */
  registerRule(pluginId, rule) {
    // Validate rule
    if (!this.validateRule(rule)) {
      this.log(`Invalid rule from ${pluginId}: missing required fields`);
      return;
    }

    const ruleId = `${pluginId}:${rule.id}`;
    this.customRules.set(ruleId, {
      ...rule,
      pluginId
    });

    this.stats.rulesRegistered++;
    this.log(`Registered rule: ${ruleId}`);
  }

  /**
   * Validate rule
   */
  validateRule(rule) {
    const required = ['id', 'name', 'severity', 'check'];

    for (const field of required) {
      if (!rule[field]) {
        return false;
      }
    }

    if (typeof rule.check !== 'function') {
      return false;
    }

    return true;
  }

  /**
   * Execute hook
   */
  async executeHook(hookName, data) {
    if (!this.hooks.has(hookName)) {
      return data;
    }

    let result = data;
    const hooks = this.hooks.get(hookName);

    for (const hook of hooks) {
      try {
        const newResult = await hook.callback(result);
        if (newResult !== undefined) {
          result = newResult;
        }
      } catch (error) {
        this.log(`Error executing hook ${hookName} from ${hook.pluginId}: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Run custom rules
   */
  async runCustomRules(filePath, ast, context) {
    const issues = [];

    for (const [ruleId, rule] of this.customRules) {
      try {
        const result = await rule.check(filePath, ast, context);

        if (result) {
          if (Array.isArray(result)) {
            issues.push(...result.map(issue => ({
              ...issue,
              ruleId,
              pluginId: rule.pluginId,
              type: 'custom-rule'
            })));
          } else {
            issues.push({
              ...result,
              ruleId,
              pluginId: rule.pluginId,
              type: 'custom-rule'
            });
          }
        }
      } catch (error) {
        this.log(`Error running rule ${ruleId}: ${error.message}`);
      }
    }

    return issues;
  }

  /**
   * Get plugin
   */
  getPlugin(pluginId) {
    return this.plugins.get(pluginId);
  }

  /**
   * List plugins
   */
  listPlugins() {
    return Array.from(this.plugins.values()).map(plugin => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      author: plugin.manifest.author
    }));
  }

  /**
   * Unload plugin
   */
  async unloadPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      this.log(`Plugin ${pluginId} not found`);
      return false;
    }

    try {
      // Call onUnload if exists
      if (plugin.instance && typeof plugin.instance.onUnload === 'function') {
        await plugin.instance.onUnload();
      }

      // Remove hooks
      for (const [hookName, hooks] of this.hooks) {
        const filtered = hooks.filter(h => h.pluginId !== pluginId);
        this.hooks.set(hookName, filtered);
      }

      // Remove rules
      for (const [ruleId, rule] of this.customRules) {
        if (rule.pluginId === pluginId) {
          this.customRules.delete(ruleId);
        }
      }

      // Remove plugin
      this.plugins.delete(pluginId);

      this.log(`Unloaded plugin: ${pluginId}`);
      return true;

    } catch (error) {
      this.log(`Error unloading plugin ${pluginId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Reload plugin
   */
  async reloadPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      this.log(`Plugin ${pluginId} not found`);
      return false;
    }

    const pluginPath = plugin.path;

    await this.unloadPlugin(pluginId);
    await this.loadPlugin(pluginPath);

    return true;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      activePlugins: this.plugins.size,
      registeredHooks: this.hooks.size,
      customRules: this.customRules.size
    };
  }

  log(message) {
    if (this.verbose) {
      console.log(`[PluginManager] ${message}`);
    }
  }
}

/**
 * Plugin Base Class (for plugin developers)
 */
class Plugin {
  constructor(api) {
    this.api = api;
  }

  /**
   * Called when plugin is loaded
   */
  async onLoad() {
    // Override in subclass
  }

  /**
   * Called when plugin is unloaded
   */
  async onUnload() {
    // Override in subclass
  }

  /**
   * Register a hook
   */
  registerHook(hookName, callback) {
    this.api.registerHook(hookName, callback);
  }

  /**
   * Register a custom rule
   */
  registerRule(rule) {
    this.api.registerRule(rule);
  }

  /**
   * Log message
   */
  log(message) {
    this.api.log(message);
  }
}

module.exports = {
  PluginManager,
  Plugin
};

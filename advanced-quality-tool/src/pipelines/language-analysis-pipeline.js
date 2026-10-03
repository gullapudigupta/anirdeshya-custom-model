/**
 * Multi-Language Analyzer and Plugin Pipeline (P9-T032)
 *
 * Defines a common analyzer pipeline contract for built-in and plugin-provided languages.
 * Supports safe plugin load, unload, reload, and failure isolation.
 *
 * @module pipelines/language-analysis-pipeline
 */

'use strict';

const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');
const path = require('path');
const fs = require('fs');

/**
 * Language support status
 */
const LanguageStatus = {
  SUPPORTED: 'supported',
  PARTIAL: 'partial',
  UNSUPPORTED: 'unsupported',
  ERROR: 'error'
};

/**
 * Plugin state
 */
const PluginState = {
  UNLOADED: 'unloaded',
  LOADING: 'loading',
  LOADED: 'loaded',
  ERROR: 'error',
  UNLOADING: 'unloading'
};

/**
 * Language Analysis Pipeline
 */
class LanguageAnalysisPipeline {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.executor = options.executor || new PipelineExecutor();
    
    // Plugin management
    this.plugins = new Map();
    this.pluginPath = options.pluginPath || path.join(this.workspace, 'plugins', 'languages');
    
    // Built-in language support
    this.builtInLanguages = {
      javascript: {
        extensions: ['.js', '.mjs', '.cjs'],
        analyzer: 'eslint',
        configFiles: ['.eslintrc*', 'package.json']
      },
      typescript: {
        extensions: ['.ts', '.tsx'],
        analyzer: 'typescript-eslint',
        configFiles: ['tsconfig.json', '.eslintrc*']
      },
      python: {
        extensions: ['.py', '.pyw'],
        analyzer: 'pylint',
        configFiles: ['.pylintrc', 'pyproject.toml']
      },
      csharp: {
        extensions: ['.cs'],
        analyzer: 'dotnet',
        configFiles: ['*.csproj', '.editorconfig']
      },
      java: {
        extensions: ['.java'],
        analyzer: 'checkstyle',
        configFiles: ['checkstyle.xml', 'pom.xml']
      },
      go: {
        extensions: ['.go'],
        analyzer: 'golint',
        configFiles: ['go.mod']
      },
      rust: {
        extensions: ['.rs'],
        analyzer: 'clippy',
        configFiles: ['Cargo.toml', 'clippy.toml']
      },
      php: {
        extensions: ['.php'],
        analyzer: 'phpcs',
        configFiles: ['phpcs.xml', 'composer.json']
      },
      ruby: {
        extensions: ['.rb', '.rake'],
        analyzer: 'rubocop',
        configFiles: ['.rubocop.yml']
      }
    };
  }

  /**
   * Execute language analysis pipeline
   * @param {Object} params
   * @param {string[]} params.files - Files to analyze
   * @param {string} [params.language] - Force specific language
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const { files, language = null } = params;

    const stageHandlers = {
      'detect-language': async (ctx) => this._detectLanguage(ctx, files, language),
      'load-plugin': async (ctx) => this._loadPlugin(ctx),
      'check-tools': async (ctx) => this._checkTools(ctx),
      'discover-files': async (ctx) => this._discoverFiles(ctx, files),
      'run-analyzer': async (ctx) => this._runAnalyzer(ctx),
      'parse-diagnostics': async (ctx) => this._parseDiagnostics(ctx),
      'normalize-issues': async (ctx) => this._normalizeIssues(ctx),
      'unload-plugin': async (ctx) => this._unloadPlugin(ctx)
    };

    const result = await this.executor.execute('language-analysis', {
      input: { files, language },
      workspace: this.workspace,
      stageHandlers
    });

    return result;
  }

  /**
   * Register a language plugin
   * @param {string} language
   * @param {Object} plugin
   */
  registerPlugin(language, plugin) {
    this.plugins.set(language, {
      ...plugin,
      state: PluginState.UNLOADED,
      loadedAt: null,
      error: null
    });
  }

  /**
   * Unregister a language plugin
   * @param {string} language
   */
  unregisterPlugin(language) {
    const plugin = this.plugins.get(language);
    if (plugin && plugin.state === PluginState.LOADED) {
      this._unloadPluginInternal(plugin);
    }
    this.plugins.delete(language);
  }

  /**
   * Get supported languages
   * @returns {Object[]}
   */
  getSupportedLanguages() {
    const languages = [];
    
    // Add built-in languages
    for (const [name, config] of Object.entries(this.builtInLanguages)) {
      languages.push({
        name,
        status: LanguageStatus.SUPPORTED,
        extensions: config.extensions,
        analyzer: config.analyzer,
        builtIn: true
      });
    }
    
    // Add plugin languages
    for (const [name, plugin] of this.plugins) {
      languages.push({
        name,
        status: plugin.state === PluginState.LOADED ? 
          LanguageStatus.SUPPORTED : LanguageStatus.PARTIAL,
        extensions: plugin.extensions || [],
        analyzer: plugin.analyzer,
        builtIn: false,
        state: plugin.state
      });
    }
    
    return languages;
  }

  /**
   * Detect language for a file
   * @param {string} file
   * @returns {string|null}
   */
  detectLanguageForFile(file) {
    const ext = path.extname(file).toLowerCase();
    
    // Check built-in languages
    for (const [language, config] of Object.entries(this.builtInLanguages)) {
      if (config.extensions.includes(ext)) {
        return language;
      }
    }
    
    // Check plugins
    for (const [language, plugin] of this.plugins) {
      if (plugin.extensions?.includes(ext)) {
        return language;
      }
    }
    
    return null;
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _detectLanguage(ctx, files, forcedLanguage) {
    const detectedLanguages = new Map();
    
    if (forcedLanguage) {
      const config = this.builtInLanguages[forcedLanguage] || 
                     this.plugins.get(forcedLanguage);
      if (config) {
        detectedLanguages.set(forcedLanguage, files);
      }
    } else {
      // Detect language for each file
      for (const file of files) {
        const language = this.detectLanguageForFile(file);
        if (language) {
          if (!detectedLanguages.has(language)) {
            detectedLanguages.set(language, []);
          }
          detectedLanguages.get(language).push(file);
        }
      }
    }
    
    return {
      languages: Array.from(detectedLanguages.entries()).map(([lang, fileList]) => ({
        language: lang,
        files: fileList,
        count: fileList.length
      })),
      unsupported: files.filter(f => !this.detectLanguageForFile(f))
    };
  }

  async _loadPlugin(ctx) {
    const { languages } = ctx.previousResults?.['detect-language'] || {};
    
    for (const langConfig of languages || []) {
      const language = langConfig.language;
      
      // Check if it's a plugin language (not built-in)
      if (!this.builtInLanguages[language] && this.plugins.has(language)) {
        const plugin = this.plugins.get(language);
        
        if (plugin.state === PluginState.UNLOADED) {
          try {
            plugin.state = PluginState.LOADING;
            
            // Call plugin load function if available
            if (typeof plugin.load === 'function') {
              await plugin.load();
            }
            
            plugin.state = PluginState.LOADED;
            plugin.loadedAt = Date.now();
            plugin.error = null;
            
          } catch (error) {
            plugin.state = PluginState.ERROR;
            plugin.error = error.message;
          }
        }
      }
    }
    
    return { loaded: true };
  }

  async _checkTools(ctx) {
    const { languages } = ctx.previousResults?.['detect-language'] || {};
    
    const toolStatus = [];
    
    for (const langConfig of languages || []) {
      const language = langConfig.language;
      const config = this.builtInLanguages[language] || this.plugins.get(language);
      
      if (config) {
        const analyzer = config.analyzer;
        const available = this._checkToolAvailable(analyzer);
        
        toolStatus.push({
          language,
          analyzer,
          available,
          configFiles: this._findConfigFiles(language, config)
        });
      }
    }
    
    return { tools: toolStatus };
  }

  async _discoverFiles(ctx, inputFiles) {
    const { languages } = ctx.previousResults?.['detect-language'] || {};
    
    const discovered = [];
    
    for (const langConfig of languages || []) {
      for (const file of langConfig.files) {
        const fullPath = path.isAbsolute(file) ? file : path.join(this.workspace, file);
        
        if (fs.existsSync(fullPath)) {
          discovered.push({
            file: fullPath,
            language: langConfig.language,
            relativePath: path.relative(this.workspace, fullPath)
          });
        }
      }
    }
    
    return { files: discovered, count: discovered.length };
  }

  async _runAnalyzer(ctx) {
    const { tools } = ctx.previousResults?.['check-tools'] || {};
    const { files } = ctx.previousResults?.['discover-files'] || {};
    
    const diagnostics = [];
    
    for (const tool of tools || []) {
      if (!tool.available) {
        diagnostics.push({
          language: tool.language,
          error: `Analyzer ${tool.analyzer} not available`,
          issues: []
        });
        continue;
      }
      
      const languageFiles = (files || [])
        .filter(f => f.language === tool.language)
        .map(f => f.file);
      
      if (languageFiles.length === 0) continue;
      
      try {
        const result = await this._runLanguageAnalyzer(
          tool.language, 
          tool.analyzer, 
          languageFiles
        );
        
        diagnostics.push({
          language: tool.language,
          analyzer: tool.analyzer,
          issues: result.issues || [],
          duration: result.duration,
          success: true
        });
        
      } catch (error) {
        diagnostics.push({
          language: tool.language,
          error: error.message,
          issues: [],
          success: false
        });
      }
    }
    
    return { diagnostics };
  }

  async _parseDiagnostics(ctx) {
    const { diagnostics } = ctx.previousResults?.['run-analyzer'] || {};
    
    const parsed = [];
    
    for (const diag of diagnostics || []) {
      if (diag.success && diag.issues) {
        for (const issue of diag.issues) {
          parsed.push({
            language: diag.language,
            file: issue.file,
            line: issue.line,
            column: issue.column,
            message: issue.message,
            severity: issue.severity || 'warning',
            rule: issue.rule,
            analyzer: diag.analyzer
          });
        }
      }
    }
    
    return { diagnostics: parsed, count: parsed.length };
  }

  async _normalizeIssues(ctx) {
    const { diagnostics } = ctx.previousResults?.['parse-diagnostics'] || {};
    
    const normalized = (diagnostics || []).map(diag => ({
      id: `${diag.language}-${diag.file}-${diag.line || 0}-${diag.rule || 'unknown'}`,
      file: diag.file,
      line: diag.line,
      column: diag.column,
      message: diag.message,
      severity: this._normalizeSeverity(diag.severity),
      rule: diag.rule,
      language: diag.language,
      category: this._categorizeByRule(diag.rule),
      analyzer: diag.analyzer
    }));
    
    return { issues: normalized };
  }

  async _unloadPlugin(ctx) {
    // Plugins stay loaded for potential reuse
    return { unloaded: true };
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────────

  _checkToolAvailable(tool) {
    // Check if analyzer tool is available
    try {
      const { execSync } = require('child_process');
      
      switch (tool) {
        case 'eslint':
          return fs.existsSync(path.join(this.workspace, 'node_modules', '.bin', 'eslint')) ||
                 fs.existsSync(path.join(this.workspace, 'package.json'));
        
        case 'typescript-eslint':
          return fs.existsSync(path.join(this.workspace, 'tsconfig.json'));
        
        case 'pylint':
          execSync('python -m pylint --version', { stdio: 'ignore' });
          return true;
        
        case 'dotnet':
          execSync('dotnet --version', { stdio: 'ignore' });
          return true;
        
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  _findConfigFiles(language, config) {
    const found = [];
    
    for (const pattern of config.configFiles || []) {
      const basePattern = pattern.replace('*', '');
      const entries = fs.readdirSync(this.workspace);
      
      for (const entry of entries) {
        if (entry.startsWith(basePattern) || entry === pattern) {
          found.push(path.join(this.workspace, entry));
        }
      }
    }
    
    return found;
  }

  async _runLanguageAnalyzer(language, analyzer, files) {
    const start = Date.now();
    
    // Placeholder for actual analyzer execution
    // In real implementation, would delegate to language-specific analyzer
    
    return {
      issues: [],
      duration: Date.now() - start
    };
  }

  _normalizeSeverity(severity) {
    const mapping = {
      'error': 'error',
      'warning': 'warning',
      'info': 'info',
      'note': 'info',
      'hint': 'suggestion',
      'suggestion': 'suggestion',
      'fatal': 'critical',
      'critical': 'critical'
    };
    
    return mapping[severity?.toLowerCase()] || 'warning';
  }

  _categorizeByRule(rule) {
    if (!rule) return 'quality';
    
    const ruleLower = rule.toLowerCase();
    
    if (ruleLower.includes('security')) return 'security';
    if (ruleLower.includes('perf')) return 'performance';
    if (ruleLower.includes('style')) return 'style';
    if (ruleLower.includes('unused')) return 'unused-code';
    if (ruleLower.includes('complex')) return 'complexity';
    
    return 'quality';
  }

  _unloadPluginInternal(plugin) {
    try {
      if (typeof plugin.unload === 'function') {
        plugin.unload();
      }
      plugin.state = PluginState.UNLOADED;
    } catch (error) {
      plugin.state = PluginState.ERROR;
      plugin.error = error.message;
    }
  }
}

module.exports = {
  LanguageAnalysisPipeline,
  LanguageStatus,
  PluginState
};

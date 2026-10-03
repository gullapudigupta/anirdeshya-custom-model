/**
 * Package Configuration Reader (P9-T007)
 *
 * Reads package.json to discover lint, test, and analysis commands.
 * Never uses the tool's own package.json - always the selected project's.
 *
 * @module workspace/package-config-reader
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Package Config Reader
 */
class PackageConfigReader {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
  }

  /**
   * Read and parse package.json from workspace
   * @param {string} [workspaceRoot] - Override workspace root
   * @returns {Object|null}
   */
  read(workspaceRoot = null) {
    const root = workspaceRoot || this.workspace;
    const packagePath = path.join(root, 'package.json');

    if (!fs.existsSync(packagePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(packagePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Discover available commands from package.json scripts
   * @param {string} [workspaceRoot]
   * @returns {Object}
   */
  discoverCommands(workspaceRoot = null) {
    const pkg = this.read(workspaceRoot);
    
    if (!pkg || !pkg.scripts) {
      return {
        lint: [],
        test: [],
        build: [],
        analyze: []
      };
    }

    const commands = {
      lint: [],
      test: [],
      build: [],
      analyze: []
    };

    // Categorize scripts
    for (const [scriptName, scriptCommand] of Object.entries(pkg.scripts)) {
      const lower = scriptName.toLowerCase();
      
      // Lint commands
      if (lower.includes('lint') || lower === 'eslint' || lower === 'tslint') {
        commands.lint.push({
          name: scriptName,
          command: scriptCommand,
          tool: this._detectTool(scriptCommand)
        });
      }
      
      // Test commands
      else if (lower.includes('test') || lower === 'jest' || lower === 'mocha' || lower === 'vitest') {
        commands.test.push({
          name: scriptName,
          command: scriptCommand,
          tool: this._detectTool(scriptCommand)
        });
      }
      
      // Build commands
      else if (lower.includes('build') || lower === 'compile' || lower === 'tsc') {
        commands.build.push({
          name: scriptName,
          command: scriptCommand,
          tool: this._detectTool(scriptCommand)
        });
      }
      
      // Analysis commands
      else if (lower.includes('analyze') || lower.includes('sonar') || lower.includes('quality')) {
        commands.analyze.push({
          name: scriptName,
          command: scriptCommand,
          tool: this._detectTool(scriptCommand)
        });
      }
    }

    return commands;
  }

  /**
   * Detect installed linters from dependencies
   * @param {string} [workspaceRoot]
   * @returns {Object}
   */
  detectLinters(workspaceRoot = null) {
    const pkg = this.read(workspaceRoot);
    
    if (!pkg) {
      return { available: [], unavailable: [] };
    }

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies
    };

    const linterDefinitions = {
      eslint: { package: 'eslint', configFiles: ['.eslintrc.js', '.eslintrc.json', '.eslintrc'] },
      prettier: { package: 'prettier', configFiles: ['.prettierrc', 'prettier.config.js'] },
      stylelint: { package: 'stylelint', configFiles: ['.stylelintrc.json', 'stylelint.config.js'] },
      tslint: { package: 'tslint', configFiles: ['tslint.json'] },
      jshint: { package: 'jshint', configFiles: ['.jshintrc'] }
    };

    const available = [];
    const unavailable = [];

    for (const [linterName, linterDef] of Object.entries(linterDefinitions)) {
      const isInstalled = allDeps[linterDef.package] !== undefined;
      const hasConfig = linterDef.configFiles.some(configFile => 
        fs.existsSync(path.join(workspaceRoot || this.workspace, configFile))
      );

      const linterInfo = {
        name: linterName,
        package: linterDef.package,
        version: allDeps[linterDef.package] || null,
        hasConfig
      };

      if (isInstalled) {
        available.push(linterInfo);
      } else {
        unavailable.push(linterInfo);
      }
    }

    return { available, unavailable };
  }

  /**
   * Get test framework configuration
   * @param {string} [workspaceRoot]
   * @returns {Object}
   */
  getTestConfig(workspaceRoot = null) {
    const pkg = this.read(workspaceRoot);
    
    if (!pkg) {
      return { framework: null, config: null };
    }

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies
    };

    // Detect test framework
    let framework = null;
    if (allDeps.jest) framework = 'jest';
    else if (allDeps.mocha) framework = 'mocha';
    else if (allDeps.vitest) framework = 'vitest';
    else if (allDeps.jasmine) framework = 'jasmine';
    else if (allDeps.ava) framework = 'ava';

    // Get framework-specific config
    let config = null;
    if (framework === 'jest' && pkg.jest) {
      config = pkg.jest;
    }

    return { framework, config };
  }

  /**
   * Get project metadata
   * @param {string} [workspaceRoot]
   * @returns {Object}
   */
  getProjectMetadata(workspaceRoot = null) {
    const pkg = this.read(workspaceRoot);
    
    if (!pkg) {
      return {
        name: 'unknown',
        version: '0.0.0',
        type: 'unknown',
        hasTypeScript: false
      };
    }

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies
    };

    return {
      name: pkg.name || 'unknown',
      version: pkg.version || '0.0.0',
      type: pkg.type || 'commonjs',
      hasTypeScript: allDeps.typescript !== undefined,
      nodeVersion: pkg.engines?.node || null,
      main: pkg.main || null,
      scripts: Object.keys(pkg.scripts || {})
    };
  }

  /**
   * Detect tool from command string
   * @private
   */
  _detectTool(command) {
    const lower = command.toLowerCase();
    
    if (lower.includes('eslint')) return 'eslint';
    if (lower.includes('prettier')) return 'prettier';
    if (lower.includes('stylelint')) return 'stylelint';
    if (lower.includes('tslint')) return 'tslint';
    if (lower.includes('jest')) return 'jest';
    if (lower.includes('mocha')) return 'mocha';
    if (lower.includes('vitest')) return 'vitest';
    if (lower.includes('tsc')) return 'typescript';
    if (lower.includes('webpack')) return 'webpack';
    if (lower.includes('rollup')) return 'rollup';
    if (lower.includes('vite')) return 'vite';
    
    return 'unknown';
  }
}

module.exports = {
  PackageConfigReader
};

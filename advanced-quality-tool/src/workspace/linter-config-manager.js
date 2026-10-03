/**
 * Linter Configuration Manager (P9-T007)
 *
 * Provides editable default linter selection based on detected tools,
 * with per-project persistence and clear unavailable state.
 *
 * @module workspace/linter-config-manager
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Linter Config Manager
 */
class LinterConfigManager {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.configFileName = options.configFileName || '.aqt-linter-config.json';
  }

  /**
   * Get linter configuration for workspace
   * @param {Object} availableLinters - From PackageConfigReader.detectLinters()
   * @returns {Object}
   */
  getConfig(availableLinters) {
    const savedConfig = this._loadSavedConfig();
    const defaultConfig = this._generateDefaultConfig(availableLinters);

    // Merge saved with defaults, preferring saved
    return {
      ...defaultConfig,
      ...savedConfig,
      available: availableLinters.available,
      unavailable: availableLinters.unavailable
    };
  }

  /**
   * Save linter configuration
   * @param {Object} config
   */
  saveConfig(config) {
    const configPath = path.join(this.workspace, this.configFileName);
    
    const persistConfig = {
      selectedLinters: config.selectedLinters || [],
      enabled: config.enabled !== false,
      runOnSave: config.runOnSave || false,
      savedAt: new Date().toISOString()
    };

    try {
      fs.writeFileSync(configPath, JSON.stringify(persistConfig, null, 2), 'utf8');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Update selected linters
   * @param {Array<string>} linterNames
   * @param {Object} availableLinters
   * @returns {Object} Updated config
   */
  updateSelection(linterNames, availableLinters) {
    const config = this.getConfig(availableLinters);
    
    // Filter to only available linters
    const availableNames = availableLinters.available.map(l => l.name);
    const validSelection = linterNames.filter(name => availableNames.includes(name));

    config.selectedLinters = validSelection;
    this.saveConfig(config);

    return config;
  }

  /**
   * Enable/disable linters
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    const config = this._loadSavedConfig() || {};
    config.enabled = enabled;
    this.saveConfig(config);
  }

  /**
   * Get recommended linters based on project type
   * @param {Object} projectMetadata - From PackageConfigReader.getProjectMetadata()
   * @param {Object} availableLinters
   * @returns {Array<string>}
   */
  getRecommendedLinters(projectMetadata, availableLinters) {
    const recommended = [];
    const availableNames = availableLinters.available.map(l => l.name);

    // Always recommend ESLint if available
    if (availableNames.includes('eslint')) {
      recommended.push('eslint');
    }

    // Recommend Prettier for formatting
    if (availableNames.includes('prettier')) {
      recommended.push('prettier');
    }

    // Recommend StyleLint for CSS/SCSS projects
    if (availableNames.includes('stylelint')) {
      recommended.push('stylelint');
    }

    // TypeScript projects: prefer ESLint over TSLint
    if (projectMetadata.hasTypeScript) {
      if (!recommended.includes('eslint') && availableNames.includes('tslint')) {
        recommended.push('tslint');
      }
    }

    return recommended;
  }

  /**
   * Validate configuration
   * @param {Object} config
   * @param {Object} availableLinters
   * @returns {Object} { valid: boolean, issues: Array }
   */
  validateConfig(config, availableLinters) {
    const issues = [];
    const availableNames = availableLinters.available.map(l => l.name);

    // Check if selected linters are available
    for (const selected of config.selectedLinters || []) {
      if (!availableNames.includes(selected)) {
        issues.push({
          severity: 'error',
          message: `Selected linter '${selected}' is not installed`,
          linter: selected
        });
      }
    }

    // Warn if no linters selected
    if (!config.selectedLinters || config.selectedLinters.length === 0) {
      issues.push({
        severity: 'warning',
        message: 'No linters selected - analysis will not run'
      });
    }

    // Warn if linters are disabled
    if (config.enabled === false) {
      issues.push({
        severity: 'info',
        message: 'Linters are currently disabled'
      });
    }

    return {
      valid: !issues.some(i => i.severity === 'error'),
      issues
    };
  }

  /**
   * Reset to defaults
   * @param {Object} availableLinters
   * @param {Object} projectMetadata
   */
  resetToDefaults(availableLinters, projectMetadata) {
    const recommended = this.getRecommendedLinters(projectMetadata, availableLinters);
    const config = {
      selectedLinters: recommended,
      enabled: true,
      runOnSave: false
    };
    
    this.saveConfig(config);
    return config;
  }

  // ─── Private methods ──────────────────────────────────────────────────────────

  _loadSavedConfig() {
    const configPath = path.join(this.workspace, this.configFileName);
    
    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  _generateDefaultConfig(availableLinters) {
    return {
      selectedLinters: availableLinters.available.map(l => l.name),
      enabled: true,
      runOnSave: false,
      available: availableLinters.available,
      unavailable: availableLinters.unavailable
    };
  }
}

module.exports = {
  LinterConfigManager
};

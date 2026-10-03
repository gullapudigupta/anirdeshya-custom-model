/**
 * Rule-Based Auto-Fix Engine
 * 
 * Implements deterministic, rule-based fixes for common code quality issues.
 * Uses ESLint --fix, Prettier format, and StyleLint --fix capabilities.
 * 
 * @module fixers/rule-based-fixer
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Remove the filesystem root (e.g. Windows drive `C:\`) from a path so it can
 * be nested under a backup directory without resetting a path.join().
 *
 * @param {string} filePath
 * @returns {string} root-relative path
 */
function stripPathRoot(filePath) {
  const parsed = path.parse(filePath);
  if (!parsed.root) return filePath;
  return path.relative(parsed.root, filePath);
}

/**
 * Base class for all rule-based fixers
 */
class RuleBasedFixer {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.backup = options.backup !== false; // Default true
    this.verbose = options.verbose || false;
    this.backupDir = options.backupDir || '.aqt-backup';
  }

  /**
   * Create backup of file before fixing
   */
  async createBackup(filePath) {
    if (!this.backup) return null;

    const backupPath = path.join(
      this.backupDir,
      new Date().toISOString().replace(/:/g, '-'),
      stripPathRoot(filePath)
    );

    const backupDirPath = path.dirname(backupPath);
    if (!fs.existsSync(backupDirPath)) {
      fs.mkdirSync(backupDirPath, { recursive: true });
    }

    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }

  /**
   * Restore file from backup
   */
  async restoreBackup(filePath, backupPath) {
    if (!backupPath || !fs.existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }
    fs.copyFileSync(backupPath, filePath);
  }

  /**
   * Check if tool is available
   */
  async isAvailable() {
    throw new Error('isAvailable() must be implemented by subclass');
  }

  /**
   * Fix a single file
   */
  async fixFile(filePath, issues = []) {
    throw new Error('fixFile() must be implemented by subclass');
  }

  /**
   * Fix multiple files
   */
  async fixFiles(filePaths, issuesMap = {}) {
    const results = [];

    for (const filePath of filePaths) {
      const issues = issuesMap[filePath] || [];
      const result = await this.fixFile(filePath, issues);
      results.push(result);
    }

    return results;
  }

  log(message) {
    if (this.verbose) {
      console.log(`[RuleBasedFixer] ${message}`);
    }
  }
}

/**
 * ESLint-based fixer
 * Fixes JavaScript/TypeScript issues using ESLint --fix
 */
class ESLintRuleFixer extends RuleBasedFixer {
  constructor(options = {}) {
    super(options);
    this.eslintPath = options.eslintPath || 'eslint';
    this.configFile = options.configFile || null;
  }

  async isAvailable() {
    try {
      execSync(`${this.eslintPath} --version`, { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  async fixFile(filePath, issues = []) {
    const result = {
      filePath,
      success: false,
      fixedCount: 0,
      errors: [],
      backupPath: null
    };

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        result.errors.push(`File not found: ${filePath}`);
        return result;
      }

      // Create backup
      if (!this.dryRun) {
        result.backupPath = await this.createBackup(filePath);
      }

      // Build ESLint command
      const configArg = this.configFile ? `--config ${this.configFile}` : '';
      const fixArg = this.dryRun ? '--fix-dry-run' : '--fix';
      const command = `${this.eslintPath} ${fixArg} ${configArg} "${filePath}" --format json`;

      this.log(`Running: ${command}`);

      // Execute ESLint
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });

      // Parse ESLint output
      let eslintResults = [];
      try {
        eslintResults = JSON.parse(stdout || '[]');
      } catch (parseError) {
        // ESLint might not return valid JSON on success
        this.log('Could not parse ESLint output, assuming success');
      }

      // Count fixes
      if (eslintResults.length > 0) {
        const fileResult = eslintResults[0];
        const beforeCount = fileResult.errorCount + fileResult.warningCount;
        const afterCount = fileResult.messages ? fileResult.messages.length : 0;
        result.fixedCount = Math.max(0, beforeCount - afterCount);
      } else {
        // If issues were passed in, assume they were fixed
        result.fixedCount = issues.filter(i => i.fixable === true).length;
      }

      result.success = true;
      this.log(`Fixed ${result.fixedCount} issues in ${filePath}`);

    } catch (error) {
      result.errors.push(error.message);
      this.log(`Error fixing ${filePath}: ${error.message}`);

      // Restore backup on error
      if (result.backupPath && !this.dryRun) {
        try {
          await this.restoreBackup(filePath, result.backupPath);
          this.log(`Restored backup for ${filePath}`);
        } catch (restoreError) {
          result.errors.push(`Failed to restore backup: ${restoreError.message}`);
        }
      }
    }

    return result;
  }

  /**
   * Fix specific ESLint rules
   */
  async fixRules(filePath, ruleIds = []) {
    if (ruleIds.length === 0) {
      return this.fixFile(filePath);
    }

    const result = {
      filePath,
      success: false,
      fixedCount: 0,
      errors: [],
      backupPath: null
    };

    try {
      // Create backup
      if (!this.dryRun) {
        result.backupPath = await this.createBackup(filePath);
      }

      // Fix each rule individually
      for (const ruleId of ruleIds) {
        const command = `${this.eslintPath} --fix --rule "${ruleId}: error" "${filePath}"`;
        this.log(`Running: ${command}`);

        try {
          await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
          result.fixedCount++;
        } catch (error) {
          this.log(`Rule ${ruleId} fix failed: ${error.message}`);
        }
      }

      result.success = true;

    } catch (error) {
      result.errors.push(error.message);

      if (result.backupPath && !this.dryRun) {
        await this.restoreBackup(filePath, result.backupPath);
      }
    }

    return result;
  }
}

/**
 * Prettier-based fixer
 * Formats code using Prettier
 */
class PrettierRuleFixer extends RuleBasedFixer {
  constructor(options = {}) {
    super(options);
    this.prettierPath = options.prettierPath || 'prettier';
    this.configFile = options.configFile || null;
  }

  async isAvailable() {
    try {
      execSync(`${this.prettierPath} --version`, { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  async fixFile(filePath, issues = []) {
    const result = {
      filePath,
      success: false,
      fixedCount: 0,
      errors: [],
      backupPath: null,
      formatted: false
    };

    try {
      if (!fs.existsSync(filePath)) {
        result.errors.push(`File not found: ${filePath}`);
        return result;
      }

      // Create backup
      if (!this.dryRun) {
        result.backupPath = await this.createBackup(filePath);
      }

      // Read original content
      const originalContent = fs.readFileSync(filePath, 'utf8');

      // Build Prettier command
      const configArg = this.configFile ? `--config ${this.configFile}` : '';
      const writeArg = this.dryRun ? '--check' : '--write';
      const command = `${this.prettierPath} ${writeArg} ${configArg} "${filePath}"`;

      this.log(`Running: ${command}`);

      // Execute Prettier
      await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });

      // Check if file was modified
      if (!this.dryRun) {
        const newContent = fs.readFileSync(filePath, 'utf8');
        result.formatted = originalContent !== newContent;

        if (result.formatted) {
          // Count formatting-related issues that were fixed
          result.fixedCount = issues.filter(i => 
            i.category === 'STYLE' || 
            i.ruleId && (
              i.ruleId.includes('format') ||
              i.ruleId.includes('indent') ||
              i.ruleId.includes('spacing') ||
              i.ruleId.includes('semicolon') ||
              i.ruleId.includes('quotes')
            )
          ).length || 1; // At least 1 if formatted
        }
      }

      result.success = true;
      this.log(`Formatted ${filePath}`);

    } catch (error) {
      // Prettier returns non-zero exit when file needs formatting in --check mode
      if (this.dryRun && error.code === 1) {
        result.success = true;
        result.formatted = true;
        this.log(`${filePath} needs formatting (dry-run)`);
      } else {
        result.errors.push(error.message);
        this.log(`Error formatting ${filePath}: ${error.message}`);

        if (result.backupPath && !this.dryRun) {
          await this.restoreBackup(filePath, result.backupPath);
        }
      }
    }

    return result;
  }
}

/**
 * StyleLint-based fixer
 * Fixes CSS/SCSS/Less issues
 */
class StyleLintRuleFixer extends RuleBasedFixer {
  constructor(options = {}) {
    super(options);
    this.stylelintPath = options.stylelintPath || 'stylelint';
    this.configFile = options.configFile || null;
  }

  async isAvailable() {
    try {
      execSync(`${this.stylelintPath} --version`, { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  async fixFile(filePath, issues = []) {
    const result = {
      filePath,
      success: false,
      fixedCount: 0,
      errors: [],
      backupPath: null
    };

    try {
      if (!fs.existsSync(filePath)) {
        result.errors.push(`File not found: ${filePath}`);
        return result;
      }

      // Create backup
      if (!this.dryRun) {
        result.backupPath = await this.createBackup(filePath);
      }

      // Build StyleLint command
      const configArg = this.configFile ? `--config ${this.configFile}` : '';
      const fixArg = this.dryRun ? '--fix-dry-run' : '--fix';
      const command = `${this.stylelintPath} ${fixArg} ${configArg} "${filePath}" --formatter json`;

      this.log(`Running: ${command}`);

      // Execute StyleLint
      const { stdout } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024
      });

      // Parse StyleLint output
      let stylelintResults = [];
      try {
        stylelintResults = JSON.parse(stdout || '[]');
      } catch (parseError) {
        this.log('Could not parse StyleLint output');
      }

      // Count fixes
      if (stylelintResults.length > 0) {
        const fileResult = stylelintResults[0];
        result.fixedCount = issues.length - (fileResult.warnings || []).length;
      } else {
        result.fixedCount = issues.filter(i => i.fixable === true).length;
      }

      result.success = true;
      this.log(`Fixed ${result.fixedCount} issues in ${filePath}`);

    } catch (error) {
      result.errors.push(error.message);
      this.log(`Error fixing ${filePath}: ${error.message}`);

      if (result.backupPath && !this.dryRun) {
        await this.restoreBackup(filePath, result.backupPath);
      }
    }

    return result;
  }
}

/**
 * Pattern-based fixer for common simple fixes
 */
class PatternFixer extends RuleBasedFixer {
  constructor(options = {}) {
    super(options);
    this.patterns = this.getDefaultPatterns();
  }

  async isAvailable() {
    return true; // Always available
  }

  getDefaultPatterns() {
    return {
      // Add missing semicolons
      'missing-semicolon': {
        pattern: /([^;\s])\s*\n/g,
        replacement: '$1;\n',
        description: 'Add missing semicolons'
      },

      // Remove trailing whitespace
      'trailing-whitespace': {
        pattern: /[ \t]+$/gm,
        replacement: '',
        description: 'Remove trailing whitespace'
      },

      // Normalize line endings
      'line-endings': {
        pattern: /\r\n/g,
        replacement: '\n',
        description: 'Normalize line endings to LF'
      },

      // Remove multiple blank lines
      'multiple-blank-lines': {
        pattern: /\n{3,}/g,
        replacement: '\n\n',
        description: 'Remove multiple blank lines'
      },

      // Add space after comma
      'space-after-comma': {
        pattern: /,(?=\S)/g,
        replacement: ', ',
        description: 'Add space after comma'
      },

      // Fix var to const/let (simple cases)
      'no-var': {
        pattern: /\bvar\s+(\w+)\s*=/g,
        replacement: 'const $1 =',
        description: 'Replace var with const (requires manual review)'
      }
    };
  }

  async fixFile(filePath, issues = []) {
    const result = {
      filePath,
      success: false,
      fixedCount: 0,
      errors: [],
      backupPath: null,
      appliedPatterns: []
    };

    try {
      if (!fs.existsSync(filePath)) {
        result.errors.push(`File not found: ${filePath}`);
        return result;
      }

      // Create backup
      if (!this.dryRun) {
        result.backupPath = await this.createBackup(filePath);
      }

      // Read file content
      let content = fs.readFileSync(filePath, 'utf8');
      const originalContent = content;

      // Apply patterns
      for (const [name, pattern] of Object.entries(this.patterns)) {
        const before = content;
        content = content.replace(pattern.pattern, pattern.replacement);

        if (content !== before) {
          result.appliedPatterns.push(name);
          result.fixedCount++;
          this.log(`Applied pattern: ${pattern.description}`);
        }
      }

      // Write fixed content
      if (!this.dryRun && content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
      }

      result.success = true;

    } catch (error) {
      result.errors.push(error.message);

      if (result.backupPath && !this.dryRun) {
        await this.restoreBackup(filePath, result.backupPath);
      }
    }

    return result;
  }
}

/**
 * Coordinator for all rule-based fixers
 */
class RuleBasedFixEngine {
  constructor(options = {}) {
    this.options = options;
    this.eslintFixer = new ESLintRuleFixer(options);
    this.prettierFixer = new PrettierRuleFixer(options);
    this.stylelintFixer = new StyleLintRuleFixer(options);
    this.patternFixer = new PatternFixer(options);
  }

  /**
   * Detect which fixers are available
   */
  async detectAvailableFixers() {
    const available = {
      eslint: await this.eslintFixer.isAvailable(),
      prettier: await this.prettierFixer.isAvailable(),
      stylelint: await this.stylelintFixer.isAvailable(),
      pattern: await this.patternFixer.isAvailable()
    };

    return available;
  }

  /**
   * Get appropriate fixer for file type and issues
   */
  getFixer(filePath, issues = []) {
    const ext = path.extname(filePath).toLowerCase();

    // CSS/SCSS/Less -> StyleLint
    if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
      return this.stylelintFixer;
    }

    // JS/TS -> ESLint first, then Prettier
    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
      return [this.eslintFixer, this.prettierFixer];
    }

    // JSON/Markdown -> Prettier
    if (['.json', '.md', '.markdown'].includes(ext)) {
      return this.prettierFixer;
    }

    // Fallback to pattern fixer
    return this.patternFixer;
  }

  /**
   * Fix a single file using appropriate fixers
   */
  async fixFile(filePath, issues = []) {
    const fixers = this.getFixer(filePath, issues);
    const fixersArray = Array.isArray(fixers) ? fixers : [fixers];

    const results = [];

    for (const fixer of fixersArray) {
      const result = await fixer.fixFile(filePath, issues);
      results.push(result);
    }

    // Combine results
    const combined = {
      filePath,
      success: results.every(r => r.success),
      fixedCount: results.reduce((sum, r) => sum + r.fixedCount, 0),
      errors: results.flatMap(r => r.errors),
      results: results
    };

    return combined;
  }

  /**
   * Fix multiple files
   */
  async fixFiles(issuesMap = {}) {
    const results = [];

    for (const [filePath, issues] of Object.entries(issuesMap)) {
      const result = await this.fixFile(filePath, issues);
      results.push(result);
    }

    return results;
  }

  /**
   * Get fix statistics
   */
  getStats(results) {
    const stats = {
      totalFiles: results.length,
      successfulFiles: results.filter(r => r.success).length,
      failedFiles: results.filter(r => !r.success).length,
      totalFixes: results.reduce((sum, r) => sum + r.fixedCount, 0),
      totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0)
    };

    return stats;
  }
}

module.exports = {
  RuleBasedFixer,
  ESLintRuleFixer,
  PrettierRuleFixer,
  StyleLintRuleFixer,
  PatternFixer,
  RuleBasedFixEngine
};

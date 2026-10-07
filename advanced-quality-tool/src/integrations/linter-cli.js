/**
 * External Linter CLI Integration
 * 
 * Executes external linting tools (ESLint, TSLint, Prettier, StyleLint)
 * and normalizes their output into a common issue format.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ExternalLanguageAnalyzer } = require('../languages/external-language-analyzer');

const EXTERNAL_LINTERS = {
  pylint: { command: 'pylint', extensions: ['.py'], args: files => ['--output-format=json', ...files], parser: 'json' },
  flake8: { command: 'flake8', extensions: ['.py'], args: files => ['--format=%(path)s:%(row)d:%(col)d: %(code)s %(text)s', ...files], parser: 'text' },
  black: { command: 'black', extensions: ['.py'], args: files => ['--check', ...files], parser: 'format' },
  rubocop: { command: 'rubocop', extensions: ['.rb'], args: files => ['--format', 'json', ...files], parser: 'rubocop' },
  golint: { command: 'golint', extensions: ['.go'], args: files => files, parser: 'text' },
  staticcheck: { command: 'staticcheck', extensions: ['.go'], args: files => files, parser: 'text' },
  clippy: { command: 'cargo', extensions: ['.rs'], args: () => ['clippy', '--message-format=short'], parser: 'text' },
  phpcs: { command: 'phpcs', extensions: ['.php'], args: files => ['--report=json', ...files], parser: 'phpcs' },
  swiftlint: { command: 'swiftlint', extensions: ['.swift'], args: files => ['lint', '--quiet', ...files], parser: 'text' }
};

function executableAvailable(command, projectRoot) {
  const binName = process.platform === 'win32' ? `${command}.cmd` : command;
  const localBin = path.join(projectRoot, 'node_modules', '.bin', binName);
  const localBinWithoutCmd = path.join(projectRoot, 'node_modules', '.bin', command);
  if (fs.existsSync(localBin) || fs.existsSync(localBinWithoutCmd)) return true;
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  return spawnSync(locator, [command], { encoding: 'utf8', windowsHide: true }).status === 0;
}

/**
 * Detect which linters are available in the project
 */
function detectAvailableLinters(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const packageJson = fs.existsSync(packageJsonPath)
    ? JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    : {};
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };

  return {
    eslint: !!allDeps['eslint'],
    prettier: !!allDeps['prettier'],
    stylelint: !!allDeps['stylelint'],
    tslint: !!allDeps['tslint'], // Deprecated but still check
    typescript: !!allDeps['typescript'],
    ...Object.fromEntries(Object.entries(EXTERNAL_LINTERS).map(([name, tool]) =>
      [name, executableAvailable(tool.command, projectRoot)]))
  };
}

/**
 * Base class for linter integrations
 */
class LinterIntegration {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }

  /**
   * Check if linter is available
   */
  isAvailable() {
    throw new Error('Must implement isAvailable()');
  }

  /**
   * Run linter and return raw output
   */
  async run(files = []) {
    throw new Error('Must implement run()');
  }

  /**
   * Parse linter output into normalized format
   */
  parse(rawOutput) {
    throw new Error('Must implement parse()');
  }

  /**
   * Execute command and return stdout/stderr
   */
  exec(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.projectRoot,
        shell: true,
        ...options
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        // ESLint exits with 1 if there are issues, which is not an error
        if (code !== 0 && code !== 1 && !options.allowNonZero) {
          const error = new Error(`Command failed with code ${code}: ${stderr}`);
          error.stdout = stdout;
          error.stderr = stderr;
          error.exitCode = code;
          reject(error);
        } else {
          resolve({ stdout, stderr, exitCode: code });
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }
}

class ExternalCliIntegration extends LinterIntegration {
  constructor(projectRoot, name, definition = EXTERNAL_LINTERS[name]) {
    super(projectRoot);
    if (!definition) throw new Error(`Unknown external linter: ${name}`);
    this.name = name;
    this.definition = definition;
    this.normalizer = new ExternalLanguageAnalyzer({ language: name });
  }

  isAvailable() {
    return executableAvailable(this.definition.command, this.projectRoot);
  }

  async run(files = []) {
    const candidates = files.length
      ? files.filter(file => this.definition.extensions.includes(path.extname(file).toLowerCase()))
      : findFilesForExtensions(this.projectRoot, this.definition.extensions);
    if (candidates.length === 0) return '';
    const args = this.definition.args(candidates);
    const result = await this.exec(this.definition.command, args, { allowNonZero: true });
    if (!result.stdout.trim() && !result.stderr.trim()) {
      if (result.exitCode !== 0) throw new Error(`${this.name} exited with code ${result.exitCode} without diagnostics`);
      return '';
    }
    return result.stdout || result.stderr;
  }

  parse(rawOutput) {
    if (!rawOutput.trim()) return [];
    if (this.definition.parser === 'format') {
      return rawOutput.split(/\r?\n/).flatMap(line => {
        const match = line.match(/^\s*would reformat\s+(.+?)\s*$/i);
        return match ? [this.normalizer.issue(this.name, match[1], {
          ruleId: 'format', message: 'File is not formatted by Black', severity: 'warning'
        })] : [];
      });
    }
    return this.normalizer.parseOutput(this.name, rawOutput, this.projectRoot, this.definition.parser);
  }
}

function findFilesForExtensions(root, extensions) {
  const files = [];
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', 'target']);
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) visit(path.join(directory, entry.name));
      } else if (extensions.includes(path.extname(entry.name).toLowerCase())) {
        files.push(path.join(directory, entry.name));
      }
    }
  };
  visit(root);
  return files;
}

/**
 * ESLint Integration
 */
class ESLintIntegration extends LinterIntegration {
  isAvailable() {
    try {
      const eslintPath = path.join(this.projectRoot, 'node_modules', '.bin', 'eslint');
      return fs.existsSync(eslintPath) || fs.existsSync(eslintPath + '.cmd');
    } catch {
      return false;
    }
  }

  async run(files = []) {
    const eslintBin = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
    const args = [
      '--format', 'json',
      '--no-color'
    ];

    if (files.length > 0) {
      args.push(...files);
    } else {
      // Default patterns
      args.push('src/**/*.{js,jsx,ts,tsx}');
    }

    try {
      const result = await this.exec(eslintBin, args);
      return result.stdout;
    } catch (error) {
      // ESLint might exit with error if issues found
      if (error.stdout) {
        return error.stdout;
      }
      throw error;
    }
  }

  parse(rawOutput) {
    try {
      const eslintResults = JSON.parse(rawOutput);
      const issues = [];

      eslintResults.forEach(fileResult => {
        fileResult.messages.forEach(message => {
          issues.push({
            id: this.generateId(fileResult.filePath, message.line, message.ruleId),
            type: this.mapRuleToType(message.ruleId),
            title: message.message,
            message: message.message,
            file: path.relative(this.projectRoot, fileResult.filePath),
            startLine: message.line,
            endLine: message.endLine || message.line,
            startColumn: message.column,
            endColumn: message.endColumn || message.column,
            severity: this.mapSeverity(message.severity),
            category: this.mapCategory(message.ruleId),
            fileType: this.detectFileType(fileResult.filePath),
            autoFixLevel: message.fix ? 'AUTO' : 'RULE',
            source: 'eslint',
            rule: message.ruleId,
            context: {
              originalCode: message.source || '',
              fixedCode: message.fix ? this.applyFix(message.source, message.fix) : null
            },
            metadata: {
              documentation: message.ruleId ? `https://eslint.org/docs/rules/${message.ruleId}` : null
            },
            timestamp: new Date().toISOString(),
            status: 'open'
          });
        });
      });

      return issues;
    } catch (error) {
      console.error('Failed to parse ESLint output:', error);
      return [];
    }
  }

  mapSeverity(eslintSeverity) {
    // ESLint: 0=off, 1=warn, 2=error
    const map = {
      0: 'INFO',
      1: 'WARNING',
      2: 'ERROR'
    };
    return map[eslintSeverity] || 'INFO';
  }

  mapCategory(ruleId) {
    if (!ruleId) return 'STYLE';

    // Security rules
    if (ruleId.includes('security') || 
        ['no-eval', 'no-implied-eval', 'no-new-func'].includes(ruleId)) {
      return 'SECURITY';
    }

    // Performance rules
    if (ruleId.includes('perf') || ruleId === 'no-await-in-loop') {
      return 'PERFORMANCE';
    }

    // Accessibility rules
    if (ruleId.includes('a11y') || ruleId.includes('jsx-a11y')) {
      return 'ACCESSIBILITY';
    }

    // Bug prevention
    if (['no-undef', 'no-unused-vars', 'no-unreachable', 'no-constant-condition'].includes(ruleId)) {
      return 'BUG';
    }

    // Code smells
    if (['complexity', 'max-depth', 'max-params', 'max-lines-per-function'].includes(ruleId)) {
      return 'MAINTAINABILITY';
    }

    return 'STYLE';
  }

  mapRuleToType(ruleId) {
    const ruleMap = {
      'no-eval': 'SEC-004',
      'no-unused-vars': 'BUG-001',
      'no-undef': 'BUG-002',
      'require-await': 'BUG-003',
      'no-unreachable': 'BUG-004',
      'no-console': 'STYLE-009',
      'semi': 'STYLE-001',
      'quotes': 'STYLE-002',
      'indent': 'STYLE-003',
      'complexity': 'SMELL-001',
      'max-params': 'SMELL-002',
      'max-depth': 'SMELL-003',
      'no-magic-numbers': 'SMELL-004'
    };
    return ruleMap[ruleId] || 'CUSTOM-' + (ruleId || 'UNKNOWN');
  }

  applyFix(source, fix) {
    // ESLint provides fix diffs, apply them
    if (!fix || !source) return null;
    return source.substring(0, fix.range[0]) + fix.text + source.substring(fix.range[1]);
  }

  detectFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript'
    };
    return typeMap[ext] || 'unknown';
  }

  generateId(file, line, rule) {
    const crypto = require('crypto');
    const str = `${file}:${line}:${rule}`;
    return crypto.createHash('sha256').update(str).digest('hex');
  }
}

/**
 * TypeScript-ESLint Integration
 */
class TypeScriptESLintIntegration extends ESLintIntegration {
  mapRuleToType(ruleId) {
    const tsRuleMap = {
      '@typescript-eslint/no-explicit-any': 'BUG-011',
      '@typescript-eslint/no-floating-promises': 'BUG-003',
      '@typescript-eslint/no-unused-vars': 'BUG-001',
      '@typescript-eslint/explicit-function-return-type': 'STYLE-011',
      '@typescript-eslint/naming-convention': 'STYLE-005'
    };
    return tsRuleMap[ruleId] || super.mapRuleToType(ruleId);
  }

  mapCategory(ruleId) {
    if (ruleId && ruleId.includes('typescript-eslint')) {
      if (ruleId.includes('no-floating-promises') || ruleId.includes('no-misused-promises')) {
        return 'BUG';
      }
      if (ruleId.includes('naming-convention') || ruleId.includes('explicit')) {
        return 'STYLE';
      }
    }
    return super.mapCategory(ruleId);
  }
}

/**
 * Prettier Integration
 */
class PrettierIntegration extends LinterIntegration {
  isAvailable() {
    try {
      const prettierPath = path.join(this.projectRoot, 'node_modules', '.bin', 'prettier');
      return fs.existsSync(prettierPath) || fs.existsSync(prettierPath + '.cmd');
    } catch {
      return false;
    }
  }

  async run(files = []) {
    const prettierBin = process.platform === 'win32' ? 'prettier.cmd' : 'prettier';
    const args = [
      '--check',
      '--no-color'
    ];

    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push('src/**/*.{js,jsx,ts,tsx,css,scss,html,json}');
    }

    try {
      const result = await this.exec(prettierBin, args);
      return result.stderr || result.stdout; // Prettier outputs to stderr
    } catch (error) {
      // Prettier exits with 1 if files need formatting
      return error.stderr || error.stdout || '';
    }
  }

  parse(rawOutput) {
    // Prettier outputs file paths that need formatting
    const lines = rawOutput.split('\n').filter(line => line.trim());
    const issues = [];

    lines.forEach(line => {
      // Prettier output format: "src/app/app.component.ts"
      if (line && !line.startsWith('Checking') && !line.startsWith('Code style')) {
        const filePath = line.trim();

        issues.push({
          id: this.generateId(filePath, 1, 'prettier'),
          type: 'STYLE-000',
          title: 'Code formatting issue',
          message: 'File is not formatted according to Prettier rules',
          file: path.relative(this.projectRoot, filePath),
          startLine: 1,
          endLine: 1,
          startColumn: 1,
          endColumn: 1,
          severity: 'INFO',
          category: 'STYLE',
          fileType: this.detectFileType(filePath),
          autoFixLevel: 'AUTO',
          source: 'prettier',
          rule: 'prettier/prettier',
          context: {},
          metadata: {
            documentation: 'https://prettier.io/docs/en/index.html'
          },
          timestamp: new Date().toISOString(),
          status: 'open'
        });
      }
    });

    return issues;
  }

  detectFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.css': 'css',
      '.scss': 'scss',
      '.html': 'html',
      '.json': 'json'
    };
    return typeMap[ext] || 'unknown';
  }

  generateId(file, line, rule) {
    const crypto = require('crypto');
    const str = `${file}:${line}:${rule}`;
    return crypto.createHash('sha256').update(str).digest('hex');
  }
}

/**
 * StyleLint Integration
 */
class StyleLintIntegration extends LinterIntegration {
  isAvailable() {
    try {
      const stylelintPath = path.join(this.projectRoot, 'node_modules', '.bin', 'stylelint');
      return fs.existsSync(stylelintPath) || fs.existsSync(stylelintPath + '.cmd');
    } catch {
      return false;
    }
  }

  async run(files = []) {
    const stylelintBin = process.platform === 'win32' ? 'stylelint.cmd' : 'stylelint';
    const args = [
      '--formatter', 'json',
      '--no-color'
    ];

    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push('src/**/*.{css,scss,sass,less}');
    }

    try {
      const result = await this.exec(stylelintBin, args);
      return result.stdout;
    } catch (error) {
      if (error.stdout) {
        return error.stdout;
      }
      throw error;
    }
  }

  parse(rawOutput) {
    try {
      const stylelintResults = JSON.parse(rawOutput);
      const issues = [];

      stylelintResults.forEach(fileResult => {
        fileResult.warnings.forEach(warning => {
          issues.push({
            id: this.generateId(fileResult.source, warning.line, warning.rule),
            type: this.mapRuleToType(warning.rule),
            title: warning.text,
            message: warning.text,
            file: path.relative(this.projectRoot, fileResult.source),
            startLine: warning.line,
            endLine: warning.endLine || warning.line,
            startColumn: warning.column,
            endColumn: warning.endColumn || warning.column,
            severity: this.mapSeverity(warning.severity),
            category: 'STYLE',
            fileType: this.detectFileType(fileResult.source),
            autoFixLevel: 'AUTO',
            source: 'stylelint',
            rule: warning.rule,
            context: {},
            metadata: {
              documentation: warning.rule ? `https://stylelint.io/user-guide/rules/${warning.rule}` : null
            },
            timestamp: new Date().toISOString(),
            status: 'open'
          });
        });
      });

      return issues;
    } catch (error) {
      console.error('Failed to parse StyleLint output:', error);
      return [];
    }
  }

  mapSeverity(stylelintSeverity) {
    const map = {
      'error': 'ERROR',
      'warning': 'WARNING'
    };
    return map[stylelintSeverity] || 'INFO';
  }

  mapRuleToType(ruleId) {
    const ruleMap = {
      'declaration-block-no-duplicate-properties': 'CSS-003',
      'color-no-invalid-hex': 'CSS-004',
      'selector-max-specificity': 'CSS-002',
      'max-nesting-depth': 'CSS-006',
      'declaration-no-important': 'CSS-001'
    };
    return ruleMap[ruleId] || 'CSS-CUSTOM';
  }

  detectFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'scss',
      '.less': 'less'
    };
    return typeMap[ext] || 'css';
  }

  generateId(file, line, rule) {
    const crypto = require('crypto');
    const str = `${file}:${line}:${rule}`;
    return crypto.createHash('sha256').update(str).digest('hex');
  }
}

/**
 * Orchestrator class to run all available linters
 */
class LinterOrchestrator {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.integrations = {
      eslint: new ESLintIntegration(projectRoot),
      'typescript-eslint': new TypeScriptESLintIntegration(projectRoot),
      prettier: new PrettierIntegration(projectRoot),
      stylelint: new StyleLintIntegration(projectRoot)
    };
    for (const name of Object.keys(EXTERNAL_LINTERS)) {
      this.integrations[name] = new ExternalCliIntegration(projectRoot, name);
    }
  }

  /**
   * Detect which linters are available
   */
  detectAvailableLinters() {
    const available = {};

    for (const [name, integration] of Object.entries(this.integrations)) {
      available[name] = integration.isAvailable();
    }

    return available;
  }

  /**
   * Run all available linters
   */
  async runAll(files = [], options = {}) {
    const { linters = null, verbose = false } = options;
    const availableLinters = this.detectAvailableLinters();
    const allIssues = [];
    const results = {};

    for (const [name, integration] of Object.entries(this.integrations)) {
      // Skip if not available or not requested
      if (!availableLinters[name]) {
        if (verbose) console.log(`  ⊘ ${name} - not available`);
        continue;
      }

      if (linters && !linters.includes(name)) {
        if (verbose) console.log(`  ⊘ ${name} - skipped`);
        continue;
      }

      try {
        if (verbose) console.log(`  ⏳ Running ${name}...`);
        const rawOutput = await integration.run(files);
        const issues = integration.parse(rawOutput);

        allIssues.push(...issues);
        results[name] = {
          success: true,
          issueCount: issues.length,
          issues
        };

        if (verbose) console.log(`  ✓ ${name} - found ${issues.length} issues`);
      } catch (error) {
        results[name] = {
          success: false,
          error: error.message
        };

        if (verbose) console.error(`  ✗ ${name} - failed: ${error.message}`);
      }
    }

    return {
      issues: allIssues,
      summary: results,
      totalIssues: allIssues.length
    };
  }

  /**
   * Run a specific linter
   */
  async runLinter(name, files = []) {
    const integration = this.integrations[name];

    if (!integration) {
      throw new Error(`Unknown linter: ${name}`);
    }

    if (!integration.isAvailable()) {
      throw new Error(`Linter not available: ${name}`);
    }

    const rawOutput = await integration.run(files);
    const issues = integration.parse(rawOutput);

    return {
      linter: name,
      issues,
      issueCount: issues.length
    };
  }
}

module.exports = {
  LinterOrchestrator,
  ESLintIntegration,
  TypeScriptESLintIntegration,
  PrettierIntegration,
  StyleLintIntegration,
  ExternalCliIntegration,
  EXTERNAL_LINTERS,
  findFilesForExtensions,
  detectAvailableLinters
};

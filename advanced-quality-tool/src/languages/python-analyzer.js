/**
 * Python Language Support
 * 
 * Integrates Python linting and analysis tools:
 * - Pylint integration
 * - Flake8 integration
 * - Black formatter checking
 * - mypy type checking
 * - Bandit security scanning
 * 
 * @module languages/python-analyzer
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Python Analyzer
 */
class PythonAnalyzer {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;

    // Tool configuration
    this.tools = {
      pylint: options.pylint !== false,
      flake8: options.flake8 !== false,
      black: options.black !== false,
      mypy: options.mypy !== false,
      bandit: options.bandit !== false
    };

    // Tool paths (auto-detect if not provided)
    this.toolPaths = {
      pylint: options.pylintPath || 'pylint',
      flake8: options.flake8Path || 'flake8',
      black: options.blackPath || 'black',
      mypy: options.mypyPath || 'mypy',
      bandit: options.banditPath || 'bandit'
    };

    // Statistics
    this.stats = {
      filesAnalyzed: 0,
      issuesFound: 0,
      errors: 0,
      warnings: 0,
      conventions: 0,
      refactorings: 0
    };
  }

  /**
   * Analyze Python file
   */
  async analyzeFile(filePath) {
    this.stats.filesAnalyzed++;

    try {
      const issues = [];

      // Run enabled tools
      if (this.tools.pylint) {
        const pylintIssues = await this.runPylint(filePath);
        issues.push(...pylintIssues);
      }

      if (this.tools.flake8) {
        const flake8Issues = await this.runFlake8(filePath);
        issues.push(...flake8Issues);
      }

      if (this.tools.black) {
        const blackIssues = await this.runBlack(filePath);
        issues.push(...blackIssues);
      }

      if (this.tools.mypy) {
        const mypyIssues = await this.runMypy(filePath);
        issues.push(...mypyIssues);
      }

      if (this.tools.bandit) {
        const banditIssues = await this.runBandit(filePath);
        issues.push(...banditIssues);
      }

      // Update statistics
      issues.forEach(issue => {
        this.stats.issuesFound++;
        const severity = issue.severity.toLowerCase();
        if (severity === 'error') this.stats.errors++;
        else if (severity === 'warning') this.stats.warnings++;
        else if (severity === 'convention') this.stats.conventions++;
        else if (severity === 'refactor') this.stats.refactorings++;
      });

      return {
        filePath,
        issues,
        count: issues.length,
        language: 'python'
      };

    } catch (error) {
      this.log(`Error analyzing ${filePath}: ${error.message}`);
      return {
        filePath,
        error: error.message,
        issues: []
      };
    }
  }

  /**
   * Run Pylint
   */
  async runPylint(filePath) {
    try {
      const command = `${this.toolPaths.pylint} --output-format=json "${filePath}"`;
      const { stdout, stderr } = await execPromise(command, {
        maxBuffer: 10 * 1024 * 1024
      });

      try {
        const results = JSON.parse(stdout || '[]');
        return results.map(result => this.parsePylintIssue(result, filePath));
      } catch (parseError) {
        this.log(`Failed to parse Pylint output: ${parseError.message}`);
        return [];
      }

    } catch (error) {
      // Pylint returns non-zero for issues, check stderr
      if (error.stdout) {
        try {
          const results = JSON.parse(error.stdout);
          return results.map(result => this.parsePylintIssue(result, filePath));
        } catch (parseError) {
          this.log(`Pylint failed: ${error.message}`);
          return [];
        }
      }

      this.log(`Pylint command failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse Pylint issue
   */
  parsePylintIssue(result, filePath) {
    return {
      type: 'pylint',
      tool: 'pylint',
      ruleId: result['message-id'] || result.symbol || '',
      severity: this.mapPylintSeverity(result.type),
      message: result.message || '',
      filePath,
      line: result.line || 0,
      column: result.column || 0,
      endLine: result.endLine,
      endColumn: result.endColumn
    };
  }

  /**
   * Map Pylint severity
   */
  mapPylintSeverity(type) {
    const map = {
      'error': 'ERROR',
      'warning': 'WARNING',
      'refactor': 'REFACTOR',
      'convention': 'CONVENTION',
      'fatal': 'ERROR',
      'info': 'INFO'
    };
    return map[type] || 'INFO';
  }

  /**
   * Run Flake8
   */
  async runFlake8(filePath) {
    try {
      const command = `${this.toolPaths.flake8} --format=json "${filePath}"`;
      const { stdout } = await execPromise(command);

      try {
        const results = JSON.parse(stdout || '{}');
        const issues = [];

        for (const [file, fileIssues] of Object.entries(results)) {
          fileIssues.forEach(issue => {
            issues.push(this.parseFlake8Issue(issue, filePath));
          });
        }

        return issues;
      } catch (parseError) {
        // Fallback to line-based parsing
        return this.parseFlake8Text(stdout, filePath);
      }

    } catch (error) {
      if (error.stdout) {
        return this.parseFlake8Text(error.stdout, filePath);
      }

      this.log(`Flake8 command failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse Flake8 issue
   */
  parseFlake8Issue(issue, filePath) {
    return {
      type: 'flake8',
      tool: 'flake8',
      ruleId: issue.code || '',
      severity: this.mapFlake8Severity(issue.code),
      message: issue.text || issue.message || '',
      filePath,
      line: issue.line_number || issue.line || 0,
      column: issue.column_number || issue.column || 0
    };
  }

  /**
   * Parse Flake8 text output
   */
  parseFlake8Text(text, filePath) {
    const issues = [];
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
      // Format: file:line:col: code message
      const match = line.match(/^[^:]+:(\d+):(\d+):\s*(\w+)\s+(.+)$/);
      if (match) {
        const [, lineNum, col, code, message] = match;
        issues.push({
          type: 'flake8',
          tool: 'flake8',
          ruleId: code,
          severity: this.mapFlake8Severity(code),
          message,
          filePath,
          line: parseInt(lineNum),
          column: parseInt(col)
        });
      }
    }

    return issues;
  }

  /**
   * Map Flake8 severity
   */
  mapFlake8Severity(code) {
    if (!code) return 'INFO';

    // Flake8 codes:
    // E: errors
    // W: warnings
    // F: fatal/pyflakes
    // C: complexity
    // N: naming
    const prefix = code[0];

    if (prefix === 'E' || prefix === 'F') return 'ERROR';
    if (prefix === 'W') return 'WARNING';
    return 'INFO';
  }

  /**
   * Run Black (formatter check)
   */
  async runBlack(filePath) {
    try {
      const command = `${this.toolPaths.black} --check --diff "${filePath}"`;
      await execPromise(command);

      // No output = file is formatted correctly
      return [];

    } catch (error) {
      // Black returns non-zero if file needs formatting
      if (error.code === 1 && error.stdout) {
        return [{
          type: 'black',
          tool: 'black',
          ruleId: 'formatting',
          severity: 'INFO',
          message: 'File would be reformatted by Black',
          filePath,
          line: 1,
          column: 1,
          diff: error.stdout
        }];
      }

      this.log(`Black command failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Run mypy (type checker)
   */
  async runMypy(filePath) {
    try {
      const command = `${this.toolPaths.mypy} --show-column-numbers --no-error-summary "${filePath}"`;
      const { stdout } = await execPromise(command);

      return this.parseMypyOutput(stdout, filePath);

    } catch (error) {
      if (error.stdout) {
        return this.parseMypyOutput(error.stdout, filePath);
      }

      this.log(`Mypy command failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse mypy output
   */
  parseMypyOutput(text, filePath) {
    const issues = [];
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
      // Format: file:line:col: severity: message
      const match = line.match(/^[^:]+:(\d+):(\d+):\s*(\w+):\s*(.+)$/);
      if (match) {
        const [, lineNum, col, severity, message] = match;
        issues.push({
          type: 'mypy',
          tool: 'mypy',
          ruleId: 'type-check',
          severity: severity.toUpperCase(),
          message,
          filePath,
          line: parseInt(lineNum),
          column: parseInt(col)
        });
      }
    }

    return issues;
  }

  /**
   * Run Bandit (security scanner)
   */
  async runBandit(filePath) {
    try {
      const command = `${this.toolPaths.bandit} -f json "${filePath}"`;
      const { stdout } = await execPromise(command);

      try {
        const results = JSON.parse(stdout);
        return (results.results || []).map(result => this.parseBanditIssue(result, filePath));
      } catch (parseError) {
        this.log(`Failed to parse Bandit output: ${parseError.message}`);
        return [];
      }

    } catch (error) {
      if (error.stdout) {
        try {
          const results = JSON.parse(error.stdout);
          return (results.results || []).map(result => this.parseBanditIssue(result, filePath));
        } catch (parseError) {
          this.log(`Bandit failed: ${error.message}`);
          return [];
        }
      }

      this.log(`Bandit command failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse Bandit issue
   */
  parseBanditIssue(result, filePath) {
    return {
      type: 'bandit',
      tool: 'bandit',
      ruleId: result.test_id || '',
      severity: this.mapBanditSeverity(result.issue_severity),
      message: result.issue_text || '',
      filePath,
      line: result.line_number || 0,
      column: result.col_offset || 0,
      confidence: result.issue_confidence,
      cwe: result.cwe ? result.cwe.id : undefined
    };
  }

  /**
   * Map Bandit severity
   */
  mapBanditSeverity(severity) {
    const map = {
      'HIGH': 'CRITICAL',
      'MEDIUM': 'WARNING',
      'LOW': 'INFO'
    };
    return map[severity] || 'INFO';
  }

  /**
   * Check tool availability
   */
  async checkTools() {
    const available = {};

    for (const [tool, enabled] of Object.entries(this.tools)) {
      if (!enabled) {
        available[tool] = false;
        continue;
      }

      try {
        const command = `${this.toolPaths[tool]} --version`;
        await execPromise(command);
        available[tool] = true;
      } catch (error) {
        available[tool] = false;
        this.log(`Tool ${tool} not available: ${error.message}`);
      }
    }

    return available;
  }

  /**
   * Analyze multiple files
   */
  async analyzeFiles(filePaths) {
    const results = [];

    for (const filePath of filePaths) {
      const result = await this.analyzeFile(filePath);
      results.push(result);
    }

    return results;
  }

  /**
   * Analyze directory
   */
  async analyzeDirectory(directory, options = {}) {
    const patterns = options.patterns || ['**/*.py'];
    const exclude = options.exclude || ['**/venv/**', '**/__pycache__/**', '**/dist/**', '**/build/**'];

    const files = this.findFiles(directory, patterns, exclude);
    return this.analyzeFiles(files);
  }

  /**
   * Find files
   */
  findFiles(directory, patterns, exclude) {
    const files = [];

    const scan = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(directory, fullPath);

          if (exclude.some(pattern => this.matchPattern(relativePath, pattern))) {
            continue;
          }

          if (entry.isDirectory()) {
            scan(fullPath);
          } else if (patterns.some(pattern => this.matchPattern(relativePath, pattern))) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        this.log(`Error scanning ${dir}: ${error.message}`);
      }
    };

    scan(directory);
    return files;
  }

  /**
   * Pattern matching
   */
  matchPattern(filePath, pattern) {
    const regex = new RegExp(
      '^' + pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
        .replace(/\./g, '\\.') + '$'
    );
    return regex.test(filePath.replace(/\\/g, '/'));
  }

  /**
   * Generate report
   */
  generateReport(results) {
    const report = {
      summary: {
        ...this.stats,
        language: 'python',
        timestamp: new Date().toISOString()
      },
      files: []
    };

    const allIssues = [];
    const bySeverity = { CRITICAL: [], ERROR: [], WARNING: [], INFO: [], REFACTOR: [], CONVENTION: [] };
    const byTool = {};

    results.forEach(result => {
      if (result.error) {
        report.files.push({
          filePath: result.filePath,
          error: result.error
        });
        return;
      }

      report.files.push({
        filePath: result.filePath,
        issueCount: result.count
      });

      result.issues.forEach(issue => {
        allIssues.push(issue);

        if (bySeverity[issue.severity]) {
          bySeverity[issue.severity].push(issue);
        }

        if (!byTool[issue.tool]) {
          byTool[issue.tool] = [];
        }
        byTool[issue.tool].push(issue);
      });
    });

    report.issues = allIssues;
    report.bySeverity = bySeverity;
    report.byTool = byTool;

    return report;
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }

  log(message) {
    if (this.verbose) {
      console.log(`[PythonAnalyzer] ${message}`);
    }
  }
}

module.exports = {
  PythonAnalyzer
};

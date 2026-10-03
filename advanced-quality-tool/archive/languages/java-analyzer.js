/**
 * Java Language Support
 * 
 * Integrates Java static analysis tools:
 * - Checkstyle integration
 * - PMD integration
 * - SpotBugs integration
 * - Error Prone integration
 * 
 * @module languages/java-analyzer
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const xml2js = require('xml2js').parseString;
const parseXml = util.promisify(xml2js);

/**
 * Java Analyzer
 */
class JavaAnalyzer {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;

    // Tool configuration
    this.tools = {
      checkstyle: options.checkstyle !== false,
      pmd: options.pmd !== false,
      spotbugs: options.spotbugs !== false
    };

    // Tool paths
    this.toolPaths = {
      checkstyle: options.checkstylePath || 'checkstyle',
      pmd: options.pmdPath || 'pmd',
      spotbugs: options.spotbugsPath || 'spotbugs'
    };

    // Configuration files
    this.configs = {
      checkstyle: options.checkstyleConfig || 'google_checks.xml',
      pmd: options.pmdRuleset || 'rulesets/java/quickstart.xml'
    };

    // Statistics
    this.stats = {
      filesAnalyzed: 0,
      issuesFound: 0,
      errors: 0,
      warnings: 0,
      info: 0
    };
  }

  /**
   * Analyze Java file
   */
  async analyzeFile(filePath) {
    this.stats.filesAnalyzed++;

    try {
      const issues = [];

      // Run enabled tools
      if (this.tools.checkstyle) {
        const checkstyleIssues = await this.runCheckstyle(filePath);
        issues.push(...checkstyleIssues);
      }

      if (this.tools.pmd) {
        const pmdIssues = await this.runPMD(filePath);
        issues.push(...pmdIssues);
      }

      if (this.tools.spotbugs) {
        const spotbugsIssues = await this.runSpotBugs(filePath);
        issues.push(...spotbugsIssues);
      }

      // Update statistics
      issues.forEach(issue => {
        this.stats.issuesFound++;
        const severity = issue.severity.toLowerCase();
        if (severity === 'error') this.stats.errors++;
        else if (severity === 'warning') this.stats.warnings++;
        else this.stats.info++;
      });

      return {
        filePath,
        issues,
        count: issues.length,
        language: 'java'
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
   * Run Checkstyle
   */
  async runCheckstyle(filePath) {
    try {
      const command = `${this.toolPaths.checkstyle} -c ${this.configs.checkstyle} -f xml "${filePath}"`;
      const { stdout } = await execPromise(command, {
        maxBuffer: 10 * 1024 * 1024
      });

      return await this.parseCheckstyleOutput(stdout, filePath);

    } catch (error) {
      if (error.stdout) {
        return await this.parseCheckstyleOutput(error.stdout, filePath);
      }

      this.log(`Checkstyle command failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse Checkstyle XML output
   */
  async parseCheckstyleOutput(xml, filePath) {
    try {
      const result = await parseXml(xml);
      const issues = [];

      if (result.checkstyle && result.checkstyle.file) {
        for (const file of result.checkstyle.file) {
          if (file.error) {
            for (const error of file.error) {
              issues.push(this.parseCheckstyleError(error.$, filePath));
            }
          }
        }
      }

      return issues;

    } catch (error) {
      this.log(`Failed to parse Checkstyle output: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse Checkstyle error
   */
  parseCheckstyleError(attrs, filePath) {
    return {
      type: 'checkstyle',
      tool: 'checkstyle',
      ruleId: attrs.source || '',
      severity: this.mapCheckstyleSeverity(attrs.severity),
      message: attrs.message || '',
      filePath,
      line: parseInt(attrs.line) || 0,
      column: parseInt(attrs.column) || 0
    };
  }

  /**
   * Map Checkstyle severity
   */
  mapCheckstyleSeverity(severity) {
    const map = {
      'error': 'ERROR',
      'warning': 'WARNING',
      'info': 'INFO',
      'ignore': 'INFO'
    };
    return map[severity] || 'INFO';
  }

  /**
   * Run PMD
   */
  async runPMD(filePath) {
    try {
      const command = `${this.toolPaths.pmd} -d "${filePath}" -R ${this.configs.pmd} -f xml`;
      const { stdout } = await execPromise(command, {
        maxBuffer: 10 * 1024 * 1024
      });

      return await this.parsePMDOutput(stdout, filePath);

    } catch (error) {
      if (error.stdout) {
        return await this.parsePMDOutput(error.stdout, filePath);
      }

      this.log(`PMD command failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse PMD XML output
   */
  async parsePMDOutput(xml, filePath) {
    try {
      const result = await parseXml(xml);
      const issues = [];

      if (result.pmd && result.pmd.file) {
        for (const file of result.pmd.file) {
          if (file.violation) {
            for (const violation of file.violation) {
              issues.push(this.parsePMDViolation(violation, filePath));
            }
          }
        }
      }

      return issues;

    } catch (error) {
      this.log(`Failed to parse PMD output: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse PMD violation
   */
  parsePMDViolation(violation, filePath) {
    const attrs = violation.$;

    return {
      type: 'pmd',
      tool: 'pmd',
      ruleId: attrs.rule || '',
      ruleset: attrs.ruleset || '',
      severity: this.mapPMDPriority(attrs.priority),
      message: violation._ || attrs.message || '',  // Text content or attribute
      filePath,
      line: parseInt(attrs.beginline) || 0,
      column: parseInt(attrs.begincolumn) || 0,
      endLine: parseInt(attrs.endline),
      endColumn: parseInt(attrs.endcolumn)
    };
  }

  /**
   * Map PMD priority to severity
   */
  mapPMDPriority(priority) {
    const p = parseInt(priority) || 3;

    if (p === 1) return 'CRITICAL';
    if (p === 2) return 'ERROR';
    if (p === 3) return 'WARNING';
    return 'INFO';
  }

  /**
   * Run SpotBugs
   */
  async runSpotBugs(filePath) {
    try {
      // SpotBugs requires compiled classes, so this is a simplified version
      // In production, you'd run SpotBugs on .class files or JAR
      const command = `${this.toolPaths.spotbugs} -textui -xml "${filePath}"`;
      const { stdout } = await execPromise(command, {
        maxBuffer: 10 * 1024 * 1024
      });

      return await this.parseSpotBugsOutput(stdout, filePath);

    } catch (error) {
      if (error.stdout) {
        return await this.parseSpotBugsOutput(error.stdout, filePath);
      }

      this.log(`SpotBugs command failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse SpotBugs XML output
   */
  async parseSpotBugsOutput(xml, filePath) {
    try {
      const result = await parseXml(xml);
      const issues = [];

      if (result.BugCollection && result.BugCollection.BugInstance) {
        for (const bug of result.BugCollection.BugInstance) {
          issues.push(this.parseSpotBugsBug(bug, filePath));
        }
      }

      return issues;

    } catch (error) {
      this.log(`Failed to parse SpotBugs output: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse SpotBugs bug
   */
  parseSpotBugsBug(bug, filePath) {
    const attrs = bug.$;
    const sourceLine = bug.SourceLine ? bug.SourceLine[0].$ : {};

    return {
      type: 'spotbugs',
      tool: 'spotbugs',
      ruleId: attrs.type || '',
      category: attrs.category || '',
      severity: this.mapSpotBugsPriority(attrs.priority),
      message: bug.LongMessage ? bug.LongMessage[0] : (bug.ShortMessage ? bug.ShortMessage[0] : ''),
      filePath,
      line: parseInt(sourceLine.start) || 0,
      endLine: parseInt(sourceLine.end),
      rank: parseInt(attrs.rank)
    };
  }

  /**
   * Map SpotBugs priority
   */
  mapSpotBugsPriority(priority) {
    const p = parseInt(priority) || 3;

    if (p === 1) return 'CRITICAL';
    if (p === 2) return 'ERROR';
    if (p === 3) return 'WARNING';
    return 'INFO';
  }

  /**
   * Analyze Maven project
   */
  async analyzeMavenProject(projectDir) {
    try {
      // Run Maven site with Checkstyle, PMD, SpotBugs plugins
      const command = 'mvn site -DskipTests';
      await execPromise(command, {
        cwd: projectDir,
        maxBuffer: 50 * 1024 * 1024
      });

      // Parse generated reports
      const reportsDir = path.join(projectDir, 'target', 'site');

      const issues = [];

      // Parse Checkstyle report
      const checkstyleReport = path.join(reportsDir, 'checkstyle.xml');
      if (fs.existsSync(checkstyleReport)) {
        const xml = fs.readFileSync(checkstyleReport, 'utf8');
        const checkstyleIssues = await this.parseCheckstyleOutput(xml, projectDir);
        issues.push(...checkstyleIssues);
      }

      // Parse PMD report
      const pmdReport = path.join(reportsDir, 'pmd.xml');
      if (fs.existsSync(pmdReport)) {
        const xml = fs.readFileSync(pmdReport, 'utf8');
        const pmdIssues = await this.parsePMDOutput(xml, projectDir);
        issues.push(...pmdIssues);
      }

      // Parse SpotBugs report
      const spotbugsReport = path.join(reportsDir, 'spotbugsXml.xml');
      if (fs.existsSync(spotbugsReport)) {
        const xml = fs.readFileSync(spotbugsReport, 'utf8');
        const spotbugsIssues = await this.parseSpotBugsOutput(xml, projectDir);
        issues.push(...spotbugsIssues);
      }

      return {
        projectDir,
        issues,
        count: issues.length
      };

    } catch (error) {
      this.log(`Error analyzing Maven project: ${error.message}`);
      return {
        projectDir,
        error: error.message,
        issues: []
      };
    }
  }

  /**
   * Analyze Gradle project
   */
  async analyzeGradleProject(projectDir) {
    try {
      // Run Gradle tasks for static analysis
      const command = 'gradle check';
      await execPromise(command, {
        cwd: projectDir,
        maxBuffer: 50 * 1024 * 1024
      });

      // Parse generated reports
      const reportsDir = path.join(projectDir, 'build', 'reports');

      const issues = [];

      // Parse Checkstyle reports
      const checkstyleDir = path.join(reportsDir, 'checkstyle');
      if (fs.existsSync(checkstyleDir)) {
        const files = fs.readdirSync(checkstyleDir).filter(f => f.endsWith('.xml'));
        for (const file of files) {
          const xml = fs.readFileSync(path.join(checkstyleDir, file), 'utf8');
          const checkstyleIssues = await this.parseCheckstyleOutput(xml, projectDir);
          issues.push(...checkstyleIssues);
        }
      }

      // Parse PMD reports
      const pmdDir = path.join(reportsDir, 'pmd');
      if (fs.existsSync(pmdDir)) {
        const files = fs.readdirSync(pmdDir).filter(f => f.endsWith('.xml'));
        for (const file of files) {
          const xml = fs.readFileSync(path.join(pmdDir, file), 'utf8');
          const pmdIssues = await this.parsePMDOutput(xml, projectDir);
          issues.push(...pmdIssues);
        }
      }

      return {
        projectDir,
        issues,
        count: issues.length
      };

    } catch (error) {
      this.log(`Error analyzing Gradle project: ${error.message}`);
      return {
        projectDir,
        error: error.message,
        issues: []
      };
    }
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
   * Find Java files
   */
  findFiles(directory, patterns = ['**/*.java'], exclude = ['**/target/**', '**/build/**', '**/.gradle/**']) {
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
        language: 'java',
        timestamp: new Date().toISOString()
      },
      files: []
    };

    const allIssues = [];
    const bySeverity = { CRITICAL: [], ERROR: [], WARNING: [], INFO: [] };
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
      console.log(`[JavaAnalyzer] ${message}`);
    }
  }
}

module.exports = {
  JavaAnalyzer
};

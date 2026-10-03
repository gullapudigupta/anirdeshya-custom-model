/**
 * Dependency Vulnerability Scanner
 * 
 * Scans project dependencies for known security vulnerabilities.
 * 
 * Features:
 * - npm audit integration
 * - yarn audit integration
 * - Package lock analysis
 * - CVE database lookup
 * - Severity classification
 * - Update recommendations
 * - License compliance checking
 * 
 * @module security/dependency-scanner
 */

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Dependency Vulnerability Scanner
 */
class DependencyScanner {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.packageManager = options.packageManager || 'auto'; // 'npm', 'yarn', 'pnpm', 'auto'
    this.includeDevDependencies = options.includeDevDependencies !== false;
    this.checkLicenses = options.checkLicenses || false;

    // Vulnerability database (simplified - in production use a real CVE API)
    this.knownVulnerabilities = this.initializeVulnerabilityDB();

    // License blacklist/whitelist
    this.restrictedLicenses = options.restrictedLicenses || [
      'GPL-3.0', 
      'AGPL-3.0', 
      'LGPL-3.0'
    ];

    // Statistics
    this.stats = {
      projectsScanned: 0,
      dependenciesScanned: 0,
      vulnerabilitiesFound: 0,
      critical: 0,
      high: 0,
      moderate: 0,
      low: 0,
      licenseIssues: 0
    };
  }

  /**
   * Initialize vulnerability database
   * In production, this would connect to:
   * - National Vulnerability Database (NVD)
   * - GitHub Advisory Database
   * - npm Advisory Database
   * - Snyk Vulnerability DB
   */
  initializeVulnerabilityDB() {
    return {
      // This is a simplified example structure
      // In production, fetch from actual vulnerability databases
      exampleVulnerabilities: {
        'lodash': {
          '4.17.15': {
            cve: 'CVE-2020-8203',
            severity: 'HIGH',
            title: 'Prototype Pollution',
            description: 'Versions of lodash prior to 4.17.19 are vulnerable to Prototype Pollution',
            fixedIn: '4.17.19',
            reference: 'https://nvd.nist.gov/vuln/detail/CVE-2020-8203'
          }
        },
        'minimist': {
          '1.2.5': {
            cve: 'CVE-2021-44906',
            severity: 'CRITICAL',
            title: 'Prototype Pollution',
            description: 'Prototype pollution vulnerability in minimist',
            fixedIn: '1.2.6',
            reference: 'https://nvd.nist.gov/vuln/detail/CVE-2021-44906'
          }
        }
      }
    };
  }

  /**
   * Detect package manager
   */
  detectPackageManager(projectDir) {
    if (this.packageManager !== 'auto') {
      return this.packageManager;
    }

    // Check for lock files
    if (fs.existsSync(path.join(projectDir, 'package-lock.json'))) {
      return 'npm';
    }
    if (fs.existsSync(path.join(projectDir, 'yarn.lock'))) {
      return 'yarn';
    }
    if (fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }

    // Default to npm
    return 'npm';
  }

  /**
   * Scan project for dependency vulnerabilities
   */
  async scanProject(projectDir) {
    this.stats.projectsScanned++;

    try {
      const packageJsonPath = path.join(projectDir, 'package.json');

      if (!fs.existsSync(packageJsonPath)) {
        return {
          projectDir,
          error: 'No package.json found',
          vulnerabilities: []
        };
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const packageManager = this.detectPackageManager(projectDir);

      this.log(`Scanning ${projectDir} with ${packageManager}...`);

      // Run audit command
      const auditResults = await this.runAudit(projectDir, packageManager);

      // Parse dependencies
      const dependencies = this.parseDependencies(packageJson);

      // Analyze vulnerabilities
      const vulnerabilities = this.analyzeVulnerabilities(auditResults, dependencies);

      // Check licenses if enabled
      let licenseIssues = [];
      if (this.checkLicenses) {
        licenseIssues = await this.checkDependencyLicenses(projectDir, packageManager);
      }

      // Update statistics
      this.stats.dependenciesScanned += dependencies.length;
      vulnerabilities.forEach(vuln => {
        this.stats.vulnerabilitiesFound++;
        const severity = vuln.severity.toLowerCase();
        if (severity === 'critical') this.stats.critical++;
        else if (severity === 'high') this.stats.high++;
        else if (severity === 'moderate') this.stats.moderate++;
        else if (severity === 'low') this.stats.low++;
      });
      this.stats.licenseIssues += licenseIssues.length;

      return {
        projectDir,
        packageManager,
        packageName: packageJson.name || 'unknown',
        packageVersion: packageJson.version || '0.0.0',
        dependencies,
        vulnerabilities,
        licenseIssues,
        summary: {
          total: vulnerabilities.length,
          critical: vulnerabilities.filter(v => v.severity === 'critical').length,
          high: vulnerabilities.filter(v => v.severity === 'high').length,
          moderate: vulnerabilities.filter(v => v.severity === 'moderate').length,
          low: vulnerabilities.filter(v => v.severity === 'low').length
        }
      };

    } catch (error) {
      this.log(`Error scanning ${projectDir}: ${error.message}`);
      return {
        projectDir,
        error: error.message,
        vulnerabilities: []
      };
    }
  }

  /**
   * Run package manager audit
   */
  async runAudit(projectDir, packageManager) {
    try {
      let command;
      let parseJson = true;

      switch (packageManager) {
        case 'npm':
          command = 'npm audit --json';
          break;
        case 'yarn':
          command = 'yarn audit --json';
          break;
        case 'pnpm':
          command = 'pnpm audit --json';
          break;
        default:
          command = 'npm audit --json';
      }

      this.log(`Running: ${command}`);

      const { stdout, stderr } = await execPromise(command, {
        cwd: projectDir,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });

      try {
        return JSON.parse(stdout);
      } catch (parseError) {
        this.log(`Failed to parse audit output: ${parseError.message}`);
        return { vulnerabilities: {} };
      }

    } catch (error) {
      // Audit commands often exit with non-zero code when vulnerabilities found
      if (error.stdout) {
        try {
          return JSON.parse(error.stdout);
        } catch (parseError) {
          this.log(`Failed to parse audit output from error: ${parseError.message}`);
        }
      }

      this.log(`Audit command failed: ${error.message}`);
      return { vulnerabilities: {} };
    }
  }

  /**
   * Parse dependencies from package.json
   */
  parseDependencies(packageJson) {
    const deps = [];

    const addDeps = (dependencies, type) => {
      if (!dependencies) return;

      for (const [name, version] of Object.entries(dependencies)) {
        deps.push({
          name,
          version: version.replace(/[\^~>=<]/g, ''), // Remove semver operators
          type
        });
      }
    };

    addDeps(packageJson.dependencies, 'production');

    if (this.includeDevDependencies) {
      addDeps(packageJson.devDependencies, 'development');
    }

    return deps;
  }

  /**
   * Analyze vulnerabilities from audit results
   */
  analyzeVulnerabilities(auditResults, dependencies) {
    const vulnerabilities = [];

    // npm audit format
    if (auditResults.vulnerabilities) {
      for (const [packageName, vulnData] of Object.entries(auditResults.vulnerabilities)) {
        const vuln = this.parseNpmVulnerability(packageName, vulnData);
        if (vuln) {
          vulnerabilities.push(vuln);
        }
      }
    }

    // yarn audit format (different structure)
    if (auditResults.data && auditResults.data.vulnerabilities) {
      for (const vulnData of Object.values(auditResults.data.vulnerabilities)) {
        const vuln = this.parseYarnVulnerability(vulnData);
        if (vuln) {
          vulnerabilities.push(vuln);
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Parse npm vulnerability data
   */
  parseNpmVulnerability(packageName, vulnData) {
    if (!vulnData || vulnData.via.length === 0) return null;

    const via = Array.isArray(vulnData.via) ? vulnData.via[0] : vulnData.via;

    if (typeof via === 'string') {
      // Simple reference, skip
      return null;
    }

    return {
      type: 'dependency-vulnerability',
      package: packageName,
      version: vulnData.range || 'unknown',
      severity: vulnData.severity || 'unknown',
      title: via.title || 'Unknown vulnerability',
      description: via.description || '',
      cve: via.cve || [],
      cvss: via.cvss || null,
      cwe: via.cwe || [],
      url: via.url || '',
      recommendation: vulnData.fixAvailable 
        ? `Update to ${vulnData.fixAvailable.version || 'latest'}`
        : 'No fix available yet',
      fixAvailable: vulnData.fixAvailable || false,
      path: vulnData.nodes || []
    };
  }

  /**
   * Parse yarn vulnerability data
   */
  parseYarnVulnerability(vulnData) {
    return {
      type: 'dependency-vulnerability',
      package: vulnData.module_name || 'unknown',
      version: vulnData.vulnerable_versions || 'unknown',
      severity: vulnData.severity || 'unknown',
      title: vulnData.title || 'Unknown vulnerability',
      description: vulnData.overview || '',
      cve: vulnData.cves || [],
      url: vulnData.url || '',
      recommendation: vulnData.recommendation || 'Update to latest version',
      fixAvailable: !!vulnData.patched_versions,
      path: []
    };
  }

  /**
   * Check dependency licenses
   */
  async checkDependencyLicenses(projectDir, packageManager) {
    const licenseIssues = [];

    try {
      // Use license-checker or parse manually
      const command = 'npm list --json --depth=0';
      const { stdout } = await execPromise(command, { cwd: projectDir });
      const listData = JSON.parse(stdout);

      if (listData.dependencies) {
        for (const [name, data] of Object.entries(listData.dependencies)) {
          const license = this.extractLicense(data);

          if (this.isRestrictedLicense(license)) {
            licenseIssues.push({
              type: 'license-issue',
              package: name,
              version: data.version,
              license: license,
              severity: 'MEDIUM',
              description: `Package uses restricted license: ${license}`,
              recommendation: 'Review license compatibility with your project'
            });
          }
        }
      }

    } catch (error) {
      this.log(`Error checking licenses: ${error.message}`);
    }

    return licenseIssues;
  }

  /**
   * Extract license from package data
   */
  extractLicense(packageData) {
    if (typeof packageData === 'string') {
      return packageData;
    }

    if (packageData.license) {
      return packageData.license;
    }

    if (packageData.licenses) {
      if (Array.isArray(packageData.licenses)) {
        return packageData.licenses.map(l => l.type || l).join(', ');
      }
      return packageData.licenses;
    }

    return 'UNKNOWN';
  }

  /**
   * Check if license is restricted
   */
  isRestrictedLicense(license) {
    if (!license || license === 'UNKNOWN') {
      return false;
    }

    return this.restrictedLicenses.some(restricted => 
      license.toUpperCase().includes(restricted.toUpperCase())
    );
  }

  /**
   * Scan multiple projects
   */
  async scanProjects(projectDirs) {
    const results = [];

    for (const projectDir of projectDirs) {
      const result = await this.scanProject(projectDir);
      results.push(result);
    }

    return results;
  }

  /**
   * Find projects in directory
   */
  findProjects(directory) {
    const projects = [];

    const scan = (dir, depth = 0) => {
      if (depth > 3) return; // Limit recursion depth

      try {
        const packageJsonPath = path.join(dir, 'package.json');

        if (fs.existsSync(packageJsonPath)) {
          projects.push(dir);
          return; // Don't scan nested projects
        }

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
            scan(path.join(dir, entry.name), depth + 1);
          }
        }
      } catch (error) {
        this.log(`Error scanning ${dir}: ${error.message}`);
      }
    };

    scan(directory);
    return projects;
  }

  /**
   * Generate report
   */
  generateReport(results) {
    const report = {
      summary: {
        ...this.stats,
        projectsWithVulnerabilities: results.filter(r => r.vulnerabilities && r.vulnerabilities.length > 0).length,
        timestamp: new Date().toISOString()
      },
      projects: []
    };

    // Group vulnerabilities
    const allVulnerabilities = [];
    const bySeverity = { critical: [], high: [], moderate: [], low: [] };
    const byPackage = {};

    results.forEach(result => {
      if (result.error) {
        report.projects.push({
          projectDir: result.projectDir,
          error: result.error
        });
        return;
      }

      report.projects.push({
        projectDir: result.projectDir,
        packageName: result.packageName,
        packageManager: result.packageManager,
        summary: result.summary,
        vulnerabilityCount: result.vulnerabilities.length,
        licenseIssueCount: result.licenseIssues ? result.licenseIssues.length : 0
      });

      if (result.vulnerabilities) {
        result.vulnerabilities.forEach(vuln => {
          allVulnerabilities.push(vuln);

          const severity = vuln.severity.toLowerCase();
          if (bySeverity[severity]) {
            bySeverity[severity].push(vuln);
          }

          if (!byPackage[vuln.package]) {
            byPackage[vuln.package] = [];
          }
          byPackage[vuln.package].push(vuln);
        });
      }
    });

    report.vulnerabilities = allVulnerabilities;
    report.bySeverity = bySeverity;
    report.byPackage = byPackage;

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
      console.log(`[DependencyScanner] ${message}`);
    }
  }
}

module.exports = {
  DependencyScanner
};

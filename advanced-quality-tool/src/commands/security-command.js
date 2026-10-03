/**
 * Security Command - CLI handler for security scanning operations
 * 
 * Usage:
 *   aqt security scan [options]
 *   aqt security vulnerabilities [options]
 *   aqt security secrets [options]
 *   aqt security dependencies [options]
 * 
 * Options:
 *   --scan-type              Scan type: 'vuln', 'secrets', 'deps', 'all' (default: 'all')
 *   --severity               Minimum severity: 'critical', 'high', 'medium', 'low' (default: 'all')
 *   --fix-auto              Automatically fix fixable issues
 *   --report                Output format: 'json', 'markdown', 'sarif' (default: 'json')
 *   --output, -o            Output file path
 *   --workspace, -w         Workspace path (default: current directory)
 *   --format, -f            Output format: 'json', 'table' (default: 'table')
 *   --verbose, -v           Verbose output
 *   --help, -h              Show help
 *
 * @module commands/security-command
 */

'use strict';

const { VulnerabilityScanner } = require('../security/vulnerability-scanner');
const { SecretScanner } = require('../security/secret-scanner');
const { DependencyScanner } = require('../security/dependency-scanner');
const path = require('path');
const fs = require('fs');

/**
 * Main command router
 */
async function run(args) {
  const [subcommand, ...subArgs] = args;
  
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  switch (subcommand) {
    case 'scan':
      return runScan(subArgs);
    case 'vulnerabilities':
    case 'vuln':
      return scanVulnerabilities(subArgs);
    case 'secrets':
      return scanSecrets(subArgs);
    case 'dependencies':
    case 'deps':
      return scanDependencies(subArgs);
    default:
      console.error(`\n❌ Unknown subcommand: ${subcommand}\n`);
      printHelp();
      process.exit(1);
  }
}

/**
 * Run comprehensive security scan
 */
async function runScan(args) {
  const options = parseOptions(args);
  const scanTypes = parseScanTypes(options.scanType || 'all');
  
  console.log('\n🔒 Security Scan Started\n');
  console.log(`  Workspace:     ${options.workspace}`);
  console.log(`  Scan Types:    ${scanTypes.join(', ')}`);
  if (options.severity) console.log(`  Min Severity:  ${options.severity}`);
  console.log('');
  
  const results = {
    timestamp: new Date().toISOString(),
    workspace: options.workspace,
    scanTypes,
    findings: {
      vulnerabilities: [],
      secrets: [],
      dependencies: []
    },
    stats: {
      totalIssues: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    }
  };

  try {
    // Scan vulnerabilities
    if (scanTypes.includes('vuln')) {
      console.log('📋 Scanning for vulnerabilities...');
      const vulnResults = await scanForVulnerabilities(options);
      results.findings.vulnerabilities = vulnResults.vulnerabilities;
      results.stats = updateStats(results.stats, vulnResults.stats);
    }

    // Scan for secrets
    if (scanTypes.includes('secrets')) {
      console.log('🔑 Scanning for hardcoded secrets...');
      const secretResults = await scanForSecrets(options);
      results.findings.secrets = secretResults.secrets;
      results.stats = updateStats(results.stats, secretResults.stats);
    }

    // Scan dependencies
    if (scanTypes.includes('deps')) {
      console.log('📦 Scanning dependencies...');
      const depsResults = await scanDependencies(options);
      results.findings.dependencies = depsResults.dependencies;
      results.stats = updateStats(results.stats, depsResults.stats);
    }

    // Filter by severity
    if (options.severity) {
      filterBySeverity(results, options.severity);
    }

    // Output results
    console.log('\n' + '='.repeat(60) + '\n');
    console.log('📊 Security Scan Report\n');
    
    displaySummary(results.stats);
    
    if (options.format === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else {
      displayReadableReport(results);
    }

    // Save to file if requested
    if (options.output) {
      saveReport(results, options.output, options.report);
      console.log(`\n✅ Report saved to: ${options.output}`);
    }

    // Exit with appropriate code
    if (results.stats.critical > 0) {
      process.exit(2); // Critical issues found
    } else if (results.stats.high > 0) {
      process.exit(1); // High severity issues found
    }

  } catch (error) {
    console.error(`\n❌ Security scan failed: ${error.message}\n`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Scan for vulnerabilities
 */
async function scanForVulnerabilities(options) {
  const scanner = new VulnerabilityScanner({
    severity: options.severity || 'all',
    verbose: options.verbose
  });

  const workspace = options.workspace || process.cwd();
  const scanOptions = {
    patterns: ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**']
  };

  const results = await scanner.scanDirectory(workspace, scanOptions);
  const report = scanner.generateReport(results);

  return {
    vulnerabilities: report.vulnerabilities,
    stats: report.summary
  };
}

/**
 * Scan for hardcoded secrets
 */
async function scanForSecrets(options) {
  const scanner = new SecretScanner({
    verbose: options.verbose
  });

  const workspace = options.workspace || process.cwd();
  const scanOptions = {
    patterns: [
      '**/*.js', '**/*.ts', '**/*.json', '**/*.env*', 
      '**/*.yml', '**/*.yaml', '**/*.xml',
      '**/config/**', '**/settings/**'
    ],
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/build/**', 
      '**/coverage/**', '**/.git/**'
    ]
  };

  const results = await scanner.scanDirectory(workspace, scanOptions);
  const report = scanner.generateReport(results);

  return {
    secrets: report.vulnerabilities,
    stats: report.summary
  };
}

/**
 * Scan dependencies for vulnerabilities
 */
async function scanDependencies(options) {
  const scanner = new DependencyScanner({
    verbose: options.verbose
  });

  const workspace = options.workspace || process.cwd();
  const packageJsonPath = path.join(workspace, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return {
      dependencies: [],
      stats: { filesScanned: 0, vulnerabilitiesFound: 0, critical: 0, high: 0, medium: 0, low: 0 }
    };
  }

  const results = await scanner.scanPackageJson(packageJsonPath);
  const report = scanner.generateReport([results]);

  return {
    dependencies: report.vulnerabilities,
    stats: report.summary
  };
}

/**
 * Scan vulnerabilities (subcommand)
 */
async function scanVulnerabilities(args) {
  const options = parseOptions(args);
  console.log('\n🔍 Vulnerability Scan\n');
  
  try {
    const results = await scanForVulnerabilities(options);
    
    if (options.format === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else {
      displayVulnerabilities(results.vulnerabilities);
    }
  } catch (error) {
    console.error(`\n❌ Vulnerability scan failed: ${error.message}\n`);
    process.exit(1);
  }
}

/**
 * Scan for secrets (subcommand)
 */
async function scanForSecrets(args) {
  const options = parseOptions(args);
  console.log('\n🔑 Secret Detection Scan\n');
  
  try {
    const results = await scanForSecrets(options);
    
    if (options.format === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else {
      displaySecrets(results.secrets);
    }
  } catch (error) {
    console.error(`\n❌ Secret scan failed: ${error.message}\n`);
    process.exit(1);
  }
}

/**
 * Scan dependencies (subcommand)
 */
async function scanDeps(args) {
  const options = parseOptions(args);
  console.log('\n📦 Dependency Scan\n');
  
  try {
    const results = await scanDependencies(options);
    
    if (options.format === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else {
      displayDependencies(results.dependencies);
    }
  } catch (error) {
    console.error(`\n❌ Dependency scan failed: ${error.message}\n`);
    process.exit(1);
  }
}

/**
 * Display summary statistics
 */
function displaySummary(stats) {
  console.log(`📊 Summary:`);
  console.log(`  Total Issues: ${stats.totalIssues || 0}`);
  console.log(`  🔴 Critical: ${stats.critical || 0}`);
  console.log(`  🟠 High:     ${stats.high || 0}`);
  console.log(`  🟡 Medium:   ${stats.medium || 0}`);
  console.log(`  🟢 Low:      ${stats.low || 0}`);
  console.log('');
}

/**
 * Display vulnerabilities in readable format
 */
function displayVulnerabilities(vulnerabilities) {
  if (vulnerabilities.length === 0) {
    console.log('✅ No vulnerabilities found!\n');
    return;
  }

  console.log(`Found ${vulnerabilities.length} vulnerability(ies):\n`);

  const bySeverity = {
    CRITICAL: [],
    HIGH: [],
    MEDIUM: [],
    LOW: []
  };

  vulnerabilities.forEach(vuln => {
    bySeverity[vuln.severity]?.push(vuln) || (bySeverity[vuln.severity] = [vuln]);
  });

  Object.entries(bySeverity).forEach(([severity, items]) => {
    if (items.length > 0) {
      const icon = getSeverityIcon(severity);
      console.log(`${icon} ${severity} (${items.length}):`);

      items.forEach((item, index) => {
        console.log(`\n  ${index + 1}. ${item.name}`);
        console.log(`     File:   ${item.filePath}:${item.line}`);
        console.log(`     CWE:    ${item.cwe}`);
        console.log(`     OWASP:  ${item.owasp}`);
        console.log(`     Desc:   ${item.description}`);
        console.log(`     Fix:    ${item.recommendation}`);
      });

      console.log('');
    }
  });
}

/**
 * Display secrets in readable format
 */
function displaySecrets(secrets) {
  if (secrets.length === 0) {
    console.log('✅ No secrets found!\n');
    return;
  }

  console.log(`Found ${secrets.length} secret(s):\n`);

  secrets.forEach((secret, index) => {
    console.log(`${index + 1}. ${secret.name}`);
    console.log(`   File:     ${secret.filePath}:${secret.line}`);
    console.log(`   Type:     ${secret.type}`);
    console.log(`   Entropy:  ${secret.entropy?.toFixed(2) || 'N/A'}`);
    console.log(`   Secret:   ${secret.redacted || '(redacted)'}`);
    console.log('');
  });
}

/**
 * Display dependency vulnerabilities
 */
function displayDependencies(dependencies) {
  if (dependencies.length === 0) {
    console.log('✅ No dependency vulnerabilities found!\n');
    return;
  }

  console.log(`Found ${dependencies.length} dependency vulnerability(ies):\n`);

  dependencies.forEach((dep, index) => {
    console.log(`${index + 1}. ${dep.package}`);
    console.log(`   Version:      ${dep.version}`);
    console.log(`   Vulnerable:   ${dep.vulnerableVersions?.join(', ') || 'N/A'}`);
    console.log(`   Severity:     ${dep.severity}`);
    console.log(`   Description:  ${dep.description}`);
    console.log('');
  });
}

/**
 * Display full readable report
 */
function displayReadableReport(results) {
  // Vulnerabilities
  if (results.findings.vulnerabilities.length > 0) {
    console.log('🔍 Vulnerabilities:\n');
    displayVulnerabilities(results.findings.vulnerabilities);
  }

  // Secrets
  if (results.findings.secrets.length > 0) {
    console.log('🔑 Secrets:\n');
    displaySecrets(results.findings.secrets);
  }

  // Dependencies
  if (results.findings.dependencies.length > 0) {
    console.log('📦 Dependencies:\n');
    displayDependencies(results.findings.dependencies);
  }

  if (results.findings.vulnerabilities.length === 0 && 
      results.findings.secrets.length === 0 && 
      results.findings.dependencies.length === 0) {
    console.log('✅ No security issues found!\n');
  }
}

/**
 * Get icon for severity level
 */
function getSeverityIcon(severity) {
  switch (severity.toUpperCase()) {
    case 'CRITICAL': return '🔴';
    case 'HIGH': return '🟠';
    case 'MEDIUM': return '🟡';
    case 'LOW': return '🟢';
    default: return '⚪';
  }
}

/**
 * Parse scan types
 */
function parseScanTypes(scanType) {
  if (scanType === 'all') {
    return ['vuln', 'secrets', 'deps'];
  }
  return scanType.split(',').map(t => t.trim());
}

/**
 * Update statistics
 */
function updateStats(stats, newStats) {
  return {
    totalIssues: (stats.totalIssues || 0) + (newStats.vulnerabilitiesFound || 0),
    critical: (stats.critical || 0) + (newStats.critical || 0),
    high: (stats.high || 0) + (newStats.high || 0),
    medium: (stats.medium || 0) + (newStats.medium || 0),
    low: (stats.low || 0) + (newStats.low || 0)
  };
}

/**
 * Filter results by severity
 */
function filterBySeverity(results, minSeverity) {
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const minLevel = severityOrder[minSeverity.toLowerCase()] || 0;

  results.findings.vulnerabilities = results.findings.vulnerabilities.filter(v => 
    severityOrder[v.severity.toLowerCase()] <= minLevel
  );

  results.findings.secrets = results.findings.secrets.filter(s => 
    severityOrder[s.severity?.toLowerCase() || 'high'] <= minLevel
  );

  results.findings.dependencies = results.findings.dependencies.filter(d => 
    severityOrder[d.severity?.toLowerCase() || 'high'] <= minLevel
  );

  // Recalculate stats
  results.stats = {
    totalIssues: results.findings.vulnerabilities.length + 
                 results.findings.secrets.length + 
                 results.findings.dependencies.length,
    critical: countBySeverity(results.findings, 'critical'),
    high: countBySeverity(results.findings, 'high'),
    medium: countBySeverity(results.findings, 'medium'),
    low: countBySeverity(results.findings, 'low')
  };
}

/**
 * Count issues by severity
 */
function countBySeverity(findings, severity) {
  let count = 0;
  const sev = severity.toUpperCase();

  count += findings.vulnerabilities.filter(v => v.severity === sev).length;
  count += findings.secrets.filter(s => (s.severity || 'HIGH').toUpperCase() === sev).length;
  count += findings.dependencies.filter(d => (d.severity || 'HIGH').toUpperCase() === sev).length;

  return count;
}

/**
 * Save report to file
 */
function saveReport(results, filePath, format = 'json') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let content;
  if (format === 'sarif') {
    content = generateSARIFReport(results);
  } else if (format === 'markdown') {
    content = generateMarkdownReport(results);
  } else {
    content = JSON.stringify(results, null, 2);
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Generate SARIF report
 */
function generateSARIFReport(results) {
  const runs = [{
    tool: {
      driver: {
        name: 'Advanced Quality Tool',
        version: '1.0.0',
        informationUri: 'https://github.com/your-org/aqt'
      }
    },
    results: []
  }];

  // Add vulnerabilities
  results.findings.vulnerabilities.forEach(vuln => {
    runs[0].results.push({
      ruleId: vuln.name,
      level: vuln.severity.toLowerCase(),
      message: { text: vuln.description },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: vuln.filePath },
          region: { startLine: vuln.line }
        }
      }],
      properties: {
        cwe: vuln.cwe,
        owasp: vuln.owasp,
        recommendation: vuln.recommendation
      }
    });
  });

  return JSON.stringify({ version: '2.1.0', runs }, null, 2);
}

/**
 * Generate Markdown report
 */
function generateMarkdownReport(results) {
  let md = '# Security Scan Report\n\n';
  md += `Generated: ${results.timestamp}\n\n`;

  md += '## Summary\n\n';
  md += `- Total Issues: ${results.stats.totalIssues}\n`;
  md += `- Critical: ${results.stats.critical}\n`;
  md += `- High: ${results.stats.high}\n`;
  md += `- Medium: ${results.stats.medium}\n`;
  md += `- Low: ${results.stats.low}\n\n`;

  if (results.findings.vulnerabilities.length > 0) {
    md += '## Vulnerabilities\n\n';
    results.findings.vulnerabilities.forEach((vuln, i) => {
      md += `### ${i + 1}. ${vuln.name}\n\n`;
      md += `**Severity:** ${vuln.severity}\n`;
      md += `**File:** ${vuln.filePath}:${vuln.line}\n`;
      md += `**Description:** ${vuln.description}\n`;
      md += `**Recommendation:** ${vuln.recommendation}\n\n`;
    });
  }

  if (results.findings.secrets.length > 0) {
    md += '## Secrets Found\n\n';
    results.findings.secrets.forEach((secret, i) => {
      md += `### ${i + 1}. ${secret.name}\n\n`;
      md += `**File:** ${secret.filePath}:${secret.line}\n`;
      md += `**Type:** ${secret.type}\n\n`;
    });
  }

  return md;
}

/**
 * Parse command-line options
 */
function parseOptions(args) {
  const options = {
    workspace: process.cwd(),
    scanType: 'all',
    severity: null,
    fixAuto: false,
    report: 'json',
    output: null,
    format: 'table',
    verbose: false,
    positional: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--scan-type' || arg === '--type') {
      options.scanType = args[++i];
    } else if (arg === '--severity' || arg === '--min-severity') {
      options.severity = args[++i];
    } else if (arg === '--fix-auto' || arg === '--auto-fix') {
      options.fixAuto = true;
    } else if (arg === '--report' || arg === '--report-format') {
      options.report = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--workspace' || arg === '-w') {
      options.workspace = args[++i];
    } else if (arg === '--format' || arg === '-f') {
      options.format = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (!arg.startsWith('-')) {
      options.positional.push(arg);
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
${require('path').basename(process.argv[1])} security - Security scanning and vulnerability detection

${'\x1b[1m'}Usage:${'\x1b[0m'}
  aqt security <subcommand> [options]

${'\x1b[1m'}Subcommands:${'\x1b[0m'}
  scan               Run comprehensive security scan
  vulnerabilities    Scan for code vulnerabilities (CWE-based)
  secrets            Scan for hardcoded secrets
  dependencies       Scan dependencies for CVEs

${'\x1b[1m'}Options:${'\x1b[0m'}
  --scan-type        Scan type: 'vuln', 'secrets', 'deps', 'all' (default: all)
  --severity         Minimum severity: critical, high, medium, low (default: all)
  --fix-auto         Automatically fix fixable issues
  --report           Report format: json, markdown, sarif (default: json)
  --output, -o       Save report to file
  --workspace, -w    Workspace path (default: current directory)
  --format, -f       Output format: json, table (default: table)
  --verbose, -v      Verbose output
  --help, -h         Show this help

${'\x1b[1m'}Examples:${'\x1b[0m'}
  aqt security scan
  aqt security scan --severity high --output report.json
  aqt security vulnerabilities --format table
  aqt security secrets
  aqt security dependencies --workspace /path/to/project
  aqt security scan --report markdown --output report.md

${'\x1b[1m'}Exit Codes:${'\x1b[0m'}
  0                  No issues found
  1                  High severity issues found
  2                  Critical issues found
`);
}

module.exports = { run };

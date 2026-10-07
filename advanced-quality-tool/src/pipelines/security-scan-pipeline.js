/**
 * Security Scanning Pipeline (P9-T033)
 *
 * Unifies vulnerability, secret, and dependency scanners behind one security pipeline contract.
 * Ensures secrets are redacted from execution records and model context.
 *
 * @module pipelines/security-scan-pipeline
 */

'use strict';

const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');

/**
 * Security finding severity
 */
const SecuritySeverity = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info'
};

/**
 * Security finding types
 */
const SecurityFindingType = {
  VULNERABILITY: 'vulnerability',
  SECRET: 'secret',
  DEPENDENCY: 'dependency',
  MISCONFIGURATION: 'misconfiguration',
  EXPOSURE: 'exposure'
};

/**
 * Secret patterns for detection
 */
const SECRET_PATTERNS = [
  { pattern: /(?:api[_-]?key|apikey)[\s:=]+['"]?([a-zA-Z0-9_-]{20,})['"]?/gi, type: 'api-key' },
  { pattern: /(?:secret[_-]?key|secretkey)[\s:=]+['"]?([a-zA-Z0-9_-]{20,})['"]?/gi, type: 'secret-key' },
  { pattern: /(?:access[_-]?token|accesstoken)[\s:=]+['"]?([a-zA-Z0-9_-]{20,})['"]?/gi, type: 'access-token' },
  { pattern: /(?:password|passwd|pwd)[\s:=]+['"]?([^\s'"]{8,})['"]?/gi, type: 'password' },
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, type: 'private-key' },
  { pattern: /(?:aws[_-])?access[_-]?key[_-]?id[\s:=]+['"]?([A-Z0-9]{20})['"]?/gi, type: 'aws-access-key' },
  { pattern: /(?:aws[_-])?secret[_-]?access[_-]?key[\s:=]+['"]?([a-zA-Z0-9/+=]{40})['"]?/gi, type: 'aws-secret-key' },
  { pattern: /github[_-]?token[\s:=]+['"]?([a-zA-Z0-9_-]{35,40})['"]?/gi, type: 'github-token' },
  { pattern: /npm[_-]?token[\s:=]+['"]?([a-zA-Z0-9_-]{36})['"]?/gi, type: 'npm-token' }
];

/**
 * Security Scan Pipeline
 */
class SecurityScanPipeline {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.executor = options.executor || new PipelineExecutor();
    
    // Scanners
    this.vulnerabilityScanner = options.vulnerabilityScanner || null;
    this.secretScanner = options.secretScanner || null;
    this.dependencyScanner = options.dependencyScanner || null;
    
    // Configuration
    this.gates = options.gates || this.getDefaultGates();
    this.redactSecrets = options.redactSecrets !== false;
    this.maxFileSize = options.maxFileSize || 1024 * 1024; // 1MB
    
    // Exclusions
    this.excludePatterns = options.excludePatterns || [
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      '**/*.min.js',
      '**/*.map'
    ];
  }

  /**
   * Execute security scan pipeline
   * @param {Object} params
   * @param {Object} params.scope - Files/directories to scan
   * @param {string[]} [params.scanners] - Specific scanners to run
   * @param {Object} [params.gates] - Override security gates
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const { scope, scanners = null, gates = null } = params;

    const stageHandlers = {
      'select-scope': async (ctx) => this._selectScope(ctx, scope),
      'scan-vulnerabilities': async (ctx) => this._scanVulnerabilities(ctx, scanners),
      'scan-secrets': async (ctx) => this._scanSecrets(ctx, scanners),
      'scan-dependencies': async (ctx) => this._scanDependencies(ctx, scanners),
      'normalize-findings': async (ctx) => this._normalizeFindings(ctx),
      'score-risk': async (ctx) => this._scoreRisk(ctx),
      'apply-gates': async (ctx) => this._applyGates(ctx, gates),
      'publish-report': async (ctx) => this._publishReport(ctx)
    };

    const result = await this.executor.execute('security-scan', {
      input: { scope, scanners, gates },
      workspace: this.workspace,
      stageHandlers
    });

    return result;
  }

  /**
   * Get default security gates
   * @returns {Object[]}
   */
  getDefaultGates() {
    return [
      {
        name: 'No Critical Vulnerabilities',
        type: 'vulnerability',
        severity: SecuritySeverity.CRITICAL,
        maxCount: 0,
        description: 'Zero critical vulnerabilities allowed'
      },
      {
        name: 'No Exposed Secrets',
        type: 'secret',
        maxCount: 0,
        description: 'Zero exposed secrets allowed'
      },
      {
        name: 'Dependency Vulnerabilities',
        type: 'dependency',
        severity: SecuritySeverity.HIGH,
        maxCount: 5,
        description: 'Maximum 5 high-severity dependency vulnerabilities'
      }
    ];
  }

  isUrlAllowed(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return { allowed: false, reason: 'Invalid URL' };
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      return { allowed: false, reason: 'Unsupported URL protocol' };
    }
    if (url.username || url.password) {
      return { allowed: false, reason: 'URLs containing credentials are not allowed' };
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
        hostname === '0.0.0.0' || hostname === '::' || hostname === '::1' ||
        hostname.startsWith('fc') || hostname.startsWith('fd') ||
        /^fe[89ab]/.test(hostname)) {
      return { allowed: false, reason: 'Local and private network destinations are not allowed' };
    }

    if (net.isIP(hostname) === 4) {
      const [a, b] = hostname.split('.').map(Number);
      const privateAddress = a === 0 || a === 10 || a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168);
      if (privateAddress) {
        return { allowed: false, reason: 'Local and private network destinations are not allowed' };
      }
    } else if (net.isIP(hostname) === 6 && hostname.startsWith('::ffff:')) {
      const mappedIPv4 = hostname.slice('::ffff:'.length);
      if (net.isIP(mappedIPv4) === 4) {
        const [a, b] = mappedIPv4.split('.').map(Number);
        if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
          return { allowed: false, reason: 'Local and private network destinations are not allowed' };
        }
      }
    }

    return { allowed: true };
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _selectScope(ctx, scope) {
    const files = [];
    
    if (scope.files) {
      files.push(...scope.files);
    } else if (scope.directory) {
      const dir = path.isAbsolute(scope.directory) ? 
        scope.directory : 
        path.join(this.workspace, scope.directory);
      
      files.push(...this._discoverFiles(dir));
    } else {
      files.push(...this._discoverFiles(this.workspace));
    }
    
    // Filter exclusions
    const filtered = files.filter(f => !this._isExcluded(f));
    
    return {
      files: filtered,
      count: filtered.length,
      scope: scope
    };
  }

  async _scanVulnerabilities(ctx, scanners) {
    if (scanners && !scanners.includes('vulnerability')) {
      return { skipped: true, findings: [] };
    }
    
    const { files } = ctx.previousResults?.['select-scope'] || {};
    
    const findings = [];
    
    // Use custom scanner if provided
    if (this.vulnerabilityScanner) {
      const result = await this.vulnerabilityScanner.scan(files || []);
      findings.push(...(result.findings || []));
    } else {
      // Default vulnerability patterns
      const defaultFindings = await this._detectVulnerabilities(files || []);
      findings.push(...defaultFindings);
    }
    
    return {
      scanner: this.vulnerabilityScanner?.name || 'default',
      findings,
      scanned: files?.length || 0
    };
  }

  async _scanSecrets(ctx, scanners) {
    if (scanners && !scanners.includes('secret')) {
      return { skipped: true, findings: [] };
    }
    
    const { files } = ctx.previousResults?.['select-scope'] || {};
    
    const findings = [];
    
    for (const file of files || []) {
      try {
        const content = this._readFile(file);
        if (!content) continue;
        
        const secrets = this._detectSecrets(file, content);
        findings.push(...secrets);
        
      } catch (error) {
        // Skip files that can't be read
      }
    }
    
    // Redact secrets from findings
    const redactedFindings = this.redactSecrets ? 
      this._redactSecretsFromFindings(findings) : 
      findings;
    
    return {
      scanner: this.secretScanner?.name || 'default',
      findings: redactedFindings,
      scanned: files?.length || 0,
      redacted: this.redactSecrets
    };
  }

  async _scanDependencies(ctx, scanners) {
    if (scanners && !scanners.includes('dependency')) {
      return { skipped: true, findings: [] };
    }
    
    const findings = [];
    
    // Check for dependency files
    const packageJsonPath = path.join(this.workspace, 'package.json');
    
    if (fs.existsSync(packageJsonPath)) {
      const result = await this._auditDependencies(packageJsonPath);
      findings.push(...result);
    }
    
    // Use custom scanner if provided
    if (this.dependencyScanner) {
      const result = await this.dependencyScanner.scan(this.workspace);
      findings.push(...(result.findings || []));
    }
    
    return {
      scanner: this.dependencyScanner?.name || 'npm-audit',
      findings,
      hasPackageJson: fs.existsSync(packageJsonPath)
    };
  }

  async _normalizeFindings(ctx) {
    const vulnerabilityFindings = ctx.previousResults?.['scan-vulnerabilities']?.findings || [];
    const secretFindings = ctx.previousResults?.['scan-secrets']?.findings || [];
    const dependencyFindings = ctx.previousResults?.['scan-dependencies']?.findings || [];
    
    const allFindings = [
      ...vulnerabilityFindings.map(f => this._normalizeVulnerability(f)),
      ...secretFindings.map(f => this._normalizeSecret(f)),
      ...dependencyFindings.map(f => this._normalizeDependency(f))
    ];
    
    // Deduplicate by fingerprint
    const seen = new Map();
    const deduped = [];
    
    for (const finding of allFindings) {
      const fingerprint = this._fingerprint(finding);
      if (!seen.has(fingerprint)) {
        seen.set(fingerprint, true);
        deduped.push({
          ...finding,
          fingerprint
        });
      }
    }
    
    return { findings: deduped, count: deduped.length };
  }

  async _scoreRisk(ctx) {
    const { findings } = ctx.previousResults?.['normalize-findings'] || {};
    
    const scores = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    };
    
    const byType = {
      vulnerability: 0,
      secret: 0,
      dependency: 0,
      misconfiguration: 0,
      exposure: 0
    };
    
    for (const finding of findings || []) {
      scores[finding.severity] = (scores[finding.severity] || 0) + 1;
      byType[finding.type] = (byType[finding.type] || 0) + 1;
    }
    
    // Calculate overall risk score (0-100)
    const riskScore = Math.min(100, 
      scores.critical * 25 +
      scores.high * 10 +
      scores.medium * 3 +
      scores.low * 1
    );
    
    return {
      scores,
      byType,
      riskScore,
      riskLevel: this._getRiskLevel(riskScore)
    };
  }

  async _applyGates(ctx, customGates) {
    const gates = customGates || this.gates;
    const { findings } = ctx.previousResults?.['normalize-findings'] || {};
    const { scores, byType } = ctx.previousResults?.['score-risk'] || {};
    
    const results = [];
    let passed = true;
    
    for (const gate of gates) {
      let count = 0;
      
      if (gate.type) {
        // Count by type and severity
        count = (findings || []).filter(f => {
          if (f.type !== gate.type) return false;
          if (gate.severity && f.severity !== gate.severity) return false;
          return true;
        }).length;
      } else {
        count = scores?.[gate.severity] || 0;
      }
      
      const gatePassed = count <= (gate.maxCount || 0);
      
      if (!gatePassed) {
        passed = false;
      }
      
      results.push({
        gate: gate.name,
        type: gate.type,
        severity: gate.severity,
        threshold: gate.maxCount,
        actual: count,
        passed: gatePassed
      });
    }
    
    return {
      passed,
      gates: results,
      failedGates: results.filter(g => !g.passed)
    };
  }

  async _publishReport(ctx) {
    const { findings, count } = ctx.previousResults?.['normalize-findings'] || {};
    const { riskScore, riskLevel, scores, byType } = ctx.previousResults?.['score-risk'] || {};
    const { passed, gates, failedGates } = ctx.previousResults?.['apply-gates'] || {};
    
    return {
      summary: {
        totalFindings: count,
        riskScore,
        riskLevel,
        passed
      },
      breakdown: {
        bySeverity: scores,
        byType
      },
      gates: {
        passed,
        total: gates?.length || 0,
        failed: failedGates?.length || 0,
        details: gates
      },
      findings: findings,
      generatedAt: new Date().toISOString()
    };
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────────

  _discoverFiles(dir) {
    const files = [];
    
    const walk = (currentDir) => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory()) {
            if (!this._isExcluded(fullPath)) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Ignore permission errors
      }
    };
    
    walk(dir);
    return files;
  }

  _isExcluded(filePath) {
    const relative = path.relative(this.workspace, filePath);
    const parts = relative.split(/[/\\]/);
    
    return parts.includes('node_modules') ||
           parts.includes('.git') ||
           parts.includes('dist') ||
           parts.includes('build');
  }

  _readFile(filePath) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > this.maxFileSize) {
        return null;
      }
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  _detectVulnerabilities(files) {
    // Placeholder - real implementation would use actual vulnerability scanner
    return [];
  }

  _detectSecrets(file, content) {
    const findings = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const { pattern, type } of SECRET_PATTERNS) {
        const matches = line.matchAll(pattern);
        
        for (const match of matches) {
          findings.push({
            type: SecurityFindingType.SECRET,
            secretType: type,
            file,
            line: i + 1,
            column: match.index + 1,
            match: match[0],
            value: match[1] || match[0]
          });
        }
      }
    }
    
    return findings;
  }

  _redactSecretsFromFindings(findings) {
    return findings.map(f => ({
      ...f,
      value: '[REDACTED]',
      match: f.match?.replace(f.value, '[REDACTED]') || '[REDACTED]'
    }));
  }

  async _auditDependencies(packageJsonPath) {
    // Placeholder - real implementation would run npm audit or similar
    return [];
  }

  _normalizeVulnerability(finding) {
    return {
      id: finding.id || `vuln-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: SecurityFindingType.VULNERABILITY,
      severity: this._normalizeSeverity(finding.severity),
      file: finding.file,
      line: finding.line,
      column: finding.column,
      message: finding.message || finding.title,
      rule: finding.cwe || finding.ruleId,
      cwe: finding.cwe,
      cve: finding.cve,
      references: finding.references || []
    };
  }

  _normalizeSecret(finding) {
    return {
      id: `secret-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: SecurityFindingType.SECRET,
      severity: SecuritySeverity.CRITICAL,
      file: finding.file,
      line: finding.line,
      column: finding.column,
      message: `Potential ${finding.secretType} detected`,
      secretType: finding.secretType,
      rule: `secret-detection/${finding.secretType}`
    };
  }

  _normalizeDependency(finding) {
    return {
      id: finding.id || `dep-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: SecurityFindingType.DEPENDENCY,
      severity: this._normalizeSeverity(finding.severity),
      package: finding.name || finding.package,
      version: finding.version,
      message: finding.message || finding.title,
      vulnerableVersions: finding.vulnerableVersions,
      patchedVersions: finding.patchedVersions,
      cwe: finding.cwe,
      cve: finding.cve
    };
  }

  _normalizeSeverity(severity) {
    const mapping = {
      'critical': SecuritySeverity.CRITICAL,
      'high': SecuritySeverity.HIGH,
      'moderate': SecuritySeverity.MEDIUM,
      'medium': SecuritySeverity.MEDIUM,
      'low': SecuritySeverity.LOW,
      'info': SecuritySeverity.INFO,
      'informational': SecuritySeverity.INFO
    };
    
    return mapping[severity?.toLowerCase()] || SecuritySeverity.MEDIUM;
  }

  _fingerprint(finding) {
    const data = `${finding.type}:${finding.file}:${finding.line}:${finding.rule || finding.secretType || finding.package}`;
    return crypto.createHash('sha256').update(data).digest('hex').substr(0, 16);
  }

  _getRiskLevel(score) {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    if (score >= 10) return 'low';
    return 'minimal';
  }
}

module.exports = {
  SecurityScanPipeline,
  SecuritySeverity,
  SecurityFindingType
};

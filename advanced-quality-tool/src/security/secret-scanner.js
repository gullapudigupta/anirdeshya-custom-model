/**
 * Secret Scanner
 * 
 * Detects sensitive information and secrets in source code:
 * - API keys (AWS, Google, GitHub, etc.)
 * - Access tokens
 * - Private keys
 * - Passwords and credentials
 * - Database connection strings
 * - OAuth secrets
 * 
 * Features:
 * - High-entropy string detection
 * - Pattern-based recognition
 * - False positive reduction
 * - Git history scanning
 * - Multi-format support (env files, JSON, YAML)
 * 
 * @module security/secret-scanner
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Secret Scanner
 */
class SecretScanner {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.minEntropy = options.minEntropy || 3.5; // Shannon entropy threshold
    this.gitHistory = options.gitHistory || false;

    // Secret patterns
    this.patterns = this.initializePatterns();

    // Whitelist patterns (to reduce false positives)
    this.whitelist = [
      /^(test|example|sample|dummy|fake|mock|placeholder|your[-_]|my[-_])/i,
      /^(xxx|111|000|abc|lorem|ipsum)/i,
      /<[^>]+>/,  // HTML/XML tags
      /^(true|false|null|undefined|NaN)$/i
    ];

    // Statistics
    this.stats = {
      filesScanned: 0,
      secretsFound: 0,
      critical: 0,
      high: 0,
      medium: 0,
      falsePositivesFiltered: 0
    };
  }

  /**
   * Initialize secret detection patterns
   */
  initializePatterns() {
    return [
      // AWS Keys
      {
        name: 'AWS Access Key ID',
        pattern: /(AKIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
        severity: 'CRITICAL',
        type: 'aws-access-key',
        description: 'AWS Access Key ID detected',
        recommendation: 'Rotate the key immediately and use AWS IAM roles or AWS Secrets Manager'
      },
      {
        name: 'AWS Secret Access Key',
        pattern: /aws[_-]?secret[_-]?access[_-]?key['":\s]*[A-Za-z0-9/+=]{40}/gi,
        severity: 'CRITICAL',
        type: 'aws-secret-key',
        description: 'AWS Secret Access Key detected',
        recommendation: 'Rotate immediately and use AWS Secrets Manager'
      },

      // GitHub Tokens
      {
        name: 'GitHub Personal Access Token',
        pattern: /ghp_[A-Za-z0-9]{36}/g,
        severity: 'CRITICAL',
        type: 'github-pat',
        description: 'GitHub Personal Access Token detected',
        recommendation: 'Revoke token immediately and regenerate'
      },
      {
        name: 'GitHub OAuth Token',
        pattern: /gho_[A-Za-z0-9]{36}/g,
        severity: 'CRITICAL',
        type: 'github-oauth',
        description: 'GitHub OAuth Token detected',
        recommendation: 'Revoke token and rotate credentials'
      },
      {
        name: 'GitHub App Token',
        pattern: /ghs_[A-Za-z0-9]{36}/g,
        severity: 'CRITICAL',
        type: 'github-app',
        description: 'GitHub App Token detected',
        recommendation: 'Revoke token immediately'
      },

      // Google API Keys
      {
        name: 'Google API Key',
        pattern: /AIza[0-9A-Za-z_\-]{35}/g,
        severity: 'HIGH',
        type: 'google-api-key',
        description: 'Google API Key detected',
        recommendation: 'Restrict and rotate the API key'
      },
      {
        name: 'Google OAuth',
        pattern: /[0-9]+-[A-Za-z0-9_]{32}\.apps\.googleusercontent\.com/g,
        severity: 'HIGH',
        type: 'google-oauth',
        description: 'Google OAuth Client ID detected',
        recommendation: 'Rotate OAuth credentials'
      },

      // Stripe
      {
        name: 'Stripe API Key',
        pattern: /(sk|pk)_(test|live)_[A-Za-z0-9]{24,99}/g,
        severity: 'CRITICAL',
        type: 'stripe-key',
        description: 'Stripe API Key detected',
        recommendation: 'Rotate key immediately via Stripe Dashboard'
      },

      // Slack
      {
        name: 'Slack Token',
        pattern: /xox[baprs]-[A-Za-z0-9\-]{10,}/g,
        severity: 'HIGH',
        type: 'slack-token',
        description: 'Slack Token detected',
        recommendation: 'Revoke and regenerate token'
      },
      {
        name: 'Slack Webhook',
        pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{24}/g,
        severity: 'MEDIUM',
        type: 'slack-webhook',
        description: 'Slack Webhook URL detected',
        recommendation: 'Regenerate webhook URL'
      },

      // JWT Tokens
      {
        name: 'JWT Token',
        pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
        severity: 'HIGH',
        type: 'jwt-token',
        description: 'JWT Token detected in source code',
        recommendation: 'Remove hardcoded JWT, use secure token storage'
      },

      // Private Keys
      {
        name: 'RSA Private Key',
        pattern: /-----BEGIN RSA PRIVATE KEY-----/g,
        severity: 'CRITICAL',
        type: 'rsa-private-key',
        description: 'RSA Private Key detected',
        recommendation: 'Remove immediately and regenerate key pair'
      },
      {
        name: 'SSH Private Key',
        pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/g,
        severity: 'CRITICAL',
        type: 'ssh-private-key',
        description: 'SSH Private Key detected',
        recommendation: 'Remove immediately and regenerate SSH keys'
      },
      {
        name: 'PGP Private Key',
        pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
        severity: 'CRITICAL',
        type: 'pgp-private-key',
        description: 'PGP Private Key detected',
        recommendation: 'Remove immediately and regenerate PGP keys'
      },

      // Database Connection Strings
      {
        name: 'Database Connection String',
        pattern: /(mysql|postgresql|mongodb|redis):\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi,
        severity: 'CRITICAL',
        type: 'database-connection',
        description: 'Database connection string with credentials',
        recommendation: 'Use environment variables or secret management'
      },

      // Generic Secrets
      {
        name: 'Generic API Key',
        pattern: /(api[_-]?key|apikey|api[_-]?secret)['":\s=]+[A-Za-z0-9_\-]{20,}/gi,
        severity: 'HIGH',
        type: 'generic-api-key',
        description: 'Generic API key detected',
        recommendation: 'Move to environment variables or secret manager'
      },
      {
        name: 'Generic Secret',
        pattern: /(secret|password|passwd|pwd|token)['":\s=]+[A-Za-z0-9_\-!@#$%^&*()+=]{12,}/gi,
        severity: 'HIGH',
        type: 'generic-secret',
        description: 'Potential secret or password in code',
        recommendation: 'Use environment variables or secure vault'
      },

      // OAuth
      {
        name: 'OAuth Client Secret',
        pattern: /(client[_-]?secret|consumer[_-]?secret)['":\s=]+[A-Za-z0-9_\-]{20,}/gi,
        severity: 'CRITICAL',
        type: 'oauth-secret',
        description: 'OAuth client secret detected',
        recommendation: 'Rotate OAuth credentials immediately'
      },

      // Twilio
      {
        name: 'Twilio API Key',
        pattern: /SK[A-Za-z0-9]{32}/g,
        severity: 'HIGH',
        type: 'twilio-key',
        description: 'Twilio API Key detected',
        recommendation: 'Rotate key via Twilio Console'
      },

      // SendGrid
      {
        name: 'SendGrid API Key',
        pattern: /SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}/g,
        severity: 'HIGH',
        type: 'sendgrid-key',
        description: 'SendGrid API Key detected',
        recommendation: 'Revoke and regenerate API key'
      },

      // Mailgun
      {
        name: 'Mailgun API Key',
        pattern: /key-[A-Za-z0-9]{32}/g,
        severity: 'HIGH',
        type: 'mailgun-key',
        description: 'Mailgun API Key detected',
        recommendation: 'Rotate API key'
      },

      // Azure
      {
        name: 'Azure Storage Key',
        pattern: /DefaultEndpointsProtocol=https?;[^'";\s]+/gi,
        severity: 'CRITICAL',
        type: 'azure-storage',
        description: 'Azure Storage connection string detected',
        recommendation: 'Use Azure Key Vault'
      },

      // Heroku
      {
        name: 'Heroku API Key',
        pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        severity: 'HIGH',
        type: 'heroku-key',
        description: 'Potential Heroku API key (UUID format)',
        recommendation: 'Verify and rotate if necessary'
      },

      // NPM Token
      {
        name: 'NPM Token',
        pattern: /npm_[A-Za-z0-9]{36}/g,
        severity: 'HIGH',
        type: 'npm-token',
        description: 'NPM access token detected',
        recommendation: 'Revoke token via npm website'
      },

      // PyPI Token
      {
        name: 'PyPI Token',
        pattern: /pypi-AgEIcHlwaS5vcmc[A-Za-z0-9\-_]{70,}/g,
        severity: 'HIGH',
        type: 'pypi-token',
        description: 'PyPI API token detected',
        recommendation: 'Revoke token'
      }
    ];
  }

  /**
   * Scan a file for secrets
   */
  async scanFile(filePath) {
    this.stats.filesScanned++;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const secrets = [];

      // Pattern-based detection
      for (const pattern of this.patterns) {
        const matches = this.findMatches(content, pattern, filePath);
        secrets.push(...matches);
      }

      // Entropy-based detection for additional secrets
      const entropySecrets = this.findHighEntropyStrings(content, filePath);
      secrets.push(...entropySecrets);

      // Filter false positives
      const filtered = secrets.filter(secret => !this.isFalsePositive(secret));
      this.stats.falsePositivesFiltered += secrets.length - filtered.length;

      // Update statistics
      filtered.forEach(secret => {
        this.stats.secretsFound++;
        const severity = secret.severity.toUpperCase();
        if (severity === 'CRITICAL') this.stats.critical++;
        else if (severity === 'HIGH') this.stats.high++;
        else if (severity === 'MEDIUM') this.stats.medium++;
      });

      return {
        filePath,
        secrets: filtered,
        count: filtered.length
      };

    } catch (error) {
      this.log(`Error scanning ${filePath}: ${error.message}`);
      return {
        filePath,
        secrets: [],
        count: 0,
        error: error.message
      };
    }
  }

  /**
   * Find pattern matches
   */
  findMatches(content, pattern, filePath) {
    const matches = [];
    const lines = content.split('\n');

    let match;
    while ((match = pattern.pattern.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      const line = lines[lineNumber - 1];

      matches.push({
        type: 'secret',
        name: pattern.name,
        secretType: pattern.type,
        severity: pattern.severity,
        description: pattern.description,
        recommendation: pattern.recommendation,
        filePath,
        line: lineNumber,
        column: match.index - content.lastIndexOf('\n', match.index),
        code: line.trim(),
        match: match[0],
        redacted: this.redact(match[0])
      });
    }

    return matches;
  }

  /**
   * Find high-entropy strings (potential secrets)
   */
  findHighEntropyStrings(content, filePath) {
    const secrets = [];
    const lines = content.split('\n');

    // Pattern for quoted strings and assignment values
    const stringPattern = /(['"`])([A-Za-z0-9_\-+/=]{20,})\1|=\s*([A-Za-z0-9_\-+/=]{20,})/g;

    let match;
    while ((match = stringPattern.exec(content)) !== null) {
      const value = match[2] || match[3];
      if (!value) continue;

      const entropy = this.calculateEntropy(value);

      if (entropy > this.minEntropy) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        const line = lines[lineNumber - 1];

        secrets.push({
          type: 'secret',
          name: 'High-Entropy String',
          secretType: 'high-entropy',
          severity: 'MEDIUM',
          description: `High-entropy string detected (entropy: ${entropy.toFixed(2)})`,
          recommendation: 'Verify if this is a secret and move to secure storage',
          filePath,
          line: lineNumber,
          column: match.index - content.lastIndexOf('\n', match.index),
          code: line.trim(),
          match: value,
          redacted: this.redact(value),
          entropy: entropy
        });
      }
    }

    return secrets;
  }

  /**
   * Calculate Shannon entropy
   */
  calculateEntropy(str) {
    const len = str.length;
    const frequencies = {};

    // Count character frequencies
    for (let i = 0; i < len; i++) {
      const char = str[i];
      frequencies[char] = (frequencies[char] || 0) + 1;
    }

    // Calculate entropy
    let entropy = 0;
    for (const freq of Object.values(frequencies)) {
      const p = freq / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  /**
   * Check if secret is a false positive
   */
  isFalsePositive(secret) {
    const value = secret.match;

    // Check whitelist patterns
    if (this.whitelist.some(pattern => pattern.test(value))) {
      return true;
    }

    // Too short for generic patterns
    if (value.length < 12 && secret.secretType === 'generic-secret') {
      return true;
    }

    // Check for common test/placeholder values
    const testPatterns = [
      'abcdefghijklmnopqrstuvwxyz',
      '0123456789',
      'xxxxxxxx',
      '********'
    ];

    if (testPatterns.some(pattern => value.toLowerCase().includes(pattern))) {
      return true;
    }

    return false;
  }

  /**
   * Redact secret for safe display
   */
  redact(secret) {
    if (secret.length <= 8) {
      return '*'.repeat(secret.length);
    }

    // Show first 4 and last 4 characters
    return secret.substring(0, 4) + '*'.repeat(secret.length - 8) + secret.substring(secret.length - 4);
  }

  /**
   * Scan multiple files
   */
  async scanFiles(filePaths) {
    const results = [];

    for (const filePath of filePaths) {
      const result = await this.scanFile(filePath);
      if (result.secrets.length > 0) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Scan directory
   */
  async scanDirectory(directory, options = {}) {
    const patterns = options.patterns || ['**/*'];
    const exclude = options.exclude || ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'];

    const files = this.findFiles(directory, patterns, exclude);
    return this.scanFiles(files);
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
            // Only scan text files
            if (this.isTextFile(fullPath)) {
              files.push(fullPath);
            }
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
   * Check if file is text
   */
  isTextFile(filePath) {
    const textExtensions = [
      '.js', '.ts', '.jsx', '.tsx', '.json', '.yml', '.yaml',
      '.env', '.conf', '.config', '.txt', '.md', '.py', '.java',
      '.go', '.rs', '.php', '.rb', '.cs', '.cpp', '.c', '.h',
      '.xml', '.html', '.css', '.scss', '.sass', '.sh', '.bat'
    ];

    const ext = path.extname(filePath).toLowerCase();
    return textExtensions.includes(ext) || path.basename(filePath).startsWith('.');
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
        filesWithSecrets: results.length,
        timestamp: new Date().toISOString()
      },
      secrets: []
    };

    // Group by severity and type
    const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [] };
    const byType = {};

    results.forEach(result => {
      result.secrets.forEach(secret => {
        bySeverity[secret.severity].push(secret);

        if (!byType[secret.secretType]) {
          byType[secret.secretType] = [];
        }
        byType[secret.secretType].push(secret);

        report.secrets.push(secret);
      });
    });

    report.bySeverity = bySeverity;
    report.byType = byType;

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
      console.log(`[SecretScanner] ${message}`);
    }
  }
}

module.exports = {
  SecretScanner
};

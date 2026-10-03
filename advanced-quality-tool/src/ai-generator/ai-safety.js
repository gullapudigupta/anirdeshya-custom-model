/**
 * AI Safety and Content Filtering (P11-T062)
 * 
 * SECURITY CRITICAL: Validates and secures AI-generated content
 * 
 * Features:
 * - Generated code validation (syntax, type checking)
 * - Security scanning of generated code
 * - Malicious pattern detection
 * - Prompt injection detection
 * - Content filtering
 * - Audit logging
 * 
 * @module ai-generator/ai-safety
 */

'use strict';

const crypto = require('crypto');

// Malicious code patterns to detect
const MALICIOUS_PATTERNS = [
  // Remote code execution
  /eval\s*\(/gi,
  /Function\s*\(/gi,
  /setTimeout\s*\(\s*["'`]/gi,
  /setInterval\s*\(\s*["'`]/gi,
  
  // File system manipulation (suspicious patterns)
  /fs\.unlink.*\.\.\//gi,
  /fs\.rmdir.*\.\.\//gi,
  /rm\s+-rf\s+\//gi,
  /del\s+\/[sf]\s+/gi,
  
  // Network exfiltration
  /fetch\s*\(\s*["'`]https?:\/\/(?!localhost|127\.0\.0\.1)/gi,
  /XMLHttpRequest.*open.*https?:\/\/(?!localhost|127\.0\.0\.1)/gi,
  /child_process\.exec.*curl/gi,
  /child_process\.exec.*wget/gi,
  
  // SQL injection patterns
  /\$\{.*\}.*SELECT.*FROM/gi,
  /\+\s*["'`]SELECT.*FROM/gi,
  /`SELECT.*FROM.*\$\{/gi,
  
  // Command injection
  /exec\s*\([^)]*\$\{/gi,
  /spawn\s*\([^)]*\$\{/gi,
  /system\s*\([^)]*\$\{/gi,
  
  // Crypto mining
  /coinhive/gi,
  /cryptonight/gi,
  /minergate/gi,
  
  // Obfuscation indicators
  /\\x[0-9a-f]{2}/gi, // Hex encoding
  /String\.fromCharCode/gi,
  /atob\s*\(/gi, // Base64 decoding
  
  // Environment variable leaking
  /process\.env\s*\[/gi
];

// Prompt injection patterns
const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|prior)\s+instructions/gi,
  /disregard\s+.*instructions/gi,
  /forget\s+.*instructions/gi,
  /new\s+instructions:/gi,
  /system\s+message:/gi,
  /you\s+are\s+now/gi,
  /act\s+as\s+(if|though)/gi,
  /pretend\s+(to\s+be|you\s+are)/gi,
  /roleplay\s+as/gi,
  /###\s+new\s+role/gi
];

// Sensitive data patterns to redact
const SENSITIVE_PATTERNS = [
  {
    name: 'API Key',
    pattern: /\b(api[_-]?key|apikey)\s*[=:]\s*["']?([a-zA-Z0-9_-]{20,})["']?/gi,
    replacement: (match, key, value) => `${key}=***REDACTED***`
  },
  {
    name: 'Password',
    pattern: /\b(password|passwd|pwd)\s*[=:]\s*["']?([^"'\s]+)["']?/gi,
    replacement: (match, key, value) => `${key}=***REDACTED***`
  },
  {
    name: 'Token',
    pattern: /\b(token|bearer)\s*[=:]\s*["']?([a-zA-Z0-9_-]{20,})["']?/gi,
    replacement: (match, key, value) => `${key}=***REDACTED***`
  },
  {
    name: 'Private Key',
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]+?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/gi,
    replacement: () => '-----BEGIN PRIVATE KEY-----\n***REDACTED***\n-----END PRIVATE KEY-----'
  },
  {
    name: 'AWS Key',
    pattern: /AKIA[0-9A-Z]{16}/gi,
    replacement: () => 'AKIA***REDACTED***'
  },
  {
    name: 'Connection String',
    pattern: /(mongodb|mysql|postgresql|sqlserver):\/\/[^:]+:[^@]+@/gi,
    replacement: (match) => match.split(':')[0] + '://***REDACTED***:***REDACTED***@'
  }
];

class AISafetyValidator {
  constructor(config = {}) {
    this.config = {
      strictMode: config.strictMode !== false, // Strict by default
      allowEval: config.allowEval === true, // Block eval by default
      allowNetworkCalls: config.allowNetworkCalls === true, // Block network by default
      maxCodeLength: config.maxCodeLength || 50000, // 50KB max
      enableAuditLog: config.enableAuditLog !== false,
      auditLogPath: config.auditLogPath || '.aqt-reports/ai-audit.jsonl',
      ...config
    };

    this.auditLog = [];
  }

  /**
   * Validate generated code
   * @param {string} code - Generated code to validate
   * @param {object} context - Context about the generation
   * @returns {object} Validation result
   */
  async validateGeneratedCode(code, context = {}) {
    const validationId = this.generateValidationId();
    const startTime = Date.now();

    const result = {
      validationId,
      timestamp: new Date().toISOString(),
      passed: true,
      issues: [],
      warnings: [],
      metadata: {
        codeLength: code.length,
        context
      }
    };

    try {
      // 1. Length check
      if (code.length > this.config.maxCodeLength) {
        result.passed = false;
        result.issues.push({
          severity: 'error',
          category: 'size',
          message: `Generated code exceeds maximum length (${code.length} > ${this.config.maxCodeLength})`
        });
      }

      // 2. Malicious pattern detection
      const maliciousFindings = this.detectMaliciousPatterns(code);
      if (maliciousFindings.length > 0) {
        result.passed = false;
        result.issues.push(...maliciousFindings);
      }

      // 3. Syntax validation (basic check)
      const syntaxCheck = this.validateSyntax(code, context.language || 'javascript');
      if (!syntaxCheck.valid) {
        result.passed = false;
        result.issues.push({
          severity: 'error',
          category: 'syntax',
          message: syntaxCheck.error
        });
      }

      // 4. Security-sensitive API usage
      const securityWarnings = this.checkSecurityAPIs(code);
      if (securityWarnings.length > 0) {
        result.warnings.push(...securityWarnings);
        
        if (this.config.strictMode) {
          result.passed = false;
          result.issues.push(...securityWarnings.map(w => ({ ...w, severity: 'error' })));
        }
      }

      // 5. Detect hardcoded secrets
      const secretFindings = this.detectSecrets(code);
      if (secretFindings.length > 0) {
        result.passed = false;
        result.issues.push(...secretFindings);
      }

      // 6. Type safety check (if TypeScript)
      if (context.language === 'typescript' && this.config.strictMode) {
        const typeCheck = await this.validateTypeScript(code);
        if (!typeCheck.valid) {
          result.warnings.push({
            severity: 'warning',
            category: 'types',
            message: 'TypeScript validation failed',
            details: typeCheck.errors
          });
        }
      }

      result.metadata.validationDuration = Date.now() - startTime;

      // Audit log
      if (this.config.enableAuditLog) {
        await this.logValidation(result);
      }

      return result;
    } catch (error) {
      result.passed = false;
      result.issues.push({
        severity: 'error',
        category: 'validation-error',
        message: `Validation failed: ${error.message}`
      });
      return result;
    }
  }

  /**
   * Validate prompts for injection attempts
   * @param {string} prompt - User prompt to validate
   * @returns {object} Validation result
   */
  validatePrompt(prompt) {
    const result = {
      safe: true,
      issues: [],
      sanitized: prompt
    };

    // Check for injection patterns
    for (const pattern of INJECTION_PATTERNS) {
      const matches = prompt.match(pattern);
      if (matches) {
        result.safe = false;
        result.issues.push({
          severity: 'critical',
          category: 'prompt-injection',
          message: `Potential prompt injection detected: "${matches[0].substring(0, 50)}..."`,
          pattern: pattern.source
        });
      }
    }

    // Redact sensitive data from prompts
    result.sanitized = this.redactSensitiveData(prompt);

    // Check for excessive length (potential DoS)
    if (prompt.length > 10000) {
      result.issues.push({
        severity: 'warning',
        category: 'prompt-length',
        message: `Prompt exceeds recommended length (${prompt.length} chars)`
      });
    }

    return result;
  }

  /**
   * Detect malicious patterns in code
   */
  detectMaliciousPatterns(code) {
    const findings = [];

    for (const pattern of MALICIOUS_PATTERNS) {
      const matches = code.match(pattern);
      if (matches) {
        findings.push({
          severity: 'critical',
          category: 'malicious-code',
          message: `Potentially malicious pattern detected: "${matches[0].substring(0, 50)}..."`,
          pattern: pattern.source,
          occurrences: matches.length
        });
      }
    }

    return findings;
  }

  /**
   * Validate code syntax
   */
  validateSyntax(code, language) {
    try {
      if (language === 'javascript' || language === 'typescript') {
        // Basic JS/TS syntax check using try-catch
        // In production, use a proper parser like @babel/parser or typescript
        new Function(code); // Will throw SyntaxError if invalid
      } else if (language === 'python') {
        // For Python, would need python-ast or similar
        // For now, just basic checks
        if (code.includes('\t') && code.includes('    ')) {
          return {
            valid: false,
            error: 'Mixed tabs and spaces in Python code'
          };
        }
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Check for security-sensitive API usage
   */
  checkSecurityAPIs(code) {
    const warnings = [];

    // File system access
    if (code.match(/fs\.(readFile|writeFile|unlink|rmdir)/)) {
      warnings.push({
        severity: 'warning',
        category: 'filesystem',
        message: 'Code uses file system APIs - ensure proper path validation'
      });
    }

    // Network access
    if (code.match(/(fetch|axios|http\.request|https\.request)/)) {
      warnings.push({
        severity: 'warning',
        category: 'network',
        message: 'Code makes network requests - validate URLs and handle errors'
      });
    }

    // Process execution
    if (code.match(/child_process\.(exec|spawn|fork)/)) {
      warnings.push({
        severity: 'high',
        category: 'process-execution',
        message: 'Code executes child processes - ensure input validation'
      });
    }

    // Database access
    if (code.match(/(SELECT|INSERT|UPDATE|DELETE|DROP).*FROM/i)) {
      warnings.push({
        severity: 'high',
        category: 'database',
        message: 'Code contains SQL - ensure parameterized queries'
      });
    }

    return warnings;
  }

  /**
   * Detect hardcoded secrets
   */
  detectSecrets(code) {
    const findings = [];

    for (const { name, pattern } of SENSITIVE_PATTERNS) {
      const matches = [...code.matchAll(pattern)];
      if (matches.length > 0) {
        findings.push({
          severity: 'critical',
          category: 'hardcoded-secret',
          message: `Hardcoded ${name} detected`,
          occurrences: matches.length
        });
      }
    }

    return findings;
  }

  /**
   * Redact sensitive data from text
   */
  redactSensitiveData(text) {
    let redacted = text;

    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
      redacted = redacted.replace(pattern, replacement);
    }

    return redacted;
  }

  /**
   * Validate TypeScript code (if TypeScript is available)
   */
  async validateTypeScript(code) {
    // This would require TypeScript compiler API
    // For now, return a placeholder
    return {
      valid: true,
      errors: []
    };
  }

  /**
   * Sanitize generated code (remove dangerous patterns)
   */
  sanitizeCode(code) {
    let sanitized = code;

    // Remove eval() calls
    if (!this.config.allowEval) {
      sanitized = sanitized.replace(/eval\s*\([^)]*\)/gi, '/* eval() removed for security */');
    }

    // Remove Function() constructor
    sanitized = sanitized.replace(/new\s+Function\s*\([^)]*\)/gi, '/* Function() removed for security */');

    // Redact secrets
    sanitized = this.redactSensitiveData(sanitized);

    return sanitized;
  }

  /**
   * Generate unique validation ID
   */
  generateValidationId() {
    return `val-${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Log validation for audit trail
   */
  async logValidation(result) {
    const logEntry = {
      timestamp: result.timestamp,
      validationId: result.validationId,
      passed: result.passed,
      issueCount: result.issues.length,
      warningCount: result.warnings.length,
      codeLength: result.metadata.codeLength,
      context: result.metadata.context
    };

    this.auditLog.push(logEntry);

    // In production, write to file
    // await fs.appendFile(this.config.auditLogPath, JSON.stringify(logEntry) + '\n');
  }

  /**
   * Get audit log
   */
  getAuditLog() {
    return this.auditLog;
  }

  /**
   * Export audit log
   */
  async exportAuditLog(outputPath) {
    const fs = require('fs').promises;
    await fs.writeFile(
      outputPath,
      this.auditLog.map(entry => JSON.stringify(entry)).join('\n'),
      'utf8'
    );
  }
}

/**
 * Content Filter for AI inputs/outputs
 */
class AIContentFilter {
  constructor() {
    this.blockedPatterns = [
      /hack/gi,
      /crack/gi,
      /exploit/gi,
      /malware/gi,
      /virus/gi,
      /backdoor/gi,
      /ransomware/gi
    ];
  }

  /**
   * Filter potentially harmful content
   */
  filter(content, context = {}) {
    const result = {
      safe: true,
      filtered: content,
      flags: []
    };

    // Check for harmful keywords in non-security contexts
    if (context.type !== 'security-scanning') {
      for (const pattern of this.blockedPatterns) {
        if (pattern.test(content)) {
          result.flags.push({
            severity: 'warning',
            message: `Content contains potentially harmful keyword: ${pattern.source}`,
            context: 'Review for legitimate security research vs malicious intent'
          });
        }
      }
    }

    return result;
  }
}

module.exports = {
  AISafetyValidator,
  AIContentFilter,
  MALICIOUS_PATTERNS,
  INJECTION_PATTERNS,
  SENSITIVE_PATTERNS
};

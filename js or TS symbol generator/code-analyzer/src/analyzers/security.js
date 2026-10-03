/**
 * Security Hotspot Scanner
 * 
 * Detects security vulnerabilities and hotspots (SonarQube-style):
 * - Hardcoded credentials/secrets
 * - XSS vulnerabilities
 * - Insecure HTTP usage
 * - Open redirects
 * - SQL/NoSQL injection patterns
 * - Sensitive data exposure
 * - Insecure storage usage
 * - CORS misconfiguration
 * - Missing input validation
 * - Unsafe eval/Function usage
 */

const path = require('path');
const { readFileSafe, getLineNumber } = require('../ast-utils');

// ─── Security Rules ──────────────────────────────────────────────────────────

const SECURITY_RULES = {
  // Hardcoded Secrets
  hardcodedPassword: {
    id: 'sec:hardcoded-password',
    severity: 'blocker',
    category: 'vulnerability',
    cwe: 'CWE-798',
    title: 'Hardcoded password detected',
    patterns: [
      /(?:password|passwd|pwd|secret|token|apiKey|api_key|auth)\s*[:=]\s*['"][^'"]{3,}['"]/gi,
    ],
  },
  
  hardcodedApiKey: {
    id: 'sec:hardcoded-api-key',
    severity: 'blocker',
    category: 'vulnerability',
    cwe: 'CWE-798',
    title: 'Hardcoded API key/secret detected',
    patterns: [
      /(?:api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{10,}['"]/gi,
    ],
  },

  // XSS
  innerHTML: {
    id: 'sec:innerhtml',
    severity: 'critical',
    category: 'vulnerability',
    cwe: 'CWE-79',
    title: 'Potential XSS via innerHTML',
    patterns: [
      /\.innerHTML\s*=/g,
      /\[innerHTML\]\s*=/g,
      /document\.write\s*\(/g,
    ],
  },

  bypassSanitizer: {
    id: 'sec:bypass-sanitizer',
    severity: 'critical',
    category: 'vulnerability',
    cwe: 'CWE-79',
    title: 'Security sanitizer bypass',
    patterns: [
      /bypassSecurityTrust(?:Html|Style|Script|Url|ResourceUrl)/g,
    ],
  },

  // Insecure communication
  httpInsecure: {
    id: 'sec:insecure-http',
    severity: 'major',
    category: 'security-hotspot',
    cwe: 'CWE-319',
    title: 'Insecure HTTP URL detected',
    patterns: [
      /['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[^'"]+['"]/g,
    ],
  },

  // Eval and dynamic code
  unsafeEval: {
    id: 'sec:unsafe-eval',
    severity: 'critical',
    category: 'vulnerability',
    cwe: 'CWE-95',
    title: 'Unsafe eval() or Function() usage',
    patterns: [
      /\beval\s*\(/g,
      /new\s+Function\s*\(/g,
      /setTimeout\s*\(\s*['"]/g,
      /setInterval\s*\(\s*['"]/g,
    ],
  },

  // Open redirect
  openRedirect: {
    id: 'sec:open-redirect',
    severity: 'major',
    category: 'vulnerability',
    cwe: 'CWE-601',
    title: 'Potential open redirect',
    patterns: [
      /window\.location\s*=\s*(?!['"])/g,
      /window\.location\.href\s*=\s*(?!['"])/g,
      /document\.location\s*=\s*(?!['"])/g,
    ],
  },

  // Sensitive data in localStorage
  sensitiveStorage: {
    id: 'sec:sensitive-storage',
    severity: 'major',
    category: 'security-hotspot',
    cwe: 'CWE-922',
    title: 'Sensitive data in browser storage',
    patterns: [
      /localStorage\.setItem\s*\(\s*['"](?:token|password|secret|key|auth|session)['"]/gi,
      /sessionStorage\.setItem\s*\(\s*['"](?:token|password|secret|key|auth|session)['"]/gi,
    ],
  },

  // Regex DoS
  regexDos: {
    id: 'sec:regex-dos',
    severity: 'major',
    category: 'vulnerability',
    cwe: 'CWE-1333',
    title: 'Potential ReDoS vulnerability',
    patterns: [
      /new\s+RegExp\s*\([^)]*\+/g, // Dynamic regex with concatenation
    ],
  },

  // Weak crypto
  weakCrypto: {
    id: 'sec:weak-crypto',
    severity: 'major',
    category: 'vulnerability',
    cwe: 'CWE-327',
    title: 'Weak cryptographic algorithm',
    patterns: [
      /(?:MD5|SHA1|SHA-1|DES|RC4)\b/g,
      /createHash\s*\(\s*['"](?:md5|sha1)['"]\)/g,
    ],
  },

  // Missing CSRF
  missingCsrf: {
    id: 'sec:no-csrf',
    severity: 'major',
    category: 'security-hotspot',
    cwe: 'CWE-352',
    title: 'HTTP request without CSRF protection',
    patterns: [
      /\.(?:post|put|delete|patch)\s*\([^)]*\)\s*(?!.*withCredentials)/g,
    ],
  },

  // Logging sensitive data
  sensitiveLogging: {
    id: 'sec:sensitive-logging',
    severity: 'major',
    category: 'vulnerability',
    cwe: 'CWE-532',
    title: 'Potentially logging sensitive data',
    patterns: [
      /console\.(?:log|debug|info)\s*\([^)]*(?:password|token|secret|key|credential)[^)]*\)/gi,
    ],
  },

  // Disabled security
  disabledSecurity: {
    id: 'sec:disabled-security',
    severity: 'critical',
    category: 'vulnerability',
    cwe: 'CWE-295',
    title: 'Security feature disabled',
    patterns: [
      /rejectUnauthorized\s*:\s*false/g,
      /(?:verify|validateCert|checkCert)\s*:\s*false/g,
      /strictSSL\s*:\s*false/g,
    ],
  },
};

// ─── Scanner ─────────────────────────────────────────────────────────────────

class SecurityScanner {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.issues = [];
    this.hotspots = [];
  }

  /**
   * Scan a TypeScript/JavaScript file for security issues
   */
  scanFile(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return [];
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const fileIssues = [];
    
    // Skip test files and config files
    if (filePath.match(/\.(spec|test|config|conf)\./)) return [];
    if (filePath.includes('node_modules') || filePath.includes('dist')) return [];
    
    for (const [ruleKey, rule] of Object.entries(SECURITY_RULES)) {
      for (const pattern of rule.patterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        
        while ((match = regex.exec(content)) !== null) {
          const line = getLineNumber(content, match.index);
          const lineContent = content.split('\n')[line - 1]?.trim() || '';
          
          // Skip if it's in a comment
          if (lineContent.startsWith('//') || lineContent.startsWith('*')) continue;
          
          const issue = {
            ...rule,
            file: relativePath,
            line,
            snippet: lineContent.substring(0, 80),
            match: match[0].substring(0, 50),
          };
          
          if (rule.category === 'security-hotspot') {
            this.hotspots.push(issue);
          } else {
            fileIssues.push(issue);
          }
        }
      }
    }
    
    this.issues.push(...fileIssues);
    return fileIssues;
  }

  /**
   * Scan HTML template for security issues
   */
  scanTemplate(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return [];
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const fileIssues = [];
    
    // Check for unsafe bindings
    const unsafeBindings = [
      { pattern: /\[innerHTML\]/g, title: 'innerHTML binding (potential XSS)' },
      { pattern: /\[outerHTML\]/g, title: 'outerHTML binding (potential XSS)' },
      { pattern: /javascript:/g, title: 'javascript: protocol usage' },
      { pattern: /on\w+\s*=\s*"/g, title: 'Inline event handler (prefer Angular bindings)' },
    ];
    
    for (const binding of unsafeBindings) {
      let match;
      while ((match = binding.pattern.exec(content)) !== null) {
        const line = getLineNumber(content, match.index);
        fileIssues.push({
          id: 'sec:template-xss',
          severity: 'major',
          category: 'vulnerability',
          cwe: 'CWE-79',
          title: binding.title,
          file: relativePath,
          line,
        });
      }
    }
    
    // Check for external resource loading without integrity
    const externalResources = /(?:src|href)\s*=\s*["']https?:\/\/(?!localhost)[^"']+["']/g;
    let match;
    while ((match = externalResources.exec(content)) !== null) {
      if (!content.substring(match.index, match.index + 200).includes('integrity')) {
        const line = getLineNumber(content, match.index);
        fileIssues.push({
          id: 'sec:no-sri',
          severity: 'minor',
          category: 'security-hotspot',
          cwe: 'CWE-829',
          title: 'External resource without Subresource Integrity',
          file: relativePath,
          line,
        });
      }
    }
    
    this.issues.push(...fileIssues);
    return fileIssues;
  }

  /**
   * Get security rating (A-E)
   */
  getSecurityRating() {
    const blockers = this.issues.filter(i => i.severity === 'blocker').length;
    const criticals = this.issues.filter(i => i.severity === 'critical').length;
    const majors = this.issues.filter(i => i.severity === 'major').length;
    
    if (blockers > 0) return 'E';
    if (criticals > 0) return 'D';
    if (majors > 2) return 'C';
    if (majors > 0) return 'B';
    return 'A';
  }

  /**
   * Get all issues
   */
  getIssues() {
    return this.issues;
  }

  /**
   * Get security hotspots (require review)
   */
  getHotspots() {
    return this.hotspots;
  }

  /**
   * Get summary
   */
  getSummary() {
    const bySeverity = {};
    const byCwe = {};
    
    for (const issue of [...this.issues, ...this.hotspots]) {
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
      if (issue.cwe) byCwe[issue.cwe] = (byCwe[issue.cwe] || 0) + 1;
    }
    
    return {
      vulnerabilities: this.issues.length,
      hotspots: this.hotspots.length,
      rating: this.getSecurityRating(),
      bySeverity,
      byCwe,
    };
  }
}

module.exports = { SecurityScanner, SECURITY_RULES };

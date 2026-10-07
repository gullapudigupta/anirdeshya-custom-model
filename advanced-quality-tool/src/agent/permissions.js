/**
 * Execution Permissions and Workspace Safety (P9-T014)
 *
 * Approval modes, path validation, secret redaction, and security constraints
 * for safe agent execution.
 *
 * @module agent/permissions
 */

'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Approval modes
 */
const ApprovalMode = {
  READ_ONLY: 'read-only',              // No writes allowed
  APPROVAL_REQUIRED: 'approval-required', // Require approval for writes
  TRUSTED: 'trusted'                    // Full access
};

/**
 * Operation risk levels
 */
const RiskLevel = {
  SAFE: 'safe',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * Permission Manager
 */
class PermissionManager {
  constructor(options = {}) {
    const workspacePath = path.resolve(options.workspace || process.cwd());
    this.workspace = fs.existsSync(workspacePath) ? fs.realpathSync(workspacePath) : workspacePath;
    this.mode = options.mode || ApprovalMode.APPROVAL_REQUIRED;
    
    // Policy configuration
    this.policy = {
      allowTerminal: options.allowTerminal !== false,
      allowFileWrites: options.allowFileWrites !== false,
      allowDeletes: options.allowDeletes === true, // Default: false
      allowExternalNetwork: options.allowExternalNetwork === true, // Default: false
      maxFileSize: options.maxFileSize || 1024 * 1024, // 1MB
      protectedPaths: options.protectedPaths || [
        '.git',
        'node_modules',
        '.env',
        '.env.local',
        'secrets',
        'credentials'
      ],
      dangerousCommands: options.dangerousCommands || [
        'rm -rf',
        'rmdir /s',
        'format',
        'del /f',
        'DROP TABLE',
        'DROP DATABASE'
      ]
    };
    
    // Approval callback
    this.requestApproval = options.requestApproval || null;
    
    // Secret patterns
    this.secretPatterns = [
      /api[_-]?key\s*[:=]\s*['"]?([a-zA-Z0-9_-]+)['"]?/gi,
      /password\s*[:=]\s*['"]?([^'"\s]+)['"]?/gi,
      /secret\s*[:=]\s*['"]?([a-zA-Z0-9_-]+)['"]?/gi,
      /token\s*[:=]\s*['"]?([a-zA-Z0-9._-]+)['"]?/gi,
      /Bearer\s+([a-zA-Z0-9._-]+)/gi,
      /ssh-rsa\s+[A-Za-z0-9+/=]+/g,
      /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g
    ];
  }

  /**
   * Check if an operation is allowed
   * @param {Object} operation
   * @returns {Promise<Object>} { allowed: boolean, requiresApproval: boolean, reason: string }
   */
  async checkPermission(operation) {
    const { type, params = {} } = operation;
    
    // Assess risk level
    const risk = this._assessRisk(operation);
    
    // Check policy
    const policyCheck = this._checkPolicy(operation);
    if (!policyCheck.allowed) {
      return {
        allowed: false,
        requiresApproval: false,
        risk: risk.level,
        reason: policyCheck.reason
      };
    }
    
    // Determine if approval is needed
    const requiresApproval = this._requiresApproval(operation, risk);
    
    if (requiresApproval && this.mode === ApprovalMode.APPROVAL_REQUIRED) {
      // Request approval
      const approved = await this._requestUserApproval(operation, risk);
      return {
        allowed: approved,
        requiresApproval: true,
        risk: risk.level,
        reason: approved ? null : 'User denied approval'
      };
    }
    
    return {
      allowed: true,
      requiresApproval: false,
      risk: risk.level,
      reason: null
    };
  }

  /**
   * Validate a file path is within workspace
   * @param {string} filePath
   * @returns {Object} { valid: boolean, reason: string }
   */
  validatePath(filePath) {
    try {
      const normalized = path.normalize(filePath);
      const absolutePath = path.resolve(this.workspace, normalized);
      const relativePath = path.relative(this.workspace, absolutePath);
      if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        return {
          valid: false,
          reason: 'Path is outside workspace boundaries'
        };
      }
      
      // Check for symlink escape attempts
      if (fs.existsSync(absolutePath)) {
        const realPath = fs.realpathSync(absolutePath);
        const realRelative = path.relative(this.workspace, realPath);
        if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
          return {
            valid: false,
            reason: 'Path resolves to location outside workspace (symlink escape attempt)'
          };
        }
      }
      
      // Check protected paths
      const relativeParts = relativePath.split(path.sep);
      for (const protectedPath of this.policy.protectedPaths) {
        if (relativeParts.includes(protectedPath)) {
          return {
            valid: false,
            reason: `Path '${protectedPath}' is protected and cannot be accessed`
          };
        }
      }
      
      return { valid: true, reason: null };
    } catch (error) {
      return {
        valid: false,
        reason: `Path validation error: ${error.message}`
      };
    }
  }

  /**
   * Redact secrets from text
   * @param {string} text
   * @returns {string}
   */
  redactSecrets(text) {
    if (!text || typeof text !== 'string') return text;
    
    let redacted = text;
    
    for (const pattern of this.secretPatterns) {
      redacted = redacted.replace(pattern, (match) => {
        // Keep the key name visible, redact the value
        const parts = match.split(/[:=]/);
        if (parts.length > 1) {
          return `${parts[0]}=[REDACTED]`;
        }
        return '[REDACTED]';
      });
    }
    
    return redacted;
  }

  /**
   * Check if a string contains secrets
   * @param {string} text
   * @returns {boolean}
   */
  containsSecrets(text) {
    if (!text || typeof text !== 'string') return false;
    
    for (const pattern of this.secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Scan a file for secrets
   * @param {string} filePath
   * @returns {Object} { hasSecrets: boolean, matches: Array }
   */
  scanFileForSecrets(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const matches = [];
      
      const lines = content.split('\n');
      lines.forEach((line, lineNum) => {
        for (const pattern of this.secretPatterns) {
          const match = pattern.exec(line);
          if (match) {
            matches.push({
              line: lineNum + 1,
              pattern: pattern.source,
              context: line.substring(0, 100) // Show context without full secret
            });
          }
        }
      });
      
      return {
        hasSecrets: matches.length > 0,
        matches
      };
    } catch (error) {
      return {
        hasSecrets: false,
        matches: [],
        error: error.message
      };
    }
  }

  /**
   * Set approval mode
   * @param {string} mode
   */
  setMode(mode) {
    if (!Object.values(ApprovalMode).includes(mode)) {
      throw new Error(`Invalid approval mode: ${mode}`);
    }
    this.mode = mode;
  }

  // ─── Private methods ──────────────────────────────────────────────────────────

  _assessRisk(operation) {
    const { type, params = {} } = operation;
    let level = RiskLevel.SAFE;
    const factors = [];
    
    // Terminal commands
    if (type === 'execute_command') {
      level = RiskLevel.MEDIUM;
      factors.push('Terminal command execution');
      
      const command = params.command || '';
      for (const dangerous of this.policy.dangerousCommands) {
        if (command.includes(dangerous)) {
          level = RiskLevel.CRITICAL;
          factors.push(`Dangerous command pattern: ${dangerous}`);
        }
      }
      
      if (command.includes('sudo') || command.includes('su ')) {
        level = RiskLevel.HIGH;
        factors.push('Elevated privileges');
      }
    }
    
    // File operations
    if (type === 'write_file' || type === 'delete_file') {
      level = RiskLevel.LOW;
      factors.push('File modification');
      
      if (params.path) {
        for (const protectedPath of this.policy.protectedPaths) {
          if (params.path.includes(protectedPath)) {
            level = RiskLevel.HIGH;
            factors.push(`Protected path: ${protectedPath}`);
          }
        }
      }
    }
    
    if (type === 'delete_file' || type === 'delete_directory') {
      level = RiskLevel.MEDIUM;
      factors.push('Destructive operation');
    }
    
    // Network operations
    if (type === 'http_request' || type === 'fetch_url') {
      level = RiskLevel.LOW;
      factors.push('External network access');
      
      if (!this.policy.allowExternalNetwork) {
        level = RiskLevel.HIGH;
        factors.push('External network disabled by policy');
      }
    }
    
    // Cloud provider access
    if (type === 'call_model' && params.provider === 'cloud') {
      level = RiskLevel.LOW;
      factors.push('Cloud provider access (sends workspace context)');
    }
    
    return { level, factors };
  }

  _checkPolicy(operation) {
    const { type, params = {} } = operation;
    
    // Read-only mode
    if (this.mode === ApprovalMode.READ_ONLY) {
      const writingOps = ['write_file', 'delete_file', 'execute_command', 'delete_directory'];
      if (writingOps.includes(type)) {
        return {
          allowed: false,
          reason: 'Operation not allowed in read-only mode'
        };
      }
    }
    
    // Terminal policy
    if (type === 'execute_command' && !this.policy.allowTerminal) {
      return {
        allowed: false,
        reason: 'Terminal commands are disabled by policy'
      };
    }
    
    // File write policy
    if ((type === 'write_file' || type === 'create_file') && !this.policy.allowFileWrites) {
      return {
        allowed: false,
        reason: 'File writes are disabled by policy'
      };
    }
    
    // Delete policy
    if ((type === 'delete_file' || type === 'delete_directory') && !this.policy.allowDeletes) {
      return {
        allowed: false,
        reason: 'Delete operations are disabled by policy'
      };
    }
    
    // Network policy
    if ((type === 'http_request' || type === 'fetch_url') && !this.policy.allowExternalNetwork) {
      return {
        allowed: false,
        reason: 'External network access is disabled by policy'
      };
    }
    
    // File size limits
    if (type === 'write_file' && params.content) {
      const size = Buffer.byteLength(params.content, 'utf8');
      if (size > this.policy.maxFileSize) {
        return {
          allowed: false,
          reason: `File size ${size} bytes exceeds limit of ${this.policy.maxFileSize} bytes`
        };
      }
    }
    
    return { allowed: true, reason: null };
  }

  _requiresApproval(operation, risk) {
    // Always require approval for high and critical risk
    if (risk.level === RiskLevel.HIGH || risk.level === RiskLevel.CRITICAL) {
      return true;
    }
    
    // Require approval for delete operations
    if (operation.type === 'delete_file' || operation.type === 'delete_directory') {
      return true;
    }
    
    // Require approval for terminal commands
    if (operation.type === 'execute_command') {
      return true;
    }
    
    return false;
  }

  async _requestUserApproval(operation, risk) {
    if (typeof this.requestApproval === 'function') {
      try {
        return await this.requestApproval({
          operation,
          risk,
          workspace: this.workspace
        });
      } catch (error) {
        // Deny on callback error
        return false;
      }
    }
    
    // No approval handler = deny
    return false;
  }
}

module.exports = {
  PermissionManager,
  ApprovalMode,
  RiskLevel
};

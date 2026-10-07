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
      maxFilesPerTask: options.maxFilesPerTask || 50,
      broadScopeFileThreshold: options.broadScopeFileThreshold || 10,
      requireApprovalForHighRisk: options.requireApprovalForHighRisk !== false,
      requireApprovalForDestructiveEdits: options.requireApprovalForDestructiveEdits !== false,
      requireApprovalForDependencyChanges: options.requireApprovalForDependencyChanges !== false,
      highRiskActions: options.highRiskActions || [],
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
    this.auditLog = [];

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
  async checkPermission(operation, options = {}) {
    const { type, params = {} } = operation;

    // Assess risk level
    const risk = this._assessRisk(operation);

    // Check policy
    const policyCheck = this._checkPolicy(operation);
    if (!policyCheck.allowed) {
      const decision = {
        allowed: false,
        requiresApproval: false,
        risk: risk.level,
        reason: policyCheck.reason
      };
      this._recordDecision(operation, decision);
      return decision;
    }

    // Determine if approval is needed
    const requiresApproval = this._requiresApproval(operation, risk);

    if (requiresApproval && this.mode === ApprovalMode.APPROVAL_REQUIRED && !options.deferApproval) {
      // Request approval
      let approved;
      try {
        approved = await this._requestUserApproval(operation, risk);
      } catch (error) {
        const decision = {
          allowed: false,
          requiresApproval: true,
          risk: risk.level,
          reason: `Approval request failed: ${error.message}`
        };
        this._recordDecision(operation, decision);
        return decision;
      }
      const decision = {
        allowed: approved,
        requiresApproval: true,
        risk: risk.level,
        reason: approved ? null : 'User denied approval'
      };
      this._recordDecision(operation, decision);
      return decision;
    }

    const decision = {
      allowed: true,
      requiresApproval: requiresApproval && this.mode === ApprovalMode.APPROVAL_REQUIRED,
      risk: risk.level,
      reason: null
    };
    this._recordDecision(operation, decision);
    return decision;
  }

  recordApproval(operation, approval) {
    this._recordDecision(operation, {
      allowed: approval.approved === true,
      requiresApproval: true,
      risk: approval.risk || this._assessRisk(operation).level,
      reason: approval.reason || null,
      approval: {
        planDigest: approval.planDigest || null,
        actionDigest: approval.actionDigest || null,
        outcome: approval.outcome || (approval.approved ? 'approved' : 'denied')
      }
    });
  }

  _recordDecision(operation, decision) {
    const entry = {
      timestamp: new Date().toISOString(),
      type: operation.type,
      path: operation.params && operation.params.path ? operation.params.path : null,
      digest: operation.digest || null,
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      risk: decision.risk,
      reason: decision.reason || null,
      approval: decision.approval || null
    };
    this.auditLog.push(entry);
    return entry;
  }

  getAuditLog(limit = this.auditLog.length) {
    return this.auditLog.slice(-limit);
  }

  /**
   * Validate a file path is within workspace
   * @param {string} filePath
   * @returns {Object} { valid: boolean, reason: string }
   */
  validatePath(filePath) {
    try {
      const normalized = path.normalize(filePath);
      const workspaceNormalized = path.resolve(this.workspace);
      const absolutePath = path.isAbsolute(normalized)
        ? path.resolve(normalized)
        : path.resolve(workspaceNormalized, normalized);

      // Check workspace containment
      if (!isWithinPath(workspaceNormalized, absolutePath)) {
        return {
          valid: false,
          reason: 'Path is outside workspace boundaries'
        };
      }

      // Check for symlink escape attempts
      if (fs.existsSync(absolutePath)) {
        const realPath = fs.realpathSync(absolutePath);
        const realWorkspacePath = fs.existsSync(workspaceNormalized)
          ? fs.realpathSync(workspaceNormalized)
          : workspaceNormalized;
        if (!isWithinPath(realWorkspacePath, realPath)) {
          return {
            valid: false,
            reason: 'Path resolves to location outside workspace (symlink escape attempt)'
          };
        }
      }

      // Check protected paths
      const relativePath = path.relative(workspaceNormalized, absolutePath)
        .split(path.sep)
        .join('/')
        .toLowerCase();
      for (const protectedPath of this.policy.protectedPaths) {
        const normalizedProtectedPath = protectedPath.replace(/\\/g, '/').toLowerCase();
        if (relativePath === normalizedProtectedPath ||
            relativePath.startsWith(`${normalizedProtectedPath}/`)) {
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

    if (type === 'plan') {
      const files = Array.isArray(params.affectedFiles) ? params.affectedFiles : [];
      const risks = Array.isArray(params.risks) ? params.risks : [];
      if (files.length > this.policy.broadScopeFileThreshold) {
        level = RiskLevel.HIGH;
        factors.push('Broad workspace scope');
      }
      if (risks.some(risk => ['high', 'critical'].includes(String(risk.level).toLowerCase()))) {
        level = RiskLevel.HIGH;
        factors.push('Plan contains high-risk actions');
      }
      if (params.requiresApproval) {
        level = RiskLevel.HIGH;
        factors.push('Plan explicitly requires approval');
      }
    }

    if (this.policy.highRiskActions.includes(type)) {
      level = RiskLevel.HIGH;
      factors.push('Configured high-risk action');
    }

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
    if (type === 'write_file' || type === 'edit_file' || type === 'delete_file') {
      level = RiskLevel.LOW;
      factors.push('File modification');

      if (params.path) {
        for (const protectedPath of this.policy.protectedPaths) {
          if (params.path.includes(protectedPath)) {
            level = RiskLevel.HIGH;
            factors.push(`Protected path: ${protectedPath}`);
          }
        }

        if (type === 'edit_file' && params.expectedHash) {
          level = RiskLevel.HIGH;
          factors.push('Destructive edit of an existing file');
        }
        if (params.dependencyChange) {
          level = RiskLevel.HIGH;
          factors.push('Dependency change');
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

    if (type === 'plan') {
      const files = Array.isArray(params.affectedFiles) ? params.affectedFiles : [];
      if (files.length > this.policy.maxFilesPerTask) {
        return {
          allowed: false,
          reason: `Too many affected files (${files.length} > ${this.policy.maxFilesPerTask})`
        };
      }
      for (const file of files) {
        const pathCheck = this.validatePath(file);
        if (!pathCheck.valid) return { allowed: false, reason: pathCheck.reason };
      }
      return { allowed: true, reason: null };
    }

    // Read-only mode
    if (this.mode === ApprovalMode.READ_ONLY) {
      const writingOps = ['write_file', 'edit_file', 'delete_file', 'execute_command', 'delete_directory'];
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
    if ((type === 'write_file' || type === 'edit_file' || type === 'create_file') && !this.policy.allowFileWrites) {
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
    if (['write_file', 'edit_file', 'create_file'].includes(type) &&
        typeof params.content === 'string') {
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
    if (operation.type === 'plan') {
      const params = operation.params || {};
      const files = Array.isArray(params.affectedFiles) ? params.affectedFiles : [];
      const risks = Array.isArray(params.risks) ? params.risks : [];
      return (this.policy.requireApprovalForHighRisk &&
          (risk.level === RiskLevel.HIGH || risk.level === RiskLevel.CRITICAL)) ||
        (files.length > this.policy.broadScopeFileThreshold) ||
        risks.some(item => item && item.requiresApproval === true) ||
        params.requiresApproval === true;
    }

    if (operation.type === 'edit_file' && operation.params && operation.params.expectedHash &&
        this.policy.requireApprovalForDestructiveEdits) {
      return true;
    }
    if (operation.params && operation.params.dependencyChange &&
        this.policy.requireApprovalForDependencyChanges) {
      return true;
    }
    if (this.policy.highRiskActions.includes(operation.type)) return true;

    // Always require approval for high and critical risk
    if (this.policy.requireApprovalForHighRisk &&
        (risk.level === RiskLevel.HIGH || risk.level === RiskLevel.CRITICAL)) {
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
      return this.requestApproval({
        operation,
        risk,
        workspace: this.workspace
      });
    }

    // No approval handler = deny
    return false;
  }
}

function isWithinPath(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === '' ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`));
}

module.exports = {
  PermissionManager,
  ApprovalMode,
  RiskLevel
};

/**
 * Post-Edit Verification and Repair Loop
 * Task: P9-T017
 * 
 * Runs selected linter and relevant tests after accepted edits.
 * Associates verification output with changes and reports pass/fail/skipped.
 * Optionally feeds bounded verification errors back for repair attempts.
 */

const EventEmitter = require('events');
const path = require('path');
const { CONTRACT_VERSION } = require('./contracts');

/**
 * Verification result states
 */
const VerificationStates = {
  PASS: 'passed',
  FAIL: 'failed',
  SKIPPED: 'skipped',
  UNAVAILABLE: 'unavailable',
  ERROR: 'errored',
  TIMEOUT: 'timed-out'
};

/**
 * Represents a single verification check result
 */
class VerificationResult {
  constructor(checkType, options = {}) {
    this.checkType = checkType; // 'lint', 'test', 'build', 'type-check'
    this.status = VerificationStates.SKIPPED;
    this.required = options.required !== false;
    this.errors = [];
    this.warnings = [];
    this.duration = 0;
    this.command = options.command || null;
    this.output = null;
    this.exitCode = null;
    this.timestamp = Date.now();
  }

  get state() {
    return this.status;
  }

  set state(status) {
    this.status = status;
  }

  addError(error) {
    this.errors.push({
      file: error.file || null,
      line: error.line || null,
      column: error.column || null,
      message: error.message,
      rule: error.rule || null,
      severity: error.severity || 'error'
    });
  }

  addWarning(warning) {
    this.warnings.push({
      file: warning.file || null,
      line: warning.line || null,
      message: warning.message,
      severity: 'warning'
    });
  }

  toJSON() {
    return {
      checkType: this.checkType,
      status: this.status,
      state: this.status,
      required: this.required,
      errors: this.errors,
      warnings: this.warnings,
      duration: this.duration,
      command: this.command,
      exitCode: this.exitCode,
      timestamp: this.timestamp
    };
  }
}

/**
 * Manages backup and recovery for failed verifications
 */
class RecoveryManager {
  constructor(backupDir = '.aqt-backups') {
    this.backupDir = backupDir;
    this.backups = new Map();
  }

  createBackup(filePath, content) {
    this.backups.set(filePath, {
      content,
      timestamp: Date.now()
    });
  }

  hasBackup(filePath) {
    return this.backups.has(filePath);
  }

  restore(filePath) {
    const backup = this.backups.get(filePath);
    if (!backup) {
      throw new Error(`No backup available for ${filePath}`);
    }
    return backup.content;
  }

  clearBackup(filePath) {
    this.backups.delete(filePath);
  }

  clearAll() {
    this.backups.clear();
  }
}

/**
 * Main Verification and Repair Loop Manager
 */
class VerificationRepairLoop extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.linterManager = options.linterManager;
    this.testRunner = options.testRunner;
    this.buildRunner = options.buildRunner;
    this.maxRetries = options.maxRetries || 3;
    this.repairEnabled = options.repairEnabled !== false;
    
    this.recoveryManager = new RecoveryManager(options.backupDir);
    this.verificationHistory = [];
    this.retryCount = 0;
  }

  /**
   * Run verification after edits
   */
  async verify(editContext, checks = ['lint', 'test']) {
    const results = {
      schemaVersion: CONTRACT_VERSION,
      overall: VerificationStates.PASS,
      checks: {},
      canRepair: false,
      retryCount: this.retryCount,
      timestamp: Date.now()
    };
    
    // Create backups before verification
    if (editContext.files) {
      for (const file of editContext.files) {
        if (file.originalContent) {
          this.recoveryManager.createBackup(file.path, file.originalContent);
        }
      }
    }
    
    // Run each verification check
    for (const check of checks) {
      const checkType = typeof check === 'string' ? check : check.type;
      const required = typeof check === 'string' || check.required !== false;
      const result = await this.runCheck(checkType, editContext, { required });
      results.checks[checkType] = result;
      
      // A required check that did not run successfully can never produce a pass.
      if (result.state === VerificationStates.FAIL) {
        results.overall = VerificationStates.FAIL;
        results.canRepair = this.repairEnabled && result.errors.length > 0;
      } else if (required && result.state !== VerificationStates.PASS &&
                 results.overall === VerificationStates.PASS) {
        results.overall = result.state;
      }
    }
    
    this.verificationHistory.push(results);
    this.emit('verification-complete', results);
    
    return results;
  }

  /**
   * Run a specific verification check
   */
  async runCheck(checkType, context, options = {}) {
    const result = new VerificationResult(checkType, options);
    const startTime = Date.now();
    
    try {
      switch (checkType) {
        case 'lint':
          await this.runLintCheck(result, context);
          break;
        case 'test':
          await this.runTestCheck(result, context);
          break;
        case 'build':
          await this.runBuildCheck(result, context);
          break;
        case 'type-check':
          await this.runTypeCheck(result, context);
          break;
        default:
          result.state = VerificationStates.SKIPPED;
          result.addWarning({ message: `Unknown check type: ${checkType}` });
      }
    } catch (error) {
      result.state = error.code === 'ETIMEDOUT' || error.killed
        ? VerificationStates.TIMEOUT
        : VerificationStates.ERROR;
      result.addError({
        message: `Verification check failed: ${error.message}`,
        severity: 'error'
      });
    }
    
    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Run linter check
   */
  async runLintCheck(result, context) {
    if (!this.linterManager) {
      result.state = VerificationStates.UNAVAILABLE;
      result.addWarning({ message: 'Linter manager not configured' });
      return;
    }
    
    const workspace = context.workspace;
    const files = context.files?.map(f => f.path) || [];
    
    try {
      const lintResult = await this.linterManager.runLinters(workspace, { files });
      
      result.command = lintResult.command;
      result.output = lintResult.output;
      result.exitCode = lintResult.exitCode;
      
      if (lintResult.issues && lintResult.issues.length > 0) {
        for (const issue of lintResult.issues) {
          if (issue.severity === 'error') {
            result.addError(issue);
          } else {
            result.addWarning(issue);
          }
        }
        result.state = result.errors.length > 0 ? 
          VerificationStates.FAIL : VerificationStates.PASS;
      } else {
        result.state = VerificationStates.PASS;
      }
    } catch (error) {
      result.state = VerificationStates.UNAVAILABLE;
      result.addError({ message: error.message });
    }
  }

  /**
   * Run test check
   */
  async runTestCheck(result, context) {
    if (!this.testRunner) {
      result.state = VerificationStates.SKIPPED;
      return;
    }
    
    try {
      const testResult = await this.testRunner.run(context.workspace, {
        files: context.files?.map(f => f.path)
      });
      
      result.command = testResult.command;
      result.output = testResult.output;
      result.exitCode = testResult.exitCode;
      
      if (testResult.failed > 0) {
        result.state = VerificationStates.FAIL;
        for (const failure of testResult.failures || []) {
          result.addError({
            file: failure.file,
            line: failure.line,
            message: failure.message
          });
        }
      } else {
        result.state = VerificationStates.PASS;
      }
    } catch (error) {
      result.state = VerificationStates.UNAVAILABLE;
      result.addError({ message: error.message });
    }
  }

  /**
   * Run build check
   */
  async runBuildCheck(result, context) {
    if (!this.buildRunner) {
      result.state = VerificationStates.SKIPPED;
      return;
    }
    
    try {
      const buildResult = await this.buildRunner.build(context.workspace);
      
      result.command = buildResult.command;
      result.output = buildResult.output;
      result.exitCode = buildResult.exitCode;
      
      if (buildResult.success) {
        result.state = VerificationStates.PASS;
      } else {
        result.state = VerificationStates.FAIL;
        for (const error of buildResult.errors || []) {
          result.addError(error);
        }
      }
    } catch (error) {
      result.state = VerificationStates.ERROR;
      result.addError({ message: error.message });
    }
  }

  /**
   * Run type check
   */
  async runTypeCheck(result, context) {
    // TypeScript or similar type checker
    result.state = VerificationStates.SKIPPED;
    result.addWarning({ message: 'Type checking not implemented' });
  }

  /**
   * Attempt repair for failed verification
   */
  async attemptRepair(verificationResult, editContext, repairAgent) {
    if (!this.repairEnabled) {
      return { success: false, reason: 'Repair disabled' };
    }
    
    if (this.retryCount >= this.maxRetries) {
      return { 
        success: false, 
        reason: `Maximum retries (${this.maxRetries}) exceeded`,
        recoveryAvailable: this.hasRecovery(editContext)
      };
    }
    
    // Collect errors for repair
    const errors = this.collectRepairableErrors(verificationResult);
    
    if (errors.length === 0) {
      return { success: false, reason: 'No repairable errors found' };
    }
    
    this.retryCount++;
    this.emit('repair-attempt', {
      retryCount: this.retryCount,
      errors: errors.length
    });
    
    try {
      // Feed errors to repair agent
      const repairResult = await repairAgent.repair(errors, editContext);
      
      if (repairResult.success) {
        // Re-run verification
        const newVerification = await this.verify(editContext, 
          Object.keys(verificationResult.checks));
        
        return {
          success: newVerification.overall === VerificationStates.PASS,
          verification: newVerification,
          retryCount: this.retryCount
        };
      }
      
      return {
        success: false,
        reason: repairResult.reason || 'Repair failed',
        retryCount: this.retryCount
      };
    } catch (error) {
      return {
        success: false,
        reason: error.message,
        retryCount: this.retryCount
      };
    }
  }

  /**
   * Collect repairable errors from verification result
   */
  collectRepairableErrors(verificationResult) {
    const errors = [];
    
    for (const [checkType, result] of Object.entries(verificationResult.checks)) {
      if (result.state === VerificationStates.FAIL) {
        for (const error of result.errors) {
          errors.push({
            ...error,
            checkType,
            retryCount: this.retryCount
          });
        }
      }
    }
    
    return errors;
  }

  /**
   * Check if recovery is available
   */
  hasRecovery(editContext) {
    if (!editContext.files) return false;
    
    return editContext.files.some(f => 
      this.recoveryManager.hasBackup(f.path)
    );
  }

  /**
   * Recover to pre-change state
   */
  recover(editContext) {
    const recovered = [];
    
    for (const file of editContext.files || []) {
      if (this.recoveryManager.hasBackup(file.path)) {
        const originalContent = this.recoveryManager.restore(file.path);
        recovered.push({
          path: file.path,
          content: originalContent
        });
      }
    }
    
    this.emit('recovery-complete', { recovered: recovered.length });
    
    return recovered;
  }

  /**
   * Get recovery guidance
   */
  getRecoveryGuidance(verificationResult) {
    const guidance = {
      canRecover: false,
      steps: [],
      backupFiles: []
    };
    
    if (verificationResult.overall === VerificationStates.FAIL) {
      guidance.canRecover = true;
      guidance.steps.push('Revert changes using backup files');
      guidance.steps.push('Review verification errors before retrying');
      
      for (const [checkType, result] of Object.entries(verificationResult.checks)) {
        if (result.state === VerificationStates.FAIL) {
          guidance.steps.push(`Fix ${result.errors.length} ${checkType} error(s)`);
        }
      }
    }
    
    return guidance;
  }

  /**
   * Reset retry counter
   */
  reset() {
    this.retryCount = 0;
    this.recoveryManager.clearAll();
  }

  /**
   * Get verification history
   */
  getHistory(limit = 10) {
    return this.verificationHistory.slice(-limit);
  }

  /**
   * Generate verification report
   */
  generateReport(verificationResult) {
    return {
      timestamp: verificationResult.timestamp,
      overall: verificationResult.overall,
      canRepair: verificationResult.canRepair,
      retryCount: verificationResult.retryCount,
      checks: Object.entries(verificationResult.checks).map(([type, result]) => ({
        type,
        state: result.state,
        errors: result.errors.length,
        warnings: result.warnings.length,
        duration: result.duration
      })),
      summary: {
        totalErrors: Object.values(verificationResult.checks)
          .reduce((sum, r) => sum + r.errors.length, 0),
        totalWarnings: Object.values(verificationResult.checks)
          .reduce((sum, r) => sum + r.warnings.length, 0),
        totalDuration: Object.values(verificationResult.checks)
          .reduce((sum, r) => sum + r.duration, 0)
      }
    };
  }
}

module.exports = {
  VerificationRepairLoop,
  VerificationResult,
  RecoveryManager,
  VerificationStates
};

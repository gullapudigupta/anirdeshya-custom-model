/**
 * Rule and AI Auto-Fix Pipeline (P9-T027)
 *
 * Implements explicit fix strategies: rule-only, AI-only, local-first, cloud-fallback.
 * Records every fix attempt, validation, backup, patch, and rollback decision.
 *
 * @module pipelines/auto-fix-pipeline
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');

/**
 * Fix strategies
 */
const FixStrategy = {
  RULE_ONLY: 'rule-only',
  AI_ONLY: 'ai-only',
  LOCAL_FIRST: 'local-first',
  CLOUD_FALLBACK: 'cloud-fallback',
  MANUAL_REVIEW: 'manual-review'
};

/**
 * Auto-Fix Pipeline
 */
class AutoFixPipeline {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.executor = options.executor || new PipelineExecutor();
    this.strategy = options.strategy || FixStrategy.LOCAL_FIRST;
    this.dryRun = options.dryRun || false;
    
    // Fixers
    this.ruleBasedFixer = options.ruleBasedFixer || null;
    this.localAIFixer = options.localAIFixer || null;
    this.cloudAIFixer = options.cloudAIFixer || null;
    
    // Validator
    this.validator = options.validator || null;
    
    // Backup storage
    this.backupDir = options.backupDir || path.join(this.workspace, '.aqt-backups');
  }

  /**
   * Execute the auto-fix pipeline
   * @param {Object} params
   * @param {Array} params.issues - Issues to fix
   * @param {string} [params.taskId] - Associated task ID
   * @param {string} [params.strategy] - Override default strategy
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const { issues, taskId = null, strategy = this.strategy } = params;

    const stageHandlers = {
      'select-issues': async (ctx) => this._selectIssues(ctx, issues),
      'group-by-file': async (ctx) => this._groupByFile(ctx),
      'create-backup': async (ctx) => this._createBackup(ctx),
      'rule-fix': async (ctx) => this._applyRuleFixes(ctx, strategy),
      'local-ai-fix': async (ctx) => this._applyLocalAIFixes(ctx, strategy),
      'cloud-ai-fix': async (ctx) => this._applyCloudAIFixes(ctx, strategy),
      'validate': async (ctx) => this._validateFixes(ctx),
      'apply-or-rollback': async (ctx) => this._applyOrRollback(ctx),
      'summarize': async (ctx) => this._summarize(ctx)
    };

    const result = await this.executor.execute('auto-fix', {
      input: { issues, strategy, dryRun: this.dryRun },
      taskId,
      workspace: this.workspace,
      context: { strategy },
      stageHandlers
    });

    return result;
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _selectIssues(ctx, issues) {
    // Filter fixable issues
    const selected = issues.filter(issue => {
      return issue.fixable !== false && 
             issue.file && 
             issue.line;
    });

    ctx.ledger.recordToolCall(ctx.runId, {
      name: 'select_issues',
      args: { total: issues.length },
      result: { selected: selected.length },
      duration: 0
    });

    return {
      total: issues.length,
      selected,
      skipped: issues.length - selected.length
    };
  }

  async _groupByFile(ctx) {
    const issues = ctx.input.selected || [];
    const grouped = {};

    for (const issue of issues) {
      if (!grouped[issue.file]) {
        grouped[issue.file] = [];
      }
      grouped[issue.file].push(issue);
    }

    // Sort issues within each file by line number
    for (const file of Object.keys(grouped)) {
      grouped[file].sort((a, b) => (a.line || 0) - (b.line || 0));
    }

    return {
      files: Object.keys(grouped),
      issuesByFile: grouped,
      fileCount: Object.keys(grouped).length
    };
  }

  async _createBackup(ctx) {
    if (this.dryRun) {
      return { dryRun: true, backups: [] };
    }

    const files = ctx.previousResults['group-by-file'].files || [];
    const backups = [];

    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    for (const file of files) {
      const filePath = path.join(this.workspace, file);
      if (!fs.existsSync(filePath)) continue;

      const timestamp = Date.now();
      const backupName = `${file.replace(/[\/\\]/g, '_')}.${timestamp}.backup`;
      const backupPath = path.join(this.backupDir, backupName);

      try {
        const content = fs.readFileSync(filePath, 'utf8');
        fs.writeFileSync(backupPath, content, 'utf8');
        
        backups.push({
          originalFile: file,
          backupPath,
          timestamp
        });
      } catch (error) {
        // Log error but continue
      }
    }

    return { backups, count: backups.length };
  }

  async _applyRuleFixes(ctx, strategy) {
    if (strategy === FixStrategy.AI_ONLY) {
      return { skipped: true, reason: 'AI-only strategy' };
    }

    const issuesByFile = ctx.previousResults['group-by-file'].issuesByFile || {};
    const fixes = [];
    const failures = [];

    if (!this.ruleBasedFixer) {
      return { skipped: true, reason: 'No rule-based fixer available' };
    }

    for (const [file, issues] of Object.entries(issuesByFile)) {
      for (const issue of issues) {
        try {
          const fix = await this.ruleBasedFixer.fix(issue);
          
          ctx.ledger.recordToolCall(ctx.runId, {
            name: 'rule_fixer',
            args: { issue: issue.id, rule: issue.rule },
            result: { success: fix.success, confidence: fix.confidence },
            duration: fix.duration || 0
          });

          if (fix.success) {
            fixes.push({
              issueId: issue.id,
              file: issue.file,
              fixer: 'rule-based',
              patch: fix.patch,
              confidence: fix.confidence || 1.0
            });
          } else {
            failures.push({
              issueId: issue.id,
              reason: fix.error || 'Unknown error'
            });
          }
        } catch (error) {
          failures.push({
            issueId: issue.id,
            reason: error.message
          });
        }
      }
    }

    return {
      attempted: fixes.length + failures.length,
      fixed: fixes.length,
      failed: failures.length,
      fixes,
      failures
    };
  }

  async _applyLocalAIFixes(ctx, strategy) {
    if (strategy === FixStrategy.RULE_ONLY || strategy === FixStrategy.CLOUD_FALLBACK) {
      return { skipped: true, reason: `Strategy is ${strategy}` };
    }

    // Get issues that weren't fixed by rules
    const ruleResult = ctx.previousResults['rule-fix'] || { fixes: [] };
    const fixedIssueIds = new Set(ruleResult.fixes.map(f => f.issueId));
    
    const issuesByFile = ctx.previousResults['group-by-file'].issuesByFile || {};
    const remainingIssues = [];
    
    for (const issues of Object.values(issuesByFile)) {
      remainingIssues.push(...issues.filter(i => !fixedIssueIds.has(i.id)));
    }

    if (remainingIssues.length === 0) {
      return { skipped: true, reason: 'All issues fixed by rules' };
    }

    if (!this.localAIFixer || !this.localAIFixer.available) {
      return { skipped: true, reason: 'Local AI fixer not available' };
    }

    const fixes = [];
    const failures = [];

    for (const issue of remainingIssues) {
      try {
        const fix = await this.localAIFixer.fix(issue);
        
        ctx.ledger.recordModelCall(ctx.runId, {
          provider: 'local',
          model: fix.model || 'unknown',
          promptTokens: fix.promptTokens || 0,
          completionTokens: fix.completionTokens || 0,
          cost: 0,
          duration: fix.duration || 0
        });

        if (fix.success) {
          fixes.push({
            issueId: issue.id,
            file: issue.file,
            fixer: 'local-ai',
            patch: fix.patch,
            confidence: fix.confidence || 0.8,
            model: fix.model
          });
        } else {
          failures.push({
            issueId: issue.id,
            reason: fix.error || 'Fix failed'
          });
        }
      } catch (error) {
        failures.push({
          issueId: issue.id,
          reason: error.message
        });
      }
    }

    return {
      attempted: fixes.length + failures.length,
      fixed: fixes.length,
      failed: failures.length,
      fixes,
      failures
    };
  }

  async _applyCloudAIFixes(ctx, strategy) {
    if (strategy === FixStrategy.RULE_ONLY || 
        strategy === FixStrategy.LOCAL_FIRST ||
        strategy === FixStrategy.AI_ONLY) {
      
      // For LOCAL_FIRST, only use cloud as fallback
      if (strategy === FixStrategy.LOCAL_FIRST) {
        const localResult = ctx.previousResults['local-ai-fix'] || {};
        if (localResult.skipped && localResult.reason !== 'Local AI fixer not available') {
          return { skipped: true, reason: 'Not a fallback scenario' };
        }
      } else {
        return { skipped: true, reason: `Strategy is ${strategy}` };
      }
    }

    // Collect all unfixed issues
    const ruleResult = ctx.previousResults['rule-fix'] || { fixes: [] };
    const localResult = ctx.previousResults['local-ai-fix'] || { fixes: [] };
    const fixedIssueIds = new Set([
      ...ruleResult.fixes.map(f => f.issueId),
      ...localResult.fixes.map(f => f.issueId)
    ]);

    const issuesByFile = ctx.previousResults['group-by-file'].issuesByFile || {};
    const remainingIssues = [];
    
    for (const issues of Object.values(issuesByFile)) {
      remainingIssues.push(...issues.filter(i => !fixedIssueIds.has(i.id)));
    }

    if (remainingIssues.length === 0) {
      return { skipped: true, reason: 'All issues already fixed' };
    }

    if (!this.cloudAIFixer || !this.cloudAIFixer.available) {
      return { skipped: true, reason: 'Cloud AI fixer not available' };
    }

    const fixes = [];
    const failures = [];

    for (const issue of remainingIssues) {
      try {
        const fix = await this.cloudAIFixer.fix(issue);
        
        ctx.ledger.recordModelCall(ctx.runId, {
          provider: fix.provider || 'cloud',
          model: fix.model || 'unknown',
          promptTokens: fix.promptTokens || 0,
          completionTokens: fix.completionTokens || 0,
          cost: fix.cost || 0,
          duration: fix.duration || 0
        });

        if (fix.success) {
          fixes.push({
            issueId: issue.id,
            file: issue.file,
            fixer: 'cloud-ai',
            patch: fix.patch,
            confidence: fix.confidence || 0.9,
            model: fix.model,
            provider: fix.provider
          });
        } else {
          failures.push({
            issueId: issue.id,
            reason: fix.error || 'Fix failed'
          });
        }
      } catch (error) {
        failures.push({
          issueId: issue.id,
          reason: error.message
        });
      }
    }

    return {
      attempted: fixes.length + failures.length,
      fixed: fixes.length,
      failed: failures.length,
      fixes,
      failures
    };
  }

  async _validateFixes(ctx) {
    // Collect all fixes
    const allFixes = [
      ...(ctx.previousResults['rule-fix']?.fixes || []),
      ...(ctx.previousResults['local-ai-fix']?.fixes || []),
      ...(ctx.previousResults['cloud-ai-fix']?.fixes || [])
    ];

    if (allFixes.length === 0) {
      return { validated: [], rejected: [], total: 0 };
    }

    const validated = [];
    const rejected = [];

    for (const fix of allFixes) {
      // Validate patch syntax
      const validation = this._validatePatch(fix.patch);
      
      // Run validator if available
      let validatorResult = { passed: true };
      if (this.validator) {
        try {
          validatorResult = await this.validator.validate(fix);
        } catch (error) {
          validatorResult = { passed: false, error: error.message };
        }
      }

      ctx.ledger.recordValidation(ctx.runId, {
        name: 'fix_validation',
        passed: validation.valid && validatorResult.passed,
        errors: [...(validation.errors || []), ...(validatorResult.errors || [])],
        warnings: validation.warnings || []
      });

      if (validation.valid && validatorResult.passed) {
        validated.push(fix);
      } else {
        rejected.push({
          ...fix,
          rejectionReason: validation.errors?.[0] || validatorResult.error || 'Validation failed'
        });
      }
    }

    return {
      total: allFixes.length,
      validated,
      rejected,
      validationRate: validated.length / allFixes.length
    };
  }

  async _applyOrRollback(ctx) {
    const { validated = [] } = ctx.previousResults['validate'] || {};
    
    if (this.dryRun) {
      return {
        dryRun: true,
        wouldApply: validated.length,
        changes: validated.map(f => ({ file: f.file, issueId: f.issueId }))
      };
    }

    const applied = [];
    const rollbacks = [];
    const failures = [];

    // Group fixes by file
    const fixesByFile = {};
    for (const fix of validated) {
      if (!fixesByFile[fix.file]) {
        fixesByFile[fix.file] = [];
      }
      fixesByFile[fix.file].push(fix);
    }

    // Apply fixes file by file
    for (const [file, fixes] of Object.entries(fixesByFile)) {
      const filePath = path.join(this.workspace, file);
      
      try {
        // Read current content
        let content = fs.readFileSync(filePath, 'utf8');
        const originalContent = content;

        // Apply patches (from bottom to top to preserve line numbers)
        const sortedFixes = fixes.sort((a, b) => (b.patch.line || 0) - (a.patch.line || 0));
        
        for (const fix of sortedFixes) {
          content = this._applyPatch(content, fix.patch);
        }

        // Write modified content
        fs.writeFileSync(filePath, content, 'utf8');
        
        // Record file changes
        ctx.ledger.recordFileChanges(ctx.runId, [file], {
          fixesApplied: fixes.length,
          fixer: fixes[0].fixer
        });

        applied.push(...fixes.map(f => f.issueId));
        
      } catch (error) {
        // Rollback this file
        const backup = ctx.previousResults['create-backup']?.backups?.find(b => b.originalFile === file);
        if (backup && fs.existsSync(backup.backupPath)) {
          try {
            const backupContent = fs.readFileSync(backup.backupPath, 'utf8');
            fs.writeFileSync(filePath, backupContent, 'utf8');
            rollbacks.push({
              file,
              reason: error.message,
              restored: true
            });
          } catch (rollbackError) {
            rollbacks.push({
              file,
              reason: error.message,
              restored: false,
              rollbackError: rollbackError.message
            });
          }
        }
        
        failures.push(...fixes.map(f => ({
          issueId: f.issueId,
          file,
          reason: error.message
        })));
      }
    }

    return {
      applied: applied.length,
      rolledBack: rollbacks.length,
      failed: failures.length,
      appliedIssues: applied,
      rollbacks,
      failures
    };
  }

  async _summarize(ctx) {
    const selectResult = ctx.previousResults['select-issues'] || {};
    const applyResult = ctx.previousResults['apply-or-rollback'] || {};
    const validateResult = ctx.previousResults['validate'] || {};

    return {
      total: selectResult.total || 0,
      selected: selectResult.selected?.length || 0,
      fixed: applyResult.applied || 0,
      failed: applyResult.failed || 0,
      rolledBack: applyResult.rolledBack || 0,
      validationRate: validateResult.validationRate || 0,
      strategy: ctx.context.strategy,
      dryRun: this.dryRun
    };
  }

  // ─── Helper methods ───────────────────────────────────────────────────────────

  _validatePatch(patch) {
    const errors = [];
    const warnings = [];

    if (!patch || typeof patch !== 'object') {
      errors.push('Patch must be an object');
      return { valid: false, errors, warnings };
    }

    if (patch.line === undefined || patch.line < 1) {
      errors.push('Patch must have a valid line number');
    }

    if (!patch.replacement && patch.replacement !== '') {
      warnings.push('Patch has no replacement content');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  _applyPatch(content, patch) {
    const lines = content.split('\n');
    
    if (patch.line > lines.length) {
      throw new Error(`Patch line ${patch.line} exceeds file length ${lines.length}`);
    }

    const lineIndex = patch.line - 1;
    lines[lineIndex] = patch.replacement;
    
    return lines.join('\n');
  }
}

module.exports = {
  AutoFixPipeline,
  FixStrategy
};

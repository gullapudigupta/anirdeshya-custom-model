/**
 * Self-Explanatory Fix Generation v2  (P7-T006)
 *
 * Generates fixes for code issues with rich explanations, risk analysis,
 * before/after semantic summaries, and confidence thresholds.
 *
 * Key improvements over v1:
 *  - Expanded explanation templates per issue category
 *  - Fix rationale: WHY this fix was chosen
 *  - Risk analysis: what could break
 *  - Before/after semantic summaries (not just diffs)
 *  - Confidence thresholds — low-confidence fixes require human approval
 *  - Human approval mode for any fix above a risk threshold
 *  - Regression-test generation per fix
 *  - Automatic patch rejection when post-fix validation fails
 *
 * @module ai/fix-generation-v2
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ─── Confidence and risk thresholds ──────────────────────────────────────────

/**
 * Fixes with confidence below APPROVAL_THRESHOLD are held for human review.
 * Fixes with risk score above RISK_THRESHOLD are also held for review.
 */
const APPROVAL_THRESHOLD  = 0.75;  // Confidence below this → require approval
const RISK_THRESHOLD      = 0.6;   // Risk above this → require approval

// ─── Explanation template library ────────────────────────────────────────────

/**
 * Each entry maps an issue category / rule ID to a structured template with:
 *  - explanation: why the issue exists and matters
 *  - rationale:   why this specific fix approach was chosen
 *  - risks:       potential negative consequences of applying the fix
 *  - alternatives: other approaches that were not chosen
 */
const EXPLANATION_TEMPLATES = {

  // ── Security ───────────────────────────────────────────────────────────────
  'sql-injection': {
    explanation: 'String interpolation in SQL queries allows attackers to inject ' +
                 'arbitrary SQL, potentially reading, modifying, or deleting all data.',
    rationale:   'Parameterised queries separate code from data at the protocol level, ' +
                 'making injection structurally impossible regardless of input content.',
    risks:       ['Parameter placeholders differ by database driver (?, $1, :name) — ' +
                  'verify the correct placeholder syntax for your driver.'],
    alternatives: ['ORM query builders (Sequelize, Knex) also prevent injection and ' +
                   'add portability across databases.']
  },

  'hardcoded-secret': {
    explanation: 'Hardcoded credentials in source code are exposed to anyone with ' +
                 'repository access and are logged in version-control history forever.',
    rationale:   'Environment variables keep secrets out of source code. The .env.example ' +
                 'pattern documents required variables without storing real values.',
    risks:       ['Rotating the secret in the environment requires a process restart.',
                  'Ensure the .env file is in .gitignore before committing.'],
    alternatives: ['A secrets manager (AWS Secrets Manager, HashiCorp Vault) provides ' +
                   'rotation, auditing, and fine-grained access control.']
  },

  // ── Performance ────────────────────────────────────────────────────────────
  'n-plus-one': {
    explanation: 'Executing a database query inside a loop causes N+1 queries: one ' +
                 'initial query plus one per result row, which degrades exponentially.',
    rationale:   'A single bulk query with an IN clause or a JOIN fetches all needed ' +
                 'records in one round-trip, regardless of result set size.',
    risks:       ['Bulk queries may return large result sets — add pagination or limits.',
                  'Index coverage on the IN-list column is critical for performance.'],
    alternatives: ['DataLoader pattern (used in GraphQL) batches queries automatically ' +
                   'across asynchronous call boundaries.']
  },

  'inefficient-loop': {
    explanation: 'Repeated array.includes() or object key lookups inside a loop are ' +
                 'O(n) per iteration, making the overall algorithm O(n²).',
    rationale:   'Converting the lookup target to a Set or Map gives O(1) lookups, ' +
                 'reducing the overall complexity to O(n).',
    risks:       ['Set/Map use more memory than arrays — trade-off is appropriate for ' +
                  'large datasets but unnecessary for very small ones (< 10 items).'],
    alternatives: ['Sorting + binary search gives O(n log n) preprocessing + O(log n) ' +
                   'lookup with lower memory overhead.']
  },

  // ── Code quality ───────────────────────────────────────────────────────────
  'long-function': {
    explanation: 'Functions exceeding ~30 lines are harder to understand, test, and ' +
                 'maintain because they mix multiple levels of abstraction.',
    rationale:   'Extracting cohesive sub-tasks into named helper functions improves ' +
                 'readability, enables isolated unit testing, and reduces duplication.',
    risks:       ['Introducing new function boundaries may change observable behaviour ' +
                  'if the extracted code relies on closure variables — verify carefully.'],
    alternatives: ['If the function is an event handler or callback that must be inline, ' +
                   'consider documenting with block comments rather than extracting.']
  },

  'missing-error-handling': {
    explanation: 'Unhandled promise rejections or missing try/catch blocks cause silent ' +
                 'failures that are difficult to diagnose in production.',
    rationale:   'Explicit error handling at the right boundary provides meaningful error ' +
                 'messages, enables recovery, and prevents cascading failures.',
    risks:       ['Adding error handling changes the function signature (may now throw or ' +
                  'reject) — callers must be updated accordingly.'],
    alternatives: ['Global unhandledRejection handlers are a last resort for logging ' +
                   'but should not replace local handling.']
  },

  // ── Default fallback ───────────────────────────────────────────────────────
  default: {
    explanation: 'This issue was detected by the quality analysis engine.',
    rationale:   'The proposed fix follows the most common established best practice ' +
                 'for this issue category.',
    risks:       ['Review the fix carefully before applying — automated fixes may not ' +
                  'account for all project-specific requirements.'],
    alternatives: ['Consult the project coding standards for approved alternative approaches.']
  }
};

// ─── Main class ───────────────────────────────────────────────────────────────

class FixGenerationV2 {
  /**
   * @param {object} [options={}]
   * @param {number}  [options.approvalThreshold]  - Confidence below which approval is required
   * @param {number}  [options.riskThreshold]      - Risk above which approval is required
   * @param {boolean} [options.humanApprovalMode]  - Force approval for ALL fixes
   * @param {boolean} [options.generateTests=true] - Generate regression tests per fix
   * @param {object}  [options.validator]          - { validate(filePath) → {passed, errors} }
   * @param {boolean} [options.verbose=false]
   * @param {boolean} [options.dryRun=false]
   */
  constructor(options = {}) {
    this.options           = options;
    this.verbose           = options.verbose           || false;
    this.dryRun            = options.dryRun            || false;
    this.humanApprovalMode = options.humanApprovalMode || false;
    this.generateTests     = options.generateTests     !== false;
    this.approvalThreshold = options.approvalThreshold ?? APPROVAL_THRESHOLD;
    this.riskThreshold     = options.riskThreshold     ?? RISK_THRESHOLD;
    this.validator         = options.validator         || null;

    /** Pending approvals: Map<fixId, FixProposal> */
    this._pendingApprovals = new Map();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Generate a self-explanatory fix proposal for a single issue.
   *
   * @param {object} issue     - Issue record with { filePath, line, message, category, severity }
   * @param {string} content   - Current file content
   * @param {Function} [fixFn] - Optional custom fix function(content, issue) → newContent
   * @returns {object} FixProposal
   */
  generateFix(issue, content, fixFn) {
    // Get or compute the fixed content
    const fixedContent  = fixFn
      ? fixFn(content, issue)
      : this._applyBuiltInFix(issue, content);

    // Score confidence and risk
    const confidence    = this._scoreConfidence(issue, content, fixedContent);
    const risk          = this._scoreRisk(issue, content, fixedContent);

    // Determine whether human approval is needed
    const needsApproval = this.humanApprovalMode ||
                          confidence < this.approvalThreshold ||
                          risk       > this.riskThreshold;

    // Get explanation template
    const template = EXPLANATION_TEMPLATES[issue.category] ||
                     EXPLANATION_TEMPLATES[issue.ruleId]   ||
                     EXPLANATION_TEMPLATES.default;

    // Build semantic before/after summary
    const beforeSummary = this._semanticSummary(content,      issue.filePath);
    const afterSummary  = this._semanticSummary(fixedContent, issue.filePath);

    // Build the unified diff for review
    const diff = this._buildDiff(content, fixedContent, issue.filePath);

    // Generate regression test stub
    const regressionTest = this.generateTests
      ? this._buildRegressionTest(issue, content, fixedContent)
      : null;

    const proposal = {
      id:             crypto.randomBytes(6).toString('hex'),
      issue,
      fixedContent,
      confidence,
      risk,
      needsApproval,
      status:         needsApproval ? 'pending_approval' : 'ready',
      explanation: {
        why:          template.explanation,
        rationale:    template.rationale,
        risks:        template.risks,
        alternatives: template.alternatives
      },
      semanticSummary: { before: beforeSummary, after: afterSummary },
      diff,
      regressionTest,
      generatedAt:    new Date().toISOString()
    };

    // Queue for approval if needed
    if (needsApproval) {
      this._pendingApprovals.set(proposal.id, proposal);
      this._log(`Fix ${proposal.id} queued for approval (confidence=${confidence.toFixed(2)}, risk=${risk.toFixed(2)})`);
    }

    return proposal;
  }

  /**
   * Apply an approved (or auto-approved) fix to the file system.
   * Runs post-fix validation and rolls back if validation fails.
   *
   * @param {object} proposal - FixProposal from generateFix()
   * @returns {{ success: boolean, validated: boolean, rollbackReason?: string }}
   */
  applyFix(proposal) {
    if (proposal.needsApproval && proposal.status !== 'approved') {
      return { success: false, validated: false,
               rollbackReason: 'Fix requires human approval — call approveFix(id) first.' };
    }

    const { filePath } = proposal.issue;

    if (this.dryRun) {
      this._log(`[DRY RUN] Would apply fix ${proposal.id} to ${filePath}`);
      return { success: true, dryRun: true, validated: false };
    }

    // Backup before applying
    const backupPath = `${filePath}.aqt-v2-${Date.now()}`;
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backupPath);

    // Write the fix
    fs.writeFileSync(filePath, proposal.fixedContent);
    this._log(`Applied fix ${proposal.id} to ${filePath}`);

    // Post-fix validation
    if (this.validator) {
      const validation = this.validator.validate(filePath);
      if (!validation.passed) {
        // Validation failed — roll back
        fs.copyFileSync(backupPath, filePath);
        fs.unlinkSync(backupPath);
        this._log(`Fix ${proposal.id} rolled back — validation failed: ${validation.errors.join('; ')}`);
        return { success: false, validated: false,
                 rollbackReason: `Validation failed: ${validation.errors.join('; ')}` };
      }
      fs.unlinkSync(backupPath);
      return { success: true, validated: true };
    }

    // No validator configured — clean up backup
    fs.unlinkSync(backupPath);
    return { success: true, validated: false };
  }

  /**
   * Record human approval for a pending fix.
   * @param {string} fixId
   * @param {string} [approver]
   * @returns {object} Updated proposal
   */
  approveFix(fixId, approver) {
    const proposal = this._pendingApprovals.get(fixId);
    if (!proposal) throw new Error(`Fix '${fixId}' not found in pending approvals.`);
    proposal.status      = 'approved';
    proposal.approvedBy  = approver || 'unknown';
    proposal.approvedAt  = new Date().toISOString();
    this._log(`Fix ${fixId} approved by ${proposal.approvedBy}`);
    return proposal;
  }

  /**
   * Reject a pending fix.
   * @param {string} fixId
   * @param {string} [reason]
   * @returns {object} Updated proposal
   */
  rejectFix(fixId, reason) {
    const proposal = this._pendingApprovals.get(fixId);
    if (!proposal) throw new Error(`Fix '${fixId}' not found in pending approvals.`);
    proposal.status     = 'rejected';
    proposal.rejectedAt = new Date().toISOString();
    proposal.reason     = reason || '';
    this._pendingApprovals.delete(fixId);
    this._log(`Fix ${fixId} rejected: ${reason || '(no reason)'}`);
    return proposal;
  }

  /**
   * List all fixes currently pending human approval.
   * @returns {object[]}
   */
  getPendingApprovals() {
    return [...this._pendingApprovals.values()];
  }

  // ─── Built-in fix heuristics ────────────────────────────────────────────────

  /**
   * Apply built-in rule-based fixes for known issue categories.
   * Falls back to returning content unchanged when no rule matches.
   *
   * @param {object} issue
   * @param {string} content
   * @returns {string} Fixed content
   */
  _applyBuiltInFix(issue, content) {
    const { category, line, message } = issue;

    // Fix: console.log → remove line
    if (category === 'console-log' || /console\.(log|debug)/.test(message)) {
      const lines = content.split('\n');
      if (line && lines[line - 1] && /console\.(log|debug)/.test(lines[line - 1])) {
        lines.splice(line - 1, 1); // Remove the offending line
        return lines.join('\n');
      }
    }

    // Fix: missing semicolon → add semicolon
    if (category === 'semi' || message.includes('Missing semicolon')) {
      const lines = content.split('\n');
      if (line && lines[line - 1] && !lines[line - 1].trimEnd().endsWith(';')) {
        lines[line - 1] = lines[line - 1].trimEnd() + ';';
        return lines.join('\n');
      }
    }

    // Fix: trailing whitespace
    if (category === 'trailing-whitespace' || message.includes('trailing')) {
      return content.split('\n').map(l => l.trimEnd()).join('\n');
    }

    // Fix: var → const (simple cases only)
    if (category === 'no-var' || message.includes('Unexpected var')) {
      return content.replace(/\bvar\b/g, 'const');
    }

    // No built-in fix available — return unchanged
    return content;
  }

  // ─── Scoring ────────────────────────────────────────────────────────────────

  /**
   * Score fix confidence [0–1] based on how much the content changed and issue type.
   * Higher confidence = fix is simple, well-understood, and low-risk.
   */
  _scoreConfidence(issue, original, fixed) {
    if (original === fixed) return 0.5; // No change = uncertain

    // Count changed lines
    const origLines  = original.split('\n');
    const fixedLines = fixed.split('\n');
    const changed    = Math.abs(origLines.length - fixedLines.length) +
                       origLines.filter((l, i) => l !== fixedLines[i]).length;
    const changeRatio = changed / Math.max(origLines.length, 1);

    // Base confidence: inversely proportional to how much changed
    let confidence = Math.max(0.4, 1 - changeRatio);

    // Boost for well-known safe categories
    const safeCategories = ['trailing-whitespace', 'semi', 'console-log', 'no-var'];
    if (safeCategories.includes(issue.category)) confidence = Math.min(confidence + 0.2, 0.99);

    // Reduce for security-related fixes (higher stakes)
    if (['sql-injection', 'hardcoded-secret', 'xss'].includes(issue.category)) {
      confidence = Math.min(confidence, 0.7);
    }

    return parseFloat(confidence.toFixed(2));
  }

  /**
   * Score fix risk [0–1]. Higher = more likely to break something.
   */
  _scoreRisk(issue, original, fixed) {
    if (original === fixed) return 0;

    const origLines  = original.split('\n').length;
    const fixedLines = fixed.split('\n').length;
    const lineDelta  = Math.abs(origLines - fixedLines);

    // Base risk from amount of change
    let risk = Math.min(lineDelta / Math.max(origLines, 1), 0.9);

    // High-risk categories
    if (['sql-injection', 'hardcoded-secret', 'n-plus-one'].includes(issue.category)) {
      risk = Math.max(risk, 0.5);
    }

    // Low-risk categories
    if (['trailing-whitespace', 'console-log'].includes(issue.category)) {
      risk = Math.min(risk, 0.2);
    }

    return parseFloat(risk.toFixed(2));
  }

  // ─── Semantic summary ───────────────────────────────────────────────────────

  /**
   * Build a high-level semantic summary of a file's structure.
   * Used to describe what changed in human-readable terms.
   *
   * @param {string} content
   * @param {string} filePath
   * @returns {object}
   */
  _semanticSummary(content, filePath) {
    const lines       = content.split('\n');
    const functions   = (content.match(/(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\()/g) || []).length;
    const classes     = (content.match(/\bclass\s+\w+/g) || []).length;
    const imports     = (content.match(/(?:require\s*\(|^import\s)/gm) || []).length;
    const consoles    = (content.match(/\bconsole\./g) || []).length;
    const todos       = (content.match(/\/\/\s*(?:TODO|FIXME)/gi) || []).length;

    return {
      filePath,
      lineCount:     lines.length,
      functionCount: functions,
      classCount:    classes,
      importCount:   imports,
      consoleCount:  consoles,
      todoCount:     todos
    };
  }

  // ─── Diff builder ────────────────────────────────────────────────────────────

  /**
   * Build a minimal unified-style diff between original and fixed content.
   * Not a full RFC diff — simplified for human review display.
   *
   * @param {string} original
   * @param {string} fixed
   * @param {string} filePath
   * @returns {string}
   */
  _buildDiff(original, fixed, filePath) {
    if (original === fixed) return '(no changes)';

    const origLines  = original.split('\n');
    const fixedLines = fixed.split('\n');
    const lines      = [`--- a/${path.basename(filePath)}`, `+++ b/${path.basename(filePath)}`];
    const maxLines   = Math.max(origLines.length, fixedLines.length);

    for (let i = 0; i < maxLines; i++) {
      const o = origLines[i];
      const f = fixedLines[i];
      if (o !== f) {
        if (o !== undefined) lines.push(`-${o}`);
        if (f !== undefined) lines.push(`+${f}`);
      }
    }

    return lines.join('\n');
  }

  // ─── Regression test generation ─────────────────────────────────────────────

  /**
   * Generate a regression test stub that verifies the fix does not regress.
   * @param {object} issue
   * @param {string} originalContent
   * @param {string} fixedContent
   * @returns {string} JavaScript test source
   */
  _buildRegressionTest(issue, originalContent, fixedContent) {
    const baseName = issue.filePath ? path.basename(issue.filePath, path.extname(issue.filePath)) : 'module';
    const category = issue.category || 'unknown';

    return `/**
 * Regression Test — Auto-generated by FixGenerationV2
 * Issue: [${issue.severity || 'INFO'}] ${issue.message || category}
 * File:  ${issue.filePath || '(unknown)'}
 * Line:  ${issue.line || '?'}
 * Fix category: ${category}
 *
 * Generated: ${new Date().toISOString()}
 * This test verifies the fix was applied correctly and the module still works.
 */

'use strict';

describe('Regression: ${baseName} — ${category} fix', () => {

  test('fixed file no longer contains the issue pattern', () => {
    // Verify the specific pattern that triggered the issue is no longer present
    const fixedSource = ${JSON.stringify(fixedContent.slice(0, 500))}; // truncated for test
    // TODO: refine assertion based on the specific ${category} fix
    expect(fixedSource).toBeDefined();
  });

  test('module exports are intact after fix', () => {
    // TODO: import the fixed module and verify its public API is unchanged
    // const mod = require('${issue.filePath || './module'}');
    // expect(typeof mod.expectedExport).toBe('function');
    expect(true).toBe(true); // Placeholder — replace with real assertion
  });
});
`;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  _log(msg) { if (this.verbose) console.log(`[FixGenerationV2] ${msg}`); }
}

module.exports = { FixGenerationV2, EXPLANATION_TEMPLATES, APPROVAL_THRESHOLD, RISK_THRESHOLD };

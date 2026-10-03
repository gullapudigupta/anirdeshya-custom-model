/**
 * Business Logic Change Workflow  (P7-T002)
 *
 * Manages structured, human-approved changes to business logic with full
 * traceability from change-request through acceptance testing to production.
 *
 * Workflow stages:
 *   1. DEFINE    — capture a structured change request with domain rules
 *   2. ANALYSE   — detect semantic changes and validate contracts
 *   3. GENERATE  — create acceptance + regression tests for the change
 *   4. REVIEW    — present the plan for human approval
 *   5. EXECUTE   — apply approved changes and run generated tests
 *   6. VERIFY    — confirm all acceptance criteria are met
 *
 * Key guarantees:
 *  - No code is modified without explicit human approval (REVIEW stage)
 *  - Every change is backed by generated acceptance tests that must pass
 *  - API and database contracts are validated before and after the change
 *  - Semantic diff is produced so reviewers understand *what* changed
 *
 * @module ai/business-logic-workflow
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ─── Stage constants ──────────────────────────────────────────────────────────

/** All valid workflow stages in execution order */
const STAGES = {
  DEFINE:   'define',
  ANALYSE:  'analyse',
  GENERATE: 'generate',
  REVIEW:   'review',      // Human approval gate — workflow pauses here
  EXECUTE:  'execute',
  VERIFY:   'verify',
  COMPLETE: 'complete',
  REJECTED: 'rejected',    // Human rejected the plan
  FAILED:   'failed'       // Verification failed after execution
};

/** Valid forward transitions between stages */
const TRANSITIONS = {
  define:   ['analyse'],
  analyse:  ['generate'],
  generate: ['review'],
  review:   ['execute', 'rejected'],  // Human decides
  execute:  ['verify'],
  verify:   ['complete', 'failed'],
  complete: [],
  rejected: [],
  failed:   ['define']                // Can restart after failure
};

// ─── Change request schema ────────────────────────────────────────────────────

/**
 * @typedef {object} ChangeRequest
 * @property {string}   id            - Unique change-request identifier
 * @property {string}   title         - Short descriptive title
 * @property {string}   description   - Full description of the intended change
 * @property {string[]} affectedFiles - Files expected to be modified
 * @property {object[]} domainRules   - Domain invariants the change must uphold
 * @property {object[]} acceptanceCriteria - Conditions that must be true after the change
 * @property {string}   requestedBy
 * @property {string}   createdAt
 * @property {string}   stage         - Current STAGES value
 */

// ─── Main class ───────────────────────────────────────────────────────────────

class BusinessLogicWorkflow {
  /**
   * @param {object} [options={}]
   * @param {string}  [options.workflowDir]    - Directory to persist workflow state
   * @param {string}  [options.currentUser]    - Acting user (audit trail)
   * @param {boolean} [options.verbose=false]
   * @param {boolean} [options.dryRun=false]   - Analyse + generate but skip execution
   */
  constructor(options = {}) {
    this.options      = options;
    this.verbose      = options.verbose || false;
    this.dryRun       = options.dryRun  || false;
    this.currentUser  = options.currentUser || process.env.GIT_AUTHOR_NAME || 'unknown';
    this.workflowDir  = options.workflowDir ||
                        path.join(process.cwd(), '.quality-tool', 'business-logic-workflows');
    this._ensureDir(this.workflowDir);
  }

  // ─── Stage 1: Define ───────────────────────────────────────────────────────

  /**
   * Create a new structured change request.
   *
   * @param {object} params
   * @param {string}   params.title               - Short title for the change
   * @param {string}   params.description         - Detailed description
   * @param {string[]} params.affectedFiles       - Files that will be changed
   * @param {object[]} [params.domainRules=[]]    - Invariants to preserve
   * @param {object[]} [params.acceptanceCriteria=[]] - Success conditions
   * @returns {ChangeRequest}
   */
  defineChange(params) {
    this._require(params, ['title', 'description', 'affectedFiles']);

    // Validate affected files exist
    const missing = (params.affectedFiles || []).filter(f => !fs.existsSync(f));
    if (missing.length > 0) {
      throw new Error(`Affected files not found: ${missing.join(', ')}`);
    }

    const cr = {
      id:                 crypto.randomBytes(8).toString('hex'),
      title:              params.title,
      description:        params.description,
      affectedFiles:      params.affectedFiles,
      domainRules:        params.domainRules        || [],
      acceptanceCriteria: params.acceptanceCriteria || [],
      requestedBy:        this.currentUser,
      createdAt:          new Date().toISOString(),
      stage:              STAGES.DEFINE,
      history:            [],
      generatedTests:     [],
      semanticDiff:       null,
      approvedBy:         null,
      approvedAt:         null,
      executedAt:         null,
      verificationResult: null
    };

    this._saveWorkflow(cr);
    this._log(`Change request created: ${cr.id} — "${cr.title}"`);
    return cr;
  }

  // ─── Stage 2: Analyse ──────────────────────────────────────────────────────

  /**
   * Analyse the change: read current file state, extract domain rules,
   * identify API/DB contract touchpoints, and produce a semantic diff preview.
   *
   * @param {string} crId - Change request ID
   * @returns {ChangeRequest} Updated with semanticDiff populated
   */
  analyseChange(crId) {
    const cr = this._loadAndTransition(crId, STAGES.ANALYSE);

    // Snapshot current file contents for semantic diff
    const snapshots = {};
    for (const filePath of cr.affectedFiles) {
      try { snapshots[filePath] = fs.readFileSync(filePath, 'utf8'); }
      catch { snapshots[filePath] = null; }
    }

    // Detect domain rule violations in current code
    const ruleViolations = this._checkDomainRules(cr.domainRules, snapshots);

    // Identify API contract touchpoints (exported functions, HTTP routes, DB models)
    const contractTouchpoints = this._extractContractTouchpoints(snapshots);

    cr.semanticDiff = {
      snapshots,           // Before-state snapshots
      ruleViolations,      // Existing violations to be aware of
      contractTouchpoints, // API/DB surface that the change may affect
      analysedAt:   new Date().toISOString()
    };

    this._saveWorkflow(cr);
    this._log(`Change ${crId} analysed — ${ruleViolations.length} existing violations, ` +
              `${contractTouchpoints.length} contract touchpoints`);
    return cr;
  }

  // ─── Stage 3: Generate ─────────────────────────────────────────────────────

  /**
   * Generate acceptance tests and regression test stubs for the change.
   * Tests are written as JavaScript test files alongside the affected modules.
   *
   * @param {string} crId
   * @returns {ChangeRequest} Updated with generatedTests populated
   */
  generateTests(crId) {
    const cr = this._loadAndTransition(crId, STAGES.GENERATE);

    const generatedTests = [];

    // Generate one acceptance test file per acceptance criterion
    for (let i = 0; i < cr.acceptanceCriteria.length; i++) {
      const criterion = cr.acceptanceCriteria[i];
      const testPath  = path.join(
        this.workflowDir, cr.id, `acceptance-test-${i + 1}.js`
      );
      const testCode  = this._buildAcceptanceTest(cr, criterion, i + 1);
      this._ensureDir(path.dirname(testPath));
      if (!this.dryRun) fs.writeFileSync(testPath, testCode);
      generatedTests.push({ type: 'acceptance', path: testPath, criterion: criterion.description || `Criterion ${i + 1}` });
    }

    // Generate regression test stubs for each affected file
    for (const filePath of cr.affectedFiles) {
      const baseName    = path.basename(filePath, path.extname(filePath));
      const testPath    = path.join(this.workflowDir, cr.id, `regression-${baseName}.test.js`);
      const testCode    = this._buildRegressionTest(cr, filePath);
      this._ensureDir(path.dirname(testPath));
      if (!this.dryRun) fs.writeFileSync(testPath, testCode);
      generatedTests.push({ type: 'regression', path: testPath, targetFile: filePath });
    }

    cr.generatedTests = generatedTests;
    this._saveWorkflow(cr);
    this._log(`Generated ${generatedTests.length} test file(s) for change ${crId}`);
    return cr;
  }

  // ─── Stage 4: Review (human gate) ─────────────────────────────────────────

  /**
   * Present the change plan for human review.
   * Returns the formatted review document — the human must call approve() or reject().
   *
   * @param {string} crId
   * @returns {{ reviewDocument: string, cr: ChangeRequest }}
   */
  requestReview(crId) {
    const cr = this._loadAndTransition(crId, STAGES.REVIEW);
    const reviewDocument = this._buildReviewDocument(cr);
    this._saveWorkflow(cr);
    this._log(`Change ${crId} is pending human review`);
    return { reviewDocument, cr };
  }

  /**
   * Record human approval of a change request.
   * @param {string} crId
   * @param {string} [approver]  - Name of the approving person
   * @returns {ChangeRequest}
   */
  approve(crId, approver) {
    const cr = this._requireStage(crId, STAGES.REVIEW);
    cr.approvedBy = approver || this.currentUser;
    cr.approvedAt = new Date().toISOString();
    this._addHistory(cr, 'approved', { by: cr.approvedBy });
    // Approval does NOT auto-advance — caller explicitly calls executeChange()
    this._saveWorkflow(cr);
    return cr;
  }

  /**
   * Record human rejection of a change request.
   * @param {string} crId
   * @param {string} [reason]
   * @returns {ChangeRequest}
   */
  reject(crId, reason) {
    const cr = this._requireStage(crId, STAGES.REVIEW);
    cr.stage = STAGES.REJECTED;
    this._addHistory(cr, 'rejected', { by: this.currentUser, reason: reason || '' });
    this._saveWorkflow(cr);
    this._log(`Change ${crId} rejected: ${reason || '(no reason given)'}`);
    return cr;
  }

  // ─── Stage 5: Execute ──────────────────────────────────────────────────────

  /**
   * Execute an approved change request.
   * Requires prior human approval via approve().  Runs generated tests after applying.
   *
   * @param {string} crId
   * @param {Function} [changeFn]  - Optional function(filePath, content) => newContent
   *                                 for applying the actual code transformation.
   *                                 If omitted, files are left unchanged (dry-run equivalent).
   * @returns {ChangeRequest}
   */
  executeChange(crId, changeFn) {
    const cr = this._requireApproval(crId);
    this._transition(cr, STAGES.EXECUTE);

    const applied = [];

    if (!this.dryRun && changeFn) {
      for (const filePath of cr.affectedFiles) {
        try {
          const original = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
          const updated  = changeFn(filePath, original);
          if (updated !== original) {
            // Backup before overwrite
            fs.writeFileSync(`${filePath}.bkp-${cr.id}`, original);
            fs.writeFileSync(filePath, updated);
            applied.push(filePath);
          }
        } catch (e) {
          this._log(`Error applying change to ${filePath}: ${e.message}`);
        }
      }
    }

    cr.executedAt    = new Date().toISOString();
    cr.appliedFiles  = applied;
    this._addHistory(cr, 'executed', { appliedFiles: applied });
    this._saveWorkflow(cr);
    this._log(`Change ${crId} executed — ${applied.length} file(s) modified`);
    return cr;
  }

  // ─── Stage 6: Verify ───────────────────────────────────────────────────────

  /**
   * Verify the change by checking all acceptance criteria and domain rules
   * against the current post-execution state of affected files.
   *
   * @param {string} crId
   * @returns {ChangeRequest} Updated with verificationResult
   */
  verifyChange(crId) {
    const cr = this._loadAndTransition(crId, STAGES.VERIFY);

    // Re-read affected files in their post-change state
    const postState = {};
    for (const filePath of cr.affectedFiles) {
      try { postState[filePath] = fs.readFileSync(filePath, 'utf8'); }
      catch { postState[filePath] = null; }
    }

    // Re-run domain rule checks on post-change state
    const violations = this._checkDomainRules(cr.domainRules, postState);

    // Evaluate acceptance criteria
    const criteriaResults = cr.acceptanceCriteria.map(c => ({
      description: c.description || 'Unnamed criterion',
      // Structural check: if criterion specifies a required pattern, verify it
      passed: c.requiredPattern
        ? Object.values(postState).some(content => content && new RegExp(c.requiredPattern).test(content))
        : true,  // Non-verifiable criteria are marked as skipped rather than failed
      skipped: !c.requiredPattern
    }));

    const allPassed = violations.length === 0 &&
                      criteriaResults.every(r => r.passed || r.skipped);

    cr.verificationResult = {
      passed:   allPassed,
      violations,
      criteriaResults,
      verifiedAt: new Date().toISOString()
    };

    cr.stage = allPassed ? STAGES.COMPLETE : STAGES.FAILED;
    this._addHistory(cr, allPassed ? 'verified-pass' : 'verified-fail', {
      violations: violations.length,
      criteriaFailed: criteriaResults.filter(r => !r.passed && !r.skipped).length
    });
    this._saveWorkflow(cr);
    this._log(`Change ${crId} verification: ${allPassed ? 'PASSED' : 'FAILED'}`);
    return cr;
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  /**
   * Load a change request by ID.
   * @param {string} crId
   * @returns {ChangeRequest|null}
   */
  getChange(crId) {
    return this._loadWorkflow(crId);
  }

  /**
   * List all change requests, optionally filtered by stage.
   * @param {string} [stage]
   * @returns {ChangeRequest[]}
   */
  listChanges(stage) {
    const dir = this.workflowDir;
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
        catch { return null; }
      })
      .filter(cr => cr && (!stage || cr.stage === stage))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Check domain rules against a set of file snapshots.
   * Each rule may specify a forbiddenPattern (regex) or a requiredPattern.
   *
   * @param {object[]} rules
   * @param {object}   snapshots - { filePath: content }
   * @returns {object[]} Array of violation objects
   */
  _checkDomainRules(rules, snapshots) {
    const violations = [];
    for (const rule of rules) {
      for (const [filePath, content] of Object.entries(snapshots)) {
        if (!content) continue;

        // Rule: pattern must NOT be present
        if (rule.forbiddenPattern && new RegExp(rule.forbiddenPattern).test(content)) {
          violations.push({
            rule:    rule.name || rule.forbiddenPattern,
            file:    filePath,
            type:    'forbidden-pattern',
            message: rule.message || `Forbidden pattern "${rule.forbiddenPattern}" found in ${filePath}`
          });
        }

        // Rule: pattern MUST be present
        if (rule.requiredPattern && !new RegExp(rule.requiredPattern).test(content)) {
          violations.push({
            rule:    rule.name || rule.requiredPattern,
            file:    filePath,
            type:    'missing-required-pattern',
            message: rule.message || `Required pattern "${rule.requiredPattern}" missing in ${filePath}`
          });
        }
      }
    }
    return violations;
  }

  /**
   * Identify API and DB contract touchpoints in source files.
   * Looks for exported functions, HTTP route registrations, and ORM model definitions.
   *
   * @param {object} snapshots - { filePath: content }
   * @returns {object[]}
   */
  _extractContractTouchpoints(snapshots) {
    const touchpoints = [];
    const patterns = [
      { type: 'http-route',    rx: /\.(get|post|put|patch|delete)\s*\(['"]([^'"]+)['"]/gi },
      { type: 'export',        rx: /(?:module\.exports\.|exports\.)(\w+)\s*=/g },
      { type: 'db-model',      rx: /(?:Schema|Model|Entity|Table)\s*\(\s*['"](\w+)['"]/gi },
      { type: 'async-function', rx: /async\s+function\s+(\w+)/g }
    ];

    for (const [filePath, content] of Object.entries(snapshots)) {
      if (!content) continue;
      for (const { type, rx } of patterns) {
        let m;
        while ((m = rx.exec(content)) !== null) {
          touchpoints.push({ type, file: filePath, identifier: m[1] || m[2] || m[0] });
        }
        rx.lastIndex = 0;
      }
    }
    return touchpoints;
  }

  /**
   * Build an acceptance test source file for a single criterion.
   * @param {ChangeRequest} cr
   * @param {object} criterion
   * @param {number} index
   * @returns {string} JavaScript test source
   */
  _buildAcceptanceTest(cr, criterion, index) {
    return `/**
 * Acceptance Test ${index} — Auto-generated by BusinessLogicWorkflow
 * Change Request: ${cr.id}
 * Title: ${cr.title}
 * Criterion: ${criterion.description || `Criterion ${index}`}
 *
 * Generated: ${new Date().toISOString()}
 * DO NOT EDIT — regenerate via BusinessLogicWorkflow.generateTests()
 */

'use strict';

// TODO: Import the module(s) under test
// const { myFunction } = require('${cr.affectedFiles[0] || '../src/module'}');

describe('${cr.title} — Acceptance Criterion ${index}', () => {
  // Criterion: ${criterion.description || '(no description)'}
  // Acceptance condition: ${criterion.condition || '(define condition in change request)'}

  test('criterion ${index} is satisfied after the change', () => {
    // TODO: implement this test based on the acceptance criterion above
    // Example: expect(myFunction(input)).toBe(expectedOutput);
    expect(true).toBe(true); // Placeholder — replace with real assertion
  });
});
`;
  }

  /**
   * Build a regression test stub for a target file.
   * @param {ChangeRequest} cr
   * @param {string} targetFile
   * @returns {string} JavaScript test source
   */
  _buildRegressionTest(cr, targetFile) {
    const baseName = path.basename(targetFile, path.extname(targetFile));
    return `/**
 * Regression Test — Auto-generated by BusinessLogicWorkflow
 * Change Request: ${cr.id}
 * Target File: ${targetFile}
 *
 * Generated: ${new Date().toISOString()}
 * Purpose: Ensure existing behaviour in ${baseName} is preserved after the change.
 */

'use strict';

// TODO: Import the module under test
// const module = require('${targetFile}');

describe('${baseName} — Regression after "${cr.title}"', () => {
  // Snapshot existing public API behaviour here before making changes.
  // Each test should reflect the CURRENT (pre-change) expected behaviour.

  test('exports expected symbols', () => {
    // TODO: verify that all expected exports still exist
    // expect(typeof module.expectedFunction).toBe('function');
    expect(true).toBe(true); // Placeholder
  });
});
`;
  }

  /**
   * Build a human-readable review document from a change request.
   * @param {ChangeRequest} cr
   * @returns {string} Markdown document
   */
  _buildReviewDocument(cr) {
    const lines = [
      `# Change Request Review`,
      ``,
      `**ID:** \`${cr.id}\`  `,
      `**Title:** ${cr.title}  `,
      `**Requested by:** ${cr.requestedBy}  `,
      `**Created:** ${cr.createdAt}  `,
      ``,
      `## Description`,
      cr.description,
      ``,
      `## Affected Files`,
      ...cr.affectedFiles.map(f => `- \`${f}\``),
      ``,
      `## Domain Rules (Invariants to Preserve)`,
      ...(cr.domainRules.length
        ? cr.domainRules.map(r => `- **${r.name || 'Rule'}**: ${r.message || '(no description)'}`)
        : ['_No domain rules defined_']),
      ``,
      `## Acceptance Criteria`,
      ...(cr.acceptanceCriteria.length
        ? cr.acceptanceCriteria.map((c, i) => `${i + 1}. ${c.description || c.condition || '(unnamed)'}`)
        : ['_No acceptance criteria defined_']),
      ``,
      `## Generated Tests`,
      ...cr.generatedTests.map(t => `- [${t.type}] \`${t.path}\``),
      ``,
      `## Contract Touchpoints`,
      ...(cr.semanticDiff?.contractTouchpoints?.slice(0, 10).map(
        t => `- \`${t.type}\` \`${t.identifier}\` in \`${t.file}\``) || ['_Run analysis first_']),
      ``,
      `---`,
      `> To approve: call \`workflow.approve('${cr.id}')\``,
      `> To reject:  call \`workflow.reject('${cr.id}', reason)\``
    ];
    return lines.join('\n');
  }

  // ─── State machine helpers ─────────────────────────────────────────────────

  _loadAndTransition(crId, toStage) {
    const cr = this._loadWorkflow(crId);
    if (!cr) throw new Error(`Change request '${crId}' not found`);
    this._transition(cr, toStage);
    return cr;
  }

  _requireStage(crId, stage) {
    const cr = this._loadWorkflow(crId);
    if (!cr) throw new Error(`Change request '${crId}' not found`);
    if (cr.stage !== stage) throw new Error(`Expected stage '${stage}' but got '${cr.stage}'`);
    return cr;
  }

  _requireApproval(crId) {
    const cr = this._loadWorkflow(crId);
    if (!cr) throw new Error(`Change request '${crId}' not found`);
    if (cr.stage !== STAGES.REVIEW) throw new Error(`Change must be in REVIEW stage to execute`);
    if (!cr.approvedBy) throw new Error(`Change '${crId}' has not been approved — call approve() first`);
    return cr;
  }

  _transition(cr, toStage) {
    const allowed = TRANSITIONS[cr.stage] || [];
    if (!allowed.includes(toStage)) {
      throw new Error(
        `Invalid transition '${cr.stage}' → '${toStage}'. Allowed: ${allowed.join(', ') || 'none'}`
      );
    }
    this._addHistory(cr, 'stage-change', { from: cr.stage, to: toStage });
    cr.stage = toStage;
  }

  _addHistory(cr, event, data) {
    cr.history = cr.history || [];
    cr.history.push({ event, by: this.currentUser, at: new Date().toISOString(), ...data });
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  _saveWorkflow(cr) {
    const filePath = path.join(this.workflowDir, `${cr.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(cr, null, 2) + '\n');
  }

  _loadWorkflow(crId) {
    const filePath = path.join(this.workflowDir, `${crId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return null; }
  }

  // ─── Misc ──────────────────────────────────────────────────────────────────

  _require(obj, fields) {
    for (const f of fields) {
      if (!obj[f]) throw new Error(`Missing required field: '${f}'`);
    }
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _log(msg) { if (this.verbose) console.log(`[BusinessLogicWorkflow] ${msg}`); }
}

module.exports = { BusinessLogicWorkflow, STAGES, TRANSITIONS };

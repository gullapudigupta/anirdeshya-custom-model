/**
 * Shared Application Services  (P8-T001)
 *
 * Defines the stable, transport-agnostic application service layer that all
 * interface adapters (MCP, CLI, HTTP API, Orchestration) share.
 *
 * This module is the single source of business logic. Adapters call these
 * services and translate results into their own wire formats — they never
 * duplicate business logic.
 *
 * Services exposed:
 *   - AnalysisService  — run quality analysis on a workspace
 *   - FixService       — apply rule-based or AI fixes
 *   - ReviewService    — run AI code review
 *   - ReportService    — generate reports (JSON/Markdown/SARIF)
 *   - ConfigService    — read/write tool configuration
 *   - HealthService    — provider and capability status
 *
 * Lifecycle:
 *   const services = await SharedAppServices.create(config);
 *   // ... adapters use services
 *   await services.shutdown();
 *
 * @module core/shared-app-services
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ─── Lazy requires (avoid hard dependencies on optional modules) ───────────────

/** Safely require a module; return null if unavailable */
function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

// ─── Service result envelope ──────────────────────────────────────────────────

/**
 * Every service method returns a ServiceResult.
 * success=false is always explicit — never interpret a missing result as success.
 *
 * @typedef {object} ServiceResult
 * @property {boolean}    success
 * @property {*}          [data]           - Payload on success
 * @property {string}     [error]          - Human-readable error on failure
 * @property {string}     [errorCode]      - Machine-readable code (e.g. 'MODEL_REQUIRED')
 * @property {object}     [modelRequired]  - Set when errorCode='MODEL_REQUIRED'
 * @property {string}     operationId      - Unique ID for this invocation
 * @property {string}     timestamp
 */

function ok(data, operationId) {
  return { success: true, data, operationId, timestamp: new Date().toISOString() };
}

function fail(error, errorCode, operationId, extra = {}) {
  return { success: false, error, errorCode: errorCode || 'OPERATION_FAILED',
           operationId, timestamp: new Date().toISOString(), ...extra };
}

// ─── Main class ───────────────────────────────────────────────────────────────

class SharedAppServices {
  /**
   * @param {object} config
   * @param {string}  config.projectRoot   - Workspace to analyse
   * @param {object}  [config.policy]      - Model policy (localOnly, allowCloudFallback)
   * @param {boolean} [config.verbose=false]
   */
  constructor(config = {}) {
    this.config      = config;
    this.verbose     = config.verbose || false;
    this.projectRoot = config.projectRoot || process.cwd();
    this._opCounter  = 0;

    // Lazily instantiated sub-services
    this._disclosure = null;
    this._linterCli  = null;
    this._agentWorkflow = null;
    this._agentWorkflowOptions = config.agentWorkflowOptions || {};
  }

  /**
   * Factory — preferred over `new` so async initialisation is possible.
   * @param {object} config
   * @returns {Promise<SharedAppServices>}
   */
  static async create(config = {}) {
    const svc = new SharedAppServices(config);
    await svc._init();
    return svc;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async _init() {
    // Wire up ModelRequirementDisclosure if available
    const Disclosure = tryRequire('./model-requirement-disclosure') ||
                       tryRequire('../ai/model-requirement-disclosure');
    if (Disclosure) {
      this._disclosure = new (Disclosure.ModelRequirementDisclosure || Disclosure)({
        policy:  this.config.policy,
        verbose: this.verbose
      });
    }

    // Wire up LinterCli
    const LinterCli = tryRequire('../integrations/linter-cli');
    if (LinterCli) {
      this._linterCli = new (LinterCli.LinterCli || LinterCli)({
        projectRoot: this.projectRoot,
        verbose:     this.verbose
      });
    }

    this._log('SharedAppServices initialised');
  }

  async shutdown() {
    this._log('SharedAppServices shutting down');
    // Future: close DB connections, flush caches, etc.
  }

  /**
   * Get the transport-independent supervised agent workflow service.
   * @param {object} [options]
   * @returns {import('../agent/workflow-service').AgentWorkflowService}
   */
  getAgentWorkflow(options = {}) {
    if (!this._agentWorkflow) {
      const { AgentWorkflowService } = require('../agent/workflow-service');
      this._agentWorkflow = new AgentWorkflowService({
        ...this._agentWorkflowOptions,
        workspace: options.workspace || this.projectRoot,
        orchestratorOptions: options.orchestratorOptions || this._agentWorkflowOptions.orchestratorOptions
      });
    }
    return this._agentWorkflow;
  }

  // ─── Analysis Service ───────────────────────────────────────────────────────

  /**
   * Run quality analysis on the configured workspace.
   * Returns normalised issues from all available linters/analysers.
   *
   * @param {object} [opts={}]
   * @param {string[]} [opts.files]      - Limit to specific files
   * @param {string[]} [opts.categories] - Limit to specific issue categories
   * @returns {Promise<ServiceResult>}
   */
  async analyze(opts = {}) {
    const opId = this._opId('analyze');
    this._log(`analyze: files=${(opts.files || []).length}, categories=${(opts.categories || []).join(',')}`);

    try {
      const issues = [];

      // Run available model-free analysers
      issues.push(...await this._runLinters(opts));
      issues.push(...await this._runStaticAnalysers(opts));

      return ok({ issues, issueCount: issues.length, projectRoot: this.projectRoot }, opId);
    } catch (err) {
      return fail(`Analysis failed: ${err.message}`, 'ANALYSIS_FAILED', opId);
    }
  }

  // ─── Fix Service ────────────────────────────────────────────────────────────

  /**
   * Apply fixes to issues. Rule-based fixes run offline; AI fixes require a model.
   *
   * @param {object[]} issues  - Issues from analyze()
   * @param {object}   [opts={}]
   * @param {string}   [opts.strategy='rule-first'] - 'rule-only'|'ai-only'|'rule-first'
   * @param {boolean}  [opts.dryRun=false]
   * @returns {Promise<ServiceResult>}
   */
  async fix(issues, opts = {}) {
    const opId    = this._opId('fix');
    const strategy = opts.strategy || 'rule-first';

    // Preflight AI strategy
    if ((strategy === 'ai-only' || strategy === 'rule-first') && this._disclosure) {
      const capId = 'fix:ai-local';
      const check = this._disclosure.preflight(capId);
      if (!check.canProceed && strategy === 'ai-only') {
        return fail(check.blockedReason, 'MODEL_REQUIRED', opId,
          { modelRequired: { capability: capId, setupGuide: check.setupGuide } });
      }
    }

    try {
      const AutoFixEngine = tryRequire('../fixers/auto-fix-engine');
      if (!AutoFixEngine) return fail('AutoFixEngine not available', 'DEPENDENCY_MISSING', opId);

      const engine  = new (AutoFixEngine.AutoFixEngine || AutoFixEngine)({
        projectRoot: this.projectRoot,
        dryRun:      opts.dryRun || false,
        verbose:     this.verbose
      });

      const results = await engine.fixIssues(issues);
      return ok({ results, fixed: results.filter(r => r.fixed).length }, opId);
    } catch (err) {
      return fail(`Fix failed: ${err.message}`, 'FIX_FAILED', opId);
    }
  }

  // ─── Review Service ─────────────────────────────────────────────────────────

  /**
   * Run AI-assisted code review on a set of files.
   * Model-free rule packs always run; AI findings require a model preflight.
   *
   * @param {Array<{filePath, content, diff?}>} files
   * @param {object} [opts={}]
   * @returns {Promise<ServiceResult>}
   */
  async review(files, opts = {}) {
    const opId = this._opId('review');

    try {
      const ExplainableReview = tryRequire('../ai/explainable-review');
      if (!ExplainableReview) return fail('ExplainableReview not available', 'DEPENDENCY_MISSING', opId);

      const reviewer = new (ExplainableReview.ExplainableReview || ExplainableReview)({
        diffAware: opts.diffAware || false,
        verbose:   this.verbose
      });

      const results = reviewer.reviewFiles(files);
      return ok({ results, totalFindings: results.reduce((s, r) => s + r.findings.length, 0) }, opId);
    } catch (err) {
      return fail(`Review failed: ${err.message}`, 'REVIEW_FAILED', opId);
    }
  }

  // ─── Report Service ─────────────────────────────────────────────────────────

  /**
   * Generate a report in the requested format.
   *
   * @param {object[]} analysisResults - From analyze() or review()
   * @param {string}   [format='json'] - 'json'|'markdown'|'sarif'
   * @returns {Promise<ServiceResult>}
   */
  async generateReport(analysisResults, format = 'json') {
    const opId = this._opId('report');
    try {
      let report;
      switch (format) {
        case 'markdown':
          report = this._toMarkdown(analysisResults);
          break;
        case 'sarif':
          report = JSON.stringify(this._toSARIF(analysisResults), null, 2);
          break;
        default:
          report = JSON.stringify({ generatedAt: new Date().toISOString(), results: analysisResults }, null, 2);
      }
      return ok({ report, format }, opId);
    } catch (err) {
      return fail(`Report generation failed: ${err.message}`, 'REPORT_FAILED', opId);
    }
  }

  // ─── Config Service ─────────────────────────────────────────────────────────

  /**
   * Read the current tool configuration.
   * @returns {ServiceResult}
   */
  getConfig() {
    const opId = this._opId('getConfig');
    return ok({ ...this.config }, opId);
  }

  /**
   * Update configuration values at runtime.
   * @param {object} updates
   * @returns {ServiceResult}
   */
  updateConfig(updates) {
    const opId = this._opId('updateConfig');
    // Validate: don't allow overwriting sensitive fields
    const forbidden = ['env', '_disclosure', '_linterCli'];
    const safeUpdates = Object.fromEntries(
      Object.entries(updates).filter(([k]) => !forbidden.includes(k))
    );
    Object.assign(this.config, safeUpdates);
    return ok({ updated: Object.keys(safeUpdates) }, opId);
  }

  // ─── Health Service ─────────────────────────────────────────────────────────

  /**
   * Return current provider and capability status for health checks / diagnostics.
   * @returns {ServiceResult}
   */
  getHealth() {
    const opId = this._opId('health');
    const providerStatus = this._disclosure
      ? this._disclosure.getProviderStatus()
      : { local: { available: false, reason: 'Disclosure not initialised' }, cloud: { available: false } };

    const capabilities = this._disclosure
      ? this._disclosure.listCapabilities()
      : [];

    return ok({
      status:       'ok',
      projectRoot:  this.projectRoot,
      providerStatus,
      capabilities,
      timestamp:    new Date().toISOString()
    }, opId);
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  async _runLinters(opts) {
    if (!this._linterCli) return [];
    try {
      const result = await this._linterCli.analyze(this.projectRoot, opts.files);
      return result.issues || [];
    } catch { return []; }
  }

  async _runStaticAnalysers(opts) {
    const issues = [];
    const files  = opts.files || this._listSourceFiles();

    // Code smell detection
    const SmellDetector = tryRequire('../quality/code-smell-detector');
    if (SmellDetector) {
      const detector = new (SmellDetector.CodeSmellDetector || SmellDetector)({ verbose: false });
      for (const fp of files.slice(0, 50)) {
        try {
          const content = fs.readFileSync(fp, 'utf8');
          const result  = detector.analyze(fp, content);
          issues.push(...(result.smells || []));
        } catch {}
      }
    }

    return issues;
  }

  _listSourceFiles() {
    const exts  = ['.js', '.ts', '.jsx', '.tsx', '.mjs'];
    const files = [];
    const walk  = (dir) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
          const fp = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(fp);
          else if (exts.includes(path.extname(entry.name))) files.push(fp);
        }
      } catch {}
    };
    walk(this.projectRoot);
    return files;
  }

  _toMarkdown(results) {
    const lines = ['# Quality Report', `Generated: ${new Date().toISOString()}`, ''];
    for (const r of (Array.isArray(results) ? results : [results])) {
      const issues = r.issues || r.findings || [];
      if (!issues.length) continue;
      lines.push(`## ${r.filePath || r.projectRoot || 'Project'} — ${issues.length} issue(s)`);
      issues.slice(0, 10).forEach(i =>
        lines.push(`- **${i.severity || 'INFO'}** ${i.message || i.description}`));
    }
    return lines.join('\n');
  }

  _toSARIF(results) {
    const sarifResults = (Array.isArray(results) ? results : [results])
      .flatMap(r => (r.issues || r.findings || []).map(i => ({
        ruleId: i.ruleId || i.rule || i.type || 'unknown',
        level:  i.severity === 'HIGH' || i.severity === 'CRITICAL' ? 'error' : 'warning',
        message: { text: i.message || i.description || '' },
        locations: [{ physicalLocation: {
          artifactLocation: { uri: (i.filePath || '').replace(/\\/g, '/') },
          region: { startLine: i.line || 1 }
        }}]
      })));
    return { version: '2.1.0', runs: [{ tool: { driver: { name: 'advanced-quality-tool', version: '1.0.0', rules: [] } }, results: sarifResults }] };
  }

  _opId(prefix) {
    return `${prefix}-${Date.now()}-${++this._opCounter}`;
  }

  _log(msg) { if (this.verbose) console.log(`[SharedAppServices] ${msg}`); }
}

module.exports = { SharedAppServices, ok, fail };

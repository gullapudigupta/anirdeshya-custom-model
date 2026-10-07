/**
 * AI Generation Orchestrator (P6-T012)
 *
 * Coordinates the full AI issue-generation workflow:
 *
 *   classify → context (code + search + dependency docs) → aggregate → prompt →
 *   execute (local, cloud fallback) → apply line edits → verify & recover.
 *
 * Every collaborator is injectable, so the orchestrator runs deterministically in
 * a network-free test and only touches the network when real executors/searchers
 * with transports are supplied.
 */

'use strict';

const { IssueClassifier } = require('./issue-classifier');
const { CodeContextAnalyzer } = require('./code-context-analyzer');
const { ContextAggregator } = require('./context-aggregator');
const { PromptBuilder } = require('./prompt-builder');
const { LineEditor } = require('./line-editor');
const { AIGenerationQualityMetrics } = require('./quality-metrics');

const DEFAULT_OPTIONS = {
  rootDir: process.cwd(),
  queryEngine: null,
  classifier: null,
  contextAnalyzer: null,
  aggregator: null,
  promptBuilder: null,
  lineEditor: null,
  searchers: [],            // [{ search(input) -> {fragments} }]  (doc/github/so)
  dependencyResolver: null, // DependencyDocResolver (T016)
  localExecutor: null,      // LocalExecutor (T008)
  cloudExecutor: null,      // CloudExecutor (T009)
  errorRecovery: null,      // ErrorRecovery (T011)
  rateLimiter: null,        // RateLimiter (T014)
  costTracker: null,        // CostTracker (T014)
  dryRun: false,
  onProgress: null          // (event) => void
};

class AIGenerationOrchestrator {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    const { rootDir, queryEngine } = this.options;

    this.classifier = this.options.classifier || new IssueClassifier({ queryEngine });
    this.contextAnalyzer = this.options.contextAnalyzer || new CodeContextAnalyzer({ queryEngine, rootDir });
    this.aggregator = this.options.aggregator || new ContextAggregator();
    this.promptBuilder = this.options.promptBuilder || new PromptBuilder({ template: this.options.template || null });
    this.lineEditor = this.options.lineEditor || new LineEditor({ rootDir, dryRun: this.options.dryRun });
    this.qualityMetrics = this.options.qualityMetrics || new AIGenerationQualityMetrics();

    this.metrics = { processed: 0, fixed: 0, failed: 0, skipped: 0, recovered: 0, totalCostUsd: 0 };
  }

  /** Process a batch of normalized issues. */
  async run(issues = []) {
    const results = [];
    for (let i = 0; i < issues.length; i++) {
      this._progress({ type: 'issue-start', index: i, total: issues.length, issue: issues[i] });
      const res = await this.processIssue(issues[i]);
      results.push(res);
      this._progress({ type: 'issue-end', index: i, total: issues.length, result: res });
    }
    return { results, metrics: { ...this.metrics }, qualityMetrics: this.qualityMetrics.report() };
  }

  /** Full pipeline for a single issue. */
  async processIssue(issue) {
    const startedAt = Date.now();
    this.metrics.processed++;
    const state = { issue, stage: 'classify' };

    try {
      // 1. Classify
      const classification = this.classifier.classify(issue);
      state.classification = classification;

      // 2. Code context
      state.stage = 'context';
      const codeContext = this.contextAnalyzer.analyze(issue);

      // 3. External + dependency-doc context
      state.stage = 'search';
      const fragments = await this._gatherFragments(classification, issue);

      // 4. Aggregate
      state.stage = 'aggregate';
      const aggregated = this.aggregator.aggregate({ codeContext, classification, fragments });

      // 5. Prompt
      state.stage = 'prompt';
      const prompt = this.promptBuilder.build(classification, codeContext);

      // 6. Execute (rate limit + budget aware)
      state.stage = 'execute';
      const gate = this._checkGates();
      if (!gate.ok) {
        this.metrics.skipped++;
        return this._completeQuality(state, this._result(state, false, gate.reason), startedAt, { skipped: true });
      }

      const exec = await this._execute(prompt);
      if (!exec || !exec.ok) {
        this.metrics.failed++;
        return this._completeQuality(state, this._result(state, false, (exec && exec.error) || 'execution failed'), startedAt);
      }
      if (typeof exec.cost === 'number' && this.options.costTracker) {
        this.options.costTracker.record(exec.cost, { issue: issue.id, provider: exec.provider });
        this.metrics.totalCostUsd = Number((this.metrics.totalCostUsd + exec.cost).toFixed(6));
      }
      state.costUsd = typeof exec.cost === 'number' ? exec.cost : 0;

      // 7. Apply line edits (+ optional recovery)
      state.stage = 'apply';
      const applied = await this._applyWithRecovery(issue, exec.text);
      if (applied.success) {
        this.metrics.fixed++;
        if (applied.recovered) this.metrics.recovered++;
        return this._completeQuality(state, this._result(state, true, null, { applied, aggregated }), startedAt, { recovered: applied.recovered });
      }

      this.metrics.failed++;
      return this._completeQuality(state, this._result(state, false, applied.error || 'apply failed', { aggregated }), startedAt);
    } catch (err) {
      this.metrics.failed++;
      return this._completeQuality(state, this._result(state, false, err.message), startedAt);
    }
  }

  _completeQuality(state, result, startedAt, extra = {}) {
    this.qualityMetrics.record({
      success: result.success,
      skipped: extra.skipped,
      recovered: extra.recovered,
      category: state.classification && state.classification.category,
      costUsd: state.costUsd || 0,
      durationMs: Date.now() - startedAt
    });
    return result;
  }

  // ─── Stages ─────────────────────────────────────────────────────────────────

  async _gatherFragments(classification, issue) {
    const fragments = [];
    for (const searcher of this.options.searchers || []) {
      try {
        const r = await searcher.search(classification || issue);
        if (r && Array.isArray(r.fragments)) fragments.push(...r.fragments);
      } catch { /* individual searcher failures are non-fatal */ }
    }
    if (this.options.dependencyResolver) {
      try {
        const doc = await this.options.dependencyResolver.buildDocContext(issue);
        if (doc && Array.isArray(doc.fragments)) fragments.push(...doc.fragments);
      } catch { /* non-fatal */ }
    }
    return fragments;
  }

  async _execute(prompt) {
    const strategy = (this.options.strategy) || 'local-first';
    const local = this.options.localExecutor;
    const cloud = this.options.cloudExecutor;

    if (strategy !== 'cloud-only' && local && local.available) {
      const r = await local.execute(prompt);
      if (r.ok) return r;
      if (strategy === 'local-only') return r;
    }
    if (strategy !== 'local-only' && cloud && cloud.available) {
      return cloud.execute(prompt);
    }
    // Nothing available (network-free mode).
    return { ok: false, error: 'no executor available (network-free mode)' };
  }

  async _applyWithRecovery(issue, modelText) {
    let plan;
    try { plan = this.lineEditor.parseEditPlan(modelText); }
    catch (err) { return { success: false, error: `unparseable model output: ${err.message}` }; }

    const applyOnce = () => {
      const res = this.lineEditor.applyToFile(issue.file, plan);
      return { files: [issue.file], res };
    };

    if (!this.options.errorRecovery) {
      const { res } = applyOnce();
      return { success: !!res.applied, error: res.applied ? null : (res.errors || []).join('; '), backupPath: res.backupPath };
    }

    // Recovery-driven attempt loop.
    let firstBackup = null;
    const recovery = await this.options.errorRecovery.retry({
      attempt: async () => {
        const { files, res } = applyOnce();
        if (res.backupPath && !firstBackup) firstBackup = res.backupPath;
        return { files, applied: res.applied };
      }
    });
    return { success: recovery.success, recovered: recovery.attempts > 1 && recovery.success, attempts: recovery.attempts, backupPath: firstBackup, error: recovery.success ? null : 'verification failed after retries' };
  }

  // ─── Gates & helpers ──────────────────────────────────────────────────────────

  _checkGates() {
    if (this.options.rateLimiter) {
      const rl = this.options.rateLimiter.check();
      if (!rl.allowed) return { ok: false, reason: `rate limited (retry in ${rl.retryAfterMs}ms)` };
    }
    if (this.options.costTracker && !this.options.costTracker.withinBudget) {
      return { ok: false, reason: 'daily budget exhausted' };
    }
    return { ok: true };
  }

  _result(state, success, error, extra = {}) {
    return {
      issueId: state.issue && state.issue.id,
      file: state.issue && state.issue.file,
      stage: state.stage,
      success,
      error: error || null,
      classification: state.classification || null,
      ...extra
    };
  }

  _progress(event) {
    if (typeof this.options.onProgress === 'function') {
      try { this.options.onProgress(event); } catch { /* ignore */ }
    }
  }
}

module.exports = { AIGenerationOrchestrator };

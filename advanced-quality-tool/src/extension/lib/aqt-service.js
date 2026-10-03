/**
 * AQT Service bridge (P3-T002)
 *
 * Framework-free adapter between the VS Code extension and the tool's core
 * Node APIs. Requires no `vscode` module so it is unit-testable and reusable.
 *
 * Dependencies are injected (constructor `deps`) so tests can supply fakes for
 * the linter orchestrator and fix engine and stay fully offline.
 *
 * @module extension/lib/aqt-service
 */

const path = require('path');

// Lazily-resolved defaults so tests can inject fakes without loading the real
// linter stack (which shells out to external binaries).
function defaultDeps() {
  const { LinterOrchestrator } = require('../../integrations/linter-cli');
  const normalizer = require('../../integrations/issue-normalizer');
  const { AutoFixEngine } = require('../../fixers/auto-fix-engine');
  return { LinterOrchestrator, normalizer, AutoFixEngine };
}

class AqtService {
  /**
   * @param {string} projectRoot absolute workspace root
   * @param {object} [deps] { LinterOrchestrator, normalizer, AutoFixEngine }
   */
  constructor(projectRoot, deps) {
    this.projectRoot = projectRoot;
    this.deps = deps || defaultDeps();
  }

  /**
   * Run available linters and return normalized, deduplicated, sorted issues.
   *
   * @param {object} [options]
   * @param {string[]} [options.files] specific files (relative or absolute)
   * @param {string[]} [options.linters] subset of linters to run
   * @returns {Promise<{issues:object[], summary:object, stats:object}>}
   */
  async analyze(options = {}) {
    const { LinterOrchestrator, normalizer } = this.deps;
    const orchestrator = new LinterOrchestrator(this.projectRoot);

    const runResult = await orchestrator.runAll(options.files || [], {
      linters: options.linters && options.linters.length ? options.linters : null,
      verbose: false
    });

    const normalized = (runResult.issues || []).map((raw) =>
      normalizer.normalizeIssue(raw, this.projectRoot)
    );
    const { unique } = normalizer.deduplicateIssues(normalized);
    unique.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    return {
      issues: unique,
      summary: runResult.summary || {},
      stats: normalizer.getIssueStats(unique)
    };
  }

  /**
   * Group issues by absolute file path for the fix engine.
   *
   * @param {object[]} issues
   * @returns {Object<string, object[]>}
   */
  groupByFile(issues) {
    const map = {};
    for (const issue of issues) {
      const abs = path.isAbsolute(issue.file)
        ? issue.file
        : path.join(this.projectRoot, issue.file);
      // The fix engine reads issue.line; mirror startLine onto it.
      const withLine = { ...issue, line: issue.line || issue.startLine };
      (map[abs] = map[abs] || []).push(withLine);
    }
    return map;
  }

  /**
   * Fix the given issues using the AutoFixEngine.
   *
   * @param {object[]} issues normalized issues to fix
   * @param {object} [options] { dryRun, strategy, minConfidence, backup }
   * @returns {Promise<object[]>} per-file fix results
   */
  async fix(issues, options = {}) {
    const { AutoFixEngine } = this.deps;
    const engine = new AutoFixEngine({
      dryRun: !!options.dryRun,
      verbose: false,
      backup: options.backup !== false,
      strategy: options.strategy || 'rule-only',
      minConfidence: typeof options.minConfidence === 'number' ? options.minConfidence : 0.7,
      // Keep AI off unless explicitly requested so the IDE stays offline/fast.
      localAI: { enabled: options.strategy && options.strategy !== 'rule-only' },
      cloudAI: { enabled: false }
    });

    const issuesMap = this.groupByFile(issues);
    return engine.fixFiles(issuesMap, { continueOnError: true });
  }

  /**
   * Detect which linters are available in the workspace.
   * @returns {Object<string, boolean>}
   */
  detectLinters() {
    const { LinterOrchestrator } = this.deps;
    return new LinterOrchestrator(this.projectRoot).detectAvailableLinters();
  }
}

module.exports = { AqtService };

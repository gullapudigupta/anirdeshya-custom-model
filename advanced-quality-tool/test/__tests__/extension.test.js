/**
 * VS Code extension tests (P3-T009)
 *
 * Exercises the vscode-agnostic units under src/extension/lib and the
 * AqtService bridge with injected fakes. Fully offline: no `vscode` module,
 * no external linters, no network. Runs under the project's node harness
 * (`node test/run.js`).
 *
 * @module test/extension
 */

const path = require('path');

const config = require('../../src/extension/lib/config');
const diag = require('../../src/extension/lib/diagnostics-provider');
const codeActions = require('../../src/extension/lib/code-actions-provider');
const statusBar = require('../../src/extension/lib/status-bar');
const webview = require('../../src/extension/lib/webview-panel');
const { AqtService } = require('../../src/extension/lib/aqt-service');

function makeIssue(overrides = {}) {
  return {
    id: overrides.id || 'issue-1',
    type: 'STYLE-001',
    title: 'Missing semicolon',
    message: 'Missing semicolon',
    file: 'src/app.js',
    startLine: 10,
    endLine: 10,
    startColumn: 5,
    endColumn: 6,
    severity: 'WARNING',
    category: 'STYLE',
    fileType: 'javascript',
    autoFixLevel: 'AUTO',
    priority: 100,
    priorityClass: 'P1',
    source: 'eslint',
    rule: 'semi',
    metadata: {},
    ...overrides
  };
}

describe('extension/config.normalizeConfig', () => {
  test('applies defaults for an empty object', () => {
    const c = config.normalizeConfig({});
    expect(c.enable).toBe(true);
    expect(c.fixStrategy).toBe('rule-only');
    expect(c.minConfidence).toBe(0.7);
    expect(c.linters).toEqual([]);
    expect(c.severityFloor).toBe('SUGGESTION');
  });

  test('clamps minConfidence into [0,1]', () => {
    expect(config.normalizeConfig({ minConfidence: 5 }).minConfidence).toBe(1);
    expect(config.normalizeConfig({ minConfidence: -3 }).minConfidence).toBe(0);
    expect(config.normalizeConfig({ minConfidence: 'x' }).minConfidence).toBe(0.7);
  });

  test('filters unknown linters and invalid enums', () => {
    const c = config.normalizeConfig({
      linters: ['eslint', 'bogus', 'prettier'],
      fixStrategy: 'nope',
      severityFloor: 'WHATEVER'
    });
    expect(c.linters).toEqual(['eslint', 'prettier']);
    expect(c.fixStrategy).toBe('rule-only');
    expect(c.severityFloor).toBe('SUGGESTION');
  });
});

describe('extension/config.meetsSeverityFloor', () => {
  test('CRITICAL passes an ERROR floor; INFO does not', () => {
    expect(config.meetsSeverityFloor('CRITICAL', 'ERROR')).toBe(true);
    expect(config.meetsSeverityFloor('ERROR', 'ERROR')).toBe(true);
    expect(config.meetsSeverityFloor('INFO', 'ERROR')).toBe(false);
  });

  test('everything passes the SUGGESTION floor', () => {
    for (const s of config.SEVERITIES) {
      expect(config.meetsSeverityFloor(s, 'SUGGESTION')).toBe(true);
    }
  });
});

describe('extension/diagnostics-provider', () => {
  test('maps severities to VS Code values', () => {
    expect(diag.mapSeverity('CRITICAL')).toBe(diag.VS_SEVERITY.Error);
    expect(diag.mapSeverity('ERROR')).toBe(diag.VS_SEVERITY.Error);
    expect(diag.mapSeverity('WARNING')).toBe(diag.VS_SEVERITY.Warning);
    expect(diag.mapSeverity('INFO')).toBe(diag.VS_SEVERITY.Information);
    expect(diag.mapSeverity('SUGGESTION')).toBe(diag.VS_SEVERITY.Hint);
  });

  test('toDiagnostic converts 1-based issue to 0-based range', () => {
    const d = diag.toDiagnostic(makeIssue());
    expect(d.range.startLine).toBe(9);
    expect(d.range.startColumn).toBe(4);
    expect(d.source).toBe('aqt:eslint');
    expect(d.code).toBe('semi');
    expect(d.fixable).toBe(true);
  });

  test('toDiagnosticsByFile groups and applies severity floor', () => {
    const issues = [
      makeIssue({ id: 'a', severity: 'ERROR', file: 'src/a.js' }),
      makeIssue({ id: 'b', severity: 'SUGGESTION', file: 'src/a.js' }),
      makeIssue({ id: 'c', severity: 'WARNING', file: 'src/b.js' })
    ];
    const byFile = diag.toDiagnosticsByFile(issues, { severityFloor: 'WARNING' });
    expect(byFile['src/a.js']).toHaveLength(1); // SUGGESTION filtered out
    expect(byFile['src/b.js']).toHaveLength(1);
  });
});

describe('extension/code-actions-provider', () => {
  test('fixable issue gets a preferred quick-fix bound to aqt.fixIssue', () => {
    const actions = codeActions.buildActions(makeIssue({ id: 'zz' }));
    const fix = actions.find((a) => a.command && a.command.command === 'aqt.fixIssue');
    expect(fix).toBeDefined();
    expect(fix.isPreferred).toBe(true);
    expect(fix.command.arguments).toEqual(['zz']);
    expect(fix.kind).toBe('quickfix');
  });

  test('non-fixable issue gets no quick-fix action', () => {
    const actions = codeActions.buildActions(makeIssue({ autoFixLevel: 'MANUAL' }));
    const fix = actions.find((a) => a.command && a.command.command === 'aqt.fixIssue');
    expect(fix).toBeUndefined();
  });

  test('adds a documentation action when metadata.documentation is present', () => {
    const actions = codeActions.buildActions(
      makeIssue({ autoFixLevel: 'MANUAL', metadata: { documentation: 'https://x/y' } })
    );
    const doc = actions.find((a) => a.command && a.command.command === 'vscode.open');
    expect(doc).toBeDefined();
    expect(doc.command.arguments).toEqual(['https://x/y']);
  });
});

describe('extension/status-bar.renderStatus', () => {
  test('idle and analyzing states', () => {
    expect(statusBar.renderStatus({ status: 'idle' }).text).toContain('AQT');
    expect(statusBar.renderStatus({ status: 'analyzing' }).text).toContain('analyzing');
  });

  test('done with zero issues reports clean', () => {
    const r = statusBar.renderStatus({ status: 'done', issueCount: 0 });
    expect(r.text).toContain('clean');
    expect(r.severity).toBe('none');
  });

  test('done with errors reports error severity and count', () => {
    const r = statusBar.renderStatus({ status: 'done', issueCount: 3, errorCount: 2, warningCount: 1 });
    expect(r.text).toContain('3');
    expect(r.severity).toBe('error');
  });

  test('error state surfaces message', () => {
    const r = statusBar.renderStatus({ status: 'error', message: 'boom' });
    expect(r.severity).toBe('error');
    expect(r.tooltip).toContain('boom');
  });
});

describe('extension/webview-panel.renderHtml', () => {
  test('renders a row per issue and a fix button for fixable issues', () => {
    const html = webview.renderHtml([makeIssue()], { total: 1, fixable: 1, bySeverity: { WARNING: 1 } });
    expect(html).toContain('Advanced Quality Tool');
    expect(html).toContain('data-id="issue-1"');
    expect(html).toContain('button class="fix"');
  });

  test('empty issue list shows the clean message', () => {
    const html = webview.renderHtml([], {});
    expect(html).toContain('No issues found');
  });

  test('escapes HTML in issue messages to prevent injection', () => {
    const evil = makeIssue({ message: '<img src=x onerror=alert(1)>', file: 'a<b>.js' });
    const html = webview.renderHtml([evil], {});
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('extension/aqt-service (injected fakes)', () => {
  const projectRoot = path.join('/tmp', 'proj');

  function fakeDeps(runIssues) {
    return {
      LinterOrchestrator: class {
        constructor(root) { this.root = root; }
        detectAvailableLinters() { return { eslint: true, prettier: false }; }
        async runAll() {
          return { issues: runIssues, summary: { eslint: { success: true, issueCount: runIssues.length } }, totalIssues: runIssues.length };
        }
      },
      normalizer: require('../../src/integrations/issue-normalizer'),
      AutoFixEngine: class {
        constructor(opts) { this.opts = opts; }
        async fixFiles(issuesMap) {
          return Object.keys(issuesMap).map((f) => ({ filePath: f, success: true, fixedIssueCount: issuesMap[f].length }));
        }
      }
    };
  }

  test('analyze normalizes, dedups and sorts by priority', async () => {
    const raw = [
      { file: 'src/a.js', startLine: 1, type: 'STYLE-001', rule: 'semi', severity: 'WARNING', category: 'STYLE', message: 'x', fileType: 'javascript', autoFixLevel: 'AUTO', source: 'eslint' },
      { file: 'src/a.js', startLine: 2, type: 'SEC-004', rule: 'no-eval', severity: 'CRITICAL', category: 'SECURITY', message: 'eval', fileType: 'javascript', autoFixLevel: 'MANUAL', source: 'eslint' }
    ];
    const svc = new AqtService(projectRoot, fakeDeps(raw));
    const result = await svc.analyze({});
    expect(result.issues).toHaveLength(2);
    // CRITICAL should sort ahead of WARNING by priority.
    expect(result.issues[0].severity).toBe('CRITICAL');
    expect(result.stats.total).toBe(2);
  });

  test('groupByFile keys by absolute path and mirrors startLine onto line', () => {
    const svc = new AqtService(projectRoot, fakeDeps([]));
    const grouped = svc.groupByFile([makeIssue({ file: 'src/app.js', startLine: 10 })]);
    const key = path.join(projectRoot, 'src/app.js');
    expect(grouped[key]).toBeDefined();
    expect(grouped[key][0].line).toBe(10);
  });

  test('fix delegates to AutoFixEngine.fixFiles and returns per-file results', async () => {
    const svc = new AqtService(projectRoot, fakeDeps([]));
    const results = await svc.fix([makeIssue({ file: 'src/app.js' })], { strategy: 'rule-only' });
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  test('detectLinters proxies orchestrator', () => {
    const svc = new AqtService(projectRoot, fakeDeps([]));
    expect(svc.detectLinters()).toEqual({ eslint: true, prettier: false });
  });
});

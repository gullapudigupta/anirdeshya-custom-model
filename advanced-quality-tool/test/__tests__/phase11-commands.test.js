'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseOptions: parseReportOptions,
  renderHtml,
  renderSarif,
  renderTemplate
} = require('../../src/commands/report-command');
const {
  parseOptions: parseMetricsOptions,
  collectSourceFiles
} = require('../../src/commands/metrics-command');
const {
  loadDashboardConfig,
  saveDashboardConfig,
  recordIfEnabled
} = require('../../src/commands/dashboard-command');
const { UsageAnalytics } = require('../../src/metrics/usage-analytics');
const { AIGenerationQualityMetrics } = require('../../src/ai-generator/quality-metrics');
const { parseArguments: parseFixArguments, normalizeLinterIssue } = require('../../src/commands/fix-command');
const { AutoFixEngine } = require('../../src/fixers/auto-fix-engine');
const { TemplateManager } = require('../../src/ai-generator/template-manager');
const { PromptBuilder } = require('../../src/ai-generator/prompt-builder');
const { PRIntegrator } = require('../../src/integrations/pr-integrator');
const { PluginManager } = require('../../src/plugins/plugin-system');
const { AIFixer } = require('../../src/fixers/ai-fixer');
const { ExternalCliIntegration, EXTERNAL_LINTERS } = require('../../src/integrations/linter-cli');
const { MCP_TOOLS } = require('../../src/integrations/mcp-server');
const { HttpApiServer } = require('../../src/integrations/http-api-server');
const { AIGenerationOrchestrator } = require('../../src/ai-generator/orchestrator');

describe('Phase 11 CLI commands', () => {
  test('report accepts HTML and SARIF formats and escapes untrusted HTML content', () => {
    const options = parseReportOptions(['--input', 'issues.json', '--format', 'html']);
    expect(options.format).toBe('html');
    const html = renderHtml([{ message: '<script>alert(1)</script>', file: 'src/app.js' }]);
    expect(html).toContain('&lt;script&gt;');
    expect(renderSarif([{ severity: 'HIGH', message: 'unsafe', file: 'src/app.js' }])).toContain('"level": "error"');
  });

  test('custom report templates reject unknown placeholders', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-report-'));
    const template = path.join(root, 'template.md');
    fs.writeFileSync(template, '{{missing}}', 'utf8');
    let message = '';
    try {
      renderTemplate(template, [], 'markdown');
    } catch (error) {
      message = error.message;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    expect(message).toContain('Unknown template placeholder');
  });

  test('metrics validates numeric thresholds and discovers JavaScript files without dependencies', () => {
    expect(parseMetricsOptions(['--threshold', '7']).threshold).toBe(7);
    let message = '';
    try {
      parseMetricsOptions(['--threshold', '0']);
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain('positive number');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-metrics-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'src', 'app.js'), 'const ok = true;', 'utf8');
    fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'const no = true;', 'utf8');
    try {
      expect(collectSourceFiles(root)).toEqual([path.join(root, 'src', 'app.js')]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('dashboard recording stays disabled until explicitly enabled', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-dashboard-'));
    try {
      expect(loadDashboardConfig(root).enabled).toBe(false);
      expect(recordIfEnabled(root, [{ issues: [] }])).toBeNull();
      const config = loadDashboardConfig(root);
      config.enabled = true;
      saveDashboardConfig(root, config);
      const record = recordIfEnabled(root, [{ filePath: 'src/app.js', issues: [] }]);
      expect(record.metrics.files.analyzed).toBe(1);
      expect(loadDashboardConfig(root).enabled).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('usage analytics are local, opt-in, and exclude arbitrary event data', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-analytics-'));
    try {
      const analytics = new UsageAnalytics({ workspace: root });
      expect(analytics.status()).toEqual({ enabled: false, storage: 'local', uploads: false });
      expect(analytics.record('analyze', { success: true, filePath: 'private.js' })).toBe(false);
      analytics.setEnabled(true);
      expect(analytics.record('analyze', { success: false, durationMs: 12, prompt: 'private text' })).toBe(true);
      const report = analytics.report(30);
      expect(report.commands.analyze).toEqual({ count: 1, successes: 0, failures: 1, durationMs: 12 });
      const stored = fs.readFileSync(path.join(root, '.aqt', 'usage-metrics.json'), 'utf8');
      expect(stored).not.toContain('private.js');
      expect(stored).not.toContain('private text');
      analytics.clear();
      expect(fs.existsSync(path.join(root, '.aqt', 'usage-metrics.json'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('AI quality metrics aggregate only outcomes and validate numeric fields', () => {
    const metrics = new AIGenerationQualityMetrics();
    metrics.record({ success: true, category: 'security', durationMs: 10, costUsd: 0.2 });
    metrics.record({ skipped: true, category: 'security', durationMs: 5 });
    const report = metrics.report();
    expect(report.processed).toBe(2);
    expect(report.fixed).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.successRate).toBe(50);
    expect(report.categories.security.processed).toBe(2);
    let error = '';
    try {
      metrics.record({ durationMs: -1 });
    } catch (err) {
      error = err.message;
    }
    expect(error).toContain('durationMs');
  });

  test('AI orchestrator returns outcome quality metrics for completed issues', async () => {
    const orchestrator = new AIGenerationOrchestrator({
      classifier: { classify: () => ({ category: 'style', severity: 'low' }) },
      contextAnalyzer: { analyze: () => ({ snippet: { text: 'let value = 1;', startLine: 1 } }) },
      aggregator: { aggregate: () => ({}) },
      promptBuilder: { build: () => ({ user: 'Fix the issue' }) },
      localExecutor: {
        available: true,
        execute: async () => ({ ok: true, text: '{"edits":[],"explanation":"No change required"}', cost: 0.01 })
      },
      lineEditor: {
        parseEditPlan: () => ({}),
        applyToFile: () => ({ applied: true })
      }
    });
    const result = await orchestrator.run([{ id: 'issue-1', file: 'src/app.js' }]);
    expect(result.qualityMetrics.processed).toBe(1);
    expect(result.qualityMetrics.fixed).toBe(1);
    expect(result.qualityMetrics.categories.style.successRate).toBe(100);
  });

  test('fix command exposes AI-fix opt-in and opt-out while preserving its default', () => {
    expect(parseFixArguments([]).useAiFixes).toBe(true);
    expect(parseFixArguments(['--use-ai-fixes']).useAiFixes).toBe(true);
    expect(parseFixArguments(['--no-ai-fixes']).useAiFixes).toBe(false);
    const engine = new AutoFixEngine({ useAiFixes: false });
    expect(engine.useAiFixes).toBe(false);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-fix-'));
    const file = path.join(root, 'app.js');
    fs.writeFileSync(file, 'const app = true;', 'utf8');
    try {
      const normalized = normalizeLinterIssue({ file: 'app.js', startLine: 2, rule: 'semi' }, root);
      expect(normalized.filePath).toBe(file);
      expect(normalized.line).toBe(2);
      expect(normalized.ruleId).toBe('semi');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    expect(parseFixArguments(['--help']).help).toBe(true);
  });

  test('AI fixes still require confidence and syntax validation', async () => {
    const validator = new AIFixer();
    const syntax = await validator.validateFix('const value = 1;', 'const = ;', { filePath: 'app.js' });
    expect(syntax.valid).toBe(false);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-ai-fix-'));
    const file = path.join(root, 'app.js');
    const original = 'const value = 1;';
    fs.writeFileSync(file, original, 'utf8');
    try {
      const engine = new AutoFixEngine({ backup: false, minConfidence: 0.8 });
      engine.aiCoordinator = {
        generateFix: async () => ({ fixedCode: 'const value = 2;', confidence: 0.5, errors: [] })
      };
      const result = await engine.applyAIFixes(file, [{ line: 1, ruleId: 'complexity' }]);
      expect(result.fixedCount).toBe(0);
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('custom AI templates validate placeholders, persist locally, and render prompt context', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-template-'));
    try {
      const templates = new TemplateManager({ rootDir: root });
      templates.save('concise', 'Issue: {{summary}}\n{{context}}\n{{outputContract}}');
      expect(templates.list()).toEqual(['concise']);
      expect(templates.get('concise')).toContain('{{summary}}');
      const prompt = new PromptBuilder({ template: templates.get('concise') }).build(
        { summary: 'Use const', severity: 'low', category: 'style' },
        { file: 'src/app.js', snippet: { text: 'let value = 1;', startLine: 3 } }
      );
      expect(prompt.user).toContain('Issue: Use const');
      expect(prompt.user).toContain('3| let value = 1;');
      let error = '';
      try {
        templates.save('bad', '{{secret}}');
      } catch (err) {
        error = err.message;
      }
      expect(error).toContain('Unknown AI template placeholder');
      templates.remove('concise');
      expect(templates.list()).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('PR integration posts inline comments with retry for transient provider errors', async () => {
    const calls = [];
    const integrator = new PRIntegrator({
      provider: 'github',
      token: 'test-token',
      maxRetries: 1,
      retryDelayMs: 0,
      requestFn: async (options, body) => {
        calls.push({ options, body });
        return calls.length === 1
          ? { ok: false, statusCode: 503, error: 'temporarily unavailable' }
          : { ok: true, statusCode: 201, data: { id: 42, html_url: 'https://example.test/review/42' } };
      }
    });
    const result = await integrator.postInlineComment({
      repo: 'owner/repo',
      prNumber: 7,
      path: 'src/app.js',
      line: 4,
      body: 'Please review this change.',
      commitSha: 'abc123'
    });
    expect(result.success).toBe(true);
    expect(result.commentId).toBe(42);
    expect(calls).toHaveLength(2);
    expect(calls[1].options.path).toBe('/repos/owner/repo/pulls/7/comments');
    expect(calls[1].body.line).toBe(4);
    expect(calls[1].body.commit_id).toBe('abc123');
  });

  test('plugin examples load through the plugin manager API', async () => {
    const pluginRoot = path.resolve(__dirname, '../../examples/plugins');
    const manager = new PluginManager({
      pluginDirs: [pluginRoot],
      stateFile: path.join(os.tmpdir(), `aqt-plugin-state-${Date.now()}.json`)
    });
    await manager.initialize();
    expect(manager.plugins.size).toBe(2);
    expect(manager.customRules.has('no-todo-rule:no-todo-marker')).toBe(true);
    expect(manager.hooks.has('afterAnalysis')).toBe(true);
  });

  test('external linter adapters expose expected language tools and normalize output', () => {
    expect(Object.keys(EXTERNAL_LINTERS)).toEqual([
      'pylint', 'flake8', 'black', 'rubocop', 'golint', 'staticcheck', 'clippy', 'phpcs', 'swiftlint'
    ]);
    const flake8 = new ExternalCliIntegration(process.cwd(), 'flake8');
    const issues = flake8.parse('src/app.py:4:2: E501 line too long');
    expect(issues).toHaveLength(1);
    expect(issues[0].filePath).toBe('src/app.py');
    expect(issues[0].line).toBe(4);
  });

  test('dashboard and plugin API routes are registered and MCP tools are exported', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-api-'));
    try {
      const api = new HttpApiServer({ projectRoot: root, auth: { enabled: true, secret: 'test-only' } });
      const routes = api.app._router.stack
        .filter(layer => layer.route)
        .map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
      expect(routes).toContain('POST /api/dashboard/configure');
      expect(routes).toContain('GET /api/dashboard/metrics');
      expect(routes).toContain('POST /api/plugins/install');
      expect(MCP_TOOLS.map(tool => tool.name)).toContain('aqt_dashboard_status');
      expect(MCP_TOOLS.map(tool => tool.name)).toContain('aqt_plugin_remove');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

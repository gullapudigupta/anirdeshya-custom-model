/**
 * Tests for the AI Issue Generator (Phase 6) — network-free.
 * Run: node tests/ai-generator/generator.test.js
 *
 * Covers the modules added in P6-T003..T005, T008..T009, T011..T014, T016 plus a
 * full orchestrator run using stub executors/searchers (no real network).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DocSearcher, GitHubSearcher, StackOverflowSearcher, SearchCache,
  DependencyDocResolver, LocalExecutor, CloudExecutor, ErrorRecovery,
  AIGenerationOrchestrator, loadConfig, RateLimiter, CostTracker
} = require('../../src/ai-generator');

let passed = 0;
function ok(label, cond) { assert.ok(cond, label); console.log('✓', label); passed++; }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-aigen-'));

// ── Search adapters (T003–T005) ────────────────────────────────────────────────
async function runSuite() {
  const issue = { rule: 'semi', message: 'Missing semicolon', category: 'STYLE' };

  const docs = await new DocSearcher({ rootDir: tmp }).search(issue);
  ok('DocSearcher offline fallback returns a fragment', docs.fragments.length === 1);

  const gh = await new GitHubSearcher({ rootDir: tmp }).search(issue);
  ok('GitHubSearcher network-free returns empty + note', gh.fragments.length === 0 && /transport/.test(gh.error));

  // Injected transport + cache
  const ghFetch = async () => ({ ok: true, json: async () => ({ items: [{ title: 'Fix', body: '```js\nx;\n```', html_url: 'u', reactions: { total_count: 3 }, comments: 1 }] }) });
  const g2 = new GitHubSearcher({ fetchImpl: ghFetch, cacheDir: path.join(tmp, 'c') });
  const r1 = await g2.search({ message: 'missing semicolon' });
  const r2 = await g2.search({ message: 'missing semicolon' });
  ok('GitHubSearcher parses + caches injected response', r1.fragments.length === 1 && r2.fromCache === true);

  const soFetch = async () => ({ ok: true, json: async () => ({ items: [{ title: 'Q &lt;x&gt;', body: '<pre><code>let a=1;</code></pre>', link: 'l', score: 5, is_answered: true, accepted_answer_id: 1 }] }) });
  const so = await new StackOverflowSearcher({ fetchImpl: soFetch, cacheDir: path.join(tmp, 'c2') }).search({ message: 'x' });
  ok('StackOverflowSearcher decodes + extracts code', so.fragments[0].text === 'let a=1;' && so.fragments[0].title === 'Q <x>');

  const cache = new SearchCache({ cacheDir: path.join(tmp, 'c3') });
  cache.set('docs', 'q', [{ title: 't' }]);
  ok('SearchCache round-trips', Array.isArray(cache.get('docs', 'q')) && cache.get('docs', 'missing') === null);

  // ── Dependency doc resolver (T016) ────────────────────────────────────────────
  const projDir = path.join(tmp, 'proj');
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({ dependencies: { react: '^18', express: '^4' }, devDependencies: { eslint: '^9', typescript: '^5' } }));
  const resolver = new DependencyDocResolver({ rootDir: projDir });
  const sources = resolver.resolveDocSources();
  ok('DependencyDocResolver detects known deps', sources.some(s => s.name === 'react') && sources.some(s => s.name === 'eslint') && sources.some(s => s.name === 'typescript'));
  const docCtx = await resolver.buildDocContext({ message: 'issue' });
  ok('DependencyDocResolver builds doc fragments', docCtx.fragments.length >= 3 && docCtx.fragments.every(f => f.source === 'docs' && f.reference));

  // ── Executors (T008–T009) ─────────────────────────────────────────────────────
  const local = new LocalExecutor();
  const localOff = await local.execute({ system: 's', user: 'u' });
  ok('LocalExecutor network-free returns not-ok', localOff.ok === false && /transport/.test(localOff.error));

  const okChat = { ok: true, json: async () => ({ message: { content: '{"edits":[],"explanation":"none"}' } }) };
  const local2 = new LocalExecutor({ fetchImpl: async () => okChat });
  const lr = await local2.execute({ system: 's', user: 'u' });
  ok('LocalExecutor parses /api/chat response', lr.ok && lr.text.includes('edits'));

  let calls = 0;
  const flaky = async () => { calls++; return calls < 2 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ message: { content: 'done' } }) }; };
  const local3 = new LocalExecutor({ fetchImpl: flaky, retryDelayMs: 1 });
  const lr3 = await local3.execute({ user: 'u' });
  ok('LocalExecutor retries on 503', lr3.ok && lr3.attempts === 2);

  const cloudOff = await new CloudExecutor({ provider: 'openai' }).execute({ user: 'u' });
  ok('CloudExecutor disabled without key/transport', cloudOff.ok === false);

  const openaiFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'fix' } }], usage: { prompt_tokens: 1000, completion_tokens: 1000 } }) });
  const cloud = new CloudExecutor({ fetchImpl: openaiFetch, provider: 'openai', model: 'gpt-4o-mini', apiKey: 'k' });
  const cr = await cloud.execute({ system: 's', user: 'u' });
  ok('CloudExecutor parses + tracks cost', cr.ok && cr.cost > 0 && cloud.getCostReport().totalTokens.input === 1000);

  // ── Error recovery (T011) ──────────────────────────────────────────────────────
  let attempt = 0;
  const recovery = new ErrorRecovery({
    maxAttempts: 3,
    buildValidator: async () => (attempt >= 2 ? { ok: true, errors: [] } : { ok: false, errors: [{ file: 'a.js', line: 3, message: 'x is not defined' }] })
  });
  const rr = await recovery.retry({ attempt: async () => { attempt++; return { files: ['a.js'] }; } });
  ok('ErrorRecovery retries until build passes', rr.success && rr.attempts === 2);
  const enh = recovery.buildEnhancedContext({ file: 'a.js', line: 3, message: 'C:\\p\\a.js:3:1 x is not defined' });
  ok('ErrorRecovery builds enhanced context + clean search query', enh.searchQuery === 'x is not defined' && enh.file === 'a.js');

  // ── Config / limits / cost (T014) ──────────────────────────────────────────────
  const cfg = loadConfig({ rootDir: tmp, overrides: { limits: { dailyBudgetUsd: 2 } } });
  ok('loadConfig merges defaults + overrides', cfg.execution.strategy === 'local-first' && cfg.limits.dailyBudgetUsd === 2);

  const rl = new RateLimiter({ requestsPerMinute: 2 });
  ok('RateLimiter allows then blocks', rl.check().allowed && rl.check().allowed && rl.check().allowed === false);

  const ct = new CostTracker({ dailyBudgetUsd: 0.01, reportsDir: path.join(tmp, 'reports') });
  ct.record(0.005, { issue: 'i1' });
  ok('CostTracker records + reports within budget', ct.getReport().spentUsd === 0.005 && ct.withinBudget);
  ct.record(0.02, { issue: 'i2' });
  ok('CostTracker flags budget exhausted', ct.withinBudget === false);

  // ── Orchestrator end-to-end (T012) ──────────────────────────────────────────────
  const srcFile = path.join(tmp, 'target.js');
  fs.writeFileSync(srcFile, ['const a = 1', 'const b = 2', 'const c = 3'].join('\n'), 'utf8');
  const targetIssue = { id: 'i-1', file: srcFile, startLine: 2, endLine: 2, severity: 'WARNING', category: 'STYLE', rule: 'semi', message: 'Missing semicolon' };

  const stubExecutor = {
    available: true,
    async execute() { return { ok: true, text: '{"edits":[{"startLine":2,"endLine":2,"replacement":"const b = 2;"}],"explanation":"add semi"}', provider: 'stub', cost: 0 }; }
  };
  const orchestrator = new AIGenerationOrchestrator({
    rootDir: tmp,
    strategy: 'local-only',
    localExecutor: stubExecutor,
    searchers: [new DocSearcher({ rootDir: tmp })]
  });
  const { results, metrics } = await orchestrator.run([targetIssue]);
  ok('Orchestrator fixes issue end-to-end', metrics.fixed === 1 && results[0].success);
  ok('Orchestrator wrote the line edit', fs.readFileSync(srcFile, 'utf8').includes('const b = 2;'));

  // cleanup
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\nAll ${passed} AI-generator tests passed.`);
}

// Register with the shared test runner when loaded by it; otherwise run standalone.
if (typeof global.test === 'function') {
  global.test('AI issue generator network-free suite (Phase 6)', runSuite);
} else {
  runSuite().catch((err) => { console.error('\n✗ TEST FAILED:', err.message); process.exit(1); });
}

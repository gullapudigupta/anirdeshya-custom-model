/**
 * Generate Fixes Command — CLI handler for the AI Issue Generator (P6-T013)
 *
 * Usage:
 *   aqt generate-fixes [files...] [options]
 *
 * Options:
 *   --dry-run             Plan/execute without writing files
 *   --strategy <s>        local-first (default) | local-only | cloud-only
 *   --local-ai-model <m>  Ollama model (default from config)
 *   --cloud-ai            Enable cloud fallback
 *   --cloud-provider <p>  openai | anthropic
 *   --api-key <key>       Cloud API key (or OPENAI_API_KEY / ANTHROPIC_API_KEY)
 *   --max-fixes <n>       Cap number of issues processed
 *   --no-search           Disable doc/GitHub/StackOverflow search
 *   --verbose, -v         Verbose progress
 *   --help, -h            Show help
 *
 * Network access only happens when a transport (global fetch) is available AND
 * the relevant executor/searcher is enabled; otherwise it runs network-free.
 *
 * @module commands/generate-fixes-command
 */

'use strict';

const path = require('path');
const { AIGenerationOrchestrator } = require('../ai-generator/orchestrator');
const { DocSearcher } = require('../ai-generator/doc-searcher');
const { GitHubSearcher } = require('../ai-generator/github-searcher');
const { StackOverflowSearcher } = require('../ai-generator/stackoverflow-searcher');
const { DependencyDocResolver } = require('../ai-generator/dependency-doc-resolver');
const { LocalExecutor } = require('../ai-generator/local-executor');
const { CloudExecutor } = require('../ai-generator/cloud-executor');
const { ErrorRecovery } = require('../ai-generator/error-recovery');
const { loadConfig, RateLimiter, CostTracker } = require('../ai-generator/config');

/**
 * A tiny fetch adapter that maps global fetch to the transport shape our
 * executors/searchers expect. Returns null when no fetch is available so the
 * modules fall back to network-free mode.
 */
function makeTransport() {
  if (typeof fetch !== 'function') return null;
  return async (url, opts = {}) => {
    const res = await fetch(url, { method: opts.method || 'GET', headers: opts.headers, body: opts.body });
    return { ok: res.ok, status: res.status, json: () => res.json(), text: () => res.text() };
  };
}

async function run(args) {
  const options = parseArguments(args);
  if (options.help) { printHelp(); return; }

  console.log('\n🤖 AI Issue Generator\n');
  if (options.dryRun) console.log('⚠️  DRY RUN — no files will be written\n');

  const rootDir = options.files[0] || process.cwd();
  const config = loadConfig({
    rootDir,
    overrides: {
      execution: { strategy: options.strategy, localModel: options.localAiModel, cloudProvider: options.cloudProvider },
      search: { enabled: options.search }
    }
  });

  const transport = makeTransport();
  const searchers = [];
  if (config.search.enabled) {
    if (config.search.sources.includes('docs')) searchers.push(new DocSearcher({ fetchImpl: transport, rootDir }));
    if (config.search.sources.includes('github')) searchers.push(new GitHubSearcher({ fetchImpl: transport, rootDir }));
    if (config.search.sources.includes('stackoverflow')) searchers.push(new StackOverflowSearcher({ fetchImpl: transport, rootDir }));
  }

  const dependencyResolver = new DependencyDocResolver({
    rootDir,
    docSearcher: new DocSearcher({ fetchImpl: transport, rootDir })
  });

  const localExecutor = new LocalExecutor({ fetchImpl: transport, model: config.execution.localModel });
  const cloudExecutor = options.cloudAI
    ? new CloudExecutor({ fetchImpl: transport, provider: config.execution.cloudProvider, apiKey: options.apiKey })
    : null;

  const orchestrator = new AIGenerationOrchestrator({
    rootDir,
    strategy: config.execution.strategy,
    dryRun: options.dryRun,
    searchers,
    dependencyResolver,
    localExecutor,
    cloudExecutor,
    errorRecovery: new ErrorRecovery({ maxAttempts: config.execution.maxAttempts }),
    rateLimiter: new RateLimiter({ requestsPerMinute: config.limits.requestsPerMinute }),
    costTracker: new CostTracker({ dailyBudgetUsd: config.limits.dailyBudgetUsd, rootDir }),
    onProgress: options.verbose ? logProgress : null
  });

  console.log('📊 Analyzing code...\n');
  const issues = await collectIssues(options.files);
  if (!issues.length) { console.log('✅ No issues found.\n'); return; }

  const capped = issues.slice(0, options.maxFixes || config.limits.maxFixesPerRun);
  console.log(`Found ${issues.length} issue(s); processing ${capped.length}.\n`);

  const { results, metrics } = await orchestrator.run(capped);
  printSummary(results, metrics, orchestrator, cloudExecutor);
  process.exitCode = metrics.failed > 0 ? 1 : 0;
}

// ─── Issue collection ──────────────────────────────────────────────────────────

async function collectIssues(files) {
  try {
    const linterIntegration = require('../integrations/linter-integration');
    const normalizer = require('../integrations/issue-normalizer');
    const orchestrator = new linterIntegration.LinterOrchestrator({ targetDirectory: files[0] || process.cwd() });
    const raw = await orchestrator.runAll();
    const normalized = normalizer.normalizeIssues(raw);
    return (normalized && normalized.issues) || [];
  } catch {
    console.warn('⚠️  Analyzer unavailable; no issues collected.');
    return [];
  }
}

// ─── Reporting ──────────────────────────────────────────────────────────────────

function logProgress(event) {
  if (event.type === 'issue-start') {
    const i = event.issue || {};
    process.stdout.write(`  [${event.index + 1}/${event.total}] ${i.file || ''}:${i.startLine || ''} … `);
  } else if (event.type === 'issue-end') {
    const r = event.result || {};
    console.log(r.success ? '✅ fixed' : `❌ ${r.error || 'failed'} (stage: ${r.stage})`);
  }
}

function printSummary(results, metrics, orchestrator, cloudExecutor) {
  console.log('\n─── Summary ───');
  console.log(`  Processed: ${metrics.processed}`);
  console.log(`  Fixed:     ${metrics.fixed}${metrics.recovered ? ` (recovered: ${metrics.recovered})` : ''}`);
  console.log(`  Failed:    ${metrics.failed}`);
  console.log(`  Skipped:   ${metrics.skipped}`);
  if (metrics.totalCostUsd > 0) console.log(`  Est. cost: $${metrics.totalCostUsd.toFixed(4)}`);
  if (cloudExecutor) {
    const c = cloudExecutor.getCostReport();
    console.log(`  Cloud:     ${c.provider}/${c.model}  tokens in/out ${c.totalTokens.input}/${c.totalTokens.output}`);
  }
  console.log('');
}

// ─── Args ───────────────────────────────────────────────────────────────────────

function parseArguments(args) {
  const options = {
    files: [], dryRun: false, strategy: 'local-first', localAiModel: undefined,
    cloudAI: false, cloudProvider: 'openai',
    apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
    maxFixes: null, search: true, verbose: false, help: false
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') options.dryRun = true;
    else if (a === '--strategy') options.strategy = args[++i];
    else if (a === '--local-ai-model') options.localAiModel = args[++i];
    else if (a === '--cloud-ai') options.cloudAI = true;
    else if (a === '--cloud-provider') options.cloudProvider = args[++i];
    else if (a === '--api-key') options.apiKey = args[++i];
    else if (a === '--max-fixes') options.maxFixes = parseInt(args[++i], 10);
    else if (a === '--no-search') options.search = false;
    else if (a === '--verbose' || a === '-v') options.verbose = true;
    else if (a === '--help' || a === '-h') options.help = true;
    else if (!a.startsWith('--')) options.files.push(a);
  }
  if (!options.files.length) options.files.push(process.cwd());
  return options;
}

function printHelp() {
  console.log(`
📖 Generate Fixes Command (AI Issue Generator)

Usage:
  aqt generate-fixes [files...] [options]

Options:
  --dry-run              Plan/execute without writing files
  --strategy <s>         local-first (default) | local-only | cloud-only
  --local-ai-model <m>   Ollama model (default: codellama:7b)
  --cloud-ai             Enable cloud fallback (needs API key)
  --cloud-provider <p>   openai | anthropic
  --api-key <key>        Cloud API key (or *_API_KEY env var)
  --max-fixes <n>        Cap issues processed
  --no-search            Disable doc/GitHub/StackOverflow search
  --verbose, -v          Verbose per-issue progress
  --help, -h             Show this help

Notes:
  - Local AI needs Ollama running: ollama serve
  - Runs network-free (no external calls) when fetch/executors are unavailable.
  - Daily cost + rate limits come from .aqt/ai-generator.json (see examples/).
`);
}

module.exports = { run, printHelp, makeTransport };

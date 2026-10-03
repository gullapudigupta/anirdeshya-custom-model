/**
 * AI Issue Generator (Phase 6) — public entry point.
 *
 * Foundations (network-free):
 *   - IssueClassifier      (P6-T001) self-explanatory descriptions + scoring
 *   - CodeContextAnalyzer  (P6-T002) minimal, symbol-aware code context
 *   - ContextAggregator    (P6-T006) dedupe/rank/summarize context within budget
 *   - PromptBuilder        (P6-T007) line-edit prompt assembly
 *   - LineEditor           (P6-T010) line-level applicator with backup/rollback
 *
 * Search & docs:
 *   - SearchCache          (AQ-SF-002) local cache for search adapters
 *   - DocSearcher          (P6-T003) official documentation search
 *   - GitHubSearcher       (P6-T004) GitHub issues search
 *   - StackOverflowSearcher(P6-T005) StackOverflow search
 *   - DependencyDocResolver(P6-T016) dependency-aware official-docs context
 *
 * Execution & recovery:
 *   - LocalExecutor        (P6-T008) Ollama local model executor
 *   - CloudExecutor        (P6-T009) cloud provider executor + cost tracking
 *   - ErrorRecovery        (P6-T011) build/lint error detection + retry
 *
 * Coordination & config:
 *   - AIGenerationOrchestrator (P6-T012) end-to-end workflow
 *   - loadConfig/RateLimiter/CostTracker (P6-T014)
 *
 * All collaborators are injectable and network-free unless a transport is wired.
 */

'use strict';

const { IssueClassifier, estimateTokens } = require('./issue-classifier');
const { CodeContextAnalyzer } = require('./code-context-analyzer');
const { ContextAggregator } = require('./context-aggregator');
const { PromptBuilder, OUTPUT_CONTRACT, SYSTEM_PROMPT } = require('./prompt-builder');
const { LineEditor } = require('./line-editor');
const { SearchCache } = require('./search-cache');
const { BaseSearcher } = require('./base-searcher');
const { DocSearcher, DOC_SOURCES } = require('./doc-searcher');
const { GitHubSearcher } = require('./github-searcher');
const { StackOverflowSearcher } = require('./stackoverflow-searcher');
const { DependencyDocResolver } = require('./dependency-doc-resolver');
const { LocalExecutor } = require('./local-executor');
const { CloudExecutor, DEFAULT_PRICING } = require('./cloud-executor');
const { ErrorRecovery } = require('./error-recovery');
const { AIGenerationOrchestrator } = require('./orchestrator');
const { loadConfig, RateLimiter, CostTracker, DEFAULT_CONFIG } = require('./config');

/**
 * Convenience pipeline: classify an issue, build its context, and produce a prompt.
 * @param {object} issue Normalized issue
 * @param {object} [deps] { queryEngine, rootDir, classifierOptions, contextOptions, promptOptions }
 * @returns {object} { classification, context, prompt }
 */
function prepareFix(issue, deps = {}) {
  const classifier = new IssueClassifier({ queryEngine: deps.queryEngine, ...(deps.classifierOptions || {}) });
  const contextAnalyzer = new CodeContextAnalyzer({
    queryEngine: deps.queryEngine,
    rootDir: deps.rootDir,
    ...(deps.contextOptions || {})
  });
  const promptBuilder = new PromptBuilder(deps.promptOptions || {});

  const classification = classifier.classify(issue);
  const context = contextAnalyzer.analyze(issue);
  const prompt = promptBuilder.build(classification, context);

  return { classification, context, prompt };
}

module.exports = {
  // foundations
  IssueClassifier,
  CodeContextAnalyzer,
  ContextAggregator,
  PromptBuilder,
  LineEditor,
  // search & docs
  SearchCache,
  BaseSearcher,
  DocSearcher,
  DOC_SOURCES,
  GitHubSearcher,
  StackOverflowSearcher,
  DependencyDocResolver,
  // execution & recovery
  LocalExecutor,
  CloudExecutor,
  DEFAULT_PRICING,
  ErrorRecovery,
  // coordination & config
  AIGenerationOrchestrator,
  loadConfig,
  RateLimiter,
  CostTracker,
  DEFAULT_CONFIG,
  // helpers
  prepareFix,
  estimateTokens,
  OUTPUT_CONTRACT,
  SYSTEM_PROMPT
};

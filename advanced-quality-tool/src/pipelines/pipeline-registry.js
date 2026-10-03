/**
 * Pipeline Registry (P9-T024)
 *
 * Central catalog of named pipelines with stable IDs, versions, stages,
 * inputs, outputs, and verification checks.
 *
 * @module pipelines/pipeline-registry
 */

'use strict';

/**
 * Pipeline definition schema
 * @typedef {Object} PipelineDefinition
 * @property {string} id - Stable pipeline identifier
 * @property {string} name - Human-readable pipeline name
 * @property {string} version - Semantic version
 * @property {string[]} stages - Ordered list of stage names
 * @property {Object} schema - Input/output schema definitions
 * @property {Object} verification - Verification checks configuration
 * @property {Object} metadata - Additional pipeline metadata
 */

class PipelineRegistry {
  constructor() {
    this.pipelines = new Map();
    this._registerBuiltInPipelines();
  }

  /**
   * Register a pipeline definition
   * @param {PipelineDefinition} definition
   * @throws {Error} If pipeline ID already exists or definition is invalid
   */
  register(definition) {
    this._validateDefinition(definition);
    
    if (this.pipelines.has(definition.id)) {
      throw new Error(`Pipeline '${definition.id}' is already registered`);
    }
    
    this.pipelines.set(definition.id, {
      ...definition,
      registeredAt: new Date().toISOString()
    });
  }

  /**
   * Get a pipeline definition by ID
   * @param {string} pipelineId
   * @returns {PipelineDefinition|null}
   */
  get(pipelineId) {
    return this.pipelines.get(pipelineId) || null;
  }

  /**
   * List all registered pipelines
   * @returns {PipelineDefinition[]}
   */
  list() {
    return Array.from(this.pipelines.values());
  }

  /**
   * Check if a pipeline is registered
   * @param {string} pipelineId
   * @returns {boolean}
   */
  has(pipelineId) {
    return this.pipelines.has(pipelineId);
  }

  /**
   * Validate pipeline definition structure
   * @private
   */
  _validateDefinition(def) {
    if (!def || typeof def !== 'object') {
      throw new Error('Pipeline definition must be an object');
    }
    if (!def.id || typeof def.id !== 'string') {
      throw new Error('Pipeline definition must have a valid id (string)');
    }
    if (!def.name || typeof def.name !== 'string') {
      throw new Error('Pipeline definition must have a valid name (string)');
    }
    if (!def.version || typeof def.version !== 'string') {
      throw new Error('Pipeline definition must have a valid version (string)');
    }
    if (!Array.isArray(def.stages) || def.stages.length === 0) {
      throw new Error('Pipeline definition must have at least one stage');
    }
  }

  /**
   * Register built-in pipelines from Phase 9 tasks
   * @private
   */
  _registerBuiltInPipelines() {
    // P9-T024: Pipeline ledger itself
    this.register({
      id: 'pipeline-ledger',
      name: 'Pipeline Execution Ledger',
      version: '1.0.0',
      stages: ['register', 'start', 'stage-start', 'stage-end', 'complete', 'fail', 'cancel'],
      schema: {
        input: { runId: 'string', pipelineId: 'string', taskId: 'string?' },
        output: { status: 'string', events: 'array' }
      },
      verification: { required: true },
      metadata: { description: 'Meta-pipeline for recording all pipeline executions' }
    });

    // P9-T025: Workspace Quality Analysis
    this.register({
      id: 'workspace-quality-analysis',
      name: 'Workspace Quality Analysis',
      version: '1.0.0',
      stages: [
        'resolve-workspace',
        'detect-tools',
        'select-files',
        'run-linters',
        'collect-output',
        'normalize-issues',
        'deduplicate',
        'sort',
        'summarize'
      ],
      schema: {
        input: { workspace: 'string', files: 'array?', linters: 'array?' },
        output: { issues: 'array', summary: 'object', stats: 'object' }
      },
      verification: { required: true },
      metadata: { description: 'Analyze workspace code quality using configured linters' }
    });

    // P9-T026: Issue Enrichment
    this.register({
      id: 'issue-enrichment',
      name: 'Issue Categorization and Enrichment',
      version: '1.0.0',
      stages: [
        'load-issues',
        'infer-file-type',
        'classify-category',
        'map-severity',
        'determine-fixability',
        'add-tags',
        'filter',
        'group'
      ],
      schema: {
        input: { issues: 'array', filters: 'object?' },
        output: { enrichedIssues: 'array', rejected: 'array', stats: 'object' }
      },
      verification: { required: true },
      metadata: { description: 'Enrich and categorize normalized issues' }
    });

    // P9-T027: Auto-Fix
    this.register({
      id: 'auto-fix',
      name: 'Rule and AI Auto-Fix',
      version: '1.0.0',
      stages: [
        'select-issues',
        'group-by-file',
        'create-backup',
        'rule-fix',
        'local-ai-fix',
        'cloud-ai-fix',
        'validate',
        'apply-or-rollback',
        'summarize'
      ],
      schema: {
        input: { issues: 'array', strategy: 'string', dryRun: 'boolean?' },
        output: { fixed: 'array', failed: 'array', rollbacks: 'array', stats: 'object' }
      },
      verification: { required: true },
      metadata: { description: 'Automatically fix issues using rules and AI with fallback' }
    });

    // P9-T028: AI Issue Resolution
    this.register({
      id: 'ai-issue-resolution',
      name: 'AI Issue Resolution',
      version: '1.0.0',
      stages: [
        'classify-issue',
        'analyze-code-context',
        'search-docs',
        'search-github',
        'search-stackoverflow',
        'resolve-dependency-docs',
        'aggregate-context',
        'build-prompt',
        'execute-model',
        'apply-line-edits',
        'verify',
        'recover'
      ],
      schema: {
        input: { issue: 'object', strategy: 'string', model: 'string?' },
        output: { success: 'boolean', applied: 'object', error: 'string?' }
      },
      verification: { required: true },
      metadata: { description: 'Resolve issues using AI with context research' }
    });

    // P9-T029: AI Code Review
    this.register({
      id: 'ai-code-review',
      name: 'AI Code Review',
      version: '1.0.0',
      stages: [
        'select-files',
        'read-code',
        'bound-context',
        'build-review-prompt',
        'execute-model',
        'parse-findings',
        'score-findings',
        'publish-review'
      ],
      schema: {
        input: { files: 'array', focus: 'array?', model: 'string?' },
        output: { findings: 'array', score: 'object', report: 'object' }
      },
      verification: { required: true },
      metadata: { description: 'AI-powered code review with finding normalization' }
    });

    // P9-T030: Watch and Auto-Fix
    this.register({
      id: 'watch-and-fix',
      name: 'Continuous Watch and Auto-Fix',
      version: '1.0.0',
      stages: [
        'discover-files',
        'subscribe',
        'detect-change',
        'debounce',
        'analyze-changed-files',
        'optionally-fix',
        'publish-event',
        'record-run'
      ],
      schema: {
        input: { workspace: 'string', autoFix: 'boolean?', patterns: 'array?' },
        output: { watching: 'boolean', lastRun: 'object?', events: 'array' }
      },
      verification: { required: false },
      metadata: { description: 'Watch files for changes and optionally auto-fix' }
    });

    // P9-T031: CI Quality Gate
    this.register({
      id: 'ci-quality-gate',
      name: 'CI Build Monitoring and Quality Gate',
      version: '1.0.0',
      stages: [
        'detect-ci',
        'start-build',
        'collect-analysis',
        'calculate-metrics',
        'check-gates',
        'detect-regressions',
        'save-results',
        'generate-reports',
        'set-exit-status'
      ],
      schema: {
        input: { ciContext: 'object', gates: 'object', baseline: 'object?' },
        output: { passed: 'boolean', metrics: 'object', regressions: 'array', exitCode: 'number' }
      },
      verification: { required: true },
      metadata: { description: 'CI/CD quality gate with regression detection' }
    });

    // P9-T032: Language Analysis
    this.register({
      id: 'language-analysis',
      name: 'Multi-Language Analyzer',
      version: '1.0.0',
      stages: [
        'detect-language',
        'load-plugin',
        'check-tools',
        'discover-files',
        'run-analyzer',
        'parse-diagnostics',
        'normalize-issues',
        'unload-plugin'
      ],
      schema: {
        input: { files: 'array', language: 'string?' },
        output: { issues: 'array', diagnostics: 'object', pluginInfo: 'object' }
      },
      verification: { required: true },
      metadata: { description: 'Language-specific analysis with plugin architecture' }
    });

    // P9-T033: Security Scanning
    this.register({
      id: 'security-scan',
      name: 'Security Scanning',
      version: '1.0.0',
      stages: [
        'select-scope',
        'scan-vulnerabilities',
        'scan-secrets',
        'scan-dependencies',
        'normalize-findings',
        'score-risk',
        'apply-gates',
        'publish-report'
      ],
      schema: {
        input: { scope: 'object', scanners: 'array?', gates: 'object?' },
        output: { findings: 'array', risks: 'object', passed: 'boolean' }
      },
      verification: { required: true },
      metadata: { description: 'Unified security scanning with secret redaction' }
    });

    // P9-T034: Quality Metrics
    this.register({
      id: 'quality-metrics',
      name: 'Performance and Quality Metrics',
      version: '1.0.0',
      stages: [
        'select-scope',
        'calculate-complexity',
        'detect-duplicates',
        'detect-performance-issues',
        'aggregate-metrics',
        'compare-history',
        'apply-thresholds',
        'publish-report'
      ],
      schema: {
        input: { scope: 'object', thresholds: 'object?', baseline: 'object?' },
        output: { metrics: 'object', passed: 'boolean', trends: 'object' }
      },
      verification: { required: true },
      metadata: { description: 'Calculate quality metrics with historical comparison' }
    });

    // P9-T035: VS Code Diagnostics
    this.register({
      id: 'vscode-quality-feedback',
      name: 'VS Code Diagnostics and Quick-Fix',
      version: '1.0.0',
      stages: [
        'activate-extension',
        'load-config',
        'analyze-workspace',
        'map-diagnostics',
        'render-status',
        'offer-code-actions',
        'apply-fix',
        'refresh-diagnostics'
      ],
      schema: {
        input: { workspace: 'object', config: 'object' },
        output: { diagnostics: 'array', codeActions: 'array', status: 'object' }
      },
      verification: { required: true },
      metadata: { description: 'VS Code extension integration with diagnostics' }
    });

    // P9-T036: Chat UI
    this.register({
      id: 'chat-interaction',
      name: 'Chat UI and WebSocket Interaction',
      version: '1.0.0',
      stages: [
        'connect',
        'authenticate-session',
        'receive-message',
        'route-command',
        'stream-progress',
        'request-approval',
        'publish-result',
        'disconnect-or-resume'
      ],
      schema: {
        input: { message: 'object', session: 'object' },
        output: { response: 'object', events: 'array' }
      },
      verification: { required: false },
      metadata: { description: 'Real-time chat interaction over WebSocket' }
    });

    // P9-T037: CLI Command
    this.register({
      id: 'cli-command',
      name: 'CLI Command Execution',
      version: '1.0.0',
      stages: [
        'parse-arguments',
        'resolve-workspace',
        'load-config',
        'dispatch-command',
        'execute-operation',
        'format-output',
        'set-exit-code',
        'record-run'
      ],
      schema: {
        input: { args: 'array', cwd: 'string' },
        output: { exitCode: 'number', output: 'string', error: 'string?' }
      },
      verification: { required: true },
      metadata: { description: 'CLI command lifecycle and result handling' }
    });

    // P9-T038: Dashboard Reporting
    this.register({
      id: 'dashboard-reporting',
      name: 'Dashboard Reporting and Trends',
      version: '1.0.0',
      stages: [
        'load-records',
        'aggregate-runs',
        'calculate-trends',
        'group-by-project',
        'render-dashboard',
        'export-report'
      ],
      schema: {
        input: { timeRange: 'object?', projects: 'array?' },
        output: { dashboard: 'object', trends: 'object', exports: 'array' }
      },
      verification: { required: false },
      metadata: { description: 'Historical reporting and trend analysis' }
    });

    // P9-T039: Pipeline Replay
    this.register({
      id: 'pipeline-replay',
      name: 'Pipeline Replay and Contract Testing',
      version: '1.0.0',
      stages: [
        'load-run',
        'validate-schema',
        'replay-stubbed-stages',
        'compare-events',
        'report-differences'
      ],
      schema: {
        input: { runId: 'string', stubs: 'object' },
        output: { passed: 'boolean', differences: 'array', coverage: 'object' }
      },
      verification: { required: true },
      metadata: { description: 'Replay recorded pipeline runs for testing' }
    });

    // P9-T040: Documentation Generation
    this.register({
      id: 'documentation-generation',
      name: 'Documentation Generation and Publishing',
      version: '1.0.0',
      stages: [
        'select-task',
        'collect-requirements',
        'collect-code-and-doc-context',
        'build-outline',
        'generate-document',
        'validate-links',
        'review-diff',
        'publish-or-archive'
      ],
      schema: {
        input: { task: 'object', templates: 'array?', context: 'object' },
        output: { document: 'string', path: 'string', validation: 'object' }
      },
      verification: { required: true },
      metadata: { description: 'Generate and validate documentation from tasks' }
    });
  }
}

// Singleton instance
let registry = null;

/**
 * Get the global pipeline registry instance
 * @returns {PipelineRegistry}
 */
function getRegistry() {
  if (!registry) {
    registry = new PipelineRegistry();
  }
  return registry;
}

/**
 * Reset the global registry (for testing)
 */
function resetRegistry() {
  registry = null;
}

module.exports = {
  PipelineRegistry,
  getRegistry,
  resetRegistry
};

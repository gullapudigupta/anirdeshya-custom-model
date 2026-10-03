/**
 * Orchestration Tool Adapter  (P8-T003)
 *
 * Exposes the Advanced Quality Tool as a callable tool for orchestration
 * systems (LangChain, AutoGen, custom agent loops, etc.).
 *
 * Design principles:
 *  - Machine-readable capability manifest with input/output contracts
 *  - Supports cancellation tokens and correlation IDs
 *  - Propagates model-required errors without silent fallback
 *  - Thin adapter over SharedAppServices — zero business logic here
 *  - All responses include correlation ID, duration, and timestamps
 *
 * Usage:
 *   const adapter = new OrchestrationAdapter({ appConfig: { projectRoot } });
 *   await adapter.start();
 *   const result = await adapter.call('analyze', { files: [...] }, { correlationId: 'abc' });
 *
 * @module integrations/orchestration-adapter
 */

'use strict';

const { InterfaceAdapter } = require('../core/interface-adapter');

// ─── Tool capability manifest ─────────────────────────────────────────────────

/**
 * Machine-readable manifest describing every supported operation.
 * Orchestration hosts read this to know what the tool can do,
 * what inputs it accepts, and what outputs it returns.
 */
const CAPABILITY_MANIFEST = {
  name:        'advanced-quality-tool',
  version:     '1.0.0',
  description: 'Code quality analysis, auto-fix, and AI code review tool.',
  operations: {
    analyze: {
      description: 'Run quality analysis on a workspace. Returns normalised issues.',
      input: {
        projectRoot: { type: 'string',  required: false, description: 'Workspace path (defaults to configured root).' },
        files:       { type: 'array',   required: false, description: 'Limit to specific file paths.' },
        categories:  { type: 'array',   required: false, description: 'Filter by category e.g. ["security","performance"].' }
      },
      output: {
        issues:     { type: 'array',   description: 'Normalised issue objects.' },
        issueCount: { type: 'number',  description: 'Total issue count.' }
      },
      modelRequired: false
    },
    fix: {
      description: 'Apply rule-based or AI-assisted fixes to issues.',
      input: {
        issues:   { type: 'array',   required: true,  description: 'Issues array from analyze.' },
        strategy: { type: 'string',  required: false, enum: ['rule-only','ai-only','rule-first'], default: 'rule-first' },
        dryRun:   { type: 'boolean', required: false, default: false }
      },
      output: {
        results: { type: 'array',  description: 'Per-issue fix results.' },
        fixed:   { type: 'number', description: 'Number of issues fixed.' }
      },
      modelRequired: 'optional'
    },
    review: {
      description: 'Run AI code review on one or more files.',
      input: {
        files:     { type: 'array',   required: true,  description: '[{filePath, content, diff?}]' },
        diffAware: { type: 'boolean', required: false, default: false }
      },
      output: {
        results:       { type: 'array',  description: 'Per-file review results with findings.' },
        totalFindings: { type: 'number', description: 'Total finding count across all files.' }
      },
      modelRequired: 'optional'
    },
    report: {
      description: 'Generate a formatted quality report.',
      input: {
        results: { type: 'array',  required: true,  description: 'Results from analyze or review.' },
        format:  { type: 'string', required: false, enum: ['json','markdown','sarif'], default: 'json' }
      },
      output: {
        report: { type: 'string', description: 'Formatted report content.' },
        format: { type: 'string' }
      },
      modelRequired: false
    },
    health: {
      description: 'Return provider status and capability availability.',
      input:  {},
      output: { status: { type: 'string' }, providerStatus: { type: 'object' }, capabilities: { type: 'array' } },
      modelRequired: false
    }
  },
  // Error state catalogue for orchestration hosts
  errorStates: {
    MODEL_REQUIRED:     'Operation requires a model that is not available or not configured.',
    OPERATION_FAILED:   'Operation failed with an internal error.',
    INVALID_INPUT:      'Input validation failed — check required fields and types.',
    DEPENDENCY_MISSING: 'A required internal module is not available.',
    CANCELLED:          'Operation was cancelled by the caller.',
    TIMEOUT:            'Operation exceeded the configured timeout.'
  }
};

// ─── Main class ───────────────────────────────────────────────────────────────

class OrchestrationAdapter extends InterfaceAdapter {
  /**
   * @param {object} [config={}]
   * @param {number}  [config.defaultTimeout=60000] - Default operation timeout (ms)
   * @param {boolean} [config.verbose=false]
   */
  constructor(config = {}) {
    super(config);
    this.defaultTimeout = config.defaultTimeout || 60000;
    // Active cancellation tokens: Map<correlationId, { cancelled: boolean }>
    this._cancellations = new Map();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Get the machine-readable capability manifest.
   * Orchestration hosts call this to discover available operations.
   * @returns {object} CAPABILITY_MANIFEST
   */
  getManifest() {
    return CAPABILITY_MANIFEST;
  }

  /**
   * Call an operation on the tool.
   *
   * @param {string} operation    - Operation name (from manifest)
   * @param {object} input        - Operation input (validated against manifest schema)
   * @param {object} [context={}] - { correlationId?, timeout?, cancellationToken? }
   * @returns {Promise<object>}   OrchestrationResult
   */
  async call(operation, input = {}, context = {}) {
    this._assertStarted();

    const correlationId = context.correlationId || this._generateId();
    const timeout       = context.timeout || this.defaultTimeout;
    const startedAt     = Date.now();

    this._log(`call: op=${operation} correlationId=${correlationId}`);

    // Register cancellation token
    const cancel = { cancelled: false };
    this._cancellations.set(correlationId, cancel);

    // Validate operation exists
    if (!CAPABILITY_MANIFEST.operations[operation]) {
      return this._orchResult(false, correlationId, startedAt, null,
        'INVALID_INPUT', `Unknown operation: ${operation}`);
    }

    // Validate required inputs
    const opDef  = CAPABILITY_MANIFEST.operations[operation];
    const missing = Object.entries(opDef.input)
      .filter(([k, v]) => v.required && input[k] === undefined)
      .map(([k]) => k);
    if (missing.length > 0) {
      return this._orchResult(false, correlationId, startedAt, null,
        'INVALID_INPUT', `Missing required fields: ${missing.join(', ')}`);
    }

    // Race operation against timeout
    try {
      const result = await Promise.race([
        this._runOperation(operation, input, cancel),
        this._timeoutPromise(timeout, correlationId)
      ]);

      this._cancellations.delete(correlationId);
      return result;

    } catch (err) {
      this._cancellations.delete(correlationId);
      const code = err.message?.includes('CANCELLED') ? 'CANCELLED'
                 : err.message?.includes('TIMEOUT')   ? 'TIMEOUT'
                 : 'OPERATION_FAILED';
      return this._orchResult(false, correlationId, startedAt, null, code, err.message);
    }
  }

  /**
   * Cancel an in-progress operation by correlation ID.
   * @param {string} correlationId
   * @returns {{ cancelled: boolean, message: string }}
   */
  cancel(correlationId) {
    const token = this._cancellations.get(correlationId);
    if (!token) return { cancelled: false, message: `No active operation for ${correlationId}` };
    token.cancelled = true;
    this._log(`Cancelled operation ${correlationId}`);
    return { cancelled: true, message: `Operation ${correlationId} cancellation requested` };
  }

  // ─── InterfaceAdapter contract ─────────────────────────────────────────────

  _translateInput(rawInput) {
    const opMap = { analyze: 'analyze', fix: 'fix', review: 'review', report: 'generateReport', health: 'getHealth' };
    return { operation: opMap[rawInput.operation] || rawInput.operation, params: rawInput.input || {} };
  }

  _translateOutput(serviceResult) {
    // Passed through _orchResult — not called directly in this adapter
    return serviceResult;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  async _runOperation(operation, input, cancel) {
    const startedAt = Date.now();

    // Map manifest operation names to service dispatch names
    const dispatchName = { analyze: 'analyze', fix: 'fix', review: 'review', report: 'generateReport', health: 'getHealth' };

    // Build params appropriate for each operation
    const params = this._buildParams(operation, input);

    const serviceResult = await this.dispatch(dispatchName[operation], params);

    // Check cancellation after async dispatch returns
    if (cancel.cancelled) {
      throw new Error('CANCELLED: Operation was cancelled');
    }

    if (!serviceResult.success) {
      const err = this._translateError(serviceResult);
      return this._orchResult(false, null, startedAt, null, err.code, err.message,
        serviceResult.errorCode === 'MODEL_REQUIRED' ? serviceResult.modelRequired : null);
    }

    return this._orchResult(true, null, startedAt, serviceResult.data);
  }

  /** Map operation input to service dispatch params */
  _buildParams(operation, input) {
    switch (operation) {
      case 'analyze': return { files: input.files, categories: input.categories };
      case 'fix':     return { issues: input.issues, strategy: input.strategy, dryRun: input.dryRun };
      case 'review':  return { files: input.files, diffAware: input.diffAware };
      case 'report':  return { results: input.results, format: input.format };
      case 'health':  return {};
      default:        return input;
    }
  }

  /** Build a standardised orchestration result envelope */
  _orchResult(success, correlationId, startedAt, data, errorCode, errorMessage, modelRequired) {
    const result = {
      success,
      correlationId: correlationId || this._generateId(),
      durationMs:    Date.now() - startedAt,
      timestamp:     new Date().toISOString()
    };
    if (success)  result.data          = data;
    if (!success) result.error         = errorMessage;
    if (!success) result.errorCode     = errorCode;
    if (modelRequired) result.modelRequired = modelRequired;
    return result;
  }

  _timeoutPromise(ms, correlationId) {
    return new Promise((_, reject) =>
      setTimeout(() => {
        this._cancellations.delete(correlationId);
        reject(new Error(`TIMEOUT: Operation exceeded ${ms}ms`));
      }, ms)
    );
  }

  _generateId() {
    return `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  _log(msg) { if (this.verbose) console.log(`[OrchestrationAdapter] ${msg}`); }
}

module.exports = { OrchestrationAdapter, CAPABILITY_MANIFEST };

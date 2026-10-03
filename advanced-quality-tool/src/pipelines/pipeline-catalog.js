/**
 * Pipeline Catalog and Execution Ledger (P9-T024)
 *
 * Unified catalog that combines:
 * - Pipeline registry with stable IDs, versions, stages, schemas
 * - Execution ledger for recording all pipeline runs
 * - Query and export capabilities for audit and observability
 *
 * Features:
 * - Named pipelines with stable IDs, versions, stages, inputs, outputs
 * - Verification checks per pipeline
 * - Append-only JSONL event store with retention and redaction
 * - Complete audit trail: run ID, task ID, workspace, timestamps, status
 * - Detailed telemetry: model, provider, tokens, cost, tool calls, file changes
 * - Query by task, pipeline, session, date range, or failed stage
 * - Export capabilities for reporting and compliance
 *
 * @module pipelines/pipeline-catalog
 */

'use strict';

const { PipelineRegistry, getRegistry, resetRegistry } = require('./pipeline-registry');
const { 
  ExecutionLedger, 
  EventType, 
  RunStatus, 
  generateRunId 
} = require('./execution-ledger');
const fs = require('fs');
const path = require('path');

/**
 * Pipeline Catalog - Unified registry and execution ledger
 */
class PipelineCatalog {
  constructor(options = {}) {
    this.registry = options.registry || getRegistry();
    this.ledger = options.ledger || new ExecutionLedger(options);
    this.workspace = options.workspace || process.cwd();
    this.strictMode = options.strictMode !== false;
    
    // Track active runs for verification
    this.activeRuns = new Map();
  }

  // ─── Pipeline Registry Operations ─────────────────────────────────────────────

  /**
   * Register a new pipeline definition
   * @param {Object} definition
   * @param {string} definition.id - Stable pipeline identifier
   * @param {string} definition.name - Human-readable name
   * @param {string} definition.version - Semantic version
   * @param {string[]} definition.stages - Ordered stage names
   * @param {Object} [definition.schema] - Input/output schemas
   * @param {Object} [definition.verification] - Verification checks
   * @param {Object} [definition.metadata] - Additional metadata
   */
  registerPipeline(definition) {
    return this.registry.register(definition);
  }

  /**
   * Get a pipeline definition by ID
   * @param {string} pipelineId
   * @returns {Object|null}
   */
  getPipeline(pipelineId) {
    return this.registry.get(pipelineId);
  }

  /**
   * List all registered pipelines
   * @returns {Array<Object>}
   */
  listPipelines() {
    return this.registry.list();
  }

  /**
   * Check if a pipeline is registered
   * @param {string} pipelineId
   * @returns {boolean}
   */
  hasPipeline(pipelineId) {
    return this.registry.has(pipelineId);
  }

  // ─── Execution Lifecycle ──────────────────────────────────────────────────────

  /**
   * Start a new pipeline run
   * @param {Object} params
   * @param {string} params.pipelineId - Registered pipeline ID
   * @param {string} [params.taskId] - Associated task ID
   * @param {string} [params.workspace] - Workspace path
   * @param {Object} [params.input] - Pipeline input
   * @param {Object} [params.context] - Execution context (model, provider, etc.)
   * @returns {string} runId
   * @throws {Error} If pipeline not registered
   */
  startRun(params) {
    const { pipelineId, taskId = null, workspace = null, input = {}, context = {} } = params;

    // Verify pipeline exists
    if (!this.registry.has(pipelineId)) {
      throw new Error(`Pipeline '${pipelineId}' is not registered`);
    }

    const pipeline = this.registry.get(pipelineId);
    
    // Validate input against schema if defined
    if (this.strictMode && pipeline.schema && pipeline.schema.input) {
      this._validateInput(input, pipeline.schema.input, pipelineId);
    }

    // Start the run in the ledger
    const runId = this.ledger.startRun({
      pipelineId,
      taskId,
      workspace: workspace || this.workspace,
      input,
      context: {
        ...context,
        pipelineVersion: pipeline.version,
        expectedStages: pipeline.stages
      }
    });

    // Track active run
    this.activeRuns.set(runId, {
      pipelineId,
      taskId,
      started: new Date().toISOString(),
      stages: new Set(),
      stageResults: new Map()
    });

    return runId;
  }

  /**
   * Record stage start
   * @param {string} runId
   * @param {string} stageName
   * @param {Object} [input]
   */
  stageStart(runId, stageName, input = {}) {
    this._verifyActiveRun(runId);
    
    const run = this.activeRuns.get(runId);
    const pipeline = this.registry.get(run.pipelineId);
    
    // Verify stage is expected
    if (this.strictMode && pipeline && !pipeline.stages.includes(stageName)) {
      console.warn(`Warning: Stage '${stageName}' not in pipeline '${run.pipelineId}' definition`);
    }
    
    run.stages.add(stageName);
    this.ledger.stageStart(runId, stageName, input);
  }

  /**
   * Record stage completion
   * @param {string} runId
   * @param {string} stageName
   * @param {Object} result
   */
  stageEnd(runId, stageName, result = {}) {
    this._verifyActiveRun(runId);
    
    const run = this.activeRuns.get(runId);
    run.stageResults.set(stageName, result);
    
    this.ledger.stageEnd(runId, stageName, result);
  }

  /**
   * Complete a pipeline run
   * @param {string} runId
   * @param {Object} output
   * @param {Object} [metrics]
   */
  completeRun(runId, output = {}, metrics = {}) {
    this._verifyActiveRun(runId);
    
    const run = this.activeRuns.get(runId);
    const pipeline = this.registry.get(run.pipelineId);
    
    // Verify all required stages completed
    if (this.strictMode && pipeline) {
      const missingStages = pipeline.stages.filter(s => !run.stages.has(s));
      if (missingStages.length > 0) {
        throw new Error(
          `Cannot complete run ${runId}: missing stages: ${missingStages.join(', ')}`
        );
      }
    }
    
    // Calculate aggregate metrics
    const aggregateMetrics = this._aggregateMetrics(runId, metrics);
    
    this.ledger.completeRun(runId, output, aggregateMetrics);
    this.activeRuns.delete(runId);
  }

  /**
   * Fail a pipeline run
   * @param {string} runId
   * @param {string} error
   * @param {string} [failedStage]
   * @param {Object} [partialOutput]
   */
  failRun(runId, error, failedStage = null, partialOutput = {}) {
    this._verifyActiveRun(runId);
    
    this.ledger.failRun(runId, error, failedStage, partialOutput);
    this.activeRuns.delete(runId);
  }

  /**
   * Cancel a pipeline run
   * @param {string} runId
   * @param {string} [reason]
   * @param {Object} [partialOutput]
   */
  cancelRun(runId, reason = 'user cancelled', partialOutput = {}) {
    this._verifyActiveRun(runId);
    
    this.ledger.cancelRun(runId, reason, partialOutput);
    this.activeRuns.delete(runId);
  }

  // ─── Telemetry Recording ──────────────────────────────────────────────────────

  /**
   * Record a tool invocation
   * @param {string} runId
   * @param {Object} toolCall
   * @param {string} toolCall.name - Tool name
   * @param {Object} toolCall.args - Tool arguments
   * @param {Object} [toolCall.result] - Tool result
   * @param {number} [toolCall.duration] - Execution duration in ms
   */
  recordToolCall(runId, toolCall) {
    this._verifyActiveRun(runId);
    this.ledger.recordToolCall(runId, toolCall);
  }

  /**
   * Record a model API call
   * @param {string} runId
   * @param {Object} modelCall
   * @param {string} modelCall.provider - Provider name
   * @param {string} modelCall.model - Model identifier
   * @param {number} [modelCall.promptTokens] - Prompt token count
   * @param {number} [modelCall.completionTokens] - Completion token count
   * @param {number} [modelCall.cost] - Call cost
   * @param {number} [modelCall.duration] - Call duration in ms
   */
  recordModelCall(runId, modelCall) {
    this._verifyActiveRun(runId);
    this.ledger.recordModelCall(runId, modelCall);
  }

  /**
   * Record validation result
   * @param {string} runId
   * @param {Object} validation
   * @param {string} validation.name - Validator name
   * @param {boolean} validation.passed - Whether validation passed
   * @param {string[]} [validation.errors] - Validation errors
   * @param {string[]} [validation.warnings] - Validation warnings
   */
  recordValidation(runId, validation) {
    this._verifyActiveRun(runId);
    this.ledger.recordValidation(runId, validation);
  }

  /**
   * Record file changes made during execution
   * @param {string} runId
   * @param {Array<string>} files - List of changed file paths
   * @param {Object} [metadata] - Additional metadata
   */
  recordFileChanges(runId, files, metadata = {}) {
    this._verifyActiveRun(runId);
    this.ledger.recordFileChanges(runId, files, metadata);
  }

  // ─── Query Operations ─────────────────────────────────────────────────────────

  /**
   * Query runs by various criteria
   * @param {Object} criteria
   * @param {string} [criteria.runId] - Specific run ID
   * @param {string} [criteria.pipelineId] - Pipeline ID
   * @param {string} [criteria.taskId] - Task ID
   * @param {string} [criteria.status] - Run status
   * @param {string|Date} [criteria.since] - Start date
   * @param {string|Date} [criteria.until] - End date
   * @param {string} [criteria.failedStage] - Filter by failed stage
   * @returns {Array<Object>}
   */
  query(criteria = {}) {
    let events = this.ledger.query(criteria);
    
    // Additional filtering for failed stage
    if (criteria.failedStage) {
      const runIds = new Set(events.map(e => e.runId));
      events = [];
      for (const runId of runIds) {
        const summary = this.getRunSummary(runId);
        if (summary && summary.error && summary.failedStage === criteria.failedStage) {
          events.push(...this.ledger.getRun(runId));
        }
      }
    }
    
    return events;
  }

  /**
   * Get all events for a specific run
   * @param {string} runId
   * @returns {Array<Object>}
   */
  getRun(runId) {
    return this.ledger.getRun(runId);
  }

  /**
   * Get a run summary with aggregated metrics
   * @param {string} runId
   * @returns {Object|null}
   */
  getRunSummary(runId) {
    return this.ledger.getRunSummary(runId);
  }

  /**
   * Get all runs for a specific task
   * @param {string} taskId
   * @returns {Array<Object>}
   */
  getRunsByTask(taskId) {
    const events = this.query({ taskId });
    const runIds = new Set(events.map(e => e.runId));
    return Array.from(runIds).map(runId => this.getRunSummary(runId)).filter(Boolean);
  }

  /**
   * Get all runs for a specific pipeline
   * @param {string} pipelineId
   * @returns {Array<Object>}
   */
  getRunsByPipeline(pipelineId) {
    const events = this.query({ pipelineId });
    const runIds = new Set(events.map(e => e.runId));
    return Array.from(runIds).map(runId => this.getRunSummary(runId)).filter(Boolean);
  }

  /**
   * Get failed runs
   * @param {Object} [options]
   * @param {string} [options.pipelineId] - Filter by pipeline
   * @param {string|Date} [options.since] - Start date
   * @param {string|Date} [options.until] - End date
   * @returns {Array<Object>}
   */
  getFailedRuns(options = {}) {
    const events = this.query({ 
      status: RunStatus.FAILED,
      ...options 
    });
    const runIds = new Set(events.map(e => e.runId));
    return Array.from(runIds).map(runId => this.getRunSummary(runId)).filter(Boolean);
  }

  /**
   * Get runs within a date range
   * @param {string|Date} since
   * @param {string|Date} until
   * @returns {Array<Object>}
   */
  getRunsByDateRange(since, until) {
    const events = this.query({ since, until });
    const runIds = new Set(events.map(e => e.runId));
    return Array.from(runIds).map(runId => this.getRunSummary(runId)).filter(Boolean);
  }

  // ─── Export Operations ────────────────────────────────────────────────────────

  /**
   * Export runs to JSON file
   * @param {Array<string>} runIds
   * @param {string} outputPath
   * @returns {string} Output path
   */
  exportRuns(runIds, outputPath) {
    return this.ledger.export(runIds, outputPath);
  }

  /**
   * Export all runs for a task
   * @param {string} taskId
   * @param {string} outputPath
   * @returns {string} Output path
   */
  exportTaskRuns(taskId, outputPath) {
    const runs = this.getRunsByTask(taskId);
    const runIds = runs.map(r => r.runId);
    return this.exportRuns(runIds, outputPath);
  }

  /**
   * Generate a compliance report for a date range
   * @param {string|Date} since
   * @param {string|Date} until
   * @param {string} outputPath
   * @returns {Object} Report
   */
  generateComplianceReport(since, until, outputPath) {
    const runs = this.getRunsByDateRange(since, until);
    
    const report = {
      generated: new Date().toISOString(),
      period: { since, until },
      summary: {
        totalRuns: runs.length,
        completed: runs.filter(r => r.status === RunStatus.COMPLETED).length,
        failed: runs.filter(r => r.status === RunStatus.FAILED).length,
        cancelled: runs.filter(r => r.status === RunStatus.CANCELLED).length,
        totalCost: runs.reduce((sum, r) => sum + (r.metrics?.totalCost || 0), 0),
        totalTokens: runs.reduce((sum, r) => sum + (r.metrics?.totalTokens || 0), 0)
      },
      byPipeline: {},
      runs: runs.map(r => ({
        runId: r.runId,
        pipelineId: r.pipelineId,
        taskId: r.taskId,
        status: r.status,
        started: r.started,
        completed: r.completed,
        duration: r.duration,
        error: r.error
      }))
    };

    // Group by pipeline
    for (const run of runs) {
      if (!report.byPipeline[run.pipelineId]) {
        report.byPipeline[run.pipelineId] = {
          total: 0,
          completed: 0,
          failed: 0,
          cancelled: 0
        };
      }
      report.byPipeline[run.pipelineId].total++;
      report.byPipeline[run.pipelineId][run.status]++;
    }

    if (outputPath) {
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    }

    return report;
  }

  // ─── Verification ──────────────────────────────────────────────────────────────

  /**
   * Verify run integrity - ensure incomplete runs are not marked complete
   * @param {string} runId
   * @returns {Object} Verification result
   */
  verifyRun(runId) {
    const summary = this.getRunSummary(runId);
    if (!summary) {
      return { valid: false, error: 'Run not found' };
    }

    const pipeline = this.registry.get(summary.pipelineId);
    if (!pipeline) {
      return { valid: false, error: 'Pipeline not found' };
    }

    const issues = [];

    // Check stage completion
    const expectedStages = new Set(pipeline.stages);
    const completedStages = new Set(summary.stages.map(s => s.name));
    
    for (const stage of expectedStages) {
      if (!completedStages.has(stage)) {
        issues.push(`Missing stage: ${stage}`);
      }
    }

    // Check status consistency
    if (summary.status === RunStatus.COMPLETED && issues.length > 0) {
      return {
        valid: false,
        error: 'Run marked complete but has incomplete stages',
        issues,
        summary
      };
    }

    // Check for failed stage consistency
    if (summary.status === RunStatus.COMPLETED && summary.error) {
      return {
        valid: false,
        error: 'Run marked complete but has error recorded',
        summary
      };
    }

    return { 
      valid: issues.length === 0, 
      issues,
      summary 
    };
  }

  /**
   * Verify all completed runs
   * @returns {Object} Verification report
   */
  verifyAllRuns() {
    const events = this.ledger.query({ status: RunStatus.COMPLETED });
    const runIds = new Set(events.map(e => e.runId));
    
    const results = {
      total: runIds.size,
      valid: 0,
      invalid: 0,
      issues: []
    };

    for (const runId of runIds) {
      const verification = this.verifyRun(runId);
      if (verification.valid) {
        results.valid++;
      } else {
        results.invalid++;
        results.issues.push({
          runId,
          error: verification.error,
          details: verification.issues
        });
      }
    }

    return results;
  }

  // ─── Maintenance ──────────────────────────────────────────────────────────────

  /**
   * Clean up old records based on retention policy
   */
  cleanup() {
    this.ledger.cleanup();
  }

  /**
   * Get catalog statistics
   * @returns {Object}
   */
  getStats() {
    const pipelines = this.registry.list();
    const allEvents = this.ledger.query();
    const runIds = new Set(allEvents.map(e => e.runId));
    
    const byStatus = {
      [RunStatus.QUEUED]: 0,
      [RunStatus.RUNNING]: 0,
      [RunStatus.COMPLETED]: 0,
      [RunStatus.FAILED]: 0,
      [RunStatus.CANCELLED]: 0
    };

    for (const runId of runIds) {
      const summary = this.getRunSummary(runId);
      if (summary && byStatus[summary.status] !== undefined) {
        byStatus[summary.status]++;
      }
    }

    return {
      registeredPipelines: pipelines.length,
      totalRuns: runIds.size,
      activeRuns: this.activeRuns.size,
      byStatus,
      pipelines: pipelines.map(p => ({
        id: p.id,
        name: p.name,
        version: p.version,
        stages: p.stages.length
      }))
    };
  }

  // ─── Private Methods ──────────────────────────────────────────────────────────

  _verifyActiveRun(runId) {
    if (!this.activeRuns.has(runId)) {
      throw new Error(`Run '${runId}' is not active`);
    }
  }

  _validateInput(input, schema, pipelineId) {
    // Basic schema validation
    for (const [key, type] of Object.entries(schema)) {
      const optional = type.endsWith('?');
      const expectedType = optional ? type.slice(0, -1) : type;
      
      if (!optional && !(key in input)) {
        throw new Error(`Pipeline '${pipelineId}' missing required input: ${key}`);
      }
      
      if (key in input && expectedType !== 'any') {
        const actualType = Array.isArray(input[key]) ? 'array' : typeof input[key];
        if (actualType !== expectedType) {
          throw new Error(
            `Pipeline '${pipelineId}' input '${key}' expected ${expectedType}, got ${actualType}`
          );
        }
      }
    }
  }

  _aggregateMetrics(runId, additionalMetrics = {}) {
    const run = this.activeRuns.get(runId);
    if (!run) return additionalMetrics;
    
    const events = this.ledger.getRun(runId);
    
    const modelCalls = events.filter(e => e.type === EventType.MODEL_CALL);
    const toolCalls = events.filter(e => e.type === EventType.TOOL_CALL);
    const validations = events.filter(e => e.type === EventType.VALIDATION);
    const fileChanges = events.filter(e => e.type === EventType.FILE_CHANGE);
    
    return {
      ...additionalMetrics,
      stagesCompleted: run.stages.size,
      stageResults: Object.fromEntries(run.stageResults),
      modelCalls: modelCalls.length,
      toolCalls: toolCalls.length,
      totalPromptTokens: modelCalls.reduce((sum, c) => sum + (c.promptTokens || 0), 0),
      totalCompletionTokens: modelCalls.reduce((sum, c) => sum + (c.completionTokens || 0), 0),
      totalCost: modelCalls.reduce((sum, c) => sum + (c.cost || 0), 0),
      validationsPassed: validations.filter(v => v.passed).length,
      validationsFailed: validations.filter(v => !v.passed).length,
      filesChanged: fileChanges.reduce((sum, fc) => sum + (fc.files?.length || 0), 0)
    };
  }
}

// Singleton instance
let catalog = null;

/**
 * Get the global pipeline catalog instance
 * @param {Object} [options]
 * @returns {PipelineCatalog}
 */
function getCatalog(options) {
  if (!catalog) {
    catalog = new PipelineCatalog(options);
  }
  return catalog;
}

/**
 * Reset the global catalog (for testing)
 */
function resetCatalog() {
  catalog = null;
  resetRegistry();
}

module.exports = {
  PipelineCatalog,
  getCatalog,
  resetCatalog,
  EventType,
  RunStatus,
  generateRunId
};

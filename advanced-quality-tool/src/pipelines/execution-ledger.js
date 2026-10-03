/**
 * Execution Ledger (P9-T024)
 *
 * Append-only event store for pipeline execution records.
 * Supports both JSONL (lightweight) and SQLite (queryable) backends.
 *
 * Every pipeline run is recorded with:
 * - run ID, task ID, workspace, timestamps
 * - status, stage results, errors, cancellation state
 * - model, provider, token usage, cost
 * - documentation sources, tool calls, changed files
 * - validation results
 *
 * @module pipelines/execution-ledger
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Pipeline execution event types
 */
const EventType = {
  RUN_START: 'run-start',
  STAGE_START: 'stage-start',
  STAGE_END: 'stage-end',
  RUN_COMPLETE: 'run-complete',
  RUN_FAIL: 'run-fail',
  RUN_CANCEL: 'run-cancel',
  TOOL_CALL: 'tool-call',
  MODEL_CALL: 'model-call',
  VALIDATION: 'validation',
  FILE_CHANGE: 'file-change'
};

/**
 * Pipeline execution status
 */
const RunStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Generate a unique run ID
 * @returns {string}
 */
function generateRunId() {
  return `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Execution Ledger - JSONL backend
 */
class ExecutionLedger {
  constructor(options = {}) {
    this.storePath = options.storePath || path.join(process.cwd(), '.aqt-reports', 'pipelines');
    this.format = options.format || 'jsonl'; // 'jsonl' or 'sqlite' (future)
    this.retention = options.retention || { days: 90 };
    this.redactSecrets = options.redactSecrets !== false;
    
    this._ensureStorageExists();
  }

  /**
   * Start a new pipeline run
   * @param {Object} params
   * @param {string} params.pipelineId - Registered pipeline ID
   * @param {string} [params.taskId] - Associated task ID
   * @param {string} [params.workspace] - Workspace root path
   * @param {Object} [params.input] - Pipeline input parameters
   * @param {Object} [params.context] - Additional context (model, provider, etc.)
   * @returns {string} runId
   */
  startRun({ pipelineId, taskId = null, workspace = null, input = {}, context = {} }) {
    if (!pipelineId) {
      throw new Error('pipelineId is required');
    }

    const runId = generateRunId();
    const event = {
      type: EventType.RUN_START,
      runId,
      pipelineId,
      taskId,
      workspace,
      input: this._sanitize(input),
      context: this._sanitize(context),
      timestamp: new Date().toISOString(),
      status: RunStatus.RUNNING
    };

    this._append(event);
    return runId;
  }

  /**
   * Record stage start
   * @param {string} runId
   * @param {string} stageName
   * @param {Object} [input]
   */
  stageStart(runId, stageName, input = {}) {
    this._append({
      type: EventType.STAGE_START,
      runId,
      stageName,
      input: this._sanitize(input),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Record stage completion
   * @param {string} runId
   * @param {string} stageName
   * @param {Object} result
   */
  stageEnd(runId, stageName, result = {}) {
    this._append({
      type: EventType.STAGE_END,
      runId,
      stageName,
      result: this._sanitize(result),
      timestamp: new Date().toISOString(),
      duration: result.duration || null
    });
  }

  /**
   * Record successful run completion
   * @param {string} runId
   * @param {Object} output
   * @param {Object} [metrics]
   */
  completeRun(runId, output = {}, metrics = {}) {
    this._append({
      type: EventType.RUN_COMPLETE,
      runId,
      output: this._sanitize(output),
      metrics,
      timestamp: new Date().toISOString(),
      status: RunStatus.COMPLETED
    });
  }

  /**
   * Record run failure
   * @param {string} runId
   * @param {string} error
   * @param {string} [failedStage]
   * @param {Object} [partialOutput]
   */
  failRun(runId, error, failedStage = null, partialOutput = {}) {
    this._append({
      type: EventType.RUN_FAIL,
      runId,
      error: String(error),
      failedStage,
      partialOutput: this._sanitize(partialOutput),
      timestamp: new Date().toISOString(),
      status: RunStatus.FAILED
    });
  }

  /**
   * Record run cancellation
   * @param {string} runId
   * @param {string} [reason]
   * @param {Object} [partialOutput]
   */
  cancelRun(runId, reason = 'user cancelled', partialOutput = {}) {
    this._append({
      type: EventType.RUN_CANCEL,
      runId,
      reason,
      partialOutput: this._sanitize(partialOutput),
      timestamp: new Date().toISOString(),
      status: RunStatus.CANCELLED
    });
  }

  /**
   * Record a tool invocation
   * @param {string} runId
   * @param {Object} toolCall
   */
  recordToolCall(runId, toolCall) {
    this._append({
      type: EventType.TOOL_CALL,
      runId,
      tool: toolCall.name,
      args: this._sanitize(toolCall.args),
      result: this._sanitize(toolCall.result),
      duration: toolCall.duration,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Record a model API call
   * @param {string} runId
   * @param {Object} modelCall
   */
  recordModelCall(runId, modelCall) {
    this._append({
      type: EventType.MODEL_CALL,
      runId,
      provider: modelCall.provider,
      model: modelCall.model,
      promptTokens: modelCall.promptTokens,
      completionTokens: modelCall.completionTokens,
      cost: modelCall.cost,
      duration: modelCall.duration,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Record validation result
   * @param {string} runId
   * @param {Object} validation
   */
  recordValidation(runId, validation) {
    this._append({
      type: EventType.VALIDATION,
      runId,
      validator: validation.name,
      passed: validation.passed,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Record file changes
   * @param {string} runId
   * @param {Array<string>} files
   * @param {Object} [metadata]
   */
  recordFileChanges(runId, files, metadata = {}) {
    this._append({
      type: EventType.FILE_CHANGE,
      runId,
      files,
      metadata,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Query runs by criteria
   * @param {Object} criteria
   * @returns {Array<Object>}
   */
  query(criteria = {}) {
    const events = this._readAll();
    let filtered = events;

    if (criteria.runId) {
      filtered = filtered.filter(e => e.runId === criteria.runId);
    }
    if (criteria.pipelineId) {
      filtered = filtered.filter(e => e.pipelineId === criteria.pipelineId);
    }
    if (criteria.taskId) {
      filtered = filtered.filter(e => e.taskId === criteria.taskId);
    }
    if (criteria.status) {
      filtered = filtered.filter(e => e.status === criteria.status);
    }
    if (criteria.since) {
      const since = new Date(criteria.since);
      filtered = filtered.filter(e => new Date(e.timestamp) >= since);
    }
    if (criteria.until) {
      const until = new Date(criteria.until);
      filtered = filtered.filter(e => new Date(e.timestamp) <= until);
    }

    return filtered;
  }

  /**
   * Get all events for a specific run
   * @param {string} runId
   * @returns {Array<Object>}
   */
  getRun(runId) {
    return this.query({ runId });
  }

  /**
   * Get run summary with aggregated metrics
   * @param {string} runId
   * @returns {Object|null}
   */
  getRunSummary(runId) {
    const events = this.getRun(runId);
    if (events.length === 0) return null;

    const startEvent = events.find(e => e.type === EventType.RUN_START);
    const endEvent = events.find(e => 
      e.type === EventType.RUN_COMPLETE || 
      e.type === EventType.RUN_FAIL || 
      e.type === EventType.RUN_CANCEL
    );

    if (!startEvent) return null;

    const stages = events
      .filter(e => e.type === EventType.STAGE_START)
      .map(start => {
        const end = events.find(e => 
          e.type === EventType.STAGE_END && e.stageName === start.stageName
        );
        return {
          name: start.stageName,
          started: start.timestamp,
          completed: end ? end.timestamp : null,
          duration: end ? end.duration : null,
          result: end ? end.result : null
        };
      });

    const toolCalls = events.filter(e => e.type === EventType.TOOL_CALL);
    const modelCalls = events.filter(e => e.type === EventType.MODEL_CALL);
    const validations = events.filter(e => e.type === EventType.VALIDATION);
    const fileChanges = events.filter(e => e.type === EventType.FILE_CHANGE);

    const totalCost = modelCalls.reduce((sum, call) => sum + (call.cost || 0), 0);
    const totalTokens = modelCalls.reduce((sum, call) => 
      sum + (call.promptTokens || 0) + (call.completionTokens || 0), 0
    );

    return {
      runId,
      pipelineId: startEvent.pipelineId,
      taskId: startEvent.taskId,
      workspace: startEvent.workspace,
      status: endEvent ? endEvent.status : RunStatus.RUNNING,
      started: startEvent.timestamp,
      completed: endEvent ? endEvent.timestamp : null,
      duration: endEvent ? 
        new Date(endEvent.timestamp) - new Date(startEvent.timestamp) : null,
      stages,
      metrics: {
        toolCalls: toolCalls.length,
        modelCalls: modelCalls.length,
        totalTokens,
        totalCost,
        validations: validations.length,
        validationsPassed: validations.filter(v => v.passed).length,
        filesChanged: fileChanges.reduce((sum, fc) => sum + fc.files.length, 0)
      },
      output: endEvent ? endEvent.output : null,
      error: endEvent && endEvent.error ? endEvent.error : null
    };
  }

  /**
   * Export runs to a file
   * @param {Array<string>} runIds
   * @param {string} outputPath
   */
  export(runIds, outputPath) {
    const runs = runIds.map(runId => ({
      runId,
      summary: this.getRunSummary(runId),
      events: this.getRun(runId)
    }));

    fs.writeFileSync(outputPath, JSON.stringify(runs, null, 2), 'utf8');
    return outputPath;
  }

  /**
   * Clean up old records based on retention policy
   */
  cleanup() {
    if (!this.retention || !this.retention.days) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retention.days);

    const events = this._readAll();
    const retained = events.filter(e => new Date(e.timestamp) >= cutoff);

    // Rewrite the ledger file with only retained events
    const ledgerPath = this._getLedgerPath();
    fs.writeFileSync(
      ledgerPath,
      retained.map(e => JSON.stringify(e)).join('\n'),
      'utf8'
    );
  }

  // ─── Private methods ──────────────────────────────────────────────────────────

  _ensureStorageExists() {
    if (!fs.existsSync(this.storePath)) {
      fs.mkdirSync(this.storePath, { recursive: true });
    }
  }

  _getLedgerPath() {
    return path.join(this.storePath, 'execution-ledger.jsonl');
  }

  _append(event) {
    const ledgerPath = this._getLedgerPath();
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(ledgerPath, line, 'utf8');
  }

  _readAll() {
    const ledgerPath = this._getLedgerPath();
    if (!fs.existsSync(ledgerPath)) {
      return [];
    }

    const content = fs.readFileSync(ledgerPath, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  _sanitize(obj) {
    if (!this.redactSecrets) return obj;
    
    // Deep clone and redact common secret patterns
    const clone = JSON.parse(JSON.stringify(obj));
    return this._redactSecrets(clone);
  }

  _redactSecrets(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;

    const secretKeys = [
      'password', 'secret', 'token', 'apikey', 'api_key',
      'accesstoken', 'access_token', 'privatekey', 'private_key',
      'credentials', 'authorization', 'auth'
    ];

    for (const key of Object.keys(obj)) {
      const lowerKey = key.toLowerCase();
      if (secretKeys.some(sk => lowerKey.includes(sk))) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        obj[key] = this._redactSecrets(obj[key]);
      }
    }

    return obj;
  }
}

module.exports = {
  ExecutionLedger,
  EventType,
  RunStatus,
  generateRunId
};

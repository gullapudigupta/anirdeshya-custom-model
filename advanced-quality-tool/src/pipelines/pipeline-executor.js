/**
 * Pipeline Executor (P9-T024)
 *
 * Executes registered pipelines with full event recording to the execution ledger.
 * Handles stage execution, error propagation, cancellation, and metrics collection.
 *
 * @module pipelines/pipeline-executor
 */

'use strict';

const { getRegistry } = require('./pipeline-registry');
const { ExecutionLedger, RunStatus } = require('./execution-ledger');

/**
 * Pipeline Executor
 */
class PipelineExecutor {
  constructor(options = {}) {
    this.registry = options.registry || getRegistry();
    this.ledger = options.ledger || new ExecutionLedger(options.ledgerOptions);
    this.cancellations = new Map(); // runId -> cancellation flag
  }

  /**
   * Execute a registered pipeline
   * @param {string} pipelineId - Registered pipeline ID
   * @param {Object} params
   * @param {Object} params.input - Pipeline input
   * @param {string} [params.taskId] - Associated task ID
   * @param {string} [params.workspace] - Workspace path
   * @param {Object} [params.context] - Additional context (model, provider, etc.)
   * @param {Object} params.stageHandlers - Map of stage name to handler function
   * @param {Function} [params.onProgress] - Progress callback
   * @returns {Promise<Object>} Execution result
   */
  async execute(pipelineId, params = {}) {
    const {
      input = {},
      taskId = null,
      workspace = null,
      context = {},
      stageHandlers = {},
      onProgress = null
    } = params;

    // Validate pipeline exists
    const pipeline = this.registry.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline '${pipelineId}' is not registered`);
    }

    // Start run in ledger
    const runId = this.ledger.startRun({
      pipelineId,
      taskId,
      workspace,
      input,
      context
    });

    this._progress(onProgress, { type: 'run-start', runId, pipelineId });

    try {
      // Execute stages in order
      const stageResults = {};
      const stageOutputs = {};
      let lastOutput = input;

      for (const stageName of pipeline.stages) {
        // Check for cancellation
        if (this._isCancelled(runId)) {
          this.ledger.cancelRun(runId, 'cancelled by user', { stageResults });
          this._progress(onProgress, { type: 'run-cancel', runId });
          return {
            runId,
            status: RunStatus.CANCELLED,
            stageResults,
            output: null,
            error: 'Cancelled by user'
          };
        }

        this._progress(onProgress, { type: 'stage-start', runId, stageName });

        const stageStart = Date.now();
        this.ledger.stageStart(runId, stageName, lastOutput);

        try {
          const handler = stageHandlers[stageName];
          if (!handler || typeof handler !== 'function') {
            throw new Error(`No handler provided for stage '${stageName}'`);
          }

          // Execute stage handler with context
          const stageContext = {
            runId,
            pipelineId,
            stageName,
            input: lastOutput,
            previousResults: stageOutputs,
            ledger: this.ledger,
            workspace,
            taskId,
            context
          };

          const stageOutput = await handler(stageContext);
          const duration = Date.now() - stageStart;
          stageOutputs[stageName] = stageOutput;

          this.ledger.stageEnd(runId, stageName, { 
            success: true, 
            output: stageOutput,
            duration 
          });

          stageResults[stageName] = {
            success: true,
            output: stageOutput,
            duration
          };

          lastOutput = stageOutput;
          this._progress(onProgress, { 
            type: 'stage-end', 
            runId, 
            stageName, 
            success: true,
            duration 
          });

        } catch (error) {
          const duration = Date.now() - stageStart;
          
          this.ledger.stageEnd(runId, stageName, { 
            success: false, 
            error: error.message,
            duration 
          });

          stageResults[stageName] = {
            success: false,
            error: error.message,
            duration
          };

          // Stage failure fails the entire pipeline
          this.ledger.failRun(runId, error.message, stageName, stageResults);
          this._progress(onProgress, { 
            type: 'stage-error', 
            runId, 
            stageName, 
            error: error.message 
          });
          this._progress(onProgress, { type: 'run-fail', runId, error: error.message });

          return {
            runId,
            status: RunStatus.FAILED,
            failedStage: stageName,
            stageResults,
            output: null,
            error: error.message
          };
        }
      }

      // All stages completed successfully
      this.ledger.completeRun(runId, lastOutput, {
        stagesCompleted: pipeline.stages.length,
        totalDuration: Object.values(stageResults).reduce((sum, s) => sum + (s.duration || 0), 0)
      });

      this._progress(onProgress, { type: 'run-complete', runId, output: lastOutput });

      return {
        runId,
        status: RunStatus.COMPLETED,
        stageResults,
        output: lastOutput,
        error: null
      };

    } catch (error) {
      // Unexpected error outside stage execution
      this.ledger.failRun(runId, error.message, null, {});
      this._progress(onProgress, { type: 'run-fail', runId, error: error.message });

      return {
        runId,
        status: RunStatus.FAILED,
        stageResults: {},
        output: null,
        error: error.message
      };
    } finally {
      // Cleanup cancellation flag
      this.cancellations.delete(runId);
    }
  }

  /**
   * Cancel a running pipeline
   * @param {string} runId
   */
  cancel(runId) {
    this.cancellations.set(runId, true);
  }

  /**
   * Get execution summary
   * @param {string} runId
   * @returns {Object|null}
   */
  getSummary(runId) {
    return this.ledger.getRunSummary(runId);
  }

  /**
   * Query execution history
   * @param {Object} criteria
   * @returns {Array<Object>}
   */
  query(criteria) {
    return this.ledger.query(criteria);
  }

  // ─── Private methods ──────────────────────────────────────────────────────────

  _isCancelled(runId) {
    return this.cancellations.get(runId) === true;
  }

  _progress(callback, event) {
    if (typeof callback === 'function') {
      try {
        callback(event);
      } catch (err) {
        // Ignore progress callback errors
      }
    }
  }
}

module.exports = {
  PipelineExecutor
};

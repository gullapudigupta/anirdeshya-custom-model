/**
 * Work Orchestrator (P9-T010, P12-T002, P12-T003)
 *
 * Coordinates agent work execution with dependency tracking, concurrency control,
 * retries, and cancellation support. Ensures work is executed in dependency order
 * and tracks all state transitions. Injects a ToolRegistry into step execution so
 * the model executor can only call registered read/search/edit/check tools,
 * under per-task tool-call and output budgets.
 *
 * @module agent/work-orchestrator
 */

'use strict';

const crypto = require('crypto');
const { WorkItem, WorkItemStatus } = require('./work-item');
const { AgentPlanner } = require('./planner');
const { PipelineExecutor } = require('../pipelines/pipeline-executor');
const { ToolRegistry } = require('./tool-registry');
const { WorkspaceContext } = require('./workspace-context');
const { PermissionManager } = require('./permissions');

const DEFAULT_TOOL_BUDGET = Object.freeze({
  maxCalls: 25,
  maxOutputBytes: 200 * 1024 // 200KB
});

/**
 * Work Orchestrator
 */
class WorkOrchestrator {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.planner = options.planner || new AgentPlanner({ workspace: this.workspace });
    this.pipelineExecutor = options.pipelineExecutor || new PipelineExecutor();
    this.stepExecutor = options.stepExecutor || options.executor || null;
    this.provider = options.provider || null;
    this.model = options.model || null;
    this.providerConfig = options.providerConfig || null;
    this.stepTimeoutMs = options.stepTimeoutMs === undefined ? 120000 : options.stepTimeoutMs;
    if (!Number.isFinite(this.stepTimeoutMs) || this.stepTimeoutMs <= 0) {
      throw new Error('stepTimeoutMs must be a positive finite number');
    }
    this.approvalTimeoutMs = options.approvalTimeoutMs === undefined ? 30000 : options.approvalTimeoutMs;
    if (!Number.isFinite(this.approvalTimeoutMs) || this.approvalTimeoutMs <= 0) {
      throw new Error('approvalTimeoutMs must be a positive finite number');
    }

    this.permissionLimits = options.permissionLimits || {};
    const toolRegistryOptions = options.toolRegistryOptions || {};
    this.permissionManager = options.permissionManager || toolRegistryOptions.permissionManager ||
      new PermissionManager({
        workspace: this.workspace,
        ...(options.permissionOptions || {}),
        maxFilesPerTask: this.permissionLimits.maxFilesPerTask ?? options.permissionOptions?.maxFilesPerTask,
        requireApprovalForHighRisk:
          this.permissionLimits.requireApprovalForHighRisk ?? options.permissionOptions?.requireApprovalForHighRisk
      });
    // Tool registry: injected into every step execution. Pass `toolRegistry: null`
    // explicitly to disable tool access entirely for a given orchestrator.
    this.toolRegistry = options.toolRegistry !== undefined
      ? options.toolRegistry
      : new ToolRegistry({
        workspace: this.workspace,
        ...toolRegistryOptions,
        permissionManager: this.permissionManager
      });
    this.workspaceContext = options.workspaceContext !== undefined
      ? options.workspaceContext
      : new WorkspaceContext({ workspace: this.workspace, ...(options.contextOptions || {}) });
    this.toolBudget = {
      maxCalls: options.toolBudget?.maxCalls ?? DEFAULT_TOOL_BUDGET.maxCalls,
      maxOutputBytes: options.toolBudget?.maxOutputBytes ?? DEFAULT_TOOL_BUDGET.maxOutputBytes
    };
    
    // Work queue
    this.workItems = new Map();
    this.workQueue = [];
    
    // Concurrency control
    this.maxConcurrent = options.maxConcurrent || 3;
    this.activeWork = new Map();
    this.activeExecutions = new Map();
    this.pausedFrom = new Map();
    this.pausePollMs = options.pausePollMs || 50;
    
    // Callbacks
    this.onProgress = options.onProgress || null;
    this.onApprovalRequired = options.onApprovalRequired || null;
  }

  /**
   * Add work to the queue
   * @param {Object} params
   * @returns {WorkItem}
   */
  addWork(params) {
    const item = new WorkItem(params);
    this.workItems.set(item.id, item);
    this.workQueue.push(item.id);
    
    this._progress({ type: 'work-added', item: item.getSummary() });
    return item;
  }

  /**
   * Execute all queued work
   * @returns {Promise<Object>} Summary of execution
   */
  async executeAll() {
    const results = {
      total: this.workQueue.length,
      completed: 0,
      failed: 0,
      cancelled: 0,
      items: []
    };

    this._progress({ type: 'execution-start', total: results.total });

    // Process queue until empty or all work is blocked
    while (this.workQueue.length > 0) {
      // Find ready work items
      const readyItems = this._getReadyItems();
      
      if (readyItems.length === 0) {
        // Check if we have active work
        if (this.activeWork.size === 0) {
          // No active work and no ready items = deadlock or completion
          const remaining = this.workQueue.length;
          if (remaining > 0) {
            // Deadlock: items are blocked but nothing is running
            this._progress({ 
              type: 'deadlock', 
              remainingItems: remaining,
              blockedItems: this.workQueue.map(id => {
                const item = this.workItems.get(id);
                return item.getSummary();
              })
            });
          }
          break;
        }
        
        // Wait for active work to complete
        await this._waitForActiveWork();
        continue;
      }

      // Execute ready items up to concurrency limit
      const availableSlots = this.maxConcurrent - this.activeWork.size;
      const itemsToExecute = readyItems.slice(0, availableSlots);

      for (const item of itemsToExecute) {
        // Remove from queue
        const queueIndex = this.workQueue.indexOf(item.id);
        if (queueIndex !== -1) {
          this.workQueue.splice(queueIndex, 1);
        }
        
        // Execute asynchronously
        this._executeWorkItem(item, results);
      }

      // Brief delay to prevent tight loop
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Wait for all active work to complete
    while (this.activeWork.size > 0) {
      await this._waitForActiveWork();
    }

    this._progress({ type: 'execution-complete', results });
    return results;
  }

  /**
   * Execute a single work item
   * @param {string} itemId
   * @returns {Promise<Object>}
   */
  async executeOne(itemId) {
    const item = this.workItems.get(itemId);
    if (!item) {
      throw new Error(`Work item '${itemId}' not found`);
    }

    // Check readiness
    const readiness = item.checkReadiness(this.workItems);
    if (!readiness.ready) {
      throw new Error(`Work item not ready: ${readiness.blockedBy.join(', ')}`);
    }

    const results = { total: 1, completed: 0, failed: 0, cancelled: 0, items: [] };
    await this._executeWorkItem(item, results);
    
    // Wait for completion
    while (this.activeWork.has(itemId)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results.items[0];
  }

  /**
   * Cancel a work item
   * @param {string} itemId
   */
  cancel(itemId) {
    const item = this.workItems.get(itemId);
    if (!item) return;
    this.pausedFrom.delete(itemId);

    if (this.activeWork.has(itemId)) {
      // Cancel active work
      const controller = this.activeExecutions.get(itemId);
      item.updateStatus(WorkItemStatus.CANCELLED, { reason: 'User cancelled' });
      if (controller && !controller.signal.aborted) {
        controller.abort(createExecutionError('EXECUTION_CANCELLED', 'User cancelled'));
      }
      this._progress({ type: 'work-cancelled', item: item.getSummary() });
    } else if (this.workQueue.includes(itemId)) {
      // Remove from queue
      const index = this.workQueue.indexOf(itemId);
      this.workQueue.splice(index, 1);
      item.updateStatus(WorkItemStatus.CANCELLED, { reason: 'Cancelled before execution' });
      this._progress({ type: 'work-cancelled', item: item.getSummary() });
    }
  }

  /**
   * Pause a queued or working item. Running work pauses at the next step boundary.
   * @param {string} itemId
   * @returns {{ paused: boolean, status: string|null, reason?: string }}
   */
  pause(itemId) {
    const item = this.workItems.get(itemId);
    if (!item) return { paused: false, status: null, reason: 'Work item not found' };
    if (item.status === WorkItemStatus.PAUSED) return { paused: true, status: item.status };
    if (![WorkItemStatus.QUEUED, WorkItemStatus.WORKING].includes(item.status)) {
      return { paused: false, status: item.status, reason: `Cannot pause work in '${item.status}' state` };
    }
    this.pausedFrom.set(itemId, item.status);
    item.updateStatus(WorkItemStatus.PAUSED, { resumeTo: item.status });
    this._progress({ type: 'work-paused', item: item.getSummary() });
    return { paused: true, status: item.status };
  }

  /**
   * Resume a paused item.
   * @param {string} itemId
   * @returns {{ resumed: boolean, status: string|null, reason?: string }}
   */
  resume(itemId) {
    const item = this.workItems.get(itemId);
    if (!item) return { resumed: false, status: null, reason: 'Work item not found' };
    if (item.status !== WorkItemStatus.PAUSED) {
      return { resumed: false, status: item.status, reason: `Cannot resume work in '${item.status}' state` };
    }
    const resumeTo = this.pausedFrom.get(itemId) || WorkItemStatus.QUEUED;
    this.pausedFrom.delete(itemId);
    item.updateStatus(resumeTo, { resumedFrom: WorkItemStatus.PAUSED });
    this._progress({ type: 'work-resumed', item: item.getSummary() });
    return { resumed: true, status: item.status };
  }

  /**
   * Get work item by ID
   * @param {string} itemId
   * @returns {WorkItem|null}
   */
  getWorkItem(itemId) {
    return this.workItems.get(itemId) || null;
  }

  /**
   * Get all work items
   * @returns {Array<WorkItem>}
   */
  getAllWorkItems() {
    return Array.from(this.workItems.values());
  }

  /**
   * Get queue status
   * @returns {Object}
   */
  getStatus() {
    return {
      queued: this.workQueue.length,
      active: this.activeWork.size,
      total: this.workItems.size,
      byStatus: this._groupByStatus()
    };
  }

  // ─── Private methods ──────────────────────────────────────────────────────────

  async _executeWorkItem(item, results) {
    const controller = new AbortController();
    this.activeExecutions.set(item.id, controller);
    const executeAsync = async () => {
      try {
        await this._waitWhilePaused(item);
        if (item.status === WorkItemStatus.CANCELLED) {
          results.cancelled++;
          results.items.push({ itemId: item.id, status: 'cancelled', reason: 'Cancelled before execution' });
          return;
        }

        this._progress({ type: 'work-start', item: item.getSummary() });
        item.updateStatus(WorkItemStatus.PLANNING);

        if (this.workspaceContext) {
          const suppliedContext = item.context && typeof item.context === 'object' ? item.context : {};
          const requestedFiles = Array.isArray(suppliedContext.files) ? suppliedContext.files : [];
          item.context = Object.assign(suppliedContext, {
            ...this.workspaceContext.collect(requestedFiles, { query: item.description }),
            workspace: this.workspace
          });
        }

        // 1. Create execution plan
        const plan = await this.planner.plan({
          description: item.description,
          deliverables: item.plan?.deliverables || [],
          dependencies: item.dependencies,
          acceptanceCriteria: item.taskContract?.acceptanceCriteria || [],
          context: {
            workspace: this.workspace,
            files: (item.context?.files || []).map(file =>
              typeof file === 'string' ? file : file.path),
            gatheredContext: item.context || {},
            scopeFiles: item.taskContract?.files || []
          }
        });
        if (controller.signal.aborted) throw cancellationError(controller.signal);

        const executablePlan = prepareExecutablePlan(plan);
        item.setPlan(executablePlan);
        this._progress({ type: 'plan-created', item: item.getSummary(), plan: executablePlan });

        // 2. Validate plan
        const allowedFiles = [
          ...(item.taskContract?.files || []),
          ...(item.context?.files || []).map(file => typeof file === 'string' ? file : file.path)
        ];
        const validation = this.planner.validatePlan(executablePlan, {
          allowedFiles: allowedFiles.length ? allowedFiles : undefined
        });
        if (!validation.valid) {
          throw new Error(`Invalid plan: ${validation.issues.join(', ')}`);
        }

        // 3. Check permissions and approval requirements
        const planDigest = digestPlan(executablePlan);
        const planOperation = {
          type: 'plan',
          digest: planDigest,
          params: {
            affectedFiles: executablePlan.affectedFiles,
            risks: executablePlan.risks,
            requiresApproval: executablePlan.metadata.requiresApproval
          }
        };
        const permissionCheck = await this.permissionManager.checkPermission(planOperation, {
          deferApproval: true
        });
        this._recordPermissionDecision(item, planOperation, permissionCheck);
        if (!permissionCheck.allowed) {
          throw new Error(`Permission denied: ${permissionCheck.reason}`);
        }

        if (permissionCheck.requiresApproval) {
          item.updateStatus(WorkItemStatus.AWAITING_APPROVAL);
          this._progress({
            type: 'approval-required',
            item: item.getSummary(),
            plan: executablePlan,
            planDigest
          });
          
          // Request approval
          const approval = await this._requestApproval(item, executablePlan, {
            kind: 'plan',
            planDigest,
            actionDigest: null,
            operation: planOperation
          }, controller.signal, () => digestPlan(executablePlan));
          if (!approval.approved) {
            this.permissionManager.recordApproval(planOperation, {
              approved: false,
              planDigest,
              outcome: approval.outcome,
              reason: approval.reason,
              risk: permissionCheck.risk
            });
            item.updateStatus(WorkItemStatus.CANCELLED, { reason: approval.reason });
            results.cancelled++;
            results.items.push({
              itemId: item.id,
              status: 'cancelled',
              reason: approval.reason,
              contextProvenance: this._contextProvenance(item)
            });
            return;
          }
          if (item.plan !== executablePlan || digestPlan(executablePlan) !== planDigest) {
            this.permissionManager.recordApproval(planOperation, {
              approved: false,
              planDigest,
              outcome: 'invalidated',
              reason: 'Approved plan changed before execution',
              risk: permissionCheck.risk
            });
            throw createExecutionError('APPROVAL_INVALIDATED', 'Approved plan changed before execution; approval is invalid');
          }
          this.permissionManager.recordApproval(planOperation, {
            approved: true,
            planDigest,
            outcome: 'approved',
            risk: permissionCheck.risk
          });
          item.approval = {
            planVersion: executablePlan.planVersion,
            planDigest,
            approvedAt: new Date().toISOString()
          };
        }
        if (controller.signal.aborted) throw cancellationError(controller.signal);

        // 4. Execute work
        item.updateStatus(WorkItemStatus.WORKING);
        this._progress({ type: 'work-executing', item: item.getSummary() });

        const output = await this._executeSteps(item, executablePlan, controller);
        item.setOutput(output);

        if (item.status === WorkItemStatus.CANCELLED) {
          results.cancelled++;
          results.items.push({
            itemId: item.id,
            status: 'cancelled',
            reason: 'Cancelled during execution',
            output,
            contextProvenance: this._contextProvenance(item)
          });
          this._progress({ type: 'work-cancelled', item: item.getSummary() });
          return;
        }

        // 5. Verify results
        item.updateStatus(WorkItemStatus.VERIFYING);
        const verificationResults = await this._verifyWork(item, executablePlan);
        item.setVerificationResults(verificationResults);
        if (controller.signal.aborted) throw cancellationError(controller.signal);

        if (!verificationResults.passed) {
          // Retry if available
          if (item.incrementRetry()) {
            this._progress({ type: 'work-retry', item: item.getSummary() });
            this.workQueue.push(item.id);
            item.updateStatus(WorkItemStatus.QUEUED, { reason: 'Verification failed, retrying' });
            return;
          } else {
            throw new Error(`Verification failed after ${item.retryCount} attempts`);
          }
        }

        // 6. Complete
        item.updateStatus(WorkItemStatus.COMPLETED);
        results.completed++;
        results.items.push({
          itemId: item.id,
          status: 'completed',
          output,
          contextProvenance: this._contextProvenance(item)
        });
        this._progress({ type: 'work-complete', item: item.getSummary() });

      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (item.status === WorkItemStatus.CANCELLED || failure.code === 'EXECUTION_CANCELLED') {
          if (item.status !== WorkItemStatus.CANCELLED) {
            item.updateStatus(WorkItemStatus.CANCELLED, { reason: failure.message });
          }
          results.cancelled++;
          results.items.push({
            itemId: item.id,
            status: 'cancelled',
            reason: failure.message,
            code: failure.code || 'EXECUTION_CANCELLED',
            contextProvenance: this._contextProvenance(item)
          });
          this._progress({ type: 'work-cancelled', item: item.getSummary() });
          return;
        }
        item.setError(failure);
        item.updateStatus(WorkItemStatus.FAILED, { error: failure.message });
        results.failed++;
        results.items.push({
          itemId: item.id,
          status: 'failed',
          error: failure.message,
          code: failure.code || 'EXECUTION_ERROR',
          provider: failure.provider || this.provider,
          model: failure.model || this.model,
          contextProvenance: this._contextProvenance(item)
        });
        this._progress({ type: 'work-error', item: item.getSummary(), error: failure.message });
      } finally {
        this.activeWork.delete(item.id);
        this.activeExecutions.delete(item.id);
      }
    };

    const promise = executeAsync();
    this.activeWork.set(item.id, promise);
  }

  _contextProvenance(item) {
    return item.context?.provenance || [];
  }

  async _executeSteps(item, plan, controller) {
    const output = { completedSteps: [], results: {} };

    for (const step of plan.steps) {
      await this._waitWhilePaused(item);

      // Check for cancellation
      if (item.status === WorkItemStatus.CANCELLED) {
        throw createExecutionError('EXECUTION_CANCELLED', 'User cancelled');
      }

      this._progress({ 
        type: 'step-start', 
        item: item.getSummary(), 
        step: step.description 
      });

      // Execute step (stubbed for now - would call actual agent executor)
      const stepResult = await this._executeStep(item, step, plan, controller);
      
      output.completedSteps.push(step.id);
      output.results[step.id] = stepResult;

      this._progress({ 
        type: 'step-complete', 
        item: item.getSummary(), 
        step: step.description,
        result: stepResult
      });
    }

    return output;
  }

  async _executeStep(item, step, plan, controller) {
    const executor = this.stepExecutor;
    if (!executor) {
      const code = this.provider ? 'PROVIDER_EXECUTOR_NOT_CONFIGURED' : 'EXECUTOR_NOT_CONFIGURED';
      throw createExecutionError(code, this.provider
        ? `No executor is configured for provider '${this.provider}'`
        : 'No step executor is configured');
    }

    const execute = typeof executor === 'function'
      ? executor
      : executor && (executor.executeStep || executor.execute);
    if (typeof execute !== 'function') {
      throw createExecutionError('EXECUTOR_INVALID', 'Step executor must be a function or expose executeStep()');
    }

    const signal = controller.signal;
    if (signal.aborted) {
      throw cancellationError(signal);
    }

    const provider = this.provider;
    const model = item.assignedModel || this.model;
    const toolContext = this._createToolContext(item, step, plan, controller);
    const execution = Promise.resolve().then(() => execute.call(executor, {
      step,
      plan,
      task: item.taskContract,
      context: item.context || { workspace: this.workspace, files: step.files || [] },
      signal,
      itemId: item.id,
      taskId: item.taskId,
      provider,
      model,
      providerConfig: this.providerConfig,
      tools: toolContext ? toolContext.call : null,
      toolSchemas: toolContext ? toolContext.schemas : []
    }));

    let timeout;
    let abortHandler;
    let timedOut = false;
    const timeoutError = createExecutionError(
      'STEP_TIMEOUT',
      `Step '${step.id}' exceeded the ${this.stepTimeoutMs}ms execution timeout`
    );
    const timeoutPromise = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        reject(timeoutError);
        controller.abort(timeoutError);
      }, this.stepTimeoutMs);
    });
    const abortPromise = new Promise((resolve, reject) => {
      abortHandler = () => reject(timedOut ? timeoutError : cancellationError(signal));
      signal.addEventListener('abort', abortHandler, { once: true });
    });

    let result;
    try {
      result = await Promise.race([execution, timeoutPromise, abortPromise]);
    } catch (error) {
      if (timedOut || error.code === 'STEP_TIMEOUT') throw timeoutError;
      if (signal.aborted) throw cancellationError(signal);
      if (error && error.code) {
        error.provider = error.provider || provider;
        error.model = error.model || model;
        throw error;
      }
      const providerError = createExecutionError(
        'PROVIDER_ERROR',
        error && error.message ? error.message : 'Step executor failed'
      );
      providerError.provider = provider;
      providerError.model = model;
      throw providerError;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abortHandler);
    }

    if (result && typeof result === 'object' && result.success === false) {
      const stepError = createExecutionError(
        result.code || 'STEP_EXECUTION_FAILED',
        result.error || `Executor reported failure for step '${step.id}'`
      );
      stepError.provider = result.provider || provider;
      stepError.model = result.model || model;
      throw stepError;
    }
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
        (Object.getPrototypeOf(result) !== Object.prototype && Object.getPrototypeOf(result) !== null) ||
        result.success !== true || String(result.stepId) !== String(step.id) ||
        !Object.prototype.hasOwnProperty.call(result, 'output')) {
      throw createExecutionError(
        'MALFORMED_OUTPUT',
        `Executor returned malformed output for step '${step.id}'`
      );
    }
    try {
      const serializedOutput = JSON.stringify(result.output);
      if (serializedOutput === undefined) throw new Error('Output is not JSON serializable');
    } catch (error) {
      throw createExecutionError(
        'MALFORMED_OUTPUT',
        `Executor output for step '${step.id}' is not serializable`
      );
    }
    return { ...result, stepId: step.id };
  }

  /**
   * Build the bounded, logged tool-call interface handed to the step executor.
   * Only tools the ToolRegistry marks as exposed can be called; unknown tools,
   * invalid arguments, exhausted budgets, and tool failures are all returned as
   * explicit, non-throwing results so the executor cannot mistake them for success.
   * @param {WorkItem} item
   * @param {Object} step
   * @returns {{ call: Function, schemas: Array<Object> }|null}
   */
  _createToolContext(item, step, plan, controller) {
    const registry = this.toolRegistry;
    if (!registry) return null;

    const exposedNames = new Set(registry.listExposedTools().map(tool => tool.name));
    const schemas = registry.listExposedTools();
    if (!item._toolBudgetUsed) {
      item._toolBudgetUsed = { calls: 0, outputBytes: 0 };
    }
    const budget = this.toolBudget;
    const usage = item._toolBudgetUsed;

    const call = async (toolName, args = {}) => {
      const correlation = { itemId: item.id, taskId: item.taskId, stepId: step.id };
      const sanitizedArgs = this._sanitizeToolArgs(args);

      if (controller.signal.aborted || item.status === WorkItemStatus.CANCELLED) {
        const error = cancellationError(controller.signal);
        this._recordToolCall(item, correlation, toolName, sanitizedArgs, {
          success: false, code: error.code, duration: 0, output: null
        });
        return { success: false, code: error.code, error: error.message };
      }

      if (!exposedNames.has(toolName)) {
        this._recordToolCall(item, correlation, toolName, sanitizedArgs, {
          success: false, code: 'UNKNOWN_TOOL', duration: 0, output: null
        });
        return {
          success: false,
          code: 'UNKNOWN_TOOL',
          error: `Tool '${toolName}' is not a registered, exposed agent tool`
        };
      }

      if (usage.calls >= budget.maxCalls) {
        this._recordToolCall(item, correlation, toolName, sanitizedArgs, {
          success: false, code: 'TOOL_BUDGET_EXCEEDED', duration: 0, output: null
        });
        return {
          success: false,
          code: 'TOOL_BUDGET_EXCEEDED',
          error: `Tool-call budget (${budget.maxCalls} calls) exhausted for this task`
        };
      }

      usage.calls += 1;
      let actionArgs;
      try {
        actionArgs = JSON.parse(JSON.stringify(args));
      } catch (error) {
        this._recordToolCall(item, correlation, toolName, sanitizedArgs, {
          success: false, code: 'INVALID_ARGUMENTS', duration: 0, output: null
        });
        return {
          success: false,
          code: 'INVALID_ARGUMENTS',
          error: 'Tool arguments must be JSON-serializable'
        };
      }
      deepFreeze(actionArgs);

      const planDigest = digestPlan(plan);
      const operation = {
        type: toolName,
        digest: digestAction(planDigest, toolName, actionArgs),
        params: {
          ...actionArgs,
          dependencyChange: isDependencyPath(actionArgs.path)
        }
      };
      const permissionCheck = await this.permissionManager.checkPermission(operation, {
        deferApproval: true
      });
      this._recordPermissionDecision(item, operation, permissionCheck);
      if (!permissionCheck.allowed) {
        this._recordToolCall(item, correlation, toolName, sanitizedArgs, {
          success: false,
          code: 'PERMISSION_DENIED',
          duration: 0,
          output: null
        });
        controller.abort(createExecutionError('PERMISSION_DENIED', permissionCheck.reason));
        return {
          success: false,
          code: 'PERMISSION_DENIED',
          error: permissionCheck.reason
        };
      }

      if (permissionCheck.requiresApproval) {
        const actionDigest = operation.digest;
        const approval = await this._requestApproval(item, plan, {
          kind: 'tool',
          tool: toolName,
          planDigest,
          actionDigest,
          operation: { type: operation.type, params: actionArgs }
        }, controller.signal, () =>
          digestAction(planDigest, toolName, args) === actionDigest &&
          digestAction(planDigest, toolName, actionArgs) === actionDigest
            ? actionDigest
            : null);

        if (!approval.approved) {
          const approvalCode = approval.outcome === 'timeout'
            ? 'APPROVAL_TIMEOUT'
            : approval.outcome === 'cancelled' ? 'EXECUTION_CANCELLED'
            : approval.outcome === 'invalidated' ? 'APPROVAL_INVALIDATED' : 'APPROVAL_DENIED';
          this.permissionManager.recordApproval(operation, {
            approved: false,
            planDigest,
            actionDigest,
            outcome: approval.outcome,
            reason: approval.reason,
            risk: permissionCheck.risk
          });
          this._recordToolCall(item, correlation, toolName, sanitizedArgs, {
            success: false,
            code: approvalCode,
            duration: 0,
            output: null
          });
          controller.abort(createExecutionError(
            approvalCode,
            approval.reason
          ));
          return { success: false, code: approvalCode, error: approval.reason };
        }

        if (item.plan !== plan || digestPlan(plan) !== planDigest ||
            digestAction(planDigest, toolName, args) !== actionDigest) {
          const reason = 'Approved action changed before execution; approval is invalid';
          this.permissionManager.recordApproval(operation, {
            approved: false,
            planDigest,
            actionDigest,
            outcome: 'invalidated',
            reason,
            risk: permissionCheck.risk
          });
          controller.abort(createExecutionError('APPROVAL_INVALIDATED', reason));
          return { success: false, code: 'APPROVAL_INVALIDATED', error: reason };
        }

        this.permissionManager.recordApproval(operation, {
          approved: true,
          planDigest,
          actionDigest,
          outcome: 'approved',
          risk: permissionCheck.risk
        });
      }

      if (controller.signal.aborted || item.status === WorkItemStatus.CANCELLED ||
          item.plan !== plan || digestPlan(plan) !== planDigest) {
        const error = controller.signal.aborted
          ? cancellationError(controller.signal)
          : createExecutionError('APPROVAL_INVALIDATED', 'Execution plan changed before tool call');
        this._recordToolCall(item, correlation, toolName, sanitizedArgs, {
          success: false, code: error.code, duration: 0, output: null
        });
        return { success: false, code: error.code, error: error.message };
      }

      const result = await registry.execute(toolName, actionArgs, correlation);

      const { boundedData, truncated } = this._boundToolOutput(result.data, budget, usage);
      this._recordToolCall(item, correlation, toolName, sanitizedArgs, {
        success: result.success,
        code: result.code || null,
        duration: result.duration,
        output: boundedData
      });

      return {
        success: result.success,
        data: boundedData,
        error: result.error,
        code: result.code || null,
        duration: result.duration,
        truncated
      };
    };

    return { call, schemas };
  }

  _recordToolCall(item, correlation, tool, args, outcome) {
    const entry = {
      tool,
      args,
      itemId: correlation.itemId,
      taskId: correlation.taskId,
      stepId: correlation.stepId,
      success: outcome.success,
      code: outcome.code,
      duration: outcome.duration,
      output: outcome.output,
      timestamp: new Date().toISOString()
    };
    if (typeof item.recordToolCall === 'function') {
      item.recordToolCall(entry);
    }
    this._progress({ type: 'tool-call', item: item.getSummary(), toolCall: entry });
  }

  _sanitizeToolArgs(args) {
    const sanitized = { ...args };
    for (const key of ['content', 'newContent']) {
      if (typeof sanitized[key] === 'string' && sanitized[key].length > 200) {
        sanitized[key] = `${sanitized[key].slice(0, 200)}...`;
      }
    }
    return sanitized;
  }

  _boundToolOutput(data, budget, usage) {
    if (data === null || data === undefined) return { boundedData: data, truncated: false };
    let serialized;
    try {
      serialized = JSON.stringify(data);
    } catch (error) {
      return { boundedData: '[unserializable tool output]', truncated: true };
    }

    const remaining = budget.maxOutputBytes - usage.outputBytes;
    if (remaining <= 0) {
      return {
        boundedData: { truncated: true, reason: 'Per-task tool output budget exhausted' },
        truncated: true
      };
    }
    if (serialized.length <= remaining) {
      usage.outputBytes += serialized.length;
      return { boundedData: data, truncated: false };
    }

    usage.outputBytes += remaining;
    return {
      boundedData: { truncated: true, preview: serialized.slice(0, remaining) },
      truncated: true
    };
  }

  async _verifyWork(item, plan) {
    // Stub: Run expected checks
    const results = {
      passed: true,
      checks: {}
    };

    for (const check of plan.expectedChecks) {
      // Stub verification
      results.checks[check.type] = {
        passed: true,
        required: check.required
      };
    }

    return results;
  }

  _recordPermissionDecision(item, operation, decision) {
    const audit = {
      type: 'permission-decision',
      timestamp: new Date().toISOString(),
      operation: operation.type,
      digest: operation.digest || null,
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      risk: decision.risk,
      reason: decision.reason || null
    };
    item.events.push(audit);
    this._progress({ type: 'permission-decision', item: item.getSummary(), decision: audit });
  }

  async _requestApproval(item, plan, details, signal, currentDigest) {
    const expectedPlanDigest = details.planDigest;
    const expectedActionDigest = details.actionDigest;
    const expectedDigest = expectedActionDigest || expectedPlanDigest;
    if (signal.aborted) {
      return {
        approved: false,
        outcome: 'cancelled',
        reason: cancellationError(signal).message
      };
    }
    if (typeof this.onApprovalRequired !== 'function') {
      return { approved: false, outcome: 'denied', reason: 'No approval handler is configured' };
    }

    const pendingApproval = Promise.resolve().then(() =>
      this.onApprovalRequired(item, plan, details));
    let timeout;
    let abortHandler;
    const timeoutPromise = new Promise(resolve => {
      timeout = setTimeout(() => resolve({
        approved: false,
        outcome: 'timeout',
        reason: `Approval timed out after ${this.approvalTimeoutMs}ms`
      }), this.approvalTimeoutMs);
    });
    const abortPromise = new Promise(resolve => {
      abortHandler = () => resolve({
        approved: false,
        outcome: 'cancelled',
        reason: cancellationError(signal).message
      });
      signal.addEventListener('abort', abortHandler, { once: true });
    });

    try {
      let response;
      try {
        response = await Promise.race([pendingApproval, timeoutPromise, abortPromise]);
      } catch (error) {
        if (signal.aborted) {
          return {
            approved: false,
            outcome: 'cancelled',
            reason: cancellationError(signal).message
          };
        }
        return {
          approved: false,
          outcome: 'error',
          reason: `Approval request failed: ${error.message}`
        };
      }
      if (response && typeof response === 'object' &&
          ((response.planDigest && response.planDigest !== expectedPlanDigest) ||
           (response.actionDigest && response.actionDigest !== expectedActionDigest))) {
        return {
          approved: false,
          outcome: 'invalidated',
          reason: 'Approval response is bound to a different plan or action digest'
        };
      }
      if (response && response.outcome === 'timeout') return response;
      if (response && response.outcome === 'cancelled') return response;
      const approved = response === true || Boolean(response && response.approved === true);
      if (approved && currentDigest() !== expectedDigest) {
        return {
          approved: false,
          outcome: 'invalidated',
          reason: 'Approved plan or action changed while awaiting approval'
        };
      }
      return {
        approved,
        outcome: approved ? 'approved' : 'denied',
        reason: approved ? null : 'Approval denied'
      };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abortHandler);
    }
  }

  _getReadyItems() {
    const ready = [];
    
    for (const itemId of this.workQueue) {
      const item = this.workItems.get(itemId);
      if (!item) continue;
      if (item.status === WorkItemStatus.PAUSED) continue;
      
      const readiness = item.checkReadiness(this.workItems);
      if (readiness.ready) {
        ready.push(item);
      } else {
        item.updateStatus(WorkItemStatus.BLOCKED, { blockedBy: readiness.blockedBy });
      }
    }

    // Sort by priority
    ready.sort((a, b) => {
      const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
    });

    return ready;
  }

  async _waitWhilePaused(item) {
    while (item.status === WorkItemStatus.PAUSED) {
      await new Promise(resolve => setTimeout(resolve, this.pausePollMs));
    }
  }

  async _waitForActiveWork() {
    if (this.activeWork.size === 0) return;
    
    // Wait for at least one work item to complete
    await Promise.race(Array.from(this.activeWork.values()));
  }

  _groupByStatus() {
    const grouped = {};
    for (const item of this.workItems.values()) {
      grouped[item.status] = (grouped[item.status] || 0) + 1;
    }
    return grouped;
  }

  _progress(event) {
    if (typeof this.onProgress === 'function') {
      try {
        this.onProgress(event);
      } catch (err) {
        // Ignore progress callback errors
      }
    }
  }
}

function createExecutionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cancellationError(signal) {
  const reason = signal.reason;
  if (reason && reason.code === 'STEP_TIMEOUT') return reason;
  return createExecutionError(
    'EXECUTION_CANCELLED',
    reason && reason.message ? reason.message : 'Execution was cancelled'
  );
}

function prepareExecutablePlan(plan) {
  let serialized;
  try {
    serialized = JSON.stringify(plan);
  } catch (error) {
    throw new Error(`Plan must be JSON-serializable: ${error.message}`);
  }
  if (!serialized) throw new Error('Planner returned no serializable plan');
  const executablePlan = JSON.parse(serialized);
  if (executablePlan.planVersion === undefined) executablePlan.planVersion = 1;
  if (executablePlan.planVersion !== 1) throw new Error('Unsupported plan version');
  return deepFreeze(executablePlan);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function digestPlan(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

function digestAction(planDigest, toolName, args) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ planDigest, toolName, args }))
    .digest('hex');
}

function isDependencyPath(filePath) {
  if (typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const filename = normalized.slice(normalized.lastIndexOf('/') + 1);
  return filename === 'package.json' ||
    filename === 'package-lock.json' ||
    filename === 'npm-shrinkwrap.json' ||
    filename === 'yarn.lock' ||
    filename === 'pnpm-lock.yaml' ||
    filename === 'cargo.toml' ||
    filename === 'cargo.lock' ||
    filename === 'go.mod' ||
    filename === 'go.sum' ||
    filename === 'pom.xml' ||
    filename === 'build.gradle' ||
    filename === 'build.gradle.kts' ||
    filename === 'composer.json' ||
    filename === 'composer.lock' ||
    filename === 'pipfile' ||
    filename === 'pipfile.lock' ||
    filename === 'pyproject.toml' ||
    /^requirements(?:[-_.].*)?\.txt$/.test(filename) ||
    filename === 'poetry.lock';
}

module.exports = {
  WorkOrchestrator
};

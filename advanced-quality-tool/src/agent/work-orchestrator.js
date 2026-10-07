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
const fs = require('fs');
const path = require('path');
const { WorkItem, WorkItemStatus } = require('./work-item');
const { AgentPlanner } = require('./planner');
const { PipelineExecutor } = require('../pipelines/pipeline-executor');
const { ConfiguredCheckRunner } = require('./check-runner');
const { ToolRegistry } = require('./tool-registry');
const { WorkspaceContext } = require('./workspace-context');
const { PermissionManager } = require('./permissions');
const { DiffReviewSystem, hashContent } = require('./diff-review-system');
const { CONTRACT_VERSION, validatePatch } = require('./contracts');
const { AgentRunStore } = require('./run-store');
const { BudgetManager, BudgetEnforcement } = require('./privacy-cost-controls');

const DEFAULT_TOOL_BUDGET = Object.freeze({
  maxCalls: 25,
  maxOutputBytes: 200 * 1024 // 200KB
});

/**
 * Work Orchestrator
 */
class WorkOrchestrator {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.planner = options.planner || new AgentPlanner({ workspace: this.workspace });
    this.pipelineExecutor = options.pipelineExecutor || new PipelineExecutor();
    this.stepExecutor = options.stepExecutor || options.executor || null;
    this.checkRunner = options.checkRunner || new ConfiguredCheckRunner({
      workspace: this.workspace,
      ...(options.checkRunnerOptions || {}),
      checks: options.checks || options.checkRunnerOptions?.checks || {}
    });
    this.diffReviewSystem = options.diffReviewSystem || new DiffReviewSystem({
      workspace: this.workspace,
      backupDir: path.join(this.workspace, '.aqt-backups')
    });
    this.maxFiles = options.maxFiles || 50;
    this.provider = options.provider || null;
    this.model = options.model || null;
    this.providerConfig = options.providerConfig || null;
    this.stepTimeoutMs = options.stepTimeoutMs ?? options.executorTimeoutMs ?? 120000;
    if (!Number.isFinite(this.stepTimeoutMs) || this.stepTimeoutMs <= 0) {
      throw new Error('stepTimeoutMs must be a positive finite number');
    }
    this.maxRepairElapsedMs = options.maxRepairElapsedMs ?? 10 * 60 * 1000;
    if (!Number.isFinite(this.maxRepairElapsedMs) || this.maxRepairElapsedMs <= 0) {
      throw new Error('maxRepairElapsedMs must be a positive finite number');
    }
    this.maxRepairTokens = options.maxRepairTokens ?? 100000;
    this.maxRepairCost = options.maxRepairCost ?? 1;
    this.maxRepairOutputTokens = options.maxRepairOutputTokens ?? 12000;
    if (!Number.isSafeInteger(this.maxRepairTokens) || this.maxRepairTokens <= 0 ||
        !Number.isFinite(this.maxRepairCost) || this.maxRepairCost <= 0 ||
        !Number.isSafeInteger(this.maxRepairOutputTokens) || this.maxRepairOutputTokens <= 0) {
      throw new Error('Repair token, output token, and cost limits must be positive');
    }
    this.budgetManager = options.budgetManager || new BudgetManager({
      perRunLimit: this.maxRepairCost,
      enforcementMode: BudgetEnforcement.BLOCK
    });
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
    this.runStore = options.runStore === false
      ? null
      : options.runStore || new AgentRunStore({
        workspace: this.workspace,
        permissionManager: this.permissionManager
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

    this._persistRun(item);
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
    this.workQueue = this.workQueue.filter(id => id !== itemId);
    do {
      await this._executeWorkItem(item, results);
      while (this.activeWork.has(itemId)) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (item.status === WorkItemStatus.QUEUED) {
        this.workQueue = this.workQueue.filter(id => id !== itemId);
      }
    } while (item.status === WorkItemStatus.QUEUED);

    return results.items[results.items.length - 1] || {
      itemId,
      status: item.status,
      error: item.error || null,
      verification: item.verificationResults
    };
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

  resumeFromCheckpoint(itemId) {
    if (!this.runStore) throw new Error('Run persistence is disabled for this orchestrator');
    if (this.workItems.has(itemId)) throw new Error(`Work item '${itemId}' is already loaded`);
    const checkpoint = this.runStore.validateResume(itemId);
    if (checkpoint.status !== 'loaded') {
      throw new Error(`Cannot resume checkpoint '${itemId}': ${checkpoint.reason || checkpoint.status}`);
    }
    if (!checkpoint.resumable) {
      throw new Error(`Cannot resume terminal work item '${itemId}'`);
    }

    const item = WorkItem.fromJSON(checkpoint.item);
    this.workItems.set(item.id, item);
    this.workQueue.push(item.id);
    this._persistRun(item);
    this._progress({ type: 'checkpoint-resumed', item: item.getSummary() });
    return item;
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
        this._persistRun(item);

        if (this.workspaceContext) {
          const suppliedContext = item.context && typeof item.context === 'object' ? item.context : {};
          const requestedFiles = Array.isArray(suppliedContext.files) && suppliedContext.files.length
            ? suppliedContext.files
            : item.files;
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
          acceptanceCriteria: item.taskContract?.acceptanceCriteria || item.acceptanceCriteria || [],
          context: {
            workspace: this.workspace,
            files: (item.context?.files || []).map(file =>
              typeof file === 'string' ? file : file.path),
            gatheredContext: item.context || {},
            scopeFiles: item.taskContract?.files || item.files || []
          }
        });
        if (controller.signal.aborted) throw cancellationError(controller.signal);

        const executablePlan = prepareExecutablePlan(plan);
        item.setPlan(executablePlan);
        this._persistRun(item);
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
          this._persistRun(item);
        }
        if (controller.signal.aborted) throw cancellationError(controller.signal);

        // 4. Execute work
        item.updateStatus(WorkItemStatus.WORKING);
        item._currentAttemptChanges = [];
        this._progress({ type: 'work-executing', item: item.getSummary() });

        const output = await this._executeSteps(item, executablePlan, controller);
        output.toolChanges = item._currentAttemptChanges;
        if (output.patches.length) {
          output.appliedPatches = await this._applyPatches(item, executablePlan, output.patches, controller.signal);
        }
        item.setOutput(output);
        this._persistRun(item);

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
        const previousVerification = item.verificationResults;
        const verificationResults = await this._verifyWork(item, executablePlan, controller.signal);
        output.verifiedChangedFiles = verificationResults.verifiedChangedFiles;
        item.setOutput(output);
        item.setVerificationResults(verificationResults);
        this._persistRun(item);
        if (controller.signal.aborted) throw cancellationError(controller.signal);

        if (!verificationResults.passed) {
          if (hasVerificationRegression(previousVerification, verificationResults)) {
            throw new Error('Verification repair caused a regression in a previously passing required check');
          }
          const unavailableRequiredCheck = Object.values(verificationResults.checks || {})
            .some(check => check.required && check.status === 'unavailable');
          if (unavailableRequiredCheck) {
            throw new Error('Verification failed: required check is unavailable');
          }
          if (verificationResults.checks?.patch_application) {
            throw new Error(verificationResults.checks.patch_application.error || 'Patch application was not verified');
          }
          // Retry if available
          const now = Date.now();
          item._repairStartedAt = item._repairStartedAt || now;
          const repairTimeRemaining = this.maxRepairElapsedMs - (now - item._repairStartedAt);
          if (repairTimeRemaining > 0 && item.incrementRetry()) {
            item.context = {
              ...(item.context || {}),
              repairDiagnostics: buildRepairDiagnostics(verificationResults)
            };
            item.events.push({
              type: 'repair-feedback',
              timestamp: new Date().toISOString(),
              attempt: item.retryCount,
              checkIds: Object.keys(item.context.repairDiagnostics)
            });
            this._persistRun(item);
            this._progress({ type: 'work-retry', item: item.getSummary() });
            this.workQueue.push(item.id);
            item.updateStatus(WorkItemStatus.QUEUED, { reason: 'Verification failed, retrying' });
            return;
          } else {
            const reason = repairTimeRemaining <= 0
              ? `Verification repair time limit (${this.maxRepairElapsedMs}ms) exhausted`
              : `Verification failed after ${item.retryCount} attempts`;
            throw new Error(reason);
          }
        }

        // 6. Complete
        item.updateStatus(WorkItemStatus.COMPLETED);
        this._persistRun(item);
        results.completed++;
        results.items.push({
          itemId: item.id,
          status: 'completed',
          output,
          verification: verificationResults,
          contextProvenance: this._contextProvenance(item)
        });
        this._progress({ type: 'work-complete', item: item.getSummary() });

      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (item.status === WorkItemStatus.CANCELLED || failure.code === 'EXECUTION_CANCELLED') {
          if (item.status !== WorkItemStatus.CANCELLED) {
            item.updateStatus(WorkItemStatus.CANCELLED, { reason: failure.message });
          }
          this._persistRun(item);
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
        if (failure.denied) {
          item.updateStatus(WorkItemStatus.DENIED, { error: failure.message });
          this._persistRun(item);
          results.denied = (results.denied || 0) + 1;
          results.items.push({ itemId: item.id, status: 'denied', error: failure.message, code: failure.code || 'DENIED' });
          this._progress({ type: 'work-denied', item: item.getSummary(), error: failure.message });
          return;
        }
        item.setError(failure);
        item.updateStatus(WorkItemStatus.FAILED, { error: failure.message });
        this._persistRun(item);
        results.failed++;
        results.items.push({
          itemId: item.id,
          status: 'failed',
          error: failure.message,
          code: failure.code || 'EXECUTION_ERROR',
          verification: item.verificationResults,
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

  _persistRun(item) {
    if (!this.runStore) return;
    const workspaceHashes = {};
    for (const entry of item.context?.files || []) {
      const relativePath = typeof entry === 'string' ? entry : entry.path;
      if (typeof relativePath !== 'string') continue;
      const absolutePath = path.resolve(this.workspace, relativePath);
      const relative = path.relative(this.workspace, absolutePath);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        continue;
      }
      try {
        if (fs.statSync(absolutePath).isFile()) {
          workspaceHashes[relative.split(path.sep).join('/')] =
            crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    this.runStore.save(item, {
      contractVersion: CONTRACT_VERSION,
      planDigest: item.plan ? digestPlan(item.plan) : null,
      patchDigest: item.output?.appliedPatches?.length
        ? crypto.createHash('sha256').update(JSON.stringify(item.output.appliedPatches)).digest('hex')
        : null,
      workspaceHashes
    });
  }

  async _executeSteps(item, plan, controller) {
    const output = { completedSteps: [], results: {}, patches: [], toolChanges: [] };

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
      output.results[step.id] = stepResult.output;
      if (Array.isArray(stepResult.patches)) output.patches.push(...stepResult.patches);

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
        : 'No agent executor is configured');
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
    const executorInput = {
      step,
      plan,
      task: item.taskContract || {
        schemaVersion: CONTRACT_VERSION,
        id: item.taskId || item.id,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
        files: item.files
      },
      context: item.context || { workspace: this.workspace, files: step.files || [] },
      signal,
      itemId: item.id,
      taskId: item.taskId,
      provider,
      model,
      providerConfig: this.providerConfig,
      tools: toolContext ? toolContext.call : null,
      toolSchemas: toolContext ? toolContext.schemas : [],
      limits: {
        maxRepairTokens: this.maxRepairTokens,
        maxOutputTokens: this.maxRepairOutputTokens,
        maxRepairCost: this.maxRepairCost
      }
    };
    let repairReservation = null;
    if (item.retryCount > 0) {
      const inputBytes = Buffer.byteLength(JSON.stringify({
        task: executorInput.task,
        plan: executorInput.plan,
        step: executorInput.step,
        context: executorInput.context
      }), 'utf8');
      const estimatedInputTokens = Math.max(1, Math.ceil(inputBytes / 4));
      if (item.repairTokensUsed + estimatedInputTokens > this.maxRepairTokens) {
        throw createExecutionError('REPAIR_TOKEN_LIMIT', 'Verification repair token budget exhausted');
      }
      const rateLimit = this.budgetManager.checkRateLimit();
      if (!rateLimit.allowed) {
        throw createExecutionError('REPAIR_RATE_LIMIT', rateLimit.reason);
      }
      const providerName = provider || 'unknown';
      const modelName = model || 'unknown';
      const budgetCheck = this.budgetManager.checkBudget(
        providerName,
        modelName,
        Math.max(estimatedInputTokens, this.maxRepairOutputTokens)
      );
      const estimatedCost = this.budgetManager.calculator.calculateCost(
        providerName,
        modelName,
        estimatedInputTokens,
        this.maxRepairOutputTokens
      );
      if (!budgetCheck.allowed || item.repairCostUsed + estimatedCost > this.maxRepairCost) {
        throw createExecutionError('REPAIR_COST_LIMIT', budgetCheck.reason || 'Verification repair cost budget exhausted');
      }
      item.repairTokensUsed += estimatedInputTokens;
      item.repairCostUsed += estimatedCost;
      repairReservation = { providerName, modelName, estimatedInputTokens, estimatedCost };
      executorInput.repairBudget = {
        tokensRemaining: this.maxRepairTokens - item.repairTokensUsed,
        costRemaining: Math.max(0, this.maxRepairCost - item.repairCostUsed),
        maxOutputTokens: this.maxRepairOutputTokens
      };
      this._persistRun(item);
    }
    const execution = Promise.resolve().then(() => execute.call(executor, executorInput));

    let timeout;
    let abortHandler;
    let timedOut = false;
    const timeoutError = createExecutionError(
      'STEP_TIMEOUT',
      `Agent executor timed out after ${this.stepTimeoutMs}ms`
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

    if (repairReservation) {
      const usage = result && result.usage;
      if (!usage || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 ||
          !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) {
        throw createExecutionError(
          'REPAIR_USAGE_MISSING',
          'Repair executor must report inputTokens and outputTokens usage'
        );
      }
      const actualCost = Number.isFinite(usage.cost) && usage.cost >= 0
        ? usage.cost
        : this.budgetManager.calculator.calculateCost(
          repairReservation.providerName,
          repairReservation.modelName,
          usage.inputTokens,
          usage.outputTokens
        );
      const actualTokens = usage.inputTokens + usage.outputTokens;
      const adjustedTokens = item.repairTokensUsed - repairReservation.estimatedInputTokens + actualTokens;
      if (adjustedTokens > this.maxRepairTokens) {
        throw createExecutionError('REPAIR_TOKEN_LIMIT', 'Verification repair token budget exhausted');
      }
      const adjustedCost = item.repairCostUsed - repairReservation.estimatedCost + actualCost;
      if (adjustedCost > this.maxRepairCost) {
        throw createExecutionError('REPAIR_COST_LIMIT', 'Verification repair cost budget exhausted');
      }
      item.repairCostUsed = adjustedCost;
      item.repairTokensUsed = adjustedTokens;
      this.budgetManager.recordUsage({
        provider: repairReservation.providerName,
        model: repairReservation.modelName,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost: actualCost,
        requestType: 'verification-repair',
        success: result.success === true
      });
      this._persistRun(item);
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
        (!Object.prototype.hasOwnProperty.call(result, 'output') && !Array.isArray(result.patches))) {
      throw createExecutionError('MALFORMED_OUTPUT', `Executor returned malformed output for step '${step.id}'`);
    }
    if (result.patches !== undefined) {
      if (!Array.isArray(result.patches) || result.patches.length === 0) {
        throw createExecutionError('MALFORMED_PATCH', 'Invalid patch: executor must return a non-empty patch array');
      }
      for (const patch of result.patches) {
        const validation = validatePatch(patch);
        if (!validation.valid) {
          throw createExecutionError('MALFORMED_PATCH', `Invalid patch: ${validation.issues.join(', ')}`);
        }
      }
    }
    const output = Object.prototype.hasOwnProperty.call(result, 'output')
      ? result.output
      : { patchCount: result.patches.length };
    try {
      const serializedOutput = JSON.stringify(output);
      if (serializedOutput === undefined) throw new Error('Output is not JSON serializable');
    } catch (error) {
      throw createExecutionError(
        'MALFORMED_OUTPUT',
        `Executor output for step '${step.id}' is not serializable`
      );
    }
    return { ...result, output, stepId: step.id };
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
  async _applyPatches(item, plan, patches, signal) {
    if (!Array.isArray(patches) || !patches.length) return [];
    if (patches.length > this.maxFiles) throw new Error(`Patch file limit exceeded (${patches.length} > ${this.maxFiles})`);
    const planDigest = digestPlan(plan);
    const patchDigest = crypto.createHash('sha256')
      .update(JSON.stringify({ planDigest, patches }))
      .digest('hex');
    const contextFiles = new Map((item.context?.files || []).map(file => [file.path, file]));
    const review = new DiffReviewSystem({ workspace: this.workspace, maxChangedFiles: this.maxFiles });
    const operations = [];
    const seen = new Set();

    for (const patch of patches) {
      const validation = validatePatch(patch);
      if (!validation.valid) throw new Error(`Invalid patch: ${validation.issues.join(', ')}`);
      const relativePath = patch.path.replace(/\\/g, '/');
      if (seen.has(relativePath)) throw new Error(`Invalid patch: duplicate operation for ${relativePath}`);
      seen.add(relativePath);
      if (!(plan.affectedFiles || []).includes(relativePath)) {
        throw new Error(`Invalid patch: path is outside the approved plan: ${relativePath}`);
      }
      const type = patch.operation;
      const operation = {
        type: type === 'delete' ? 'delete_file' : 'edit_file',
        digest: digestAction(planDigest, type, patch),
        params: { path: relativePath, dependencyChange: isDependencyPath(relativePath), workId: item.id }
      };
      const permission = await this.permissionManager.checkPermission(operation, { deferApproval: true });
      this._recordPermissionDecision(item, operation, permission);
      if (!permission.allowed) {
        throw Object.assign(new Error(`Permission denied: ${permission.reason}`), { code: 'PERMISSION_DENIED', denied: true });
      }
      const originalFile = contextFiles.get(relativePath);
      const originalContent = type === 'create' ? null : originalFile?.content;
      if (type !== 'create' && typeof originalContent !== 'string') {
        throw new Error(`Invalid patch: source file was not present in bounded context: ${relativePath}`);
      }
      if (type !== 'create' && hashContent(originalContent) !== patch.expectedHash) {
        throw new Error(`Invalid patch: expected hash does not match gathered source for ${relativePath}`);
      }
      const absolutePath = path.resolve(this.workspace, relativePath);
      if (type !== 'create') {
        if (!fs.existsSync(absolutePath) || hashContent(fs.readFileSync(absolutePath, 'utf8')) !== patch.expectedHash) {
          throw Object.assign(new Error(`Stale source detected for ${relativePath}`), { code: 'PATCH_CONFLICT' });
        }
      } else if (fs.existsSync(absolutePath)) {
        throw Object.assign(new Error(`Stale source detected: create target already exists for ${relativePath}`), { code: 'PATCH_CONFLICT' });
      }
      const diff = review.addPatch({
        type,
        filePath: relativePath,
        originalContent,
        modifiedContent: type === 'delete' ? '' : patch.content,
        expectedHash: patch.expectedHash
      }, { planDigest, patchDigest });
      operations.push({ operation, diff, relativePath });
    }
    const changedPathBudget = new Set([
      ...item.changedFiles,
      ...operations.map(operation => operation.relativePath)
    ]);
    if (changedPathBudget.size > this.maxFiles) {
      throw new Error(`Cumulative changed-file limit exceeded (${changedPathBudget.size} > ${this.maxFiles})`);
    }

    const currentDigest = () => crypto.createHash('sha256')
      .update(JSON.stringify({ planDigest: digestPlan(item.plan), patches }))
      .digest('hex');
    const approval = await this._requestApproval(item, plan, {
      kind: 'patch', planDigest, actionDigest: patchDigest, patchDigest,
      diffs: operations.map(({ diff, relativePath }) => ({ filePath: relativePath, unifiedDiff: diff.toUnifiedDiff() }))
    }, signal, currentDigest);
    if (!approval.approved) {
      for (const { operation } of operations) this.permissionManager.recordApproval(operation, {
        approved: false, planDigest, patchDigest, outcome: approval.outcome || 'denied', reason: approval.reason
      });
      throw Object.assign(new Error(approval.reason || 'Patch approval denied'), { code: 'PATCH_DENIED', denied: true });
    }

    const applied = [];
    for (let index = 0; index < operations.length; index++) {
      const { operation, diff, relativePath } = operations[index];
      const result = await review.applyDiff(index, { approval: { approved: true, planDigest, patchDigest } });
      if (!result.success) throw Object.assign(new Error(`Patch apply failed for ${relativePath}: ${result.error}`), { code: result.code });
      const targetPath = path.resolve(this.workspace, relativePath);
      const isPresentAsRequested = diff.type === 'delete'
        ? !fs.existsSync(targetPath)
        : fs.existsSync(targetPath) &&
          hashContent(fs.readFileSync(targetPath, 'utf8')) === hashContent(diff.modifiedContent);
      if (!isPresentAsRequested) {
        throw Object.assign(new Error(`Patch application could not be verified for ${relativePath}`), {
          code: 'PATCH_APPLY_UNVERIFIED'
        });
      }
      this.permissionManager.recordApproval(operation, { approved: true, planDigest, patchDigest, outcome: 'approved' });
      if (!item.changedFiles.includes(relativePath)) item.changedFiles.push(relativePath);
      applied.push({ path: relativePath, type: diff.type, unifiedDiff: diff.toUnifiedDiff() });
    }
    return applied;
  }

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

      if (toolName === 'edit_file' && typeof actionArgs.path === 'string') {
        const relativePath = actionArgs.path.replace(/\\/g, '/');
        if (!item.changedFiles.includes(relativePath) && item.changedFiles.length >= this.maxFiles) {
          this._recordToolCall(item, correlation, toolName, sanitizedArgs, {
            success: false, code: 'TOOL_FILE_BUDGET_EXCEEDED', duration: 0, output: null
          });
          return {
            success: false,
            code: 'TOOL_FILE_BUDGET_EXCEEDED',
            error: `Cumulative changed-file limit (${this.maxFiles}) exhausted`
          };
        }
      }

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
      if (result.success && toolName === 'edit_file') {
        const absolutePath = path.resolve(this.workspace, actionArgs.path);
        const relativePath = path.relative(this.workspace, absolutePath);
        const verifiedWrite = relativePath !== '..' &&
          !relativePath.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relativePath) &&
          fs.existsSync(absolutePath) &&
          hashContent(fs.readFileSync(absolutePath, 'utf8')) === result.data?.newHash &&
          result.data?.newHash === hashContent(actionArgs.content);
        if (!verifiedWrite) {
          const failure = {
            success: false,
            code: 'WRITE_NOT_VERIFIED',
            error: `The edit tool did not leave the requested content in ${actionArgs.path}`,
            duration: result.duration
          };
          this._recordToolCall(item, correlation, toolName, sanitizedArgs, {
            success: false, code: failure.code, duration: result.duration, output: null
          });
          return failure;
        }
        const normalizedPath = relativePath.split(path.sep).join('/');
        if (!item.changedFiles.includes(normalizedPath)) item.changedFiles.push(normalizedPath);
        item._currentAttemptChanges.push({
          path: normalizedPath,
          type: 'modify',
          expectedHash: result.data.newHash
        });
      }

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
    this._persistRun(item);
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

  async _verifyWork(item, plan, signal) {
    const results = {
      schemaVersion: CONTRACT_VERSION,
      passed: true,
      checks: {},
      requiredPassed: true,
      verifiedChangedFiles: []
    };
    const appliedPatches = item.output?.appliedPatches || [];
    const toolChanges = item.output?.toolChanges || [];
    const workspaceChanges = [...appliedPatches, ...toolChanges];
    if (workspaceChanges.length === 0) {
      results.checks.patch_application = {
        status: 'failed',
        required: true,
        error: 'No workspace patch was applied'
      };
      results.passed = false;
      results.requiredPassed = false;
      return results;
    }
    for (const patch of workspaceChanges) {
      const targetPath = path.resolve(this.workspace, patch.path);
      const relative = path.relative(this.workspace, targetPath);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        results.passed = false;
        results.requiredPassed = false;
        results.checks.patch_application = {
          status: 'failed',
          required: true,
          error: `Applied patch path escaped the workspace: ${patch.path}`
        };
        return results;
      }
      const contentMatches = typeof patch.expectedHash === 'string' &&
        fs.existsSync(targetPath) &&
        hashContent(fs.readFileSync(targetPath, 'utf8')) === patch.expectedHash;
      if (patch.type === 'delete' ? !fs.existsSync(targetPath) : contentMatches ||
          (typeof patch.expectedHash !== 'string' && fs.existsSync(targetPath))) {
        results.verifiedChangedFiles.push(patch.path);
      } else {
        results.passed = false;
        results.requiredPassed = false;
        results.checks.patch_application = {
          status: 'failed',
          required: true,
          error: `Workspace does not contain the requested patch state for ${patch.path}`
        };
      }
    }
    if (results.verifiedChangedFiles.length !== workspaceChanges.length) {
      return results;
    }

    const checks = Array.isArray(plan.expectedChecks) ? plan.expectedChecks : [];
    if (checks.length === 0 || !checks.some(check => check.required !== false)) {
      results.checks.verification = {
        status: 'unavailable',
        required: true,
        error: checks.length === 0
          ? 'The approved plan contains no configured verification checks'
          : 'The approved plan contains no required verification check'
      };
      results.passed = false;
      results.requiredPassed = false;
      return results;
    }
    for (const check of checks) {
      const id = check.checkId || check.type;
      const required = check.required !== false;
      let result;
      try {
        result = await this.checkRunner.run(id, {
          item,
          plan,
          workspace: this.workspace,
          required,
          signal
        });
      } catch (error) {
        result = {
          id,
          status: 'errored',
          required,
          error: error.message
        };
      }
      result = result || {
        id,
        status: 'unavailable',
        required,
        error: 'Verification runner returned no result'
      };
      const normalized = ['passed', 'failed', 'skipped', 'unavailable', 'errored', 'timed-out']
        .includes(result.status)
        ? result.status
        : 'errored';
      results.checks[id] = {
        ...result,
        status: normalized,
        required
      };
      if (required && normalized !== 'passed') {
        results.passed = false;
        results.requiredPassed = false;
      }
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
    this._persistRun(item);
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

function buildRepairDiagnostics(verification) {
  const diagnostics = {};
  const maxChecks = 8;
  const maxOutputChars = 4000;
  for (const [checkId, check] of Object.entries(verification.checks || {}).slice(0, maxChecks)) {
    if (!check.required || check.status === 'passed') continue;
    diagnostics[checkId] = {
      status: check.status,
      exitCode: Number.isInteger(check.exitCode) ? check.exitCode : null,
      error: typeof check.error === 'string' ? check.error.slice(0, 1000) : null,
      output: typeof check.output === 'string' ? check.output.slice(0, maxOutputChars) : null
    };
  }
  return diagnostics;
}

function hasVerificationRegression(previous, current) {
  if (!previous || !previous.checks || !current || !current.checks) return false;
  return Object.entries(previous.checks).some(([checkId, result]) =>
    result.required === true &&
    result.status === 'passed' &&
    current.checks[checkId]?.status !== 'passed'
  );
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

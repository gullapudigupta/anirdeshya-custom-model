/**
 * Work Orchestrator (P9-T010)
 *
 * Coordinates agent work execution with dependency tracking, concurrency control,
 * retries, and cancellation support. Ensures work is executed in dependency order
 * and tracks all state transitions.
 *
 * @module agent/work-orchestrator
 */

'use strict';

const { WorkItem, WorkItemStatus } = require('./work-item');
const { AgentPlanner } = require('./planner');
const { PipelineExecutor } = require('../pipelines/pipeline-executor');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PermissionManager, ApprovalMode } = require('./permissions');
const { WorkspaceContext } = require('./workspace-context');
const { DiffReviewSystem } = require('./diff-review-system');
const { ConfiguredCheckRunner } = require('./check-runner');
const {
  CONTRACT_VERSION,
  validateTaskContract,
  validatePlan,
  validatePatch,
  validateApproval,
  validateCompletion,
  WorkResultStatus
} = require('./contracts');
const { AgentRunStore } = require('./run-store');

/**
 * Work Orchestrator
 */
class WorkOrchestrator {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.workItems = new Map();
    this.workQueue = [];
    this.planner = options.planner || new AgentPlanner({ workspace: this.workspace });
    this.pipelineExecutor = options.pipelineExecutor || new PipelineExecutor();
    this.executor = options.executor || options.stepExecutor || null;
    this.workspaceContext = options.workspaceContext || new WorkspaceContext({
      workspace: this.workspace,
      ...(options.contextLimits || {})
    });
    this.toolRegistry = options.toolRegistry || null;
    this.checkRunner = options.checkRunner || new ConfiguredCheckRunner({
      workspace: this.workspace,
      checks: options.checks || {},
      ...(options.checkLimits || {})
    });
    this.diffReviewSystem = options.diffReviewSystem || new DiffReviewSystem({
      workspace: this.workspace,
      backupDir: path.join(this.workspace, '.aqt-backups')
    });
    this.permissionManager = options.permissionManager || new PermissionManager({
      workspace: this.workspace,
      mode: options.permissionMode || ApprovalMode.APPROVAL_REQUIRED,
      allowDeletes: options.allowDeletes === true,
      allowFileWrites: options.allowFileWrites !== false,
      protectedPaths: options.protectedPaths,
      requestApproval: async request => {
        const item = this.workItems.get(request.operation?.params?.workId);
        if (!item) return false;
        return this._requestApproval(item, item.plan, request.operation.params.approvalDetails);
      }
    });
    this.runStore = options.runStore === false ? null : (options.runStore || new AgentRunStore({
      workspace: this.workspace,
      storageDir: options.persistenceDir,
      permissionManager: this.permissionManager
    }));
    this.maxSteps = options.maxSteps || 20;
    this.maxFiles = options.maxFiles || 50;
    this.maxPatchBytes = options.maxPatchBytes || 1024 * 1024;
    this.approvalTimeoutMs = options.approvalTimeoutMs || 5 * 60 * 1000;
    this.executorTimeoutMs = options.executorTimeoutMs || 2 * 60 * 1000;
    this.abortControllers = new Map();
    
    // Concurrency control
    this.maxConcurrent = options.maxConcurrent || 3;
    this.activeWork = new Map();
    this.pausedFrom = new Map();
    this.pausePollMs = options.pausePollMs || 50;
    
    // Permissions
    this.permissionLimits = options.permissionLimits || {
      maxFilesPerTask: 50,
      requireApprovalForHighRisk: true,
      requireApprovalForDelete: true
    };
    
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
    this._persist(item);
    
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
      denied: 0,
      denied: 0,
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

    const results = { total: 1, completed: 0, failed: 0, cancelled: 0, denied: 0, items: [] };
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
      const promise = this.activeWork.get(itemId);
      // Set cancellation flag (the execution loop will check this)
      item.updateStatus(WorkItemStatus.CANCELLED, { reason: 'User cancelled' });
      const controller = this.abortControllers.get(itemId);
      if (controller) controller.abort();
      this._persist(item, { workspaceHashes: item.contextHashes || {} });
      this._progress({ type: 'work-cancelled', item: item.getSummary() });
    } else if (this.workQueue.includes(itemId)) {
      // Remove from queue
      const index = this.workQueue.indexOf(itemId);
      this.workQueue.splice(index, 1);
      item.updateStatus(WorkItemStatus.CANCELLED, { reason: 'Cancelled before execution' });
      this._persist(item);
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

  getHistory() {
    return this.runStore ? this.runStore.list() : [];
  }

  getPersistedWorkItem(itemId) {
    return this.runStore ? this.runStore.load(itemId) : { status: 'unavailable', id: itemId };
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
    this.abortControllers.set(item.id, controller);
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
        this._persist(item);

        const task = {
          schemaVersion: item.schemaVersion,
          id: item.taskId || item.id,
          description: item.description,
          acceptanceCriteria: item.acceptanceCriteria,
          files: item.files
        };
        const taskValidation = validateTaskContract(task);
        if (!taskValidation.valid) {
          throw new Error(`Invalid task contract: ${taskValidation.issues.join(', ')}`);
        }
        if (!task.files.length) {
          throw new Error('An explicit, bounded file scope is required for code-generation work');
        }
        if (!this.executor) {
          throw new Error('No agent executor is configured; no model provider was invoked');
        }
        const context = this.workspaceContext.collect(task.files);
        item.contextHashes = Object.fromEntries(context.files.map(file => [file.path, file.hash]));
        this._persist(item, { workspaceHashes: item.contextHashes });
        if (controller.signal.aborted) throw new Error('Work cancelled');

        const plan = await this.planner.plan({
          ...task,
          deliverables: item.deliverables,
          dependencies: item.dependencies,
          context: { workspace: this.workspace, files: task.files, boundedContext: context }
        });

        item.setPlan(plan);
        this._persist(item, { workspaceHashes: item.contextHashes });
        this._progress({ type: 'plan-created', item: item.getSummary(), plan });

        const validation = validatePlan(plan, { maxSteps: this.maxSteps, maxFiles: this.maxFiles });
        if (!validation.valid) {
          throw new Error(`Invalid plan: ${validation.issues.join(', ')}`);
        }
        if (typeof this.planner.validatePlan === 'function') {
          const plannerValidation = this.planner.validatePlan(plan);
          if (!plannerValidation.valid) {
            throw new Error(`Invalid plan: ${plannerValidation.issues.join(', ')}`);
          }
        }
        if (plan.affectedFiles.some(file => !task.files.includes(file))) {
          throw new Error('Plan includes files outside the requested task scope');
        }

        const permissionCheck = this._checkPermissions(item, plan);
        if (!permissionCheck.allowed) {
          throw Object.assign(new Error(`Permission denied: ${permissionCheck.reason}`), { denied: true });
        }

        const planDigest = this._digest(plan);
        if (permissionCheck.requiresApproval) {
          item.updateStatus(WorkItemStatus.AWAITING_APPROVAL);
          item.approval = { schemaVersion: CONTRACT_VERSION, status: 'pending', planDigest, patchDigest: null };
          this._persist(item, { workspaceHashes: item.contextHashes });
          this._progress({ type: 'approval-required', item: item.getSummary(), plan, planDigest });
          const approved = await this._requestApproval(item, plan, {
            stage: 'plan',
            planDigest,
            signal: controller.signal
          });
          if (!approved) {
            item.updateStatus(WorkItemStatus.DENIED, { reason: 'Plan approval denied', planDigest });
            item.approval = { schemaVersion: CONTRACT_VERSION, status: 'denied', planDigest };
            this._persist(item, { workspaceHashes: item.contextHashes || {} });
            results.denied++;
            results.items.push({ itemId: item.id, status: WorkResultStatus.DENIED, reason: 'Plan approval denied' });
            return;
          }
          item.approval = {
            schemaVersion: CONTRACT_VERSION,
            status: 'approved',
            planDigest,
            patchDigest: null,
            patchDigests: [],
            approvedAt: new Date().toISOString(),
            stage: 'plan'
          };
          this._persist(item, { workspaceHashes: item.contextHashes });
        }

        if (controller.signal.aborted) throw new Error('Work cancelled');
        item.updateStatus(WorkItemStatus.WORKING);
        this._persist(item, { workspaceHashes: item.contextHashes });
        this._progress({ type: 'work-executing', item: item.getSummary() });

        const output = await this._executeSteps(item, plan, task, context, controller, planDigest);

        if (controller.signal.aborted || item.status === WorkItemStatus.CANCELLED) {
          results.cancelled++;
          results.items.push({ itemId: item.id, status: WorkResultStatus.CANCELLED, reason: 'Cancelled during execution', output });
          this._progress({ type: 'work-cancelled', item: item.getSummary() });
          return;
        }

        if (this._digest(plan) !== planDigest) {
          throw new Error('Approved plan changed during execution');
        }
        if (output.patches.length) {
          const applied = await this._applyPatches(item, plan, output.patches, planDigest, controller.signal);
          output.appliedPatches = applied;
        }
        output.verifiedChangedFiles = [...item.changedFiles];
        item.setOutput(output);
        this._persist(item, { workspaceHashes: item.contextHashes });
        if (item.changedFiles.length === 0) {
          throw new Error('Executor produced no applied workspace changes; work cannot be completed');
        }

        item.updateStatus(WorkItemStatus.VERIFYING);
        this._persist(item, { workspaceHashes: item.contextHashes });
        const verificationResults = await this._verifyWork(item, plan, controller.signal);
        item.setVerificationResults(verificationResults);

        if (!verificationResults.passed) {
          throw new Error('One or more required verification checks did not pass');
        }

        const completion = {
          schemaVersion: CONTRACT_VERSION,
          status: WorkResultStatus.COMPLETED,
          changedFiles: item.changedFiles,
          verifiedChangedFiles: output.verifiedChangedFiles,
          verification: {
            schemaVersion: CONTRACT_VERSION,
            checks: Object.fromEntries(Object.entries(verificationResults.checks).map(([id, check]) => [
              id,
              { status: check.status, required: check.required }
            ]))
          },
          scaffold: output.scaffold === true
        };
        const completionValidation = validateCompletion(completion);
        if (!completionValidation.valid) {
          throw new Error(`Completion contract failed: ${completionValidation.issues.join(', ')}`);
        }
        const approvalValidation = validateApproval(item.approval);
        if (!approvalValidation.valid || item.approval.status !== 'approved' ||
            item.approval.planDigest !== planDigest || !item.approval.patchDigests?.length) {
          throw new Error('Final patch approval is missing or no longer matches the executed plan');
        }

        item.updateStatus(WorkItemStatus.COMPLETED);
        this._persist(item, { workspaceHashes: item.contextHashes });
        results.completed++;
        results.items.push({
          itemId: item.id,
          status: WorkResultStatus.COMPLETED,
          output,
          verification: verificationResults
        });
        this._progress({ type: 'work-complete', item: item.getSummary() });

      } catch (error) {
        if (controller.signal.aborted || item.status === WorkItemStatus.CANCELLED) {
          item.updateStatus(WorkItemStatus.CANCELLED, { reason: 'Work cancelled' });
          this._persist(item, { workspaceHashes: item.contextHashes || {} });
          results.cancelled++;
          results.items.push({ itemId: item.id, status: WorkResultStatus.CANCELLED, reason: 'Work cancelled' });
          this._progress({ type: 'work-cancelled', item: item.getSummary() });
          return;
        }
        if (error.approvalDenied || error.denied) {
          item.updateStatus(WorkItemStatus.DENIED, { reason: error.message });
          item.approval = {
            schemaVersion: CONTRACT_VERSION,
            status: error.approvalExpired ? 'expired' : 'denied',
            planDigest: item.approval?.planDigest || null,
            patchDigest: item.approval?.patchDigest || null,
            patchDigests: item.approval?.patchDigests || []
          };
          this._persist(item, { workspaceHashes: item.contextHashes });
          results.denied++;
          results.items.push({ itemId: item.id, status: WorkResultStatus.DENIED, reason: error.message });
          this._progress({ type: 'work-denied', item: item.getSummary(), reason: error.message });
          return;
        }
        item.setError(error);
        item.updateStatus(WorkItemStatus.FAILED, { error: error.message });
        this._persist(item, { workspaceHashes: item.contextHashes });
        results.failed++;
        results.items.push({
          itemId: item.id,
          status: WorkResultStatus.FAILED,
          error: error.message,
          verification: item.verificationResults
        });
        this._progress({ type: 'work-error', item: item.getSummary(), error: error.message });
      } finally {
        this.abortControllers.delete(item.id);
        this.activeWork.delete(item.id);
      }
    };

    const promise = executeAsync();
    this.activeWork.set(item.id, promise);
  }

  async _executeSteps(item, plan, task, context, controller, planDigest) {
    const output = { completedSteps: [], results: {}, patches: [], verifiedChangedFiles: [] };

    for (const step of plan.steps) {
      await this._waitWhilePaused(item);

      if (controller.signal.aborted || item.status === WorkItemStatus.CANCELLED) {
        break;
      }

      this._progress({ 
        type: 'step-start', 
        item: item.getSummary(), 
        step: step.description 
      });

      const stepResult = await this._executeStep(item, step, task, context, controller, plan, planDigest);
      
      output.completedSteps.push(step.id);
      output.results[step.id] = stepResult;
      output.patches.push(...stepResult.patches);

      this._progress({ 
        type: 'step-complete', 
        item: item.getSummary(), 
        step: step.description,
        result: stepResult
      });
    }

    return output;
  }

  async _executeStep(item, step, task, context, controller, plan, planDigest) {
    const toolDefinitions = this.toolRegistry ? this.toolRegistry.getModelTools() : [];
    const toolPatches = [];
    const stepController = new AbortController();
    const abortStep = () => stepController.abort();
    if (controller.signal.aborted) abortStep();
    else controller.signal.addEventListener('abort', abortStep, { once: true });
    const modelContext = {
      ...context,
      files: context.files.map(file => ({
        ...file,
        content: this.permissionManager.redactSecrets(file.content)
      }))
    };
    const callTool = this.toolRegistry ? (name, args) => this.toolRegistry.execute(name, args, {
      taskId: item.id,
      planStepId: step.id,
      signal: stepController.signal,
      allowedTools: toolDefinitions.map(tool => tool.name),
      applyPatch: async patch => {
        const proposal = {
        schemaVersion: CONTRACT_VERSION,
        path: patch.path,
        operation: 'modify',
        expectedHash: patch.expectedHash,
        content: patch.content
        };
        const validation = validatePatch(proposal, { maxBytes: this.maxPatchBytes });
        if (!validation.valid) throw new Error(`Invalid edit proposal: ${validation.issues.join(', ')}`);
        if (!plan.affectedFiles.includes(proposal.path)) {
          throw new Error(`Edit proposal is outside the approved plan: ${proposal.path}`);
        }
        toolPatches.push(proposal);
        return { status: 'proposed', path: proposal.path, expectedHash: proposal.expectedHash };
      }
    }) : undefined;
    const request = {
      task,
      plan,
      step,
      context: modelContext,
      signal: stepController.signal,
      tools: toolDefinitions,
      callTool
    };
    let timeout;
    let onAbort;
    try {
      const execution = typeof this.executor === 'function'
        ? Promise.resolve().then(() => this.executor(request))
        : (typeof this.executor.executeStep === 'function'
          ? Promise.resolve().then(() => this.executor.executeStep(request))
          : Promise.resolve(null));
      const interrupted = new Promise((resolve, reject) => {
        onAbort = () => reject(new Error('Agent step cancelled'));
        if (stepController.signal.aborted) {
          onAbort();
        } else {
          stepController.signal.addEventListener('abort', onAbort, { once: true });
        }
        timeout = setTimeout(() => {
          reject(Object.assign(
            new Error(`Agent executor timed out after ${this.executorTimeoutMs}ms`),
            { code: 'EXECUTOR_TIMEOUT' }
          ));
          stepController.abort();
        }, this.executorTimeoutMs);
      });
      const stepResult = await Promise.race([execution, interrupted]);
      if (controller.signal.aborted) throw new Error('Work cancelled');
      if (!stepResult || typeof stepResult !== 'object' || Array.isArray(stepResult) ||
          stepResult.success !== true || String(stepResult.stepId) !== String(step.id) ||
          !Array.isArray(stepResult.patches)) {
        throw new Error(`Executor returned malformed or unsuccessful output for step '${step.id}'`);
      }
      const patches = [...stepResult.patches, ...toolPatches];
      for (const patch of patches) {
        const validation = validatePatch(patch, { maxBytes: this.maxPatchBytes });
        if (!validation.valid) {
          throw new Error(`Executor returned an invalid patch for step '${step.id}': ${validation.issues.join(', ')}`);
        }
        if (!plan.affectedFiles.includes(patch.path)) {
          throw new Error(`Executor returned a patch outside the approved plan for step '${step.id}': ${patch.path}`);
        }
      }
      return { ...stepResult, patches };
    } finally {
      if (timeout) clearTimeout(timeout);
      if (onAbort) stepController.signal.removeEventListener('abort', onAbort);
      controller.signal.removeEventListener('abort', abortStep);
    }
  }

  async _applyPatches(item, plan, proposedPatches, planDigest, signal) {
    if (!Array.isArray(proposedPatches) || proposedPatches.length === 0) {
      throw new Error('Patch set is empty');
    }
    if (proposedPatches.length > this.maxFiles) {
      throw new Error(`Patch file limit exceeded (${proposedPatches.length} > ${this.maxFiles})`);
    }
    const patchDetails = [];
    const seenPaths = new Set();
    for (const patch of proposedPatches) {
      const patchValidation = validatePatch(patch, { maxBytes: this.maxPatchBytes });
      if (!patchValidation.valid) throw new Error(`Invalid patch: ${patchValidation.issues.join(', ')}`);
      const relativePath = patch.path;
      const operation = patch.operation;
      if (typeof relativePath !== 'string' || !relativePath.trim() ||
          !['create', 'modify', 'delete'].includes(operation)) {
        throw new Error('Patch must contain a relative path and a supported operation');
      }
      const absolutePath = path.resolve(this.workspace, relativePath);
      const normalizedRelativePath = path.relative(this.workspace, absolutePath);
      if (normalizedRelativePath === '..' || normalizedRelativePath.startsWith(`..${path.sep}`) ||
          path.isAbsolute(normalizedRelativePath) || !plan.affectedFiles.includes(relativePath)) {
        throw new Error(`Patch path is outside the approved plan scope: ${relativePath}`);
      }
      if (seenPaths.has(relativePath)) throw new Error(`Duplicate patch path: ${relativePath}`);
      seenPaths.add(relativePath);
      const pathPermission = this.permissionManager.validatePath(absolutePath);
      if (!pathPermission.valid) throw new Error(`Permission denied: ${pathPermission.reason}`);
      if (signal.aborted) throw new Error('Work cancelled');

      const exists = fs.existsSync(absolutePath);
      if (operation === 'create' && exists) throw new Error(`Create target already exists: ${relativePath}`);
      if (operation !== 'create' && !exists) throw new Error(`Patch source is missing: ${relativePath}`);
      const originalContent = exists ? fs.readFileSync(absolutePath, 'utf8') : '';
      const actualHash = exists ? this._digest(originalContent) : null;
      if (operation === 'create') {
        if (patch.expectedHash !== null && patch.expectedHash !== undefined) {
          throw new Error(`Create patch must not include an expected source hash: ${relativePath}`);
        }
      } else if (typeof patch.expectedHash !== 'string' || patch.expectedHash !== actualHash) {
        throw new Error(`Stale source for ${relativePath}: expected hash does not match current content`);
      }
      if (operation !== 'delete' && typeof patch.content !== 'string') {
        throw new Error(`Patch content is required for ${operation}: ${relativePath}`);
      }
      if (operation === 'delete' && patch.content !== undefined && patch.content !== null) {
        throw new Error(`Delete patch must not contain replacement content: ${relativePath}`);
      }
      const contentBytes = Buffer.byteLength(patch.content || '', 'utf8');
      if (contentBytes > this.maxPatchBytes) {
        throw new Error(`Patch content exceeds byte limit for ${relativePath}`);
      }
      patchDetails.push({
        path: relativePath,
        operation,
        expectedHash: patch.expectedHash || null,
        originalContent,
        content: patch.content === undefined ? null : patch.content
      });
    }

    const patchDigest = this._digest({ planDigest, patches: patchDetails });
    const firstDiffIndex = this.diffReviewSystem.diffs.length;
    const rejectPendingDiffs = () => {
      for (let index = firstDiffIndex; index < this.diffReviewSystem.diffs.length; index++) {
        if (this.diffReviewSystem.diffs[index].status === 'pending') this.diffReviewSystem.rejectDiff(index);
      }
    };
    for (const patch of patchDetails) {
      this.diffReviewSystem.addDiff(
        path.resolve(this.workspace, patch.path),
        patch.originalContent,
        patch.content,
        { operation: patch.operation, expectedHash: patch.expectedHash }
      );
    }
    const proposedDiffs = this.diffReviewSystem.diffs.slice(firstDiffIndex).map(diff => ({
      path: path.relative(this.workspace, diff.filePath),
      operation: diff.operation,
      unifiedDiff: diff.toUnifiedDiff()
    }));
    item.approval = {
      schemaVersion: CONTRACT_VERSION,
      status: 'pending',
      planDigest,
      patchDigest,
      patchDigests: item.approval?.patchDigests || [],
      requestedAt: new Date().toISOString()
    };
    this._persist(item, { workspaceHashes: item.contextHashes || {} });
    let deleteApprovalProvided = false;
    try {
      for (const patch of patchDetails) {
        const permission = await this.permissionManager.checkPermission({
          type: patch.operation === 'delete' ? 'delete_file' : 'write_file',
          params: {
            path: patch.path,
            content: patch.content || '',
            workId: item.id,
            approvalDetails: { stage: 'patch', planDigest, patchDigest, patches: patchDetails, diffs: proposedDiffs }
          }
        });
        if (!permission.allowed) {
          throw Object.assign(
            new Error(`Permission denied for ${patch.path}: ${permission.reason || 'approval denied'}`),
            { denied: true }
          );
        }
        if (patch.operation === 'delete' && permission.requiresApproval) deleteApprovalProvided = true;
      }
    } catch (error) {
      rejectPendingDiffs();
      throw error;
    }
    if (!deleteApprovalProvided) {
      let approved;
      try {
        approved = await this._requestApproval(item, plan, {
          stage: 'patch',
          planDigest,
          patchDigest,
          patches: patchDetails,
          diffs: proposedDiffs,
          signal
        });
      } catch (error) {
        rejectPendingDiffs();
        throw error;
      }
      if (!approved) {
        rejectPendingDiffs();
        item.updateStatus(WorkItemStatus.DENIED, { reason: 'Patch approval denied', planDigest, patchDigest });
        throw Object.assign(new Error('Patch approval denied'), { approvalDenied: true });
      }
    }
    if (this._digest(plan) !== planDigest) {
      rejectPendingDiffs();
      throw new Error('Approved plan changed before patch application');
    }
    item.approval = {
      schemaVersion: CONTRACT_VERSION,
      status: 'approved',
      planDigest,
      patchDigest,
      patchDigests: [...new Set([...(item.approval?.patchDigests || []), patchDigest])],
      approvedAt: new Date().toISOString(),
      stage: 'patch'
    };

    const applied = [];
    try {
      for (let index = firstDiffIndex; index < this.diffReviewSystem.diffs.length; index++) {
        if (signal.aborted) throw new Error('Work cancelled');
        const diff = this.diffReviewSystem.diffs[index];
        const result = await this.diffReviewSystem.applyDiff(index);
        if (!result.success) throw new Error(`Patch conflict for ${path.relative(this.workspace, diff.filePath)}: ${result.error}`);
        applied.push(index);
      }
    } catch (error) {
      for (const index of applied.reverse()) {
        const diff = this.diffReviewSystem.diffs[index];
        const rollback = this.diffReviewSystem.rollback(index);
        if (!rollback.success) {
          error.message += `; rollback failed for ${diff.filePath}: ${rollback.error}`;
        }
      }
      rejectPendingDiffs();
      throw error;
    }

    const verifiedChangedFiles = [];
    for (const patch of patchDetails) {
      const filePath = path.resolve(this.workspace, patch.path);
      const verified = patch.operation === 'delete'
        ? !fs.existsSync(filePath)
        : fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === patch.content;
      if (!verified) throw new Error(`Applied patch did not produce the intended workspace state: ${patch.path}`);
      verifiedChangedFiles.push(patch.path);
      if (!item.changedFiles.includes(patch.path)) item.addChangedFiles([patch.path]);
    }
    return { planDigest, patchDigest, files: verifiedChangedFiles };
  }

  async _verifyWork(item, plan, signal) {
    const results = { schemaVersion: CONTRACT_VERSION, passed: true, checks: {}, requiredPassed: true };
    if (!Array.isArray(plan.expectedChecks) || plan.expectedChecks.length === 0) {
      return { passed: false, checks: {}, requiredPassed: false, error: 'No verification checks configured in plan' };
    }
    for (const check of plan.expectedChecks) {
      let result;
      try {
        result = typeof this.checkRunner === 'function'
          ? await this.checkRunner(check.type, { required: check.required, signal, workspace: this.workspace })
          : await this.checkRunner.run(check.type, { required: check.required, signal });
      } catch (error) {
        result = {
          id: check.type,
          status: 'errored',
          required: check.required !== false,
          error: error.message
        };
      }
      const normalized = {
        id: check.type,
        status: ['passed', 'failed', 'skipped', 'unavailable', 'errored', 'timed-out'].includes(result?.status)
          ? result.status
          : 'errored',
        required: check.required !== false,
        command: result?.command || null,
        exitCode: result?.exitCode ?? null,
        durationMs: result?.durationMs || 0,
        output: this.permissionManager.redactSecrets(String(result?.output || '')).slice(0, 128 * 1024),
        error: result?.error || null
      };
      results.checks[check.type] = normalized;
      if (normalized.required && normalized.status !== 'passed') results.requiredPassed = false;
    }
    results.passed = results.requiredPassed;
    return results;
  }

  _checkPermissions(item, plan) {
    // Check file count limit
    if (plan.affectedFiles.length > Math.min(this.maxFiles, this.permissionLimits.maxFilesPerTask)) {
      return {
        allowed: false,
        reason: `Too many affected files (${plan.affectedFiles.length} > ${Math.min(this.maxFiles, this.permissionLimits.maxFilesPerTask)})`
      };
    }
    if (!Array.isArray(plan.risks)) return { allowed: false, reason: 'Plan risk list is malformed' };
    for (const file of plan.affectedFiles) {
      const validation = this.permissionManager.validatePath(path.resolve(this.workspace, file));
      if (!validation.valid) return { allowed: false, reason: validation.reason };
    }

    // Check for high-risk operations
    const highRisks = plan.risks.filter(r => r.level === 'high' || r.level === 'critical');
    const requiresApproval = 
      (highRisks.length > 0 && this.permissionLimits.requireApprovalForHighRisk) ||
      plan.metadata.requiresApproval === true;

    return {
      allowed: true,
      requiresApproval
    };
  }

  async _requestApproval(item, plan, details = {}) {
    if (details.signal?.aborted) return false;
    if (typeof this.onApprovalRequired === 'function') {
      let timer;
      try {
        const timeout = new Promise(resolve => {
          timer = setTimeout(() => resolve({ expired: true }), this.approvalTimeoutMs);
        });
        const decision = await Promise.race([
          Promise.resolve(this.onApprovalRequired(item, plan, details)),
          timeout
        ]);
        if (decision && decision.expired) {
          throw Object.assign(new Error('Approval request timed out'), { approvalExpired: true, denied: true });
        }
        if (decision === true) return true;
        return Boolean(decision && decision.approved === true &&
          decision.planDigest === details.planDigest &&
          (!details.patchDigest || decision.patchDigest === details.patchDigest));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return false;
  }

  _digest(value) {
    return crypto.createHash('sha256').update(
      typeof value === 'string' ? value : JSON.stringify(value)
    ).digest('hex');
  }

  _persist(item, metadata = {}) {
    if (!this.runStore) return null;
    const toolEvents = this.toolRegistry
      ? this.toolRegistry.getExecutionLog().filter(event => event.taskId === item.id)
      : [];
    return this.runStore.save(item, {
      workspaceHashes: item.contextHashes || {},
      toolEvents,
      ...metadata
    });
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

module.exports = {
  WorkOrchestrator
};

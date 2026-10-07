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

/**
 * Work Orchestrator
 */
class WorkOrchestrator {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.planner = options.planner || new AgentPlanner({ workspace: this.workspace });
    this.pipelineExecutor = options.pipelineExecutor || new PipelineExecutor();
    
    // Work queue
    this.workItems = new Map();
    this.workQueue = [];
    
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
      const promise = this.activeWork.get(itemId);
      // Set cancellation flag (the execution loop will check this)
      item.updateStatus(WorkItemStatus.CANCELLED, { reason: 'User cancelled' });
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

        // 1. Create execution plan
        const plan = await this.planner.plan({
          description: item.description,
          deliverables: item.plan?.deliverables || [],
          dependencies: item.dependencies,
          context: { workspace: this.workspace }
        });

        item.setPlan(plan);
        this._progress({ type: 'plan-created', item: item.getSummary(), plan });

        // 2. Validate plan
        const validation = this.planner.validatePlan(plan);
        if (!validation.valid) {
          throw new Error(`Invalid plan: ${validation.issues.join(', ')}`);
        }

        // 3. Check permissions and approval requirements
        const permissionCheck = this._checkPermissions(item, plan);
        if (!permissionCheck.allowed) {
          throw new Error(`Permission denied: ${permissionCheck.reason}`);
        }

        if (permissionCheck.requiresApproval) {
          item.updateStatus(WorkItemStatus.AWAITING_APPROVAL);
          this._progress({ type: 'approval-required', item: item.getSummary(), plan });
          
          // Request approval
          const approved = await this._requestApproval(item, plan);
          if (!approved) {
            item.updateStatus(WorkItemStatus.CANCELLED, { reason: 'Approval denied' });
            results.cancelled++;
            results.items.push({ itemId: item.id, status: 'cancelled', reason: 'Approval denied' });
            return;
          }
        }

        // 4. Execute work
        item.updateStatus(WorkItemStatus.WORKING);
        this._progress({ type: 'work-executing', item: item.getSummary() });

        const output = await this._executeSteps(item, plan);
        item.setOutput(output);

        if (item.status === WorkItemStatus.CANCELLED) {
          results.cancelled++;
          results.items.push({ itemId: item.id, status: 'cancelled', reason: 'Cancelled during execution', output });
          this._progress({ type: 'work-cancelled', item: item.getSummary() });
          return;
        }

        // 5. Verify results
        item.updateStatus(WorkItemStatus.VERIFYING);
        const verificationResults = await this._verifyWork(item, plan);
        item.setVerificationResults(verificationResults);

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
        results.items.push({ itemId: item.id, status: 'completed', output });
        this._progress({ type: 'work-complete', item: item.getSummary() });

      } catch (error) {
        item.setError(error);
        item.updateStatus(WorkItemStatus.FAILED, { error: error.message });
        results.failed++;
        results.items.push({ itemId: item.id, status: 'failed', error: error.message });
        this._progress({ type: 'work-error', item: item.getSummary(), error: error.message });
      } finally {
        this.activeWork.delete(item.id);
      }
    };

    const promise = executeAsync();
    this.activeWork.set(item.id, promise);
  }

  async _executeSteps(item, plan) {
    const output = { completedSteps: [], results: {} };

    for (const step of plan.steps) {
      await this._waitWhilePaused(item);

      // Check for cancellation
      if (item.status === WorkItemStatus.CANCELLED) {
        break;
      }

      this._progress({ 
        type: 'step-start', 
        item: item.getSummary(), 
        step: step.description 
      });

      // Execute step (stubbed for now - would call actual agent executor)
      const stepResult = await this._executeStep(item, step);
      
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

  async _executeStep(item, step) {
    // Stub: In real implementation, this would invoke the actual agent executor
    // with the appropriate model, tools, and context
    await new Promise(resolve => setTimeout(resolve, 100));
    return { success: true, stepId: step.id };
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

  _checkPermissions(item, plan) {
    // Check file count limit
    if (plan.affectedFiles.length > this.permissionLimits.maxFilesPerTask) {
      return {
        allowed: false,
        reason: `Too many affected files (${plan.affectedFiles.length} > ${this.permissionLimits.maxFilesPerTask})`
      };
    }

    // Check for high-risk operations
    const highRisks = plan.risks.filter(r => r.level === 'high' || r.level === 'critical');
    const requiresApproval = 
      (highRisks.length > 0 && this.permissionLimits.requireApprovalForHighRisk) ||
      plan.metadata.requiresApproval;

    return {
      allowed: true,
      requiresApproval
    };
  }

  async _requestApproval(item, plan) {
    if (typeof this.onApprovalRequired === 'function') {
      try {
        return await this.onApprovalRequired(item, plan);
      } catch (err) {
        return false;
      }
    }
    // Default: deny if no approval handler
    return false;
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

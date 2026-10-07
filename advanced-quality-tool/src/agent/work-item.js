/**
 * Work Item (P9-T010)
 *
 * Represents a unit of work with status tracking, dependencies,
 * agent assignment, and execution history.
 *
 * @module agent/work-item
 */

'use strict';

/**
 * Work item status
 */
const WorkItemStatus = {
  QUEUED: 'queued',
  PLANNING: 'planning',
  AWAITING_APPROVAL: 'awaiting_approval',
  WORKING: 'working',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  DENIED: 'denied',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  BLOCKED: 'blocked',
  PAUSED: 'paused'
};

/**
 * Work Item
 */
class WorkItem {
  constructor(params) {
    this.id = params.id || this._generateId();
    this.taskId = params.taskId || null;
    this.description = params.description || '';
    this.schemaVersion = params.schemaVersion || 1;
    this.acceptanceCriteria = Array.isArray(params.acceptanceCriteria) ? [...params.acceptanceCriteria] : [];
    this.files = Array.isArray(params.files) ? [...params.files] : [];
    this.deliverables = Array.isArray(params.deliverables)
      ? [...params.deliverables]
      : (Array.isArray(params.plan?.deliverables) ? [...params.plan.deliverables] : []);
    this.status = params.status || WorkItemStatus.QUEUED;
    this.priority = params.priority || 'MEDIUM';
    
    // Dependencies
    this.dependencies = params.dependencies || [];
    this.blockedBy = [];
    
    // Agent assignment
    this.assignedAgent = params.assignedAgent || null;
    this.assignedModel = params.assignedModel || null;
    this.toolPolicy = params.toolPolicy || 'default';
    this.taskContract = params.taskContract || null;
    this.context = params.context || null;
    
    // Execution
    this.plan = null;
    this.planVersion = null;
    this.approval = null;
    this.affectedFiles = [];
    this.expectedChecks = [];
    this.risks = [];
    this.retryCount = 0;
    this.maxRetries = params.maxRetries || 3;
    
    // Results
    this.output = null;
    this.error = null;
    this.changedFiles = [];
    this.verificationResults = {};
    this.toolCalls = [];
    this._toolBudgetUsed = { calls: 0, outputBytes: 0 };
    
    // Timing
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.completedAt = null;
    this.elapsedMs = 0;
    
    // History
    this.events = [];
  }

  /**
   * Update work item status
   * @param {string} newStatus
   * @param {Object} [metadata]
   */
  updateStatus(newStatus, metadata = {}) {
    const oldStatus = this.status;
    this.status = newStatus;
    
    this.events.push({
      type: 'status-change',
      from: oldStatus,
      to: newStatus,
      timestamp: new Date().toISOString(),
      metadata
    });

    // Update timing
    if (newStatus === WorkItemStatus.WORKING && !this.startedAt) {
      this.startedAt = new Date().toISOString();
    }
    if ([WorkItemStatus.COMPLETED, WorkItemStatus.DENIED, WorkItemStatus.FAILED, WorkItemStatus.CANCELLED].includes(newStatus)) {
      this.completedAt = new Date().toISOString();
      if (this.startedAt) {
        this.elapsedMs = new Date(this.completedAt) - new Date(this.startedAt);
      }
    }
  }

  /**
   * Set the execution plan
   * @param {Object} plan
   */
  setPlan(plan) {
    this.plan = plan;
    this.planVersion = plan.planVersion;
    this.approval = null;
    this.affectedFiles = plan.affectedFiles || [];
    this.expectedChecks = plan.expectedChecks || [];
    this.risks = plan.risks || [];
    
    this.events.push({
      type: 'plan-set',
      timestamp: new Date().toISOString(),
      plan: {
        steps: plan.steps?.length || 0,
        files: this.affectedFiles.length,
        checks: this.expectedChecks.length,
        risks: this.risks.length
      }
    });
  }

  /**
   * Assign to an agent
   * @param {string} agentName
   * @param {string} modelName
   * @param {string} [toolPolicy]
   */
  assign(agentName, modelName, toolPolicy = 'default') {
    this.assignedAgent = agentName;
    this.assignedModel = modelName;
    this.toolPolicy = toolPolicy;
    
    this.events.push({
      type: 'assigned',
      timestamp: new Date().toISOString(),
      agent: agentName,
      model: modelName,
      toolPolicy
    });
  }

  /**
   * Record work output
   * @param {*} output
   */
  setOutput(output) {
    this.output = output;
    this.events.push({
      type: 'output-set',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Record an error
   * @param {Error|string} error
   */
  setError(error) {
    this.error = error instanceof Error ? error.message : String(error);
    this.events.push({
      type: 'error',
      timestamp: new Date().toISOString(),
      error: this.error
    });
  }

  /**
   * Add changed files
   * @param {Array<string>} files
   */
  addChangedFiles(files) {
    this.changedFiles.push(...files);
    this.events.push({
      type: 'files-changed',
      timestamp: new Date().toISOString(),
      count: files.length
    });
  }

  /**
   * Record verification results
   * @param {Object} results
   */
  setVerificationResults(results) {
    this.verificationResults = results;
    this.events.push({
      type: 'verification',
      timestamp: new Date().toISOString(),
      passed: results.passed,
      checks: Object.keys(results).length
    });
  }

  /**
   * Record a tool call made during execution, correlated with this work item,
   * its task, and the plan step that issued it.
   * @param {Object} entry
   */
  recordToolCall(entry) {
    this.toolCalls.push(entry);
    this.events.push({
      type: 'tool-call',
      timestamp: entry.timestamp || new Date().toISOString(),
      tool: entry.tool,
      stepId: entry.stepId,
      success: entry.success,
      code: entry.code || null
    });
  }

  /**
   * Increment retry counter
   * @returns {boolean} true if more retries available
   */
  incrementRetry() {
    this.retryCount++;
    this.events.push({
      type: 'retry',
      timestamp: new Date().toISOString(),
      attempt: this.retryCount,
      remaining: this.maxRetries - this.retryCount
    });
    return this.retryCount < this.maxRetries;
  }

  /**
   * Check if this item can be executed
   * @param {Map<string, WorkItem>} allItems
   * @returns {Object} { ready: boolean, blockedBy: string[] }
   */
  checkReadiness(allItems) {
    const blockedBy = [];
    
    for (const depId of this.dependencies) {
      const dep = allItems.get(depId);
      if (!dep) {
        blockedBy.push(`Missing dependency: ${depId}`);
        continue;
      }
      if (dep.status !== WorkItemStatus.COMPLETED) {
        blockedBy.push(`Dependency ${depId} not completed (status: ${dep.status})`);
      }
    }
    
    this.blockedBy = blockedBy;
    return {
      ready: blockedBy.length === 0,
      blockedBy
    };
  }

  /**
   * Get a summary for display
   * @returns {Object}
   */
  getSummary() {
    return {
      id: this.id,
      taskId: this.taskId,
      description: this.description,
      schemaVersion: this.schemaVersion,
      acceptanceCriteria: this.acceptanceCriteria,
      files: this.files,
      deliverables: this.deliverables,
      status: this.status,
      priority: this.priority,
      assignedAgent: this.assignedAgent,
      assignedModel: this.assignedModel,
      dependencies: this.dependencies,
      blockedBy: this.blockedBy,
      retryCount: this.retryCount,
      elapsedMs: this.elapsedMs,
      changedFiles: this.changedFiles.length,
      error: this.error
    };
  }

  /**
   * Convert to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      taskId: this.taskId,
      description: this.description,
      status: this.status,
      priority: this.priority,
      dependencies: this.dependencies,
      blockedBy: this.blockedBy,
      assignedAgent: this.assignedAgent,
      assignedModel: this.assignedModel,
      toolPolicy: this.toolPolicy,
      taskContract: this.taskContract,
      context: this.context,
      plan: this.plan,
      planVersion: this.planVersion,
      approval: this.approval,
      affectedFiles: this.affectedFiles,
      expectedChecks: this.expectedChecks,
      risks: this.risks,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      output: this.output,
      error: this.error,
      changedFiles: this.changedFiles,
      verificationResults: this.verificationResults,
      toolCalls: this.toolCalls,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      elapsedMs: this.elapsedMs,
      events: this.events
    };
  }

  _generateId() {
    return `work-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = {
  WorkItem,
  WorkItemStatus
};

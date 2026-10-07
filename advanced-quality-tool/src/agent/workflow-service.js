'use strict';

const path = require('path');
const { WorkOrchestrator } = require('./work-orchestrator');
const { AgentPlanner } = require('./planner');
const { WorkItemStatus } = require('./work-item');

const TERMINAL_STATUSES = new Set([
  WorkItemStatus.COMPLETED,
  WorkItemStatus.DENIED,
  WorkItemStatus.FAILED,
  WorkItemStatus.CANCELLED
]);

/**
 * Transport-independent entry point for supervised agent work.
 */
class AgentWorkflowService {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.orchestratorOptions = options.orchestratorOptions || {};
    this.orchestratorFactory = options.orchestratorFactory || (settings => new WorkOrchestrator(settings));
    this.plannerFactory = options.plannerFactory || (settings => new AgentPlanner(settings));
    this.records = new Map();
  }

  start(params = {}, options = {}) {
    if (typeof params.description !== 'string' || !params.description.trim()) {
      throw new Error('description is required');
    }
    const workspace = path.resolve(params.workspace || this.workspace);
    const progress = [];
    let record;
    const planner = this.plannerFactory({ workspace });
    const orchestrator = this.orchestratorFactory({
      ...this.orchestratorOptions,
      workspace,
      planner,
      maxConcurrent: 1,
      permissionLimits: {
        maxFilesPerTask: params.maxFiles ?? 50,
        requireApprovalForHighRisk: true,
        requireApprovalForDelete: true
      },
      onProgress: event => {
        progress.push({
          type: event.type,
          timestamp: event.timestamp || new Date().toISOString(),
          itemId: event.item?.id,
          status: event.item?.status,
          step: typeof event.step === 'string' ? event.step : undefined,
          planDigest: event.planDigest,
          error: event.error
        });
        if (progress.length > 500) progress.shift();
        options.onProgress?.(event);
      },
      onApprovalRequired: async (item, plan, details) => {
        if (typeof options.approvalHandler === 'function') {
          const response = await options.approvalHandler(item, plan, details);
          const approved = response === true || response?.approved === true;
          record.approvalState = approved ? 'approved' : 'denied';
          if (!approved) record.approvalReason = response?.reason || 'Approval denied';
          return response;
        }
        if (!options.approvalChannel) {
          record.approvalState = 'denied';
          record.approvalReason = 'No approval channel is configured; headless approval is denied';
          return { approved: false, outcome: 'denied', reason: record.approvalReason };
        }
        return new Promise(resolve => {
          record.pendingApproval = { resolve, planDigest: details.planDigest, actionDigest: details.actionDigest || null };
          record.approvalState = 'awaiting_approval';
        });
      }
    });

    const item = orchestrator.addWork({
      taskId: params.taskId,
      description: params.description.trim(),
      files: Array.isArray(params.files) ? params.files : [],
      priority: params.priority || 'medium',
      acceptanceCriteria: params.acceptanceCriteria,
      plan: { deliverables: Array.isArray(params.deliverables) ? params.deliverables : [] }
    });
    if (!item.taskId) item.taskId = item.id;
    record = {
      id: item.id,
      taskId: item.taskId,
      orchestrator,
      item,
      workspace,
      started: new Date().toISOString(),
      progress,
      logs: progress,
      options: params,
      approvalState: 'not_required',
      approvalReason: null,
      pendingApproval: null,
      result: null,
      error: null,
      completed: null
    };
    this.records.set(item.id, record);

    record.completion = Promise.resolve()
      .then(() => orchestrator.executeOne(item.id))
      .then(result => {
        record.result = result;
        if (result?.status === 'denied') record.approvalState = 'denied';
        else if (item.approval) record.approvalState = 'approved';
        if (record.approvalState === 'awaiting_approval' && TERMINAL_STATUSES.has(item.status)) {
          record.approvalState = item.status === WorkItemStatus.CANCELLED ? 'cancelled' : record.approvalState;
        }
        return result;
      })
      .catch(error => {
        record.error = error.message;
        record.item.error = error.message;
        record.item.status = WorkItemStatus.FAILED;
        return { itemId: item.id, status: 'failed', error: error.message };
      })
      .finally(() => {
        record.pendingApproval = null;
        record.completed = new Date().toISOString();
      });
    record.completion.catch(() => {});
    return this.get(item.id);
  }

  get(workId) {
    const record = this.records.get(workId);
    if (!record) return null;
    const item = record.item;
    const denied = record.approvalState === 'denied' && item.status === WorkItemStatus.CANCELLED;
    const status = denied ? 'denied' : item.status;
    const output = record.result?.output || item.output || null;
    return {
      id: record.id,
      workId: record.id,
      taskId: record.taskId,
      description: item.description,
      workspace: record.workspace,
      status,
      priority: item.priority,
      retryCount: item.retryCount,
      maxRetries: item.maxRetries,
      autonomyProfile: { level: 2, name: 'supervised' },
      approvalState: record.approvalState,
      approvalReason: record.approvalReason,
      plan: item.plan,
      planDigest: record.pendingApproval?.planDigest || item.approval?.planDigest || null,
      actionDigest: record.pendingApproval?.actionDigest || null,
      progress: record.progress.slice(),
      patchSummary: {
        changedFiles: [...item.changedFiles],
        patchCount: Array.isArray(output?.appliedPatches) ? output.appliedPatches.length : 0
      },
      verification: item.verificationResults,
      result: record.result,
      error: record.error || item.error || record.result?.error || null,
      started: record.started,
      completed: record.completed,
      active: !record.completed
    };
  }

  list(options = {}) {
    const limit = Number.isInteger(options.limit) && options.limit >= 0 ? options.limit : 50;
    return [...this.records.keys()]
      .map(id => this.get(id))
      .filter(item => !options.status || options.status === 'all' || item.status === options.status ||
        (options.status === 'running' && !TERMINAL_STATUSES.has(item.status)))
      .sort((left, right) => new Date(right.started) - new Date(left.started))
      .slice(0, limit);
  }

  approve(workId, decision = {}) {
    const record = this.records.get(workId);
    if (!record) return { accepted: false, approved: false, status: null, reason: 'Work item not found' };
    if (!record.pendingApproval || record.item.status !== WorkItemStatus.AWAITING_APPROVAL) {
      return { accepted: false, approved: false, status: record.item.status, reason: 'Work item is not awaiting approval' };
    }
    const { planDigest } = record.pendingApproval;
    if (!decision.planDigest || decision.planDigest !== planDigest) {
      return { accepted: false, approved: false, status: record.item.status, reason: 'A matching planDigest is required' };
    }
    if (record.pendingApproval.actionDigest &&
        decision.actionDigest !== record.pendingApproval.actionDigest) {
      return { accepted: false, approved: false, status: record.item.status, reason: 'A matching actionDigest is required' };
    }
    const approved = decision.approved === true;
    record.approvalState = approved ? 'approved' : 'denied';
    record.approvalReason = approved ? null : (decision.reason || 'Approval denied');
    record.pendingApproval.resolve({
      approved,
      planDigest,
      actionDigest: record.pendingApproval.actionDigest,
      outcome: approved ? 'approved' : 'denied',
      reason: record.approvalReason
    });
    record.pendingApproval = null;
    return { accepted: true, approved, status: record.item.status, planDigest };
  }

  cancel(workId) {
    const record = this.records.get(workId);
    if (!record) return { accepted: false, cancelled: false, status: null, reason: 'Work item not found' };
    record.orchestrator.cancel(workId);
    if (record.pendingApproval) {
      const pending = record.pendingApproval;
      record.pendingApproval = null;
      record.approvalState = 'cancelled';
      pending.resolve({
        approved: false,
        planDigest: pending.planDigest,
        actionDigest: pending.actionDigest,
        outcome: 'cancelled',
        reason: 'User cancelled'
      });
    }
    return { accepted: true, cancelled: true, status: record.item.status };
  }

  async wait(workId) {
    const record = this.records.get(workId);
    if (!record) return null;
    await record.completion;
    return this.get(workId);
  }
}

module.exports = { AgentWorkflowService };

/**
 * Agent Assignment and Live Work Activity View (P9-T011)
 *
 * Displays agent work with explicit states sourced from orchestration events:
 * - Queued, Planning, Working, Awaiting Approval, Verifying
 * - Completed, Failed, Cancelled
 *
 * @module ui/agent-activity-view
 */

'use strict';

const EventEmitter = require('events');

/**
 * Agent work states (from orchestration events)
 */
const AgentWorkState = {
  QUEUED: 'queued',
  PLANNING: 'planning',
  WORKING: 'working',
  AWAITING_APPROVAL: 'awaiting-approval',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Agent Activity View Manager
 */
class AgentActivityView extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.workspace = options.workspace || process.cwd();
    this.maxEventHistory = options.maxEventHistory || 1000;
    
    // Activity tracking
    this.activeWork = new Map();        // workId -> WorkActivity
    this.workHistory = new Map();       // workId -> WorkActivity (completed)
    this.eventStream = [];              // Event log for streaming
    
    // State transition validation
    this.validTransitions = {
      [AgentWorkState.QUEUED]: [AgentWorkState.PLANNING, AgentWorkState.CANCELLED],
      [AgentWorkState.PLANNING]: [AgentWorkState.WORKING, AgentWorkState.FAILED, AgentWorkState.CANCELLED],
      [AgentWorkState.WORKING]: [AgentWorkState.AWAITING_APPROVAL, AgentWorkState.VERIFYING, AgentWorkState.FAILED, AgentWorkState.CANCELLED],
      [AgentWorkState.AWAITING_APPROVAL]: [AgentWorkState.VERIFYING, AgentWorkState.FAILED, AgentWorkState.CANCELLED],
      [AgentWorkState.VERIFYING]: [AgentWorkState.COMPLETED, AgentWorkState.FAILED, AgentWorkState.CANCELLED],
      [AgentWorkState.COMPLETED]: [],
      [AgentWorkState.FAILED]: [],
      [AgentWorkState.CANCELLED]: []
    };
  }

  // ─── Work Registration ─────────────────────────────────────────────────────────

  /**
   * Register a new work item
   * @param {Object} workItem
   * @returns {Object} WorkActivity
   */
  registerWork(workItem) {
    const activity = {
      id: workItem.id,
      taskId: workItem.taskId,
      taskName: workItem.taskName || workItem.name || 'Unnamed Task',
      agent: workItem.agent || 'default-agent',
      model: workItem.model || null,
      state: AgentWorkState.QUEUED,
      currentStep: null,
      startTime: Date.now(),
      elapsedTime: 0,
      result: null,
      progress: 0,
      events: [],
      files: [],
      output: null,
      error: null
    };
    
    this.activeWork.set(activity.id, activity);
    this._recordEvent({
      type: 'work-registered',
      workId: activity.id,
      taskId: activity.taskId,
      agent: activity.agent,
      timestamp: Date.now()
    });
    
    this.emit('work-registered', activity);
    return activity;
  }

  /**
   * Update work state
   * @param {string} workId
   * @param {string} newState
   * @param {Object} details
   */
  updateState(workId, newState, details = {}) {
    const activity = this.activeWork.get(workId);
    if (!activity) {
      throw new Error(`Work '${workId}' not found`);
    }
    
    // Validate state transition
    if (!this._isValidTransition(activity.state, newState)) {
      throw new Error(`Invalid state transition from '${activity.state}' to '${newState}'`);
    }
    
    const previousState = activity.state;
    activity.state = newState;
    activity.elapsedTime = Date.now() - activity.startTime;
    
    // Update details
    if (details.step) activity.currentStep = details.step;
    if (details.progress !== undefined) activity.progress = details.progress;
    if (details.result) activity.result = details.result;
    if (details.files) activity.files = details.files;
    if (details.output) activity.output = details.output;
    if (details.error) activity.error = details.error;
    
    // Record state change event
    this._recordEvent({
      type: 'state-change',
      workId,
      previousState,
      newState,
      details,
      timestamp: Date.now()
    });
    
    // Handle completion states
    if (this._isTerminalState(newState)) {
      this._moveToHistory(workId);
    }
    
    this.emit('state-change', { workId, previousState, newState, activity });
    return activity;
  }

  /**
   * Add tool activity event
   * @param {string} workId
   * @param {Object} toolEvent
   */
  addToolActivity(workId, toolEvent) {
    const activity = this.activeWork.get(workId);
    if (!activity) return;
    
    const event = {
      type: 'tool-activity',
      workId,
      tool: toolEvent.tool,
      action: toolEvent.action,
      input: this._redactSensitive(toolEvent.input),
      output: this._redactSensitive(toolEvent.output),
      success: toolEvent.success,
      duration: toolEvent.duration,
      timestamp: Date.now()
    };
    
    activity.events.push(event);
    this._recordEvent(event);
    
    this.emit('tool-activity', { workId, event });
  }

  /**
   * Add progress update
   * @param {string} workId
   * @param {Object} progress
   */
  addProgress(workId, progress) {
    const activity = this.activeWork.get(workId);
    if (!activity) return;
    
    if (progress.step) activity.currentStep = progress.step;
    if (progress.percent !== undefined) activity.progress = progress.percent;
    if (progress.message) {
      activity.events.push({
        type: 'progress',
        message: progress.message,
        timestamp: Date.now()
      });
    }
    
    this.emit('progress', { workId, progress });
  }

  // ─── Query Methods ─────────────────────────────────────────────────────────────

  /**
   * Get all active work as rows
   * @returns {Array<Object>}
   */
  getWorkRows() {
    return Array.from(this.activeWork.values()).map(activity => this._formatRow(activity));
  }

  /**
   * Get specific work details
   * @param {string} workId
   * @returns {Object|null}
   */
  getWorkDetails(workId) {
    const activity = this.activeWork.get(workId) || this.workHistory.get(workId);
    if (!activity) return null;
    
    return {
      ...this._formatRow(activity),
      events: activity.events,
      files: activity.files,
      output: activity.output,
      error: activity.error
    };
  }

  /**
   * Get event stream for work item
   * @param {string} workId
   * @param {number} limit
   * @returns {Array<Object>}
   */
  getEventStream(workId, limit = 50) {
    const activity = this.activeWork.get(workId) || this.workHistory.get(workId);
    if (!activity) return [];
    
    return activity.events.slice(-limit);
  }

  /**
   * Get all events (for live streaming)
   * @param {number} limit
   * @returns {Array<Object>}
   */
  getAllEvents(limit = 100) {
    return this.eventStream.slice(-limit);
  }

  /**
   * Get work summary
   * @returns {Object}
   */
  getSummary() {
    const states = {};
    for (const state of Object.values(AgentWorkState)) {
      states[state] = 0;
    }
    
    for (const activity of this.activeWork.values()) {
      states[activity.state]++;
    }
    
    return {
      active: this.activeWork.size,
      completed: this.workHistory.size,
      states,
      totalEvents: this.eventStream.length
    };
  }

  // ─── Private Methods ───────────────────────────────────────────────────────────

  /**
   * Format activity as row
   */
  _formatRow(activity) {
    return {
      id: activity.id,
      taskId: activity.taskId,
      taskName: activity.taskName,
      agent: activity.agent,
      model: activity.model,
      state: activity.state,
      currentStep: activity.currentStep,
      elapsedTime: activity.elapsedTime || (Date.now() - activity.startTime),
      progress: activity.progress,
      result: activity.result,
      hasError: activity.error !== null
    };
  }

  /**
   * Validate state transition
   */
  _isValidTransition(fromState, toState) {
    const allowed = this.validTransitions[fromState];
    return allowed && allowed.includes(toState);
  }

  /**
   * Check if state is terminal
   */
  _isTerminalState(state) {
    return state === AgentWorkState.COMPLETED ||
           state === AgentWorkState.FAILED ||
           state === AgentWorkState.CANCELLED;
  }

  /**
   * Move work to history
   */
  _moveToHistory(workId) {
    const activity = this.activeWork.get(workId);
    if (!activity) return;
    
    this.activeWork.delete(workId);
    this.workHistory.set(workId, activity);
    
    this.emit('work-completed', { workId, state: activity.state });
  }

  /**
   * Record event in stream
   */
  _recordEvent(event) {
    this.eventStream.push(event);
    
    // Trim old events
    if (this.eventStream.length > this.maxEventHistory) {
      this.eventStream = this.eventStream.slice(-this.maxEventHistory);
    }
  }

  /**
   * Redact sensitive information
   */
  _redactSensitive(data) {
    if (!data || typeof data !== 'object') return data;
    
    const redacted = { ...data };
    const sensitiveKeys = ['password', 'token', 'apiKey', 'secret', 'credential'];
    
    for (const key of Object.keys(redacted)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        redacted[key] = '[REDACTED]';
      }
    }
    
    return redacted;
  }
}

/**
 * WebSocket streaming handler
 */
class AgentActivityStreamer {
  constructor(activityView, webSocketServer) {
    this.activityView = activityView;
    this.webSocketServer = webSocketServer;
    
    // Subscribe to activity view events
    this.activityView.on('work-registered', this._broadcast.bind(this, 'work-registered'));
    this.activityView.on('state-change', this._broadcast.bind(this, 'state-change'));
    this.activityView.on('tool-activity', this._broadcast.bind(this, 'tool-activity'));
    this.activityView.on('progress', this._broadcast.bind(this, 'progress'));
    this.activityView.on('work-completed', this._broadcast.bind(this, 'work-completed'));
  }

  /**
   * Broadcast event to WebSocket clients
   */
  _broadcast(eventType, data) {
    const message = {
      type: eventType,
      data,
      timestamp: Date.now()
    };
    
    // Broadcast to all connected clients
    if (this.webSocketServer && this.webSocketServer.broadcast) {
      this.webSocketServer.broadcast(JSON.stringify(message));
    }
  }

  /**
   * Get initial state for new client
   */
  getInitialState() {
    return {
      workRows: this.activityView.getWorkRows(),
      summary: this.activityView.getSummary(),
      recentEvents: this.activityView.getAllEvents(20)
    };
  }
}

module.exports = {
  AgentActivityView,
  AgentActivityStreamer,
  AgentWorkState
};

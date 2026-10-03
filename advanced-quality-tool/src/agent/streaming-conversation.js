/**
 * Streaming Conversation, Cancellation, and Session History
 * Task: P9-T016
 * 
 * Streams model text, plan updates, tool calls, approvals, and verification results.
 * Supports stopping active runs, cancelling pending work, retrying failed steps.
 * Persists and restores named conversation sessions.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * Event types for streaming conversation
 */
const EventTypes = {
  // Model events
  MODEL_START: 'model-start',
  MODEL_TOKEN: 'model-token',
  MODEL_COMPLETE: 'model-complete',
  MODEL_ERROR: 'model-error',
  
  // Plan events
  PLAN_CREATED: 'plan-created',
  PLAN_UPDATED: 'plan-updated',
  PLAN_STEP_START: 'plan-step-start',
  PLAN_STEP_COMPLETE: 'plan-step-complete',
  
  // Tool events
  TOOL_CALL: 'tool-call',
  TOOL_RESULT: 'tool-result',
  TOOL_ERROR: 'tool-error',
  
  // Approval events
  APPROVAL_REQUIRED: 'approval-required',
  APPROVAL_GRANTED: 'approval-granted',
  APPROVAL_DENIED: 'approval-denied',
  
  // Verification events
  VERIFICATION_START: 'verification-start',
  VERIFICATION_RESULT: 'verification-result',
  
  // Session events
  SESSION_START: 'session-start',
  SESSION_END: 'session-end',
  SESSION_CANCEL: 'session-cancel',
  SESSION_RETRY: 'session-retry'
};

/**
 * Represents a single conversation event
 */
class ConversationEvent {
  constructor(type, data = {}) {
    this.id = crypto.randomBytes(16).toString('hex');
    this.type = type;
    this.timestamp = Date.now();
    this.data = data;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      timestamp: this.timestamp,
      data: this.data
    };
  }

  static fromJSON(json) {
    const event = new ConversationEvent(json.type, json.data);
    event.id = json.id;
    event.timestamp = json.timestamp;
    return event;
  }
}

/**
 * Manages cancellation state for active operations
 */
class CancellationController {
  constructor() {
    this.cancelled = false;
    this.reason = null;
    this.abortController = new AbortController();
  }

  cancel(reason = 'User requested cancellation') {
    this.cancelled = true;
    this.reason = reason;
    this.abortController.abort(reason);
  }

  checkCancelled() {
    if (this.cancelled) {
      const error = new Error(this.reason);
      error.code = 'CANCELLED';
      error.cancelled = true;
      throw error;
    }
  }

  get signal() {
    return this.abortController.signal;
  }

  reset() {
    this.cancelled = false;
    this.reason = null;
    this.abortController = new AbortController();
  }
}

/**
 * Represents a conversation session
 */
class ConversationSession {
  constructor(id, workspace, options = {}) {
    this.id = id;
    this.workspace = workspace;
    this.model = options.model || null;
    this.provider = options.provider || null;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.events = [];
    this.context = {
      task: null,
      files: [],
      references: []
    };
    this.changes = {
      applied: [],
      rejected: [],
      failed: []
    };
    this.status = 'active'; // active, cancelled, completed, failed
    this.metadata = {};
  }

  addEvent(event) {
    this.events.push(event);
    this.updatedAt = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      workspace: this.workspace,
      model: this.model,
      provider: this.provider,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      events: this.events.map(e => e.toJSON()),
      context: this.context,
      changes: this.changes,
      status: this.status,
      metadata: this.metadata
    };
  }

  static fromJSON(json) {
    const session = new ConversationSession(json.id, json.workspace, {
      model: json.model,
      provider: json.provider
    });
    session.createdAt = json.createdAt;
    session.updatedAt = json.updatedAt;
    session.events = json.events.map(e => ConversationEvent.fromJSON(e));
    session.context = json.context;
    session.changes = json.changes;
    session.status = json.status;
    session.metadata = json.metadata;
    return session;
  }
}

/**
 * Session persistence manager
 */
class SessionPersistence {
  constructor(storageDir = '.aqt-sessions') {
    this.storageDir = storageDir;
  }

  ensureStorageDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  save(session) {
    this.ensureStorageDir();
    const sessionPath = path.join(this.storageDir, `${session.id}.json`);
    fs.writeFileSync(sessionPath, JSON.stringify(session.toJSON(), null, 2));
    return sessionPath;
  }

  load(sessionId) {
    const sessionPath = path.join(this.storageDir, `${sessionId}.json`);
    if (!fs.existsSync(sessionPath)) {
      return null;
    }
    
    const json = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    return ConversationSession.fromJSON(json);
  }

  list(workspace = null) {
    this.ensureStorageDir();
    const files = fs.readdirSync(this.storageDir).filter(f => f.endsWith('.json'));
    
    const sessions = [];
    for (const file of files) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(this.storageDir, file), 'utf8'));
        const session = ConversationSession.fromJSON(json);
        
        if (!workspace || session.workspace === workspace) {
          sessions.push({
            id: session.id,
            workspace: session.workspace,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            status: session.status
          });
        }
      } catch (error) {
        // Skip corrupted sessions
      }
    }
    
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  delete(sessionId) {
    const sessionPath = path.join(this.storageDir, `${sessionId}.json`);
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
      return true;
    }
    return false;
  }
}

/**
 * Main Streaming Conversation Manager
 */
class StreamingConversationManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.persistence = new SessionPersistence(options.storageDir);
    this.activeSession = null;
    this.cancellationController = null;
    this.retryCount = 0;
    this.maxRetries = options.maxRetries || 3;
    
    // Event streaming
    this.eventBuffer = [];
    this.maxBufferSize = options.maxBufferSize || 1000;
  }

  /**
   * Start a new conversation session
   */
  startSession(workspace, options = {}) {
    const sessionId = options.sessionId || `session-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    this.activeSession = new ConversationSession(sessionId, workspace, options);
    this.cancellationController = new CancellationController();
    this.retryCount = 0;
    
    const event = new ConversationEvent(EventTypes.SESSION_START, {
      sessionId,
      workspace,
      model: options.model,
      provider: options.provider
    });
    
    this.activeSession.addEvent(event);
    this.emitEvent(event);
    this.persistence.save(this.activeSession);
    
    return this.activeSession;
  }

  /**
   * Emit event to stream and buffer
   */
  emitEvent(event) {
    this.eventBuffer.push(event);
    
    // Trim buffer if too large
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }
    
    this.emit(event.type, event);
    this.emit('event', event);
  }

  /**
   * Stream model output
   */
  streamModelToken(token) {
    if (!this.activeSession) return;
    
    this.cancellationController?.checkCancelled();
    
    const event = new ConversationEvent(EventTypes.MODEL_TOKEN, { token });
    this.activeSession.addEvent(event);
    this.emitEvent(event);
  }

  /**
   * Complete model output
   */
  completeModelOutput(fullText, metadata = {}) {
    if (!this.activeSession) return;
    
    const event = new ConversationEvent(EventTypes.MODEL_COMPLETE, {
      text: fullText,
      ...metadata
    });
    
    this.activeSession.addEvent(event);
    this.emitEvent(event);
    this.persistence.save(this.activeSession);
  }

  /**
   * Record tool call
   */
  recordToolCall(toolName, args) {
    if (!this.activeSession) return;
    
    const event = new ConversationEvent(EventTypes.TOOL_CALL, {
      tool: toolName,
      args: args
    });
    
    this.activeSession.addEvent(event);
    this.emitEvent(event);
    return event.id;
  }

  /**
   * Record tool result
   */
  recordToolResult(eventId, result) {
    if (!this.activeSession) return;
    
    const event = new ConversationEvent(EventTypes.TOOL_RESULT, {
      callEventId: eventId,
      result
    });
    
    this.activeSession.addEvent(event);
    this.emitEvent(event);
  }

  /**
   * Request approval
   */
  requestApproval(operation, details) {
    if (!this.activeSession) return null;
    
    const event = new ConversationEvent(EventTypes.APPROVAL_REQUIRED, {
      operation,
      details
    });
    
    this.activeSession.addEvent(event);
    this.emitEvent(event);
    
    // Return a promise that resolves when approval is granted or denied
    return new Promise((resolve, reject) => {
      const handler = (approvalEvent) => {
        if (approvalEvent.data.operation === operation) {
          this.removeListener(EventTypes.APPROVAL_GRANTED, handler);
          this.removeListener(EventTypes.APPROVAL_DENIED, handler);
          
          if (approvalEvent.type === EventTypes.APPROVAL_GRANTED) {
            resolve(true);
          } else {
            reject(new Error('Approval denied'));
          }
        }
      };
      
      this.on(EventTypes.APPROVAL_GRANTED, handler);
      this.on(EventTypes.APPROVAL_DENIED, handler);
    });
  }

  /**
   * Grant approval
   */
  grantApproval(operation) {
    const event = new ConversationEvent(EventTypes.APPROVAL_GRANTED, { operation });
    this.activeSession?.addEvent(event);
    this.emitEvent(event);
  }

  /**
   * Deny approval
   */
  denyApproval(operation, reason) {
    const event = new ConversationEvent(EventTypes.APPROVAL_DENIED, {
      operation,
      reason
    });
    this.activeSession?.addEvent(event);
    this.emitEvent(event);
  }

  /**
   * Cancel active session
   */
  cancel(reason = 'User cancelled') {
    if (!this.activeSession || !this.cancellationController) {
      return false;
    }
    
    this.cancellationController.cancel(reason);
    
    const event = new ConversationEvent(EventTypes.SESSION_CANCEL, {
      reason,
      retryCount: this.retryCount
    });
    
    this.activeSession.addEvent(event);
    this.emitEvent(event);
    this.activeSession.status = 'cancelled';
    this.persistence.save(this.activeSession);
    
    return true;
  }

  /**
   * Retry from last checkpoint
   */
  async retry() {
    if (!this.activeSession) {
      throw new Error('No active session to retry');
    }
    
    if (this.retryCount >= this.maxRetries) {
      throw new Error(`Maximum retries (${this.maxRetries}) exceeded`);
    }
    
    this.retryCount++;
    
    // Reset cancellation controller
    this.cancellationController = new CancellationController();
    
    const event = new ConversationEvent(EventTypes.SESSION_RETRY, {
      retryCount: this.retryCount,
      maxRetries: this.maxRetries
    });
    
    this.activeSession.addEvent(event);
    this.emitEvent(event);
    
    return this.retryCount;
  }

  /**
   * End current session
   */
  endSession(status = 'completed') {
    if (!this.activeSession) return;
    
    const event = new ConversationEvent(EventTypes.SESSION_END, { status });
    this.activeSession.addEvent(event);
    this.activeSession.status = status;
    
    this.emitEvent(event);
    this.persistence.save(this.activeSession);
    
    const session = this.activeSession;
    this.activeSession = null;
    this.cancellationController = null;
    this.eventBuffer = [];
    
    return session;
  }

  /**
   * Restore session from persistence
   */
  restoreSession(sessionId) {
    const session = this.persistence.load(sessionId);
    
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    this.activeSession = session;
    this.cancellationController = new CancellationController();
    this.eventBuffer = session.events.slice(-this.maxBufferSize);
    
    return session;
  }

  /**
   * List available sessions
   */
  listSessions(workspace = null) {
    return this.persistence.list(workspace);
  }

  /**
   * Get session history
   */
  getSessionHistory(sessionId = null) {
    if (sessionId) {
      return this.persistence.load(sessionId);
    }
    
    if (this.activeSession) {
      return this.activeSession;
    }
    
    return null;
  }

  /**
   * Record file change
   */
  recordChange(filePath, changeType, details = {}) {
    if (!this.activeSession) return;
    
    const change = {
      path: filePath,
      type: changeType, // 'applied', 'rejected', 'failed'
      timestamp: Date.now(),
      ...details
    };
    
    this.activeSession.changes[changeType].push(change);
    this.persistence.save(this.activeSession);
  }

  /**
   * Check if session is active
   */
  isActive() {
    return this.activeSession !== null && this.activeSession.status === 'active';
  }

  /**
   * Check if cancellation was requested
   */
  isCancelled() {
    return this.cancellationController?.cancelled || false;
  }

  /**
   * Get cancellation signal for async operations
   */
  getCancellationSignal() {
    return this.cancellationController?.signal;
  }
}

module.exports = {
  StreamingConversationManager,
  ConversationSession,
  ConversationEvent,
  CancellationController,
  SessionPersistence,
  EventTypes
};

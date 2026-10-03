/**
 * Chat UI and WebSocket Interaction Pipeline (P9-T036)
 *
 * Defines message, progress, approval, error, cancellation, and result event contracts
 * for the chat UI and websocket server.
 *
 * @module pipelines/chat-interaction-pipeline
 */

'use strict';

const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');
const crypto = require('crypto');

/**
 * Message types
 */
const MessageType = {
  REQUEST: 'request',
  RESPONSE: 'response',
  PROGRESS: 'progress',
  APPROVAL: 'approval',
  ERROR: 'error',
  CANCEL: 'cancel',
  RESULT: 'result',
  HEARTBEAT: 'heartbeat'
};

/**
 * Connection states
 */
const ConnectionState = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error'
};

/**
 * Chat Interaction Pipeline
 */
class ChatInteractionPipeline {
  constructor(options = {}) {
    this.executor = options.executor || new PipelineExecutor();
    
    // Configuration
    this.sessionTimeout = options.sessionTimeout || 30 * 60 * 1000; // 30 minutes
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectDelay = options.reconnectDelay || 1000;
    
    // State
    this.sessions = new Map();
    this.connections = new Map();
    this.messageQueue = new Map();
    
    // Handlers
    this.onMessage = options.onMessage || null;
    this.onProgress = options.onProgress || null;
    this.onApproval = options.onApproval || null;
    this.onError = options.onError || null;
  }

  /**
   * Execute chat interaction pipeline
   * @param {Object} params
   * @param {Object} params.message - Incoming message
   * @param {Object} params.session - Session context
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const { message, session } = params;

    const stageHandlers = {
      'connect': async (ctx) => this._connect(ctx, session),
      'authenticate-session': async (ctx) => this._authenticateSession(ctx, session),
      'receive-message': async (ctx) => this._receiveMessage(ctx, message),
      'route-command': async (ctx) => this._routeCommand(ctx),
      'stream-progress': async (ctx) => this._streamProgress(ctx),
      'request-approval': async (ctx) => this._requestApproval(ctx),
      'publish-result': async (ctx) => this._publishResult(ctx),
      'disconnect-or-resume': async (ctx) => this._disconnectOrResume(ctx)
    };

    const result = await this.executor.execute('chat-interaction', {
      input: { message, session },
      workspace: session?.workspace,
      context: { sessionId: session?.id },
      stageHandlers
    });

    return result;
  }

  /**
   * Create a new session
   * @param {Object} options
   * @returns {Object}
   */
  createSession(options = {}) {
    const sessionId = this._generateSessionId();
    
    const session = {
      id: sessionId,
      workspace: options.workspace,
      userId: options.userId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      state: ConnectionState.CONNECTED,
      messageCount: 0,
      pipelineRuns: [],
      context: options.context || {}
    };
    
    this.sessions.set(sessionId, session);
    
    return session;
  }

  /**
   * Get session by ID
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Close a session
   * @param {string} sessionId
   */
  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = ConnectionState.DISCONNECTED;
      session.closedAt = Date.now();
    }
    
    // Clean up after timeout
    setTimeout(() => {
      this.sessions.delete(sessionId);
      this.messageQueue.delete(sessionId);
    }, this.sessionTimeout);
  }

  /**
   * Send a message
   * @param {string} sessionId
   * @param {Object} message
   */
  sendMessage(sessionId, message) {
    const queue = this.messageQueue.get(sessionId) || [];
    queue.push({
      ...message,
      timestamp: Date.now()
    });
    this.messageQueue.set(sessionId, queue);
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _connect(ctx, session) {
    const sessionId = session?.id;
    
    if (!sessionId) {
      return {
        connected: false,
        reason: 'No session ID provided'
      };
    }
    
    const existingSession = this.sessions.get(sessionId);
    
    if (existingSession) {
      existingSession.state = ConnectionState.CONNECTED;
      existingSession.lastActivity = Date.now();
      
      return {
        connected: true,
        resumed: true,
        session: existingSession
      };
    }
    
    return {
      connected: true,
      resumed: false,
      session: null
    };
  }

  async _authenticateSession(ctx, session) {
    const sessionId = session?.id;
    const existingSession = this.sessions.get(sessionId);
    
    if (!existingSession) {
      return {
        authenticated: false,
        reason: 'Session not found'
      };
    }
    
    // Check session timeout
    const inactiveTime = Date.now() - existingSession.lastActivity;
    if (inactiveTime > this.sessionTimeout) {
      existingSession.state = ConnectionState.DISCONNECTED;
      
      return {
        authenticated: false,
        reason: 'Session expired'
      };
    }
    
    existingSession.lastActivity = Date.now();
    
    return {
      authenticated: true,
      session: existingSession
    };
  }

  async _receiveMessage(ctx, message) {
    if (!message) {
      return {
        received: false,
        reason: 'No message provided'
      };
    }
    
    const validated = this._validateMessage(message);
    
    if (!validated.valid) {
      return {
        received: false,
        reason: validated.reason
      };
    }
    
    // Update session message count
    const session = ctx.context?.session;
    if (session) {
      session.messageCount++;
    }
    
    return {
      received: true,
      message: validated.message,
      type: message.type || MessageType.REQUEST
    };
  }

  async _routeCommand(ctx) {
    const { message, type } = ctx.previousResults?.['receive-message'] || {};
    
    if (!message) {
      return { routed: false };
    }
    
    const command = message.command || message.action;
    
    // Route based on command
    const route = this._determineRoute(command, message);
    
    return {
      routed: true,
      command,
      route,
      requiresApproval: route.requiresApproval
    };
  }

  async _streamProgress(ctx) {
    const { route } = ctx.previousResults?.['route-command'] || {};
    
    // Simulate progress streaming
    const progressEvents = [];
    
    if (route?.stages) {
      for (let i = 0; i < route.stages.length; i++) {
        const event = {
          stage: route.stages[i],
          progress: (i + 1) / route.stages.length,
          status: 'running'
        };
        
        progressEvents.push(event);
        
        // Call progress handler
        if (this.onProgress) {
          this.onProgress(event);
        }
      }
    }
    
    return {
      streamed: true,
      events: progressEvents
    };
  }

  async _requestApproval(ctx) {
    const { requiresApproval } = ctx.previousResults?.['route-command'] || {};
    
    if (!requiresApproval) {
      return {
        requiresApproval: false,
        approved: true
      };
    }
    
    // In a real implementation, this would wait for user input
    const approvalRequest = {
      id: this._generateApprovalId(),
      type: 'action-approval',
      message: 'Approval required for this action',
      options: ['approve', 'reject', 'modify']
    };
    
    // Call approval handler
    if (this.onApproval) {
      const decision = await this.onApproval(approvalRequest);
      return {
        requiresApproval: true,
        approved: decision.approved,
        decision
      };
    }
    
    return {
      requiresApproval: true,
      approved: false,
      reason: 'No approval handler configured'
    };
  }

  async _publishResult(ctx) {
    const { message } = ctx.previousResults?.['receive-message'] || {};
    const { route } = ctx.previousResults?.['route-command'] || {};
    const { approved } = ctx.previousResults?.['request-approval'] || {};
    
    const result = {
      success: approved !== false,
      type: MessageType.RESULT,
      data: {
        command: message?.command,
        action: route?.action,
        completedAt: Date.now()
      }
    };
    
    // Store result in session
    const session = ctx.context?.session;
    if (session) {
      session.pipelineRuns.push({
        runId: ctx.runId,
        timestamp: Date.now(),
        success: result.success
      });
    }
    
    return result;
  }

  async _disconnectOrResume(ctx) {
    const session = ctx.context?.session;
    
    if (session?.keepAlive) {
      return {
        action: 'resume',
        sessionId: session.id
      };
    }
    
    return {
      action: 'disconnect',
      reason: 'Session complete'
    };
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────────

  _generateSessionId() {
    return `session-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  _generateApprovalId() {
    return `approval-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  _validateMessage(message) {
    if (!message || typeof message !== 'object') {
      return { valid: false, reason: 'Message must be an object' };
    }
    
    if (!message.type) {
      return { valid: false, reason: 'Message must have a type' };
    }
    
    return { valid: true, message };
  }

  _determineRoute(command, message) {
    const routes = {
      'analyze': {
        action: 'analyze',
        stages: ['prepare', 'analyze', 'report'],
        requiresApproval: false
      },
      'fix': {
        action: 'fix',
        stages: ['select', 'backup', 'fix', 'verify'],
        requiresApproval: true
      },
      'generate': {
        action: 'generate',
        stages: ['plan', 'generate', 'review'],
        requiresApproval: true
      }
    };
    
    return routes[command] || {
      action: command || 'unknown',
      stages: ['execute'],
      requiresApproval: true
    };
  }
}

module.exports = {
  ChatInteractionPipeline,
  MessageType,
  ConnectionState
};

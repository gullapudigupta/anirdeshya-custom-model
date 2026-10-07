/**
 * Tests for Streaming Conversation System
 * Task: P9-T016
 */

const {
  StreamingConversationManager,
  ConversationSession,
  ConversationEvent,
  CancellationController,
  EventTypes
} = require('../../src/agent/streaming-conversation');

const fs = require('fs');
const path = require('path');
const os = require('os');

let TEST_DIR;
let STORAGE_DIR;

describe('ConversationEvent', () => {
  test('should create event with id and timestamp', () => {
    const event = new ConversationEvent(EventTypes.MODEL_TOKEN, { token: 'hello' });
    
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeLessThanOrEqual(Date.now());
    expect(event.type).toBe(EventTypes.MODEL_TOKEN);
    expect(event.data.token).toBe('hello');
  });

  test('should serialize to JSON', () => {
    const event = new ConversationEvent(EventTypes.MODEL_COMPLETE, { text: 'complete' });
    const json = event.toJSON();
    
    expect(json.id).toBe(event.id);
    expect(json.type).toBe(EventTypes.MODEL_COMPLETE);
    expect(json.data.text).toBe('complete');
  });

  test('should deserialize from JSON', () => {
    const original = new ConversationEvent(EventTypes.TOOL_CALL, { tool: 'test' });
    const json = original.toJSON();
    const restored = ConversationEvent.fromJSON(json);
    
    expect(restored.id).toBe(original.id);
    expect(restored.type).toBe(EventTypes.TOOL_CALL);
    expect(restored.data.tool).toBe('test');
  });
});

describe('CancellationController', () => {
  let controller;

  beforeEach(() => {
    controller = new CancellationController();
  });

  test('should start not cancelled', () => {
    expect(controller.cancelled).toBe(false);
    expect(controller.reason).toBeNull();
  });

  test('should cancel with reason', () => {
    controller.cancel('User requested');
    
    expect(controller.cancelled).toBe(true);
    expect(controller.reason).toBe('User requested');
  });

  test('should throw when checkCancelled called after cancel', () => {
    controller.cancel('Test cancellation');
    
    expect(() => controller.checkCancelled()).toThrow('Test cancellation');
  });

  test('should not throw when not cancelled', () => {
    expect(() => controller.checkCancelled()).not.toThrow();
  });

  test('should reset cancellation state', () => {
    controller.cancel('Test');
    controller.reset();
    
    expect(controller.cancelled).toBe(false);
    expect(controller.reason).toBeNull();
  });

  test('should provide abort signal', () => {
    const signal = controller.signal;
    
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);
    
    controller.cancel('Test');
    expect(signal.aborted).toBe(true);
  });
});

describe('ConversationSession', () => {
  test('should create session with id and workspace', () => {
    const session = new ConversationSession('test-id', '/test/workspace');
    
    expect(session.id).toBe('test-id');
    expect(session.workspace).toBe('/test/workspace');
    expect(session.status).toBe('active');
    expect(session.events).toEqual([]);
  });

  test('should add events', () => {
    const session = new ConversationSession('test', '/workspace');
    const event = new ConversationEvent(EventTypes.SESSION_START, {});
    
    session.addEvent(event);
    
    expect(session.events.length).toBe(1);
    expect(session.events[0]).toBe(event);
  });

  test('should serialize to JSON', () => {
    const session = new ConversationSession('test', '/workspace', { model: 'test-model' });
    const json = session.toJSON();
    
    expect(json.id).toBe('test');
    expect(json.workspace).toBe('/workspace');
    expect(json.model).toBe('test-model');
  });

  test('should deserialize from JSON', () => {
    const original = new ConversationSession('test', '/workspace');
    original.addEvent(new ConversationEvent(EventTypes.SESSION_START, {}));
    
    const json = original.toJSON();
    const restored = ConversationSession.fromJSON(json);
    
    expect(restored.id).toBe('test');
    expect(restored.events.length).toBe(1);
  });
});

describe('StreamingConversationManager', () => {
  let manager;

  beforeEach(() => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-streaming-test-'));
    STORAGE_DIR = path.join(TEST_DIR, '.sessions');
    
    manager = new StreamingConversationManager({
      storageDir: STORAGE_DIR,
      maxRetries: 3
    });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  test('should start a new session', () => {
    const session = manager.startSession('/workspace', { model: 'test-model' });
    
    expect(session).toBeDefined();
    expect(session.workspace).toBe('/workspace');
    expect(session.model).toBe('test-model');
    expect(manager.activeSession).toBe(session);
    expect(manager.isActive()).toBe(true);
  });

  test('should stream model tokens', (done) => {
    manager.startSession('/workspace');
    
    manager.on(EventTypes.MODEL_TOKEN, (event) => {
      expect(event.data.token).toBe('hello');
      done();
    });
    
    manager.streamModelToken('hello');
  });

  test('should complete model output', () => {
    manager.startSession('/workspace');
    
    manager.completeModelOutput('full text', { tokens: 10 });
    
    const lastEvent = manager.activeSession.events[manager.activeSession.events.length - 1];
    expect(lastEvent.type).toBe(EventTypes.MODEL_COMPLETE);
    expect(lastEvent.data.text).toBe('full text');
    expect(lastEvent.data.tokens).toBe(10);
  });

  test('should record tool calls', () => {
    manager.startSession('/workspace');
    
    const eventId = manager.recordToolCall('readFile', { path: '/test.js' });
    
    expect(eventId).toBeDefined();
    
    const lastEvent = manager.activeSession.events[manager.activeSession.events.length - 1];
    expect(lastEvent.type).toBe(EventTypes.TOOL_CALL);
    expect(lastEvent.data.tool).toBe('readFile');
  });

  test('should record tool results', () => {
    manager.startSession('/workspace');
    
    const callId = manager.recordToolCall('readFile', { path: '/test.js' });
    manager.recordToolResult(callId, { content: 'file content' });
    
    const events = manager.activeSession.events;
    expect(events[events.length - 1].type).toBe(EventTypes.TOOL_RESULT);
    expect(events[events.length - 1].data.callEventId).toBe(callId);
  });

  test('should cancel active session', () => {
    manager.startSession('/workspace');
    
    const result = manager.cancel('User cancelled');
    
    expect(result).toBe(true);
    expect(manager.isCancelled()).toBe(true);
    expect(manager.activeSession.status).toBe('cancelled');
  });

  test('should retry after cancellation', async () => {
    manager.startSession('/workspace');
    manager.cancel('Test');
    
    const retryCount = await manager.retry();
    
    expect(retryCount).toBe(1);
    expect(manager.isCancelled()).toBe(false);
  });

  test('should enforce max retries', async () => {
    manager = new StreamingConversationManager({
      storageDir: STORAGE_DIR,
      maxRetries: 2
    });
    
    manager.startSession('/workspace');
    
    await manager.retry();
    await manager.retry();
    
    await expect(manager.retry()).rejects.toThrow('Maximum retries');
  });

  test('should end session', () => {
    manager.startSession('/workspace');
    
    const session = manager.endSession('completed');
    
    expect(session.status).toBe('completed');
    expect(manager.activeSession).toBeNull();
    expect(manager.isActive()).toBe(false);
  });

  test('should persist and restore session', () => {
    manager.startSession('/workspace', { model: 'test-model' });
    manager.streamModelToken('test');
    manager.completeModelOutput('complete');
    
    const sessionId = manager.activeSession.id;
    manager.endSession();
    
    const restored = manager.restoreSession(sessionId);
    
    expect(restored.id).toBe(sessionId);
    expect(restored.model).toBe('test-model');
    expect(manager.activeSession).toBe(restored);
  });

  test('should list sessions', () => {
    manager.startSession('/workspace1');
    manager.endSession();
    
    manager.startSession('/workspace2');
    manager.endSession();
    
    const sessions = manager.listSessions();
    
    expect(sessions.length).toBe(2);
  });

  test('should filter sessions by workspace', () => {
    manager.startSession('/workspace1');
    manager.endSession();
    
    manager.startSession('/workspace2');
    manager.endSession();
    
    const sessions = manager.listSessions('/workspace1');
    
    expect(sessions.length).toBe(1);
    expect(sessions[0].workspace).toBe('/workspace1');
  });

  test('should record file changes', () => {
    manager.startSession('/workspace');
    
    manager.recordChange('/file1.js', 'applied', { additions: 5 });
    manager.recordChange('/file2.js', 'rejected', { reason: 'User rejected' });
    
    expect(manager.activeSession.changes.applied.length).toBe(1);
    expect(manager.activeSession.changes.rejected.length).toBe(1);
  });

  test('should buffer events', () => {
    manager = new StreamingConversationManager({
      storageDir: STORAGE_DIR,
      maxBufferSize: 5
    });
    
    manager.startSession('/workspace');
    
    for (let i = 0; i < 10; i++) {
      manager.streamModelToken(`token-${i}`);
    }
    
    expect(manager.eventBuffer.length).toBe(5);
  });

  test('should handle approval request', async () => {
    manager.startSession('/workspace');
    
    const approvalPromise = manager.requestApproval('write-file', {
      path: '/test.js',
      content: 'new content'
    });
    
    // Simulate approval
    setTimeout(() => manager.grantApproval('write-file'), 10);
    
    const result = await approvalPromise;
    expect(result).toBe(true);
  });

  test('should handle approval denial', async () => {
    manager.startSession('/workspace');
    
    const approvalPromise = manager.requestApproval('write-file', {
      path: '/test.js'
    });
    
    // Simulate denial
    setTimeout(() => manager.denyApproval('write-file', 'User denied'), 10);
    
    await expect(approvalPromise).rejects.toThrow('Approval denied');
  });
});

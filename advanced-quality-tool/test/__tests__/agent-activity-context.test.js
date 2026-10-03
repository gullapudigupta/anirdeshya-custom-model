/**
 * Agent Activity View and Context Assembler Tests (P9-T011, P9-T012)
 *
 * Tests for live work activity view, state management, and workspace context assembly.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { AgentActivityView, AgentWorkState } = require('../../src/ui/agent-activity-view');
const { ContextAssembler, ContextSourceType } = require('../../src/workspace/context-assembler');

// ─── Test Helpers ───────────────────────────────────────────────────────────────

function createTestWorkspace(name) {
  const testDir = path.join(__dirname, '..', '.fixtures', `activity-test-${name}-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  
  // Create sample files
  fs.writeFileSync(
    path.join(testDir, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0' }, null, 2)
  );
  
  fs.writeFileSync(
    path.join(testDir, 'AGENTS.md'),
    '# Agent Guidelines\n\nFollow these rules when coding.\n'
  );
  
  fs.writeFileSync(
    path.join(testDir, 'src'),
    'export function test() { return true; }\n'
  );
  
  fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(testDir, 'src', 'index.js'),
    'export function test() { return true; }\n'
  );
  
  return testDir;
}

function cleanupTestWorkspace(workspacePath) {
  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
}

// ─── Agent Activity View Tests (P9-T011) ────────────────────────────────────────

/**
 * Test: Work registration
 */
function test_workRegistration() {
  console.log('  Test: Work registration');
  
  const workspace = createTestWorkspace('work-reg');
  const view = new AgentActivityView({ workspace });
  
  try {
    const workItem = {
      id: 'work-123',
      taskId: 'task-456',
      taskName: 'Test Task',
      agent: 'test-agent',
      model: 'gpt-4o-mini'
    };
    
    const activity = view.registerWork(workItem);
    
    assert.strictEqual(activity.id, 'work-123', 'Should have correct ID');
    assert.strictEqual(activity.state, AgentWorkState.QUEUED, 'Should start in queued state');
    assert.strictEqual(activity.agent, 'test-agent', 'Should have correct agent');
    
    console.log('    ✓ Work registration works correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: State transitions
 */
function test_stateTransitions() {
  console.log('  Test: State transitions');
  
  const workspace = createTestWorkspace('state-trans');
  const view = new AgentActivityView({ workspace });
  
  try {
    const activity = view.registerWork({
      id: 'work-state-1',
      taskId: 'task-1'
    });
    
    // Valid transition: queued -> planning
    view.updateState('work-state-1', AgentWorkState.PLANNING);
    let updated = view.getWorkDetails('work-state-1');
    assert.strictEqual(updated.state, AgentWorkState.PLANNING, 'Should transition to planning');
    
    // Valid transition: planning -> working
    view.updateState('work-state-1', AgentWorkState.WORKING);
    
    // Valid transition: working -> verifying
    view.updateState('work-state-1', AgentWorkState.VERIFYING);
    
    // Valid transition: verifying -> completed
    view.updateState('work-state-1', AgentWorkState.COMPLETED);
    
    // Should be in history now
    const details = view.getWorkDetails('work-state-1');
    assert.ok(details, 'Should have work details in history');
    
    console.log('    ✓ State transitions work correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Invalid state transitions
 */
function test_invalidStateTransitions() {
  console.log('  Test: Invalid state transitions');
  
  const workspace = createTestWorkspace('invalid-trans');
  const view = new AgentActivityView({ workspace });
  
  try {
    view.registerWork({
      id: 'work-invalid-1',
      taskId: 'task-1'
    });
    
    // Invalid: queued -> completed (should go through planning/working)
    try {
      view.updateState('work-invalid-1', AgentWorkState.COMPLETED);
      assert.fail('Should have thrown error for invalid transition');
    } catch (error) {
      assert.ok(error.message.includes('Invalid state transition'), 'Should throw transition error');
    }
    
    console.log('    ✓ Invalid transitions are rejected');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Work rows
 */
function test_workRows() {
  console.log('  Test: Work rows');
  
  const workspace = createTestWorkspace('work-rows');
  const view = new AgentActivityView({ workspace });
  
  try {
    // Register multiple work items
    view.registerWork({ id: 'work-1', taskId: 'task-1', taskName: 'Task 1' });
    view.registerWork({ id: 'work-2', taskId: 'task-2', taskName: 'Task 2' });
    view.registerWork({ id: 'work-3', taskId: 'task-3', taskName: 'Task 3' });
    
    const rows = view.getWorkRows();
    
    assert.strictEqual(rows.length, 3, 'Should have 3 work rows');
    assert.ok(rows[0].id, 'Row should have ID');
    assert.ok(rows[0].state, 'Row should have state');
    assert.ok(typeof rows[0].elapsedTime === 'number', 'Row should have elapsed time');
    
    console.log('    ✓ Work rows formatted correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Tool activity
 */
function test_toolActivity() {
  console.log('  Test: Tool activity');
  
  const workspace = createTestWorkspace('tool-activity');
  const view = new AgentActivityView({ workspace });
  
  try {
    view.registerWork({ id: 'work-tool-1', taskId: 'task-1' });
    
    view.addToolActivity('work-tool-1', {
      tool: 'file-read',
      action: 'read',
      input: { path: 'src/index.js' },
      output: { content: 'file contents' },
      success: true,
      duration: 50
    });
    
    const events = view.getEventStream('work-tool-1');
    assert.strictEqual(events.length, 1, 'Should have 1 event');
    assert.strictEqual(events[0].tool, 'file-read', 'Event should have tool name');
    
    console.log('    ✓ Tool activity tracked correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Sensitive data redaction
 */
function test_sensitiveDataRedaction() {
  console.log('  Test: Sensitive data redaction');
  
  const workspace = createTestWorkspace('redaction');
  const view = new AgentActivityView({ workspace });
  
  try {
    view.registerWork({ id: 'work-redact-1', taskId: 'task-1' });
    
    view.addToolActivity('work-redact-1', {
      tool: 'api-call',
      input: { apiKey: 'secret-key-12345', token: 'bearer-token' },
      output: { data: 'response' }
    });
    
    const events = view.getEventStream('work-redact-1');
    assert.strictEqual(events[0].input.apiKey, '[REDACTED]', 'API key should be redacted');
    assert.strictEqual(events[0].input.token, '[REDACTED]', 'Token should be redacted');
    assert.strictEqual(events[0].output.data, 'response', 'Non-sensitive data should not be redacted');
    
    console.log('    ✓ Sensitive data redacted correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Summary statistics
 */
function test_summaryStatistics() {
  console.log('  Test: Summary statistics');
  
  const workspace = createTestWorkspace('summary');
  const view = new AgentActivityView({ workspace });
  
  try {
    view.registerWork({ id: 'work-sum-1', taskId: 'task-1' });
    view.registerWork({ id: 'work-sum-2', taskId: 'task-2' });
    view.updateState('work-sum-1', AgentWorkState.PLANNING);
    
    const summary = view.getSummary();
    
    assert.strictEqual(summary.active, 2, 'Should have 2 active work items');
    assert.strictEqual(summary.states[AgentWorkState.QUEUED], 1, 'Should have 1 queued');
    assert.strictEqual(summary.states[AgentWorkState.PLANNING], 1, 'Should have 1 planning');
    
    console.log('    ✓ Summary statistics correct');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

// ─── Context Assembler Tests (P9-T012) ──────────────────────────────────────────

/**
 * Test: Current file attachment
 */
function test_currentFileAttachment() {
  console.log('  Test: Current file attachment');
  
  const workspace = createTestWorkspace('current-file');
  const assembler = new ContextAssembler({ workspace });
  
  try {
    const source = assembler.attachCurrentFile('src/index.js');
    
    assert.strictEqual(source.type, ContextSourceType.CURRENT_FILE, 'Should be current file type');
    assert.ok(source.content, 'Should have content');
    assert.ok(source.estimatedTokens > 0, 'Should estimate tokens');
    assert.strictEqual(source.language, 'javascript', 'Should detect JavaScript');
    
    console.log('    ✓ Current file attached correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Editor selection attachment
 */
function test_editorSelectionAttachment() {
  console.log('  Test: Editor selection attachment');
  
  const workspace = createTestWorkspace('editor-sel');
  const assembler = new ContextAssembler({ workspace });
  
  try {
    const source = assembler.attachEditorSelection('src/index.js', {
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 10
    });
    
    assert.strictEqual(source.type, ContextSourceType.EDITOR_SELECTION, 'Should be editor selection type');
    assert.ok(source.range, 'Should have range');
    assert.strictEqual(source.range.startLine, 1, 'Should have correct start line');
    
    console.log('    ✓ Editor selection attached correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Diagnostics attachment
 */
function test_diagnosticsAttachment() {
  console.log('  Test: Diagnostics attachment');
  
  const workspace = createTestWorkspace('diagnostics');
  const assembler = new ContextAssembler({ workspace });
  
  try {
    const diagnostics = [
      { file: 'src/index.js', line: 5, severity: 'error', message: 'Missing semicolon' },
      { file: 'src/index.js', line: 10, severity: 'warning', message: 'Unused variable' }
    ];
    
    const source = assembler.attachDiagnostics(diagnostics);
    
    assert.strictEqual(source.type, ContextSourceType.DIAGNOSTICS, 'Should be diagnostics type');
    assert.strictEqual(source.count, 2, 'Should have 2 diagnostics');
    assert.ok(source.content, 'Should have formatted content');
    
    console.log('    ✓ Diagnostics attached correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Repository guidance loading
 */
function test_repositoryGuidanceLoading() {
  console.log('  Test: Repository guidance loading');
  
  const workspace = createTestWorkspace('guidance');
  const assembler = new ContextAssembler({ workspace });
  
  try {
    const guidance = assembler.loadRepositoryGuidance();
    
    assert.strictEqual(guidance.type, ContextSourceType.REPOSITORY_GUIDANCE, 'Should be guidance type');
    assert.ok(guidance.count >= 1, 'Should load at least one guidance file');
    assert.ok(guidance.applied.includes('AGENTS.md'), 'Should apply AGENTS.md');
    assert.ok(guidance.estimatedTokens > 0, 'Should estimate tokens');
    
    console.log('    ✓ Repository guidance loaded correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Workspace search
 */
async function test_workspaceSearch() {
  console.log('  Test: Workspace search');
  
  const workspace = createTestWorkspace('search');
  
  // Create a file with searchable content
  fs.writeFileSync(
    path.join(workspace, 'src', 'searchable.js'),
    'function findMe() { return "search target"; }\n'
  );
  
  const assembler = new ContextAssembler({ workspace });
  
  try {
    const results = await assembler.searchWorkspace('findMe');
    
    assert.strictEqual(results.type, ContextSourceType.WORKSPACE_SEARCH, 'Should be search type');
    assert.ok(results.count >= 1, 'Should find at least 1 result');
    assert.ok(results.results[0].content.includes('findMe'), 'Result should contain search term');
    
    console.log('    ✓ Workspace search works correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Context assembly
 */
function test_contextAssembly() {
  console.log('  Test: Context assembly');
  
  const workspace = createTestWorkspace('assembly');
  const assembler = new ContextAssembler({ workspace });
  
  try {
    const context = assembler.assembleContext({
      currentFile: 'src/index.js',
      diagnostics: [
        { file: 'src/index.js', line: 1, severity: 'error', message: 'Test error' }
      ]
    });
    
    assert.ok(Array.isArray(context.sources), 'Should have sources array');
    assert.ok(context.estimatedTokens > 0, 'Should estimate total tokens');
    assert.ok(context.promptContext, 'Should build prompt context');
    assert.ok(context.guidanceApplied, 'Should show applied guidance');
    
    const summary = assembler.getContextSummary(context);
    assert.ok(Array.isArray(summary.sources), 'Summary should have sources');
    
    console.log('    ✓ Context assembly works correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Token budget management
 */
function test_tokenBudgetManagement() {
  console.log('  Test: Token budget management');
  
  const workspace = createTestWorkspace('budget');
  const assembler = new ContextAssembler({ 
    workspace,
    maxContextTokens: 100
  });
  
  try {
    // Create a large file
    const largeContent = 'x'.repeat(1000);
    fs.writeFileSync(path.join(workspace, 'large.js'), largeContent);
    
    const context = assembler.assembleContext({
      currentFile: 'large.js'
    });
    
    // Should have warning about budget
    assert.ok(context.warnings.length > 0, 'Should have budget warning');
    assert.ok(context.warnings[0].includes('token budget'), 'Warning should mention token budget');
    
    console.log('    ✓ Token budget managed correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Ignore rules
 */
function test_ignoreRules() {
  console.log('  Test: Ignore rules');
  
  const workspace = createTestWorkspace('ignore');
  
  // Create files that should be ignored
  fs.mkdirSync(path.join(workspace, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'node_modules', 'package.js'), 'content');
  fs.writeFileSync(path.join(workspace, '.env'), 'SECRET=value');
  
  const assembler = new ContextAssembler({ workspace });
  
  try {
    // Should reject ignored files
    try {
      assembler.attachExplicitFile('node_modules/package.js');
      assert.fail('Should have thrown error for ignored file');
    } catch (error) {
      assert.ok(error.message.includes('excluded'), 'Should reject ignored file');
    }
    
    try {
      assembler.attachExplicitFile('.env');
      assert.fail('Should have thrown error for ignored file');
    } catch (error) {
      assert.ok(error.message.includes('excluded'), 'Should reject ignored file');
    }
    
    console.log('    ✓ Ignore rules enforced correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

// ─── Run Tests ─────────────────────────────────────────────────────────────────

function runTests() {
  console.log('\n=== Agent Activity View Tests (P9-T011) ===\n');
  
  const fixturesDir = path.join(__dirname, '..', '.fixtures');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  
  let passed = 0;
  let failed = 0;
  
  try {
    // P9-T011 tests
    test_workRegistration();
    test_stateTransitions();
    test_invalidStateTransitions();
    test_workRows();
    test_toolActivity();
    test_sensitiveDataRedaction();
    test_summaryStatistics();
    passed += 7;
    
    console.log('\n=== Context Assembler Tests (P9-T012) ===\n');
    
    // P9-T012 tests
    test_currentFileAttachment();
    test_editorSelectionAttachment();
    test_diagnosticsAttachment();
    test_repositoryGuidanceLoading();
    test_workspaceSearch();
    test_contextAssembly();
    test_tokenBudgetManagement();
    test_ignoreRules();
    passed += 8;
    
    console.log('\n✅ All P9-T011 and P9-T012 tests passed!\n');
    return { passed, failed: 0 };
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    return { passed: 0, failed: 1, error: error.message };
  } finally {
    if (fs.existsSync(fixturesDir)) {
      const entries = fs.readdirSync(fixturesDir);
      for (const entry of entries) {
        const entryPath = path.join(fixturesDir, entry);
        if (fs.statSync(entryPath).isDirectory()) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        }
      }
    }
  }
}

module.exports = { runTests };

if (require.main === module) {
  runTests();
}

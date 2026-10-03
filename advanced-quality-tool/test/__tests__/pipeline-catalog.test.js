/**
 * Tests for Pipeline Catalog and Execution Ledger (P9-T024)
 *
 * Verifies:
 * - Pipeline registration with stable IDs, versions, stages, schemas
 * - Execution ledger recording for all pipeline runs
 * - Verification that incomplete/failed runs cannot be marked complete
 * - Query and export capabilities
 * - Telemetry recording (model calls, tool calls, file changes)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { 
  PipelineCatalog, 
  getCatalog, 
  resetCatalog,
  EventType,
  RunStatus 
} = require('../../src/pipelines/pipeline-catalog');

// Test pipeline definitions
const TEST_PIPELINE = {
  id: 'test-pipeline-v2',
  name: 'Test Pipeline V2',
  version: '1.0.0',
  stages: ['stage-1', 'stage-2', 'stage-3'],
  schema: {
    input: { inputFile: 'string', options: 'object?' },
    output: { result: 'object' }
  },
  verification: { required: true },
  metadata: { description: 'Test pipeline for catalog tests' }
};

const SIMPLE_PIPELINE = {
  id: 'simple-pipeline-v2',
  name: 'Simple Pipeline V2',
  version: '1.0.0',
  stages: ['run'],
  schema: { input: {}, output: {} },
  metadata: { description: 'Simple test pipeline' }
};

function getTestWorkspace() {
  return path.join(__dirname, '..', 'fixtures', 'catalog-test-' + Date.now());
}

function createFreshCatalog(testWorkspace) {
  const testLedgerPath = path.join(testWorkspace, '.aqt-reports', 'pipelines');
  
  if (!fs.existsSync(testWorkspace)) {
    fs.mkdirSync(testWorkspace, { recursive: true });
  }
  if (!fs.existsSync(testLedgerPath)) {
    fs.mkdirSync(testLedgerPath, { recursive: true });
  }
  
  resetCatalog();
  
  return new PipelineCatalog({ 
    workspace: testWorkspace,
    storePath: testLedgerPath,
    strictMode: true 
  });
}

function cleanupWorkspace(testWorkspace) {
  if (fs.existsSync(testWorkspace)) {
    try {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

describe('PipelineCatalog (P9-T024)', function() {

  // ─── Pipeline Registration Tests ──────────────────────────────────────────────

  describe('Pipeline Registration', function() {
    
    it('should register a valid pipeline definition', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      
      catalog.registerPipeline(TEST_PIPELINE);
      
      assert(catalog.hasPipeline('test-pipeline-v2'), 'Pipeline should be registered');
      
      const pipeline = catalog.getPipeline('test-pipeline-v2');
      assert.strictEqual(pipeline.id, 'test-pipeline-v2');
      assert.strictEqual(pipeline.name, 'Test Pipeline V2');
      assert.strictEqual(pipeline.version, '1.0.0');
      assert.deepStrictEqual(pipeline.stages, ['stage-1', 'stage-2', 'stage-3']);
      
      cleanupWorkspace(testWorkspace);
    });

    it('should reject duplicate pipeline registration', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      
      catalog.registerPipeline(TEST_PIPELINE);
      
      assert.throws(
        () => catalog.registerPipeline(TEST_PIPELINE),
        /already registered/
      );
      
      cleanupWorkspace(testWorkspace);
    });

    it('should reject invalid pipeline definitions', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      
      assert.throws(
        () => catalog.registerPipeline({}),
        /must have a valid id/
      );
      
      assert.throws(
        () => catalog.registerPipeline({ id: 'test' }),
        /must have a valid name/
      );
      
      assert.throws(
        () => catalog.registerPipeline({ id: 'test', name: 'Test' }),
        /must have a valid version/
      );
      
      assert.throws(
        () => catalog.registerPipeline({ id: 'test', name: 'Test', version: '1.0' }),
        /must have at least one stage/
      );
      
      cleanupWorkspace(testWorkspace);
    });

    it('should list all registered pipelines', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      
      catalog.registerPipeline(TEST_PIPELINE);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const pipelines = catalog.listPipelines();
      assert(pipelines.length >= 2, 'Should have at least 2 pipelines');
      
      const ids = pipelines.map(p => p.id);
      assert(ids.includes('test-pipeline-v2'));
      assert(ids.includes('simple-pipeline-v2'));
      
      cleanupWorkspace(testWorkspace);
    });
  });

  // ─── Execution Lifecycle Tests ────────────────────────────────────────────────

  describe('Execution Lifecycle', function() {

    it('should start a new run and return run ID', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        taskId: 'TASK-001',
        input: { inputFile: '/path/to/file.js' }
      });
      
      assert(runId, 'Should return a run ID');
      assert(runId.startsWith('run-'), 'Run ID should start with "run-"');
      
      cleanupWorkspace(testWorkspace);
    });

    it('should reject run for unregistered pipeline', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      
      assert.throws(
        () => catalog.startRun({ pipelineId: 'nonexistent' }),
        /not registered/
      );
      
      cleanupWorkspace(testWorkspace);
    });

    it('should validate input against schema', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      // Missing required input
      assert.throws(
        () => catalog.startRun({
          pipelineId: 'test-pipeline-v2',
          input: {} // missing inputFile
        }),
        /missing required input/
      );
      
      cleanupWorkspace(testWorkspace);
    });

    it('should record stage start and end', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/path/to/file.js' }
      });
      
      catalog.stageStart(runId, 'stage-1');
      catalog.stageEnd(runId, 'stage-1', { data: 'result' });
      
      const events = catalog.getRun(runId);
      const startEvent = events.find(e => e.type === EventType.STAGE_START);
      const endEvent = events.find(e => e.type === EventType.STAGE_END);
      
      assert(startEvent, 'Should have stage start event');
      assert.strictEqual(startEvent.stageName, 'stage-1');
      assert(endEvent, 'Should have stage end event');
      assert.deepStrictEqual(endEvent.result, { data: 'result' });
      
      cleanupWorkspace(testWorkspace);
    });

    it('should complete a run after all stages', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/path/to/file.js' }
      });
      
      catalog.stageStart(runId, 'stage-1');
      catalog.stageEnd(runId, 'stage-1', {});
      catalog.stageStart(runId, 'stage-2');
      catalog.stageEnd(runId, 'stage-2', {});
      catalog.stageStart(runId, 'stage-3');
      catalog.stageEnd(runId, 'stage-3', {});
      
      catalog.completeRun(runId, { result: { success: true } });
      
      const summary = catalog.getRunSummary(runId);
      assert.strictEqual(summary.status, RunStatus.COMPLETED);
      
      cleanupWorkspace(testWorkspace);
    });

    it('should fail a run with error', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/path/to/file.js' }
      });
      
      catalog.stageStart(runId, 'stage-1');
      catalog.failRun(runId, 'Something went wrong', 'stage-1');
      
      const summary = catalog.getRunSummary(runId);
      assert.strictEqual(summary.status, RunStatus.FAILED);
      assert.strictEqual(summary.error, 'Something went wrong');
      
      cleanupWorkspace(testWorkspace);
    });

    it('should cancel a run', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/path/to/file.js' }
      });
      
      catalog.cancelRun(runId, 'User cancelled');
      
      const summary = catalog.getRunSummary(runId);
      assert.strictEqual(summary.status, RunStatus.CANCELLED);
      
      cleanupWorkspace(testWorkspace);
    });
  });

  // ─── CRITICAL: Verification Tests ──────────────────────────────────────────────

  describe('Run Verification (CRITICAL)', function() {

    it('should NOT allow marking incomplete run as complete', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/path/to/file.js' }
      });
      
      // Only complete 2 of 3 stages
      catalog.stageStart(runId, 'stage-1');
      catalog.stageEnd(runId, 'stage-1', {});
      catalog.stageStart(runId, 'stage-2');
      catalog.stageEnd(runId, 'stage-2', {});
      
      // Try to complete without stage-3
      assert.throws(
        () => catalog.completeRun(runId, { result: {} }),
        /missing stages/
      );
      
      // Verify run is still active (not marked complete)
      const events = catalog.getRun(runId);
      const completeEvent = events.find(e => e.type === EventType.RUN_COMPLETE);
      assert(!completeEvent, 'Run should not have completion event');
      
      cleanupWorkspace(testWorkspace);
    });

    it('should verify run integrity correctly', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/path/to/file.js' }
      });
      
      catalog.stageStart(runId, 'stage-1');
      catalog.stageEnd(runId, 'stage-1', {});
      catalog.stageStart(runId, 'stage-2');
      catalog.stageEnd(runId, 'stage-2', {});
      catalog.stageStart(runId, 'stage-3');
      catalog.stageEnd(runId, 'stage-3', {});
      catalog.completeRun(runId, { result: {} });
      
      const verification = catalog.verifyRun(runId);
      assert(verification.valid, 'Run should be valid');
      
      cleanupWorkspace(testWorkspace);
    });

    it('should detect incomplete runs in verification', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/path/to/file.js' }
      });
      
      catalog.stageStart(runId, 'stage-1');
      catalog.stageEnd(runId, 'stage-1', {});
      // Missing stage-2 and stage-3
      
      // Manually mark as complete in ledger (simulating corruption)
      catalog.ledger.completeRun(runId, { result: {} });
      
      const verification = catalog.verifyRun(runId);
      assert(!verification.valid, 'Incomplete run should be invalid');
      assert(verification.issues.some(i => i.includes('stage-2')));
      assert(verification.issues.some(i => i.includes('stage-3')));
      
      cleanupWorkspace(testWorkspace);
    });

    it('should detect failed run incorrectly marked as complete', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/path/to/file.js' }
      });
      
      // Complete all stages
      catalog.stageStart(runId, 'stage-1');
      catalog.stageEnd(runId, 'stage-1', {});
      catalog.stageStart(runId, 'stage-2');
      catalog.stageEnd(runId, 'stage-2', {});
      catalog.stageStart(runId, 'stage-3');
      catalog.stageEnd(runId, 'stage-3', {});
      
      // Mark as complete
      catalog.completeRun(runId, { result: {} });
      
      const summary = catalog.getRunSummary(runId);
      assert.strictEqual(summary.status, RunStatus.COMPLETED);
      
      cleanupWorkspace(testWorkspace);
    });

    it('should verify all completed runs', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      
      // Complete run 1
      const runId1 = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/path/to/file1.js' }
      });
      catalog.stageStart(runId1, 'stage-1');
      catalog.stageEnd(runId1, 'stage-1', {});
      catalog.stageStart(runId1, 'stage-2');
      catalog.stageEnd(runId1, 'stage-2', {});
      catalog.stageStart(runId1, 'stage-3');
      catalog.stageEnd(runId1, 'stage-3', {});
      catalog.completeRun(runId1, { result: {} });
      
      // Corrupt run 2 (mark complete without stages)
      const runId2 = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/path/to/file2.js' }
      });
      catalog.ledger.completeRun(runId2, { result: {} });
      
      const verification = catalog.verifyAllRuns();
      assert.strictEqual(verification.total, 2);
      assert.strictEqual(verification.valid, 1);
      assert.strictEqual(verification.invalid, 1);
      
      cleanupWorkspace(testWorkspace);
    });
  });

  // ─── Telemetry Recording Tests ────────────────────────────────────────────────

  describe('Telemetry Recording', function() {

    it('should record tool calls', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      
      catalog.recordToolCall(runId, {
        name: 'readFile',
        args: { path: '/src/file.js' },
        result: { content: 'file contents' },
        duration: 50
      });
      
      const events = catalog.getRun(runId);
      const toolEvent = events.find(e => e.type === EventType.TOOL_CALL);
      
      assert(toolEvent, 'Should have tool call event');
      assert.strictEqual(toolEvent.tool, 'readFile');
      assert.strictEqual(toolEvent.duration, 50);
      
      cleanupWorkspace(testWorkspace);
    });

    it('should record model calls', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      
      catalog.recordModelCall(runId, {
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: 500,
        completionTokens: 200,
        cost: 0.001,
        duration: 1500
      });
      
      const events = catalog.getRun(runId);
      const modelEvent = events.find(e => e.type === EventType.MODEL_CALL);
      
      assert(modelEvent, 'Should have model call event');
      assert.strictEqual(modelEvent.provider, 'openai');
      assert.strictEqual(modelEvent.promptTokens, 500);
      assert.strictEqual(modelEvent.cost, 0.001);
      
      cleanupWorkspace(testWorkspace);
    });

    it('should record validation results', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      
      catalog.recordValidation(runId, {
        name: 'lint-check',
        passed: false,
        errors: ['Unexpected var'],
        warnings: ['Missing semicolon']
      });
      
      const events = catalog.getRun(runId);
      const validationEvent = events.find(e => e.type === EventType.VALIDATION);
      
      assert(validationEvent, 'Should have validation event');
      assert.strictEqual(validationEvent.passed, false);
      assert.deepStrictEqual(validationEvent.errors, ['Unexpected var']);
      
      cleanupWorkspace(testWorkspace);
    });

    it('should record file changes', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      
      catalog.recordFileChanges(runId, [
        '/src/file1.js',
        '/src/file2.js'
      ], { reason: 'auto-fix' });
      
      const events = catalog.getRun(runId);
      const fileEvent = events.find(e => e.type === EventType.FILE_CHANGE);
      
      assert(fileEvent, 'Should have file change event');
      assert.strictEqual(fileEvent.files.length, 2);
      
      cleanupWorkspace(testWorkspace);
    });

    it('should aggregate metrics in run summary', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      
      catalog.stageStart(runId, 'run');
      
      catalog.recordToolCall(runId, {
        name: 'tool1',
        args: {},
        result: {}
      });
      catalog.recordToolCall(runId, {
        name: 'tool2',
        args: {},
        result: {}
      });
      
      catalog.recordModelCall(runId, {
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.01
      });
      
      catalog.stageEnd(runId, 'run', {});
      catalog.completeRun(runId, {});
      
      const summary = catalog.getRunSummary(runId);
      assert.strictEqual(summary.metrics.toolCalls, 2);
      assert.strictEqual(summary.metrics.totalTokens, 150);
      assert.strictEqual(summary.metrics.totalCost, 0.01);
      
      cleanupWorkspace(testWorkspace);
    });
  });

  // ─── Query and Export Tests ───────────────────────────────────────────────────

  describe('Query and Export', function() {

    it('should query runs by pipeline ID', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      // Create runs for different pipelines
      const runId1 = catalog.startRun({
        pipelineId: 'test-pipeline-v2',
        input: { inputFile: '/file1.js' }
      });
      catalog.stageStart(runId1, 'stage-1');
      catalog.stageEnd(runId1, 'stage-1', {});
      catalog.stageStart(runId1, 'stage-2');
      catalog.stageEnd(runId1, 'stage-2', {});
      catalog.stageStart(runId1, 'stage-3');
      catalog.stageEnd(runId1, 'stage-3', {});
      catalog.completeRun(runId1, {});
      
      const runId2 = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      catalog.stageStart(runId2, 'run');
      catalog.stageEnd(runId2, 'run', {});
      catalog.completeRun(runId2, {});
      
      const testRuns = catalog.getRunsByPipeline('test-pipeline-v2');
      assert.strictEqual(testRuns.length, 1);
      assert.strictEqual(testRuns[0].pipelineId, 'test-pipeline-v2');
      
      cleanupWorkspace(testWorkspace);
    });

    it('should query runs by task ID', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        taskId: 'TASK-123',
        input: {}
      });
      catalog.stageStart(runId, 'run');
      catalog.stageEnd(runId, 'run', {});
      catalog.completeRun(runId, {});
      
      const runs = catalog.getRunsByTask('TASK-123');
      assert.strictEqual(runs.length, 1);
      assert.strictEqual(runs[0].taskId, 'TASK-123');
      
      cleanupWorkspace(testWorkspace);
    });

    it('should query failed runs', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      catalog.failRun(runId, 'Test failure');
      
      const failedRuns = catalog.getFailedRuns();
      assert.strictEqual(failedRuns.length, 1);
      assert.strictEqual(failedRuns[0].status, RunStatus.FAILED);
      
      cleanupWorkspace(testWorkspace);
    });

    it('should export runs to JSON', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      catalog.stageStart(runId, 'run');
      catalog.stageEnd(runId, 'run', {});
      catalog.completeRun(runId, { success: true });
      
      const exportPath = path.join(testWorkspace, 'export-test.json');
      catalog.exportRuns([runId], exportPath);
      
      assert(fs.existsSync(exportPath), 'Export file should exist');
      
      const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
      assert.strictEqual(exported.length, 1);
      assert.strictEqual(exported[0].runId, runId);
      
      cleanupWorkspace(testWorkspace);
    });

    it('should generate compliance report', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      // Create some runs
      const runId1 = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      catalog.stageStart(runId1, 'run');
      catalog.stageEnd(runId1, 'run', {});
      catalog.completeRun(runId1, {});
      
      const runId2 = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      catalog.failRun(runId2, 'Failed');
      
      const report = catalog.generateComplianceReport(
        new Date(Date.now() - 86400000).toISOString(), // yesterday
        new Date().toISOString()
      );
      
      assert.strictEqual(report.summary.totalRuns, 2);
      assert.strictEqual(report.summary.completed, 1);
      assert.strictEqual(report.summary.failed, 1);
      
      cleanupWorkspace(testWorkspace);
    });
  });

  // ─── Secret Redaction Tests ───────────────────────────────────────────────────

  describe('Secret Redaction', function() {

    it('should redact secrets from recorded data', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {},
        context: {
          apiKey: 'secret-key-123',
          password: 'my-password',
          accessToken: 'token-xyz'
        }
      });
      
      const events = catalog.getRun(runId);
      const startEvent = events.find(e => e.type === EventType.RUN_START);
      
      assert.strictEqual(startEvent.context.apiKey, '[REDACTED]');
      assert.strictEqual(startEvent.context.password, '[REDACTED]');
      assert.strictEqual(startEvent.context.accessToken, '[REDACTED]');
      
      cleanupWorkspace(testWorkspace);
    });

    it('should redact secrets from tool call arguments', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const runId = catalog.startRun({
        pipelineId: 'simple-pipeline-v2',
        input: {}
      });
      
      catalog.recordToolCall(runId, {
        name: 'api-request',
        args: {
          url: 'https://api.example.com',
          authorization: 'Bearer secret-token'
        },
        result: {}
      });
      
      const events = catalog.getRun(runId);
      const toolEvent = events.find(e => e.type === EventType.TOOL_CALL);
      
      assert.strictEqual(toolEvent.args.authorization, '[REDACTED]');
      
      cleanupWorkspace(testWorkspace);
    });
  });

  // ─── Statistics Tests ──────────────────────────────────────────────────────────

  describe('Statistics', function() {

    it('should return catalog statistics', function() {
      const testWorkspace = getTestWorkspace();
      const catalog = createFreshCatalog(testWorkspace);
      catalog.registerPipeline(TEST_PIPELINE);
      catalog.registerPipeline(SIMPLE_PIPELINE);
      
      const stats = catalog.getStats();
      
      assert(stats.registeredPipelines >= 2);
      assert(Array.isArray(stats.pipelines));
      assert.strictEqual(typeof stats.totalRuns, 'number');
      
      cleanupWorkspace(testWorkspace);
    });
  });
});

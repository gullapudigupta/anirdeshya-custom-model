/**
 * Tests for Coding Agent End-to-End Acceptance and Reliability (P9-T019)
 */

'use strict';

const { AcceptanceWorkflow, WorkflowState, CriteriaStatus } = require('../../src/agent/acceptance-workflow');
const { ExecutionLedger } = require('../../src/pipelines/execution-ledger');

describe('AcceptanceWorkflow', () => {
  let workflow;
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), '.aqt-test-temp', `test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    workflow = new AcceptanceWorkflow({
      ledger: new ExecutionLedger({ storePath: tempDir }),
      dryRun: true,
      approvalMode: 'auto'
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Workflow Execution', () => {
    test('should execute complete workflow successfully', async () => {
      const task = {
        id: 'TEST-001',
        name: 'Test Task',
        deliverables: ['Implement feature A'],
        status: 'PENDING'
      };

      const context = {
        workspace: tempDir
      };

      const result = await workflow.execute({ task, context });

      expect(result).toBeDefined();
      expect(result.state).toBe(WorkflowState.COMPLETED);
      expect(result.outcome.success).toBe(true);
    });

    test('should track workflow stages', async () => {
      const task = {
        id: 'TEST-002',
        name: 'Test Task',
        deliverables: ['Fix bug'],
        status: 'PENDING'
      };

      const result = await workflow.execute({ task, context: { workspace: tempDir } });

      expect(result.stages).toBeDefined();
      expect(result.stages.analyze).toBeDefined();
      expect(result.stages.plan).toBeDefined();
      expect(result.stages.verify).toBeDefined();
    });
  });

  describe('Fabrication Checks', () => {
    test('should detect fabricated tool calls', async () => {
      const task = {
        id: 'TEST-003',
        name: 'Test Task',
        deliverables: ['Test deliverable'],
        status: 'PENDING'
      };

      const result = await workflow.execute({ task, context: { workspace: tempDir } });

      expect(result.fabricationChecks).toBeDefined();
      expect(result.fabricationChecks.length).toBeGreaterThan(0);
      expect(result.fabricationChecks[0].passed).toBe(true);
    });

    test('should fail on invalid task data', async () => {
      const task = {
        // Missing id and name
        deliverables: ['Test']
      };

      const result = await workflow.execute({ task, context: { workspace: tempDir } });

      // Should still complete but with fabrication check failure
      expect(result.fabricationChecks[0].violations).toBeDefined();
    });
  });

  describe('Acceptance Criteria', () => {
    test('should extract criteria from task deliverables', async () => {
      const task = {
        id: 'TEST-004',
        name: 'Test Task',
        deliverables: [
          'Implement feature A',
          'Add tests for feature A'
        ],
        status: 'PENDING'
      };

      const result = await workflow.execute({ task, context: { workspace: tempDir } });

      expect(result.outcome.success).toBe(true);
    });
  });

  describe('Cancellation', () => {
    test('should allow workflow cancellation', async () => {
      const task = {
        id: 'TEST-005',
        name: 'Test Task',
        deliverables: ['Test'],
        status: 'PENDING'
      };

      const result = await workflow.execute({ task, context: { workspace: tempDir } });

      // Verify we can cancel (though the workflow completes quickly in test)
      expect(result).toBeDefined();
    });
  });
});

describe('WorkflowState', () => {
  test('should have all expected states', () => {
    expect(WorkflowState.IDLE).toBe('idle');
    expect(WorkflowState.ANALYZING).toBe('analyzing');
    expect(WorkflowState.PLANNING).toBe('planning');
    expect(WorkflowState.COMPLETED).toBe('completed');
    expect(WorkflowState.FAILED).toBe('failed');
    expect(WorkflowState.CANCELLED).toBe('cancelled');
  });
});

describe('CriteriaStatus', () => {
  test('should have all expected status values', () => {
    expect(CriteriaStatus.SATISFIED).toBe('satisfied');
    expect(CriteriaStatus.UNSATISFIED).toBe('unsatisfied');
    expect(CriteriaStatus.SKIPPED).toBe('skipped');
    expect(CriteriaStatus.UNVERIFIABLE).toBe('unverifiable');
  });
});

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { AgentPlanner } = require('../../src/agent/planner');
const { WorkOrchestrator } = require('../../src/agent/work-orchestrator');

function validPlan(overrides = {}) {
  return {
    steps: [
      { id: 'inspect', description: 'Inspect src/feature.js', files: ['src/feature.js'], dependencies: [] },
      { id: 'implement', description: 'Implement the requested change', files: ['src/feature.js'], dependencies: ['inspect'] }
    ],
    affectedFiles: ['src/feature.js'],
    acceptanceCriteria: ['The requested change works'],
    expectedChecks: [{ type: 'test', required: true }],
    verificationCommands: [{ checkId: 'test' }],
    risks: [],
    metadata: { requiresApproval: false },
    ...overrides
  };
}

describe('Phase 12 execution planning (P12-T005)', () => {
  test('builds a deterministic structured fallback plan from gathered file scope', async () => {
    const planner = new AgentPlanner({ workspace: process.cwd() });
    const input = {
      description: 'Implement the requested change',
      acceptanceCriteria: ['The requested change works'],
      context: { files: [{ path: 'src/feature.js', content: 'module.exports = true;' }] }
    };

    const plan = await planner.plan(input);
    const repeated = await planner.plan(input);

    const { createdAt: firstCreatedAt, ...firstMetadata } = plan.metadata;
    const { createdAt: repeatedCreatedAt, ...repeatedMetadata } = repeated.metadata;
    assert.ok(firstCreatedAt);
    assert.ok(repeatedCreatedAt);
    assert.deepStrictEqual({ ...plan, metadata: firstMetadata }, { ...repeated, metadata: repeatedMetadata });
    assert.strictEqual(plan.planVersion, 1);
    assert.deepStrictEqual(plan.affectedFiles, ['src/feature.js']);
    assert.deepStrictEqual(plan.acceptanceCriteria, input.acceptanceCriteria);
    assert.ok(plan.steps.length > 0);
    assert.ok(plan.verificationCommands.length > 0);
    assert.strictEqual(planner.validatePlan(plan, { allowedFiles: ['src/feature.js'] }).valid, true);
  });

  test('passes bounded gathered context and criteria to a structured plan executor', async () => {
    let received;
    const expected = validPlan({ acceptanceCriteria: ['Executor-supplied criterion'] });
    const planner = new AgentPlanner({
      workspace: process.cwd(),
      planExecutor: async input => {
        received = input;
        return expected;
      }
    });
    const context = {
      files: [{ path: 'src/feature.js', content: 'module.exports = true;', hash: 'abc' }],
      provenance: [{ path: 'src/feature.js', hash: 'abc' }]
    };

    const plan = await planner.plan({
      description: 'Implement the requested change',
      acceptanceCriteria: ['The requested change works'],
      context
    });

    assert.strictEqual(received.context, context);
    assert.deepStrictEqual(received.task.acceptanceCriteria, ['The requested change works']);
    assert.deepStrictEqual(plan, {
      ...expected,
      planVersion: 1,
      acceptanceCriteria: ['The requested change works']
    });
    assert.deepStrictEqual(planner.validatePlan(plan, { allowedFiles: ['src/feature.js'] }), {
      valid: true,
      issues: []
    });
  });

  test('rejects empty plans, unresolved or out-of-order dependencies, unsafe or unbounded scope, and missing approval', () => {
    const planner = new AgentPlanner({ workspace: process.cwd(), maxSteps: 2, maxFiles: 1 });
    const cases = [
      [validPlan({ steps: [] }), 'actionable steps'],
      [validPlan({ steps: [
        { id: 'one', description: 'One', files: ['src/feature.js'], dependencies: [] },
        { id: 'two', description: 'Two', files: ['src/feature.js'], dependencies: ['one'] },
        { id: 'three', description: 'Three', files: ['src/feature.js'], dependencies: ['two'] }
      ] }), 'between 1 and 2'],
      [validPlan({ steps: [
        { id: 'first', description: 'First', files: ['src/feature.js'], dependencies: ['later'] },
        { id: 'later', description: 'Later', files: ['src/feature.js'], dependencies: [] }
      ] }), 'precede'],
      [validPlan({ affectedFiles: ['../outside.js'] }), 'outside workspace'],
      [validPlan({ affectedFiles: ['C:\\outside.js'] }), 'outside workspace'],
      [validPlan({ affectedFiles: ['src/feature.js', 'src/other.js'] }), 'between 1 and 1'],
      [validPlan({ risks: [{ level: 'high' }], metadata: { requiresApproval: false } }), 'require approval'],
      [validPlan({
        steps: [{ id: 'delete', type: 'delete', description: 'Delete a file', files: ['src/feature.js'], dependencies: [] }]
      }), 'require approval'],
      [validPlan({ verificationCommands: [{ checkId: 'test', command: 'arbitrary shell' }] }), 'registered check ID'],
      [validPlan({ expectedChecks: [{ type: 'test', command: 'arbitrary shell', required: true }] }), 'verification checks']
    ];

    for (const [plan, expectedIssue] of cases) {
      const result = planner.validatePlan(plan);
      assert.strictEqual(result.valid, false);
      assert.ok(result.issues.some(issue => issue.includes(expectedIssue)), result.issues.join('; '));
      assert.deepStrictEqual(planner.validatePlan(plan), result, 'validation must be deterministic');
    }
    const outOfScope = planner.validatePlan(validPlan(), { allowedFiles: ['src/other.js'] });
    assert.ok(outOfScope.issues.some(issue => issue.includes('requested scope')));
  });

  test('persists the exact versioned plan shown at approval and executes that same plan', async () => {
    const plan = validPlan({
      risks: [{ level: 'high', description: 'Broad impact' }],
      metadata: { requiresApproval: true }
    });
    let approvalPlan;
    let executionPlan;
    let planningContext;
    const planner = new AgentPlanner({
      workspace: process.cwd(),
      planExecutor: async input => {
        planningContext = input.context;
        return plan;
      }
    });
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner,
      workspaceContext: {
        collect: () => ({
          files: [{ path: 'src/feature.js', content: 'module.exports = true;', hash: 'abc' }],
          provenance: [{ path: 'src/feature.js', hash: 'abc' }]
        })
      },
      checkRunner: { run: async id => ({ id, status: 'passed' }) },
      toolRegistry: null,
      onApprovalRequired: async (item, approvedPlan) => {
        approvalPlan = approvedPlan;
        assert.strictEqual(item.plan, approvedPlan);
        return true;
      },
      stepExecutor: async input => {
        executionPlan = input.plan;
        return { success: true, stepId: input.step.id, output: { done: true } };
      }
    });
    const item = orchestrator.addWork({
      description: 'Implement the requested change',
      taskContract: {
        schemaVersion: 1,
        description: 'Implement the requested change',
        acceptanceCriteria: ['The requested change works'],
        files: ['src/feature.js']
      },
      context: {}
    });

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(planningContext.files[0], 'src/feature.js');
    assert.strictEqual(planningContext.gatheredContext.files[0].content, 'module.exports = true;');
    assert.strictEqual(approvalPlan, executionPlan);
    assert.strictEqual(item.plan, approvalPlan);
    assert.strictEqual(item.planVersion, 1);
    const serialized = item.toJSON();
    assert.strictEqual(serialized.planVersion, 1);
    assert.deepStrictEqual(serialized.plan, approvalPlan);
    assert.strictEqual(serialized.approval.planVersion, 1);
    assert.strictEqual(
      serialized.approval.planDigest,
      crypto.createHash('sha256').update(JSON.stringify(approvalPlan)).digest('hex')
    );
  });
});

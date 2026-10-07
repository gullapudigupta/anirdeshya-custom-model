'use strict';

const assert = require('assert');
const { WorkOrchestrator } = require('../../src/agent/work-orchestrator');
const { WorkItemStatus } = require('../../src/agent/work-item');

function createPlanner(steps = [{ id: 'step-1', description: 'Implement feature', files: ['src/feature.js'] }]) {
  return {
    plan: async () => ({
      steps,
      affectedFiles: ['src/feature.js'],
      expectedChecks: [],
      risks: [],
      metadata: { requiresApproval: false }
    }),
    validatePlan: () => ({ valid: true, issues: [] })
  };
}

function createWork(orchestrator) {
  return orchestrator.addWork({
    taskId: 'task-1',
    description: 'Implement the requested feature',
    taskContract: {
      schemaVersion: 1,
      id: 'task-1',
      description: 'Implement the requested feature',
      acceptanceCriteria: ['The feature is implemented']
    },
    context: {
      files: [{ path: 'src/feature.js', content: 'module.exports = {};', hash: 'source-hash' }]
    }
  });
}

async function waitFor(predicate, message) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function createFakeToolRegistry(execImpl) {
  return {
    listExposedTools: () => [
      { name: 'read_file', description: 'Read a file', category: 'file', parameters: { path: { type: 'string', required: true } } },
      { name: 'run_check', description: 'Run a check', category: 'check', parameters: { checkId: { type: 'string', required: true } } }
    ],
    execute: execImpl
  };
}

describe('WorkOrchestrator tool registry wiring (P12-T003)', () => {
  test('passes exposed tool schemas and a callable tool interface to the step executor', async () => {
    const toolRegistry = createFakeToolRegistry(async () => ({ success: true, data: { ok: true }, error: null, duration: 1 }));
    let seenInput;
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      toolRegistry,
      stepExecutor: async (input) => {
        seenInput = input;
        return { success: true, stepId: input.step.id, output: {} };
      }
    });
    const item = createWork(orchestrator);

    await orchestrator.executeOne(item.id);

    assert.ok(Array.isArray(seenInput.toolSchemas));
    assert.deepStrictEqual(seenInput.toolSchemas.map(t => t.name).sort(), ['read_file', 'run_check']);
    assert.strictEqual(typeof seenInput.tools, 'function');
  });

  test('rejects unknown tool names explicitly instead of invoking the registry', async () => {
    const calls = [];
    const toolRegistry = createFakeToolRegistry(async (name, args) => {
      calls.push(name);
      return { success: true, data: {}, error: null, duration: 1 };
    });
    let toolResult;
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      toolRegistry,
      stepExecutor: async (input) => {
        toolResult = await input.tools('delete_everything', {});
        return { success: true, stepId: input.step.id, output: {} };
      }
    });
    const item = createWork(orchestrator);

    await orchestrator.executeOne(item.id);

    assert.strictEqual(toolResult.success, false);
    assert.strictEqual(toolResult.code, 'UNKNOWN_TOOL');
    assert.strictEqual(calls.length, 0, 'the registry must never be invoked for an unknown tool');
  });

  test('enforces the per-task tool-call budget explicitly once exhausted', async () => {
    const toolRegistry = createFakeToolRegistry(async () => ({ success: true, data: { ok: true }, error: null, duration: 1 }));
    const results = [];
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      toolRegistry,
      toolBudget: { maxCalls: 1, maxOutputBytes: 1024 * 1024 },
      stepExecutor: async (input) => {
        results.push(await input.tools('read_file', { path: 'a.txt' }));
        results.push(await input.tools('read_file', { path: 'b.txt' }));
        return { success: true, stepId: input.step.id, output: {} };
      }
    });
    const item = createWork(orchestrator);

    await orchestrator.executeOne(item.id);

    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[1].success, false);
    assert.strictEqual(results[1].code, 'TOOL_BUDGET_EXCEEDED');
  });

  test('bounds oversized tool output once the per-task output budget is exhausted', async () => {
    const bigPayload = { blob: 'x'.repeat(1000) };
    const toolRegistry = createFakeToolRegistry(async () => ({ success: true, data: bigPayload, error: null, duration: 1 }));
    const results = [];
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      toolRegistry,
      toolBudget: { maxCalls: 10, maxOutputBytes: 100 },
      stepExecutor: async (input) => {
        results.push(await input.tools('read_file', { path: 'a.txt' }));
        return { success: true, stepId: input.step.id, output: {} };
      }
    });
    const item = createWork(orchestrator);

    await orchestrator.executeOne(item.id);

    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[0].truncated, true);
    assert.ok(results[0].data.truncated);
  });

  test('records tool calls on the work item correlated with task and step ids', async () => {
    const toolRegistry = createFakeToolRegistry(async () => ({ success: true, data: { ok: true }, error: null, duration: 5 }));
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      toolRegistry,
      stepExecutor: async (input) => {
        await input.tools('read_file', { path: 'a.txt' });
        return { success: true, stepId: input.step.id, output: {} };
      }
    });
    const item = createWork(orchestrator);

    await orchestrator.executeOne(item.id);

    assert.strictEqual(item.toolCalls.length, 1);
    const entry = item.toolCalls[0];
    assert.strictEqual(entry.tool, 'read_file');
    assert.strictEqual(entry.taskId, 'task-1');
    assert.strictEqual(entry.itemId, item.id);
    assert.strictEqual(entry.stepId, 'step-1');
    assert.strictEqual(entry.success, true);
    assert.ok(typeof entry.duration === 'number');
  });

  test('disables tool access entirely when toolRegistry is explicitly null', async () => {
    let seenInput;
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      toolRegistry: null,
      stepExecutor: async (input) => {
        seenInput = input;
        return { success: true, stepId: input.step.id, output: {} };
      }
    });
    const item = createWork(orchestrator);

    await orchestrator.executeOne(item.id);

    assert.strictEqual(seenInput.tools, null);
    assert.deepStrictEqual(seenInput.toolSchemas, []);
  });

  test('defaults to a real ToolRegistry bound to the orchestrator workspace', () => {
    const orchestrator = new WorkOrchestrator({ workspace: process.cwd(), planner: createPlanner() });
    assert.ok(orchestrator.toolRegistry);
    const exposed = orchestrator.toolRegistry.listExposedTools().map(t => t.name);
    assert.ok(exposed.includes('read_file'));
    assert.ok(exposed.includes('run_check'));
    assert.ok(!exposed.includes('execute_command'));
  });
});

describe('WorkOrchestrator step execution', () => {
  test('runs deterministically end-to-end with injected executor and bounded input', async () => {
    const calls = [];
    const context = { files: [{ path: 'src/feature.js', content: 'bounded' }] };
    const taskContract = {
      schemaVersion: 1,
      id: 'task-1',
      description: 'Implement the requested feature',
      acceptanceCriteria: ['The feature is implemented']
    };
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      stepExecutor: async input => {
        calls.push(input);
        return { success: true, stepId: input.step.id, output: { changed: true } };
      }
    });
    const item = orchestrator.addWork({
      taskId: 'task-1',
      description: taskContract.description,
      taskContract,
      context
    });

    const result = await orchestrator.executeAll();

    assert.strictEqual(result.completed, 1);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(result.items[0].status, 'completed');
    assert.strictEqual(item.status, WorkItemStatus.COMPLETED);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].task, taskContract);
    assert.strictEqual(calls[0].context, context);
    assert.strictEqual(calls[0].step.id, 'step-1');
    assert.ok(calls[0].signal instanceof AbortSignal);
    assert.strictEqual(calls[0].provider, null);
    assert.strictEqual(calls[0].model, null);
  });

  test('fails explicitly instead of invoking a provider when no executor is configured', async () => {
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      provider: 'openai'
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.code, 'PROVIDER_EXECUTOR_NOT_CONFIGURED');
    assert.strictEqual(result.provider, 'openai');
    assert.strictEqual(item.status, WorkItemStatus.FAILED);
    assert.strictEqual(result.success, undefined);
  });

  test('rejects malformed executor output without a success-shaped result', async () => {
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      stepExecutor: async ({ step }) => ({ success: true, stepId: step.id })
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.code, 'MALFORMED_OUTPUT');
    assert.strictEqual(item.status, WorkItemStatus.FAILED);
    assert.strictEqual(result.success, undefined);
  });

  test('surfaces provider execution failures explicitly', async () => {
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      provider: 'test-provider',
      model: 'test-model',
      stepExecutor: async () => {
        const error = new Error('Provider rejected the request');
        error.code = 'PROVIDER_ERROR';
        throw error;
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.code, 'PROVIDER_ERROR');
    assert.strictEqual(result.provider, 'test-provider');
    assert.strictEqual(result.model, 'test-model');
    assert.strictEqual(item.status, WorkItemStatus.FAILED);
  });

  test('times out a step and aborts the executor signal', async () => {
    let signal;
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      stepTimeoutMs: 20,
      stepExecutor: input => {
        signal = input.signal;
        return new Promise(() => {});
      }
    });
    const item = createWork(orchestrator);

    const result = await orchestrator.executeOne(item.id);

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.code, 'STEP_TIMEOUT');
    assert.strictEqual(signal.aborted, true);
    assert.strictEqual(item.status, WorkItemStatus.FAILED);
  });

  test('cancels an in-flight step and reports cancellation rather than success', async () => {
    let signal;
    const orchestrator = new WorkOrchestrator({
      workspace: process.cwd(),
      planner: createPlanner(),
      stepExecutor: input => {
        signal = input.signal;
        return new Promise(() => {});
      }
    });
    const item = createWork(orchestrator);
    const execution = orchestrator.executeOne(item.id);
    await waitFor(() => signal, 'executor was not called');

    orchestrator.cancel(item.id);
    const result = await execution;

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(result.code, 'EXECUTION_CANCELLED');
    assert.strictEqual(signal.aborted, true);
    assert.strictEqual(item.status, WorkItemStatus.CANCELLED);
  });
});

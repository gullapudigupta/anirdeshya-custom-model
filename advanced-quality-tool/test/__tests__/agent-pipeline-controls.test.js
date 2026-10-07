'use strict';

const assert = require('assert');
const { WorkOrchestrator } = require('../../src/agent/work-orchestrator');
const { WorkItemStatus } = require('../../src/agent/work-item');
const { HttpApiServer } = require('../../src/integrations/http-api-server');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function stubPlanner(stepCount = 4) {
  return {
    plan: async () => ({
      steps: Array.from({ length: stepCount }, (_, index) => ({
        id: index + 1,
        description: `Step ${index + 1}`,
        dependencies: []
      })),
      affectedFiles: ['src/example.js'],
      expectedChecks: [],
      risks: [],
      metadata: { requiresApproval: false }
    }),
    validatePlan: () => ({ valid: true, issues: [] })
  };
}

function createOrchestrator() {
  return new WorkOrchestrator({ workspace: process.cwd(), planner: stubPlanner(), pausePollMs: 5 });
}

async function waitForStatus(item, status, timeoutMs = 2000) {
  const started = Date.now();
  while (item.status !== status) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${status}; got ${item.status}`);
    await delay(5);
  }
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

describe('Agent pause, resume, and cancellation', () => {
  test('pausing a working item holds execution until it is resumed', async () => {
    const orchestrator = createOrchestrator();
    const item = orchestrator.addWork({ description: 'Pause test' });
    const execution = orchestrator.executeOne(item.id);

    await waitForStatus(item, WorkItemStatus.WORKING);
    assert.strictEqual(orchestrator.pause(item.id).paused, true);
    assert.strictEqual(item.status, WorkItemStatus.PAUSED);

    await delay(250);
    assert.strictEqual(item.status, WorkItemStatus.PAUSED, 'paused work must not complete');

    assert.strictEqual(orchestrator.resume(item.id).resumed, true);
    const result = await execution;
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(item.status, WorkItemStatus.COMPLETED);
  });

  test('cancelled work is reported as cancelled, not completed', async () => {
    const orchestrator = createOrchestrator();
    const item = orchestrator.addWork({ description: 'Cancel test' });
    const execution = orchestrator.executeOne(item.id);

    await waitForStatus(item, WorkItemStatus.WORKING);
    orchestrator.cancel(item.id);
    const result = await execution;

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(item.status, WorkItemStatus.CANCELLED);
  });

  test('cancelling paused work stops it without completing', async () => {
    const orchestrator = createOrchestrator();
    const item = orchestrator.addWork({ description: 'Cancel while paused' });
    const execution = orchestrator.executeOne(item.id);

    await waitForStatus(item, WorkItemStatus.WORKING);
    orchestrator.pause(item.id);
    orchestrator.cancel(item.id);
    const result = await execution;

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(item.status, WorkItemStatus.CANCELLED);
  });

  test('pause and resume reject invalid states', () => {
    const orchestrator = createOrchestrator();
    const item = orchestrator.addWork({ description: 'State test' });
    item.updateStatus(WorkItemStatus.COMPLETED);

    const pause = orchestrator.pause(item.id);
    assert.strictEqual(pause.paused, false);
    assert.match(pause.reason, /Cannot pause/);
    assert.strictEqual(orchestrator.resume(item.id).resumed, false);
    assert.strictEqual(orchestrator.pause('missing').paused, false);
  });

  test('pause and resume API endpoints are registered and enforce state', async () => {
    const api = new HttpApiServer({ rateLimit: null, globalRateLimit: null });
    const routes = api.app._router.stack.filter(layer => layer.route)
      .map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
    assert.ok(routes.includes('POST /api/agent/:id/pause'));
    assert.ok(routes.includes('POST /api/agent/:id/resume'));
    assert.ok(routes.includes('DELETE /api/pipelines/executions/:id'));

    const orchestrator = createOrchestrator();
    const item = orchestrator.addWork({ description: 'API pause test' });
    api.agentWorkStore.set(item.id, { orchestrator, item, logs: [] });

    const paused = mockResponse();
    await api.handleAgentPause({ params: { id: item.id } }, paused);
    assert.strictEqual(paused.statusCode, 200);
    assert.strictEqual(paused.body.data.status, WorkItemStatus.PAUSED);

    const pausedAgain = mockResponse();
    await api.handleAgentResume({ params: { id: item.id } }, pausedAgain);
    assert.strictEqual(pausedAgain.statusCode, 200);

    const invalid = mockResponse();
    await api.handleAgentResume({ params: { id: item.id } }, invalid);
    assert.strictEqual(invalid.statusCode, 409);

    const missing = mockResponse();
    await api.handleAgentPause({ params: { id: 'missing' } }, missing);
    assert.strictEqual(missing.statusCode, 404);
  });
});

describe('Pipeline execution cancellation API', () => {
  test('cancel validates execution state', async () => {
    const api = new HttpApiServer({ rateLimit: null, globalRateLimit: null });
    const cancelled = [];
    const executor = { cancel: id => cancelled.push(id) };

    const missing = mockResponse();
    await api.handlePipelineCancel({ params: { id: 'missing' } }, missing);
    assert.strictEqual(missing.statusCode, 404);

    api.pipelineExecutors.set('not-started', { executor });
    const notStarted = mockResponse();
    await api.handlePipelineCancel({ params: { id: 'not-started' } }, notStarted);
    assert.strictEqual(notStarted.statusCode, 409);

    api.pipelineExecutors.set('finished', { executor, executorRunId: 'r1', completed: new Date().toISOString() });
    const finished = mockResponse();
    await api.handlePipelineCancel({ params: { id: 'finished' } }, finished);
    assert.strictEqual(finished.statusCode, 409);

    api.pipelineExecutors.set('running', { executor, executorRunId: 'r2' });
    const running = mockResponse();
    await api.handlePipelineCancel({ params: { id: 'running' } }, running);
    assert.strictEqual(running.statusCode, 200);
    assert.deepStrictEqual(cancelled, ['r2']);
  });

  test('a running pipeline stops before its next stage after cancellation', async () => {
    const api = new HttpApiServer({ rateLimit: null, globalRateLimit: null });
    const executedStages = [];
    const stageHandlers = new Proxy({}, {
      get: (target, stage) => async () => {
        executedStages.push(stage);
        await delay(40);
        return {};
      }
    });

    const started = mockResponse();
    await api.handlePipelineExecute({
      params: { name: 'workspace-quality-analysis' },
      body: { stageHandlers }
    }, started);
    assert.strictEqual(started.statusCode, 200);
    const { runId } = started.body.data;

    const cancel = mockResponse();
    await api.handlePipelineCancel({ params: { id: runId } }, cancel);
    assert.strictEqual(cancel.statusCode, 200);

    const startedAt = Date.now();
    while (!api.pipelineExecutors.get(runId).completed) {
      if (Date.now() - startedAt > 3000) throw new Error('pipeline did not finish');
      await delay(10);
    }
    const stored = api.pipelineExecutors.get(runId);
    assert.strictEqual(stored.result.status, 'cancelled');
    assert.ok(executedStages.length < 9, `expected early stop, ran ${executedStages.length} stages`);
  });
});

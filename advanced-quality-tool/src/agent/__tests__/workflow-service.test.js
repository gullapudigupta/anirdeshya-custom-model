'use strict';

const { SharedAppServices } = require('../../core/shared-app-services');
const { HttpApiServer } = require('../../integrations/http-api-server');
const { MCPServer, MCP_TOOLS } = require('../../integrations/mcp-server');
const { getToolGroup } = require('../../core/tool-groups');

function createOrchestratorFactory({ fail = false } = {}) {
  return options => {
    const items = new Map();
    return {
      addWork(params) {
        const id = `task-${items.size + 1}`;
        const item = {
          ...params,
          id,
          taskId: params.taskId || id,
          status: 'queued',
          plan: null,
          approval: null,
          changedFiles: [],
          verificationResults: {},
          output: null,
          error: null
        };
        items.set(id, item);
        return item;
      },
      getWorkItem(id) {
        return items.get(id);
      },
      cancel(id) {
        const item = items.get(id);
        if (item) item.status = 'cancelled';
      },
      async executeOne(id) {
        const item = items.get(id);
        if (fail) throw new Error('executor failed');
        if (item.status === 'cancelled') return { itemId: id, status: 'cancelled' };
        const plan = { planVersion: 1, steps: [{ id: 'edit', description: 'Edit scoped source' }], affectedFiles: ['src/a.js'], risks: [{ level: 'high', description: 'Sensitive edit' }] };
        item.status = 'planning';
        item.plan = plan;
        options.onProgress({ type: 'plan-created', item: { id }, plan });
        item.status = 'awaiting_approval';
        const decision = await options.onApprovalRequired(item, plan, {
          planDigest: 'plan-digest-123',
          actionDigest: null
        });
        if (decision === true || decision?.approved === true) {
          item.status = 'completed';
          item.approval = { planDigest: 'plan-digest-123' };
          item.changedFiles = ['src/a.js'];
          item.verificationResults = { passed: true, checks: { test: { status: 'passed', required: true } } };
          item.output = { appliedPatches: [{ path: 'src/a.js' }] };
          return {
            itemId: id,
            status: 'completed',
            output: item.output,
            verification: item.verificationResults
          };
        }
        item.status = 'cancelled';
        return { itemId: id, status: 'cancelled', reason: decision?.reason || 'Approval denied' };
      }
    };
  };
}

function responseCapture() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function parseMcp(response) {
  return JSON.parse(response.result.content[0].text);
}

describe('Supervised agent workflow service', () => {
  test('registers supervised agent actions consistently without automatic approval input', () => {
    const registered = MCP_TOOLS.filter(tool => tool.name.startsWith('aqt_agent_')).map(tool => tool.name);
    expect(registered).toContain('aqt_agent_approve');
    expect(MCP_TOOLS.find(tool => tool.name === 'aqt_agent_start').inputSchema.properties.autoApprove).toBe(undefined);
    expect(getToolGroup('agents').mcpTools).toEqual(registered);
  });

  test('denies approval-required work when no approval channel is configured', async () => {
    const services = new SharedAppServices({
      agentWorkflowOptions: { orchestratorFactory: createOrchestratorFactory() }
    });
    const workflow = services.getAgentWorkflow();
    const started = workflow.start({ description: 'Change a sensitive file' });
    const completed = await workflow.wait(started.id);

    expect(completed.status).toBe('denied');
    expect(completed.approvalState).toBe('denied');
    expect(completed.autonomyProfile).toEqual({ level: 2, name: 'supervised' });
  });

  test('shares task, approval, progress, and result state between HTTP and MCP adapters', async () => {
    const services = new SharedAppServices({
      agentWorkflowOptions: { orchestratorFactory: createOrchestratorFactory() }
    });
    const api = new HttpApiServer({ services });
    const mcp = new MCPServer({
      services,
      transport: { start() {}, send() {} }
    });
    await mcp.start();
    try {
      const startResponse = responseCapture();
      await api.handleAgentStart({ body: { description: 'Update a scoped source' } }, startResponse);
      const { id, taskId, autonomyProfile } = startResponse.body.data;
      expect(startResponse.statusCode).toBe(200);
      expect(taskId).toBe(id);
      expect(autonomyProfile).toEqual({ level: 2, name: 'supervised' });

      await new Promise(resolve => setTimeout(resolve, 0));
      const status = parseMcp(await mcp._handleToolCall(2, {
        name: 'aqt_agent_status',
        arguments: { workId: id }
      }));
      expect(status.id).toBe(id);
      expect(status.approvalState).toBe('awaiting_approval');
      expect(status.plan.steps.length).toBe(1);
      expect(status.progress.length).toBeGreaterThan(0);

      const missingApproval = responseCapture();
      await api.handleAgentApprove({ params: { id }, body: {} }, missingApproval);
      expect(missingApproval.statusCode).toBe(400);

      const rejectedApproval = await mcp._handleToolCall(3, {
        name: 'aqt_agent_approve',
        arguments: { workId: id, planDigest: 'wrong-digest', approved: true }
      });
      expect(rejectedApproval.result.isError).toBe(true);

      const approved = parseMcp(await mcp._handleToolCall(4, {
        name: 'aqt_agent_approve',
        arguments: { workId: id, planDigest: status.planDigest, approved: true }
      }));
      expect(approved.accepted).toBe(true);
      expect(approved.approved).toBe(true);

      const final = await services.getAgentWorkflow().wait(id);
      const statusResponse = responseCapture();
      await api.handleAgentStatus({ params: { id } }, statusResponse);
      expect(final.status).toBe('completed');
      expect(statusResponse.body.data.taskId).toBe(taskId);
      expect(statusResponse.body.data.patchSummary.changedFiles).toEqual(['src/a.js']);
      expect(statusResponse.body.data.verification.passed).toBe(true);
      expect(statusResponse.body.data.result.status).toBe('completed');

      const cancelStart = parseMcp(await mcp._handleToolCall(5, {
        name: 'aqt_agent_start',
        arguments: { description: 'Cancel this approval-required work' }
      }));
      await new Promise(resolve => setTimeout(resolve, 0));
      const cancelResponse = responseCapture();
      await api.handleAgentCancel({ params: { id: cancelStart.id } }, cancelResponse);
      expect(cancelResponse.body.data.accepted).toBe(true);
      await services.getAgentWorkflow().wait(cancelStart.id);
      const cancelled = parseMcp(await mcp._handleToolCall(6, {
        name: 'aqt_agent_status',
        arguments: { workId: cancelStart.id }
      }));
      expect(cancelled.status).toBe('cancelled');
    } finally {
      await mcp.stop();
    }
  });

  test('reports cancellation and executor failure as explicit terminal states', async () => {
    const cancelledServices = new SharedAppServices({
      agentWorkflowOptions: { orchestratorFactory: createOrchestratorFactory() }
    });
    const cancelledWorkflow = cancelledServices.getAgentWorkflow();
    const started = cancelledWorkflow.start({ description: 'Cancel before execution' });
    expect(cancelledWorkflow.cancel(started.id).accepted).toBe(true);
    expect((await cancelledWorkflow.wait(started.id)).status).toBe('cancelled');

    const failedServices = new SharedAppServices({
      agentWorkflowOptions: { orchestratorFactory: createOrchestratorFactory({ fail: true }) }
    });
    const failedWorkflow = failedServices.getAgentWorkflow();
    const failedStart = failedWorkflow.start({ description: 'Fail during execution' });
    const failed = await failedWorkflow.wait(failedStart.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('executor failed');
  });
});

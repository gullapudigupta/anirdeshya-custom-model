'use strict';

const assert = require('assert');
const http = require('http');
const { listToolGroups, getToolGroup } = require('../../src/core/tool-groups');
const { formatToolGroups } = require('../../src/commands/tools-command');
const { MCPServer, MCP_TOOLS } = require('../../src/integrations/mcp-server');
const { HttpApiServer } = require('../../src/integrations/http-api-server');

describe('Shared tool groups', () => {
  test('groups include CLI, HTTP API, and MCP mappings', () => {
    const groups = listToolGroups();
    assert.deepStrictEqual(groups.map(group => group.id), [
      'quality', 'security', 'ai', 'agents', 'pipelines', 'workspace', 'insights', 'extensions'
    ]);
    for (const group of groups) {
      assert.ok(group.cliCommands.length > 0, `${group.id} has CLI commands`);
      assert.ok(group.apiEndpoints.length > 0, `${group.id} has API endpoints`);
      assert.ok(group.mcpTools.length > 0, `${group.id} has MCP tools`);
    }
  });

  test('group reads return copies and reject unknown groups', () => {
    const group = getToolGroup('agents');
    group.cliCommands.push('unregistered');
    assert.ok(!getToolGroup('agents').cliCommands.includes('unregistered'));
    assert.strictEqual(getToolGroup('missing'), null);
  });

  test('CLI formatter lists groups and filters an individual group', () => {
    const groups = JSON.parse(formatToolGroups(undefined, true));
    assert.strictEqual(groups.length, 8);
    const agents = JSON.parse(formatToolGroups('agents', true));
    assert.deepStrictEqual(agents.mcpTools, [
      'aqt_agent_start', 'aqt_agent_status', 'aqt_agent_list', 'aqt_agent_cancel'
    ]);
    assert.throws(() => formatToolGroups('missing'), /Unknown tool group/);
  });

  test('MCP tools are visibly categorized and can return group contents', async () => {
    for (const group of listToolGroups()) {
      for (const name of group.mcpTools) {
        const tool = MCP_TOOLS.find(item => item.name === name);
        assert.ok(tool, `MCP tool ${name} is registered`);
        assert.ok(tool.description.includes(group.name), `${name} has a group label for ${group.id}`);
      }
    }

    const server = new MCPServer({ rateLimit: { enabled: false } });
    const response = await server._handleToolCall(1, {
      name: 'aqt_tools_list',
      arguments: { group: 'agents' }
    });
    assert.deepStrictEqual(
      JSON.parse(response.result.content[0].text).mcpTools,
      getToolGroup('agents').mcpTools
    );
  });

  test('MCP group discovery returns a useful error for an unknown group', async () => {
    const server = new MCPServer({ rateLimit: { enabled: false } });
    const response = await server._handleToolCall(2, {
      name: 'aqt_tools_list',
      arguments: { group: 'missing' }
    });
    assert.strictEqual(response.result.isError, true);
    assert.match(response.result.content[0].text, /Unknown tool group 'missing'/);
  });

  test('HTTP API returns group catalog and rejects unknown groups', async () => {
    const api = new HttpApiServer({ rateLimit: null, globalRateLimit: null });
    const listener = await new Promise(resolve => {
      const server = api.app.listen(0, '127.0.0.1', () => resolve(server));
    });
    const address = listener.address();
    try {
      const allBody = await getJson(`http://127.0.0.1:${address.port}/api/capabilities`);
      const allResponse = allBody.response;
      assert.strictEqual(allResponse.statusCode, 200);
      assert.strictEqual(allBody.body.data.length, listToolGroups().length);

      const infoResponse = await getJson(`http://127.0.0.1:${address.port}/api/info`);
      assert.strictEqual(infoResponse.response.statusCode, 200);
      assert.strictEqual(infoResponse.body.toolGroups.length, listToolGroups().length);

      const groupResponse = await getJson(`http://127.0.0.1:${address.port}/api/capabilities/agents`);
      assert.deepStrictEqual(groupResponse.body.data, getToolGroup('agents'));

      const missingResponse = await getJson(`http://127.0.0.1:${address.port}/api/capabilities/missing`);
      assert.strictEqual(missingResponse.response.statusCode, 404);
      assert.ok(missingResponse.body.availableGroups.includes('agents'));
    } finally {
      await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    }
  });
});

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          resolve({ response, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

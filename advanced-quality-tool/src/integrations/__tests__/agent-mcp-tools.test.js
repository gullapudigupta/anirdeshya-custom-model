/**
 * Tests for Agent MCP Tools (P11-T007)
 */

'use strict';

const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const { MCPServer } = require('../mcp-server');

describe('Agent MCP Tools (P11-T007)', () => {
  let mcpServer;

  beforeAll(async () => {
    mcpServer = new MCPServer({
      transport: {
        onMessage: null,
        start: () => {},
        send: () => {}
      },
      verbose: false
    });
  });

  afterAll(async () => {
    if (mcpServer && mcpServer.stop) {
      await mcpServer.stop();
    }
  });

  describe('Tool Definitions', () => {
    test('should have aqt_agent_start tool defined', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_start');
      expect(tool).toBeDefined();
      expect(tool.description).toContain('autonomous agent work');
      expect(tool.inputSchema).toBeDefined();
    });

    test('should have aqt_agent_status tool defined', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_status');
      expect(tool).toBeDefined();
      expect(tool.description).toContain('status');
      expect(tool.inputSchema.properties.workId).toBeDefined();
    });

    test('should have aqt_agent_list tool defined', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_list');
      expect(tool).toBeDefined();
      expect(tool.description).toContain('List all agent work');
      expect(tool.inputSchema.properties.status).toBeDefined();
    });

    test('should have aqt_agent_cancel tool defined', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_cancel');
      expect(tool).toBeDefined();
      expect(tool.description).toContain('cancel');
      expect(tool.inputSchema.properties.workId).toBeDefined();
    });
  });

  describe('Tool Schema Validation', () => {
    test('aqt_agent_start should have required description parameter', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_start');
      expect(tool.inputSchema.required).toContain('description');
    });

    test('aqt_agent_start should have priority enum', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_start');
      const priorityProp = tool.inputSchema.properties.priority;
      expect(priorityProp.enum).toContain('critical');
      expect(priorityProp.enum).toContain('high');
      expect(priorityProp.enum).toContain('medium');
      expect(priorityProp.enum).toContain('low');
    });

    test('aqt_agent_list should have status enum', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_list');
      const statusProp = tool.inputSchema.properties.status;
      expect(statusProp.enum).toContain('running');
      expect(statusProp.enum).toContain('completed');
      expect(statusProp.enum).toContain('failed');
      expect(statusProp.enum).toContain('all');
    });

    test('aqt_agent_status should require workId', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_status');
      expect(tool.inputSchema.required).toContain('workId');
    });

    test('aqt_agent_cancel should require workId', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_cancel');
      expect(tool.inputSchema.required).toContain('workId');
    });
  });

  describe('Tool Properties', () => {
    test('aqt_agent_start should have default values documented', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_start');
      const props = tool.inputSchema.properties;
      expect(props.priority.default).toBe('medium');
      expect(props.maxFiles.default).toBe(50);
      expect(props.maxIterations.default).toBe(10);
      expect(props.autoApprove.default).toBe(false);
    });

    test('aqt_agent_list should have sensible defaults', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_list');
      const props = tool.inputSchema.properties;
      expect(props.status.default).toBe('all');
      expect(props.limit.default).toBe(50);
    });

    test('all agent tools should have descriptions', () => {
      const agentTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_agent_'));
      agentTools.forEach(tool => {
        expect(tool.description).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(10);
      });
    });
  });

  describe('Tool Naming Conventions', () => {
    test('agent tools should follow aqt_agent_ naming pattern', () => {
      const agentTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_agent_'));
      expect(agentTools.length).toBe(4);
      
      const names = agentTools.map(t => t.name);
      expect(names).toContain('aqt_agent_start');
      expect(names).toContain('aqt_agent_status');
      expect(names).toContain('aqt_agent_list');
      expect(names).toContain('aqt_agent_cancel');
    });
  });

  describe('Input Schema Structure', () => {
    test('all agent tools should have object type schemas', () => {
      const agentTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_agent_'));
      agentTools.forEach(tool => {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
        expect(typeof tool.inputSchema.properties).toBe('object');
      });
    });

    test('agent start should have workspace property with default', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_start');
      const workspaceProp = tool.inputSchema.properties.workspace;
      expect(workspaceProp).toBeDefined();
      expect(workspaceProp.description).toBeDefined();
    });

    test('agent start should document autoApprove parameter', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_start');
      const autoApproveProp = tool.inputSchema.properties.autoApprove;
      expect(autoApproveProp).toBeDefined();
      expect(autoApproveProp.type).toBe('boolean');
      expect(autoApproveProp.description).toContain('approve');
    });
  });

  describe('Documentation Quality', () => {
    test('each agent tool should have clear descriptions', () => {
      const agentTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_agent_'));
      agentTools.forEach(tool => {
        expect(tool.description).toBeTruthy();
        // Descriptions should be complete sentences
        expect(tool.description).toMatch(/\./);
      });
    });

    test('agent start description should mention work ID', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_start');
      expect(tool.description).toMatch(/[Ww]ork\s+[Ii][Dd]/);
    });

    test('parameters should have descriptions', () => {
      const agentTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_agent_'));
      agentTools.forEach(tool => {
        Object.entries(tool.inputSchema.properties).forEach(([paramName, paramDef]) => {
          expect(paramDef.description).toBeTruthy();
          expect(paramDef.description.length).toBeGreaterThan(5);
        });
      });
    });
  });

  describe('Parameter Types', () => {
    test('workId should be string type', () => {
      const statusTool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_status');
      expect(statusTool.inputSchema.properties.workId.type).toBe('string');
    });

    test('description should be string type', () => {
      const startTool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_start');
      expect(startTool.inputSchema.properties.description.type).toBe('string');
    });

    test('maxFiles and maxIterations should be numbers', () => {
      const startTool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_start');
      expect(startTool.inputSchema.properties.maxFiles.type).toBe('number');
      expect(startTool.inputSchema.properties.maxIterations.type).toBe('number');
    });

    test('limit should be number type', () => {
      const listTool = mcpServer._registry.tools.find(t => t.name === 'aqt_agent_list');
      expect(listTool.inputSchema.properties.limit.type).toBe('number');
    });
  });

  describe('Consistency Across Tools', () => {
    test('all tools should be discoverable', () => {
      const agentTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_agent_'));
      expect(agentTools.length).toBeGreaterThan(0);
    });

    test('agent tools should not be marked as deprecated', () => {
      const agentTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_agent_'));
      agentTools.forEach(tool => {
        expect(tool.deprecated).not.toBe(true);
      });
    });

    test('tools should maintain consistent response format in documentation', () => {
      const agentTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_agent_'));
      // All should have properly structured schemas
      agentTools.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      });
    });
  });
});

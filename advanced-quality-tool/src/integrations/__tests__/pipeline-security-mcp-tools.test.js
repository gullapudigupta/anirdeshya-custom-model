/**
 * Tests for Pipeline MCP Tools (P11-T008) and Security MCP Tools (P11-T009)
 */

'use strict';

const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const { MCPServer } = require('../mcp-server');

describe('Pipeline and Security MCP Tools (P11-T008 & P11-T009)', () => {
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

  describe('Pipeline MCP Tools (P11-T008)', () => {
    describe('Tool Definitions', () => {
      test('should have aqt_pipeline_list tool defined', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_pipeline_list');
        expect(tool).toBeDefined();
        expect(tool.description).toContain('available pipelines');
      });

      test('should have aqt_pipeline_execute tool defined', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_pipeline_execute');
        expect(tool).toBeDefined();
        expect(tool.description).toContain('Execute');
        expect(tool.inputSchema.properties.pipelineName).toBeDefined();
      });

      test('should have aqt_pipeline_status tool defined', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_pipeline_status');
        expect(tool).toBeDefined();
        expect(tool.description).toContain('status');
        expect(tool.inputSchema.properties.executionId).toBeDefined();
      });

      test('should have aqt_pipeline_info tool defined', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_pipeline_info');
        expect(tool).toBeDefined();
        expect(tool.description).toContain('information');
      });
    });

    describe('Schema Validation', () => {
      test('pipeline_execute should require pipelineName', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_pipeline_execute');
        expect(tool.inputSchema.required).toContain('pipelineName');
      });

      test('pipeline_status should require executionId', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_pipeline_status');
        expect(tool.inputSchema.required).toContain('executionId');
      });

      test('pipeline_info should require pipelineName', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_pipeline_info');
        expect(tool.inputSchema.required).toContain('pipelineName');
      });

      test('pipeline_execute should have dryRun boolean parameter', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_pipeline_execute');
        const dryRunProp = tool.inputSchema.properties.dryRun;
        expect(dryRunProp.type).toBe('boolean');
        expect(dryRunProp.default).toBe(false);
      });

      test('pipeline_execute should have autoApprove boolean parameter', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_pipeline_execute');
        const autoApproveProp = tool.inputSchema.properties.autoApprove;
        expect(autoApproveProp.type).toBe('boolean');
        expect(autoApproveProp.default).toBe(false);
      });
    });

    describe('Parameter Descriptions', () => {
      test('all pipeline parameters should have descriptions', () => {
        const pipelineTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_pipeline_'));
        pipelineTools.forEach(tool => {
          Object.values(tool.inputSchema.properties).forEach(prop => {
            expect(prop.description).toBeTruthy();
          });
        });
      });
    });
  });

  describe('Security MCP Tools (P11-T009)', () => {
    describe('Tool Definitions', () => {
      test('should have aqt_security_scan tool defined', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_security_scan');
        expect(tool).toBeDefined();
        expect(tool.description).toContain('comprehensive security scan');
      });

      test('should have aqt_security_vulnerabilities tool defined', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_security_vulnerabilities');
        expect(tool).toBeDefined();
        expect(tool.description).toContain('vulnerability');
        expect(tool.description).toContain('CWE');
      });

      test('should have aqt_security_secrets tool defined', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_security_secrets');
        expect(tool).toBeDefined();
        expect(tool.description).toContain('secrets');
      });

      test('should have aqt_security_dependencies tool defined', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_security_dependencies');
        expect(tool).toBeDefined();
        expect(tool.description).toContain('dependencies');
        expect(tool.description).toContain('CVE');
      });
    });

    describe('Scan Types', () => {
      test('security_scan should support vuln, secrets, deps scan types', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_security_scan');
        const scanTypesProp = tool.inputSchema.properties.scanTypes;
        expect(scanTypesProp.items.enum).toContain('vuln');
        expect(scanTypesProp.items.enum).toContain('secrets');
        expect(scanTypesProp.items.enum).toContain('deps');
      });

      test('security_scan default should include all scan types', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_security_scan');
        const scanTypesProp = tool.inputSchema.properties.scanTypes;
        expect(scanTypesProp.default).toContain('vuln');
        expect(scanTypesProp.default).toContain('secrets');
        expect(scanTypesProp.default).toContain('deps');
      });
    });

    describe('Severity Levels', () => {
      test('security_scan should support severity filtering', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_security_scan');
        const severityProp = tool.inputSchema.properties.severity;
        expect(severityProp.enum).toContain('critical');
        expect(severityProp.enum).toContain('high');
        expect(severityProp.enum).toContain('medium');
        expect(severityProp.enum).toContain('low');
      });

      test('security_vulnerabilities should support severity filtering', () => {
        const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_security_vulnerabilities');
        const severityProp = tool.inputSchema.properties.severity;
        expect(severityProp.enum).toContain('critical');
        expect(severityProp.enum).toContain('high');
      });
    });

    describe('Schema Validation', () => {
      test('all security tools should have proper schemas', () => {
        const securityTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_security_'));
        securityTools.forEach(tool => {
          expect(tool.inputSchema.type).toBe('object');
          expect(tool.inputSchema.properties).toBeDefined();
        });
      });

      test('security tools should not require parameters by default', () => {
        const securityTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_security_'));
        securityTools.forEach(tool => {
          expect(Array.isArray(tool.inputSchema.required)).toBe(true);
          expect(tool.inputSchema.required.length).toBe(0);
        });
      });
    });
  });

  describe('Combined Tool Coverage', () => {
    test('should have 4 pipeline tools', () => {
      const pipelineTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_pipeline_'));
      expect(pipelineTools.length).toBe(4);
    });

    test('should have 4 security tools', () => {
      const securityTools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_security_'));
      expect(securityTools.length).toBe(4);
    });

    test('all new tools should be discoverable', () => {
      const newTools = mcpServer._registry.tools.filter(t => 
        t.name.startsWith('aqt_pipeline_') || t.name.startsWith('aqt_security_')
      );
      expect(newTools.length).toBe(8);
    });
  });

  describe('Tool Naming Conventions', () => {
    test('pipeline tools should follow naming pattern', () => {
      const tools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_pipeline_'));
      const names = tools.map(t => t.name);
      expect(names).toContain('aqt_pipeline_list');
      expect(names).toContain('aqt_pipeline_execute');
      expect(names).toContain('aqt_pipeline_status');
      expect(names).toContain('aqt_pipeline_info');
    });

    test('security tools should follow naming pattern', () => {
      const tools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_security_'));
      const names = tools.map(t => t.name);
      expect(names).toContain('aqt_security_scan');
      expect(names).toContain('aqt_security_vulnerabilities');
      expect(names).toContain('aqt_security_secrets');
      expect(names).toContain('aqt_security_dependencies');
    });
  });

  describe('Documentation Quality', () => {
    test('all pipeline tools should have detailed descriptions', () => {
      const tools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_pipeline_'));
      tools.forEach(tool => {
        expect(tool.description).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(15);
        expect(tool.description).toMatch(/\./);
      });
    });

    test('all security tools should have detailed descriptions', () => {
      const tools = mcpServer._registry.tools.filter(t => t.name.startsWith('aqt_security_'));
      tools.forEach(tool => {
        expect(tool.description).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(15);
        expect(tool.description).toMatch(/\./);
      });
    });

    test('all parameters should have descriptions', () => {
      const tools = mcpServer._registry.tools.filter(t => 
        t.name.startsWith('aqt_pipeline_') || t.name.startsWith('aqt_security_')
      );
      tools.forEach(tool => {
        Object.entries(tool.inputSchema.properties).forEach(([paramName, paramDef]) => {
          expect(paramDef.description).toBeTruthy();
          expect(paramDef.description.length).toBeGreaterThan(5);
        });
      });
    });
  });

  describe('Type Safety', () => {
    test('all string properties should have type string', () => {
      const tools = mcpServer._registry.tools.filter(t => 
        t.name.startsWith('aqt_pipeline_') || t.name.startsWith('aqt_security_')
      );
      tools.forEach(tool => {
        Object.entries(tool.inputSchema.properties).forEach(([paramName, paramDef]) => {
          if (paramName.includes('Name') || paramName.includes('path') || paramName.includes('workspace') || 
              paramName.includes('id')) {
            expect(paramDef.type).toBe('string');
          }
        });
      });
    });

    test('all boolean parameters should have type boolean and default value', () => {
      const tools = mcpServer._registry.tools.filter(t => 
        t.name.startsWith('aqt_pipeline_') || t.name.startsWith('aqt_security_')
      );
      tools.forEach(tool => {
        Object.entries(tool.inputSchema.properties).forEach(([paramName, paramDef]) => {
          if (paramName.includes('Auto') || paramName.includes('Dry') || paramName.includes('approve')) {
            if (paramDef.type === 'boolean') {
              expect(typeof paramDef.default).toBe('boolean');
            }
          }
        });
      });
    });
  });

  describe('Enumeration Values', () => {
    test('pipeline_execute should have valid enum values for array items', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_pipeline_execute');
      expect(tool.inputSchema.properties.input).toBeDefined();
      expect(tool.inputSchema.properties.input.type).toBe('object');
    });

    test('security_scan severity enum should be valid', () => {
      const tool = mcpServer._registry.tools.find(t => t.name === 'aqt_security_scan');
      const severityEnum = tool.inputSchema.properties.severity.enum;
      expect(severityEnum.length).toBeGreaterThan(0);
      severityEnum.forEach(severity => {
        expect(['critical', 'high', 'medium', 'low']).toContain(severity);
      });
    });
  });
});

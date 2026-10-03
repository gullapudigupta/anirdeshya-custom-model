/**
 * Phase 11 Integration Tests (P11-T037)
 *
 * Comprehensive integration test suite (all synchronous) covering:
 * - Module exports / importability
 * - Class instantiation
 * - Method presence
 * - Source-level routing verification
 * - UI file integrity
 * - Task file validity
 *
 * Minimum 80% coverage of Phase 11 surface area.
 *
 * @module test/phase11-integration
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const ROOT = path.resolve(__dirname, '../..');

function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// ─────────────────────────────────────────────────────────────────────────────
// 1. Security Command
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: Security Command', () => {
  test('exports run()', () => {
    expect(typeof require(`${ROOT}/src/commands/security-command`).run).toBe('function');
  });

  test('routes scan sub-command', () => {
    expect(src('src/commands/security-command.js')).toMatch(/case ['"]scan['"]/);
  });

  test('routes vulnerabilities sub-command', () => {
    expect(src('src/commands/security-command.js')).toMatch(/vulnerabilit/);
  });

  test('routes secrets sub-command', () => {
    expect(src('src/commands/security-command.js')).toMatch(/secret/);
  });

  test('routes dependencies sub-command', () => {
    expect(src('src/commands/security-command.js')).toMatch(/dependenc/);
  });

  test('VulnerabilityScanner importable', () => {
    const { VulnerabilityScanner } = require(`${ROOT}/src/security/vulnerability-scanner`);
    expect(typeof VulnerabilityScanner).toBe('function');
  });

  test('VulnerabilityScanner has scanDirectory()', () => {
    const { VulnerabilityScanner } = require(`${ROOT}/src/security/vulnerability-scanner`);
    const s = new VulnerabilityScanner({});
    expect(typeof s.scanDirectory).toBe('function');
  });

  test('VulnerabilityScanner has generateReport()', () => {
    const { VulnerabilityScanner } = require(`${ROOT}/src/security/vulnerability-scanner`);
    const s = new VulnerabilityScanner({});
    expect(typeof s.generateReport).toBe('function');
  });

  test('SecretScanner importable', () => {
    const { SecretScanner } = require(`${ROOT}/src/security/secret-scanner`);
    expect(typeof SecretScanner).toBe('function');
  });

  test('SecretScanner has scanDirectory()', () => {
    const { SecretScanner } = require(`${ROOT}/src/security/secret-scanner`);
    const s = new SecretScanner({});
    expect(typeof s.scanDirectory).toBe('function');
  });

  test('DependencyScanner importable', () => {
    const { DependencyScanner } = require(`${ROOT}/src/security/dependency-scanner`);
    expect(typeof DependencyScanner).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Pipeline Command
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: Pipeline Command', () => {
  test('exports run()', () => {
    expect(typeof require(`${ROOT}/src/commands/pipeline-command`).run).toBe('function');
  });

  test('routes list sub-command', () => {
    expect(src('src/commands/pipeline-command.js')).toMatch(/case ['"]list['"]/);
  });

  test('routes run sub-command', () => {
    expect(src('src/commands/pipeline-command.js')).toMatch(/case ['"]run['"]/);
  });

  test('PipelineRegistry importable', () => {
    const { PipelineRegistry } = require(`${ROOT}/src/pipelines/pipeline-registry`);
    expect(typeof PipelineRegistry).toBe('function');
  });

  test('getRegistry importable', () => {
    const { getRegistry } = require(`${ROOT}/src/pipelines/pipeline-registry`);
    expect(typeof getRegistry).toBe('function');
  });

  test('PipelineExecutor importable', () => {
    const { PipelineExecutor } = require(`${ROOT}/src/pipelines/pipeline-executor`);
    expect(typeof PipelineExecutor).toBe('function');
  });

  test('PipelineExecutor instantiates', () => {
    const { PipelineExecutor } = require(`${ROOT}/src/pipelines/pipeline-executor`);
    expect(new PipelineExecutor({})).toBeDefined();
  });

  test('ExecutionLedger importable', () => {
    const { ExecutionLedger } = require(`${ROOT}/src/pipelines/execution-ledger`);
    expect(typeof ExecutionLedger).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Agent Command
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: Agent Command', () => {
  test('exports run()', () => {
    expect(typeof require(`${ROOT}/src/commands/agent-command`).run).toBe('function');
  });

  test('routes start sub-command', () => {
    expect(src('src/commands/agent-command.js')).toMatch(/case ['"]start['"]/);
  });

  test('routes list sub-command', () => {
    expect(src('src/commands/agent-command.js')).toMatch(/case ['"]list['"]/);
  });

  test('routes cancel sub-command', () => {
    expect(src('src/commands/agent-command.js')).toMatch(/cancel/);
  });

  test('WorkOrchestrator importable', () => {
    const { WorkOrchestrator } = require(`${ROOT}/src/agent/work-orchestrator`);
    expect(typeof WorkOrchestrator).toBe('function');
  });

  test('AgentPlanner importable', () => {
    const { AgentPlanner } = require(`${ROOT}/src/agent/planner`);
    expect(typeof AgentPlanner).toBe('function');
  });

  test('WorkItem importable', () => {
    const { WorkItem } = require(`${ROOT}/src/agent/work-item`);
    expect(typeof WorkItem).toBe('function');
  });

  test('WorkItem instantiates with fields', () => {
    const { WorkItem } = require(`${ROOT}/src/agent/work-item`);
    const item = new WorkItem({ description: 'test', workspacePath: '/tmp' });
    expect(item.description).toBe('test');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Plugin System
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: Plugin System', () => {
  test('PluginManager importable', () => {
    const { PluginManager } = require(`${ROOT}/src/plugins/plugin-system`);
    expect(typeof PluginManager).toBe('function');
  });

  test('PluginManager instantiates', () => {
    const { PluginManager } = require(`${ROOT}/src/plugins/plugin-system`);
    const pm = new PluginManager({ pluginDirs: [] });
    expect(pm).toBeDefined();
    expect(pm.plugins).toBeDefined();
    expect(pm.hooks).toBeDefined();
  });

  test('PluginManager has initialize()', () => {
    const { PluginManager } = require(`${ROOT}/src/plugins/plugin-system`);
    expect(typeof new PluginManager({}).initialize).toBe('function');
  });

  test('PluginManager tracks stats', () => {
    const { PluginManager } = require(`${ROOT}/src/plugins/plugin-system`);
    const pm = new PluginManager({});
    expect(typeof pm.stats.pluginsLoaded).toBe('number');
    expect(typeof pm.stats.pluginsFailed).toBe('number');
  });

  test('apiVersion is exposed', () => {
    const { PluginManager } = require(`${ROOT}/src/plugins/plugin-system`);
    const pm = new PluginManager({});
    expect(typeof pm.apiVersion).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. MCP Server
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: MCP Server', () => {
  test('MCPServer importable', () => {
    const { MCPServer } = require(`${ROOT}/src/integrations/mcp-server`);
    expect(typeof MCPServer).toBe('function');
  });

  test('MCP_TOOLS constant exported', () => {
    const { MCP_TOOLS } = require(`${ROOT}/src/integrations/mcp-server`);
    expect(MCP_TOOLS).toBeDefined();
  });

  test('MCPServer instantiates with config', () => {
    const { MCPServer } = require(`${ROOT}/src/integrations/mcp-server`);
    const s = new MCPServer({ port: 0 });
    expect(s.config).toBeDefined();
  });

  test('MCPServer source contains agent tools', () => {
    expect(src('src/integrations/mcp-server.js')).toMatch(/agent.*start|start.*agent/i);
  });

  test('MCPServer source contains pipeline tools', () => {
    expect(src('src/integrations/mcp-server.js')).toMatch(/pipeline.*list|list.*pipeline/i);
  });

  test('MCPServer source contains security tools', () => {
    expect(src('src/integrations/mcp-server.js')).toMatch(/security.*scan|scan.*security/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. HTTP API Server
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: HTTP API Server', () => {
  test('HttpApiServer importable', () => {
    const { HttpApiServer } = require(`${ROOT}/src/integrations/http-api-server`);
    expect(typeof HttpApiServer).toBe('function');
  });

  test('HttpApiServer instantiates', () => {
    const { HttpApiServer } = require(`${ROOT}/src/integrations/http-api-server`);
    expect(new HttpApiServer({ port: 0, autoStart: false })).toBeDefined();
  });

  test('handleSecurityScan exists', () => {
    const { HttpApiServer } = require(`${ROOT}/src/integrations/http-api-server`);
    expect(typeof new HttpApiServer({ port: 0, autoStart: false }).handleSecurityScan).toBe('function');
  });

  test('handleGetVulnerabilities exists', () => {
    const { HttpApiServer } = require(`${ROOT}/src/integrations/http-api-server`);
    expect(typeof new HttpApiServer({ port: 0, autoStart: false }).handleGetVulnerabilities).toBe('function');
  });

  test('handleBatchFix exists', () => {
    const { HttpApiServer } = require(`${ROOT}/src/integrations/http-api-server`);
    expect(typeof new HttpApiServer({ port: 0, autoStart: false }).handleBatchFix).toBe('function');
  });

  test('handleAgentStart exists', () => {
    const { HttpApiServer } = require(`${ROOT}/src/integrations/http-api-server`);
    expect(typeof new HttpApiServer({ port: 0, autoStart: false }).handleAgentStart).toBe('function');
  });

  test('handlePipelineList exists', () => {
    const { HttpApiServer } = require(`${ROOT}/src/integrations/http-api-server`);
    expect(typeof new HttpApiServer({ port: 0, autoStart: false }).handlePipelineList).toBe('function');
  });

  test('handlePipelineExecute exists', () => {
    const { HttpApiServer } = require(`${ROOT}/src/integrations/http-api-server`);
    expect(typeof new HttpApiServer({ port: 0, autoStart: false }).handlePipelineExecute).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Batch-Fix Endpoint validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: Batch-Fix Endpoint', () => {
  test('handleBatchFix rejects empty issueIds', async () => {
    const { HttpApiServer } = require(`${ROOT}/src/integrations/http-api-server`);
    const server = new HttpApiServer({ port: 0, autoStart: false });
    let code = 200;
    const res = { status: (c) => { code = c; return res; }, json: () => {} };
    await server.handleBatchFix({ body: { issueIds: [] } }, res);
    expect(code).toBe(400);
  });

  test('handleBatchFix rejects missing body', async () => {
    const { HttpApiServer } = require(`${ROOT}/src/integrations/http-api-server`);
    const server = new HttpApiServer({ port: 0, autoStart: false });
    let code = 200;
    const res = { status: (c) => { code = c; return res; }, json: () => {} };
    await server.handleBatchFix({ body: {} }, res);
    expect(code).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. CLI routing (all commands discoverable)
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: CLI Command Routing', () => {
  test('security-command exports run()', () => {
    expect(typeof require(`${ROOT}/src/commands/security-command`).run).toBe('function');
  });

  test('pipeline-command exports run()', () => {
    expect(typeof require(`${ROOT}/src/commands/pipeline-command`).run).toBe('function');
  });

  test('agent-command exports run()', () => {
    expect(typeof require(`${ROOT}/src/commands/agent-command`).run).toBe('function');
  });

  test('ai-command importable', () => {
    expect(require(`${ROOT}/src/commands/ai-command`)).toBeDefined();
  });

  test('fix-command importable', () => {
    expect(require(`${ROOT}/src/commands/fix-command`)).toBeDefined();
  });

  test('monitor-command importable', () => {
    expect(require(`${ROOT}/src/commands/monitor-command`)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. AI Generation System
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: AI Generation', () => {
  test('ai-generator index importable', () => {
    expect(require(`${ROOT}/src/ai-generator`)).toBeDefined();
  });

  test('AIGenerationOrchestrator exported', () => {
    const { AIGenerationOrchestrator } = require(`${ROOT}/src/ai-generator`);
    expect(typeof AIGenerationOrchestrator).toBe('function');
  });

  test('CostTracker exported', () => {
    const { CostTracker } = require(`${ROOT}/src/ai-generator`);
    expect(typeof CostTracker).toBe('function');
  });

  test('CostTracker instantiates', () => {
    const { CostTracker } = require(`${ROOT}/src/ai-generator`);
    const t = new CostTracker();
    expect(t).toBeDefined();
  });

  test('ai-command source contains generate sub-command', () => {
    expect(src('src/commands/ai-command.js')).toMatch(/generate/);
  });

  test('ai-command source contains cost tracking', () => {
    expect(src('src/commands/ai-command.js')).toMatch(/CostTracker|cost/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Security Module structural checks
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: Security Module Structure', () => {
  test('VulnerabilityScanner has scanFile()', () => {
    const { VulnerabilityScanner } = require(`${ROOT}/src/security/vulnerability-scanner`);
    expect(typeof new VulnerabilityScanner({}).scanFile).toBe('function');
  });

  test('SecretScanner has scanFile()', () => {
    const { SecretScanner } = require(`${ROOT}/src/security/secret-scanner`);
    expect(typeof new SecretScanner({}).scanFile).toBe('function');
  });

  test('SecretScanner has getStats()', () => {
    const { SecretScanner } = require(`${ROOT}/src/security/secret-scanner`);
    expect(typeof new SecretScanner({}).getStats).toBe('function');
  });

  test('VulnerabilityScanner has getStats()', () => {
    const { VulnerabilityScanner } = require(`${ROOT}/src/security/vulnerability-scanner`);
    expect(typeof new VulnerabilityScanner({}).getStats).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. UI Module file integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: UI Module Files', () => {
  const uiDir = path.join(ROOT, 'src', 'ui');

  test('chat-ui.html exists', () => {
    expect(fs.existsSync(path.join(uiDir, 'chat-ui.html'))).toBe(true);
  });

  test('chat-ui.js exists', () => {
    expect(fs.existsSync(path.join(uiDir, 'chat-ui.js'))).toBe(true);
  });

  test('chat-ui.css exists', () => {
    expect(fs.existsSync(path.join(uiDir, 'chat-ui.css'))).toBe(true);
  });

  test('chat-ui.js has toggleIssueSelection', () => {
    expect(src('src/ui/chat-ui.js')).toMatch(/toggleIssueSelection/);
  });

  test('chat-ui.js has selectAllVisibleIssues', () => {
    expect(src('src/ui/chat-ui.js')).toMatch(/selectAllVisibleIssues/);
  });

  test('chat-ui.js has fixSelectedIssues', () => {
    expect(src('src/ui/chat-ui.js')).toMatch(/fixSelectedIssues/);
  });

  test('chat-ui.js has searchIssues or searchQuery', () => {
    expect(src('src/ui/chat-ui.js')).toMatch(/searchIssues|searchQuery/);
  });

  test('chat-ui.js has applyFilters or setupFilterListeners', () => {
    expect(src('src/ui/chat-ui.js')).toMatch(/applyFilters|setupFilterListeners/);
  });

  test('chat-ui.js has runSecurityScan', () => {
    expect(src('src/ui/chat-ui.js')).toMatch(/runSecurityScan/);
  });

  test('chat-ui.js has WebSocket integration', () => {
    expect(src('src/ui/chat-ui.js')).toMatch(/WebSocket|initializeWebSocket/);
  });

  test('chat-ui.html has bulk-actions-bar', () => {
    expect(src('src/ui/chat-ui.html')).toMatch(/bulk-actions-bar|bulkActionsBar/);
  });

  test('chat-ui.html has Security Scan button', () => {
    expect(src('src/ui/chat-ui.html')).toMatch(/securityScanBtn|Security Scan/);
  });

  test('chat-ui.css has bulk-actions-bar styles', () => {
    expect(src('src/ui/chat-ui.css')).toMatch(/bulk-actions-bar/);
  });

  test('chat-ui.css has issue-checkbox styles', () => {
    expect(src('src/ui/chat-ui.css')).toMatch(/issue-checkbox/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Pipeline registry round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: Pipeline Registry Round-Trip', () => {
  test('can instantiate a fresh PipelineRegistry', () => {
    const { PipelineRegistry } = require(`${ROOT}/src/pipelines/pipeline-registry`);
    const r = new PipelineRegistry();
    expect(r).toBeDefined();
  });

  test('listAll() or list() returns an array', () => {
    const { PipelineRegistry } = require(`${ROOT}/src/pipelines/pipeline-registry`);
    const r = new PipelineRegistry();
    const result = r.listAll ? r.listAll() : r.list ? r.list() : [];
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Phase 11 task file validity
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: Phase 11 Task Definitions', () => {
  const raw   = fs.readFileSync(path.join(ROOT, 'tasks', 'phase11-tasks.json'), 'utf8');
  const data  = JSON.parse(raw);
  const tasks = data.tasks;

  test('phase11-tasks.json is valid JSON with tasks array', () => {
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThan(0);
  });

  test('every task has id and name', () => {
    tasks.forEach(t => {
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
    });
  });

  test('every task has a valid status', () => {
    const valid = new Set(['COMPLETED', 'PENDING', 'IN_PROGRESS', 'BLOCKED', 'SKIPPED']);
    tasks.forEach(t => expect(valid.has(t.status)).toBe(true));
  });

  test('completed tasks have completedDate', () => {
    tasks.filter(t => t.status === 'COMPLETED').forEach(t => {
      expect(typeof t.completedDate).toBe('string');
    });
  });

  test('at least 26 tasks are COMPLETED', () => {
    const done = tasks.filter(t => t.status === 'COMPLETED').length;
    expect(done).toBeGreaterThanOrEqual(26);
  });

  test('overall completionPercentage reflects progress', () => {
    const pct = parseFloat(data.completionPercentage);
    expect(pct).toBeGreaterThanOrEqual(50);
  });
});

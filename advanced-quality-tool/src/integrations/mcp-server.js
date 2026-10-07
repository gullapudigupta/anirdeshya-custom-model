/**
 * Model Context Protocol (MCP) Server  (P8-T002)
 *
 * Exposes Advanced Quality Tool operations as MCP tools so any MCP-compatible
 * host (Claude Desktop, Kiro, VS Code extensions, etc.) can invoke them.
 *
 * Architecture:
 *   - Standalone entry point — starts independently of CLI and HTTP API
 *   - Thin adapter over SharedAppServices (no business logic here)
 *   - All tool inputs are validated against JSON schemas before dispatch
 *   - Structured errors for missing config, unavailable models, and failures
 *   - Offline protocol tests do not require a live MCP host
 *
 * Exposed MCP tools:
 *   aqt_analyze        — run quality analysis on a workspace path
 *   aqt_fix            — apply fixes to reported issues
 *   aqt_review         — run AI code review on files
 *   aqt_report         — generate a report in json|markdown|sarif
 *   aqt_health         — return provider and capability status
 *
 * Usage (stdio transport — standard MCP pattern):
 *   node src/integrations/mcp-server.js
 *
 * Configuration via environment variables (see .env.example):
 *   AQT_PROJECT_ROOT, AQT_LOCAL_MODEL_URL, OPENAI_API_KEY, etc.
 *
 * @module integrations/mcp-server
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');
const { InterfaceAdapter } = require('../core/interface-adapter');
const { DashboardIntegration } = require('../dashboard/dashboard-integration');
const { loadDashboardConfig, saveDashboardConfig } = require('../commands/dashboard-command');
const { PluginManager } = require('../plugins/plugin-system');
const { listToolGroups, getToolGroup, getMcpToolGroups } = require('../core/tool-groups');

// ─── Tool schema registry ─────────────────────────────────────────────────────

/**
 * Each tool definition follows the MCP tool schema format.
 * inputSchema is used both for documentation and runtime validation.
 */
const MCP_TOOLS = [
  {
    name:        'aqt_analyze',
    description: 'Run Advanced Quality Tool analysis on a project workspace. ' +
                 'Returns normalised issues from linters, security scanners, and static analysers.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Absolute path to the project to analyse.' },
        files:       { type: 'array', items: { type: 'string' }, description: 'Limit to specific files (optional).' },
        categories:  { type: 'array', items: { type: 'string' }, description: 'Filter by category e.g. ["security","performance"] (optional).' }
      },
      required: []
    }
  },
  {
    name:        'aqt_fix',
    description: 'Apply rule-based or AI-assisted fixes to issues returned by aqt_analyze.',
    inputSchema: {
      type: 'object',
      properties: {
        issues:   { type: 'array',  description: 'Issues array from aqt_analyze result.' },
        strategy: { type: 'string', enum: ['rule-only', 'ai-only', 'rule-first'], default: 'rule-first' },
        dryRun:   { type: 'boolean', default: false, description: 'Preview fixes without writing files.' }
      },
      required: ['issues']
    }
  },
  {
    name:        'aqt_review',
    description: 'Run explainable AI code review on one or more files.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              content:  { type: 'string' },
              diff:     { type: 'string', description: 'Unified diff for diff-aware review (optional).' }
            },
            required: ['filePath', 'content']
          }
        },
        diffAware: { type: 'boolean', default: false }
      },
      required: ['files']
    }
  },
  {
    name:        'aqt_report',
    description: 'Generate a formatted report from analysis or review results.',
    inputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array',  description: 'Results from aqt_analyze or aqt_review.' },
        format:  { type: 'string', enum: ['json', 'markdown', 'sarif'], default: 'json' }
      },
      required: ['results']
    }
  },
  {
    name:        'aqt_health',
    description: 'Return current provider availability, model status, and capability list.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  // AI Generation Tools (P11-T058)
  {
    name:        'aqt_ai_generate_code',
    description: 'Generate code from natural language description using AI.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Natural language description of code to generate.' },
        language:    { type: 'string', default: 'javascript', description: 'Programming language (javascript, python, etc.).' },
        framework:   { type: 'string', description: 'Framework to use (optional).' },
        provider:    { type: 'string', enum: ['openai', 'anthropic', 'google', 'ollama'], description: 'AI provider (optional).' },
        model:       { type: 'string', description: 'Model name (optional).' }
      },
      required: ['description']
    }
  },
  {
    name:        'aqt_ai_generate_test',
    description: 'Generate unit tests for a code file using AI.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the file to generate tests for.' },
        content:  { type: 'string', description: 'File content (if not provided, will be read from filePath).' },
        framework: { type: 'string', default: 'jest', description: 'Testing framework (jest, mocha, pytest, etc.).' },
        provider:  { type: 'string', enum: ['openai', 'anthropic', 'google', 'ollama'], description: 'AI provider (optional).' }
      },
      required: ['filePath']
    }
  },
  {
    name:        'aqt_ai_generate_doc',
    description: 'Generate documentation for a code file using AI.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the file to document.' },
        content:  { type: 'string', description: 'File content (if not provided, will be read from filePath).' },
        format:   { type: 'string', default: 'markdown', enum: ['markdown', 'jsdoc', 'restructured-text'], description: 'Documentation format.' },
        provider: { type: 'string', enum: ['openai', 'anthropic', 'google', 'ollama'], description: 'AI provider (optional).' }
      },
      required: ['filePath']
    }
  },
  {
    name:        'aqt_ai_fix_issue',
    description: 'Generate AI-powered fix for a specific code issue.',
    inputSchema: {
      type: 'object',
      properties: {
        issue:    { type: 'object', description: 'Issue object from aqt_analyze.' },
        issueId:  { type: 'string', description: 'Issue ID (alternative to issue object).' },
        dryRun:   { type: 'boolean', default: false, description: 'Preview fix without applying.' },
        provider: { type: 'string', enum: ['openai', 'anthropic', 'google', 'ollama'], description: 'AI provider (optional).' }
      },
      required: []
    }
  },
  {
    name:        'aqt_ai_refactor',
    description: 'Refactor code using AI guidance.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath:    { type: 'string', description: 'Path to the file to refactor.' },
        content:     { type: 'string', description: 'File content (if not provided, will be read from filePath).' },
        description: { type: 'string', description: 'Description of refactoring goal.' },
        autoApply:   { type: 'boolean', default: false, description: 'Automatically apply refactoring.' },
        provider:    { type: 'string', enum: ['openai', 'anthropic', 'google', 'ollama'], description: 'AI provider (optional).' }
      },
      required: ['filePath', 'description']
    }
  },
  {
    name:        'aqt_ai_configure',
    description: 'Configure AI provider settings.',
    inputSchema: {
      type: 'object',
      properties: {
        provider:      { type: 'string', enum: ['openai', 'anthropic', 'google', 'ollama'], description: 'AI provider to configure.' },
        model:         { type: 'string', description: 'Model name.' },
        maxCost:       { type: 'number', description: 'Maximum cost per request ($USD).' },
        monthlyBudget: { type: 'number', description: 'Monthly budget ($USD).' }
      },
      required: []
    }
  },
  {
    name:        'aqt_ai_cost_tracking',
    description: 'Get AI usage cost tracking information.',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['day', 'week', 'month', 'all'], default: 'month', description: 'Time period for cost tracking.' }
      },
      required: []
    }
  },
  // Agent System Tools (P11-T007)
  {
    name:        'aqt_agent_start',
    description: 'Start autonomous agent work on a project. Returns work ID for tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Description of work for the agent to perform.' },
        workspace:   { type: 'string', description: 'Workspace path (default: current directory).' },
        priority:    { type: 'string', enum: ['critical', 'high', 'medium', 'low'], default: 'medium', description: 'Work priority level.' },
        maxFiles:    { type: 'number', default: 50, description: 'Maximum files the agent can modify.' },
        maxIterations: { type: 'number', default: 10, description: 'Maximum iterations for agent.' },
        autoApprove: { type: 'boolean', default: false, description: 'Automatically approve high-risk operations.' }
      },
      required: ['description']
    }
  },
  {
    name:        'aqt_agent_status',
    description: 'Get the status of a running or completed agent work item.',
    inputSchema: {
      type: 'object',
      properties: {
        workId: { type: 'string', description: 'Work ID returned from aqt_agent_start.' }
      },
      required: ['workId']
    }
  },
  {
    name:        'aqt_agent_list',
    description: 'List all agent work items (active, completed, and failed).',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['running', 'completed', 'failed', 'paused', 'all'], default: 'all', description: 'Filter by status.' },
        limit:  { type: 'number', default: 50, description: 'Maximum number of results.' }
      },
      required: []
    }
  },
  {
    name:        'aqt_agent_cancel',
    description: 'Cancel a running agent work item.',
    inputSchema: {
      type: 'object',
      properties: {
        workId: { type: 'string', description: 'Work ID to cancel.' }
      },
      required: ['workId']
    }
  },
  // Pipeline System Tools (P11-T008)
  {
    name:        'aqt_pipeline_list',
    description: 'List all available pipelines that can be executed.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name:        'aqt_pipeline_execute',
    description: 'Execute a pipeline and return execution ID for tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        pipelineName: { type: 'string', description: 'Name of the pipeline to execute.' },
        workspace:    { type: 'string', description: 'Workspace path (default: current directory).' },
        input:        { type: 'object', description: 'Pipeline input data (optional).' },
        dryRun:       { type: 'boolean', default: false, description: 'Execute without persisting changes.' },
        autoApprove:  { type: 'boolean', default: false, description: 'Auto-approve all stages.' }
      },
      required: ['pipelineName']
    }
  },
  {
    name:        'aqt_pipeline_status',
    description: 'Get the execution status of a pipeline run.',
    inputSchema: {
      type: 'object',
      properties: {
        executionId: { type: 'string', description: 'Execution ID returned from aqt_pipeline_execute.' }
      },
      required: ['executionId']
    }
  },
  {
    name:        'aqt_pipeline_info',
    description: 'Get detailed information about a pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        pipelineName: { type: 'string', description: 'Name of the pipeline.' }
      },
      required: ['pipelineName']
    }
  },
  // Security Tools (P11-T009)
  {
    name:        'aqt_security_scan',
    description: 'Run comprehensive security scan (vulnerabilities, secrets, dependencies).',
    inputSchema: {
      type: 'object',
      properties: {
        workspace:  { type: 'string', description: 'Workspace path (default: current directory).' },
        scanTypes:  { type: 'array', items: { type: 'string', enum: ['vuln', 'secrets', 'deps'] }, default: ['vuln', 'secrets', 'deps'], description: 'Types of scans to run.' },
        severity:   { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Minimum severity level (optional).' }
      },
      required: []
    }
  },
  {
    name:        'aqt_security_vulnerabilities',
    description: 'Scan for code vulnerabilities (CWE-based detection).',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace path (default: current directory).' },
        severity:  { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Minimum severity level (optional).' }
      },
      required: []
    }
  },
  {
    name:        'aqt_security_secrets',
    description: 'Scan for hardcoded secrets (API keys, passwords, tokens).',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace path (default: current directory).' }
      },
      required: []
    }
  },
  {
    name:        'aqt_security_dependencies',
    description: 'Check dependencies for known security vulnerabilities (CVE).',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace path (default: current directory).' }
      },
      required: []
    }
  },
  {
    name: 'aqt_dashboard_configure',
    description: 'Enable or configure local-only dashboard metrics recording.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        dataDir: { type: 'string' }
      },
      required: []
    }
  },
  {
    name: 'aqt_dashboard_record_metrics',
    description: 'Record analysis results in local dashboard history when recording is enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array', items: { type: 'object' } },
        metadata: { type: 'object' }
      },
      required: ['results']
    }
  },
  {
    name: 'aqt_dashboard_status',
    description: 'Get local dashboard configuration and current metrics.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'aqt_plugin_list',
    description: 'List plugins available in the configured workspace.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'aqt_plugin_install',
    description: 'Install a trusted local plugin path from inside the configured workspace.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'aqt_plugin_remove',
    description: 'Unload and remove an installed plugin by ID.',
    inputSchema: {
      type: 'object',
      properties: { pluginId: { type: 'string' } },
      required: ['pluginId']
    }
  },
  {
    name: 'aqt_plugin_info',
    description: 'Get the manifest and runtime status for a loaded plugin.',
    inputSchema: {
      type: 'object',
      properties: { pluginId: { type: 'string' } },
      required: ['pluginId']
    }
  },
  {
    name: 'aqt_plugin_execute_hook',
    description: 'Execute a named hook from trusted, loaded plugins.',
    inputSchema: {
      type: 'object',
      properties: { hookName: { type: 'string' }, data: {} },
      required: ['hookName']
    }
  }
];

MCP_TOOLS.forEach(tool => {
  const groups = getMcpToolGroups(tool.name);
  if (groups.length > 0) {
    tool.description = `[${groups.map(group => group.name).join(', ')}] ${tool.description}`;
  }
});
MCP_TOOLS.push({
  name: 'aqt_tools_list',
  description: '[Tool Groups] List AQT capabilities grouped consistently across the CLI, HTTP API, and MCP. Optionally filter by group ID.',
  inputSchema: {
    type: 'object',
    properties: {
      group: { type: 'string', description: 'Optional group ID: quality, security, ai, agents, pipelines, workspace, insights, or extensions.' }
    },
    required: []
  }
});

// ─── MCP Adapter ─────────────────────────────────────────────────────────────

class MCPServer extends InterfaceAdapter {
  /**
   * @param {object} [config={}]
   * @param {object} [config.transport] - Transport instance (defaults to stdio)
   * @param {boolean} [config.verbose=false]
   * @param {object} [config.rateLimit] - Rate limiting configuration
   */
  constructor(config = {}) {
    super(config);
    // MCP message ID counter for request/response correlation
    this._msgId    = 0;
    this._transport = config.transport || null; // injected for testing
    this.workspace = path.resolve(config.projectRoot || process.cwd());
    this.pluginManager = null;
    this.pluginManagerInitialization = null;
    
    // Rate limiting configuration
    this._rateLimit = config.rateLimit || {
      enabled: true,
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 60 // 60 requests per minute per client
    };
    this._rateLimitStore = new Map(); // Store for tracking requests
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    await super.start();
    this._log('MCP server ready — listening on stdio');

    if (this._transport) {
      // Injected transport (tests or custom hosts)
      this._transport.onMessage = (msg) => this._handleMessage(msg);
      this._transport.start?.();
    } else {
      // Default: stdio transport (standard MCP pattern)
      this._startStdioTransport();
    }
  }

  async stop() {
    await super.stop();
    this._log('MCP server stopped');
  }

  // ─── Stdio transport ───────────────────────────────────────────────────────

  /**
   * Set up stdio-based JSON-RPC transport.
   * Reads newline-delimited JSON from stdin, writes responses to stdout.
   */
  _startStdioTransport() {
    let buffer = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      // Process all complete newline-terminated messages
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep the last incomplete line in the buffer
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          this._handleMessage(msg).then(response => {
            if (response) process.stdout.write(JSON.stringify(response) + '\n');
          });
        } catch (e) {
          this._writeError(null, -32700, `Parse error: ${e.message}`);
        }
      }
    });

    process.stdin.on('end', () => { this.stop(); });

    // Send MCP server capabilities on startup (initialize handshake)
    this._sendInitialize();
  }

  /** Send the MCP initialize notification with supported capabilities */
  _sendInitialize() {
    const notification = {
      jsonrpc: '2.0',
      method:  'notifications/initialized',
      params:  {
        protocolVersion: '2024-11-05',
        capabilities:    { tools: {} },
        serverInfo:      { name: 'advanced-quality-tool', version: '1.0.0' }
      }
    };
    process.stdout.write(JSON.stringify(notification) + '\n');
  }

  // ─── Message dispatch ──────────────────────────────────────────────────────

  /**
   * Handle an incoming MCP JSON-RPC message.
   * Returns a response object (or null for notifications).
   *
   * @param {object} msg - Parsed JSON-RPC message
   * @returns {Promise<object|null>}
   */
  async _handleMessage(msg) {
    const { id, method, params } = msg;

    // Apply rate limiting for tool calls
    if (method === 'tools/call' && this._rateLimit.enabled) {
      const rateLimitResult = this._checkRateLimit(params?.name || 'unknown');
      if (rateLimitResult.limited) {
        return this._jsonrpcError(id, 429, 
          `Rate limit exceeded. Maximum ${this._rateLimit.maxRequests} requests per ${this._rateLimit.windowMs / 1000} seconds. Retry after ${rateLimitResult.retryAfter}s`);
      }
    }

    // ── MCP standard methods ─────────────────────────────────────────────────
    if (method === 'initialize') {
      return this._jsonrpc(id, {
        protocolVersion: '2024-11-05',
        capabilities:    { tools: {} },
        serverInfo:      { name: 'advanced-quality-tool', version: '1.0.0' }
      });
    }

    if (method === 'tools/list') {
      return this._jsonrpc(id, { tools: MCP_TOOLS });
    }

    if (method === 'tools/call') {
      return this._handleToolCall(id, params);
    }

    if (method === 'ping') {
      return this._jsonrpc(id, {});
    }

    // Notification methods (no response needed)
    if (method?.startsWith('notifications/')) return null;

    return this._jsonrpcError(id, -32601, `Method not found: ${method}`);
  }

  /**
   * Check rate limit using sliding window algorithm
   * @param {string} toolName - Name of the tool being called
   * @returns {{ limited: boolean, retryAfter?: number }}
   */
  _checkRateLimit(toolName) {
    const now = Date.now();
    const windowMs = this._rateLimit.windowMs;
    const maxRequests = this._rateLimit.maxRequests;
    
    // Use tool name as identifier (in real scenarios, you might use client ID)
    const identifier = `tool:${toolName}`;

    // Get or initialize request log
    if (!this._rateLimitStore.has(identifier)) {
      this._rateLimitStore.set(identifier, []);
    }

    const requestLog = this._rateLimitStore.get(identifier);

    // Remove requests outside the current window
    const windowStart = now - windowMs;
    const recentRequests = requestLog.filter(timestamp => timestamp > windowStart);
    this._rateLimitStore.set(identifier, recentRequests);

    // Check if limit exceeded
    if (recentRequests.length >= maxRequests) {
      const oldestRequest = Math.min(...recentRequests);
      const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);
      return { limited: true, retryAfter };
    }

    // Add current request
    recentRequests.push(now);
    this._rateLimitStore.set(identifier, recentRequests);

    return { limited: false };
  }

  /**
   * Handle a tools/call request — validate input, dispatch to services, format output.
   * @param {string|number} id     - JSON-RPC request ID
   * @param {object}        params - { name, arguments }
   */
  async _handleToolCall(id, params) {
    const toolName = params?.name;
    const args     = params?.arguments || {};

    // Validate tool exists
    const toolDef = MCP_TOOLS.find(t => t.name === toolName);
    if (!toolDef) {
      return this._jsonrpcError(id, -32602, `Unknown tool: ${toolName}`);
    }

    // Validate required inputs
    const missing = (toolDef.inputSchema.required || []).filter(k => args[k] === undefined);
    if (missing.length > 0) {
      return this._jsonrpcError(id, -32602,
        `Missing required arguments for ${toolName}: ${missing.join(', ')}`);
    }

    this._log(`Tool call: ${toolName}`);

    // Dispatch to shared services
    let serviceResult;
    switch (toolName) {
      case 'aqt_tools_list': {
        const group = args.group ? getToolGroup(args.group) : null;
        if (args.group && !group) {
          serviceResult = {
            success: false,
            error: `Unknown tool group '${args.group}'`,
            data: { availableGroups: listToolGroups().map(item => item.id) }
          };
        } else {
          serviceResult = { success: true, data: group || listToolGroups() };
        }
        break;
      }
      case 'aqt_analyze':
        serviceResult = await this.dispatch('analyze', {
          files:      args.files,
          categories: args.categories
        });
        break;
      case 'aqt_fix':
        serviceResult = await this.dispatch('fix', {
          issues:   args.issues,
          strategy: args.strategy || 'rule-first',
          dryRun:   args.dryRun   || false
        });
        break;
      case 'aqt_review':
        serviceResult = await this.dispatch('review', {
          files:    args.files,
          diffAware: args.diffAware || false
        });
        break;
      case 'aqt_report':
        serviceResult = await this.dispatch('generateReport', {
          results: args.results,
          format:  args.format || 'json'
        });
        break;
      case 'aqt_health':
        serviceResult = await this.dispatch('getHealth', {});
        break;
      // AI Generation Tools (P11-T058)
      case 'aqt_ai_generate_code':
        serviceResult = await this.dispatch('aiGenerateCode', {
          description: args.description,
          language:    args.language || 'javascript',
          framework:   args.framework,
          provider:    args.provider,
          model:       args.model
        });
        break;
      case 'aqt_ai_generate_test':
        serviceResult = await this.dispatch('aiGenerateTest', {
          filePath:  args.filePath,
          content:   args.content,
          framework: args.framework || 'jest',
          provider:  args.provider
        });
        break;
      case 'aqt_ai_generate_doc':
        serviceResult = await this.dispatch('aiGenerateDoc', {
          filePath: args.filePath,
          content:  args.content,
          format:   args.format || 'markdown',
          provider: args.provider
        });
        break;
      case 'aqt_ai_fix_issue':
        serviceResult = await this.dispatch('aiFixIssue', {
          issue:    args.issue,
          issueId:  args.issueId,
          dryRun:   args.dryRun || false,
          provider: args.provider
        });
        break;
      case 'aqt_ai_refactor':
        serviceResult = await this.dispatch('aiRefactor', {
          filePath:    args.filePath,
          content:     args.content,
          description: args.description,
          autoApply:   args.autoApply || false,
          provider:    args.provider
        });
        break;
      case 'aqt_ai_configure':
        serviceResult = await this.dispatch('aiConfigure', {
          provider:      args.provider,
          model:         args.model,
          maxCost:       args.maxCost,
          monthlyBudget: args.monthlyBudget
        });
        break;
      case 'aqt_ai_cost_tracking':
        serviceResult = await this.dispatch('aiCostTracking', {
          period: args.period || 'month'
        });
        break;
      // Agent System Tools (P11-T007)
      case 'aqt_agent_start':
        serviceResult = await this.dispatch('agentStart', {
          description: args.description,
          workspace: args.workspace || process.cwd(),
          priority: args.priority || 'medium',
          maxFiles: args.maxFiles || 50,
          maxIterations: args.maxIterations || 10,
          autoApprove: args.autoApprove || false
        });
        break;
      case 'aqt_agent_status':
        serviceResult = await this.dispatch('agentStatus', {
          workId: args.workId
        });
        break;
      case 'aqt_agent_list':
        serviceResult = await this.dispatch('agentList', {
          status: args.status || 'all',
          limit: args.limit || 50
        });
        break;
      case 'aqt_agent_cancel':
        serviceResult = await this.dispatch('agentCancel', {
          workId: args.workId
        });
        break;
      // Pipeline System Tools (P11-T008)
      case 'aqt_pipeline_list':
        serviceResult = await this.dispatch('pipelineList', {});
        break;
      case 'aqt_pipeline_execute':
        serviceResult = await this.dispatch('pipelineExecute', {
          pipelineName: args.pipelineName,
          workspace: args.workspace || process.cwd(),
          input: args.input || {},
          dryRun: args.dryRun || false,
          autoApprove: args.autoApprove || false
        });
        break;
      case 'aqt_pipeline_status':
        serviceResult = await this.dispatch('pipelineStatus', {
          executionId: args.executionId
        });
        break;
      case 'aqt_pipeline_info':
        serviceResult = await this.dispatch('pipelineInfo', {
          pipelineName: args.pipelineName
        });
        break;
      // Security Tools (P11-T009)
      case 'aqt_security_scan':
        serviceResult = await this.dispatch('securityScan', {
          workspace: args.workspace || process.cwd(),
          scanTypes: args.scanTypes || ['vuln', 'secrets', 'deps'],
          severity: args.severity
        });
        break;
      case 'aqt_security_vulnerabilities':
        serviceResult = await this.dispatch('securityVulnerabilities', {
          workspace: args.workspace || process.cwd(),
          severity: args.severity
        });
        break;
      case 'aqt_security_secrets':
        serviceResult = await this.dispatch('securitySecrets', {
          workspace: args.workspace || process.cwd()
        });
        break;
      case 'aqt_security_dependencies':
        serviceResult = await this.dispatch('securityDependencies', {
          workspace: args.workspace || process.cwd()
        });
        break;
      case 'aqt_dashboard_configure':
        serviceResult = this._configureDashboard(args);
        break;
      case 'aqt_dashboard_record_metrics':
        serviceResult = this._recordDashboardMetrics(args);
        break;
      case 'aqt_dashboard_status':
        serviceResult = this._getDashboardStatus();
        break;
      case 'aqt_plugin_list':
        serviceResult = await this._listPlugins();
        break;
      case 'aqt_plugin_install':
        serviceResult = await this._installPlugin(args.path);
        break;
      case 'aqt_plugin_remove':
        serviceResult = await this._removePlugin(args.pluginId);
        break;
      case 'aqt_plugin_info':
        serviceResult = await this._getPluginInfo(args.pluginId);
        break;
      case 'aqt_plugin_execute_hook':
        serviceResult = await this._executePluginHook(args.hookName, args.data);
        break;
      default:
        return this._jsonrpcError(id, -32601, `Unhandled tool: ${toolName}`);
    }

    // Translate result to MCP tool response format
    return this._jsonrpc(id, this._translateOutput(serviceResult));
  }

  _configureDashboard(updates) {
    const config = loadDashboardConfig(this.workspace);
    if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
      return { success: false, error: 'enabled must be a boolean' };
    }
    if (updates.port !== undefined &&
        (!Number.isInteger(updates.port) || updates.port < 1 || updates.port > 65535)) {
      return { success: false, error: 'port must be an integer between 1 and 65535' };
    }
    if (updates.enabled !== undefined) config.enabled = updates.enabled;
    if (updates.port !== undefined) config.port = updates.port;
    if (typeof updates.dataDir === 'string' && updates.dataDir.trim()) {
      config.dataDir = path.resolve(this.workspace, updates.dataDir);
    }
    saveDashboardConfig(this.workspace, config);
    return { success: true, data: config };
  }

  _getDashboard(config = loadDashboardConfig(this.workspace)) {
    return new DashboardIntegration({ port: config.port, dataDir: config.dataDir });
  }

  _recordDashboardMetrics({ results, metadata = {} }) {
    if (!Array.isArray(results)) return { success: false, error: 'results must be an array' };
    const config = loadDashboardConfig(this.workspace);
    if (!config.enabled) return { success: false, error: 'Dashboard recording is disabled' };
    return { success: true, data: this._getDashboard(config).recordScan(results, metadata) };
  }

  _getDashboardStatus() {
    const config = loadDashboardConfig(this.workspace);
    return {
      success: true,
      data: { enabled: config.enabled, port: config.port, ...this._getDashboard(config).getDashboardData() }
    };
  }

  async _getPluginManager() {
    if (!this.pluginManager) {
      this.pluginManager = new PluginManager({
        pluginDirs: [path.join(this.workspace, '.aqt', 'plugins')]
      });
    }
    if (!this.pluginManagerInitialization) {
      this.pluginManagerInitialization = this.pluginManager.initialize();
    }
    await this.pluginManagerInitialization;
    return this.pluginManager;
  }

  async _listPlugins() {
    const manager = await this._getPluginManager();
    return { success: true, data: { plugins: manager.listPlugins(), stats: manager.getStats() } };
  }

  async _installPlugin(sourcePath) {
    const source = path.resolve(this.workspace, sourcePath);
    const relative = path.relative(this.workspace, source);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return { success: false, error: 'Plugin source must be inside the configured workspace' };
    }
    const sourceStat = await fs.stat(source);
    if (!sourceStat.isFile() && !sourceStat.isDirectory()) {
      return { success: false, error: 'Plugin source must be a file or directory' };
    }
    const pluginDirectory = path.join(this.workspace, '.aqt', 'plugins');
    await fs.mkdir(pluginDirectory, { recursive: true });
    const destination = path.join(pluginDirectory, path.basename(source));
    await fs.cp(source, destination, { recursive: true, errorOnExist: true });
    const manager = await this._getPluginManager();
    await manager.loadPlugin(destination);
    return { success: true, data: { path: destination, plugins: manager.listPlugins() } };
  }

  async _removePlugin(pluginId) {
    const manager = await this._getPluginManager();
    const pluginPath = manager.pluginPaths.get(pluginId);
    if (!pluginPath) return { success: false, error: `Plugin not found: ${pluginId}` };
    const pluginRoot = path.join(this.workspace, '.aqt', 'plugins');
    const relative = path.relative(pluginRoot, path.resolve(pluginPath));
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return { success: false, error: 'Refusing to remove a plugin outside the managed plugin directory' };
    }
    if (!(await manager.removePlugin(pluginId))) {
      return { success: false, error: `Plugin could not be unloaded: ${pluginId}` };
    }
    await fs.rm(pluginPath, { recursive: true, force: false });
    return { success: true, data: { removed: pluginId } };
  }

  async _getPluginInfo(pluginId) {
    const manager = await this._getPluginManager();
    const plugin = manager.getPlugin(pluginId);
    if (!plugin) return { success: false, error: `Plugin not found or disabled: ${pluginId}` };
    return { success: true, data: { ...plugin.manifest, path: plugin.path, enabled: true } };
  }

  async _executePluginHook(hookName, data) {
    const manager = await this._getPluginManager();
    return { success: true, data: await manager.executeHook(hookName, data) };
  }

  // ─── InterfaceAdapter contract ────────────────────────────────────────────

  /**
   * Translate raw MCP params to operation request (used by base dispatch).
   * @param {object} rawInput - { name, arguments }
   * @returns {{ operation, params }}
   */
  _translateInput(rawInput) {
    const map = {
      aqt_analyze: 'analyze',
      aqt_fix:     'fix',
      aqt_review:  'review',
      aqt_report:  'generateReport',
      aqt_health:  'getHealth'
    };
    return { operation: map[rawInput.name] || rawInput.name, params: rawInput.arguments || {} };
  }

  /**
   * Translate a ServiceResult into an MCP content array.
   * MCP tool results must be: { content: [{ type, text }], isError? }
   *
   * @param {object} serviceResult
   * @returns {{ content: object[], isError?: boolean }}
   */
  _translateOutput(serviceResult) {
    if (!serviceResult.success) {
      const err = this._translateError(serviceResult);
      return {
        content:  [{ type: 'text', text: JSON.stringify(err, null, 2) }],
        isError:  true
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(serviceResult.data, null, 2) }]
    };
  }

  // ─── JSON-RPC helpers ──────────────────────────────────────────────────────

  _jsonrpc(id, result) {
    return { jsonrpc: '2.0', id, result };
  }

  _jsonrpcError(id, code, message) {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  _writeError(id, code, message) {
    const msg = JSON.stringify(this._jsonrpcError(id, code, message));
    process.stdout.write(msg + '\n');
  }

  _log(msg) { if (this.verbose) console.error(`[MCPServer] ${msg}`); }
}

// ─── Standalone entry point ───────────────────────────────────────────────────

/**
 * Start the MCP server when run directly.
 * Configuration is read from environment variables.
 */
async function main() {
  const server = new MCPServer({
    appConfig: {
      projectRoot: process.env.AQT_PROJECT_ROOT || process.cwd(),
      verbose:     process.env.AQT_VERBOSE === 'true',
      policy: {
        localOnly:          process.env.AQT_LOCAL_ONLY === 'true',
        allowCloudFallback: process.env.AQT_ALLOW_CLOUD_FALLBACK === 'true'
      }
    },
    verbose: process.env.AQT_VERBOSE === 'true'
  });

  // Graceful shutdown on SIGINT/SIGTERM
  const shutdown = async () => { await server.stop(); process.exit(0); };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  await server.start();
}

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });

module.exports = { MCPServer, MCP_TOOLS };

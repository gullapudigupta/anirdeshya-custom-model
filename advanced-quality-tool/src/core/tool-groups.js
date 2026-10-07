'use strict';

const TOOL_GROUPS = [
  {
    id: 'quality',
    name: 'Code Quality',
    description: 'Analyze, categorize, review, fix, and report code quality issues.',
    cliCommands: ['analyze', 'categorize', 'fix', 'generate-fixes', 'metrics', 'report'],
    apiEndpoints: [
      'POST /api/analyze',
      'POST /api/fix',
      'POST /api/generate-fixes',
      'POST /api/issues/batch-fix',
      'GET /api/reports',
      'GET /api/reports/:id'
    ],
    mcpTools: ['aqt_analyze', 'aqt_fix', 'aqt_review', 'aqt_report', 'aqt_health']
  },
  {
    id: 'security',
    name: 'Security',
    description: 'Scan workspaces for vulnerabilities, secrets, and dependency risks.',
    cliCommands: ['security'],
    apiEndpoints: [
      'POST /api/security/scan',
      'GET /api/security/vulnerabilities',
      'GET /api/security/secrets',
      'GET /api/security/dependencies'
    ],
    mcpTools: [
      'aqt_security_scan',
      'aqt_security_vulnerabilities',
      'aqt_security_secrets',
      'aqt_security_dependencies'
    ]
  },
  {
    id: 'ai',
    name: 'AI Assistance',
    description: 'Generate and improve code, tests, documentation, and fixes with configured AI providers.',
    cliCommands: ['ai'],
    apiEndpoints: [
      'POST /api/ai/generate/code',
      'POST /api/ai/generate/test',
      'POST /api/ai/generate/doc',
      'POST /api/ai/fix',
      'POST /api/ai/refactor',
      'POST /api/ai/configure',
      'GET /api/ai/config',
      'GET /api/ai/cost'
    ],
    mcpTools: [
      'aqt_ai_generate_code',
      'aqt_ai_generate_test',
      'aqt_ai_generate_doc',
      'aqt_ai_fix_issue',
      'aqt_ai_refactor',
      'aqt_ai_configure',
      'aqt_ai_cost_tracking'
    ]
  },
  {
    id: 'agents',
    name: 'Agent Work',
    description: 'Start and manage autonomous agent work items.',
    cliCommands: ['agent'],
    apiEndpoints: [
      'POST /api/agent/start',
      'GET /api/agent',
      'GET /api/agent/:id',
      'DELETE /api/agent/:id',
      'POST /api/agent/:id/approve',
      'POST /api/agent/:id/pause',
      'POST /api/agent/:id/resume',
      'GET /api/agent/:id/logs'
    ],
    mcpTools: [
      'aqt_agent_start',
      'aqt_agent_status',
      'aqt_agent_list',
      'aqt_agent_cancel',
      'aqt_agent_approve'
    ]
  },
  {
    id: 'pipelines',
    name: 'Pipelines',
    description: 'Discover, run, inspect, and replay quality pipelines.',
    cliCommands: ['pipeline'],
    apiEndpoints: [
      'GET /api/pipelines',
      'GET /api/pipelines/:name',
      'POST /api/pipelines/:name/execute',
      'GET /api/pipelines/executions',
      'GET /api/pipelines/executions/:id',
      'DELETE /api/pipelines/executions/:id',
      'POST /api/pipelines/executions/:id/replay'
    ],
    mcpTools: [
      'aqt_pipeline_list',
      'aqt_pipeline_execute',
      'aqt_pipeline_status',
      'aqt_pipeline_info'
    ]
  },
  {
    id: 'workspace',
    name: 'Workspace',
    description: 'Inspect and configure the active workspace and its files.',
    cliCommands: ['config', 'detect', 'watch'],
    apiEndpoints: [
      'POST /api/workspace/config',
      'GET /api/workspace/status',
      'GET /api/files',
      'GET /api/files/*'
    ],
    mcpTools: ['aqt_analyze']
  },
  {
    id: 'insights',
    name: 'Metrics and Insights',
    description: 'View quality dashboards and local usage analytics.',
    cliCommands: ['analytics', 'dashboard', 'monitor'],
    apiEndpoints: [
      'POST /api/dashboard/configure',
      'POST /api/dashboard/record',
      'GET /api/dashboard/status',
      'GET /api/dashboard/metrics'
    ],
    mcpTools: [
      'aqt_dashboard_configure',
      'aqt_dashboard_record_metrics',
      'aqt_dashboard_status'
    ]
  },
  {
    id: 'extensions',
    name: 'Extensions',
    description: 'Manage trusted workspace plugins and plugin hooks.',
    cliCommands: ['plugin'],
    apiEndpoints: [
      'GET /api/plugins',
      'POST /api/plugins/install',
      'GET /api/plugins/:id',
      'DELETE /api/plugins/:id',
      'POST /api/plugins/:id/enable',
      'POST /api/plugins/:id/disable'
    ],
    mcpTools: [
      'aqt_plugin_list',
      'aqt_plugin_install',
      'aqt_plugin_remove',
      'aqt_plugin_info',
      'aqt_plugin_execute_hook'
    ]
  }
];

function listToolGroups() {
  return TOOL_GROUPS.map(group => ({
    ...group,
    cliCommands: [...group.cliCommands],
    apiEndpoints: [...group.apiEndpoints],
    mcpTools: [...group.mcpTools]
  }));
}

function getToolGroup(groupId) {
  const group = TOOL_GROUPS.find(item => item.id === groupId);
  if (!group) return null;
  return {
    ...group,
    cliCommands: [...group.cliCommands],
    apiEndpoints: [...group.apiEndpoints],
    mcpTools: [...group.mcpTools]
  };
}

function getMcpToolGroup(toolName) {
  return TOOL_GROUPS.find(group => group.mcpTools.includes(toolName)) || null;
}

function getMcpToolGroups(toolName) {
  return TOOL_GROUPS.filter(group => group.mcpTools.includes(toolName));
}

module.exports = { TOOL_GROUPS, listToolGroups, getToolGroup, getMcpToolGroup, getMcpToolGroups };

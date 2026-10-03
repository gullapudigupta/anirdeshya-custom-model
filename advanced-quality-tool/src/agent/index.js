/**
 * Agent Planning and Work Orchestration (P9-T010, P9-T013, P9-T014, P9-T021, P9-T022)
 *
 * Complete agent system: work orchestration, planning, scope analysis, code generation,
 * tool registry, and security/permissions management.
 *
 * @module agent
 */

'use strict';

const { WorkItem, WorkItemStatus } = require('./work-item');
const { AgentPlanner } = require('./planner');
const { WorkOrchestrator } = require('./work-orchestrator');
const { ToolRegistry } = require('./tool-registry');
const { PermissionManager, ApprovalMode, RiskLevel } = require('./permissions');
const { TaskScopeAnalyzer, ScopeType, ScopeIssue } = require('./scope-analyzer');
const { CodeGenerator } = require('./code-generator');

module.exports = {
  // Work items
  WorkItem,
  WorkItemStatus,
  
  // Planning
  AgentPlanner,
  
  // Orchestration
  WorkOrchestrator,
  
  // Tools
  ToolRegistry,
  
  // Permissions & Security
  PermissionManager,
  ApprovalMode,
  RiskLevel,
  
  // Scope Analysis
  TaskScopeAnalyzer,
  ScopeType,
  ScopeIssue,
  
  // Code Generation
  CodeGenerator
};

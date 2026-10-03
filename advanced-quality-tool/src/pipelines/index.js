/**
 * Pipeline Infrastructure (P9-T024 through P9-T040)
 *
 * Central catalog, execution tracking, and orchestration for all pipelines.
 * Includes workspace quality analysis, auto-fix, AI issue resolution, security,
 * metrics, watch, CLI, dashboard, documentation generation, and replay pipelines.
 *
 * @module pipelines
 */

'use strict';

const { PipelineRegistry, getRegistry } = require('./pipeline-registry');
const { ExecutionLedger, EventType, RunStatus, generateRunId } = require('./execution-ledger');
const { PipelineExecutor } = require('./pipeline-executor');
const { WorkspaceQualityAnalysis } = require('./workspace-quality-analysis');
const { AutoFixPipeline, FixStrategy } = require('./auto-fix-pipeline');
const { AIIssueResolutionPipeline } = require('./ai-issue-resolution-pipeline');
const { AICodeReviewPipeline, FindingTypes } = require('./ai-code-review-pipeline');
const { IssueEnrichmentPipeline, Categories, SeverityLevels, PriorityLevels } = require('./issue-enrichment-pipeline');
const { CIQualityGatePipeline, CIProviders, GateResults } = require('./ci-quality-gate-pipeline');
const { WatchAndFixPipeline, WatchEventType } = require('./watch-and-fix-pipeline');
const { LanguageAnalysisPipeline, LanguageStatus, PluginState } = require('./language-analysis-pipeline');
const { SecurityScanPipeline, SecuritySeverity, SecurityFindingType } = require('./security-scan-pipeline');
const { QualityMetricsPipeline, MetricCategory } = require('./quality-metrics-pipeline');
const { VSDiagnosticsPipeline, VSDiagnosticSeverity, CodeActionKind } = require('./vscode-diagnostics-pipeline');
const { ChatInteractionPipeline, MessageType, ConnectionState } = require('./chat-interaction-pipeline');
const { CLICommandPipeline, CommandType, OutputFormat } = require('./cli-command-pipeline');
const { DashboardReportingPipeline, TimePeriod } = require('./dashboard-reporting-pipeline');
const { PipelineReplayPipeline, ReplayMode, ComparisonResult } = require('./pipeline-replay-pipeline');
const { DocumentationGenerationPipeline, DocumentType, DocumentStatus } = require('./documentation-generation-pipeline');

module.exports = {
  // Registry
  PipelineRegistry,
  getRegistry,
  
  // Ledger
  ExecutionLedger,
  EventType,
  RunStatus,
  generateRunId,
  
  // Executor
  PipelineExecutor,
  
  // Analysis Pipelines (P9-T025, P9-T026)
  WorkspaceQualityAnalysis,
  IssueEnrichmentPipeline,
  Categories,
  SeverityLevels,
  PriorityLevels,
  
  // Fix Pipelines (P9-T027, P9-T030)
  AutoFixPipeline,
  FixStrategy,
  WatchAndFixPipeline,
  WatchEventType,
  
  // AI Pipelines (P9-T028, P9-T029)
  AIIssueResolutionPipeline,
  AICodeReviewPipeline,
  FindingTypes,
  
  // CI/Quality Pipelines (P9-T031, P9-T034)
  CIQualityGatePipeline,
  CIProviders,
  GateResults,
  QualityMetricsPipeline,
  MetricCategory,
  
  // Language/Security Pipelines (P9-T032, P9-T033)
  LanguageAnalysisPipeline,
  LanguageStatus,
  PluginState,
  SecurityScanPipeline,
  SecuritySeverity,
  SecurityFindingType,
  
  // Extension/UI Pipelines (P9-T035, P9-T036, P9-T037)
  VSDiagnosticsPipeline,
  VSDiagnosticSeverity,
  CodeActionKind,
  ChatInteractionPipeline,
  MessageType,
  ConnectionState,
  CLICommandPipeline,
  CommandType,
  OutputFormat,
  
  // Reporting Pipelines (P9-T038, P9-T039, P9-T040)
  DashboardReportingPipeline,
  TimePeriod,
  PipelineReplayPipeline,
  ReplayMode,
  ComparisonResult,
  DocumentationGenerationPipeline,
  DocumentType,
  DocumentStatus
};

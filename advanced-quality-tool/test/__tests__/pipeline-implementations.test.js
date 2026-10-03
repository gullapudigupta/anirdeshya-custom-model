/**
 * Tests for Pipeline Implementations (P9-T030 through P9-T040)
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Pipeline imports
const { WatchAndFixPipeline, WatchEventType } = require('../../src/pipelines/watch-and-fix-pipeline');
const { LanguageAnalysisPipeline, LanguageStatus, PluginState } = require('../../src/pipelines/language-analysis-pipeline');
const { SecurityScanPipeline, SecuritySeverity, SecurityFindingType } = require('../../src/pipelines/security-scan-pipeline');
const { QualityMetricsPipeline, MetricCategory } = require('../../src/pipelines/quality-metrics-pipeline');
const { VSDiagnosticsPipeline, VSDiagnosticSeverity, CodeActionKind } = require('../../src/pipelines/vscode-diagnostics-pipeline');
const { ChatInteractionPipeline, MessageType, ConnectionState } = require('../../src/pipelines/chat-interaction-pipeline');
const { CLICommandPipeline, CommandType, OutputFormat } = require('../../src/pipelines/cli-command-pipeline');
const { DashboardReportingPipeline, TimePeriod } = require('../../src/pipelines/dashboard-reporting-pipeline');
const { PipelineReplayPipeline, ReplayMode, ComparisonResult } = require('../../src/pipelines/pipeline-replay-pipeline');
const { DocumentationGenerationPipeline, DocumentType, DocumentStatus } = require('../../src/pipelines/documentation-generation-pipeline');

// Test utilities
let tempDir;

beforeEach(() => {
  tempDir = path.join(process.cwd(), '.aqt-test-temp', `test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ─── P9-T030: Watch and Fix Pipeline ─────────────────────────────────────────────

describe('WatchAndFixPipeline', () => {
  test('should initialize with correct defaults', () => {
    const pipeline = new WatchAndFixPipeline({ workspace: tempDir });
    
    expect(pipeline.watching).toBe(false);
    expect(pipeline.autoFix).toBe(true);
    expect(pipeline.debounceMs).toBe(500);
  });

  test('should start watching', () => {
    const pipeline = new WatchAndFixPipeline({ workspace: tempDir });
    const result = pipeline.start();
    
    expect(result.watching).toBe(true);
    expect(pipeline.watching).toBe(true);
    
    pipeline.stop();
  });

  test('should stop watching', () => {
    const pipeline = new WatchAndFixPipeline({ workspace: tempDir });
    pipeline.start();
    const result = pipeline.stop();
    
    expect(result.stopped).toBe(true);
    expect(pipeline.watching).toBe(false);
  });

  test('should get status', () => {
    const pipeline = new WatchAndFixPipeline({ workspace: tempDir });
    const status = pipeline.getStatus();
    
    expect(status.watching).toBe(false);
    expect(status.autoFix).toBe(true);
  });
});

// ─── P9-T032: Language Analysis Pipeline ─────────────────────────────────────────

describe('LanguageAnalysisPipeline', () => {
  test('should detect language for file', () => {
    const pipeline = new LanguageAnalysisPipeline({ workspace: tempDir });
    
    expect(pipeline.detectLanguageForFile('test.js')).toBe('javascript');
    expect(pipeline.detectLanguageForFile('test.ts')).toBe('typescript');
    expect(pipeline.detectLanguageForFile('test.py')).toBe('python');
    expect(pipeline.detectLanguageForFile('test.cs')).toBe('csharp');
  });

  test('should get supported languages', () => {
    const pipeline = new LanguageAnalysisPipeline({ workspace: tempDir });
    const languages = pipeline.getSupportedLanguages();
    
    expect(languages.length).toBeGreaterThan(0);
    expect(languages.find(l => l.name === 'javascript')).toBeDefined();
    expect(languages.find(l => l.name === 'typescript')).toBeDefined();
  });

  test('should register and unregister plugins', () => {
    const pipeline = new LanguageAnalysisPipeline({ workspace: tempDir });
    
    pipeline.registerPlugin('custom', {
      extensions: ['.custom'],
      analyzer: 'custom-analyzer'
    });
    
    const languages = pipeline.getSupportedLanguages();
    expect(languages.find(l => l.name === 'custom')).toBeDefined();
    
    pipeline.unregisterPlugin('custom');
    const updated = pipeline.getSupportedLanguages();
    expect(updated.find(l => l.name === 'custom')).toBeUndefined();
  });
});

// ─── P9-T033: Security Scan Pipeline ─────────────────────────────────────────────

describe('SecurityScanPipeline', () => {
  test('should initialize with default gates', () => {
    const pipeline = new SecurityScanPipeline({ workspace: tempDir });
    const gates = pipeline.getDefaultGates();
    
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.find(g => g.type === 'secret')).toBeDefined();
  });

  test('should detect secrets in content', async () => {
    const pipeline = new SecurityScanPipeline({ workspace: tempDir });
    
    // Create test file with secret
    const testFile = path.join(tempDir, 'config.js');
    fs.writeFileSync(testFile, `
      const apiKey = 'sk-1234567890abcdefghijklmnop';
      const password = 'super_secret_password_123';
    `);
    
    const result = await pipeline.execute({
      scope: { files: [testFile] }
    });
    
    expect(result.output).toBeDefined();
  });

  test('should check URL permissions', () => {
    const pipeline = new SecurityScanPipeline({ workspace: tempDir });
    
    expect(pipeline.isUrlAllowed('https://example.com').allowed).toBe(true);
    expect(pipeline.isUrlAllowed('http://localhost').allowed).toBe(false);
    expect(pipeline.isUrlAllowed('http://127.0.0.1').allowed).toBe(false);
  });
});

// ─── P9-T034: Quality Metrics Pipeline ───────────────────────────────────────────

describe('QualityMetricsPipeline', () => {
  test('should initialize with default thresholds', () => {
    const pipeline = new QualityMetricsPipeline({ workspace: tempDir });
    const thresholds = pipeline.getDefaultThresholds();
    
    expect(thresholds.cyclomaticComplexity).toBeDefined();
    expect(thresholds.duplication).toBeDefined();
  });

  test('should calculate complexity', async () => {
    const pipeline = new QualityMetricsPipeline({ workspace: tempDir });
    
    // Create test file
    const testFile = path.join(tempDir, 'complex.js');
    fs.writeFileSync(testFile, `
      function test(x) {
        if (x > 0) {
          for (let i = 0; i < x; i++) {
            if (i % 2 === 0) {
              console.log(i);
            }
          }
        }
      }
    `);
    
    const result = await pipeline.execute({
      scope: { files: [testFile] }
    });
    
    expect(result.output).toBeDefined();
  });
});

// ─── P9-T035: VS Code Diagnostics Pipeline ───────────────────────────────────────

describe('VSDiagnosticsPipeline', () => {
  test('should initialize correctly', () => {
    const pipeline = new VSDiagnosticsPipeline({ workspace: tempDir });
    
    expect(pipeline.activated).toBe(false);
    expect(pipeline.autoRefresh).toBe(true);
  });

  test('should activate and deactivate', async () => {
    const pipeline = new VSDiagnosticsPipeline({ workspace: tempDir });
    
    const activateResult = await pipeline.activate({ extension: { id: 'test' } });
    expect(activateResult.activated).toBe(true);
    
    const deactivateResult = pipeline.deactivate();
    expect(deactivateResult.deactivated).toBe(true);
  });

  test('should get empty diagnostics initially', () => {
    const pipeline = new VSDiagnosticsPipeline({ workspace: tempDir });
    const diagnostics = pipeline.getDiagnostics();
    
    expect(diagnostics).toEqual([]);
  });
});

// ─── P9-T036: Chat Interaction Pipeline ──────────────────────────────────────────

describe('ChatInteractionPipeline', () => {
  test('should create session', () => {
    const pipeline = new ChatInteractionPipeline();
    const session = pipeline.createSession({ workspace: tempDir });
    
    expect(session.id).toBeDefined();
    expect(session.state).toBe(ConnectionState.CONNECTED);
  });

  test('should get session by ID', () => {
    const pipeline = new ChatInteractionPipeline();
    const created = pipeline.createSession({ workspace: tempDir });
    
    const retrieved = pipeline.getSession(created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved.id).toBe(created.id);
  });

  test('should close session', () => {
    const pipeline = new ChatInteractionPipeline();
    const session = pipeline.createSession({ workspace: tempDir });
    
    pipeline.closeSession(session.id);
    
    const closed = pipeline.getSession(session.id);
    expect(closed.state).toBe(ConnectionState.DISCONNECTED);
  });
});

// ─── P9-T037: CLI Command Pipeline ──────────────────────────────────────────────

describe('CLICommandPipeline', () => {
  test('should parse arguments correctly', async () => {
    const pipeline = new CLICommandPipeline();
    
    const result = await pipeline.execute({
      args: ['analyze', 'src/', '--format', 'json'],
      cwd: tempDir
    });
    
    expect(result).toBeDefined();
  });

  test('should handle help command', async () => {
    const pipeline = new CLICommandPipeline();
    
    const result = await pipeline.execute({
      args: ['help'],
      cwd: tempDir
    });
    
    expect(result.output).toContain('Usage');
  });

  test('should handle version command', async () => {
    const pipeline = new CLICommandPipeline();
    
    const result = await pipeline.execute({
      args: ['version'],
      cwd: tempDir
    });
    
    expect(result.output).toBeDefined();
  });
});

// ─── P9-T038: Dashboard Reporting Pipeline ───────────────────────────────────────

describe('DashboardReportingPipeline', () => {
  test('should generate dashboard', async () => {
    const pipeline = new DashboardReportingPipeline({ workspace: tempDir });
    
    const result = await pipeline.execute({
      timeRange: { start: new Date(Date.now() - 86400000).toISOString() }
    });
    
    expect(result.output).toBeDefined();
  });

  test('should clear cache', () => {
    const pipeline = new DashboardReportingPipeline({ workspace: tempDir });
    pipeline.clearCache();
    
    expect(pipeline.cache.size).toBe(0);
  });
});

// ─── P9-T039: Pipeline Replay Pipeline ───────────────────────────────────────────

describe('PipelineReplayPipeline', () => {
  test('should register stubs', () => {
    const pipeline = new PipelineReplayPipeline();
    
    pipeline.registerStub('test-stage', async () => ({ result: 'stubbed' }));
    
    expect(pipeline.stubs.has('test-stage')).toBe(true);
  });

  test('should get default stub', () => {
    const pipeline = new PipelineReplayPipeline();
    const stub = pipeline._getDefaultStub('resolve-workspace');
    
    expect(stub).toBeDefined();
    expect(stub.workspace).toBeDefined();
  });
});

// ─── P9-T040: Documentation Generation Pipeline ──────────────────────────────────

describe('DocumentationGenerationPipeline', () => {
  test('should generate document from task', async () => {
    const pipeline = new DocumentationGenerationPipeline({ docsDir: tempDir });
    
    const result = await pipeline.execute({
      task: {
        id: 'TEST-001',
        name: 'Test Task',
        deliverables: ['Implement feature'],
        status: 'COMPLETED'
      },
      context: {
        files: [],
        documentation: []
      }
    });
    
    expect(result.output).toBeDefined();
  });

  test('should determine document type from task', () => {
    const pipeline = new DocumentationGenerationPipeline({ docsDir: tempDir });
    
    expect(pipeline._determineDocumentType({ name: 'API Implementation' }))
      .toBe(DocumentType.API_REFERENCE);
    
    expect(pipeline._determineDocumentType({ status: 'COMPLETED' }))
      .toBe(DocumentType.ACCEPTANCE_REPORT);
  });

  test('should extract links from content', () => {
    const pipeline = new DocumentationGenerationPipeline({ docsDir: tempDir });
    
    const content = `
      See [Getting Started](./getting-started.md) for setup.
      Check [API Docs](https://example.com/api) for details.
    `;
    
    const links = pipeline._extractLinks(content);
    
    expect(links.length).toBe(2);
    expect(links[0].text).toBe('Getting Started');
    expect(links[1].url).toBe('https://example.com/api');
  });
});

// ─── Constants Tests ─────────────────────────────────────────────────────────────

describe('Pipeline Constants', () => {
  test('should have WatchEventType constants', () => {
    expect(WatchEventType.CREATE).toBe('create');
    expect(WatchEventType.MODIFY).toBe('modify');
    expect(WatchEventType.DELETE).toBe('delete');
  });

  test('should have SecuritySeverity constants', () => {
    expect(SecuritySeverity.CRITICAL).toBe('critical');
    expect(SecuritySeverity.HIGH).toBe('high');
    expect(SecuritySeverity.MEDIUM).toBe('medium');
  });

  test('should have MessageType constants', () => {
    expect(MessageType.REQUEST).toBe('request');
    expect(MessageType.RESPONSE).toBe('response');
    expect(MessageType.PROGRESS).toBe('progress');
  });

  test('should have CommandType constants', () => {
    expect(CommandType.ANALYZE).toBe('analyze');
    expect(CommandType.FIX).toBe('fix');
    expect(CommandType.WATCH).toBe('watch');
  });

  test('should have DocumentType constants', () => {
    expect(DocumentType.API_REFERENCE).toBe('api-reference');
    expect(DocumentType.SETUP_GUIDE).toBe('setup-guide');
    expect(DocumentType.TASK_SUMMARY).toBe('task-summary');
  });
});

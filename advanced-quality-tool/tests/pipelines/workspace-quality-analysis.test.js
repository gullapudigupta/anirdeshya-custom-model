/**
 * Tests for Workspace Quality Analysis Pipeline (P9-T025)
 */

'use strict';

const { WorkspaceQualityAnalysis } = require('../../src/pipelines/workspace-quality-analysis');
const { PipelineExecutor } = require('../../src/pipelines/pipeline-executor');
const { getRegistry } = require('../../src/pipelines/pipeline-registry');
const { ExecutionLedger } = require('../../src/pipelines/execution-ledger');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('WorkspaceQualityAnalysis', () => {
  let tempDir;
  let testWorkspace;

  beforeEach(() => {
    // Create temp workspace
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-test-'));
    testWorkspace = path.join(tempDir, 'test-project');
    fs.mkdirSync(testWorkspace, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Pipeline Registration', () => {
    test('should have workspace-quality-analysis pipeline registered', () => {
      const registry = getRegistry();
      const pipeline = registry.get('workspace-quality-analysis');
      
      expect(pipeline).toBeDefined();
      expect(pipeline.id).toBe('workspace-quality-analysis');
      expect(pipeline.name).toBe('Workspace Quality Analysis');
      expect(pipeline.stages).toHaveLength(9);
    });

    test('should have correct stages in order', () => {
      const registry = getRegistry();
      const pipeline = registry.get('workspace-quality-analysis');
      
      expect(pipeline.stages).toEqual([
        'resolve-workspace',
        'detect-tools',
        'select-files',
        'run-linters',
        'collect-output',
        'normalize-issues',
        'deduplicate',
        'sort',
        'summarize'
      ]);
    });
  });

  describe('Workspace Resolution Stage', () => {
    test('should resolve workspace from explicit path', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      // Create package.json marker
      fs.writeFileSync(
        path.join(testWorkspace, 'package.json'),
        JSON.stringify({ name: 'test-project' })
      );

      const result = await analysis._resolveWorkspace({
        input: { workspaceHint: testWorkspace }
      });

      expect(result.workspaceRoot).toBe(testWorkspace);
      expect(result.source).toBe('explicit');
      expect(result.isMultiRoot).toBe(false);
    });

    test('should use default workspace when no hint provided', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      const result = await analysis._resolveWorkspace({
        input: { workspaceHint: null }
      });

      expect(result.workspaceRoot).toBeDefined();
      expect(result.source).toBe('default');
    });
  });

  describe('Tool Detection Stage', () => {
    test('should detect linters from package.json', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      // Create package.json with linters
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        devDependencies: {
          eslint: '^8.0.0',
          prettier: '^3.0.0'
        },
        scripts: {
          lint: 'eslint .',
          format: 'prettier --write .'
        }
      };

      fs.writeFileSync(
        path.join(testWorkspace, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = await analysis._detectTools({
        input: { workspaceRoot: testWorkspace }
      });

      expect(result.packageJson).toBeDefined();
      expect(result.packageJson.name).toBe('test-project');
      expect(result.commands.lint.length).toBeGreaterThan(0);
      expect(result.linters.available.length).toBeGreaterThan(0);
    });

    test('should handle missing package.json', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      const result = await analysis._detectTools({
        input: { workspaceRoot: testWorkspace }
      });

      expect(result.packageJson).toBeNull();
      expect(result.commands.lint).toEqual([]);
      expect(result.linters.available).toEqual([]);
      expect(result.metadata.name).toBe('unknown');
    });
  });

  describe('File Selection Stage', () => {
    test('should use explicitly requested files', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      const testFiles = [
        path.join(testWorkspace, 'file1.js'),
        path.join(testWorkspace, 'file2.js')
      ];

      // Create test files
      testFiles.forEach(f => fs.writeFileSync(f, '// test'));

      const result = await analysis._selectFiles({
        input: { requestedFiles: testFiles },
        previousResults: {
          'resolve-workspace': { workspaceRoot: testWorkspace },
          'detect-tools': { metadata: { hasTypeScript: false } }
        }
      });

      expect(result.files).toEqual(testFiles);
      expect(result.fileCount).toBe(2);
    });

    test('should auto-discover files when none specified', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      // Create src directory with files
      const srcDir = path.join(testWorkspace, 'src');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'index.js'), '// test');
      fs.writeFileSync(path.join(srcDir, 'utils.js'), '// test');

      const result = await analysis._selectFiles({
        input: { requestedFiles: [] },
        previousResults: {
          'resolve-workspace': { workspaceRoot: testWorkspace },
          'detect-tools': { metadata: { hasTypeScript: false } }
        }
      });

      expect(result.fileCount).toBe(2);
      expect(result.files.some(f => f.endsWith('index.js'))).toBe(true);
    });

    test('should filter out non-existent files', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      const testFiles = [
        path.join(testWorkspace, 'exists.js'),
        path.join(testWorkspace, 'notexists.js')
      ];

      fs.writeFileSync(testFiles[0], '// test');

      const result = await analysis._selectFiles({
        input: { requestedFiles: testFiles },
        previousResults: {
          'resolve-workspace': { workspaceRoot: testWorkspace },
          'detect-tools': { metadata: { hasTypeScript: false } }
        }
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toBe(testFiles[0]);
    });
  });

  describe('Issue Normalization Stage', () => {
    test('should normalize issues to standard format', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      const rawIssues = [
        {
          file: 'test.js',
          line: 10,
          column: 5,
          severity: 'error',
          message: 'Test error',
          rule: 'no-unused-vars',
          source: 'eslint'
        },
        {
          filePath: 'test2.js',
          startLine: 20,
          startColumn: 10,
          level: 'warning',
          message: 'Test warning',
          ruleId: 'semi',
          linter: 'eslint'
        }
      ];

      const result = await analysis._normalizeIssues({
        previousResults: {
          'collect-output': { rawIssues },
          'resolve-workspace': { workspaceRoot: testWorkspace }
        }
      });

      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].severity).toBe('error');
      expect(result.issues[0].rule).toBe('no-unused-vars');
      expect(result.issues[1].severity).toBe('warning');
      expect(result.issues[1].rule).toBe('semi');
    });

    test('should normalize severity values correctly', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      expect(analysis._normalizeSeverity('error')).toBe('error');
      expect(analysis._normalizeSeverity('2')).toBe('error');
      expect(analysis._normalizeSeverity('warning')).toBe('warning');
      expect(analysis._normalizeSeverity('warn')).toBe('warning');
      expect(analysis._normalizeSeverity('1')).toBe('warning');
      expect(analysis._normalizeSeverity('info')).toBe('info');
      expect(analysis._normalizeSeverity('0')).toBe('info');
      expect(analysis._normalizeSeverity('unknown')).toBe('warning');
    });
  });

  describe('Deduplication Stage', () => {
    test('should remove duplicate issues', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      const issues = [
        {
          file: 'test.js',
          line: 10,
          column: 5,
          rule: 'no-unused-vars',
          message: 'Variable is never used',
          severity: 'error'
        },
        {
          file: 'test.js',
          line: 10,
          column: 5,
          rule: 'no-unused-vars',
          message: 'Variable is never used',
          severity: 'error'
        },
        {
          file: 'test.js',
          line: 20,
          column: 5,
          rule: 'semi',
          message: 'Missing semicolon',
          severity: 'warning'
        }
      ];

      const result = await analysis._deduplicate({
        previousResults: {
          'normalize-issues': { issues }
        }
      });

      expect(result.issueCount).toBe(2);
      expect(result.duplicateCount).toBe(1);
    });
  });

  describe('Sorting Stage', () => {
    test('should sort by severity, file, line, column', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      const issues = [
        { file: 'b.js', line: 10, column: 5, severity: 'warning' },
        { file: 'a.js', line: 20, column: 10, severity: 'error' },
        { file: 'a.js', line: 10, column: 5, severity: 'error' },
        { file: 'a.js', line: 10, column: 10, severity: 'warning' }
      ];

      const result = await analysis._sort({
        previousResults: {
          'deduplicate': { issues }
        }
      });

      expect(result.issues[0]).toMatchObject({ file: 'a.js', line: 10, column: 5, severity: 'error' });
      expect(result.issues[1]).toMatchObject({ file: 'a.js', line: 20, column: 10, severity: 'error' });
      expect(result.issues[2]).toMatchObject({ file: 'a.js', line: 10, column: 10, severity: 'warning' });
      expect(result.issues[3]).toMatchObject({ file: 'b.js', line: 10, column: 5, severity: 'warning' });
    });
  });

  describe('Summarization Stage', () => {
    test('should generate summary and statistics', async () => {
      const analysis = new WorkspaceQualityAnalysis();
      
      const issues = [
        { file: 'a.js', line: 10, column: 5, severity: 'error', rule: 'no-unused-vars', fixable: true },
        { file: 'a.js', line: 20, column: 5, severity: 'warning', rule: 'semi', fixable: true },
        { file: 'b.js', line: 10, column: 5, severity: 'warning', rule: 'semi', fixable: false },
        { file: 'b.js', line: 15, column: 5, severity: 'info', rule: 'prefer-const', fixable: false }
      ];

      const result = await analysis._summarize({
        previousResults: {
          'sort': { issues },
          'resolve-workspace': { workspaceRoot: testWorkspace },
          'detect-tools': { metadata: { name: 'test-project', version: '1.0.0' } },
          'select-files': { files: ['a.js', 'b.js'], fileCount: 2 },
          'run-linters': { successCount: 1, errorCount: 0, totalLinters: 1 },
          'deduplicate': { duplicateCount: 0 }
        }
      });

      expect(result.summary.totalIssues).toBe(4);
      expect(result.summary.bySeverity.error).toBe(1);
      expect(result.summary.bySeverity.warning).toBe(2);
      expect(result.summary.bySeverity.info).toBe(1);
      expect(result.summary.fixableIssues).toBe(2);
      expect(result.stats.filesAnalyzed).toBe(2);
      expect(result.stats.issuesPerFile).toBe('2.00');
    });
  });

  describe('Full Pipeline Execution', () => {
    test('should execute complete pipeline with offline stubs', async () => {
      // Create a minimal test workspace
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        devDependencies: {
          eslint: '^8.0.0'
        }
      };

      fs.writeFileSync(
        path.join(testWorkspace, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create test source file
      const srcDir = path.join(testWorkspace, 'src');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, 'test.js'), '// test file');

      // Create stubbed executor that won't try to run actual linters
      const analysis = new WorkspaceQualityAnalysis();

      // Override _runLinters to return stubbed results
      analysis._runLinters = async (stageContext) => {
        return {
          results: [
            {
              linter: 'eslint',
              status: 'success',
              issueCount: 2,
              issues: [
                {
                  file: path.join(srcDir, 'test.js'),
                  line: 1,
                  column: 1,
                  severity: 'error',
                  message: 'Test error',
                  rule: 'no-unused-vars'
                },
                {
                  file: path.join(srcDir, 'test.js'),
                  line: 2,
                  column: 1,
                  severity: 'warning',
                  message: 'Test warning',
                  rule: 'semi'
                }
              ],
              duration: 100
            }
          ],
          errors: [],
          successCount: 1,
          errorCount: 0,
          totalLinters: 1
        };
      };

      const result = await analysis.analyze({
        workspace: testWorkspace,
        files: [],
        linters: [],
        taskId: 'TEST-001'
      });

      expect(result.status).toBe('completed');
      expect(result.output.issues).toBeDefined();
      expect(result.output.summary).toBeDefined();
      expect(result.output.stats).toBeDefined();
      expect(result.output.summary.totalIssues).toBe(2);
    });

    test('should record execution in ledger', async () => {
      const ledger = new ExecutionLedger({ storePath: tempDir });
      const executor = new PipelineExecutor({ ledger });
      const analysis = new WorkspaceQualityAnalysis({ executor });

      // Create minimal workspace
      fs.writeFileSync(
        path.join(testWorkspace, 'package.json'),
        JSON.stringify({ name: 'test' })
      );

      // Override _runLinters to avoid actual execution
      analysis._runLinters = async () => ({
        results: [],
        errors: [],
        successCount: 0,
        errorCount: 0,
        totalLinters: 0
      });

      const result = await analysis.analyze({
        workspace: testWorkspace,
        taskId: 'TEST-002'
      });

      const summary = ledger.getRunSummary(result.runId);
      
      expect(summary).toBeDefined();
      expect(summary.pipelineId).toBe('workspace-quality-analysis');
      expect(summary.taskId).toBe('TEST-002');
      expect(summary.status).toBe('completed');
    });
  });
});

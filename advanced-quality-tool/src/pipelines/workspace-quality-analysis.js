/**
 * Workspace Quality Analysis Pipeline (P9-T025)
 *
 * End-to-end analysis pipeline over the active workspace and selected files.
 * Uses the selected project's tools and package configuration rather than
 * the tool's own package configuration.
 *
 * Pipeline Stages:
 * 1. resolve-workspace: Resolve the active project root
 * 2. detect-tools: Discover available linters from package.json
 * 3. select-files: Determine which files to analyze
 * 4. run-linters: Execute selected linters
 * 5. collect-output: Gather all linter outputs
 * 6. normalize-issues: Convert to standard issue format
 * 7. deduplicate: Remove duplicate issues
 * 8. sort: Order issues by priority/severity
 * 9. summarize: Generate statistics and summary
 *
 * @module pipelines/workspace-quality-analysis
 */

'use strict';

const { WorkspaceResolver } = require('../workspace/workspace-resolver');
const { PackageConfigReader } = require('../workspace/package-config-reader');
const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');
const LinterOrchestrator = require('../integrations/linter-cli');
const path = require('path');
const fs = require('fs');

/**
 * Workspace Quality Analysis Pipeline Handler
 */
class WorkspaceQualityAnalysis {
  constructor(options = {}) {
    this.executor = options.executor || new PipelineExecutor(options);
    this.registry = options.registry || getRegistry();
  }

  /**
   * Execute the workspace quality analysis pipeline
   * @param {Object} params
   * @param {string} [params.workspace] - Explicit workspace path
   * @param {Array<string>} [params.files] - Specific files to analyze
   * @param {Array<string>} [params.linters] - Specific linters to run
   * @param {string} [params.taskId] - Associated task ID
   * @param {Object} [params.context] - Additional context
   * @param {Function} [params.onProgress] - Progress callback
   * @returns {Promise<Object>} Analysis result
   */
  async analyze(params = {}) {
    const {
      workspace = null,
      files = [],
      linters = [],
      taskId = null,
      context = {},
      onProgress = null
    } = params;

    // Build stage handlers
    const stageHandlers = {
      'resolve-workspace': this._resolveWorkspace.bind(this),
      'detect-tools': this._detectTools.bind(this),
      'select-files': this._selectFiles.bind(this),
      'run-linters': this._runLinters.bind(this),
      'collect-output': this._collectOutput.bind(this),
      'normalize-issues': this._normalizeIssues.bind(this),
      'deduplicate': this._deduplicate.bind(this),
      'sort': this._sort.bind(this),
      'summarize': this._summarize.bind(this)
    };

    // Execute pipeline
    const result = await this.executor.execute('workspace-quality-analysis', {
      input: {
        workspaceHint: workspace,
        requestedFiles: files,
        requestedLinters: linters
      },
      taskId,
      workspace,
      context,
      stageHandlers,
      onProgress
    });

    return result;
  }

  // ─── Stage Handlers ──────────────────────────────────────────────────────────

  /**
   * Stage 1: Resolve workspace root
   * @private
   */
  async _resolveWorkspace(stageContext) {
    const { input } = stageContext;
    const { workspaceHint } = input;

    const resolver = new WorkspaceResolver({
      defaultRoot: process.cwd()
    });

    const resolution = resolver.resolve({
      explicitPath: workspaceHint
    });

    if (!resolution.root) {
      throw new Error('Failed to resolve workspace root');
    }

    return {
      workspaceRoot: resolution.root,
      source: resolution.source,
      isMultiRoot: resolution.isMultiRoot,
      allRoots: resolution.allRoots || [resolution.root]
    };
  }

  /**
   * Stage 2: Detect available tools from package.json
   * @private
   */
  async _detectTools(stageContext) {
    const { input } = stageContext;
    const { workspaceRoot } = input;

    const packageReader = new PackageConfigReader({
      workspace: workspaceRoot
    });

    // Read package.json
    const packageJson = packageReader.read();
    if (!packageJson) {
      return {
        packageJson: null,
        commands: { lint: [], test: [], build: [], analyze: [] },
        linters: { available: [], unavailable: [] },
        metadata: {
          name: 'unknown',
          version: '0.0.0',
          type: 'unknown',
          hasTypeScript: false
        }
      };
    }

    // Discover available commands
    const commands = packageReader.discoverCommands();

    // Detect linters
    const linters = packageReader.detectLinters();

    // Get project metadata
    const metadata = packageReader.getProjectMetadata();

    return {
      packageJson,
      commands,
      linters,
      metadata
    };
  }

  /**
   * Stage 3: Select files to analyze
   * @private
   */
  async _selectFiles(stageContext) {
    const { input, previousResults } = stageContext;
    const { requestedFiles } = input;
    const { workspaceRoot } = previousResults['resolve-workspace'];
    const { metadata } = previousResults['detect-tools'];

    let filesToAnalyze = [];

    if (requestedFiles && requestedFiles.length > 0) {
      // Use explicitly requested files
      filesToAnalyze = requestedFiles.map(f => 
        path.isAbsolute(f) ? f : path.join(workspaceRoot, f)
      );
    } else {
      // Auto-discover files based on project type
      filesToAnalyze = await this._discoverProjectFiles(
        workspaceRoot,
        metadata.hasTypeScript
      );
    }

    // Filter out non-existent files
    filesToAnalyze = filesToAnalyze.filter(f => {
      try {
        return fs.existsSync(f) && fs.statSync(f).isFile();
      } catch {
        return false;
      }
    });

    return {
      files: filesToAnalyze,
      fileCount: filesToAnalyze.length
    };
  }

  /**
   * Stage 4: Run selected linters
   * @private
   */
  async _runLinters(stageContext) {
    const { input, previousResults } = stageContext;
    const { requestedLinters } = input;
    const { workspaceRoot } = previousResults['resolve-workspace'];
    const { linters } = previousResults['detect-tools'];
    const { files } = previousResults['select-files'];

    // Determine which linters to run
    let lintersToRun = [];
    if (requestedLinters && requestedLinters.length > 0) {
      // Use explicitly requested linters
      lintersToRun = requestedLinters;
    } else {
      // Use all available linters
      lintersToRun = linters.available.map(l => l.name);
    }

    // Initialize linter orchestrator
    const orchestrator = new LinterOrchestrator(workspaceRoot);

    const results = [];
    const errors = [];

    for (const linterName of lintersToRun) {
      try {
        // Check if linter is available
        const isAvailable = linters.available.some(l => l.name === linterName);
        if (!isAvailable) {
          errors.push({
            linter: linterName,
            error: 'Linter not available in project',
            status: 'unavailable'
          });
          continue;
        }

        // Run linter
        const startTime = Date.now();
        const result = await orchestrator.runLinter(linterName, files);
        const duration = Date.now() - startTime;

        results.push({
          linter: linterName,
          status: 'success',
          issueCount: result.issueCount,
          issues: result.issues,
          duration
        });

      } catch (error) {
        errors.push({
          linter: linterName,
          error: error.message,
          status: 'error'
        });
      }
    }

    return {
      results,
      errors,
      successCount: results.length,
      errorCount: errors.length,
      totalLinters: lintersToRun.length
    };
  }

  /**
   * Stage 5: Collect all linter outputs
   * @private
   */
  async _collectOutput(stageContext) {
    const { previousResults } = stageContext;
    const { results } = previousResults['run-linters'];

    const allIssues = [];
    
    for (const result of results) {
      if (result.status === 'success' && result.issues) {
        allIssues.push(...result.issues);
      }
    }

    return {
      rawIssues: allIssues,
      rawIssueCount: allIssues.length
    };
  }

  /**
   * Stage 6: Normalize issues to standard format
   * @private
   */
  async _normalizeIssues(stageContext) {
    const { previousResults } = stageContext;
    const { rawIssues } = previousResults['collect-output'];
    const { workspaceRoot } = previousResults['resolve-workspace'];

    const normalized = rawIssues.map((issue, index) => {
      // Normalize file path
      const filePath = issue.file || issue.filePath || issue.path || 'unknown';
      const absolutePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(workspaceRoot, filePath);

      // Normalize severity
      const severity = this._normalizeSeverity(
        issue.severity || issue.level || 'warning'
      );

      // Build normalized issue
      return {
        id: `issue-${index + 1}`,
        source: issue.source || issue.linter || 'unknown',
        rule: issue.rule || issue.ruleId || 'unknown',
        message: issue.message || 'No message',
        file: absolutePath,
        line: issue.line || issue.startLine || 1,
        column: issue.column || issue.startColumn || 1,
        endLine: issue.endLine || issue.line || issue.startLine || 1,
        endColumn: issue.endColumn || issue.column || issue.startColumn || 1,
        severity,
        fixable: issue.fixable || issue.fix !== undefined || false,
        originalIssue: issue
      };
    });

    return {
      issues: normalized,
      issueCount: normalized.length
    };
  }

  /**
   * Stage 7: Deduplicate issues
   * @private
   */
  async _deduplicate(stageContext) {
    const { previousResults } = stageContext;
    const { issues } = previousResults['normalize-issues'];

    const seen = new Set();
    const deduplicated = [];
    const duplicates = [];

    for (const issue of issues) {
      // Create unique key
      const key = `${issue.file}:${issue.line}:${issue.column}:${issue.rule}:${issue.message}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(issue);
      } else {
        duplicates.push(issue);
      }
    }

    return {
      issues: deduplicated,
      issueCount: deduplicated.length,
      duplicateCount: duplicates.length,
      duplicates
    };
  }

  /**
   * Stage 8: Sort issues by severity and location
   * @private
   */
  async _sort(stageContext) {
    const { previousResults } = stageContext;
    const { issues } = previousResults['deduplicate'];

    const severityOrder = { error: 1, warning: 2, info: 3 };

    const sorted = [...issues].sort((a, b) => {
      // Sort by severity first
      const severityDiff = (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4);
      if (severityDiff !== 0) return severityDiff;

      // Then by file
      const fileDiff = a.file.localeCompare(b.file);
      if (fileDiff !== 0) return fileDiff;

      // Then by line
      const lineDiff = a.line - b.line;
      if (lineDiff !== 0) return lineDiff;

      // Then by column
      return a.column - b.column;
    });

    return {
      issues: sorted,
      issueCount: sorted.length
    };
  }

  /**
   * Stage 9: Generate summary and statistics
   * @private
   */
  async _summarize(stageContext) {
    const { previousResults } = stageContext;
    const { issues } = previousResults['sort'];
    const { workspaceRoot } = previousResults['resolve-workspace'];
    const { metadata } = previousResults['detect-tools'];
    const { files, fileCount } = previousResults['select-files'];
    const { successCount, errorCount, totalLinters } = previousResults['run-linters'];
    const { duplicateCount } = previousResults['deduplicate'];

    // Count by severity
    const bySeverity = {
      error: 0,
      warning: 0,
      info: 0
    };

    // Count by file
    const byFile = {};

    // Count by rule
    const byRule = {};

    // Count fixable
    let fixableCount = 0;

    for (const issue of issues) {
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
      byFile[issue.file] = (byFile[issue.file] || 0) + 1;
      byRule[issue.rule] = (byRule[issue.rule] || 0) + 1;
      if (issue.fixable) fixableCount++;
    }

    // Top issues by frequency
    const topRules = Object.entries(byRule)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([rule, count]) => ({ rule, count }));

    // Most problematic files
    const topFiles = Object.entries(byFile)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => ({ file, count }));

    const summary = {
      workspace: workspaceRoot,
      projectName: metadata.name,
      projectVersion: metadata.version,
      analyzedFiles: fileCount,
      totalIssues: issues.length,
      bySeverity,
      fixableIssues: fixableCount,
      duplicatesRemoved: duplicateCount,
      lintersRun: successCount,
      linterErrors: errorCount,
      totalLinters,
      topRules,
      topFiles
    };

    const stats = {
      filesAnalyzed: fileCount,
      issuesFound: issues.length,
      issuesPerFile: fileCount > 0 ? (issues.length / fileCount).toFixed(2) : 0,
      errorRate: issues.length > 0 ? (bySeverity.error / issues.length * 100).toFixed(1) : 0,
      fixableRate: issues.length > 0 ? (fixableCount / issues.length * 100).toFixed(1) : 0
    };

    return {
      issues,
      summary,
      stats
    };
  }

  // ─── Helper Methods ──────────────────────────────────────────────────────────

  /**
   * Discover project files for analysis
   * @private
   */
  async _discoverProjectFiles(workspaceRoot, hasTypeScript) {
    const files = [];
    
    // Common source directories
    const sourceDirs = ['src', 'lib', 'app', 'components', 'pages'];
    
    // File extensions to look for
    const extensions = hasTypeScript 
      ? ['.js', '.jsx', '.ts', '.tsx', '.mjs']
      : ['.js', '.jsx', '.mjs'];

    for (const dir of sourceDirs) {
      const dirPath = path.join(workspaceRoot, dir);
      if (fs.existsSync(dirPath)) {
        const dirFiles = this._walkDirectory(dirPath, extensions);
        files.push(...dirFiles);
      }
    }

    // If no source directories found, scan root
    if (files.length === 0) {
      const rootFiles = fs.readdirSync(workspaceRoot)
        .filter(f => extensions.some(ext => f.endsWith(ext)))
        .map(f => path.join(workspaceRoot, f));
      files.push(...rootFiles);
    }

    return files;
  }

  /**
   * Walk directory recursively
   * @private
   */
  _walkDirectory(dir, extensions, maxDepth = 10, currentDepth = 0) {
    if (currentDepth > maxDepth) return [];

    const files = [];
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Skip node_modules and hidden directories
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }

        if (entry.isDirectory()) {
          files.push(...this._walkDirectory(fullPath, extensions, maxDepth, currentDepth + 1));
        } else if (entry.isFile()) {
          if (extensions.some(ext => entry.name.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore permission errors
    }

    return files;
  }

  /**
   * Normalize severity to standard values
   * @private
   */
  _normalizeSeverity(severity) {
    const severityStr = String(severity).toLowerCase();
    
    if (severityStr === 'error' || severityStr === '2') return 'error';
    if (severityStr === 'warning' || severityStr === 'warn' || severityStr === '1') return 'warning';
    if (severityStr === 'info' || severityStr === 'information' || severityStr === '0') return 'info';
    
    return 'warning'; // Default to warning for unknown severities
  }
}

module.exports = {
  WorkspaceQualityAnalysis
};

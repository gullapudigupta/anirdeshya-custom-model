/**
 * Workspace Quality Analysis Pipeline
 * Task: P9-T025
 * 
 * Implements the end-to-end analysis pipeline over the active workspace and selected files.
 * Uses the selected project's tools and package configuration.
 * Returns stable issue, summary, statistics, and pipeline-run identifiers.
 */

const { Pipeline } = require('../core/pipeline');

/**
 * Workspace Quality Analysis Pipeline Stages
 */
const STAGES = [
  { name: 'resolve-workspace', description: 'Resolve active workspace path' },
  { name: 'detect-tools', description: 'Detect linters and analyzers from package.json' },
  { name: 'select-files', description: 'Select files for analysis' },
  { name: 'run-linters', description: 'Execute selected linters' },
  { name: 'collect-output', description: 'Collect linter output' },
  { name: 'normalize-issues', description: 'Normalize issues to standard format' },
  { name: 'deduplicate', description: 'Remove duplicate issues' },
  { name: 'sort', description: 'Sort issues by severity and file' },
  { name: 'summarize', description: 'Generate summary statistics' }
];

/**
 * Workspace Quality Analysis Pipeline Implementation
 */
class WorkspaceQualityPipeline extends Pipeline {
  constructor(options = {}) {
    super('workspace-quality-analysis', STAGES, options);
    
    this.workspaceResolver = options.workspaceResolver;
    this.toolDetector = options.toolDetector;
    this.fileSelector = options.fileSelector;
    this.linterRunner = options.linterRunner;
    this.issueNormalizer = options.issueNormalizer;
    this.config = options.config || {};
  }

  /**
   * Stage: resolve-workspace
   */
  async resolveWorkspace(context) {
    const workspace = context.workspace || this.config.workspace;
    
    if (!workspace) {
      throw new Error('No workspace specified');
    }
    
    const resolved = await this.workspaceResolver?.resolve(workspace) || workspace;
    
    return {
      workspace: resolved,
      packageJson: await this.loadPackageJson(resolved)
    };
  }

  /**
   * Load package.json for the workspace
   */
  async loadPackageJson(workspace) {
    const fs = require('fs');
    const path = require('path');
    
    const packageJsonPath = path.join(workspace, 'package.json');
    
    if (fs.existsSync(packageJsonPath)) {
      try {
        return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      } catch (error) {
        return null;
      }
    }
    
    return null;
  }

  /**
   * Stage: detect-tools
   */
  async detectTools(context) {
    const { workspace, packageJson } = context.previousResult;
    
    const detectedTools = await this.toolDetector?.detect(workspace, packageJson) || {
      linters: this.detectLintersFromPackage(packageJson),
      testers: this.detectTestersFromPackage(packageJson)
    };
    
    return {
      detectedTools,
      selectedLinters: this.selectLinters(detectedTools.linters, context.options)
    };
  }

  /**
   * Detect linters from package.json
   */
  detectLintersFromPackage(packageJson) {
    if (!packageJson) return [];
    
    const linters = [];
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    if (deps.eslint) linters.push({ name: 'eslint', config: '.eslintrc.*' });
    if (deps['@typescript-eslint/parser'] || deps.typescript) linters.push({ name: 'typescript', config: 'tsconfig.json' });
    if (deps.prettier) linters.push({ name: 'prettier', config: '.prettierrc*' });
    if (deps.stylelint) linters.push({ name: 'stylelint', config: '.stylelintrc*' });
    
    return linters;
  }

  /**
   * Detect testers from package.json
   */
  detectTestersFromPackage(packageJson) {
    if (!packageJson) return [];
    
    const testers = [];
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    if (deps.jest) testers.push({ name: 'jest', command: 'npm test' });
    if (deps.vitest) testers.push({ name: 'vitest', command: 'npm test' });
    if (deps.mocha) testers.push({ name: 'mocha', command: 'npm test' });
    
    return testers;
  }

  /**
   * Select linters based on options
   */
  selectLinters(detectedLinters, options) {
    if (options.linters && options.linters.length > 0) {
      return detectedLinters.filter(l => options.linters.includes(l.name));
    }
    return detectedLinters;
  }

  /**
   * Stage: select-files
   */
  async selectFiles(context) {
    const { workspace } = context.previousResult;
    const options = context.options || {};
    
    const files = await this.fileSelector?.select(workspace, options) || 
      await this.defaultFileSelection(workspace, options);
    
    return { files };
  }

  /**
   * Default file selection
   */
  async defaultFileSelection(workspace, options) {
    const fs = require('fs');
    const path = require('path');
    
    const files = [];
    const extensions = options.extensions || ['.js', '.ts', '.jsx', '.tsx', '.json'];
    
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && 
              entry.name !== 'node_modules' && 
              entry.name !== 'dist' &&
              entry.name !== 'build') {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          if (extensions.some(ext => fullPath.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      }
    };
    
    walk(workspace);
    return files;
  }

  /**
   * Stage: run-linters
   */
  async runLinters(context) {
    const { workspace, detectedTools, selectedLinters } = context.stages['detect-tools'];
    const { files } = context.stages['select-files'];
    
    const results = [];
    
    for (const linter of selectedLinters) {
      try {
        const result = await this.linterRunner?.run(linter, files, workspace) ||
          await this.defaultLinterRun(linter, files, workspace);
        
        results.push({
          linter: linter.name,
          success: true,
          ...result
        });
      } catch (error) {
        results.push({
          linter: linter.name,
          success: false,
          error: error.message
        });
      }
    }
    
    return { linterResults: results };
  }

  /**
   * Default linter execution
   */
  async defaultLinterRun(linter, files, workspace) {
    // Default implementation - override with actual linter runner
    return {
      issues: [],
      output: '',
      duration: 0
    };
  }

  /**
   * Stage: collect-output
   */
  async collectOutput(context) {
    const { linterResults } = context.previousResult;
    
    const allOutput = linterResults.map(r => ({
      linter: r.linter,
      output: r.output || '',
      success: r.success
    }));
    
    return { allOutput };
  }

  /**
   * Stage: normalize-issues
   */
  async normalizeIssues(context) {
    const { linterResults } = context.stages['run-linters'];
    
    const normalizedIssues = [];
    
    for (const result of linterResults) {
      if (result.success && result.issues) {
        for (const issue of result.issues) {
          const normalized = await this.issueNormalizer?.normalize(issue, result.linter) ||
            this.defaultNormalize(issue, result.linter);
          
          normalizedIssues.push(normalized);
        }
      }
    }
    
    return { normalizedIssues };
  }

  /**
   * Default issue normalization
   */
  defaultNormalize(issue, linter) {
    return {
      id: `${linter}-${issue.file}-${issue.line || 0}-${issue.rule || 'unknown'}`,
      file: issue.file,
      line: issue.line || null,
      column: issue.column || null,
      message: issue.message,
      severity: issue.severity || 'warning',
      rule: issue.rule || null,
      linter: linter,
      category: this.categorizeIssue(issue)
    };
  }

  /**
   * Categorize issue by type
   */
  categorizeIssue(issue) {
    const message = (issue.message || '').toLowerCase();
    const rule = (issue.rule || '').toLowerCase();
    
    if (message.includes('unused') || rule.includes('unused')) return 'unused-code';
    if (message.includes('error') || issue.severity === 'error') return 'error';
    if (message.includes('security') || rule.includes('security')) return 'security';
    if (message.includes('performance') || rule.includes('performance')) return 'performance';
    if (message.includes('style') || rule.includes('style')) return 'style';
    
    return 'quality';
  }

  /**
   * Stage: deduplicate
   */
  async deduplicate(context) {
    const { normalizedIssues } = context.previousResult;
    
    const seen = new Map();
    const unique = [];
    
    for (const issue of normalizedIssues) {
      const key = issue.id;
      
      if (!seen.has(key)) {
        seen.set(key, true);
        unique.push(issue);
      }
    }
    
    return { issues: unique };
  }

  /**
   * Stage: sort
   */
  async sort(context) {
    const { issues } = context.previousResult;
    
    const severityOrder = { 'error': 0, 'warning': 1, 'info': 2, 'suggestion': 3 };
    
    const sorted = issues.sort((a, b) => {
      // Sort by severity first
      const severityDiff = (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99);
      if (severityDiff !== 0) return severityDiff;
      
      // Then by file
      if (a.file < b.file) return -1;
      if (a.file > b.file) return 1;
      
      // Then by line
      return (a.line || 0) - (b.line || 0);
    });
    
    return { sortedIssues: sorted };
  }

  /**
   * Stage: summarize
   */
  async summarize(context) {
    const { sortedIssues } = context.previousResult;
    const { linterResults } = context.stages['run-linters'];
    
    const summary = {
      totalIssues: sortedIssues.length,
      bySeverity: {},
      byCategory: {},
      byFile: {},
      byLinter: {},
      duration: 0
    };
    
    // Count by severity
    for (const issue of sortedIssues) {
      summary.bySeverity[issue.severity] = (summary.bySeverity[issue.severity] || 0) + 1;
      summary.byCategory[issue.category] = (summary.byCategory[issue.category] || 0) + 1;
      summary.byFile[issue.file] = (summary.byFile[issue.file] || 0) + 1;
      summary.byLinter[issue.linter] = (summary.byLinter[issue.linter] || 0) + 1;
    }
    
    // Sum duration
    for (const result of linterResults) {
      summary.duration += result.duration || 0;
    }
    
    return {
      issues: sortedIssues,
      summary,
      pipelineRunId: this.generateRunId()
    };
  }

  /**
   * Generate unique run ID
   */
  generateRunId() {
    return `wqa-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = { WorkspaceQualityPipeline, STAGES };

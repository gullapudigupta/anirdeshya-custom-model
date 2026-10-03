/**
 * VS Code Diagnostics and Quick-Fix Pipeline (P9-T035)
 *
 * Instruments AqtService, diagnostics provider, code actions, status bar,
 * and webview as one extension pipeline.
 *
 * @module pipelines/vscode-diagnostics-pipeline
 */

'use strict';

const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');

/**
 * Diagnostic severity mapping to VS Code
 */
const VSDiagnosticSeverity = {
  ERROR: 'Error',
  WARNING: 'Warning',
  INFORMATION: 'Information',
  HINT: 'Hint'
};

/**
 * Code action kinds
 */
const CodeActionKind = {
  QUICK_FIX: 'quickfix',
  REFACTOR: 'refactor',
  REFACTOR_EXTRACT: 'refactor.extract',
  REFACTOR_INLINE: 'refactor.inline',
  REFACTOR_REWRITE: 'refactor.rewrite',
  SOURCE: 'source',
  SOURCE_FIX_ALL: 'source.fixAll',
  SOURCE_ORGANIZE_IMPORTS: 'source.organizeImports'
};

/**
 * VS Code Diagnostics Pipeline
 */
class VSDiagnosticsPipeline {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.executor = options.executor || new PipelineExecutor();
    
    // VS Code integration
    this.extensionContext = options.extensionContext || null;
    this.diagnosticCollection = options.diagnosticCollection || null;
    
    // Configuration
    this.config = options.config || {};
    this.autoRefresh = options.autoRefresh !== false;
    
    // State
    this.diagnostics = new Map();
    this.codeActions = new Map();
    this.statusBarItem = null;
    this.activated = false;
  }

  /**
   * Execute VS Code diagnostics pipeline
   * @param {Object} params
   * @param {Object} params.workspace - VS Code workspace
   * @param {Object} params.config - Extension configuration
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const { workspace, config } = params;

    const stageHandlers = {
      'activate-extension': async (ctx) => this._activateExtension(ctx),
      'load-config': async (ctx) => this._loadConfig(ctx, config),
      'analyze-workspace': async (ctx) => this._analyzeWorkspace(ctx),
      'map-diagnostics': async (ctx) => this._mapDiagnostics(ctx),
      'render-status': async (ctx) => this._renderStatus(ctx),
      'offer-code-actions': async (ctx) => this._offerCodeActions(ctx),
      'apply-fix': async (ctx) => this._applyFix(ctx),
      'refresh-diagnostics': async (ctx) => this._refreshDiagnostics(ctx)
    };

    const result = await this.executor.execute('vscode-quality-feedback', {
      input: { workspace, config },
      workspace: this.workspace,
      stageHandlers
    });

    return result;
  }

  /**
   * Activate the extension
   */
  async activate(context) {
    this.extensionContext = context;
    this.activated = true;
    
    return {
      activated: true,
      extensionId: context.extension?.id || 'unknown'
    };
  }

  /**
   * Deactivate the extension
   */
  deactivate() {
    this.activated = false;
    this.diagnostics.clear();
    this.codeActions.clear();
    
    return { deactivated: true };
  }

  /**
   * Get current diagnostics
   * @param {string} [uri] - Optional file URI
   * @returns {Object[]}
   */
  getDiagnostics(uri) {
    if (uri) {
      return this.diagnostics.get(uri) || [];
    }
    
    const all = [];
    for (const [, diags] of this.diagnostics) {
      all.push(...diags);
    }
    return all;
  }

  /**
   * Get code actions for a diagnostic
   * @param {string} uri
   * @param {Object} range
   * @returns {Object[]}
   */
  getCodeActions(uri, range) {
    const actions = this.codeActions.get(uri) || [];
    
    return actions.filter(action => 
      this._rangeOverlaps(action.range, range)
    );
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _activateExtension(ctx) {
    if (!this.activated) {
      return {
        activated: false,
        reason: 'Extension not activated'
      };
    }
    
    return {
      activated: true,
      extensionPath: this.extensionContext?.extensionPath
    };
  }

  async _loadConfig(ctx, config) {
    const loaded = {
      autoFix: config?.autoFix !== false,
      maxIssuesPerFile: config?.maxIssuesPerFile || 100,
      excludedPatterns: config?.excludedPatterns || ['node_modules/**'],
      enabledLinters: config?.enabledLinters || ['eslint', 'typescript'],
      refreshOnSave: config?.refreshOnSave !== false
    };
    
    this.config = loaded;
    
    return { config: loaded };
  }

  async _analyzeWorkspace(ctx) {
    const { workspace: inputWorkspace } = ctx.input || {};
    
    // Get files to analyze
    const files = await this._getWorkspaceFiles();
    
    // Run analysis
    const issues = [];
    
    for (const file of files) {
      const fileIssues = await this._analyzeFile(file);
      issues.push(...fileIssues);
    }
    
    return {
      files: files.length,
      issues,
      analyzedAt: Date.now()
    };
  }

  async _mapDiagnostics(ctx) {
    const { issues } = ctx.previousResults?.['analyze-workspace'] || {};
    
    const diagnostics = new Map();
    const warnings = [];
    const errors = [];
    
    for (const issue of issues || []) {
      const uri = issue.file;
      const diagnostic = this._createDiagnostic(issue);
      
      if (!diagnostics.has(uri)) {
        diagnostics.set(uri, []);
      }
      
      diagnostics.get(uri).push(diagnostic);
      
      // Count by severity
      if (diagnostic.severity === VSDiagnosticSeverity.ERROR) {
        errors.push(diagnostic);
      } else if (diagnostic.severity === VSDiagnosticSeverity.WARNING) {
        warnings.push(diagnostic);
      }
    }
    
    // Store diagnostics
    this.diagnostics = diagnostics;
    
    return {
      diagnostics,
      summary: {
        files: diagnostics.size,
        issues: (issues || []).length,
        errors: errors.length,
        warnings: warnings.length
      }
    };
  }

  async _renderStatus(ctx) {
    const { summary } = ctx.previousResults?.['map-diagnostics'] || {};
    
    const status = {
      text: this._formatStatusText(summary),
      tooltip: this._formatStatusTooltip(summary),
      command: 'aqt.showIssues',
      color: this._getStatusColor(summary)
    };
    
    // Update status bar
    if (this.statusBarItem) {
      this.statusBarItem.text = status.text;
      this.statusBarItem.tooltip = status.tooltip;
      this.statusBarItem.color = status.color;
    }
    
    return { status };
  }

  async _offerCodeActions(ctx) {
    const { diagnostics } = ctx.previousResults?.['map-diagnostics'] || {};
    
    const codeActions = new Map();
    
    for (const [uri, diags] of diagnostics || []) {
      const actions = [];
      
      for (const diag of diags) {
        // Generate quick fix actions
        if (diag.quickFixable) {
          actions.push(this._createQuickFixAction(uri, diag));
        }
        
        // Generate fix all action
        if (diag.source === 'eslint' && diag.fixable) {
          actions.push(this._createFixAllAction(uri, diag));
        }
      }
      
      codeActions.set(uri, actions);
    }
    
    this.codeActions = codeActions;
    
    return {
      codeActions,
      totalActions: Array.from(codeActions.values())
        .reduce((sum, actions) => sum + actions.length, 0)
    };
  }

  async _applyFix(ctx) {
    // This would be called when a user accepts a code action
    const { issue, fix } = ctx.input || {};
    
    if (!fix) {
      return { applied: false, reason: 'No fix provided' };
    }
    
    // Apply the fix
    const result = await this._applyCodeFix(fix);
    
    return result;
  }

  async _refreshDiagnostics(ctx) {
    if (!this.autoRefresh) {
      return { refreshed: false, reason: 'Auto-refresh disabled' };
    }
    
    // Re-run analysis
    const { issues } = await this._analyzeWorkspace(ctx);
    const { diagnostics } = await this._mapDiagnostics({
      ...ctx,
      previousResults: { 'analyze-workspace': { issues } }
    });
    
    // Notify VS Code to refresh
    if (this.diagnosticCollection) {
      this.diagnosticCollection.clear();
      
      for (const [uri, diags] of diagnostics) {
        this.diagnosticCollection.set(uri, diags);
      }
    }
    
    return {
      refreshed: true,
      files: diagnostics.size
    };
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────────

  async _getWorkspaceFiles() {
    const fs = require('fs');
    const path = require('path');
    
    const files = [];
    
    const walk = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            if (!this._isExcluded(fullPath)) {
              walk(fullPath);
            }
          } else if (entry.isFile() && this._isAnalyzed(fullPath)) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Ignore errors
      }
    };
    
    walk(this.workspace);
    return files;
  }

  _isExcluded(dir) {
    const name = require('path').basename(dir);
    return ['node_modules', '.git', 'dist', 'build'].includes(name);
  }

  _isAnalyzed(file) {
    const ext = require('path').extname(file);
    return ['.js', '.ts', '.jsx', '.tsx'].includes(ext);
  }

  async _analyzeFile(file) {
    // Placeholder - would integrate with actual analyzer
    return [];
  }

  _createDiagnostic(issue) {
    return {
      range: {
        start: { line: (issue.line || 1) - 1, character: (issue.column || 1) - 1 },
        end: { line: (issue.line || 1) - 1, character: (issue.column || 1) - 1 + 10 }
      },
      message: issue.message,
      severity: this._mapSeverity(issue.severity),
      source: issue.linter || 'aqt',
      code: issue.rule,
      quickFixable: issue.fixable === true,
      fixable: issue.fixable === true
    };
  }

  _mapSeverity(severity) {
    const mapping = {
      'error': VSDiagnosticSeverity.ERROR,
      'warning': VSDiagnosticSeverity.WARNING,
      'info': VSDiagnosticSeverity.INFORMATION,
      'hint': VSDiagnosticSeverity.HINT,
      'suggestion': VSDiagnosticSeverity.HINT
    };
    
    return mapping[severity?.toLowerCase()] || VSDiagnosticSeverity.WARNING;
  }

  _formatStatusText(summary) {
    if (!summary) return '$(check) AQT';
    
    const { errors, warnings } = summary;
    
    if (errors > 0) {
      return `$(error) ${errors} $(warning) ${warnings}`;
    } else if (warnings > 0) {
      return `$(warning) ${warnings}`;
    }
    
    return '$(check) AQT';
  }

  _formatStatusTooltip(summary) {
    if (!summary) return 'AQT: No issues';
    
    const { errors, warnings, files } = summary;
    return `AQT: ${errors} errors, ${warnings} warnings in ${files} files`;
  }

  _getStatusColor(summary) {
    if (!summary) return undefined;
    
    if (summary.errors > 0) return 'errorForeground';
    if (summary.warnings > 0) return 'editorWarning.foreground';
    return undefined;
  }

  _createQuickFixAction(uri, diagnostic) {
    return {
      title: `Fix: ${diagnostic.message}`,
      kind: CodeActionKind.QUICK_FIX,
      diagnostics: [diagnostic],
      edit: {
        changes: {
          [uri]: [{
            range: diagnostic.range,
            newText: '' // Would contain actual fix
          }]
        }
      },
      isPreferred: true
    };
  }

  _createFixAllAction(uri, diagnostic) {
    return {
      title: 'Fix all auto-fixable issues',
      kind: CodeActionKind.SOURCE_FIX_ALL,
      diagnostics: [diagnostic],
      edit: {
        changes: {} // Would contain all fixes
      }
    };
  }

  _rangeOverlaps(range1, range2) {
    if (!range1 || !range2) return false;
    
    const startOverlaps = 
      range1.start.line >= range2.start.line &&
      range1.start.line <= range2.end.line;
    
    const endOverlaps = 
      range1.end.line >= range2.start.line &&
      range1.end.line <= range2.end.line;
    
    return startOverlaps || endOverlaps;
  }

  async _applyCodeFix(fix) {
    // Placeholder - would apply the actual fix
    return { applied: true };
  }
}

module.exports = {
  VSDiagnosticsPipeline,
  VSDiagnosticSeverity,
  CodeActionKind
};

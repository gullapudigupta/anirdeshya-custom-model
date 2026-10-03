/**
 * VS Code extension entry point (P3-T002)
 *
 * The only module that touches the live `vscode` API. It wires the
 * vscode-agnostic units in ./lib to VS Code:
 *   - runs analysis via AqtService (P3-T002)
 *   - publishes diagnostics (P3-T003)
 *   - registers a CodeActionProvider for quick fixes (P3-T004)
 *   - opens the webview issue browser (P3-T005)
 *   - reads configuration (P3-T006)
 *   - updates the status bar (P3-T007)
 *
 * `vscode` is required lazily inside activate() so this file can be required in
 * a plain-node test environment without the module present.
 *
 * @module extension/extension
 */

const path = require('path');
const crypto = require('crypto');

const { AqtService } = require('./lib/aqt-service');
const diagnosticsProvider = require('./lib/diagnostics-provider');
const codeActions = require('./lib/code-actions-provider');
const statusBar = require('./lib/status-bar');
const webview = require('./lib/webview-panel');
const { normalizeConfig } = require('./lib/config');

/** Module-level state shared across commands. */
const state = {
  vscode: null,
  service: null,
  diagnostics: null,
  statusItem: null,
  panel: null,
  root: null,
  /** issueId -> issue, for quick-fix lookups */
  issueIndex: new Map(),
  /** last analysis result */
  lastIssues: []
};

function readConfig(vscode) {
  const raw = vscode.workspace.getConfiguration('advancedQualityTool');
  // getConfiguration returns a proxy; pull the known keys into a plain object.
  return normalizeConfig({
    enable: raw.get('enable'),
    runOnSave: raw.get('runOnSave'),
    linters: raw.get('linters'),
    fixStrategy: raw.get('fixStrategy'),
    minConfidence: raw.get('minConfidence'),
    backup: raw.get('backup'),
    severityFloor: raw.get('severityFloor')
  });
}

function setStatus(next) {
  if (!state.statusItem) return;
  const rendered = statusBar.renderStatus(next);
  state.statusItem.text = rendered.text;
  state.statusItem.tooltip = rendered.tooltip;
  const vscode = state.vscode;
  if (rendered.severity === 'error') {
    state.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (rendered.severity === 'warning') {
    state.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    state.statusItem.backgroundColor = undefined;
  }
  state.statusItem.show();
}

function publishDiagnostics(issues, config) {
  const vscode = state.vscode;
  state.diagnostics.clear();
  const byFile = diagnosticsProvider.toDiagnosticsByFile(issues, config);

  for (const [relFile, descriptors] of Object.entries(byFile)) {
    const abs = path.isAbsolute(relFile) ? relFile : path.join(state.root, relFile);
    const uri = vscode.Uri.file(abs);
    const diags = descriptors.map((d) => {
      const range = new vscode.Range(
        d.range.startLine, d.range.startColumn,
        d.range.endLine, d.range.endColumn
      );
      const diag = new vscode.Diagnostic(range, d.message, d.severity);
      diag.source = d.source;
      if (d.code) diag.code = d.code;
      return diag;
    });
    state.diagnostics.set(uri, diags);
  }
}

async function analyze() {
  const vscode = state.vscode;
  const config = readConfig(vscode);
  if (!config.enable) return;

  setStatus({ status: 'analyzing' });
  try {
    const result = await state.service.analyze({ linters: config.linters });
    state.lastIssues = result.issues;
    state.issueIndex = new Map(result.issues.map((i) => [i.id, i]));

    publishDiagnostics(result.issues, config);

    setStatus({
      status: 'done',
      issueCount: result.stats.total,
      errorCount: (result.stats.bySeverity.CRITICAL || 0) + (result.stats.bySeverity.ERROR || 0),
      warningCount: result.stats.bySeverity.WARNING || 0
    });

    if (state.panel) {
      state.panel.webview.html = webview.renderHtml(result.issues, result.stats, { nonce: makeNonce() });
    }
    return result;
  } catch (err) {
    setStatus({ status: 'error', message: err.message });
    vscode.window.showErrorMessage(`AQT analysis failed: ${err.message}`);
  }
}

async function fixIssues(issues) {
  const vscode = state.vscode;
  const config = readConfig(vscode);
  if (!issues.length) return;

  setStatus({ status: 'fixing' });
  try {
    await state.service.fix(issues, {
      dryRun: false,
      strategy: config.fixStrategy,
      minConfidence: config.minConfidence,
      backup: config.backup
    });
    // Re-analyze to reflect the post-fix state.
    await analyze();
  } catch (err) {
    setStatus({ status: 'error', message: err.message });
    vscode.window.showErrorMessage(`AQT fix failed: ${err.message}`);
  }
}

async function fixAll() {
  const fixable = state.lastIssues.filter(
    (i) => i.autoFixLevel === 'AUTO' || i.autoFixLevel === 'RULE'
  );
  if (!fixable.length) {
    state.vscode.window.showInformationMessage('AQT: no auto-fixable issues.');
    return;
  }
  await fixIssues(fixable);
}

async function fixIssueById(issueId) {
  const issue = state.issueIndex.get(issueId);
  if (issue) await fixIssues([issue]);
}

function openPanel() {
  const vscode = state.vscode;
  if (state.panel) {
    state.panel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'aqtPanel',
    'Advanced Quality Tool',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  state.panel = panel;
  panel.onDidDispose(() => { state.panel = null; });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) return;
    if (msg.type === 'analyze') return analyze();
    if (msg.type === 'fixAll') return fixAll();
    if (msg.type === 'fix' && msg.id) return fixIssueById(msg.id);
    if (msg.type === 'open' && msg.file) {
      const abs = path.isAbsolute(msg.file) ? msg.file : path.join(state.root, msg.file);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
      const editor = await vscode.window.showTextDocument(doc);
      const line = Math.max(0, (msg.line || 1) - 1);
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos));
    }
  });

  panel.webview.html = webview.renderHtml(state.lastIssues, {}, { nonce: makeNonce() });
}

function makeNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/** CodeActionProvider bridging lib/code-actions-provider to vscode. */
function makeCodeActionProvider(vscode) {
  return {
    provideCodeActions(document, range) {
      const rel = path.relative(state.root, document.uri.fsPath);
      const inFile = state.lastIssues.filter((i) => i.file === rel || i.file === document.uri.fsPath);
      const relevant = inFile.filter((i) => {
        const line = (i.startLine || 1) - 1;
        return line >= range.start.line && line <= range.end.line;
      });

      const actions = [];
      for (const issue of relevant) {
        for (const desc of codeActions.buildActions(issue)) {
          const kind = desc.kind === 'quickfix'
            ? vscode.CodeActionKind.QuickFix
            : vscode.CodeActionKind.Empty;
          const action = new vscode.CodeAction(desc.title, kind);
          if (desc.isPreferred) action.isPreferred = true;
          if (desc.command) {
            action.command = {
              command: desc.command.command,
              title: desc.command.title,
              arguments: desc.command.arguments
            };
          }
          actions.push(action);
        }
      }
      return actions;
    }
  };
}

function activate(context) {
  const vscode = require('vscode');
  state.vscode = vscode;

  const folders = vscode.workspace.workspaceFolders;
  state.root = folders && folders.length ? folders[0].uri.fsPath : process.cwd();
  state.service = new AqtService(state.root);

  state.diagnostics = vscode.languages.createDiagnosticCollection('aqt');
  context.subscriptions.push(state.diagnostics);

  state.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  state.statusItem.command = 'aqt.openPanel';
  context.subscriptions.push(state.statusItem);
  setStatus({ status: 'idle' });

  context.subscriptions.push(
    vscode.commands.registerCommand('aqt.analyze', analyze),
    vscode.commands.registerCommand('aqt.fixAll', fixAll),
    vscode.commands.registerCommand('aqt.fixIssue', fixIssueById),
    vscode.commands.registerCommand('aqt.openPanel', openPanel),
    vscode.commands.registerCommand('aqt.clear', () => {
      state.diagnostics.clear();
      state.lastIssues = [];
      state.issueIndex.clear();
      setStatus({ status: 'idle' });
    })
  );

  const selector = [
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'javascriptreact' },
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'typescriptreact' },
    { scheme: 'file', language: 'css' },
    { scheme: 'file', language: 'scss' },
    { scheme: 'file', language: 'csharp' }
  ];
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(selector, makeCodeActionProvider(vscode), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    })
  );

  // Optional analyze-on-save.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      const config = readConfig(vscode);
      if (config.enable && config.runOnSave) analyze();
    })
  );

  // Initial pass.
  const initial = readConfig(vscode);
  if (initial.enable) analyze();
}

function deactivate() {
  if (state.diagnostics) state.diagnostics.dispose();
  if (state.statusItem) state.statusItem.dispose();
  if (state.panel) state.panel.dispose();
  state.issueIndex.clear();
  state.lastIssues = [];
}

module.exports = { activate, deactivate };

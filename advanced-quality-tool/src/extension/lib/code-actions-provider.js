/**
 * Code actions provider (P3-T004)
 *
 * Builds plain quick-fix descriptors for an issue. `extension.js` turns these
 * into `vscode.CodeAction` objects bound to the `aqt.fixIssue` command. Only
 * rule/auto fixable issues receive a fix action; everything gets a
 * documentation action when a doc URL is available.
 *
 * @module extension/lib/code-actions-provider
 */

/**
 * VS Code CodeActionKind string identifiers (avoids requiring `vscode`).
 */
const KIND = {
  QuickFix: 'quickfix',
  Empty: ''
};

/**
 * Build code action descriptors for a single issue.
 *
 * @param {object} issue normalized AQT issue
 * @returns {object[]} action descriptors
 *   { title, kind, isPreferred?, command?:{command,arguments}, documentation? }
 */
function buildActions(issue) {
  const actions = [];
  const fixable = issue.autoFixLevel === 'AUTO' || issue.autoFixLevel === 'RULE';

  if (fixable) {
    actions.push({
      title: `AQT: Fix "${truncate(issue.message || issue.title, 50)}"`,
      kind: KIND.QuickFix,
      isPreferred: true,
      command: {
        command: 'aqt.fixIssue',
        title: 'Fix issue',
        arguments: [issue.id]
      }
    });
  }

  const docUrl = issue.metadata && issue.metadata.documentation;
  if (docUrl) {
    actions.push({
      title: `AQT: Learn more (${issue.rule || issue.type})`,
      kind: KIND.Empty,
      command: {
        command: 'vscode.open',
        title: 'Open documentation',
        arguments: [docUrl]
      }
    });
  }

  return actions;
}

/**
 * Build actions for every issue whose range contains the given position or
 * that lives on the given line. `extension.js` narrows by range.
 *
 * @param {object[]} issues issues already scoped to the active file
 * @returns {object[]}
 */
function buildActionsForIssues(issues) {
  const all = [];
  for (const issue of issues) {
    all.push(...buildActions(issue));
  }
  return all;
}

function truncate(str, max) {
  const s = String(str || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

module.exports = {
  buildActions,
  buildActionsForIssues,
  KIND
};

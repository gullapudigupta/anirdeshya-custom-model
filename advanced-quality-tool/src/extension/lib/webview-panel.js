/**
 * Webview panel rendering (P3-T005)
 *
 * `renderHtml(issues, stats)` returns the HTML for the issue-browser webview.
 * Pure function with no `vscode` dependency; the panel wiring in `extension.js`
 * creates the `WebviewPanel`, sets `webview.html = renderHtml(...)`, and relays
 * messages (fix / fixAll / open-file) to commands.
 *
 * All issue-derived text is HTML-escaped to prevent script injection from
 * linter messages or file paths.
 *
 * @module extension/lib/webview-panel
 */

/**
 * Escape a string for safe insertion into HTML text/attribute context.
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SEVERITY_BADGE = {
  CRITICAL: '🔴',
  ERROR: '🟠',
  WARNING: '🟡',
  INFO: '🔵',
  SUGGESTION: '⚪'
};

function renderStatsBar(stats = {}) {
  const bySeverity = stats.bySeverity || {};
  const parts = ['CRITICAL', 'ERROR', 'WARNING', 'INFO', 'SUGGESTION']
    .filter((s) => bySeverity[s])
    .map((s) => `${SEVERITY_BADGE[s]} ${escapeHtml(s)}: ${bySeverity[s]}`);

  return `<div class="stats">
    <strong>Total:</strong> ${Number(stats.total) || 0} &nbsp;·&nbsp;
    <strong>Fixable:</strong> ${Number(stats.fixable) || 0}
    ${parts.length ? `<div class="sev">${parts.join(' &nbsp; ')}</div>` : ''}
  </div>`;
}

function renderIssueRow(issue) {
  const badge = SEVERITY_BADGE[issue.severity] || '•';
  const fixable = issue.autoFixLevel === 'AUTO' || issue.autoFixLevel === 'RULE';
  const id = escapeHtml(issue.id);
  const fixBtn = fixable
    ? `<button class="fix" data-id="${id}">Fix</button>`
    : `<span class="manual">manual</span>`;

  return `<tr>
    <td class="sev-cell">${badge} ${escapeHtml(issue.severity)}</td>
    <td class="msg">
      <a href="#" class="open" data-file="${escapeHtml(issue.file)}" data-line="${Number(issue.startLine) || 1}">
        ${escapeHtml(issue.file)}:${Number(issue.startLine) || 1}
      </a>
      <div class="text">${escapeHtml(issue.message || issue.title)}</div>
      <div class="meta">${escapeHtml(issue.category || '')} · ${escapeHtml(issue.rule || issue.type || '')}</div>
    </td>
    <td class="action">${fixBtn}</td>
  </tr>`;
}

/**
 * Render the full webview HTML.
 *
 * @param {object[]} issues normalized issues
 * @param {object} [stats] result of getIssueStats(issues)
 * @param {object} [options] { nonce } content-security nonce for the script
 * @returns {string} HTML document
 */
function renderHtml(issues = [], stats = {}, options = {}) {
  const nonce = options.nonce || 'aqt';
  const rows = issues.length
    ? issues.map(renderIssueRow).join('\n')
    : '<tr><td colspan="3" class="empty">✨ No issues found. Your code is clean.</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escapeHtml(nonce)}';" />
<title>Advanced Quality Tool</title>
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 12px; color: var(--vscode-foreground); }
  h1 { font-size: 1.1rem; margin: 0 0 8px; }
  .toolbar { margin-bottom: 10px; }
  button { cursor: pointer; padding: 3px 10px; }
  .stats { margin: 8px 0; font-size: 0.9rem; }
  .stats .sev { margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  td { border-bottom: 1px solid var(--vscode-panel-border, #ccc); padding: 6px 8px; vertical-align: top; }
  .sev-cell { white-space: nowrap; width: 1%; }
  .text { margin: 2px 0; }
  .meta { opacity: 0.7; font-size: 0.8rem; }
  .action { text-align: right; width: 1%; }
  .manual { opacity: 0.6; font-size: 0.8rem; }
  .empty { text-align: center; opacity: 0.7; padding: 24px; }
  a.open { text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
  <h1>Advanced Quality Tool</h1>
  <div class="toolbar">
    <button id="analyze">Re-analyze</button>
    <button id="fixAll">Fix all auto-fixable</button>
  </div>
  ${renderStatsBar(stats)}
  <table>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <script nonce="${escapeHtml(nonce)}">
    const vscode = acquireVsCodeApi();
    document.getElementById('analyze').addEventListener('click', () => vscode.postMessage({ type: 'analyze' }));
    document.getElementById('fixAll').addEventListener('click', () => vscode.postMessage({ type: 'fixAll' }));
    document.querySelectorAll('button.fix').forEach((b) =>
      b.addEventListener('click', () => vscode.postMessage({ type: 'fix', id: b.dataset.id })));
    document.querySelectorAll('a.open').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'open', file: a.dataset.file, line: Number(a.dataset.line) });
      }));
  </script>
</body>
</html>`;
}

module.exports = { renderHtml, escapeHtml };

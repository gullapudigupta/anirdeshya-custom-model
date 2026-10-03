/**
 * Status bar rendering (P3-T007)
 *
 * `renderStatus(state)` returns the `{ text, tooltip, severity }` to show in the
 * VS Code status bar. Pure function, no `vscode` dependency, so it is unit
 * testable. `extension.js` applies text/tooltip/backgroundColor to a real
 * `vscode.StatusBarItem`.
 *
 * @module extension/lib/status-bar
 */

/**
 * @param {object} state
 * @param {'idle'|'analyzing'|'fixing'|'done'|'error'} [state.status]
 * @param {number} [state.issueCount]
 * @param {number} [state.errorCount]
 * @param {number} [state.warningCount]
 * @param {string} [state.message]
 * @returns {{text:string, tooltip:string, severity:'none'|'warning'|'error'}}
 */
function renderStatus(state = {}) {
  const status = state.status || 'idle';

  if (status === 'analyzing') {
    return {
      text: '$(sync~spin) AQT: analyzing…',
      tooltip: 'Advanced Quality Tool is analyzing the workspace',
      severity: 'none'
    };
  }

  if (status === 'fixing') {
    return {
      text: '$(sync~spin) AQT: fixing…',
      tooltip: 'Advanced Quality Tool is applying fixes',
      severity: 'none'
    };
  }

  if (status === 'error') {
    return {
      text: '$(error) AQT: error',
      tooltip: state.message || 'Advanced Quality Tool encountered an error',
      severity: 'error'
    };
  }

  if (status === 'idle') {
    return {
      text: '$(shield) AQT',
      tooltip: 'Advanced Quality Tool — click to analyze',
      severity: 'none'
    };
  }

  // status === 'done'
  const issues = Number(state.issueCount) || 0;
  const errors = Number(state.errorCount) || 0;
  const warnings = Number(state.warningCount) || 0;

  if (issues === 0) {
    return {
      text: '$(check) AQT: clean',
      tooltip: 'No quality issues found',
      severity: 'none'
    };
  }

  const icon = errors > 0 ? '$(error)' : '$(warning)';
  return {
    text: `${icon} AQT: ${issues}`,
    tooltip: `${issues} issue(s) — ${errors} error(s), ${warnings} warning(s). Click to open panel.`,
    severity: errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'none'
  };
}

module.exports = { renderStatus };

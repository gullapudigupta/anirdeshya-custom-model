/**
 * Diagnostics provider (P3-T003)
 *
 * Maps normalized AQT issues to plain diagnostic descriptors that
 * `extension.js` converts into `vscode.Diagnostic` objects. Kept vscode-free
 * for unit testing. Ranges are returned 0-based (VS Code convention) while AQT
 * issues are 1-based.
 *
 * @module extension/lib/diagnostics-provider
 */

const { meetsSeverityFloor } = require('./config');

/**
 * VS Code DiagnosticSeverity numeric values (avoids requiring `vscode`):
 *   Error = 0, Warning = 1, Information = 2, Hint = 3
 */
const VS_SEVERITY = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

/**
 * Map an AQT severity to a VS Code DiagnosticSeverity value.
 * @param {string} severity
 * @returns {number}
 */
function mapSeverity(severity) {
  switch (severity) {
    case 'CRITICAL':
    case 'ERROR':
      return VS_SEVERITY.Error;
    case 'WARNING':
      return VS_SEVERITY.Warning;
    case 'INFO':
      return VS_SEVERITY.Information;
    case 'SUGGESTION':
    default:
      return VS_SEVERITY.Hint;
  }
}

/**
 * Convert a single issue to a diagnostic descriptor.
 *
 * @param {object} issue normalized AQT issue
 * @returns {object} { range:{startLine,startColumn,endLine,endColumn}, severity, message, source, code, issueId, fixable }
 */
function toDiagnostic(issue) {
  const startLine = Math.max(0, (issue.startLine || 1) - 1);
  const startColumn = Math.max(0, (issue.startColumn || 1) - 1);
  const endLine = Math.max(startLine, (issue.endLine || issue.startLine || 1) - 1);
  const endColumn = Math.max(0, (issue.endColumn || issue.startColumn || 1) - 1);

  const fixable = issue.autoFixLevel === 'AUTO' || issue.autoFixLevel === 'RULE';

  return {
    range: { startLine, startColumn, endLine, endColumn },
    severity: mapSeverity(issue.severity),
    message: issue.message || issue.title || 'Issue',
    source: `aqt:${issue.source || 'analyzer'}`,
    code: issue.rule || issue.type || undefined,
    issueId: issue.id,
    category: issue.category,
    fixable
  };
}

/**
 * Convert issues to descriptors grouped by file, applying the severity floor.
 *
 * @param {object[]} issues
 * @param {object} [config] normalized extension config (for severityFloor)
 * @returns {Object<string, object[]>} file -> descriptor[]
 */
function toDiagnosticsByFile(issues, config = {}) {
  const floor = config.severityFloor || 'SUGGESTION';
  const byFile = {};

  for (const issue of issues) {
    if (!meetsSeverityFloor(issue.severity, floor)) continue;
    const key = issue.file;
    (byFile[key] = byFile[key] || []).push(toDiagnostic(issue));
  }

  return byFile;
}

module.exports = {
  toDiagnostic,
  toDiagnosticsByFile,
  mapSeverity,
  VS_SEVERITY
};

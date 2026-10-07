/* @plugin
{
  "id": "custom-reporter",
  "name": "Custom reporter example",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "description": "Adds a Markdown severity-summary report format through the formatReport hook."
}
*/
'use strict';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

function escapeCell(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

module.exports = class CustomReporterPlugin {
  constructor(api) {
    this.api = api;
  }

  async onLoad() {
    this.api.registerHook('formatReport', async (data = {}) => {
      if (data.format !== 'severity-summary') return data;

      const issues = Array.isArray(data.issues) ? data.issues : [];
      const counts = new Map();
      for (const issue of issues) {
        const severity = String(issue.severity || 'info').toLowerCase();
        counts.set(severity, (counts.get(severity) || 0) + 1);
      }

      const severities = [
        ...SEVERITY_ORDER.filter(severity => counts.has(severity)),
        ...[...counts.keys()].filter(severity => !SEVERITY_ORDER.includes(severity)).sort()
      ];
      const lines = [
        '# Severity summary',
        '',
        `Total issues: ${issues.length}`,
        '',
        '| Severity | Count |',
        '| --- | --- |',
        ...severities.map(severity => `| ${escapeCell(severity)} | ${counts.get(severity)} |`)
      ];

      return { ...data, output: lines.join('\n') + '\n' };
    });
  }
};

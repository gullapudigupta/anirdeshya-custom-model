/* @plugin
{
  "id": "custom-fix-strategy",
  "name": "Custom fix strategy example",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "description": "Suggests reviewable trailing-whitespace fixes through the beforeFix hook. It never writes files."
}
*/
'use strict';

const SUPPORTED_RULES = new Set(['no-trailing-spaces', 'trailing-whitespace', 'SA1028']);

module.exports = class CustomFixStrategyPlugin {
  constructor(api) {
    this.api = api;
  }

  async onLoad() {
    this.api.registerHook('beforeFix', async (data = {}) => {
      const issues = Array.isArray(data.issues) ? data.issues : [];
      return {
        ...data,
        issues: issues.map(issue => {
          const rule = issue.ruleId || issue.rule;
          if (!SUPPORTED_RULES.has(rule) || typeof issue.sourceLine !== 'string') return issue;

          const replacement = issue.sourceLine.replace(/[ \t]+$/, '');
          if (replacement === issue.sourceLine) return issue;

          return {
            ...issue,
            suggestedFix: {
              strategy: 'custom-trailing-whitespace',
              line: issue.line,
              replacement,
              requiresReview: true
            }
          };
        })
      };
    });
  }
};

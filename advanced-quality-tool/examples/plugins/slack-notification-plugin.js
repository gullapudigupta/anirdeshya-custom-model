/* @plugin
{
  "id": "slack-notification",
  "name": "Slack notification example",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "description": "Prepares a Slack message for critical and high-severity issues. Plugins cannot access the network; delivery is done by the host's notification system."
}
*/
'use strict';

const NOTIFY_SEVERITIES = new Set(['critical', 'high']);
const MAX_LISTED_ISSUES = 10;

function escapeSlack(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = class SlackNotificationPlugin {
  constructor(api) {
    this.api = api;
  }

  async onLoad() {
    this.api.registerHook('afterAnalysis', async (data = {}) => {
      const issues = (Array.isArray(data.issues) ? data.issues : [])
        .filter(issue => NOTIFY_SEVERITIES.has(String(issue.severity || '').toLowerCase()));
      if (issues.length === 0) return data;

      const listed = issues.slice(0, MAX_LISTED_ISSUES).map(issue => {
        const location = issue.file ? ` (${escapeSlack(issue.file)}${issue.line ? `:${issue.line}` : ''})` : '';
        return `• *${escapeSlack(String(issue.severity).toUpperCase())}* ${escapeSlack(issue.message)}${location}`;
      });
      if (issues.length > MAX_LISTED_ISSUES) {
        listed.push(`…and ${issues.length - MAX_LISTED_ISSUES} more`);
      }

      const text = `AQT found ${issues.length} critical/high-severity issue(s)`;
      const notification = {
        channel: 'slack',
        payload: {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*${text}*` } },
            { type: 'section', text: { type: 'mrkdwn', text: listed.join('\n') } }
          ]
        }
      };

      return {
        ...data,
        notifications: [...(Array.isArray(data.notifications) ? data.notifications : []), notification]
      };
    });
  }
};

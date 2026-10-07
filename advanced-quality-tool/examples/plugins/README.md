# Example plugins

These examples use the plugin API described in
[Plugin Development](../../docs/PLUGIN-DEVELOPMENT.md). Plugins run in the plugin
manager's VM context: only `path` and `crypto` can be required, and plugins have
no network access. VM isolation is not a security boundary, so only install
plugins you have reviewed.

| Example | Format | Demonstrates |
| --- | --- | --- |
| [`analysis-hook/`](./analysis-hook/) | Directory | Logging from the `afterAnalysis` hook |
| [`no-todo-rule/`](./no-todo-rule/) | Directory | A custom rule that reports `TODO` markers |
| [`custom-analyzer-plugin.js`](./custom-analyzer-plugin.js) | Single file | A custom rule that reports lines longer than 120 characters |
| [`custom-reporter-plugin.js`](./custom-reporter-plugin.js) | Single file | A `formatReport` hook that renders a Markdown severity summary when `format` is `severity-summary` |
| [`slack-notification-plugin.js`](./slack-notification-plugin.js) | Single file | An `afterAnalysis` hook that prepares a Slack message for critical and high-severity issues |
| [`custom-fix-strategy-plugin.js`](./custom-fix-strategy-plugin.js) | Single file | A `beforeFix` hook that attaches reviewable trailing-whitespace fix suggestions |

## Installing

Install an example into the workspace's `.aqt/plugins/` directory:

```bash
aqt plugin install examples/plugins/custom-reporter-plugin.js
aqt plugin list
```

## How hooks and rules run

Plugins only register behavior; the host decides when to call it.

- **Hooks** run when the host calls `PluginManager.executeHook(name, data)`. From
  an MCP client, use the `aqt_plugin_execute_hook` tool, for example
  `{ "hookName": "formatReport", "data": { "format": "severity-summary", "issues": [...] } }`.
  AQT's built-in `analyze`, `report`, and `fix` commands do not call plugin hooks yet.
- **Rules** are registered with `registerRule` and run through
  `PluginManager.runCustomRules(filePath, ast, context)`. A rule's `check`
  receives `(filePath, ast, context)`; the examples read `context.source` when it
  is provided and otherwise read the file.

## Notes on specific examples

- **Slack notification:** the plugin adds a `notifications` entry containing a
  Slack Block Kit payload. It does not send anything. To deliver messages,
  configure the host notification system (for example `AQT_SLACK_WEBHOOK_URL`).
- **Custom fix strategy:** suggestions require the issue to include its original
  `sourceLine`. Every suggestion is marked `requiresReview: true`; the plugin
  never writes files.

The tests in `test/__tests__/example-plugins.test.js` load every example through
the plugin manager and exercise its hooks and rules.

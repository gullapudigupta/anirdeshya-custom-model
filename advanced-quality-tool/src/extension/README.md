# Extension Module

## Overview

The `src/extension` module provides the VS Code extension implementation for Advanced Quality Tool, enabling real-time code analysis and fix suggestions directly in the editor.

## Contents

| File | Description |
|------|-------------|
| `extension.js` | Main extension entry point and activation |
| `lib/aqt-service.js` | Core service integration |
| `lib/code-actions-provider.js` | Quick fix code actions |
| `lib/config.js` | Extension configuration handling |
| `lib/diagnostics-provider.js` | Diagnostics management |
| `lib/status-bar.js` | Status bar integration |
| `lib/webview-panel.js` | WebView panel for results |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code Extension                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Extension   │  │ Diagnostics │  │ Code Actions│     │
│  │ Entry Point │  │ Provider    │  │ Provider    │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
│         └────────────────┼────────────────┘             │
│                          ▼                              │
│              ┌───────────────────────┐                  │
│              │     AQT Service       │                  │
│              └───────────────────────┘                  │
│                          │                              │
│         ┌────────────────┼────────────────┐            │
│         ▼                ▼                ▼            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Status Bar  │  │ WebView     │  │ Config      │     │
│  │ Integration │  │ Panel       │  │ Management  │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└─────────────────────────────────────────────────────────┘
```

## Key Components

### Extension Entry Point

Main activation and command registration:

```javascript
// In extension.js
const vscode = require('vscode');

function activate(context) {
  // Register commands
  const analyzeCmd = vscode.commands.registerCommand('aqt.analyze', analyze);
  const fixCmd = vscode.commands.registerCommand('aqt.fix', fixIssues);
  
  context.subscriptions.push(analyzeCmd, fixCmd);
}
```

### AQT Service

Core service integration layer:

```javascript
const { AqtService } = require('./lib/aqt-service');

const service = new AqtService(projectRoot, {
  linters: ['eslint'],
  cacheResults: true
});

const issues = await service.analyze({
  files: ['src/**/*.js'],
  rules: ['no-unused-vars']
});
```

### Diagnostics Provider

Converts issues to VS Code diagnostics:

```javascript
const { toDiagnosticsByFile } = require('./lib/diagnostics-provider');

const diagnostics = toDiagnosticsByFile(issues, {
  severityRank: { error: 0, warning: 1, info: 2 }
});

// Map to VS Code diagnostic collection
diagnosticCollection.set(uri, diagnostics);
```

### Code Actions Provider

Provides quick fix actions:

```javascript
const { buildActionsForIssues } = require('./lib/code-actions-provider');

const actions = buildActionsForIssues(issues);
// Returns array of CodeAction objects with fix suggestions
```

### Configuration

Handles extension settings:

```javascript
const { normalizeConfig } = require('./lib/config');

const config = normalizeConfig(vscode.workspace.getConfiguration('aqt'));
// {
//   enabled: boolean,
//   lintOnSave: boolean,
//   maxIssuesPerFile: number,
//   ignoredRules: string[],
//   ...
// }
```

### WebView Panel

Renders results in a webview:

```javascript
const { renderHtml } = require('./lib/webview-panel');

const html = renderHtml(issues, stats, {
  showSeverity: true,
  showLocation: true
});
```

## Commands

| Command | Description |
|---------|-------------|
| `aqt.analyze` | Analyze current file or project |
| `aqt.fix` | Fix issues in current file |
| `aqt.showPanel` | Show results panel |
| `aqt.clearCache` | Clear analysis cache |

## Configuration Options

```json
{
  "aqt.enabled": true,
  "aqt.lintOnSave": true,
  "aqt.maxIssuesPerFile": 100,
  "aqt.ignoredRules": [],
  "aqt.showStatusBar": true,
  "aqt.autoFix": false
}
```

## Activation Events

```json
{
  "activationEvents": [
    "onLanguage:javascript",
    "onLanguage:typescript",
    "onCommand:aqt.analyze"
  ]
}
```

## Usage

### Analyzing Code

```javascript
// Trigger analysis
await vscode.commands.executeCommand('aqt.analyze');

// Results appear in:
// - Problems panel (diagnostics)
// - Status bar (count)
// - WebView panel (detailed view)
```

### Fixing Issues

```javascript
// Fix via command
await vscode.commands.executeCommand('aqt.fix');

// Or via quick fix (Cmd+.)
// Click on issue → Quick Fix → Apply suggested fix
```

## Dependencies

- VS Code Extension API
- AQT core modules
- Node.js file system

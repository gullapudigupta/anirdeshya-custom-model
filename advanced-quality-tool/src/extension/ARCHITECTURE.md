# VS Code Extension Architecture (Phase 3)

Design doc for **P3-T001**. Describes how the Advanced Quality Tool (AQT) is
surfaced inside VS Code and how the extension layer maps onto the existing
Node APIs of the tool. The extension is a thin IDE adapter: all analysis and
fixing logic lives in `src/` and is reused unchanged.

## Goals

- Surface AQT issues in the native VS Code **Problems** panel (diagnostics).
- Offer **quick fixes** (code actions) that call the real `AutoFixEngine`.
- Provide a **webview** panel to browse/filter issues and trigger fixes.
- Expose **settings** for linters, fix strategy, and behavior.
- Show a **status bar** item with the current issue count / analysis state.
- Stay **offline-first and dependency-injectable** so it can be unit-tested
  under the project's zero-dependency `node test/run.js` harness — the `vscode`
  module is never required at load time by testable units.

## Module map

```
src/extension/
  ARCHITECTURE.md          # this file (P3-T001)
  package.json             # extension manifest: activation, commands, config, menus (P3-T002, P3-T006, P3-T008)
  extension.js             # activate()/deactivate() entry point, wiring (P3-T002)
  .vscodeignore            # packaging excludes (P3-T008)
  README.md                # marketplace readme (P3-T008)
  lib/
    aqt-service.js         # framework-free bridge to AQT core APIs (P3-T002)
    diagnostics-provider.js# issue -> vscode.Diagnostic mapping (P3-T003)
    code-actions-provider.js# quick-fix code actions (P3-T004)
    webview-panel.js       # issue browser webview HTML + messaging (P3-T005)
    config.js              # reads workspace configuration (P3-T006)
    status-bar.js          # status bar text/state (P3-T007)
```

## Layering / dependency rule

The `vscode` API is only touched by `extension.js` and by the thin adapter
methods that the entry point calls. The reusable units in `lib/` are written to
be **pure or vscode-agnostic**:

- `aqt-service.js` requires only AQT core modules (`LinterOrchestrator`,
  `issue-normalizer`, `AutoFixEngine`) plus `path`/`fs`. It returns plain data.
- `diagnostics-provider.js` exposes `toDiagnostic(issue)` /
  `toDiagnostics(issues)` that return **plain descriptor objects** (range +
  severity + message + metadata). `extension.js` converts descriptors into real
  `vscode.Diagnostic` instances. This lets the mapping be unit-tested with no
  `vscode` stub.
- `code-actions-provider.js` exposes `buildActions(issue)` returning plain
  action descriptors; the entry point converts them to `vscode.CodeAction`.
- `config.js` exposes `normalizeConfig(raw)` so defaults/validation are tested
  without a live `workspace.getConfiguration`.
- `status-bar.js` exposes `renderStatus(state)` returning `{ text, tooltip }`.
- `webview-panel.js` exposes `renderHtml(issues, stats)` returning an HTML
  string (no `vscode` needed to test the markup / escaping).

This is the same dependency-injection discipline used by Phase 6
(`src/ai-generator`) so the whole extension is verifiable offline.

## Activation events

- `onStartupFinished` — register providers lazily.
- `onCommand:aqt.analyze` / `aqt.fixAll` / `aqt.openPanel` — command palette.
- `workspaceContains:**/package.json` — activate in JS/TS projects.

## Commands (contributed in package.json)

| Command id        | Title                         | Purpose                                  |
|-------------------|-------------------------------|------------------------------------------|
| `aqt.analyze`     | AQT: Analyze Workspace        | Run linters, publish diagnostics         |
| `aqt.fixAll`      | AQT: Fix All Auto-fixable     | Run AutoFixEngine on fixable issues      |
| `aqt.fixIssue`    | AQT: Fix This Issue           | Quick-fix a single diagnostic            |
| `aqt.openPanel`   | AQT: Open Quality Panel       | Open the webview issue browser           |
| `aqt.clear`       | AQT: Clear Diagnostics        | Clear the diagnostic collection          |

## Data flow

```
aqt.analyze
  -> AqtService.analyze(root)              (LinterOrchestrator.runAll + normalize)
  -> issues[]                              (normalized issue schema)
  -> DiagnosticsProvider.toDiagnostics()   (grouped by file, plain descriptors)
  -> extension.js -> DiagnosticCollection  (Problems panel)
  -> StatusBar.renderStatus({issueCount})  (status bar)
  -> WebviewPanel.renderHtml(issues,stats) (if panel open)

Quick fix (code action) / aqt.fixAll
  -> AqtService.fix(issuesByFile, {dryRun}) (AutoFixEngine.fixFiles / fixWithPriority)
  -> re-run analyze to refresh diagnostics
```

## Configuration surface (P3-T006)

`advancedQualityTool.*`:
- `enable` (bool) — master switch.
- `runOnSave` (bool) — re-analyze the saved file.
- `linters` (string[]) — subset of `eslint`, `typescript-eslint`, `prettier`,
  `stylelint`; empty = all available.
- `fixStrategy` (enum) — `rule-only` | `ai-only` | `three-tier`.
- `minConfidence` (number 0..1) — AI fix confidence threshold.
- `backup` (bool) — create backups before fixing.
- `severityFloor` (enum) — lowest severity to surface as a diagnostic.

## Testing (P3-T009)

`test/__tests__/extension.test.js` runs under the existing harness and covers:
- diagnostics mapping (severity, range, source, code),
- code action descriptor construction (only fixable issues get a fix action),
- config normalization (defaults + clamping + linter filtering),
- status bar rendering across states,
- webview HTML rendering + HTML escaping (no XSS from issue messages).

All tests are offline and never require the real `vscode` module.

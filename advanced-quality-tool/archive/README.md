# Archived Language Support

The tool actively supports **TypeScript/JavaScript, C#, and Python** only.
Support for other languages is kept here for future reference rather than
being deleted, so it can be revived without re-researching the integration.

## Contents

| Path | Language | Status | Notes |
|------|----------|--------|-------|
| `languages/java-analyzer.js` | Java | Archived | Checkstyle / PMD / SpotBugs / Error Prone integration. Never wired into the active analysis pipeline. |

## How to restore a language

1. Move the analyzer back into the active tree, e.g.:
   ```powershell
   Move-Item archive/languages/java-analyzer.js src/languages/java-analyzer.js
   ```
2. Register it where the other analyzers are wired up (see how
   `src/languages/csharp-analyzer.js` and `src/languages/python-analyzer.js`
   are imported and used).
3. Re-enable any related tasks in `tasks/phase5-tasks.json` and update docs.

## Why archived, not deleted

These modules represent completed research and working integrations. Keeping
them avoids losing that effort while keeping the active surface area focused
on the three supported languages.

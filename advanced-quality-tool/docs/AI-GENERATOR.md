# AI Generator Guide

AQT's AI generator can draft code, tests, and documentation and prepare issue
fixes. Review generated changes before applying them, run project tests, and
avoid sending secrets or sensitive source to cloud providers.

## Commands

```bash
aqt ai generate code "Create a safe email validator" --language javascript
aqt ai generate test src/email.js --framework jest
aqt ai generate doc src/email.js
aqt ai fix issue-id --dry-run
aqt ai refactor src/email.js "Extract validation into a helper"
aqt ai config openai --model gpt-4
aqt ai cost
```

Set provider credentials in environment variables (for example
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY`). Local Ollama
execution can be used without sending code to a hosted provider. Provider,
model, and budget preferences are separate from credentials.

## Issue-fix safety

`aqt fix` attempts deterministic fixes first. AI fixing is controlled with
`--use-ai-fixes` / `--no-ai-fixes`. The fix coordinator validates generated
code, applies a confidence threshold, and retains the existing backup behavior.
Use `--dry-run` to preview changes.

Generated TypeScript is checked with the TypeScript compiler, using the nearest
`tsconfig.json` when present. Type or configuration errors fail validation;
generated code is not reported as passing when compiler validation fails.
`CodeGenerator` outputs marked as scaffolds are proposals only and do not count
as completed implementations.

## Custom prompt templates

Create a UTF-8 text template using documented placeholders and store it through
the CLI:

```bash
aqt ai templates create concise templates/concise.txt
aqt ai templates list
aqt ai fix issue-id --template concise
aqt ai templates delete concise
```

Available placeholders: `{{severity}}`, `{{category}}`, `{{summary}}`,
`{{what}}`, `{{why}}`, `{{how}}`, `{{context}}`, and `{{outputContract}}`.
Templates are workspace-local under `.aqt/ai-templates/`.

## Quality metrics

Each orchestrator run returns aggregate processed/fixed/failed/skipped counts,
success rate, average duration, category breakdown, and provider cost when
available. These in-memory metrics do not persist prompts, source files, or
issue text.

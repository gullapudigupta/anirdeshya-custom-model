# Task toolkit

Zero-dependency Node scripts (Node 18+). Run from `agent_tasks_new/`:

```
node tools/cli.js validate --profile original|final
node tools/cli.js optimize            # re-assign models, re-order, refresh COST_OPTIMIZED_EXECUTION_ORDER.md
node tools/cli.js next [--folder x]   # next cost batch per spec
node tools/cli.js cost
node tools/cli.js clarify <ID> --question "..." --answer "..." [--status confirmed|recorded_decision|awaiting_user_input]
node tools/cli.js complete <ID> --model <id> --confidence 0.9 --notes "..." [--artifacts a,b]
node tools/cli.js jev [<ID>] [--limit n] [--dry-run] [--response '{"model":"qwen-3","confidence":0.8,"reason":"..."}']
node tools/cli.js scaffold [<ID>] --dir <target> [--dry-run]
```

- Start a task with its recommended model in Copilot CLI:

  ```powershell
  .\tools\start-task.ps1 APP-2
  .\tools\start-task.ps1 APP-2 -Choice 2
  .\tools\start-task.ps1 APP-2 -Model <copilot-cli-model-id>
  .\tools\start-task.ps1 APP-2 -PlanOnly
  ```

  The launcher reads `recommendedModel`, then starts `copilot --model <id> --interactive <task prompt>`. Choice defaults to 1; choices 2 and 3 select the task's listed alternatives. If the task model id differs from an id available in your Copilot CLI, add a mapping to `tools/copilot-model-map.json` or pass `-Model`. IDs depend on Copilot account, CLI version, and policy; this repo does not assume aliases such as `gpt-5.6-luna`.

  This launches the Copilot CLI, not VS Code's built-in Chat panel. VS Code's hooks cannot change the built-in Chat model picker through a documented hook interface. The script's `-PlanOnly` switch displays the selection and prompt without starting Copilot.

- `model-catalog.json` – equal-grade model groups and per-category first choices (from `docs/llm-model-comparison.md`).
- `clarify` records a task-specific question and answer in `userClarifications`; repeated questions update their existing entry.
- Mirror confirmed decisions and outstanding user inputs in the spec's `requirements_v2.md`, keeping the task JSON and requirements aligned.
- `task-template-final.json` – the final task template (regenerate with `node tools/build-final-template.js`).
- `jev` uses the same gateway config as `tools/jev-ai/jev-ai-mcp-server.js` (`AI_GATEWAY_API_KEY`, `JEV_AI_URL`, `JEV_AI_MODEL`); it never fabricates an answer when the key is missing.
- `scaffold` runs tasks that carry an `automation` block with plain JS (no model tokens).

## Bug and change-request records

Use `tools/records.js` to maintain the `bugs/bugs.json` and `crs/crs.json` master indexes. Each master lists chunk files containing at most 50 records; the command creates a new chunk when the current one reaches 50. Record IDs are assigned sequentially (`BUG-1`, `CR-1`, etc.).

```powershell
node tools/records.js add bug --title "Calendar does not load" --description "..." --previous-task FACE-1 --priority HIGH
node tools/records.js add cr --title "Add calendar export" --description "..." --previous-task FACE-1
node tools/records.js update bug BUG-1 --status RESOLVED
node tools/records.js comment bug BUG-1 --text "Confirmed on Android 15" --author "Name"
node tools/records.js reply bug BUG-1 BUG-1-C1 --text "Fix is available in the next build"
```

Records include their previous task reference and an in-item `comments` array; each comment contains its own `replies` array. Keep the master and chunks in sync by making changes through this script.
Example record shapes are in `bugs/sample/bug.json` and `crs/sample/crs.json`. These examples are not indexed records and do not count toward the chunk limit; create tracked records with the `add` command above.

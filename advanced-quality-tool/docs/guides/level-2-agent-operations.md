# Level 2 Agent Operations

Level 2 agent execution is supervised and workspace-scoped. It can prepare and
apply approved patches, run host-configured verification checks, and make
bounded repairs. It does not merge, release, deploy, or automatically resume an
incomplete run.

## Configure a run

Create a `WorkOrchestrator` with an explicit executor and trusted check
configuration. Check IDs are referenced by the plan; commands and arguments
come only from host configuration and run without a shell.

```js
const { WorkOrchestrator } = require('./src/agent');

const orchestrator = new WorkOrchestrator({
  workspace: process.cwd(),
  executor: modelExecutor,
  maxFiles: 10,
  maxRepairElapsedMs: 120000,
  maxRepairTokens: 20000,
  maxRepairCost: 0.5,
  checks: {
    tests: {
      command: process.execPath,
      args: ['test/run.js'],
      timeoutMs: 60000,
      maxOutputBytes: 65536
    }
  },
  onApprovalRequired: async (_item, _plan, details) => {
    return approvalChannel.request({
      planDigest: details.planDigest,
      patchDigest: details.patchDigest,
      diffs: details.diffs
    });
  }
});
```

Executors return a success result for the matching step and versioned
workspace-relative patch operations. Repair calls must return token usage as
`usage: { inputTokens, outputTokens, cost? }`; the orchestrator applies the
configured repair token, output token, elapsed time, cost, changed-file, and
tool-call limits. A repair patch requires a fresh approval bound to its digest.

Required checks must be configured. Missing, failed, errored, timed-out, or
skipped required checks cannot produce a completed result. Check output is
bounded and credential-redacted. The default command environment is restricted
to common OS and runtime variables.

## Approval and headless operation

Plan approval and patch approval are separate decisions. Each is bound to the
current plan digest; patch approval also includes the patch digest. A changed
plan, patch, or action invalidates the matching approval. If no approval handler
is configured, approval-required work is denied. CLI runs without an
interactive approval channel deny approval-required actions rather than
auto-approving them.

## Persistence and recovery

Run records are written under `.aqt-reports/agent-history` within the workspace.
Raw bounded context contents, patch contents, unified-diff contents, and tool
outputs are not persisted; records retain hashes, sizes, status, tool and
verification metadata. Record integrity and referenced workspace hashes are
checked before a record is accepted. Incomplete, tampered, incompatible, or
stale checkpoints return an explicit recovery-required state; automatic resume
is not currently supported.

## Provider support

| Provider | Provider selector | Built-in Level 2 executor |
|---|---|---|
| Ollama | Local provider metadata | No; inject a compatible executor |
| LM Studio | Local provider metadata | No; inject a compatible executor |
| OpenAI | Registered when credentials are configured | No; inject a compatible executor |
| Anthropic | Registered when credentials are configured | No; inject a compatible executor |
| DeepSeek | Registered when credentials are configured | No; inject a compatible executor |
| GLM | Registered when credentials are configured | No; inject a compatible executor |

The provider selector does not itself invoke a model from `WorkOrchestrator`.
No provider call occurs unless the host injects an executor.

## Acceptance evidence and known limitations

Focused automated coverage lives in
[`test/__tests__/phase12-agent-execution.test.js`](../../test/__tests__/phase12-agent-execution.test.js),
[`test/__tests__/phase12-contracts.test.js`](../../test/__tests__/phase12-contracts.test.js),
[`test/__tests__/workspace-patches.test.js`](../../test/__tests__/workspace-patches.test.js),
[`test/__tests__/phase12-persistence.test.js`](../../test/__tests__/phase12-persistence.test.js),
and [`src/agent/__tests__/workflow-service.test.js`](../../src/agent/__tests__/workflow-service.test.js).
These tests use deterministic injected executors and configured local commands.
The complete offline acceptance matrix using a real model executor and its
feature, bug-fix, unsafe-request, missing-toolchain, and denial scenarios has
not yet been established; do not treat the focused tests as that acceptance
suite.

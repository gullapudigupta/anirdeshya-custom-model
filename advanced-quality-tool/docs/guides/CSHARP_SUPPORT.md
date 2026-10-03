# C# Support (Phase 2)

Adds C#/.NET analysis and auto-fix to the Advanced Quality Tool, mirroring the
existing Java analyzer pattern. Covers P2-T001 (research), P2-T002 (Roslyn
integration), P2-T003 (taxonomy), P2-T004 (auto-fix), P2-T005 (docs/examples).

## P2-T001 — Analyzer research (summary)

| Tool | Role | How we integrate | Notes |
|------|------|------------------|-------|
| **Roslyn analyzers** (.NET Compiler Platform) | First-party diagnostics (CSxxxx, IDExxxx) surfaced during compilation | Parse `dotnet build` diagnostics | No extra install; ships with the SDK. Primary path. |
| **StyleCop.Analyzers** | Style/layout rules (SAxxxx) | NuGet analyzer package; diagnostics flow through the build | Deterministically fixable via `dotnet format`. |
| **SonarAnalyzer.CSharp** | Bug/smell/security rules (Sxxxx) | NuGet analyzer package; diagnostics flow through the build | Deep semantic rules; not auto-fixed. |
| **dotnet format** | Whitespace/style formatter | Shell out; `--verify-no-changes` for dry-run | Official, reversible. |

Key decision: Roslyn, StyleCop and Sonar all deliver diagnostics **through the
compiler**, so a single `dotnet build` parse captures all three. This keeps the
integration surface small and matches how the Java analyzer parses tool output.
The analyzer degrades gracefully (empty result) when the toolchain is absent,
and always runs an offline format detector so single-file analysis is useful
with zero dependencies.

Content was rephrased for compliance with licensing restrictions.

## P2-T002 — Roslyn integration

`src/languages/csharp-analyzer.js` → `CSharpAnalyzer`

- `analyzeFile(path)` — finds the nearest `.csproj`/`.sln`, builds & parses
  diagnostics filtered to the file, plus offline format checks.
- `analyzeProject(path)` — `dotnet build` and parse (also parses diagnostics
  from a failed build's stdout/stderr).
- `parseBuildOutput(text)` — turns MSBuild lines
  `File.cs(line,col): severity CODE: message [proj]` into normalized issues,
  deduplicating multi-target repeats.
- `checkTools()` — reports `dotnet` / `dotnet format` availability.
- `findFiles()` / `matchPattern()` — `**/*.cs` discovery, excludes `bin/obj/.vs/packages`.

Issue shape matches the rest of the pipeline: `{ type, tool, ruleId, category,
severity, message, filePath, line, column, fixable }`.

## P2-T003 — C# issue taxonomy

Categorization by rule-id prefix (`categorizeRule`):

| Prefix | Category | Example | Fixable by tooling |
|--------|----------|---------|--------------------|
| `SA1xxx` | STYLE (StyleCop) | SA1028 trailing whitespace, SA1200 using placement | Yes (`dotnet format`) |
| `IDExxxx` | STYLE (IDE) | IDE0005 unnecessary using | Yes |
| `CAxxxx` | CODE_ANALYSIS (NetAnalyzers) | CA1822 mark member static | Sometimes |
| `Sxxxx` | SONAR | S1118 add private constructor | No (needs judgement) |
| `CSxxxx` | COMPILER | CS0246 type not found | No |

Severity mapping (`mapRoslynSeverity`): error→ERROR, warning→WARNING,
info/hidden→INFO.

## P2-T004 — C# auto-fix

`src/fixers/csharp-fixer.js`

- `CSharpPatternFixer` — offline, deterministic transforms with backup/rollback:
  CRLF→LF, leading tabs→spaces (configurable `indentSize`), trailing-whitespace
  removal, single final newline. Honors `dryRun` and `backup`.
- `DotnetFormatFixer` — delegates to `dotnet format` when available
  (`--verify-no-changes` for dry-run).
- `CSharpFixEngine` — coordinator: per-file offline fixes, project-level
  `dotnet format`, aggregate stats.

## P2-T005 — Example

See `examples/analyze-csharp.js` for an end-to-end offline demo (analyze a
sample C# string of diagnostics + fix a messy file in a temp dir).

## P2-T006 — Plugin architecture

Already provided by `src/plugins/plugin-system.js` (`PluginManager` + `Plugin`
base class): sandboxed plugin loading, manifest validation, hook + custom-rule
registration, lifecycle (load/unload/reload). New languages can be added as
plugins that register analyzers/rules through this API, so C# support also
serves as the reference implementation for the extensible language model.

## P2-T007 — Tests

`test/__tests__/csharp.test.js` — 12 offline, deterministic tests covering
severity mapping, rule categorization, build-output parsing + dedupe, offline
format detection, file discovery, and the auto-fixer (dry-run, real fix,
backup+rollback, multi-file stats). Run with `npm test`.

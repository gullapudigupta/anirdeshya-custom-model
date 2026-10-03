# Native Classifier Full-Model Requirements

## Short answer

The current project can run a **basic deterministic classifier**:

```text
English request
  -> regex and phrase scoring
  -> intent, domain, entities, constraints, confidence
  -> Zod validation
  -> first tool route or clarification
```

It cannot yet create a **trained language model** or a **complete coding agent**.

The existing folders provide useful specifications:

- `src/` contains the current rule classifier, schema, router, and fallback.
- `knowledge store/` contains the broad-English roadmap, design, and implementation tasks.
- `next-steps/` describes codebase analysis and code generation after classification.

Most components described in those documents are designs, not implemented runtime modules. The project currently has no versioned utterance dataset, trainer, model artifact, inference adapter, repository analyzer, implementation planner, code generator, or iterative execution engine.

## Three different meanings of model

### 1. Deterministic classification model

Status: **already available as a baseline**.

It uses manually written regular expressions and weighted rules. It is useful for known phrases and controlled commands, but it does not generalize well to unseen paraphrases.

### 2. Trained local intent model

Status: **not yet available**.

This model learns to map English requests to the supported intent taxonomy. A practical first version can use TF-IDF with logistic regression or fastText. It still requires deterministic validation, confidence thresholds, fallback handling, and routing.

### 3. Full coding model or coding agent

Status: **not yet available**.

A trained intent model only decides what the user wants. It does not understand an arbitrary repository or generate correct application changes. A full coding system also needs retrieval, analysis, planning, generation, tools, verification, feedback, and safety controls.

## Current readiness

| Capability | Current status |
| --- | --- |
| Rule-based intent classification | Available |
| Basic domain and entity extraction | Available but limited |
| Agent packet validation | Available |
| Confidence fallback | Available but not calibrated |
| First-action routing | Available with example handlers |
| Versioned language knowledge | Designed, not implemented |
| Training, validation, and test datasets | Missing |
| Learned local intent classifier | Missing |
| Model artifact loading | Missing |
| Repository inventory and search | Designed, not implemented |
| Symbol, reference, call-flow, and data-flow analysis | Designed, not implemented |
| Documentation retrieval | Designed, not implemented |
| Feature specification and planning | Designed, not implemented |
| Code generation | Designed, not implemented |
| Real file, build, and test tools | Missing |
| Iterative execution and repair | Missing |
| Evaluation and release gates | Designed, not implemented |
| Telemetry, active learning, and rollback | Designed, not implemented |

## Recommended full-model folder

```text
full-model/
  README.md
  config/
    model.json
    training.json
    thresholds.json
    safety-policy.json
  data/
    raw/
    reviewed/
    splits/
      training.jsonl
      validation.jsonl
      test.jsonl
    schemas/
      utterance.schema.json
      correction.schema.json
  training/
    prepare-data.ts
    train-baseline.ts
    tune-thresholds.ts
    export-model.ts
  models/
    intent-classifier/
      manifest.json
      vocabulary.json
      labels.json
      model artifact
      metrics.json
  inference/
    local-intent-model.ts
    model-loader.ts
    feature-vectorizer.ts
    candidate-calibrator.ts
    hybrid-classifier.ts
  retrieval/
    documentation-index.ts
    repository-index.ts
    retriever.ts
    result-ranker.ts
  analysis/
    repository-inventory.ts
    symbol-analyzer.ts
    call-graph.ts
    data-flow.ts
    evidence-graph.ts
  planning/
    requirement-resolver.ts
    feature-specification.ts
    implementation-planner.ts
    completion-policy.ts
  generation/
    code-generator.ts
    template-generator.ts
    ast-generator.ts
    local-code-model.ts
  tools/
    schemas.ts
    registry.ts
    search-code.ts
    read-file.ts
    create-file.ts
    edit-file.ts
    run-build.ts
    run-tests.ts
    get-diagnostics.ts
  execution/
    orchestrator.ts
    execution-state.ts
    approval-policy.ts
    repair-loop.ts
  evaluation/
    classify-evaluator.ts
    entity-evaluator.ts
    routing-evaluator.ts
    generation-evaluator.ts
    report.ts
  telemetry/
    events.ts
    redaction.ts
    corrections.ts
  releases/
    manifest.schema.json
    current.json
    previous.json
  test/
    classification/
    analysis/
    generation/
    security/
    end-to-end/
```

The names above describe ownership boundaries. They do not all need to be built at once.

## Part A: Requirements for a basic trained intent model

### 1. Freeze the intent taxonomy

Define each supported intent precisely:

- `ask`
- `search_code`
- `debug_and_fix`
- `generate_code`
- `refactor`
- `explain`
- `run_tests`
- `analyze`
- unknown or clarification outcome

For each intent, specify included requests, excluded requests, confusing neighbors, required entities, allowed tools, and risk level.

### 2. Create reviewed datasets

Add versioned JSONL records:

```json
{"id":"generate-0001","text":"Implement a todo list in Angular","intent":"generate_code","domain":"angular","entities":[{"type":"feature","value":"todo list"}],"constraints":[],"source":"synthetic","split":"training"}
```

Datasets need:

- balanced intent coverage
- direct commands and polite requests
- short fragments and long descriptions
- paraphrases
- spelling errors and abbreviations
- negation and hypothetical requests
- multi-intent requests
- unknown and out-of-domain requests
- near-neighbor examples that are easy to confuse
- separate training, validation, and untouched test splits

The current project has no such dataset, so training should not begin yet.

### 3. Implement preprocessing

Create a shared preprocessing pipeline for training and inference:

- Unicode normalization
- whitespace normalization
- lowercase comparison view
- safe contraction expansion
- protected technical spans
- tokenization
- optional n-grams
- no rewriting of file paths, symbols, URLs, or errors

Training and inference must use the same preprocessing version.

### 4. Train a baseline

Recommended first experiments:

1. TF-IDF word and character n-grams with logistic regression.
2. fastText supervised classification.
3. A compact embedding classifier only if simpler baselines are insufficient.

A baseline should output ranked intent candidates, not tool actions.

```typescript
type IntentCandidate = {
  intent: Intent;
  score: number;
};

interface LocalIntentModel {
  readonly modelVersion: string;
  classify(text: string): Promise<IntentCandidate[]>;
}
```

Training may use a separate Python environment even when production inference is Node.js. Export the final artifact to a format the Node runtime can load, such as ONNX or a documented native format.

### 5. Calibrate unknown detection

A closed-set classifier normally chooses one known label even for irrelevant text. Add an explicit rejection decision using validation-derived thresholds:

- minimum top score
- minimum top-two margin
- per-intent thresholds
- stricter thresholds for risky actions
- required-entity checks
- unsupported-domain checks

Low-confidence or ambiguous input must route to clarification.

### 6. Evaluate the model

Report:

- precision, recall, and F1 per intent
- macro and weighted averages
- confusion matrix
- unknown precision and recall
- calibration error
- entity extraction quality
- incorrect tool-routing rate
- latency, memory, and artifact size

Do not select a model by aggregate accuracy alone.

### 7. Export a versioned artifact

Every artifact requires a manifest:

```json
{
  "modelVersion": "1.0.0",
  "taxonomyVersion": "1.0.0",
  "datasetVersion": "1.0.0",
  "preprocessorVersion": "1.0.0",
  "thresholdVersion": "1.0.0",
  "runtime": "onnx",
  "checksum": "sha256-value"
}
```

The application must reject incompatible or corrupted artifacts.

### 8. Integrate a hybrid classifier

Use deterministic rules for:

- exact high-precision phrases
- negation
- safety constraints
- prohibited actions
- explicit symbols and file paths

Use the local model for paraphrase coverage. Combine both through calibrated policy, then validate the resulting agent packet with Zod.

## Part B: Additional requirements for a full coding agent

A basic intent model is not a code model. The following layers are still required.

### 1. Requirement resolution

Convert vague requests into a validated specification. Ask for clarification when framework, scope, persistence, target module, expected behavior, or acceptance criteria are missing.

### 2. Repository grounding

Detect project languages, frameworks, versions, source roots, existing conventions, build commands, tests, and nearby implementations.

### 3. Repository and documentation retrieval

Provide indexed retrieval for:

- filenames and text
- symbols, definitions, references, and implementations
- framework documentation matched to installed versions
- existing architecture patterns
- diagnostics and test output

Every retrieved claim must be verified against source evidence.

### 4. Codebase analysis

Build call-flow and data-flow evidence for questions such as `how does save work?`. Support framework-specific indirection in Angular, Node.js, and TypeScript.

### 5. Planning

Convert the specification and evidence into ordered typed actions with dependencies, expected outcomes, risks, and approval requirements.

### 6. Code generation

Start with deterministic generation:

- reviewed templates
- Angular schematics
- TypeScript AST transformations
- project-specific generators

A self-hosted code model can be evaluated later for requests outside known templates. It must return candidate artifacts and never write files directly.

### 7. Tool schemas and handlers

Implement real handlers for:

- repository listing
- file and text search
- symbol and reference search
- file reading
- file creation and patching
- build, test, lint, and diagnostics

Every tool needs strict input/output schemas, workspace path enforcement, timeouts, size limits, permissions, and audit records.

### 8. Iterative orchestration

Maintain execution state across:

```text
plan
  -> validate
  -> execute
  -> observe
  -> update evidence
  -> repair or continue
  -> verify completion
```

Set hard limits on iterations, retries, changed files, generated bytes, command duration, and repair attempts.

### 9. Verification and repair

After changes, run the narrowest relevant typecheck, build, tests, lint, and diagnostics. Feed structured failures into a bounded repair planner. Stop when the cause is uncertain or the retry limit is reached.

### 10. Final reporting

Report files changed, implementation decisions, validation results, assumptions, unresolved risks, and failures. Do not claim completion only because files were written.

## Part C: Safety and operations

### Deterministic safety boundary

The model may propose intent, plans, or code. It must not independently authorize execution.

```text
model proposal
  -> schema validation
  -> policy checks
  -> permission and approval
  -> tool execution
  -> verification
```

### Required controls

- workspace path confinement
- tool allowlists
- per-tool schemas
- secret redaction
- prompt-injection resistance for repository content
- read-only default for analysis
- human approval for destructive or external actions
- resource and iteration limits
- immutable release manifests
- rollback to the previous model and knowledge version
- privacy-reviewed telemetry

## Minimum viable delivery plan

### Phase 1: Make the deterministic classifier production-testable

1. Externalize knowledge from `classifier.ts`.
2. Add normalization and protected spans.
3. Add unknown, negation, and ambiguity behavior.
4. Create labeled validation and test datasets.
5. Implement classification metrics and release gates.

Result: a measurable rule-based classifier, not yet a learned model.

### Phase 2: Add a basic trained local model

1. Build reviewed training data.
2. Train TF-IDF/logistic-regression and fastText baselines.
3. Calibrate unknown thresholds.
4. Export and load a versioned artifact.
5. Integrate hybrid rule-plus-model classification.
6. Compare it against the rule-only baseline.

Result: a basic local English intent model.

### Phase 3: Add codebase analysis

1. Implement repository inventory.
2. Add text, file, symbol, and reference tools.
3. Add relevance ranking.
4. Build evidence, call-flow, and data-flow graphs.
5. Generate grounded explanations.

Result: the system can answer repository questions using evidence.

### Phase 4: Add bounded code generation

1. Add requirement specifications and typed plans.
2. Add documentation retrieval.
3. Implement reviewed templates and AST generators.
4. Add path-safe edit tools.
5. Add build and test verification.
6. Add bounded repair.

Result: the system can implement supported feature families safely.

### Phase 5: Evaluate a self-hosted code model

Only after deterministic generation, retrieval, tools, evaluation, and safety gates are stable:

1. Select a code-capable local model.
2. Add context assembly with strict limits.
3. Generate candidate patches, not direct writes.
4. Evaluate correctness, security, latency, and resource use.
5. Keep templates and AST generation as reliable fallbacks.

Result: wider generation coverage without allowing the model to bypass controls.

## What can be built now

With the current repository, the next realistic deliverable is **not a full coding model**. It is one of these:

1. A production-quality deterministic classifier with externalized knowledge and evaluation.
2. A basic local trained intent classifier after creating reviewed datasets.
3. A narrow todo-list generator using templates and strict schemas.
4. A read-only save-flow analyzer using repository search and evidence tracing.

The safest sequence is classifier quality first, then analysis tools, then narrow deterministic generation, and finally optional local models.

## Completion criteria

A basic trained intent model is ready when:

- the dataset is reviewed and versioned
- training is reproducible
- the artifact loads locally
- unknown input is rejected reliably
- it beats or complements the rule baseline on the untouched test set
- every output passes schema and policy checks

A full coding system is ready only when:

- repository evidence grounds analysis and generation
- every action has a validated schema
- permissions and approvals are enforced
- builds and tests verify changes
- repair attempts are bounded
- evaluations meet release thresholds
- releases and model artifacts can be rolled back



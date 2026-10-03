# Code Generation Pipeline After Classification

## Purpose

The native classifier identifies intent, domain, entities, constraints, confidence, required tools, and the first action. It does not generate arbitrary application code by itself.

For a request such as:

> Implement a todo list.

classification is only the first stage. A separate, validated generation pipeline must inspect the target repository, resolve missing requirements, retrieve applicable documentation, create an implementation plan, generate code, apply it through tools, and verify the result.

## End-to-end flow

```text
User request
  -> native classification
  -> missing-information check
  -> repository inspection
  -> documentation retrieval
  -> structured implementation plan
  -> code generation
  -> tool-specific validation
  -> file changes
  -> build and test verification
  -> repair loop or final response
```

## 1. Classify the request

The existing classifier should recognize words such as `implement`, `create`, `generate`, `add`, or `build` and return `generate_code`.

Example packet:

```json
{
  "requestId": "generated-uuid",
  "userMessage": "Implement a todo list in Angular",
  "intent": "generate_code",
  "domain": "angular",
  "entities": ["todo list"],
  "constraints": ["use_project_conventions"],
  "confidence": 0.91,
  "requiredTools": [
    "search_code",
    "read_file",
    "edit_file",
    "run_build"
  ],
  "context": {
    "repo": "frontend-app",
    "openFiles": [],
    "recentActions": []
  },
  "nextAction": "search_code"
}
```

This packet identifies the category of work. It is not yet an executable implementation plan.

## 2. Resolve missing requirements

Before generating code, determine:

- target framework and runtime
- frontend, backend, or full-stack scope
- expected features
- persistence strategy
- authentication requirements
- styling and accessibility requirements
- target repository and module
- testing expectations
- compatibility constraints

For a todo list, useful questions include:

1. Is this Angular, Node.js, plain TypeScript, or full stack?
2. Should todos persist in memory, local storage, a file, or a database?
3. Are create, edit, complete, filter, and delete operations required?
4. Should an existing module or route contain the feature?
5. Are tests required?

The system may infer low-risk details from repository evidence. It should ask for clarification when a decision changes architecture, data storage, public APIs, or security.

## 3. Inspect the repository

Before generation, collect grounded project facts:

- `package.json` dependencies and scripts
- TypeScript configuration
- framework and runtime versions
- source folder structure
- existing components, services, routes, models, and tests
- naming and formatting conventions
- state-management and persistence patterns
- build, lint, and test commands
- nearby implementations that should be followed

Do not generate files from generic assumptions when the repository provides an established pattern.

Recommended first actions:

```json
[
  {
    "tool": "search_code",
    "arguments": {
      "queries": ["package.json", "existing feature components", "service patterns"]
    }
  },
  {
    "tool": "read_file",
    "arguments": {
      "filePath": "package.json"
    }
  }
]
```

## 4. Integrate framework documentation

Store supplied references separately from classification phrases:

```text
native-classifiers/
  knowledge store/
    documentation/
      typescript/
      angular/
      nodejs/
```

Each documentation record should include:

- framework or language
- supported versions
- source title and source URL
- topic
- API or feature names
- content or indexed chunks
- retrieval keywords
- date collected
- checksum

Example metadata:

```json
{
  "id": "angular-signals-computed-v20",
  "technology": "angular",
  "versions": [">=20 <21"],
  "topic": "signals",
  "sourceUrl": "https://angular.dev/guide/signals",
  "keywords": ["signal", "computed", "reactive state"],
  "checksum": "sha256-value"
}
```

Documentation retrieval should use:

- detected framework and version
- classified intent
- extracted entities
- planned artifact types
- repository dependencies
- exact APIs found in nearby code

Retrieve only relevant sections. Documentation supports generation but never replaces repository inspection or validation.

## 5. Build a structured specification

Convert the user request and gathered evidence into a validated feature specification.

```typescript
type FeatureSpecification = {
  requestId: string;
  feature: string;
  framework: "typescript" | "angular" | "nodejs";
  frameworkVersion?: string;
  scope: "frontend" | "backend" | "full_stack" | "library";
  capabilities: string[];
  persistence: "memory" | "local_storage" | "file" | "database" | "none";
  targetModule?: string;
  constraints: string[];
  acceptanceCriteria: string[];
  assumptions: string[];
};
```

Example:

```json
{
  "requestId": "generated-uuid",
  "feature": "todo list",
  "framework": "angular",
  "frameworkVersion": "20",
  "scope": "frontend",
  "capabilities": ["create", "complete", "edit", "delete", "filter"],
  "persistence": "local_storage",
  "targetModule": "src/app/todos",
  "constraints": ["use_project_conventions", "accessible_controls"],
  "acceptanceCriteria": [
    "A user can create a todo",
    "A user can mark a todo complete",
    "Todos survive page refresh",
    "Component tests pass"
  ],
  "assumptions": []
}
```

Validate the specification before planning. Missing required decisions should return to clarification.

## 6. Create an ordered implementation plan

The planner converts the specification into small, typed actions.

Example Angular plan:

```json
{
  "goal": "implement todo list",
  "actions": [
    {
      "id": "action-1",
      "tool": "create_file",
      "arguments": {
        "filePath": "src/app/todos/todo.model.ts",
        "artifactType": "typescript_model"
      },
      "dependsOn": []
    },
    {
      "id": "action-2",
      "tool": "create_file",
      "arguments": {
        "filePath": "src/app/todos/todo.service.ts",
        "artifactType": "angular_service"
      },
      "dependsOn": ["action-1"]
    },
    {
      "id": "action-3",
      "tool": "create_file",
      "arguments": {
        "filePath": "src/app/todos/todo.component.ts",
        "artifactType": "angular_component"
      },
      "dependsOn": ["action-1", "action-2"]
    },
    {
      "id": "action-4",
      "tool": "create_file",
      "arguments": {
        "filePath": "src/app/todos/todo.component.spec.ts",
        "artifactType": "angular_test"
      },
      "dependsOn": ["action-3"]
    },
    {
      "id": "action-5",
      "tool": "run_build",
      "arguments": {},
      "dependsOn": ["action-1", "action-2", "action-3"]
    },
    {
      "id": "action-6",
      "tool": "run_tests",
      "arguments": {
        "scope": "todos"
      },
      "dependsOn": ["action-4", "action-5"]
    }
  ]
}
```

Every action should define:

- unique ID
- tool name
- validated arguments
- dependencies
- reason
- expected result
- risk level
- approval requirement

## 7. Choose a generation strategy

Because this project does not use JevAI or another hosted LLM, use deterministic or self-hosted generation.

### Option A: Templates

Use reviewed templates for common artifacts:

- TypeScript interfaces and classes
- Angular components, services, routes, and tests
- Node.js handlers, services, repositories, and tests

Templates receive validated values such as names, paths, fields, operations, and imports.

This option is predictable but supports only known artifact families.

### Option B: Framework generators

Use official or established generators where available:

- Angular CLI or Angular schematics
- project-specific scaffolding tools
- package-specific generators

Generated output must still be inspected and validated.

### Option C: AST generation and modification

Use structured TypeScript tools such as `ts-morph` or the TypeScript compiler API for:

- imports
- declarations
- class members
- route registration
- module updates
- safe modifications to existing source files

AST operations are preferable to string replacement for structured TypeScript edits.

### Option D: Self-hosted code model

A local code-generation model can support requests outside predefined templates. It must remain behind a generator interface and cannot bypass:

- repository grounding
- documentation retrieval
- schemas
- path policies
- human approval
- builds and tests

Recommended order: templates and framework generators first, AST edits second, optional local model after evaluation.

## 8. Define the generator interface

```typescript
type GeneratedArtifact = {
  filePath: string;
  content: string;
  artifactType: string;
  sourceReferences: string[];
  assumptions: string[];
};

interface CodeGenerator {
  generate(input: {
    specification: FeatureSpecification;
    action: PlannedAction;
    repositoryContext: RepositoryContext;
    documentation: DocumentationChunk[];
  }): Promise<GeneratedArtifact[]>;
}
```

Generators return candidate artifacts. They do not write files directly.

## 9. Add tool-specific schemas

The current `AgentInput` schema is not enough. Define a separate Zod schema for every executable action.

Required schemas include:

- `SearchCodeInput`
- `ReadFileInput`
- `CreateFileInput`
- `EditFileInput`
- `RunBuildInput`
- `RunTestsInput`
- `GetErrorsInput`

Example:

```typescript
const createFileInputSchema = z.object({
  filePath: z.string().min(1),
  content: z.string().max(1_000_000),
  overwrite: z.boolean().default(false),
}).strict();
```

Validation must enforce:

- path remains inside the workspace
- protected files are not overwritten
- overwrite is explicit
- content size is limited
- extension is allowed
- requested tool is permitted for the intent
- required approval has been granted

## 10. Validate generated artifacts before writing

Before a candidate reaches an edit tool:

1. Validate the generator output schema.
2. Normalize and resolve the target path.
3. Ensure the path remains inside the workspace.
4. Detect collisions with existing files.
5. Parse TypeScript where practical.
6. Check imports against installed packages.
7. Compare style with nearby files.
8. Reject placeholders and unsupported assumptions.
9. Preview or require approval for risky changes.

For existing TypeScript files, prefer AST-aware patches over whole-file replacement.

## 11. Implement the execution loop

A complete orchestrator should maintain state:

```typescript
type ExecutionState = {
  specification: FeatureSpecification;
  plan: PlannedAction[];
  completedActions: string[];
  failedActions: string[];
  toolResults: ToolResult[];
  changedFiles: string[];
  iteration: number;
  status: "running" | "needs_clarification" | "failed" | "completed";
};
```

Execution sequence:

```text
select next dependency-ready action
  -> validate action
  -> request approval when required
  -> execute tool
  -> validate result
  -> update state
  -> choose next action
```

Set hard limits for:

- maximum iterations
- files changed
- generated bytes
- command duration
- retries
- build and test repair attempts

## 12. Verify generated code

After edits, run the narrowest relevant checks first.

### TypeScript

- parser or compiler diagnostics
- typecheck
- lint
- unit tests

### Angular

- Angular compiler and template diagnostics
- targeted component/service tests
- application build
- accessibility checks where applicable

### Node.js

- TypeScript typecheck
- unit tests
- API or integration tests
- lint
- runtime smoke test where safe

A failed check returns structured evidence to the repair planner. The system should repair only when the cause is local and understood; otherwise it should stop and report the failure.

## 13. Interpret feedback and repair

Tool results become new execution evidence:

```json
{
  "actionId": "action-5",
  "tool": "run_build",
  "ok": false,
  "diagnostics": [
    {
      "filePath": "src/app/todos/todo.component.ts",
      "code": "TS2304",
      "message": "Cannot find name 'Todo'"
    }
  ]
}
```

The repair planner should:

1. Identify the failed action and affected file.
2. Classify the diagnostic.
3. Read only the necessary nearby context.
4. Generate the smallest corrective action.
5. Re-run the same focused validation.
6. Stop after the configured retry limit.

## 14. Decide when the task is complete

Completion requires:

- all required actions completed
- generated files present
- schemas passed
- required build and tests passed
- no unresolved high-severity diagnostics
- acceptance criteria satisfied
- no pending approval or clarification

Do not mark the task complete merely because files were written.

## 15. Produce the final response

Return:

- feature implemented
- files created or modified
- important design decisions
- validation commands and outcomes
- assumptions made
- unresolved risks or failures

Example:

```text
Implemented an Angular todo list with local-storage persistence.
Created the model, service, standalone component, and component tests.
The Angular build and todo component tests pass.
```

## Todo-list walkthrough

For:

> Implement a todo list in the existing Angular application.

The expected behavior is:

1. Classifier returns `generate_code` and `angular`.
2. Requirement resolver checks persistence and expected operations.
3. Repository inspector detects the Angular version and local conventions.
4. Documentation retriever selects matching Angular and TypeScript references.
5. Specification defines todo fields, operations, persistence, and acceptance criteria.
6. Planner creates model, service, component, route, and test actions as needed.
7. Generator uses Angular templates, schematics, or AST transformations.
8. Each artifact and tool argument passes schema and path validation.
9. Executor writes the files in dependency order.
10. Angular diagnostics, build, and targeted tests run.
11. Local failures receive bounded repair attempts.
12. Final response reports changes and verification.

## Proposed modules

```text
src/
  requirements/
    requirement-resolver.ts
  repository/
    project-inspector.ts
    repository-context.ts
  documentation/
    documentation-schema.ts
    documentation-loader.ts
    documentation-index.ts
    documentation-retriever.ts
  specification/
    feature-specification.ts
  planning/
    implementation-plan.ts
    planner.ts
  generation/
    code-generator.ts
    template-generator.ts
    ast-generator.ts
    templates/
      typescript/
      angular/
      nodejs/
  actions/
    action-schemas.ts
    action-validator.ts
  execution/
    orchestrator.ts
    execution-state.ts
    completion-policy.ts
  verification/
    verifier.ts
    diagnostic-parser.ts
    repair-planner.ts
```

## Recommended delivery order

1. Define `FeatureSpecification`, `PlannedAction`, and tool-specific schemas.
2. Implement missing-requirement detection and clarification.
3. Implement repository inspection and project-version detection.
4. Add the versioned documentation store and retrieval interface.
5. Implement a planner for one narrow feature family.
6. Add deterministic TypeScript and Angular templates.
7. Add path-safe create/edit tool handlers.
8. Implement the execution state machine.
9. Add targeted build, test, and diagnostic handlers.
10. Add bounded repair and completion policies.
11. Expand templates to Node.js and additional feature families.
12. Evaluate a self-hosted code model only when deterministic generation no longer provides enough coverage.

## Safety boundary

The classifier may recommend an action. It must never directly write code or execute commands.

The planner proposes typed actions. The validator authorizes them. The executor invokes approved tools. Verification determines whether the result is complete.



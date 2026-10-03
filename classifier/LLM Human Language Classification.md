# LLM Human Language Classification: Abstracted Agent Input Format

An LLM classifies human language by converting free-form text into a **structured intent packet** that an agent can use for routing, tool selection, and execution.

## 1. Goal

Convert:

> �Find the login bug and fix it in Angular�

into a structured agent input like:

```json
{
  "taskType": "debug_and_fix",
  "domain": "angular",
  "intent": "login_authentication_issue",
  "entities": ["login", "bug"],
  "confidence": 0.92,
  "requiredTools": ["search_code", "read_file", "edit_file", "run_build"],
  "constraints": ["minimal_changes", "preserve_existing_behavior"],
  "nextAction": "search_code"
}
```

## 2. Abstracted classification steps

### Step 1: Receive user text
Input is raw natural language.

Example:
- �Fix token refresh issue�
- �Show where this function is used�
- �Create a React component�

### Step 2: Normalize input
Clean the text before classification:
- trim whitespace
- detect language
- split into tokens
- preserve important code symbols and file names

### Step 3: Detect intent
The model predicts the user�s main goal.

Common intents:
- `ask`
- `search_code`
- `debug_and_fix`
- `generate_code`
- `refactor`
- `explain`
- `run_tests`
- `analyze`

### Step 4: Extract entities
Find meaningful items in the text:
- framework names
- file names
- function names
- error messages
- feature names
- constraints

Example:
- �Angular�
- �login�
- �token refresh�

### Step 5: Infer domain
Map the request to a technical area:
- `react`
- `angular`
- `nodejs`
- `typescript`
- `authentication`
- `api`

### Step 6: Estimate confidence
The model decides how certain it is.

- High confidence ? continue automatically
- Medium confidence ? maybe ask a clarifying question
- Low confidence ? ask user for more detail

### Step 7: Select next action
Choose what the agent should do first:
- search repository
- read file
- ask clarification
- generate patch
- run build
- run tests

### Step 8: Build structured agent input
Convert the text into a strict schema.

This is the key part for agent execution.

## 3. Recommended agent input format

Use a predictable JSON structure.

```json
{
  "requestId": "string",
  "userMessage": "string",
  "intent": "string",
  "domain": "string",
  "entities": ["string"],
  "constraints": ["string"],
  "confidence": 0.0,
  "requiredTools": ["string"],
  "context": {
    "repo": "string",
    "openFiles": ["string"],
    "recentActions": ["string"]
  },
  "nextAction": "string"
}
```

## 4. Example agent input

```json
{
  "requestId": "req-101",
  "userMessage": "Fix the login bug in the Angular app",
  "intent": "debug_and_fix",
  "domain": "angular",
  "entities": ["login", "bug"],
  "constraints": ["minimal_changes", "preserve_behavior"],
  "confidence": 0.94,
  "requiredTools": ["search_code", "read_file", "edit_file", "run_build"],
  "context": {
    "repo": "frontend-app",
    "openFiles": ["src/app/auth/login.component.ts"],
    "recentActions": []
  },
  "nextAction": "search_code"
}
```

## 5. Internal implementation flow

### A. Classifier layer
Takes text and predicts:
- intent
- domain
- entities
- confidence

### B. Planner layer
Decides:
- ask question
- search
- edit
- test
- explain

### C. Router layer
Maps the classification result to actual tools.

### D. Validator layer
Checks:
- schema correctness
- confidence threshold
- allowed tool list

## 6. TypeScript-style implementation outline

```typescript
type AgentInput = {
  requestId: string;
  userMessage: string;
  intent: "ask" | "search_code" | "debug_and_fix" | "generate_code" | "refactor" | "explain";
  domain?: string;
  entities: string[];
  constraints: string[];
  confidence: number;
  requiredTools: string[];
  context: {
    repo?: string;
    openFiles: string[];
    recentActions: string[];
  };
  nextAction: string;
};
```

Pipeline:

1. Receive user message
2. Send message to LLM classifier
3. Parse JSON output
4. Validate with schema
5. Route to tools
6. Execute tool action
7. Feed results back to LLM
8. Repeat until done

## 7. Simple agent decision rules

- If `confidence < 0.6` ? ask clarification
- If `intent = search_code` ? search repository first
- If `intent = debug_and_fix` ? search + read + patch + build
- If `intent = explain` ? respond directly
- If `intent = generate_code` ? generate code with constraints

## 8. Best practice

Do not send raw user text directly to tools.

Instead:
1. classify
2. structure
3. validate
4. execute

This makes the agent safer and more reliable.

## 9. Summary

An LLM classifies human language by:
- understanding intent
- extracting entities
- inferring domain
- estimating confidence
- converting everything into a structured agent input

That structured input is what powers tool-based execution.

## Related document

For the JevAI responsibility split and the full Node.js/TypeScript classifier, schema validation, tool router, and fallback implementation, see [JevAI classification responsibilities and TypeScript implementation.md](JevAI%20classification%20responsibilities%20and%20TypeScript%20implementation.md).



# Broad English Classification Roadmap

## Reality check

No finite rule set can correctly classify **all English text**. English is open-ended, ambiguous, context-dependent, and constantly changing. A production classifier should instead:

1. Define the intents it supports.
2. Recognize many ways of expressing those intents.
3. Detect requests that are unsupported or ambiguous.
4. Ask for clarification instead of forcing every sentence into a known intent.
5. Improve from measured examples and user corrections.

The current classifier is a good deterministic baseline, but its small regex table only recognizes explicit phrases. It does not yet handle broad paraphrases, misspellings, negation, multiple intents, implied meaning, or conversation context.

## Target architecture

Use a layered pipeline:

```text
input
  -> normalization
  -> exact and high-precision rules
  -> phrase/synonym scoring
  -> optional local statistical classifier
  -> entity and constraint extraction
  -> confidence calibration
  -> schema validation
  -> route or ask for clarification
```

The tool router must never execute an action merely because a classifier selected it. Schema validation, intent/tool allowlists, permissions, and fallback behavior remain mandatory.

## Implementation steps

### 1. Define a closed intent taxonomy

Write a precise definition for every supported intent:

- `ask`
- `search_code`
- `debug_and_fix`
- `generate_code`
- `refactor`
- `explain`
- `run_tests`
- `analyze`
- `unknown` or low-confidence fallback behavior

For each intent, record:

- what belongs to it
- what does not belong to it
- confusing neighboring intents
- allowed first tools
- whether execution requires approval

Do not add an intent until it leads to meaningfully different routing or policy.

### 2. Build a versioned utterance dataset

Collect real and synthetic English examples in JSON Lines format. Each record should include:

```json
{"text":"Could you track down where refreshToken is called?","intent":"search_code","domain":"authentication","entities":["refreshToken"],"constraints":[]}
```

For every intent, include:

- direct commands
- polite requests
- questions
- short fragments
- long descriptions
- active and passive voice
- common abbreviations and spelling mistakes
- positive and negative examples
- examples that should trigger clarification
- near-neighbor examples from other intents

Keep training, validation, and test sets separate. Never tune rules against the final test set.

### 3. Normalize without destroying technical text

Before classification:

1. Apply Unicode normalization.
2. Normalize whitespace.
3. Preserve the original message for output and auditing.
4. Produce a lowercase comparison copy.
5. Protect file paths, URLs, error messages, quoted text, and code symbols.
6. Expand safe contractions such as `can't` to `cannot` only in the comparison copy.
7. Optionally correct common natural-language misspellings, but never rewrite code identifiers.

Do not remove punctuation blindly because `?`, quotes, file extensions, and stack traces carry useful meaning.

### 4. Move language knowledge out of source code

Replace hard-coded lists in `src/classifier.ts` with validated, versioned knowledge files:

```text
knowledge store/
  intents.json
  intent-phrases.json
  domains.json
  entities.json
  constraints.json
  abbreviations.json
  confusing-pairs.json
  examples/
    training.jsonl
    validation.jsonl
    test.jsonl
```

Load these files once during startup and validate them with Zod. Reject duplicate IDs, invalid regexes, unknown intents, and unknown tool names.

### 5. Expand phrase coverage systematically

For each intent, maintain phrase families rather than isolated keywords.

Example for `search_code`:

- find, locate, search for, look up
- where is, where do we, which file contains
- show references, list usages, who calls
- trace, follow, identify the implementation

Add negative conditions. For example, `do not run tests` contains the words `run tests` but must not route to `run_tests`.

Score complete phrases more strongly than individual words. A generic word such as `build` should not outweigh a specific phrase such as `build is failing`.

### 6. Handle negation and modality

Detect language such as:

- `do not edit`
- `only explain`
- `you may run tests`
- `do not run the build`
- `I might refactor this later`

Negated actions become constraints, not requested intents. Hypothetical or future actions should receive less weight than direct commands.

### 7. Support multiple intents

Many requests contain a sequence:

> Find the authentication bug, fix it, and run the tests.

Represent this as a primary intent plus an ordered action plan, or extend the schema with `intents` and `actions`. Do not silently discard secondary actions. Validate every planned action independently before execution.

### 8. Improve entity extraction

Add dedicated extractors for:

- file and directory paths
- symbols and function calls
- framework and language names
- quoted text
- error codes and stack-trace lines
- URLs and package names
- versions
- user constraints

Prefer typed entities such as `{ "type": "file", "value": "auth.service.ts" }` when downstream tools need to distinguish files from symbols.

### 9. Add an explicit out-of-domain decision

Unknown input is a valid result, not a classifier failure. Use clarification when:

- no intent reaches the minimum score
- the top two intents are too close
- the requested domain is unsupported
- required entities are missing
- the action is high-risk

Calibrate thresholds using validation data instead of choosing confidence values by intuition.

### 10. Measure quality continuously

Track at least:

- precision, recall, and F1 per intent
- confusion matrix
- unknown-input precision and recall
- entity precision and recall
- calibration error
- fallback rate
- incorrect tool-routing rate

Prioritize precision for destructive or expensive actions. A clarification is cheaper than an incorrect edit or command.

Recommended initial release gates:

- no high-risk action from low-confidence input
- at least 95% precision for automatically executed intents
- 100% schema validation before routing
- regression tests for every production misclassification

### 11. Add active learning

Log, with appropriate privacy controls:

- normalized input
- selected intent and confidence
- alternative intent scores
- fallback reason
- user correction
- final successful action

Review low-confidence and corrected examples regularly. Add representative examples to the dataset, then update rules or retrain before releasing a new knowledge-store version.

Never store secrets, credentials, or raw private source code in the language dataset.

### 12. Add a self-hosted statistical classifier when rules plateau

Rules provide control and precision but do not scale to every paraphrase. For wider English coverage without JevAI or an external API, train and run a local classifier, such as:

- a TF-IDF plus logistic-regression baseline
- fastText supervised classification
- a compact sentence-embedding model with nearest examples
- a small transformer exported to ONNX

Keep deterministic rules for high-precision phrases and safety constraints. Use the local model for paraphrase coverage, then pass its result through the same confidence threshold, Zod schema, allowlist, and fallback handler.

Compare every model against the rule baseline on the untouched test set. Do not adopt it unless it improves measured quality and unknown-input handling.

### 13. Version and release the knowledge store

Assign a version to the taxonomy, language data, thresholds, and model artifact. A release should record:

- dataset version
- rule version
- model version, if any
- evaluation metrics
- changed intents or phrases
- known limitations
- rollback version

Load a complete immutable version at startup rather than partially updating knowledge while requests are being classified.

## Recommended delivery order

1. Add `unknown` behavior and calibrated fallback thresholds.
2. Create intent definitions and confusing-pair examples.
3. Build a balanced test dataset before expanding rules.
4. Externalize phrases, domains, entities, and constraints into validated files.
5. Add normalization, negation, and multi-intent handling.
6. Establish evaluation reports and regression gates.
7. Collect corrections through active learning.
8. Evaluate a self-hosted statistical classifier when rule improvements flatten.

## Definition of success

Success is not “classifies every English sentence.” Success is:

- supported requests are classified accurately across many natural phrasings
- unsupported and ambiguous requests reliably fall back
- entities and constraints survive classification correctly
- no unvalidated classification can invoke a tool
- every release has measurable quality and can be rolled back



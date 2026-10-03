# Example: Adding Model Recommendations to Tasks

This guide shows practical examples of adding model recommendations to task files.

## Example 1: Simple Fix Task

### Task Description
Fix a typo in documentation comments.

### Recommendation: `claude-haiku`
**Reasoning**: Simple text change, no logic required, fast and cheap.

### Before:
```json
{
  "id": "P9-T012",
  "name": "Fix typo in API documentation",
  "description": "Correct spelling error in authentication docs",
  "status": "PENDING",
  "priority": "LOW",
  "estimatedHours": 0.5,
  "tags": ["documentation", "quick-fix"]
}
```

### After:
```json
{
  "id": "P9-T012",
  "name": "Fix typo in API documentation",
  "description": "Correct spelling error in authentication docs",
  "status": "PENDING",
  "priority": "LOW",
  "estimatedHours": 0.5,
  "recommendedModel": "claude-haiku",
  "tags": ["documentation", "quick-fix"]
}
```

---

## Example 2: Feature Implementation

### Task Description
Implement a new CLI command for generating reports.

### Recommendation: `claude-sonnet-4.5`
**Reasoning**: Standard development work, needs code quality and testing, balanced approach.

### Before:
```json
{
  "id": "P8-T004",
  "name": "Standalone CLI Access Point",
  "description": "Provide a dedicated CLI entry point for supported application workflows",
  "status": "PENDING",
  "priority": "HIGH",
  "estimatedHours": 16,
  "value": 90,
  "dependencies": ["P8-T001"],
  "deliverables": [
    "Provide a dedicated CLI entry point for supported application workflows",
    "Define command, option, configuration, exit-code, and machine-readable output behavior",
    "Report required or unavailable models with actionable messages and non-success exit status",
    "Add command-level tests and examples"
  ],
  "tags": ["cli", "commands", "entrypoint", "automation"]
}
```

### After:
```json
{
  "id": "P8-T004",
  "name": "Standalone CLI Access Point",
  "description": "Provide a dedicated CLI entry point for supported application workflows",
  "status": "PENDING",
  "priority": "HIGH",
  "estimatedHours": 16,
  "recommendedModel": "claude-sonnet-4.5",
  "value": 90,
  "dependencies": ["P8-T001"],
  "deliverables": [
    "Provide a dedicated CLI entry point for supported application workflows",
    "Define command, option, configuration, exit-code, and machine-readable output behavior",
    "Report required or unavailable models with actionable messages and non-success exit status",
    "Add command-level tests and examples"
  ],
  "tags": ["cli", "commands", "entrypoint", "automation"]
}
```

---

## Example 3: Architecture Design

### Task Description
Design and implement a microservices architecture with event-driven communication.

### Recommendation: `claude-opus-4.0`
**Reasoning**: Complex architectural decisions, multiple components, needs deep analysis and best practices.

### Before:
```json
{
  "id": "P10-T001",
  "name": "Design Microservices Architecture",
  "description": "Design event-driven microservices architecture with message queue integration",
  "status": "PENDING",
  "priority": "CRITICAL",
  "estimatedHours": 40,
  "value": 100,
  "deliverables": [
    "Service boundary definitions and responsibilities",
    "Event schema and message queue design",
    "Service communication patterns and protocols",
    "Failure handling and retry strategies",
    "Deployment and scaling considerations"
  ],
  "tags": ["architecture", "design", "microservices", "event-driven"]
}
```

### After:
```json
{
  "id": "P10-T001",
  "name": "Design Microservices Architecture",
  "description": "Design event-driven microservices architecture with message queue integration",
  "status": "PENDING",
  "priority": "CRITICAL",
  "estimatedHours": 40,
  "recommendedModel": "claude-opus-4.0",
  "value": 100,
  "deliverables": [
    "Service boundary definitions and responsibilities",
    "Event schema and message queue design",
    "Service communication patterns and protocols",
    "Failure handling and retry strategies",
    "Deployment and scaling considerations"
  ],
  "tags": ["architecture", "design", "microservices", "event-driven"]
}
```

---

## Example 4: Batch Update Multiple Tasks

### Scenario
All tasks in Phase 8 are standard development work suitable for Sonnet.

### Command:
```powershell
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -RecommendedModel "claude-sonnet-4.5"
```

### Before (phase8-tasks.json excerpt):
```json
{
  "phase": "phase8",
  "tasks": [
    {
      "id": "P8-T001",
      "name": "Shared Core and Interface Adapter Architecture",
      "status": "PENDING"
    },
    {
      "id": "P8-T002",
      "name": "Model Context Protocol Server",
      "status": "PENDING"
    },
    {
      "id": "P8-T003",
      "name": "Orchestration Tool Adapter",
      "status": "PENDING"
    }
  ]
}
```

### After:
```json
{
  "phase": "phase8",
  "tasks": [
    {
      "id": "P8-T001",
      "name": "Shared Core and Interface Adapter Architecture",
      "status": "PENDING",
      "recommendedModel": "claude-sonnet-4.5"
    },
    {
      "id": "P8-T002",
      "name": "Model Context Protocol Server",
      "status": "PENDING",
      "recommendedModel": "claude-sonnet-4.5"
    },
    {
      "id": "P8-T003",
      "name": "Orchestration Tool Adapter",
      "status": "PENDING",
      "recommendedModel": "claude-sonnet-4.5"
    }
  ]
}
```

---

## Example 5: Mixed Complexity Phase

### Scenario
Phase 11 has tasks of varying complexity - need different models for different tasks.

### Strategy:
1. Identify complex tasks (architecture, algorithms) → `claude-opus-4.0`
2. Identify standard tasks (features, refactoring) → `claude-sonnet-4.5`
3. Identify simple tasks (fixes, docs) → `claude-haiku`

### Commands:
```powershell
# Complex architecture task
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase11-tasks.json" `
    -TaskId "P11-T001" `
    -RecommendedModel "claude-opus-4.0"

# Standard development tasks
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase11-tasks.json" `
    -TaskId "P11-T002" `
    -RecommendedModel "claude-sonnet-4.5"

.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase11-tasks.json" `
    -TaskId "P11-T003" `
    -RecommendedModel "claude-sonnet-4.5"

# Simple documentation task
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase11-tasks.json" `
    -TaskId "P11-T008" `
    -RecommendedModel "claude-haiku"
```

### Result (phase11-tasks.json):
```json
{
  "phase": "phase11",
  "tasks": [
    {
      "id": "P11-T001",
      "name": "Design Distributed Cache Architecture",
      "recommendedModel": "claude-opus-4.0",
      "estimatedHours": 32,
      "tags": ["architecture", "performance"]
    },
    {
      "id": "P11-T002",
      "name": "Implement Cache Service",
      "recommendedModel": "claude-sonnet-4.5",
      "estimatedHours": 16,
      "tags": ["implementation", "cache"]
    },
    {
      "id": "P11-T003",
      "name": "Add Cache Monitoring",
      "recommendedModel": "claude-sonnet-4.5",
      "estimatedHours": 8,
      "tags": ["monitoring", "metrics"]
    },
    {
      "id": "P11-T008",
      "name": "Update Cache Documentation",
      "recommendedModel": "claude-haiku",
      "estimatedHours": 2,
      "tags": ["documentation"]
    }
  ]
}
```

---

## Decision Matrix

Use this matrix to decide which model to recommend:

| Criteria | Haiku | Sonnet | Opus |
|----------|-------|--------|------|
| **Estimated Hours** | < 2 hours | 2-24 hours | 24+ hours |
| **Code Changes** | < 50 lines | 50-500 lines | 500+ lines |
| **Files Affected** | 1-2 files | 3-10 files | 10+ files |
| **Complexity** | Simple logic | Moderate logic | Complex algorithms |
| **Architecture** | No changes | Minor refactoring | Major design |
| **Testing** | Minimal | Unit + integration | Comprehensive |
| **Dependencies** | None | Few (1-3) | Many (4+) |
| **Risk Level** | Low | Medium | High |

### Quick Rules:
- ✅ **Use Haiku if**: Changes are < 2 hours AND low risk AND simple
- ✅ **Use Sonnet if**: Standard development work, most common choice
- ✅ **Use Opus if**: Architecture, complex algorithms, OR critical + high-value

---

## Dry Run Example

### Preview Changes Before Applying

```powershell
# Check what would change
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -RecommendedModel "claude-sonnet-4.5" `
    -DryRun
```

### Output:
```
Processing: phase8-tasks.json
Recommended Model: claude-sonnet-4.5

  Task P8-T001: [DRY RUN] Would add recommendedModel: claude-sonnet-4.5
  Task P8-T002: [DRY RUN] Would add recommendedModel: claude-sonnet-4.5
  Task P8-T003: [DRY RUN] Would add recommendedModel: claude-sonnet-4.5
  Task P8-T004: Already has recommended model: claude-haiku
    [DRY RUN] Would update: claude-haiku -> claude-sonnet-4.5

[DRY RUN] No changes made. Remove -DryRun to apply changes.
```

### Review and Apply:
If the preview looks good, run without `-DryRun`:
```powershell
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -RecommendedModel "claude-sonnet-4.5"
```

---

## Common Patterns

### Pattern 1: New Phase - All Standard Tasks
```powershell
# One command for entire phase
.\scripts\add-model-recommendations.ps1 -TaskFile "phase9-tasks.json" -RecommendedModel "claude-sonnet-4.5"
```

### Pattern 2: Mixed Phase - Individual Updates
```powershell
# Complex first task
.\scripts\add-model-recommendations.ps1 -TaskFile "phase10-tasks.json" -TaskId "P10-T001" -RecommendedModel "claude-opus-4.0"

# Rest are standard (loop or batch script)
foreach ($id in "P10-T002", "P10-T003", "P10-T004") {
    .\scripts\add-model-recommendations.ps1 -TaskFile "phase10-tasks.json" -TaskId $id -RecommendedModel "claude-sonnet-4.5"
}
```

### Pattern 3: Update Existing Recommendations
```powershell
# First check current state
.\scripts\add-model-recommendations.ps1 -TaskFile "phase8-tasks.json" -RecommendedModel "claude-opus-4.0" -DryRun

# Update if needed
.\scripts\add-model-recommendations.ps1 -TaskFile "phase8-tasks.json" -TaskId "P8-T001" -RecommendedModel "claude-opus-4.0"
```

---

## Validation

### After adding recommendations, verify the hook works:

1. **Restart Kiro session** (activate hooks)

2. **Try to run a task** with the wrong model:
   - Set current model to `claude-haiku`
   - Try task with `recommendedModel: "claude-opus-4.0"`
   - Should see error and be blocked

3. **Switch to correct model** and try again:
   - Change to `claude-opus-4.0`
   - Task should proceed

4. **Check advisory messages**:
   - Submit simple prompt with opus model
   - Should see budget tip

---

## Best Practices

1. ✅ **Always use `-DryRun` first** to preview changes
2. ✅ **Document your reasoning** in task descriptions
3. ✅ **Review periodically** - model recommendations may change
4. ✅ **Consider task value** - high-value tasks may warrant opus
5. ✅ **Think about risk** - critical systems may need opus
6. ✅ **Be conservative** - when in doubt, use sonnet
7. ✅ **Batch similar tasks** - use script for efficiency

---

## Troubleshooting

### Script won't update file
- Check file path is correct relative to `tasks/` directory
- Verify JSON is valid (use JSON validator)
- Ensure file has write permissions

### Task ID not found
- Check task ID exactly matches (case-sensitive)
- Verify task structure (array vs. object with pending)

### Model name concerns
- Use exact model names: `claude-haiku`, `claude-sonnet-4.5`, `claude-opus-4.0`
- Script normalizes for comparison, but store exact names
- Future models can be added to the system

---

**Ready to start?** Pick a task file and run the script with `-DryRun` to see what would change!

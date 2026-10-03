# Model Budget Control System

## Overview

This system ensures that Kiro uses the appropriate AI model for each task, preventing budget overruns and optimizing token usage. It enforces model recommendations at task execution time and provides advisory warnings during user interactions.

## Components

### 1. Pre-Task Execution Hook
**File**: `.kiro/hooks/model-recommendation-enforcer.json`  
**Script**: `scripts/check-model-recommendation.ps1`  
**Trigger**: `PreTaskExec`

This hook **blocks** task execution if the current model doesn't match the task's recommended model.

#### Behavior:
- ✅ **Exit 0**: Model matches or no recommendation → Task proceeds
- 🛑 **Exit 2**: Model mismatch → Task execution BLOCKED
- ❌ **Exit 1**: Error occurred → Task execution blocked

#### Example Output:
```
╔════════════════════════════════════════════════════════════════════════════╗
║                        MODEL RECOMMENDATION MISMATCH                        ║
╠════════════════════════════════════════════════════════════════════════════╣
║                                                                             ║
║  Task: P8-T004                                                              ║
║  Task File: phase8-tasks.json                                               ║
║                                                                             ║
║  Current Model:      claude-sonnet-4.5                                      ║
║  Recommended Model:  claude-opus-4.0                                        ║
║                                                                             ║
║  This task requires a different model to ensure optimal token usage        ║
║  and budget control.                                                        ║
║                                                                             ║
║  ACTION REQUIRED:                                                           ║
║  Please switch to the recommended model before executing this task.        ║
║                                                                             ║
╚════════════════════════════════════════════════════════════════════════════╝
```

### 2. User Prompt Advisory Hook
**File**: `.kiro/hooks/model-budget-advisor.json`  
**Script**: `scripts/model-budget-advisor.ps1`  
**Trigger**: `UserPromptSubmit`

This hook **advises** (but doesn't block) when the current model might not be optimal for the user's request.

#### Behavior:
- Analyzes prompt complexity
- Compares with current model cost tier
- Provides recommendations (non-blocking)

#### Example Output:
```
💡 BUDGET TIP: You're using a high-cost model (claude-opus-4.0) for what appears 
   to be a simple task. Consider switching to a more cost-effective model like
   claude-sonnet or claude-haiku to save on token usage.
```

## Task File Format

### Adding Model Recommendations

Tasks should include a `recommendedModel` field:

```json
{
  "id": "P8-T004",
  "name": "Standalone CLI Access Point",
  "status": "PENDING",
  "recommendedModel": "claude-sonnet-4.5",
  "priority": "HIGH",
  "estimatedHours": 16,
  ...
}
```

### Model Selection Guidelines

| Model | Use Case | Relative Cost |
|-------|----------|---------------|
| `claude-haiku` | Simple tasks: typos, formatting, small updates, documentation | LOW |
| `claude-sonnet-4.5` | Moderate tasks: feature implementation, refactoring, bug fixes | MEDIUM |
| `claude-opus-4.0` | Complex tasks: architecture design, complex algorithms, code review | HIGH |

### Recommended Models by Task Type

#### Use `claude-haiku` for:
- Fixing typos or formatting
- Adding log statements
- Updating comments or documentation
- Simple renaming operations
- Small configuration changes

#### Use `claude-sonnet-4.5` for:
- Feature implementation
- Refactoring existing code
- Bug fixes
- Test writing
- API integration
- CLI command development

#### Use `claude-opus-4.0` for:
- System architecture design
- Complex algorithm implementation
- Comprehensive code reviews
- Multi-file refactoring with architectural changes
- Performance optimization requiring deep analysis
- Security vulnerability analysis

## Setup and Configuration

### Initial Setup

1. **Hooks are already created** at:
   - `.kiro/hooks/model-recommendation-enforcer.json`
   - `.kiro/hooks/model-budget-advisor.json`

2. **Scripts are located** at:
   - `scripts/check-model-recommendation.ps1`
   - `scripts/model-budget-advisor.ps1`
   - `scripts/add-model-recommendations.ps1`

3. **Hooks activate automatically** on the next Kiro session start.

### Adding Model Recommendations to Tasks

Use the helper script to add recommendations:

```powershell
# Add recommendation to a specific task
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -TaskId "P8-T004" `
    -RecommendedModel "claude-sonnet-4.5"

# Add recommendation to all tasks in a file
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -RecommendedModel "claude-sonnet-4.5"

# Preview changes without modifying files
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -RecommendedModel "claude-sonnet-4.5" `
    -DryRun

# See available task files
.\scripts\add-model-recommendations.ps1 -Help
```

### Manual Task File Update

You can also manually edit task files:

```json
{
  "tasks": [
    {
      "id": "P8-T004",
      "name": "Task Name",
      "recommendedModel": "claude-sonnet-4.5",
      ...
    }
  ]
}
```

## How It Works

### PreTaskExec Flow

```
User starts task → PreTaskExec hook fires → check-model-recommendation.ps1 runs
                                                        ↓
                                          Reads task context from stdin
                                                        ↓
                                    Checks recommendedModel field in task
                                                        ↓
                              ┌─────────────────────────────────────┐
                              │                                     │
                    No recommendation              Recommendation exists
                              │                                     │
                         Allow (exit 0)              Compare models
                                                            ↓
                                              ┌─────────────────────┐
                                              │                     │
                                          Match              Mismatch
                                              │                     │
                                        Allow (exit 0)    Block (exit 2)
                                                          Show error message
```

### UserPromptSubmit Flow

```
User submits prompt → UserPromptSubmit hook fires → model-budget-advisor.ps1 runs
                                                                  ↓
                                                  Analyze prompt complexity
                                                                  ↓
                                                  Check current model tier
                                                                  ↓
                                              ┌───────────────────────────┐
                                              │                           │
                                    High cost + Simple task    Low cost + Complex task
                                              │                           │
                                    Suggest cheaper model    Suggest better model
                                              │                           │
                                       Advisory message (exit 0, non-blocking)
```

## Disabling the Hooks

If you need to temporarily disable these hooks:

### Disable Model Enforcement (allows mismatched models):
```powershell
# Edit .kiro/hooks/model-recommendation-enforcer.json
# Change: "disabled": false  to  "disabled": true
```

### Disable Budget Advisor (stops advisory messages):
```powershell
# Edit .kiro/hooks/model-budget-advisor.json
# Change: "disabled": false  to  "disabled": true
```

### Re-enable:
Change back to `"disabled": false` and restart the Kiro session.

## Testing the System

### Test the Pre-Task Hook:

```powershell
# Simulate task execution with model mismatch
$testContext = @{
    sessionId = "test-session"
    model = "claude-sonnet-4.5"
    taskContext = @{
        taskId = "P8-T004"
        taskFile = "phase8-tasks.json"
        recommendedModel = "claude-opus-4.0"
    }
} | ConvertTo-Json

$testContext | .\scripts\check-model-recommendation.ps1
# Should exit with code 2 and show error message
```

### Test the Advisory Hook:

```powershell
# Simulate simple task with expensive model
$testContext = @{
    model = "claude-opus-4.0"
    userPrompt = "fix the typo in the comment"
} | ConvertTo-Json

$testContext | .\scripts\model-budget-advisor.ps1
# Should show budget tip
```

## Troubleshooting

### Hook Not Firing

1. Restart Kiro session (hooks load at session start)
2. Check hook files exist in `.kiro/hooks/`
3. Verify PowerShell execution policy allows scripts
4. Check hook logs in Kiro

### Model Still Mismatched

1. Ensure task file has `recommendedModel` field
2. Verify hook exit code is 2 (blocks execution)
3. Check if hook is disabled in JSON file
4. Review hook output in Kiro's hook logs

### Script Errors

```powershell
# Test script directly with -Help flag
.\scripts\check-model-recommendation.ps1 -Help
.\scripts\model-budget-advisor.ps1 -Help
.\scripts\add-model-recommendations.ps1 -Help

# Run with verbose error handling
$ErrorActionPreference = "Stop"
.\scripts\check-model-recommendation.ps1
```

## Best Practices

1. **Always specify `recommendedModel`** for tasks with estimated hours > 4
2. **Use haiku for maintenance tasks** to save budget
3. **Reserve opus for critical architecture work** only
4. **Review model usage weekly** to optimize costs
5. **Update recommendations** as new models become available
6. **Document reasoning** for model choices in task descriptions

## Future Enhancements

Potential improvements to this system:

- [ ] Automatic model recommendation based on task complexity analysis
- [ ] Budget tracking and reporting dashboard
- [ ] Per-user or per-project model budgets
- [ ] Integration with token usage analytics
- [ ] Model recommendation learning from past task outcomes
- [ ] Support for custom model cost configurations

## Related Documentation

- [Kiro Hooks Documentation](../.kiro/README.md)
- [Task Management](./TASK_MANAGEMENT.md)
- [CLI Documentation](./interfaces/CLI.md)

---

**Last Updated**: 2026-09-30  
**Status**: Active  
**Maintainer**: Development Team

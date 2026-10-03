# Quick Model Selection Guide

## 🚀 TL;DR

**The system now automatically enforces model recommendations for tasks!**

When you try to execute a task with the wrong model, you'll be blocked and prompted to switch.

## ✅ What Was Created

### 1. **Two Hooks** (Active on next session restart)
   - **Model Recommendation Enforcer** - Blocks task execution if model mismatch
   - **Model Budget Advisor** - Warns about suboptimal model usage

### 2. **Three PowerShell Scripts**
   - `scripts/check-model-recommendation.ps1` - Enforces model requirements
   - `scripts/model-budget-advisor.ps1` - Provides budget advice
   - `scripts/add-model-recommendations.ps1` - Adds recommendations to tasks

### 3. **Documentation**
   - `docs/MODEL_BUDGET_CONTROL.md` - Complete system documentation

## 🎯 Quick Model Selection

| Task Type | Model | Why? |
|-----------|-------|------|
| Fix typo, format code, simple update | `claude-haiku` | Fast & cheap |
| Build feature, refactor, bug fix | `claude-sonnet-4.5` | Balanced |
| Design architecture, complex algorithm | `claude-opus-4.0` | Most capable |

## 📝 Adding Model Recommendations to Tasks

### Option 1: Use the Script (Recommended)

```powershell
# For one task
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -TaskId "P8-T004" `
    -RecommendedModel "claude-sonnet-4.5"

# For all tasks in a file
.\scripts\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -RecommendedModel "claude-sonnet-4.5"
```

### Option 2: Edit JSON Manually

Add `"recommendedModel": "model-name"` to each task:

```json
{
  "id": "P8-T004",
  "name": "Task Name",
  "recommendedModel": "claude-sonnet-4.5",
  "status": "PENDING",
  ...
}
```

## 🛡️ What Happens When You Run a Task?

### ✅ Model Matches
```
✓ Model check passed: Current model (claude-sonnet-4.5) is compatible 
  with recommended model (claude-sonnet-4.5) for task P8-T004
→ Task proceeds normally
```

### 🛑 Model Mismatch
```
╔══════════════════════════════════════════════════╗
║       MODEL RECOMMENDATION MISMATCH              ║
╠══════════════════════════════════════════════════╣
║ Current Model:      claude-sonnet-4.5            ║
║ Recommended Model:  claude-opus-4.0              ║
║                                                  ║
║ Please switch models before executing this task  ║
╚══════════════════════════════════════════════════╝
→ Task execution BLOCKED
```

## 🔧 How to Change Models in Kiro

1. Press `Ctrl+Shift+P` (Command Palette)
2. Type "model" or use `/model` command
3. Select the recommended model
4. Try the task again

## 💡 Budget Tips

### You'll See Advice Like:

**When using expensive model for simple task:**
```
💡 BUDGET TIP: You're using claude-opus-4.0 for a simple task.
   Consider switching to claude-sonnet or claude-haiku to save tokens.
```

**When using cheap model for complex task:**
```
⚠️  COMPLEXITY WARNING: You're using claude-haiku for a complex task.
   Consider using claude-opus or claude-sonnet-4 for better results.
```

## 🔍 Testing

### Test if hooks are working:

```powershell
# Test the enforcement script
$test = @{
    model = "claude-sonnet-4.5"
    taskContext = @{
        taskId = "TEST"
        recommendedModel = "claude-opus-4.0"
    }
} | ConvertTo-Json

$test | .\scripts\check-model-recommendation.ps1
# Should show error and exit with code 2
```

## ⚙️ Disable If Needed

Edit hook JSON files and set `"disabled": true`:
- `.kiro/hooks/model-recommendation-enforcer.json`
- `.kiro/hooks/model-budget-advisor.json`

Then restart Kiro session.

## 📊 Example Task Updates

### Before:
```json
{
  "id": "P8-T004",
  "name": "Standalone CLI Access Point",
  "status": "PENDING",
  "priority": "HIGH"
}
```

### After:
```json
{
  "id": "P8-T004",
  "name": "Standalone CLI Access Point",
  "status": "PENDING",
  "priority": "HIGH",
  "recommendedModel": "claude-sonnet-4.5"
}
```

## 🎓 Best Practices

1. ✅ **Always add `recommendedModel`** for tasks > 4 hours
2. ✅ **Use haiku** for maintenance and simple fixes
3. ✅ **Use sonnet** as default for most development
4. ✅ **Use opus** only for complex architecture/algorithms
5. ✅ **Review weekly** to ensure optimal model usage

## 🆘 Troubleshooting

### Hooks not working?
- Restart Kiro session (hooks load at startup)
- Check files exist in `.kiro/hooks/`
- Verify PowerShell can run scripts

### Still seeing wrong model?
- Check task file has `recommendedModel` field
- Verify hook shows error message (should block)
- Check hook isn't disabled in JSON

### Need help?
- Run scripts with `-Help` flag
- See full docs: `docs/MODEL_BUDGET_CONTROL.md`

---

**Status**: ✅ System Active  
**Impact**: Prevents accidental budget overruns  
**User Action**: Restart Kiro session to activate hooks

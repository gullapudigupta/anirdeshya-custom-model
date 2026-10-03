# Scripts Directory

This directory contains PowerShell automation scripts for the Advanced Quality Tool.

## Model Budget Control Scripts

### 1. check-model-recommendation.ps1
**Purpose**: Enforce model recommendations for task execution  
**Usage**: Automatically called by PreTaskExec hook  
**Exit Codes**:
- 0: Model matches or no recommendation (proceed)
- 2: Model mismatch (block execution)
- 1: Error occurred

**Manual Testing**:
```powershell
$context = @{
    model = "claude-sonnet-4.5"
    taskContext = @{
        taskId = "P8-T004"
        taskFile = "phase8-tasks.json"
        recommendedModel = "claude-opus-4.0"
    }
} | ConvertTo-Json

$context | .\check-model-recommendation.ps1
```

**Help**:
```powershell
.\check-model-recommendation.ps1 -Help
```

### 2. model-budget-advisor.ps1
**Purpose**: Provide model usage recommendations  
**Usage**: Automatically called by UserPromptSubmit hook  
**Exit Codes**:
- 0: Advice provided or no advice needed (non-blocking)
- 1: Error occurred (still non-blocking)

**Manual Testing**:
```powershell
$context = @{
    model = "claude-opus-4.0"
    userPrompt = "fix typo in comment"
} | ConvertTo-Json

$context | .\model-budget-advisor.ps1
```

**Help**:
```powershell
.\model-budget-advisor.ps1 -Help
```

### 3. add-model-recommendations.ps1
**Purpose**: Add recommendedModel field to task files  
**Usage**: Manual tool for updating task JSON files

**Examples**:
```powershell
# Add recommendation to specific task
.\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -TaskId "P8-T004" `
    -RecommendedModel "claude-sonnet-4.5"

# Add recommendation to all tasks in a file
.\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -RecommendedModel "claude-sonnet-4.5"

# Preview changes (dry run)
.\add-model-recommendations.ps1 `
    -TaskFile "phase8-tasks.json" `
    -RecommendedModel "claude-sonnet-4.5" `
    -DryRun

# List available task files
.\add-model-recommendations.ps1

# Show help
.\add-model-recommendations.ps1 -Help
```

## Hook Integration

These scripts are called by Kiro hooks defined in `.kiro/hooks/`:

- **model-recommendation-enforcer.json** → calls `check-model-recommendation.ps1`
- **model-budget-advisor.json** → calls `model-budget-advisor.ps1`

Hooks activate automatically on Kiro session start.

## Requirements

- **PowerShell**: 5.1 or higher
- **Execution Policy**: Scripts use `-ExecutionPolicy Bypass` when called by hooks
- **JSON Support**: ConvertFrom-Json / ConvertTo-Json cmdlets

## Troubleshooting

### Script Won't Run

1. Check PowerShell version:
   ```powershell
   $PSVersionTable.PSVersion
   ```

2. Test execution policy:
   ```powershell
   Get-ExecutionPolicy
   ```

3. Run directly to see errors:
   ```powershell
   .\check-model-recommendation.ps1 -Help
   ```

### Hook Not Calling Script

1. Verify hook file exists: `.kiro/hooks/model-recommendation-enforcer.json`
2. Check hook's command path points to correct script location
3. Restart Kiro session (hooks load at startup)
4. Look for hook output in Kiro's hook logs

### Script Exits with Error Code 1

- Run with `-Help` flag to see usage
- Check input JSON format matches expected schema
- Review error output for specific issue
- Verify task file paths are correct

## Development

### Adding New Scripts

1. Create PowerShell script in this directory
2. Add `-Help` parameter support
3. Document in this README
4. Create hook if needed (use `createHook` tool)
5. Update main documentation

### Testing Scripts

Always test scripts manually before using in hooks:

```powershell
# 1. Test with -Help
.\your-script.ps1 -Help

# 2. Test with sample input
$testInput = @{ test = "data" } | ConvertTo-Json
$testInput | .\your-script.ps1

# 3. Check exit code
echo $LASTEXITCODE
```

## Related Documentation

- [Model Budget Control System](../docs/MODEL_BUDGET_CONTROL.md) - Complete documentation
- [Quick Model Guide](../docs/QUICK_MODEL_GUIDE.md) - Quick reference
- [Kiro Hooks](../.kiro/README.md) - Hook system documentation

---

**Last Updated**: 2026-09-30

# Model Recommendation Checker for Kiro Tasks
# This script checks if the current model matches the task's recommended model
# Usage: Called by PreTaskExec hook with task context passed via stdin

param(
    [switch]$Help
)

if ($Help) {
    Write-Host @"
Model Recommendation Checker
============================
This script validates that the current Kiro model matches the task's recommended model.
It receives task context via stdin (JSON) and exits with:
  - Exit 0: Model matches or no recommendation specified (success)
  - Exit 2: Model mismatch detected (blocks task execution)
  - Exit 1: Error occurred during check

Expected stdin JSON format:
{
  "sessionId": "...",
  "model": "claude-sonnet-4.5",
  "taskContext": {
    "taskId": "P8-T004",
    "taskFile": "phase8-tasks.json",
    "recommendedModel": "claude-opus-4.0"
  }
}
"@
    exit 0
}

# Function to normalize model names for comparison
function Normalize-ModelName {
    param([string]$ModelName)
    
    if ([string]::IsNullOrWhiteSpace($ModelName)) {
        return ""
    }
    
    # Normalize to lowercase and remove common variations
    $normalized = $ModelName.ToLower().Trim()
    
    # Handle version variations
    $normalized = $normalized -replace 'claude-', ''
    $normalized = $normalized -replace '-\d+\.?\d*$', '' # Remove version numbers
    $normalized = $normalized -replace '\s+', '-'
    
    return $normalized
}

# Function to check if models are compatible
function Test-ModelCompatibility {
    param(
        [string]$CurrentModel,
        [string]$RecommendedModel
    )
    
    $current = Normalize-ModelName $CurrentModel
    $recommended = Normalize-ModelName $RecommendedModel
    
    # If no recommended model specified, allow any model
    if ([string]::IsNullOrWhiteSpace($recommended)) {
        return $true
    }
    
    # Check for exact match or family match
    if ($current -eq $recommended) {
        return $true
    }
    
    # Check if they're in the same family (e.g., both opus, both sonnet)
    $currentFamily = ($current -split '-')[0]
    $recommendedFamily = ($recommended -split '-')[0]
    
    # For strict budget control, require exact family match
    # Comment this out for more lenient checking
    if ($currentFamily -ne $recommendedFamily) {
        return $false
    }
    
    return $true
}

try {
    # Read JSON context from stdin
    $stdinContent = @()
    while ($null -ne ($line = Read-Host)) {
        $stdinContent += $line
    }
    
    if ($stdinContent.Count -eq 0) {
        Write-Error "No input received from stdin"
        exit 1
    }
    
    $context = $stdinContent -join "`n" | ConvertFrom-Json
    
    # Extract current model and task information
    $currentModel = $context.model
    $taskContext = $context.taskContext
    
    if (-not $taskContext) {
        # No task context means this isn't a task execution
        Write-Host "No task context provided. Allowing execution."
        exit 0
    }
    
    $taskId = $taskContext.taskId
    $taskFile = $taskContext.taskFile
    $recommendedModel = $taskContext.recommendedModel
    
    # If no recommended model, allow any model
    if ([string]::IsNullOrWhiteSpace($recommendedModel)) {
        Write-Host "Task $taskId has no model recommendation. Current model: $currentModel"
        exit 0
    }
    
    # Check model compatibility
    $isCompatible = Test-ModelCompatibility -CurrentModel $currentModel -RecommendedModel $recommendedModel
    
    if ($isCompatible) {
        Write-Host "✓ Model check passed: Current model ($currentModel) is compatible with recommended model ($recommendedModel) for task $taskId"
        exit 0
    } else {
        # Model mismatch - block execution
        $message = @"
╔════════════════════════════════════════════════════════════════════════════╗
║                        MODEL RECOMMENDATION MISMATCH                        ║
╠════════════════════════════════════════════════════════════════════════════╣
║                                                                             ║
║  Task: $taskId                                                              
║  Task File: $taskFile                                                       
║                                                                             ║
║  Current Model:      $currentModel                                         
║  Recommended Model:  $recommendedModel                                     
║                                                                             ║
║  This task requires a different model to ensure optimal token usage        ║
║  and budget control.                                                        ║
║                                                                             ║
║  ACTION REQUIRED:                                                           ║
║  Please switch to the recommended model before executing this task.        ║
║                                                                             ║
║  How to change model in Kiro:                                              ║
║  1. Use the command palette (Ctrl+Shift+P)                                 ║
║  2. Search for "model" or use /model command                               ║
║  3. Select the recommended model: $recommendedModel                        
║                                                                             ║
╚════════════════════════════════════════════════════════════════════════════╝
"@
        
        Write-Error $message
        exit 2
    }
    
} catch {
    Write-Error "Error checking model recommendation: $_"
    Write-Error $_.ScriptStackTrace
    exit 1
}

# Add Model Recommendations to Task Files
# This script helps add recommendedModel field to existing task files

param(
    [string]$TaskFile,
    [string]$TaskId,
    [string]$RecommendedModel,
    [switch]$DryRun,
    [switch]$Help
)

if ($Help) {
    Write-Host @"
Add Model Recommendations to Task Files
========================================

Usage:
  .\add-model-recommendations.ps1 -TaskFile phase8-tasks.json -TaskId P8-T004 -RecommendedModel "claude-sonnet-4.5"
  .\add-model-recommendations.ps1 -TaskFile phase8-tasks.json -RecommendedModel "claude-opus-4.0" (add to all tasks)
  .\add-model-recommendations.ps1 -DryRun (shows what would be changed)

Parameters:
  -TaskFile          : Path to task JSON file (relative to tasks/ directory)
  -TaskId            : Specific task ID to update (optional, if omitted updates all tasks in file)
  -RecommendedModel  : Model name to recommend (e.g., "claude-opus-4.0", "claude-sonnet-4.5")
  -DryRun            : Preview changes without modifying files
  -Help              : Show this help message

Examples of model recommendations based on task complexity:
  - claude-haiku       : Simple tasks (formatting, simple fixes, documentation)
  - claude-sonnet-4.5  : Moderate tasks (feature implementation, refactoring)
  - claude-opus-4.0    : Complex tasks (architecture design, complex algorithms)
"@
    exit 0
}

$tasksDir = Join-Path $PSScriptRoot "..\tasks"

if (-not $TaskFile) {
    Write-Host "Available task files:"
    Get-ChildItem -Path $tasksDir -Filter "*.json" | ForEach-Object {
        Write-Host "  - $($_.Name)"
    }
    Write-Host "`nUsage: .\add-model-recommendations.ps1 -TaskFile <file> -RecommendedModel <model>"
    exit 0
}

$taskFilePath = Join-Path $tasksDir $TaskFile

if (-not (Test-Path $taskFilePath)) {
    Write-Error "Task file not found: $taskFilePath"
    exit 1
}

try {
    # Read the task file
    $taskContent = Get-Content -Path $taskFilePath -Raw | ConvertFrom-Json
    $modified = $false
    
    Write-Host "Processing: $TaskFile"
    Write-Host "Recommended Model: $RecommendedModel"
    Write-Host ""
    
    # Determine which tasks to update
    $tasksToUpdate = @()
    
    if ($taskContent.tasks -is [Array]) {
        $tasksToUpdate = $taskContent.tasks
    } elseif ($taskContent.tasks.PSObject.Properties.Name -contains 'pending') {
        $tasksToUpdate = $taskContent.tasks.pending
    }
    
    foreach ($task in $tasksToUpdate) {
        # Skip if TaskId specified and doesn't match
        if ($TaskId -and $task.id -ne $TaskId) {
            continue
        }
        
        # Check if recommendedModel already exists
        $existingModel = $task.PSObject.Properties.Name -contains 'recommendedModel' ? $task.recommendedModel : $null
        
        if ($existingModel) {
            Write-Host "  Task $($task.id): Already has recommended model: $existingModel"
            
            if ($RecommendedModel -and $existingModel -ne $RecommendedModel) {
                if ($DryRun) {
                    Write-Host "    [DRY RUN] Would update: $existingModel -> $RecommendedModel"
                } else {
                    $task.recommendedModel = $RecommendedModel
                    Write-Host "    Updated: $existingModel -> $RecommendedModel" -ForegroundColor Yellow
                    $modified = $true
                }
            }
        } else {
            if ($DryRun) {
                Write-Host "  Task $($task.id): [DRY RUN] Would add recommendedModel: $RecommendedModel"
            } else {
                # Add the recommendedModel field
                $task | Add-Member -MemberType NoteProperty -Name 'recommendedModel' -Value $RecommendedModel -Force
                Write-Host "  Task $($task.id): Added recommendedModel: $RecommendedModel" -ForegroundColor Green
                $modified = $true
            }
        }
        
        # If specific TaskId was requested, stop after finding it
        if ($TaskId -and $task.id -eq $TaskId) {
            break
        }
    }
    
    if ($modified -and -not $DryRun) {
        # Save the updated task file with proper formatting
        $jsonOutput = $taskContent | ConvertTo-Json -Depth 100
        Set-Content -Path $taskFilePath -Value $jsonOutput -Encoding UTF8
        Write-Host "`n✓ Task file updated successfully: $taskFilePath" -ForegroundColor Green
    } elseif ($DryRun) {
        Write-Host "`n[DRY RUN] No changes made. Remove -DryRun to apply changes." -ForegroundColor Cyan
    } else {
        Write-Host "`nNo changes made." -ForegroundColor Yellow
    }
    
} catch {
    Write-Error "Error processing task file: $_"
    Write-Error $_.ScriptStackTrace
    exit 1
}

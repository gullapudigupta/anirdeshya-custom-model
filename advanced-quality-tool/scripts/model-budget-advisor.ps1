# Model Budget Advisor
# This script provides model usage recommendations based on the user's prompt
# Usage: Called by UserPromptSubmit hook with session context via stdin

param(
    [switch]$Help
)

if ($Help) {
    Write-Host @"
Model Budget Advisor
====================
This script analyzes user prompts and provides model recommendations
to optimize token usage and budget.

Exit codes:
  - Exit 0: Advice provided (if applicable)
  - Exit 1: Error occurred
"@
    exit 0
}

# Define model cost tiers (relative cost)
$modelCostTier = @{
    'claude-opus' = 'HIGH'
    'claude-sonnet' = 'MEDIUM'
    'claude-haiku' = 'LOW'
    'gpt-4' = 'HIGH'
    'gpt-3.5' = 'LOW'
}

# Define task keywords that might benefit from expensive models
$complexTaskKeywords = @(
    'architecture',
    'design',
    'refactor',
    'complex',
    'algorithm',
    'optimize',
    'review',
    'analyze'
)

# Define simple task keywords that can use cheaper models
$simpleTaskKeywords = @(
    'fix typo',
    'update comment',
    'format',
    'rename',
    'add log',
    'simple change',
    'quick fix',
    'small update'
)

function Get-ModelCostTier {
    param([string]$ModelName)
    
    $normalized = $ModelName.ToLower()
    
    foreach ($key in $modelCostTier.Keys) {
        if ($normalized -like "*$key*") {
            return $modelCostTier[$key]
        }
    }
    
    return 'UNKNOWN'
}

function Test-PromptComplexity {
    param([string]$Prompt)
    
    $prompt = $Prompt.ToLower()
    
    # Check for complex task indicators
    $complexScore = 0
    foreach ($keyword in $complexTaskKeywords) {
        if ($prompt -like "*$keyword*") {
            $complexScore++
        }
    }
    
    # Check for simple task indicators
    $simpleScore = 0
    foreach ($keyword in $simpleTaskKeywords) {
        if ($prompt -like "*$keyword*") {
            $simpleScore++
        }
    }
    
    # Determine complexity
    if ($simpleScore -gt 0 -and $complexScore -eq 0) {
        return 'SIMPLE'
    } elseif ($complexScore -gt 2) {
        return 'COMPLEX'
    } else {
        return 'MODERATE'
    }
}

try {
    # Read JSON context from stdin
    $stdinContent = @()
    while ($null -ne ($line = Read-Host)) {
        $stdinContent += $line
    }
    
    if ($stdinContent.Count -eq 0) {
        exit 0
    }
    
    $context = $stdinContent -join "`n" | ConvertFrom-Json
    
    $currentModel = $context.model
    $userPrompt = $context.userPrompt
    
    if ([string]::IsNullOrWhiteSpace($userPrompt)) {
        exit 0
    }
    
    $costTier = Get-ModelCostTier -ModelName $currentModel
    $promptComplexity = Test-PromptComplexity -Prompt $userPrompt
    
    # Provide advice if there's a mismatch
    $shouldAdvise = $false
    $advice = ""
    
    if ($costTier -eq 'HIGH' -and $promptComplexity -eq 'SIMPLE') {
        $shouldAdvise = $true
        $advice = @"

💡 BUDGET TIP: You're using a high-cost model ($currentModel) for what appears 
   to be a simple task. Consider switching to a more cost-effective model like
   claude-sonnet or claude-haiku to save on token usage.
   
   Your task: "$($userPrompt.Substring(0, [Math]::Min(60, $userPrompt.Length)))..."

"@
    } elseif ($costTier -eq 'LOW' -and $promptComplexity -eq 'COMPLEX') {
        $shouldAdvise = $true
        $advice = @"

⚠️  COMPLEXITY WARNING: You're using a lower-tier model ($currentModel) for what 
   appears to be a complex task. For better results, consider using a more 
   capable model like claude-opus or claude-sonnet-4.

   Your task: "$($userPrompt.Substring(0, [Math]::Min(60, $userPrompt.Length)))..."

"@
    }
    
    if ($shouldAdvise) {
        Write-Host $advice
    }
    
    exit 0
    
} catch {
    # Fail silently - don't block user
    exit 0
}

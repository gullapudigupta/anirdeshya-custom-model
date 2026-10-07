param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$TaskId,

    [ValidateRange(1, 3)]
    [int]$Choice = 1,

    [string]$Model,

    [string]$ModelMapPath = (Join-Path $PSScriptRoot 'copilot-model-map.json'),

    [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
$tasksRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $tasksRoot
$taskIndex = @{}

foreach ($file in (Get-ChildItem -Path $tasksRoot -Recurse -Filter '*.json' -File |
    Where-Object {
        $_.FullName -notlike "$PSScriptRoot\*" -and
        $_.FullName -notlike "$tasksRoot\.agents\*"
    })) {
    try {
        $data = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    }
    catch {
        throw "Could not parse task JSON '$($file.FullName)': $($_.Exception.Message)"
    }

    foreach ($candidate in @($data.tasks)) {
        if ($null -ne $candidate.id) {
            if ($taskIndex.ContainsKey([string]$candidate.id)) {
                throw "Task ID '$($candidate.id)' occurs more than once; refusing ambiguous task lookup."
            }
            $taskIndex[[string]$candidate.id] = [ordered]@{
                task = $candidate
                file = $file.FullName
            }
        }
    }
}

if (-not $taskIndex.ContainsKey($TaskId)) {
    throw "Task '$TaskId' was not found under '$tasksRoot'."
}
$foundTask = $taskIndex[$TaskId].task
$foundFile = $taskIndex[$TaskId].file

$recommendations = @($foundTask.recommendedModel)
if ($recommendations.Count -lt $Choice) {
    throw "Task '$TaskId' has only $($recommendations.Count) recommended model(s); cannot select choice $Choice."
}
if ($foundTask.status -eq 'COMPLETED' -or $foundTask.status -eq 'CANCELLED') {
    throw "Task '$TaskId' is $($foundTask.status); refusing to launch it."
}

$unfinishedDependencies = @()
foreach ($dependencyId in @($foundTask.dependencies)) {
    if (-not $taskIndex.ContainsKey([string]$dependencyId)) {
        throw "Task '$TaskId' depends on unknown task '$dependencyId'; refusing to launch."
    }
    $dependency = $taskIndex[[string]$dependencyId].task
    if ($dependency.status -ne 'COMPLETED') {
        $unfinishedDependencies += "$dependencyId ($($dependency.status))"
    }
}
if ($unfinishedDependencies.Count -gt 0) {
    throw "Task '$TaskId' has unfinished dependencies: $($unfinishedDependencies -join ', '). Complete them before starting this task."
}

$recommendedId = [string]$recommendations[$Choice - 1]
if ([string]::IsNullOrWhiteSpace($recommendedId)) {
    throw "Task '$TaskId' has an empty model recommendation at choice $Choice."
}

$selectedModel = $Model
if ([string]::IsNullOrWhiteSpace($selectedModel)) {
    $selectedModel = $recommendedId
    if (Test-Path -LiteralPath $ModelMapPath) {
        try {
            $modelMap = Get-Content -LiteralPath $ModelMapPath -Raw | ConvertFrom-Json
        }
        catch {
            throw "Could not parse model mapping '$ModelMapPath': $($_.Exception.Message)"
        }
        $mapped = $null
        foreach ($property in $modelMap.models.PSObject.Properties) {
            if ($property.Name -eq $recommendedId) {
                $mapped = $property
                break
            }
        }
        if ($null -ne $mapped -and -not [string]::IsNullOrWhiteSpace([string]$mapped.Value)) {
            $selectedModel = [string]$mapped.Value
        }
    }
}

$repoPrefix = $repoRoot.TrimEnd('\') + '\'
$relativeTaskFile = $foundFile.Substring($repoPrefix.Length).Replace('\', '/')
$deliverables = @($foundTask.deliverables | ForEach-Object { "- $_" }) -join "`n"
$dependencies = @($foundTask.dependencies | ForEach-Object { "- $_" })
if ($dependencies.Count -eq 0) {
    $dependencies = @('- None listed')
}
$prompt = @"
Execute task $($foundTask.id): $($foundTask.name)

Task record: $relativeTaskFile
Priority: $($foundTask.priority)
Estimated hours: $($foundTask.estimatedHours)
Recommended model choice: $Choice ($recommendedId)
Selected Copilot CLI model: $selectedModel

Dependencies:
$($dependencies -join "`n")

Deliverables:
$deliverables

Inspect the relevant repository context, implement only this task, and run appropriate validation. Do not mark the task JSON completed yourself. At the end, report changed files, validation, confidence from 0 to 1, and concise execution notes so the user can record the result with:
node agent_tasks_new/tools/cli.js complete $($foundTask.id) --model $selectedModel --confidence <0..1> --notes "<notes>" --artifacts <comma-separated paths>
"@

$plan = [ordered]@{
    taskId = $TaskId
    status = $foundTask.status
    taskFile = $relativeTaskFile
    recommendedModel = $recommendedId
    selectedCopilotCliModel = $selectedModel
    choice = $Choice
    modelMappingFile = $ModelMapPath
    prompt = $prompt
}

if ($PlanOnly) {
    $plan | ConvertTo-Json -Depth 5
    return
}

$copilot = Get-Command 'copilot' -ErrorAction SilentlyContinue
if ($null -eq $copilot) {
    throw "Copilot CLI ('copilot') is not on PATH. Install/sign in to Copilot CLI, then retry."
}

Write-Host "Task: $($foundTask.id) - $($foundTask.name)"
Write-Host "Recommendation: $recommendedId (choice $Choice)"
Write-Host "Starting Copilot CLI with model: $selectedModel"
Write-Host "If the CLI says this model is unavailable, add a mapping in '$ModelMapPath' or use -Model <available-cli-model>."
Push-Location $repoRoot
try {
    & $copilot.Source --model $selectedModel --interactive $prompt
    if ($LASTEXITCODE -ne 0) {
        throw "Copilot CLI exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

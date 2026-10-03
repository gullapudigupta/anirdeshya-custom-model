<#
.SYNOPSIS
    Build and run the Roslyn symbol extractor, then optionally commit or upload the output.

.PARAMETER SolutionPath
    Path to the .sln file. Defaults to the solution one level above this script's folder.

.PARAMETER OutDir
    Directory for symbols.json output. Defaults to ai_tools_setup\symbols.

.PARAMETER Format
    Output format: 'json' (default) or 'ctags'.

.PARAMETER Commit
    If set, git add/commit/push the output file.

.PARAMETER UploadUrl
    If provided, POST the output file to this URL.
#>
param(
    [string]$SolutionPath = '',
    [string]$OutDir       = '',
    [ValidateSet('json','ctags')]
    [string]$Format       = 'json',
    [switch]$Commit,
    [string]$UploadUrl    = ''
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Resolve defaults
if (-not $SolutionPath) {
    $SolutionPath = Join-Path $scriptRoot '..\Energy_ReconversionSystem.sln'
}
if (-not $OutDir) {
    $OutDir = Join-Path $scriptRoot 'symbols'
}

$SolutionPath = (Resolve-Path $SolutionPath -ErrorAction Stop).Path
$projPath     = Join-Path $scriptRoot 'RoslynSymbolExtractor\RoslynSymbolExtractor.csproj'

# Build the extractor
Write-Host "Building RoslynSymbolExtractor..." -ForegroundColor Cyan
if (Get-Command msbuild -ErrorAction SilentlyContinue) {
    msbuild $projPath /p:Configuration=Release /nologo /verbosity:minimal
} else {
    Write-Host "msbuild not found, trying dotnet build..." -ForegroundColor Yellow
    dotnet build $projPath -c Release --nologo
}

# Ensure output directory exists
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

# Resolve exe path
$exe = Join-Path $scriptRoot 'RoslynSymbolExtractor\bin\Release\net48\RoslynSymbolExtractor.exe'
if (-not (Test-Path $exe)) {
    # Also check without the net48 subfolder (older build output)
    $exeAlt = Join-Path $scriptRoot 'RoslynSymbolExtractor\bin\Release\RoslynSymbolExtractor.exe'
    if (Test-Path $exeAlt) { $exe = $exeAlt }
    else { Write-Error "Extractor binary not found. Build may have failed."; exit 1 }
}

# Determine output file name
$outFileName = if ($Format -eq 'ctags') { 'symbols.tags' } else { 'symbols.json' }
$outFile     = Join-Path $OutDir $outFileName

Write-Host "Running extractor..." -ForegroundColor Cyan
Write-Host "  Solution : $SolutionPath"
Write-Host "  Output   : $outFile"
Write-Host "  Format   : $Format"

& $exe $SolutionPath $outFile "--$Format"

if (-not (Test-Path $outFile)) {
    Write-Error "Output file was not created: $outFile"
    exit 1
}

$sizekb = [Math]::Round((Get-Item $outFile).Length / 1KB, 1)
Write-Host "Done. Output: $outFile ($sizekb KB)" -ForegroundColor Green

# Optional: git commit
if ($Commit) {
    Push-Location $scriptRoot
    git add $outFile
    $commitMsg = "chore: update $outFileName"
    $result = git commit -m $commitMsg 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Host "Nothing to commit or commit failed: $result" -ForegroundColor Yellow }
    else { git push }
    Pop-Location
}

# Optional: HTTP upload
if ($UploadUrl) {
    Write-Host "Uploading to $UploadUrl ..." -ForegroundColor Cyan
    try {
        Invoke-RestMethod -Uri $UploadUrl -Method Post -InFile $outFile -ContentType 'application/json'
        Write-Host "Upload successful." -ForegroundColor Green
    } catch {
        Write-Host "Upload failed: $_" -ForegroundColor Red
    }
}

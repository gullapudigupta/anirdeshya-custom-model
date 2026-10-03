<#
.SYNOPSIS
    Entry-point: runs master setup then starts the Node.js sidecar API.

.NOTES
    Run as Administrator for full tool installation.
#>

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  AI Tools Setup + Sidecar API  --  Energy Reconversion     ' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host 'WARNING: Not running as Administrator.' -ForegroundColor Yellow
    Write-Host 'Tool installations may fail. Restart PowerShell as Admin if needed.' -ForegroundColor Yellow
    Write-Host ''
}

# --- Step 1: Master setup ---------------------------------------------------
Write-Host 'Step 1 of 2: Running master setup (tools + packages)...' -ForegroundColor Cyan
$setupScript = Join-Path $scriptDir '00_MASTER_SETUP.ps1'
if (Test-Path $setupScript) {
    & $setupScript -SkipScheduledTask
    Write-Host 'Master setup finished.' -ForegroundColor Green
} else {
    Write-Host "ERROR: 00_MASTER_SETUP.ps1 not found at $setupScript" -ForegroundColor Red
    exit 1
}

Write-Host ''

# --- Step 2: Start sidecar API ----------------------------------------------
Write-Host 'Step 2 of 2: Starting sidecar API (Node.js)...' -ForegroundColor Cyan

$apiDir = Join-Path $scriptDir 'sidecar-api'
if (-not (Test-Path $apiDir)) {
    Write-Host "ERROR: sidecar-api directory not found at $apiDir" -ForegroundColor Red
    exit 1
}

# Install npm packages if node_modules is missing
$nodeModules = Join-Path $apiDir 'node_modules'
if (-not (Test-Path $nodeModules)) {
    Write-Host 'Running npm install in sidecar-api...' -ForegroundColor Yellow
    Push-Location $apiDir
    npm install
    Pop-Location
}

Write-Host ''
Write-Host 'API will start on http://localhost:3001' -ForegroundColor Cyan
Write-Host 'Press Ctrl+C to stop.' -ForegroundColor Yellow
Write-Host ''

Push-Location $apiDir
node src/index.js
Pop-Location

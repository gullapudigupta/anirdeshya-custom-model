<#
.SYNOPSIS
    Start the Node.js sidecar API server.

.DESCRIPTION
    Navigates to sidecar-api/, optionally runs npm install, then starts
    the Express server via 'node src/index.js'.

.PARAMETER SkipNpmInstall
    Skip the npm install check (useful when node_modules is already present).

.PARAMETER Env
    Optional path to a .env file to load before starting (default: sidecar-api/.env).

.NOTES
    The API runs on the port defined in sidecar-api/.env (default 3001).
    Endpoints: GET /health  /search  /symbols  /snippet  /ast-node
               POST /compose-context  /refresh
#>
param(
    [switch]$SkipNpmInstall,
    [string]$Env = ''
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiDir    = Join-Path $scriptDir 'sidecar-api'

if (-not (Test-Path $apiDir)) {
    Write-Error "sidecar-api directory not found: $apiDir"
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "node.exe not found. Install Node.js >= 16 (choco install nodejs -y)."
    exit 1
}

# npm install if needed
if (-not $SkipNpmInstall) {
    $nodeModules = Join-Path $apiDir 'node_modules'
    if (-not (Test-Path $nodeModules)) {
        Write-Host "node_modules missing - running npm install..." -ForegroundColor Yellow
        Push-Location $apiDir
        npm install
        Pop-Location
    }
}

# Copy .env if caller specified one
if ($Env -and (Test-Path $Env)) {
    Copy-Item -Path $Env -Destination (Join-Path $apiDir '.env') -Force
    Write-Host "Loaded env from: $Env" -ForegroundColor Cyan
}

Write-Host ''
Write-Host 'Starting sidecar API...' -ForegroundColor Cyan
Write-Host "  Directory : $apiDir" -ForegroundColor Cyan
Write-Host '  URL       : http://localhost:3001' -ForegroundColor Cyan
Write-Host '  Endpoints : /health  /search  /symbols  /snippet  /ast-node  /compose-context  /refresh' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Press Ctrl+C to stop.' -ForegroundColor Yellow
Write-Host ''

Push-Location $apiDir
node src/index.js
Pop-Location

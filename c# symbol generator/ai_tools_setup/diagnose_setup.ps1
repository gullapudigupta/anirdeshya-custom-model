<#
.SYNOPSIS
    Verify AI tools setup and report any missing or misconfigured components.

.PARAMETER Verbose
    Show detailed version output for each tool.

.PARAMETER RunTests
    Execute a quick functional smoke-test against each tool.
#>
param(
    [switch]$Verbose,
    [switch]$RunTests
)

$ErrorActionPreference = 'Continue'
$scriptDir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir        = 'C:\sarah laptop\erv-heart\MyFirstProject-v2\src'
$diagnosticsLog = Join-Path $scriptDir 'diagnostics.log'

if (Test-Path $diagnosticsLog) { Remove-Item $diagnosticsLog -Force }

function WLog {
    param([string]$Level, [string]$Msg)
    $line = "[$(Get-Date -Format 'HH:mm:ss')] [$Level] $Msg"
    Add-Content -Path $diagnosticsLog -Value $line -Encoding utf8
    $color = switch ($Level) {
        'OK'    { 'Green' }
        'WARN'  { 'Yellow' }
        'ERROR' { 'Red' }
        'INFO'  { 'Cyan' }
        default { 'Gray' }
    }
    Write-Host $line -ForegroundColor $color
}

function Test-Tool {
    param([string]$Name, [string]$Exe)
    $cmd = Get-Command $Exe -ErrorAction SilentlyContinue
    if ($cmd) {
        WLog 'OK' "$Name -> $($cmd.Source)"
        if ($Verbose) {
            try {
                $ver = & $Exe --version 2>&1 | Select-Object -First 1
                WLog 'INFO' "  version: $ver"
            } catch {}
        }
        return $true
    }
    WLog 'WARN' "$Name ($Exe) NOT FOUND"
    return $false
}

Write-Host ''
Write-Host '===========================================================' -ForegroundColor Cyan
Write-Host "  AI Tools Diagnostic   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host '===========================================================' -ForegroundColor Cyan
Write-Host ''

# --- Section 1: System -------------------------------------------------------
WLog 'INFO' '--- System ---'
$os = (Get-CimInstance Win32_OperatingSystem).Caption
WLog 'INFO' "OS: $os"
WLog 'INFO' "PS: $($PSVersionTable.PSVersion)"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { WLog 'OK' 'Running as Administrator' } else { WLog 'WARN' 'Not Administrator' }

# --- Section 2: Required tools -----------------------------------------------
WLog 'INFO' '--- Required Tools ---'
$found = @{}
$found['git']   = Test-Tool 'Git'            'git'
$found['ctags'] = Test-Tool 'Universal Ctags' 'ctags'
$found['rg']    = Test-Tool 'ripgrep'         'rg'
$found['node']  = Test-Tool 'Node.js'         'node'
$found['npm']   = Test-Tool 'npm'             'npm'
$found['go']    = Test-Tool 'Go'              'go'

# --- Section 3: Optional tools -----------------------------------------------
WLog 'INFO' '--- Optional Tools ---'
Test-Tool 'tree-sitter' 'tree-sitter' | Out-Null
Test-Tool 'zoekt'       'zoekt'       | Out-Null
Test-Tool 'codeql'      'codeql'      | Out-Null
Test-Tool 'docker'      'docker'      | Out-Null
Test-Tool 'dotnet'      'dotnet'      | Out-Null

# --- Section 4: Repo structure -----------------------------------------------
WLog 'INFO' '--- Repository Structure ---'
if (Test-Path $repoDir) {
    WLog 'OK' "Repo found: $repoDir"
    $slns = Get-ChildItem -Path $repoDir -Filter '*.sln' -Recurse -ErrorAction SilentlyContinue
    WLog 'INFO' "Solution files: $($slns.Count)"
    $projs = Get-ChildItem -Path $repoDir -Filter '*.csproj' -Recurse -ErrorAction SilentlyContinue
    WLog 'INFO' "C# projects   : $($projs.Count)"
} else {
    WLog 'ERROR' "Repo not found: $repoDir"
}

$symbolsFile = Join-Path $scriptDir 'symbols\symbols.json'
if (Test-Path $symbolsFile) {
    $sz = [Math]::Round((Get-Item $symbolsFile).Length / 1KB, 1)
    WLog 'OK' "symbols.json  : present ($sz KB)"
} else {
    WLog 'WARN' 'symbols.json  : MISSING - run run_symbol_extractor.ps1'
}

$tagsFile = Join-Path $scriptDir 'artifacts\tags'
if (Test-Path $tagsFile) {
    $sz = [Math]::Round((Get-Item $tagsFile).Length / 1KB, 1)
    WLog 'OK' "tags file     : present ($sz KB)"
} else {
    WLog 'WARN' 'tags file     : MISSING - run ctags manually'
}

$nodeModules = Join-Path $scriptDir 'sidecar-api\node_modules'
if (Test-Path $nodeModules) {
    WLog 'OK' 'sidecar-api node_modules: present'
} else {
    WLog 'WARN' 'sidecar-api node_modules: MISSING - run: cd sidecar-api && npm install'
}

# --- Section 5: .NET Framework -----------------------------------------------
WLog 'INFO' '--- .NET Framework ---'
try {
    $reg = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
    if ($reg -and $reg.Release -ge 528040) {
        WLog 'OK' ".NET Framework 4.8+ detected (release=$($reg.Release))"
    } elseif ($reg) {
        WLog 'WARN' ".NET Framework pre-4.8 (release=$($reg.Release))"
    } else {
        WLog 'WARN' '.NET Framework 4.x registry key not found'
    }
} catch { WLog 'WARN' "Could not read .NET registry: $_" }

# --- Section 6: Port availability --------------------------------------------
WLog 'INFO' '--- Port Availability ---'
foreach ($port in @(3001, 3002, 8080)) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        WLog 'WARN' "Port $port in use (PID $($conn.OwningProcess))"
    } else {
        WLog 'OK' "Port $port available"
    }
}

# --- Section 7: Functional tests ---------------------------------------------
if ($RunTests) {
    WLog 'INFO' '--- Functional Tests ---'

    if ($found['git']) {
        try {
            $out = & git -C $repoDir status --short 2>&1
            WLog 'OK' "git status OK ($($out.Count) changed files)"
        } catch { WLog 'ERROR' "git test failed: $_" }
    }

    if ($found['ctags']) {
        $cs = Get-ChildItem -Path $repoDir -Filter '*.cs' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cs) {
            try {
                $out = & ctags -f - $cs.FullName 2>&1
                WLog 'OK' "ctags parsed $($cs.Name) -> $($out.Count) tags"
            } catch { WLog 'ERROR' "ctags test failed: $_" }
        }
    }

    if ($found['rg']) {
        try {
            $out = & rg 'class' $repoDir --max-count 1 2>&1
            if ($out) { WLog 'OK' 'ripgrep working' } else { WLog 'WARN' 'ripgrep returned no output' }
        } catch { WLog 'ERROR' "rg test failed: $_" }
    }

    if ($found['node']) {
        try {
            $ver = & node --version 2>&1
            WLog 'OK' "node version: $ver"
        } catch { WLog 'ERROR' "node test failed: $_" }
    }
}

# --- Summary -----------------------------------------------------------------
WLog 'INFO' '--- Summary ---'
$ok      = ($found.Values | Where-Object { $_ }).Count
$total   = $found.Count
WLog 'INFO' "Required tools ready: $ok / $total"

Write-Host ''
Write-Host '===========================================================' -ForegroundColor Cyan
Write-Host "  Report saved to: $diagnosticsLog" -ForegroundColor Cyan
Write-Host '===========================================================' -ForegroundColor Cyan
Write-Host ''

if ($found['git'] -and $found['ctags'] -and $found['rg'] -and $found['node']) {
    Write-Host 'Setup looks good. Next: run_symbol_extractor.ps1 then run_sidecar_api.ps1' -ForegroundColor Green
} else {
    Write-Host 'Some tools are missing. Run 00_MASTER_SETUP.ps1 to install.' -ForegroundColor Yellow
}
Write-Host ''

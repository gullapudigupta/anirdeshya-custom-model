<#
.SYNOPSIS
    Master setup script for AI Tools and Sidecar API.

.DESCRIPTION
    1. Installs required tools via Chocolatey / npm / Go
    2. Verifies installations and creates wrapper scripts in .\tools\
    3. Restores NuGet packages
    4. Optionally registers a Windows scheduled task for auto-updates

.PARAMETER SkipInstall
    Skip tool installation; only verify and link what is already present.

.PARAMETER SkipScheduledTask
    Do not register the Windows scheduled update task.

.NOTES
    Requires Administrator privileges for full functionality.
#>
param(
    [switch]$SkipInstall,
    [switch]$SkipScheduledTask
)

$ErrorActionPreference = 'Continue'
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir    = 'C:\sarah laptop\erv-heart\MyFirstProject-v2\src'
$logFile    = Join-Path $scriptDir 'master_setup.log'

if (Test-Path $logFile) { Remove-Item $logFile -Force }

function Log        { param($m); $l = "[INFO]    $m"; $l | Out-File $logFile -Append -Encoding utf8; Write-Host $l -ForegroundColor Cyan }
function LogSuccess { param($m); $l = "[SUCCESS] $m"; $l | Out-File $logFile -Append -Encoding utf8; Write-Host $l -ForegroundColor Green }
function LogWarn    { param($m); $l = "[WARN]    $m"; $l | Out-File $logFile -Append -Encoding utf8; Write-Host $l -ForegroundColor Yellow }
function LogError   { param($m); $l = "[ERROR]   $m"; $l | Out-File $logFile -Append -Encoding utf8; Write-Host $l -ForegroundColor Red }

Log "Master Setup Started  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Log "Repo : $repoDir"
Log "Log  : $logFile"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { LogWarn "Not running as Administrator - some installs may fail." }

# ---------------------------------------------------------------------------
# SECTION 1: Install tools
# ---------------------------------------------------------------------------
if (-not $SkipInstall) {
    Log "--- SECTION 1: Installing tools ---"

    if (Get-Command choco -ErrorAction SilentlyContinue) {
        LogSuccess "Chocolatey found."
        foreach ($pkg in @('git','universal-ctags','ripgrep','nodejs','golang')) {
            Log "choco install $pkg ..."
            try   { choco install $pkg -y --force 2>&1 | Out-Null; LogSuccess "$pkg installed." }
            catch { LogError "choco install $pkg failed: $_" }
        }
    } else {
        LogError "Chocolatey not found. Install it first from https://chocolatey.org/install"
    }

    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Log "npm install -g tree-sitter-cli ..."
        try   { npm install -g tree-sitter-cli 2>&1 | Out-Null; LogSuccess "tree-sitter-cli installed." }
        catch { LogError "npm install tree-sitter-cli failed: $_" }
    } else {
        LogWarn "npm not found - tree-sitter-cli skipped (install Node.js first)."
    }

    if (Get-Command go -ErrorAction SilentlyContinue) {
        Log "go install zoekt ..."
        try {
            go install github.com/sourcegraph/zoekt/cmd/zoekt@latest 2>&1 | Out-Null
            go install github.com/sourcegraph/zoekt/cmd/zoekt-git-index@latest 2>&1 | Out-Null
            LogSuccess "zoekt installed."
        } catch { LogError "go install zoekt failed: $_" }
    } else {
        LogWarn "go not found - zoekt skipped (install Go first)."
    }

    LogWarn "CodeQL and OmniSharp require manual download:"
    LogWarn "  CodeQL    : https://github.com/github/codeql-cli-binaries/releases"
    LogWarn "  OmniSharp : https://github.com/OmniSharp/omnisharp-roslyn/releases"
}

# ---------------------------------------------------------------------------
# SECTION 2: Verify installed tools
# ---------------------------------------------------------------------------
Log "--- SECTION 2: Verifying tools ---"

$toolDefs = @(
    [pscustomobject]@{ Key='git';   Exes=@('git') },
    [pscustomobject]@{ Key='ctags'; Exes=@('ctags','universal-ctags') },
    [pscustomobject]@{ Key='rg';    Exes=@('rg','ripgrep') },
    [pscustomobject]@{ Key='node';  Exes=@('node') },
    [pscustomobject]@{ Key='go';    Exes=@('go') },
    [pscustomobject]@{ Key='npm';   Exes=@('npm') }
)

$toolsFound = @{}
foreach ($def in $toolDefs) {
    $found = $false
    foreach ($exe in $def.Exes) {
        $cmd = Get-Command $exe -ErrorAction SilentlyContinue
        if ($cmd) {
            $p = if ($cmd.Path) { $cmd.Path } else { $cmd.Source }
            if ($p) {
                LogSuccess "Found $($def.Key) -> $p"
                $toolsFound[$def.Key] = $p
                $found = $true
                break
            }
        }
    }
    if (-not $found) { LogWarn "Not found: $($def.Key) (checked: $($def.Exes -join ', '))" }
}

# ---------------------------------------------------------------------------
# SECTION 3: Create wrapper scripts
# ---------------------------------------------------------------------------
Log "--- SECTION 3: Creating wrappers ---"

$toolsDir = Join-Path $repoDir 'tools'
if (-not (Test-Path $toolsDir)) {
    New-Item -ItemType Directory -Path $toolsDir | Out-Null
    LogSuccess "Created: $toolsDir"
}

foreach ($kv in $toolsFound.GetEnumerator()) {
    $wrapperPath = Join-Path $toolsDir ($kv.Key + '.ps1')
    $content = 'param([Parameter(ValueFromRemainingArguments=$true)][string[]]$PassArgs)' + "`n"
    $content += '& "' + $kv.Value + '" @PassArgs'
    Set-Content -Path $wrapperPath -Value $content -Encoding UTF8
    LogSuccess "Wrapper: $($kv.Key) -> $($kv.Value)"
}

Set-Content -Path (Join-Path $toolsDir 'README.md') -Encoding UTF8 -Value @'
# tools/
PowerShell wrapper scripts that forward arguments to installed tool binaries.
Re-run 00_MASTER_SETUP.ps1 to refresh after moving or reinstalling tools.
'@
LogSuccess "tools/README.md written."

# ---------------------------------------------------------------------------
# SECTION 4: Register scheduled update task
# ---------------------------------------------------------------------------
if (-not $SkipScheduledTask) {
    Log "--- SECTION 4: Scheduled task ---"
    $taskName    = 'AI_Tools_Update'
    $updateScript = Join-Path $scriptDir 'update_tools.ps1'
    $existing    = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Log "Task '$taskName' already registered."
    } elseif ($isAdmin) {
        try {
            $action   = New-ScheduledTaskAction -Execute 'powershell.exe' `
                            -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $updateScript + '"')
            $trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date) `
                            -RepetitionInterval (New-TimeSpan -Minutes 10)
            $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
            Register-ScheduledTask -TaskName $taskName -Action $action `
                -Trigger $trigger -Settings $settings -Force | Out-Null
            LogSuccess "Task '$taskName' registered (every 10 min)."
        } catch { LogError "Failed to register task: $_" }
    } else {
        LogWarn "Cannot register task without admin. Run manually:"
        LogWarn "  schtasks /Create /SC MINUTE /MO 10 /TN AI_Tools_Update /TR `"powershell -File $updateScript`" /F"
    }
}

# ---------------------------------------------------------------------------
# SECTION 5: Restore NuGet packages
# ---------------------------------------------------------------------------
Log "--- SECTION 5: NuGet restore ---"

$sln = Get-ChildItem -Path $repoDir -Filter '*.sln' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($sln) {
    Log "Solution: $($sln.FullName)"
    try {
        Push-Location $repoDir
        if (Get-Command dotnet -ErrorAction SilentlyContinue) {
            dotnet restore 2>&1 | Out-File (Join-Path $scriptDir 'restore.log') -Encoding utf8
            LogSuccess "NuGet restore complete."
        } elseif (Get-Command nuget -ErrorAction SilentlyContinue) {
            nuget restore $sln.FullName 2>&1 | Out-File (Join-Path $scriptDir 'restore.log') -Encoding utf8
            LogSuccess "NuGet restore complete (nuget.exe)."
        } else {
            LogWarn "Neither dotnet nor nuget found - restore skipped."
        }
    } catch { LogError "Restore failed: $_" }
    finally  { Pop-Location }
} else {
    LogWarn "No .sln found in $repoDir"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Log "--- Summary ---"
foreach ($k in @('git','ctags','rg','node','go','npm')) {
    $status = if ($toolsFound[$k]) { 'OK' } else { 'MISSING' }
    Log "  $k : $status"
}
Log "Wrappers : $toolsDir"
Log "Log      : $logFile"
Log "Next: run_symbol_extractor.ps1, then start sidecar (cd sidecar-api && node src/index.js)"
Read-Host "Press Enter to close"

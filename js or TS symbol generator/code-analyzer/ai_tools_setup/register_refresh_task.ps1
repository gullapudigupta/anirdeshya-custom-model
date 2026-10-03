<#
.SYNOPSIS
    Register or remove the Windows scheduled task that auto-refreshes symbols.

.PARAMETER Action
    'register' to create the task, 'unregister' to delete it.

.PARAMETER Hours
    Interval between runs in hours (minimum 1, default 6). Only used for register.

.PARAMETER TaskName
    Name of the scheduled task (default: AI_Tools_RefreshSymbols).

.PARAMETER ScriptPath
    Path to run_symbol_extractor.ps1. Defaults to the script next to this file.
#>
param(
    [ValidateSet('register','unregister')]
    [string]$Action   = 'register',
    [ValidateRange(1,168)]
    [int]$Hours       = 6,
    [string]$TaskName = 'AI_Tools_RefreshSymbols',
    [string]$ScriptPath = ''
)

$ErrorActionPreference = 'Stop'

if (-not $ScriptPath) {
    $ScriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) 'run_symbol_extractor.ps1'
}

$ScriptPath = (Resolve-Path $ScriptPath -ErrorAction Stop).Path

if ($Action -eq 'register') {
    Write-Host "Registering task '$TaskName' to run every $Hours hour(s)..." -ForegroundColor Cyan

    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Warning "Administrator privileges required to register scheduled tasks."
        exit 1
    }

    $psArgs  = '-NoProfile -ExecutionPolicy Bypass -File "' + $ScriptPath + '"'
    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
                   -RepetitionInterval (New-TimeSpan -Hours $Hours)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Force | Out-Null

    Write-Host "Task '$TaskName' registered. Runs every $Hours hour(s)." -ForegroundColor Green

} elseif ($Action -eq 'unregister') {
    Write-Host "Removing task '$TaskName'..." -ForegroundColor Cyan

    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Task '$TaskName' removed." -ForegroundColor Green
    } else {
        Write-Host "Task '$TaskName' not found - nothing to remove." -ForegroundColor Yellow
    }
}

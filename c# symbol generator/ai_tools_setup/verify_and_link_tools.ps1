<#
Verify installed tools and create wrapper scripts in the repository tools folder.
Usage: Run in PowerShell.
Checks for: git, ctags, rg, node, go
Writes ai_tools_setup/verify_tools.log and creates <repo>\tools\*.ps1 wrappers that forward arguments.
#>

$ErrorActionPreference = 'Continue'
$repoDir = 'C:\sarah laptop\erv-heart\MyFirstProject-v2\src'
$logFile = Join-Path $PSScriptRoot 'verify_tools.log'
if (Test-Path $logFile) { Remove-Item $logFile -Force }

function Log([string]$m) {
 $line = "$(Get-Date -Format o) - $m"
 $line | Out-File -FilePath $logFile -Append -Encoding utf8
 Write-Output $line
}

# Tools to check; each entry may include alternate executable names and preferred version args
$toolsToCheck = @(
 @{ key='git'; exes=@('git'); versionArgs=@('--version') },
 @{ key='ctags'; exes=@('ctags','universal-ctags'); versionArgs=@('--version') },
 @{ key='rg'; exes=@('rg','ripgrep'); versionArgs=@('--version') },
 @{ key='node'; exes=@('node'); versionArgs=@('--version') },
 @{ key='go'; exes=@('go'); versionArgs=@('version') }
)

Log "Repository dir: $repoDir"
$toolsFound = @{}
foreach ($tool in $toolsToCheck) {
 $toolName = $tool.key
 $found = $false
 foreach ($exe in $tool.exes) {
 try {
 $cmd = Get-Command $exe -ErrorAction SilentlyContinue
 if ($null -ne $cmd) {
 $path = if ($cmd.Path) { $cmd.Path } elseif ($cmd.Source) { $cmd.Source } else { $null }
 if ($null -ne $path -and $path -ne '') {
 Log "Found '$exe' for '$toolName' at: $path"

 # attempt to get version output using preferred args
 $verStr = ''
 foreach ($arg in $tool.versionArgs) {
 try {
 $proc = Start-Process -FilePath $path -ArgumentList $arg -RedirectStandardOutput -NoNewWindow -PassThru -Wait
 $out = $proc.StandardOutput.ReadToEnd()
 if ($out) { $verStr = $out.Trim(); break }
 } catch {
 # ignore and try next arg
 }
 }

 if (-not $verStr) {
 # fallback: try --version and version
 try { $proc = Start-Process -FilePath $path -ArgumentList '--version' -RedirectStandardOutput -NoNewWindow -PassThru -Wait; $verStr = $proc.StandardOutput.ReadToEnd().Trim() } catch {}
 if (-not $verStr) { try { $proc = Start-Process -FilePath $path -ArgumentList 'version' -RedirectStandardOutput -NoNewWindow -PassThru -Wait; $verStr = $proc.StandardOutput.ReadToEnd().Trim() } catch {} }
 }

 if (-not $verStr) { $verStr = 'version output not available' }
 Log "$exe version output: $verStr"

 $toolsFound[$toolName] = $path
 $found = $true
 break
 }
 }
 } catch {
 Log ([string]::Format('Error checking {0}: {1}', $exe, $_.Exception.Message))
 }
 }
 if (-not $found) {
 Log ([string]::Format('Tool not found for key: {0} (checked: {1})', $toolName, ($tool.exes -join ',')))
 }
}

# Create tools folder in repo
$toolsDir = Join-Path $repoDir 'tools'
if (-not (Test-Path $toolsDir)) {
 New-Item -ItemType Directory -Path $toolsDir | Out-Null
 Log "Created tools folder: $toolsDir"
} else {
 Log "Tools folder exists: $toolsDir"
}

# Create wrapper scripts for each found tool
foreach ($kv in $toolsFound.GetEnumerator()) {
 $tool = $kv.Key
 $fullPath = $kv.Value
 $wrapperPath = Join-Path $toolsDir ("$tool.ps1")
 $content = @"
param(
 [Parameter(ValueFromRemainingArguments = `$	rue)]
 [string[]] `$Args
)
# Wrapper to forward all args to the real executable
& `"$fullPath`" @Args
"@
 Set-Content -Path $wrapperPath -Value $content -Encoding UTF8
 Log "Created wrapper: $wrapperPath -> $fullPath"
}

# Create a small README in tools folder
$readme = @"
This folder contains lightweight PowerShell wrappers that forward arguments to system-installed tools.
Use them to run tools relative to the repository, for example:
 pwsh -File .\tools\git.ps1 status
Note: these wrappers just call the installed binaries found in PATH at verification time.
If you install or move binaries, re-run this verify script to refresh the wrappers.
"@
Set-Content -Path (Join-Path $toolsDir 'README.md') -Value $readme -Encoding UTF8
Log "Wrote tools README"

Log "Verification complete. See $logFile for details."

# Print summary to console
Get-Content $logFile | Write-Output


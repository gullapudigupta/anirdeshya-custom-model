# Auto-update script for AI tools (idempotent, best-effort)
# Run as user with necessary permissions. Designed for Windows + Chocolatey.

$ErrorActionPreference = 'Continue'
$log = @()
function Log($m) { $log += "$(Get-Date -Format o) - $m" }

# Update choco itself
if (Get-Command choco -ErrorAction SilentlyContinue) {
 Log "Upgrading chocolatey"
 choco upgrade chocolatey -y | Out-Null
} else {
 Log "choco not found"
}

# Tools to update via choco
$chocoTools = @('universal-ctags','ripgrep','golang','nodejs')
foreach ($t in $chocoTools) {
 try {
 Log "Attempting to upgrade $t via choco"
 choco upgrade $t -y | Out-Null
 } catch {
 Log "choco upgrade $t failed: $_"
 }
}

# Update npm global packages
if (Get-Command npm -ErrorAction SilentlyContinue) {
 Log "Updating npm global packages: tree-sitter-cli"
 try { npm update -g tree-sitter-cli } catch { Log "npm update failed: $_" }
} else { Log "npm not found" }

# Update zoekt (go install latest)
if (Get-Command go -ErrorAction SilentlyContinue) {
 try {
 Log "Installing latest zoekt"
 go install github.com/sourcegraph/zoekt/cmd/zoekt@latest
 go install github.com/sourcegraph/zoekt/cmd/zoekt-git-index@latest
 } catch { Log "go install zoekt failed: $_" }
} else { Log "go not found" }

# Update docker images (sourcegraph) if docker exists
if (Get-Command docker -ErrorAction SilentlyContinue) {
 try {
 Log "Pulling latest sourcegraph/server image"
 docker pull sourcegraph/server:latest | Out-Null
 } catch { Log "docker pull failed: $_" }
} else { Log "docker not found" }

# Custom locations for codeql and omnisharp must be updated manually or via download commands
# Attempt to update codeql by downloading latest release (requires internet)
$codeqlUrl = 'https://github.com/github/codeql-cli-binaries/releases/latest'
Log "Note: CodeQL and OmniSharp updates must be handled manually by downloading releases or adding scripted download logic."

$log | Out-File -FilePath (Join-Path $PSScriptRoot 'update_tools.log') -Encoding utf8


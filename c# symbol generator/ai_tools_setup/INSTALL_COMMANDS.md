Installation commands for recommended tools (Windows PowerShell, admin recommended)

# Chocolatey-based installs (Windows)
choco install git -y
choco install universal-ctags -y
choco install ripgrep -y
choco install nodejs -y
choco install golang -y

# npm global
npm install -g tree-sitter-cli

# Go installs (after installing Go and setting GOPATH/GOBIN)
go install github.com/sourcegraph/zoekt/cmd/zoekt@latest
go install github.com/sourcegraph/zoekt/cmd/zoekt-git-index@latest

# Docker Sourcegraph (optional heavy-weight server)
docker run --detach --publish7080:7080 --name=sourcegraph sourcegraph/server:latest

# CodeQL (manual download)
# Download the CodeQL CLI zip from https://github.com/github/codeql-cli-binaries/releases/latest and extract to a folder on PATH

# OmniSharp (manual download)
# Download latest OmniSharp-roslyn release: https://github.com/OmniSharp/omnisharp-roslyn/releases and extract to a folder on PATH

# Scheduled task registration (run in elevated PowerShell)
# This will run the update script every10 minutes
schtasks /Create /SC MINUTE /MO10 /TN "AI_Tools_Update" /TR "powershell -ExecutionPolicy Bypass -File \"%cd%\\ai_tools_setup\\update_tools.ps1\"" /F

# To remove the scheduled task
schtasks /Delete /TN "AI_Tools_Update" /F


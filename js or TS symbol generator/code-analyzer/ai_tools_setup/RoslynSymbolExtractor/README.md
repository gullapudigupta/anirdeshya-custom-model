Roslyn Symbol Extractor

This console app extracts semantic symbols (types, methods, properties, fields) from a Visual Studio solution using Roslyn and writes a compact JSON file (`symbols.json`).

Usage
1. Build the extractor (requires MSBuild / Visual Studio Build Tools):
 - From an elevated/developer PowerShell with MSBuild available:
 msbuild ai_tools_setup\RoslynSymbolExtractor\RoslynSymbolExtractor.csproj /p:Configuration=Release
 - Or try `dotnet build` if your SDK and environment support building .NET Framework projects:
 dotnet build ai_tools_setup\RoslynSymbolExtractor\RoslynSymbolExtractor.csproj -c Release

2. Run the extractor:
 - Example:
 ai_tools_setup\RoslynSymbolExtractor\bin\Release\RoslynSymbolExtractor.exe "C:\path\to\YourSolution.sln" "ai_tools_setup\symbols\symbols.json"

Output
- By default the extractor writes `symbols.json` in the current folder. The wrapper script `ai_tools_setup\run_symbol_extractor.ps1` below automates building, running, storing outputs under `ai_tools_setup/symbols/`, and optionally committing or uploading the output.

Notes
- Ensure Visual Studio or MSBuild tools are available on the machine where you run the extractor.
- The generated `symbols.json` is intentionally compact (symbol kind, name, minimal signature, and location). Use it to drive LLM prompts or as an index for search tooling.

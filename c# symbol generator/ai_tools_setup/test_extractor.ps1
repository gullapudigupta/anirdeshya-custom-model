# Test script for Roslyn Symbol Extractor

$solutionPath = "C:\sarah laptop\erv-heart\MyFirstProject-v2\src\energy_reconversionsystem.sln"
$outputPath = "C:\sarah laptop\erv-heart\MyFirstProject-v2\src\ai_tools_setup\RoslynSymbolExtractor\symbols_test.json"
$extractorExe = "C:\sarah laptop\erv-heart\MyFirstProject-v2\src\ai_tools_setup\RoslynSymbolExtractor\bin\Debug\net48\RoslynSymbolExtractor.exe"

Write-Host "Testing Roslyn Symbol Extractor..."
Write-Host "Solution: $solutionPath"
Write-Host "Output: $outputPath"
Write-Host "Extractor: $extractorExe"
Write-Host ""

if (-not (Test-Path $solutionPath)) {
    Write-Error "Solution file not found: $solutionPath"
    exit 1
}

if (-not (Test-Path $extractorExe)) {
    Write-Host "Extractor not found. Building project..."
    cd "C:\sarah laptop\erv-heart\MyFirstProject-v2\src\ai_tools_setup\RoslynSymbolExtractor"
    dotnet build -c Debug
}

if (Test-Path $extractorExe) {
    Write-Host "Running extractor..."
    & $extractorExe $solutionPath $outputPath
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Success! Extractor completed."
        if (Test-Path $outputPath) {
  $fileSize = (Get-Item $outputPath).Length
            Write-Host "Output file size: $fileSize bytes"
 
 $content = Get-Content $outputPath | ConvertFrom-Json
            Write-Host "Extracted symbols: $($content.Count)"
 }
    } else {
        Write-Host "Extractor failed with exit code: $LASTEXITCODE"
    }
} else {
    Write-Error "Could not build or find extractor executable"
    exit 1
}

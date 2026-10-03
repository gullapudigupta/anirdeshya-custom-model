/**
 * Example: C# Analysis and Auto-Fix (Phase 2)
 *
 * Demonstrates the C# support end-to-end, fully offline (no .NET SDK required):
 *   1. Parse a sample of `dotnet build` diagnostics into normalized issues.
 *   2. Detect format issues in a messy C# file.
 *   3. Auto-fix that file with the offline pattern fixer and show the result.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { CSharpAnalyzer } = require('../src/languages/csharp-analyzer');
const { CSharpPatternFixer } = require('../src/fixers/csharp-fixer');

async function main() {
  console.log('🔷 C# Support Demo\n' + '='.repeat(50));

  const analyzer = new CSharpAnalyzer({ verbose: false });

  // 1. Parse representative MSBuild/Roslyn diagnostics.
  console.log('\n[1] Parsing sample build diagnostics:');
  const sampleBuildOutput = [
    "C:\\proj\\Program.cs(12,5): warning SA1200: Using directive should be inside namespace [C:\\proj\\App.csproj]",
    "C:\\proj\\Program.cs(3,1): error CS0246: type 'Foo' not found [C:\\proj\\App.csproj]",
    "C:\\proj\\Widget.cs(40,9): warning S1118: Add a private constructor [C:\\proj\\App.csproj]"
  ].join('\n');

  const issues = analyzer.parseBuildOutput(sampleBuildOutput);
  for (const issue of issues) {
    console.log(
      `  ${issue.severity.padEnd(7)} ${issue.ruleId.padEnd(8)} ` +
      `[${issue.tool}/${issue.category}] ${issue.message}`
    );
  }

  // 2 + 3. Detect and fix format issues in a temp file.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-csharp-demo-'));
  const file = path.join(sandbox, 'Program.cs');
  const messy =
    'using System;\r\n' +
    'class Program   \r\n' +
    '{\r\n' +
    '\tstatic void Main()\r\n' +
    '\t{\r\n' +
    '\t\tConsole.WriteLine("hi");   \r\n' +
    '\t}\r\n' +
    '}';
  fs.writeFileSync(file, messy, 'utf8');

  console.log('\n[2] Offline format issues detected:');
  for (const issue of analyzer.detectFormatIssues(file)) {
    console.log(`  line ${issue.line}: ${issue.ruleId} ${issue.message}`);
  }

  console.log('\n[3] Applying auto-fix...');
  const fixer = new CSharpPatternFixer({ dryRun: false, backup: false, indentSize: 4 });
  const result = await fixer.fixFile(file);
  console.log(`  Applied: ${result.appliedPatterns.join(', ') || 'none'}`);

  const fixed = fs.readFileSync(file, 'utf8');
  console.log('\n[4] Fixed content:');
  console.log('─'.repeat(50));
  process.stdout.write(fixed);
  console.log('─'.repeat(50));

  // Cleanup.
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_) {}

  console.log('\n✨ Done. See docs/CSHARP_SUPPORT.md for details.\n');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}

module.exports = { main };

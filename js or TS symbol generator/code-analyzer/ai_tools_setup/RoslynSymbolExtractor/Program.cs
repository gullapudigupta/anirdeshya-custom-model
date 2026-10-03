using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Newtonsoft.Json;
using System.Collections.Generic;
using System.Text;

namespace RoslynSymbolExtractor
{
    // Output format selection
    enum OutputFormat { Json, Ctags }

    class Program
    {
        static async Task<int> Main(string[] args)
        {
            // Parse arguments:
            //   arg[0]  solution path
            //   arg[1]  output file  (symbols.json or tags file)
            //   arg[2]  --ctags | --json  (optional, default json)
            string solutionPath = args.Length > 0 ? args[0]
                : "C:/sarah laptop/erv-heart/MyFirstProject-v2/src/energy_reconversionsystem.sln";
            string outFile = args.Length > 1 ? args[1]
                : "C:\\sarah laptop\\erv-heart\\MyFirstProject-v2\\src\\ai_tools_setup\\symbols\\symbols.json";

            OutputFormat format = OutputFormat.Json;
            for (int i = 2; i < args.Length; i++)
            {
                if (args[i].Equals("--ctags", StringComparison.OrdinalIgnoreCase))
                    format = OutputFormat.Ctags;
                else if (args[i].Equals("--json", StringComparison.OrdinalIgnoreCase))
                    format = OutputFormat.Json;
            }

            if (!File.Exists(solutionPath))
            {
                Console.Error.WriteLine($"Solution not found: {solutionPath}");
                return 2;
            }

            solutionPath = Path.GetFullPath(solutionPath);
            string solutionDir = Path.GetDirectoryName(solutionPath);
            Console.WriteLine($"Solution directory: {solutionDir}");
            Console.WriteLine($"Output format: {format}");

            var allSymbols = new List<Dictionary<string, string>>();
            var seen = new HashSet<string>();

            try
            {
                var projectFiles = Directory.EnumerateFiles(solutionDir, "*.csproj", SearchOption.AllDirectories)
                    .Where(f => !f.Contains("\\bin\\") && !f.Contains("\\obj\\"))
                    .ToList();

                Console.WriteLine($"Found {projectFiles.Count} project files");

                foreach (var projectFile in projectFiles)
                {
                    Console.WriteLine($"\nProcessing: {Path.GetFileName(projectFile)}");
                    try
                    {
                        string projectDir = Path.GetDirectoryName(projectFile);
                        var csFiles = Directory.EnumerateFiles(projectDir, "*.cs", SearchOption.AllDirectories)
                            .Where(f => !f.Contains("\\bin\\") && !f.Contains("\\obj\\"))
                            .ToList();

                        Console.WriteLine($"  Found {csFiles.Count} C# files");

                        foreach (var csFile in csFiles)
                        {
                            try
                            {
                                string content = File.ReadAllText(csFile);
                                var tree = CSharpSyntaxTree.ParseText(content, path: csFile);
                                var root = await tree.GetRootAsync();

                                var symbols = ExtractSymbols(root, csFile);

                                foreach (var sym in symbols)
                                {
                                    string key = sym["Kind"] + "::" + sym["Name"] + "::" + (sym["Location"] ?? "");
                                    if (!seen.Contains(key))
                                    {
                                        seen.Add(key);
                                        allSymbols.Add(sym);
                                    }
                                }
                            }
                            catch (Exception ex)
                            {
                                Console.Error.WriteLine($"Error parsing {Path.GetFileName(csFile)}: {ex.Message}");
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"  Error processing project: {ex.Message}");
                    }
                }

                Console.WriteLine($"\n=== SUMMARY ===");
                Console.WriteLine($"Total unique symbols extracted: {allSymbols.Count}");

                // Ensure output directory exists
                string outDir = Path.GetDirectoryName(outFile);
                if (!string.IsNullOrEmpty(outDir) && !Directory.Exists(outDir))
                    Directory.CreateDirectory(outDir);

                if (format == OutputFormat.Ctags)
                {
                    WriteCtagsFile(allSymbols, outFile);
                    Console.WriteLine($"Wrote ctags file to: {outFile}");
                }
                else
                {
                    File.WriteAllText(outFile, JsonConvert.SerializeObject(allSymbols, Formatting.Indented));
                    Console.WriteLine($"Wrote symbols JSON to: {outFile}");
                }

                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error: {ex.Message}");
                Console.Error.WriteLine($"Stack trace: {ex.StackTrace}");
                return 2;
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // ctags output writer
        //
        // Produces an Extended ctags file compatible with Universal Ctags and
        // Vim/Neovim/VS Code ctags consumers. Format per line:
        //
        //   {name}\t{file}\t{line};"\\t{kind_letter}\tline:{line}
        //
        // The file also starts with the standard sorted-ctags header lines.
        // ─────────────────────────────────────────────────────────────────────
        static void WriteCtagsFile(List<Dictionary<string, string>> symbols, string outFile)
        {
            // ctags kind letters for C# symbol types
            static char KindLetter(string kind) => kind switch
            {
                "NamedType" => 'c',   // class / struct / interface / enum
                "Method"    => 'm',   // method
                "Property"  => 'p',   // property
                "Field"     => 'f',   // field
                "Delegate"  => 'd',   // delegate
                "Namespace" => 'n',   // namespace
                _           => 'x',   // unknown
            };

            static string KindName(string kind) => kind switch
            {
                "NamedType" => "class",
                "Method"    => "method",
                "Property"  => "property",
                "Field"     => "field",
                "Delegate"  => "delegate",
                "Namespace" => "namespace",
                _           => "unknown",
            };

            // Sort by tag name (ctags files are expected to be sorted for binary search)
            var sorted = symbols
                .Where(s => s.ContainsKey("Name") && s.ContainsKey("Location") && s.ContainsKey("Line"))
                .OrderBy(s => s["Name"], StringComparer.Ordinal)
                .ToList();

            var sb = new StringBuilder();

            // Standard ctags header
            sb.AppendLine("!_TAG_FILE_FORMAT\t2\t/extended format; --format=1 will not append ;\" to lines/");
            sb.AppendLine("!_TAG_FILE_SORTED\t1\t/0=unsorted, 1=sorted, 2=foldcase/");
            sb.AppendLine("!_TAG_PROGRAM_NAME\tRoslynSymbolExtractor\t//");
            sb.AppendLine("!_TAG_PROGRAM_VERSION\t1.0\t//");

            foreach (var sym in sorted)
            {
                string name     = sym["Name"];
                string file     = sym["Location"].Replace('\\', '/');
                string lineStr  = sym["Line"];
                string kind     = sym.ContainsKey("Kind") ? sym["Kind"] : "unknown";
                char   kindChar = KindLetter(kind);
                string kindFull = KindName(kind);

                if (!int.TryParse(lineStr, out int lineNum)) lineNum = 1;

                // Extended ctags format:
                // name TAB file TAB /^pattern$/;" TAB kind TAB line:N
                // We use line number address (/\%{N}l/ equivalent) for precision
                sb.Append(name);
                sb.Append('\t');
                sb.Append(file);
                sb.Append('\t');
                // Address: line number search pattern — works in most consumers
                sb.Append(lineNum);
                sb.Append(";\"");
                sb.Append('\t');
                sb.Append(kindChar);
                sb.Append('\t');
                sb.Append("line:");
                sb.Append(lineNum);
                sb.Append('\t');
                sb.Append("kind:");
                sb.Append(kindFull);
                sb.Append('\t');
                sb.Append("language:CSharp");
                sb.AppendLine();
            }

            File.WriteAllText(outFile, sb.ToString(), new UTF8Encoding(false));
        }

        // ─────────────────────────────────────────────────────────────────────
        // Symbol extraction from Roslyn syntax tree
        // ─────────────────────────────────────────────────────────────────────
        static List<Dictionary<string, string>> ExtractSymbols(SyntaxNode root, string sourceFile)
        {
            var symbols = new List<Dictionary<string, string>>();

            foreach (var node in root.DescendantNodes())
            {
                try
                {
                    string kind   = null;
                    string name   = null;
                    int?   line   = null;
                    int?   column = null;

                    var location = node.GetLocation();
                    if (location != null && location.IsInSource)
                    {
                        var lineSpan = location.GetLineSpan();
                        line   = lineSpan.StartLinePosition.Line + 1;
                        column = lineSpan.StartLinePosition.Character + 1;
                    }

                    if (node is ClassDeclarationSyntax classDec)
                    {
                        kind = "NamedType";
                        name = classDec.Identifier.Text;
                    }
                    else if (node is StructDeclarationSyntax structDec)
                    {
                        kind = "NamedType";
                        name = structDec.Identifier.Text;
                    }
                    else if (node is InterfaceDeclarationSyntax ifaceDec)
                    {
                        kind = "NamedType";
                        name = ifaceDec.Identifier.Text;
                    }
                    else if (node is EnumDeclarationSyntax enumDec)
                    {
                        kind = "NamedType";
                        name = enumDec.Identifier.Text;
                    }
                    else if (node is MethodDeclarationSyntax methodDec)
                    {
                        kind = "Method";
                        name = methodDec.Identifier.Text;
                    }
                    else if (node is PropertyDeclarationSyntax propDec)
                    {
                        kind = "Property";
                        name = propDec.Identifier.Text;
                    }
                    else if (node is FieldDeclarationSyntax fieldDec)
                    {
                        kind = "Field";
                        foreach (var variable in fieldDec.Declaration.Variables)
                        {
                            name = variable.Identifier.Text;
                            symbols.Add(new Dictionary<string, string>
                            {
                                { "Kind",     kind },
                                { "Name",     name },
                                { "Location", sourceFile },
                                { "Line",     line?.ToString() ?? "unknown" },
                                { "Column",   column?.ToString() ?? "unknown" }
                            });
                        }
                        continue;
                    }
                    else if (node is DelegateDeclarationSyntax delegateDec)
                    {
                        kind = "Delegate";
                        name = delegateDec.Identifier.Text;
                    }
                    else if (node is NamespaceDeclarationSyntax namespaceDec)
                    {
                        kind = "Namespace";
                        name = namespaceDec.Name.ToString();
                    }

                    if (kind != null && name != null)
                    {
                        symbols.Add(new Dictionary<string, string>
                        {
                            { "Kind",     kind },
                            { "Name",     name },
                            { "Location", sourceFile },
                            { "Line",     line?.ToString() ?? "unknown" },
                            { "Column",   column?.ToString() ?? "unknown" }
                        });
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"    Warning: Could not extract symbol: {ex.Message}");
                }
            }

            return symbols;
        }
    }
}

#!/usr/bin/env node
/**
 * Parikrama Code Analyzer MCP Server (Standalone)
 * 
 * Exposes ONLY quality analysis tools via MCP protocol.
 * For Angular/TypeScript/SCSS/HTML projects.
 * 
 * Tools (10):
 *   query_symbols, get_file_complexity, analyze_codebase, check_security,
 *   check_quality_gate, get_dependencies, find_code_smells,
 *   analyze_template, analyze_styles, get_angular_issues
 * 
 * Usage:
 *   node tools/code-analyzer/mcp-server-analyzer.js
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(ROOT, 'src');

const { getSourceFiles, getStyleFiles, getTemplateFiles } = require('./src/ast-utils');
const fs = require('fs');
const { QueryEngine } = require('./src/query-engine');
const { analyzeFileComplexity } = require('./src/analyzers/complexity');
const { AngularPatternAnalyzer } = require('./src/analyzers/angular-patterns');
const { CodeSmellDetector } = require('./src/analyzers/code-smells');
const { SecurityScanner } = require('./src/analyzers/security');
const { ScssAnalyzer } = require('./src/analyzers/scss-analyzer');
const { TemplateAnalyzer } = require('./src/analyzers/template-analyzer');
const { DependencyGraph } = require('./src/analyzers/dependency-graph');
const { QualityGate, RELAXED_GATE } = require('./src/quality-gate');

let queryEngine = null;
let lastIndexTime = 0;
const INDEX_TTL = 120000;

function ensureIndex() {
  const now = Date.now();
  if (!queryEngine || now - lastIndexTime > INDEX_TTL) {
    queryEngine = new QueryEngine(ROOT);
    queryEngine.buildIndex(SRC_DIR);
    lastIndexTime = now;
  }
}

// Invalidate the cached index as soon as a source file is saved, instead of waiting for INDEX_TTL to expire.
let invalidateDebounce = null;
try {
  fs.watch(SRC_DIR, { recursive: true }, (eventType, filename) => {
    if (filename && !/\.(ts|html|scss|css)$/.test(filename)) return;
    clearTimeout(invalidateDebounce);
    invalidateDebounce = setTimeout(() => { lastIndexTime = 0; }, 300);
  });
} catch (e) { /* fs.watch recursive unsupported on this platform */ }

const server = new Server(
  { name: 'parikrama-code-analyzer', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'query_symbols', description: 'Search Angular/TS symbols by name/type/file/decorator.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Symbol name (fuzzy match)' }, type: { type: 'string', description: 'Filter: component, service, class, method, interface, etc.' }, file: { type: 'string', description: 'Restrict to file' } } } },
    { name: 'get_file_complexity', description: 'Cyclomatic + Cognitive complexity + Maintainability Index for a file.', inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Relative file path (required)' } }, required: ['file'] } },
    { name: 'analyze_codebase', description: 'Full quality analysis: complexity, smells, security, dead code, duplication.', inputSchema: { type: 'object', properties: { quick: { type: 'boolean', description: 'Quick mode (skip expensive checks)' } } } },
    { name: 'check_security', description: 'Security vulnerability scan with CWE tags.', inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Optional: scan specific file' } } } },
    { name: 'check_quality_gate', description: 'Pass/fail quality gate with configurable thresholds.', inputSchema: { type: 'object', properties: { strict: { type: 'boolean', description: 'Use strict thresholds (default: relaxed)' } } } },
    { name: 'get_dependencies', description: 'Dependency graph: circular deps, coupling metrics, orphans.', inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Optional: show deps for specific file' } } } },
    { name: 'find_code_smells', description: 'Detect code smells with effort estimation.', inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Optional: scan specific file' } } } },
    { name: 'analyze_template', description: 'HTML template analysis: a11y, performance, bindings.', inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Relative .html file (required)' } }, required: ['file'] } },
    { name: 'analyze_styles', description: 'SCSS/CSS analysis: specificity, colors, nesting, z-index.', inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Relative .scss/.css file (required)' } }, required: ['file'] } },
    { name: 'get_angular_issues', description: 'Angular-specific pattern issues: change detection, subscriptions, lifecycle.', inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Optional: scan specific file' } } } },
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  ensureIndex();

  try {
    let result;

    switch (name) {
      case 'query_symbols': {
        const { query, type, file } = args;
        let symbols = query ? queryEngine.search(query) : queryEngine.getAllSymbols();
        if (type) symbols = symbols.filter(s => s.type === type);
        if (file) symbols = symbols.filter(s => s.file?.includes(file));
        result = { count: symbols.length, symbols: symbols.slice(0, 50) };
        break;
      }

      case 'get_file_complexity': {
        const filePath = path.resolve(ROOT, args.file);
        result = analyzeFileComplexity(filePath);
        break;
      }

      case 'analyze_codebase': {
        const sourceFiles = getSourceFiles(SRC_DIR);
        const analysis = { files: sourceFiles.length, complexity: [], issues: [] };
        const filesToAnalyze = args.quick ? sourceFiles.slice(0, 20) : sourceFiles;
        for (const file of filesToAnalyze) {
          try {
            const cx = analyzeFileComplexity(file);
            if (cx.averageCyclomatic > 5) analysis.complexity.push({ file: path.relative(ROOT, file), ...cx });
          } catch (_) {}
        }
        result = analysis;
        break;
      }

      case 'check_security': {
        const scanner = new SecurityScanner();
        const files = args.file
          ? [path.resolve(ROOT, args.file)]
          : getSourceFiles(SRC_DIR);
        result = scanner.scanFiles(files.map(f => path.relative(ROOT, f)), ROOT);
        break;
      }

      case 'check_quality_gate': {
        const gate = args.strict ? new QualityGate() : new QualityGate(RELAXED_GATE);
        const sourceFiles = getSourceFiles(SRC_DIR);
        result = gate.evaluate(sourceFiles, ROOT, queryEngine);
        break;
      }

      case 'get_dependencies': {
        const graph = new DependencyGraph(ROOT);
        const sourceFiles = getSourceFiles(SRC_DIR);
        graph.buildGraph(sourceFiles);
        if (args.file) {
          result = graph.getFileDependencies(args.file);
        } else {
          result = { circular: graph.findCircularDeps(), stats: graph.getStats() };
        }
        break;
      }

      case 'find_code_smells': {
        const detector = new CodeSmellDetector();
        const files = args.file
          ? [path.resolve(ROOT, args.file)]
          : getSourceFiles(SRC_DIR);
        result = detector.detectSmells(files.map(f => path.relative(ROOT, f)), ROOT);
        break;
      }

      case 'analyze_template': {
        const analyzer = new TemplateAnalyzer();
        result = analyzer.analyzeFile(path.resolve(ROOT, args.file));
        break;
      }

      case 'analyze_styles': {
        const analyzer = new ScssAnalyzer();
        result = analyzer.analyzeFile(path.resolve(ROOT, args.file));
        break;
      }

      case 'get_angular_issues': {
        const analyzer = new AngularPatternAnalyzer();
        const files = args.file
          ? [path.resolve(ROOT, args.file)]
          : getSourceFiles(SRC_DIR);
        result = analyzer.analyzeFiles(files.map(f => path.relative(ROOT, f)), ROOT);
        break;
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[parikrama-code-analyzer MCP] ready\n');
}

main().catch(err => { process.stderr.write(`Fatal: ${err.message}\n`); process.exit(1); });

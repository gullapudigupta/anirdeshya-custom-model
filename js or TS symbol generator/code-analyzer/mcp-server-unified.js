#!/usr/bin/env node
/**
 * Parikrama Unified MCP Server
 * 
 * Combines BOTH tool sets into a single MCP server:
 * 
 * FROM ai_tools_setup (Sidecar API — context serving):
 *   - get_snippet         — Code lines ±N context
 *   - get_signature       — Declaration text only (~80 chars, cheapest)
 *   - get_outline         — File structure, no bodies
 *   - get_callers         — All call-sites of a method
 *   - get_diff_context    — Git diff annotated with enclosing symbol
 *   - compose_context     — Token-budgeted LLM bundle
 * 
 * FROM code-analyzer (Quality analysis):
 *   - query_symbols       — Search symbols by name/type
 *   - get_file_complexity — Complexity metrics for a file
 *   - analyze_codebase    — Full analysis with ratings
 *   - check_security      — Security vulnerability scan
 *   - check_quality_gate  — Pass/fail gate check
 *   - get_dependencies    — Dependency graph & circular deps
 *   - find_code_smells    — Code smell detection
 *   - analyze_template    — HTML template analysis
 *   - analyze_styles      — SCSS/CSS analysis
 *   - get_angular_issues  — Angular pattern issues
 * 
 * Total: 16 tools in ONE MCP server
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');
const fs = require('fs');

// ─── Project Root ────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(ROOT, 'src');
const { getAnalyzerRoots } = require('./src/analyzer-roots');
const ANALYZER_ROOTS = getAnalyzerRoots(ROOT);

// ─── Quality Analysis Imports ────────────────────────────────────────────────

const { getSourceFiles, getStyleFiles, getTemplateFiles } = require('./src/ast-utils');
const { QueryEngine } = require('./src/query-engine');
const { analyzeFileComplexity } = require('./src/analyzers/complexity');
const { AngularPatternAnalyzer } = require('./src/analyzers/angular-patterns');
const { CodeSmellDetector } = require('./src/analyzers/code-smells');
const { SecurityScanner } = require('./src/analyzers/security');
const { ScssAnalyzer } = require('./src/analyzers/scss-analyzer');
const { TemplateAnalyzer } = require('./src/analyzers/template-analyzer');
const { DependencyGraph } = require('./src/analyzers/dependency-graph');
const { QualityGate, RELAXED_GATE } = require('./src/quality-gate');

// ─── Context Serving Imports (ported from sidecar) ───────────────────────────

const { SnippetService } = require('./src/services/snippet-service');
const { SignatureService } = require('./src/services/signature-service');
const { OutlineService } = require('./src/services/outline-service');
const { CallersService } = require('./src/services/callers-service');
const { DiffContextService } = require('./src/services/diff-context-service');
const { ContextComposer } = require('./src/services/context-composer');

// ─── Initialize Services ─────────────────────────────────────────────────────

let queryEngine = null;
let snippetService = null;
let signatureService = null;
let outlineService = null;
let callersService = null;
let diffContextService = null;
let contextComposer = null;
let lastIndexTime = 0;
const INDEX_TTL = 120000; // 2 minutes

function ensureServices() {
  const now = Date.now();
  if (!queryEngine || now - lastIndexTime > INDEX_TTL) {
    queryEngine = new QueryEngine(ROOT);
    queryEngine.buildIndex(ANALYZER_ROOTS);
    snippetService = new SnippetService(ROOT);
    signatureService = new SignatureService(ROOT, queryEngine);
    outlineService = new OutlineService(ROOT, queryEngine);
    callersService = new CallersService(ROOT, queryEngine);
    diffContextService = new DiffContextService(ROOT, queryEngine);
    contextComposer = new ContextComposer(ROOT, queryEngine);
    lastIndexTime = now;
  }
}

// Invalidate the cached index as soon as a source file is saved, instead of waiting for INDEX_TTL to expire.
let invalidateDebounce = null;
for (const analyzerRoot of ANALYZER_ROOTS) {
  try {
    fs.watch(analyzerRoot, { recursive: true }, (eventType, filename) => {
      if (filename && !/\.(ts|js|html|scss|css)$/.test(filename)) return;
      clearTimeout(invalidateDebounce);
      invalidateDebounce = setTimeout(() => { lastIndexTime = 0; }, 300);
    });
  } catch (e) { /* fs.watch recursive unsupported on this platform */ }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'parikrama-unified', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

// ─── Tool Definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ═══ CONTEXT SERVING (from sidecar) ═══
    {
      name: 'get_snippet',
      description: 'Get source code lines ±N context around a specific line number. Returns highlighted target line with surrounding context.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Relative path to the file' },
          line: { type: 'integer', description: 'Target line number (1-based)' },
          context: { type: 'integer', description: 'Lines of context on each side (default 5)' },
        },
        required: ['file', 'line'],
      },
    },
    {
      name: 'get_signature',
      description: 'CHEAPEST LOOKUP. Returns only the declaration line(s) of a symbol — no body, no surrounding code. ~80 chars. Use this first when you only need to know what a symbol looks like.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Symbol name to look up' },
          file: { type: 'string', description: 'Optional: restrict to this file' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_outline',
      description: 'Get full structural outline of a file — all classes, methods, properties with line numbers but NO code bodies. ~200 chars for a 500-line file. Use to understand file structure before reading.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Relative path to the file' },
          kind: { type: 'string', description: 'Comma-separated kinds to filter: method, component, service, interface' },
          flat: { type: 'boolean', description: 'If true, return flat sorted list instead of class-grouped' },
        },
        required: ['file'],
      },
    },
    {
      name: 'get_callers',
      description: 'Find all call-sites of a method/function across the entire codebase. Returns file, line, call text, and enclosing method for each. 10-15x cheaper than search + multiple snippets.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Method or function name to find callers of' },
          file: { type: 'string', description: 'Optional: restrict search to this file' },
          limit: { type: 'integer', description: 'Max results (default 30)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'get_diff_context',
      description: 'Get only changed code lines since last commit, annotated with enclosing symbol per hunk. 20-50x smaller than reading changed files. Start here when reviewing code changes.',
      inputSchema: {
        type: 'object',
        properties: {
          base: { type: 'string', description: 'Branch or commit to diff against (default: HEAD)' },
          staged: { type: 'boolean', description: 'If true, show only staged changes' },
        },
      },
    },
    {
      name: 'compose_context',
      description: 'Build a token-budgeted LLM context bundle. Orchestrates symbol lookup + snippets/signatures into one result. Modes: "signatures" (cheapest, ~150 tokens), "compact" (default, ~800 tokens), "full" (most detail, ~2000 tokens).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Symbol name or concept to build context for' },
          maxTokens: { type: 'integer', description: 'Token budget (default 2000)' },
          mode: { type: 'string', description: '"compact" (default) | "signatures" (cheapest) | "full" (most detail)', enum: ['compact', 'signatures', 'full'] },
        },
        required: ['query'],
      },
    },

    // ═══ QUALITY ANALYSIS (our code-analyzer) ═══
    {
      name: 'query_symbols',
      description: 'Search for code symbols (classes, services, components, interfaces, functions, methods) by name or type. Supports fuzzy matching.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Symbol name to search for' },
          type: { type: 'string', description: 'Filter by type: component, service, pipe, directive, module, guard, interface, enum, function, class, method' },
          file: { type: 'string', description: 'Filter by file path pattern' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_file_complexity',
      description: 'Get complexity metrics (cyclomatic, cognitive, maintainability index) for a specific file.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to the file' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'analyze_codebase',
      description: 'Run full code analysis. Returns quality gate status, security/maintainability/reliability ratings, and issue summary.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Scope: full, security, angular, complexity, smells', enum: ['full', 'security', 'angular', 'complexity', 'smells'] },
        },
      },
    },
    {
      name: 'check_security',
      description: 'Run security vulnerability scan. Returns CWE-tagged vulnerabilities and hotspots with severity.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Optional: scan specific file only' },
        },
      },
    },
    {
      name: 'check_quality_gate',
      description: 'Run quality gate check. Returns PASSED/FAILED with details on which conditions failed.',
      inputSchema: {
        type: 'object',
        properties: {
          relaxed: { type: 'boolean', description: 'Use relaxed thresholds for initial adoption' },
        },
      },
    },
    {
      name: 'get_dependencies',
      description: 'Get import dependencies for a file or detect circular dependencies across the codebase.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'File to check dependencies for' },
          detectCircular: { type: 'boolean', description: 'Detect circular deps across codebase' },
        },
      },
    },
    {
      name: 'find_code_smells',
      description: 'Find code smells in a file. Returns smell type, severity, fix effort, and technical debt.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to analyze' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'analyze_template',
      description: 'Analyze Angular HTML template for accessibility (a11y), performance patterns, and binding issues.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to .html template file' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'analyze_styles',
      description: 'Analyze SCSS/CSS file for specificity, !important usage, nesting depth, color consistency.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to .scss/.css file' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'get_angular_issues',
      description: 'Get Angular-specific pattern issues: change detection, subscription leaks, lifecycle hooks, standalone migration.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Optional: check specific file' },
          category: { type: 'string', description: 'Filter: performance, reliability, security, modernization', enum: ['performance', 'reliability', 'security', 'modernization', 'code-smell', 'best-practice'] },
        },
      },
    },
  ],
}));

// ─── Tool Call Handler ────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  ensureServices();

  try {
    switch (name) {
      // ═══ CONTEXT SERVING ═══
      case 'get_snippet': return handleSnippet(args);
      case 'get_signature': return handleSignature(args);
      case 'get_outline': return handleOutline(args);
      case 'get_callers': return handleCallers(args);
      case 'get_diff_context': return handleDiffContext(args);
      case 'compose_context': return handleComposeContext(args);
      // ═══ QUALITY ANALYSIS ═══
      case 'query_symbols': return handleQuerySymbols(args);
      case 'get_file_complexity': return handleFileComplexity(args);
      case 'analyze_codebase': return handleAnalyze(args);
      case 'check_security': return handleSecurity(args);
      case 'check_quality_gate': return handleQualityGate(args);
      case 'get_dependencies': return handleDependencies(args);
      case 'find_code_smells': return handleCodeSmells(args);
      case 'analyze_template': return handleTemplate(args);
      case 'analyze_styles': return handleStyles(args);
      case 'get_angular_issues': return handleAngularIssues(args);
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
  }
});

// ═══ CONTEXT SERVING HANDLERS ════════════════════════════════════════════════

function handleSnippet(args) {
  const result = snippetService.getSnippet(args.file, args.line, args.context || 5);
  if (!result) return { content: [{ type: 'text', text: `File not found: ${args.file}` }] };
  const text = result.lines.map(l => `${l.isTarget ? '→' : ' '} ${l.number}: ${l.text}`).join('\n');
  return { content: [{ type: 'text', text: `${result.file} (lines ${result.startLine}-${result.endLine}):\n\n${text}` }] };
}

function handleSignature(args) {
  const results = signatureService.getSignature(args.query, args.file);
  if (results.length === 0) return { content: [{ type: 'text', text: `No signatures found for "${args.query}"` }] };
  const text = results.map(s => `[${s.kind}] ${s.name} — ${s.file}:${s.line}\n${s.declarationText || '(no declaration found)'}`).join('\n\n');
  return { content: [{ type: 'text', text }] };
}

function handleOutline(args) {
  const result = outlineService.getOutline(args.file, { kind: args.kind, flat: args.flat });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function handleCallers(args) {
  const result = callersService.findCallers(args.name, { file: args.file, limit: args.limit });
  const text = [`${result.name} — ${result.count} callers found`];
  if (result.definedAt) text.push(`Defined at: ${result.definedAt.file}:${result.definedAt.line} [${result.definedAt.kind}]`);
  text.push('');
  for (const c of result.callers.slice(0, 20)) {
    const enc = c.enclosingSymbol ? ` (in ${c.enclosingSymbol.name})` : '';
    text.push(`  ${c.file}:${c.line}${enc}\n    ${c.callText}`);
  }
  return { content: [{ type: 'text', text: text.join('\n') }] };
}

function handleDiffContext(args) {
  const result = diffContextService.getDiffContext({ base: args.base, staged: args.staged });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function handleComposeContext(args) {
  const result = contextComposer.compose(args.query, { maxTokens: args.maxTokens, mode: args.mode });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

// ═══ QUALITY ANALYSIS HANDLERS ═══════════════════════════════════════════════

function handleQuerySymbols(args) {
  let results = args.type ? queryEngine.findByType(args.type) : queryEngine.search(args.query);
  if (args.type && args.query) results = results.filter(s => s.name.toLowerCase().includes(args.query.toLowerCase()));
  if (args.file) results = results.filter(s => s.file?.includes(args.file));
  const limited = results.slice(0, 25);
  const text = limited.map(s => {
    let info = `[${s.type}] ${s.name} — ${s.file}:${s.line}`;
    if (s.metadata?.selector) info += `\n  selector: ${s.metadata.selector}`;
    if (s.methods?.length) info += `\n  methods: ${s.methods.slice(0, 5).join(', ')}`;
    return info;
  }).join('\n\n');
  return { content: [{ type: 'text', text: `Found ${results.length} symbols:\n\n${text}` }] };
}

function handleFileComplexity(args) {
  const filePath = path.resolve(ROOT, args.filePath);
  const result = analyzeFileComplexity(filePath);
  if (!result) return { content: [{ type: 'text', text: `Could not analyze: ${args.filePath}` }] };
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function handleAnalyze(args) {
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const htmlFiles = getTemplateFiles(SRC_DIR);
  const secScanner = new SecurityScanner(ROOT);
  for (const f of tsFiles) secScanner.scanFile(f);
  const smellDetector = new CodeSmellDetector(ROOT);
  for (const f of tsFiles) smellDetector.analyzeFile(f);
  const angularAnalyzer = new AngularPatternAnalyzer(ROOT);
  for (const f of tsFiles) angularAnalyzer.analyzeFile(f);
  for (const f of htmlFiles) angularAnalyzer.analyzeTemplate(f);
  return { content: [{ type: 'text', text: JSON.stringify({
    filesAnalyzed: tsFiles.length + htmlFiles.length,
    security: secScanner.getSummary(),
    codeSmells: smellDetector.getSummary(),
    angular: angularAnalyzer.getSummary(),
  }, null, 2) }] };
}

function handleSecurity(args) {
  const scanner = new SecurityScanner(ROOT);
  if (args.filePath) {
    const full = path.resolve(ROOT, args.filePath);
    args.filePath.endsWith('.html') ? scanner.scanTemplate(full) : scanner.scanFile(full);
  } else {
    const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
    for (const f of tsFiles) scanner.scanFile(f);
  }
  return { content: [{ type: 'text', text: JSON.stringify({ summary: scanner.getSummary(), issues: scanner.getIssues().slice(0, 15) }, null, 2) }] };
}

function handleQualityGate(args) {
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const secScanner = new SecurityScanner(ROOT);
  for (const f of tsFiles) secScanner.scanFile(f);
  const smellDetector = new CodeSmellDetector(ROOT);
  for (const f of tsFiles) smellDetector.analyzeFile(f);
  const metrics = {
    vulnerabilities: secScanner.getIssues().length,
    code_smells: smellDetector.getIssues().length,
    technical_debt_minutes: smellDetector.getTechnicalDebt().totalMinutes,
    security_rating: secScanner.getSecurityRating(),
  };
  const gate = new QualityGate(args.relaxed ? RELAXED_GATE : undefined);
  return { content: [{ type: 'text', text: JSON.stringify(gate.evaluate(metrics), null, 2) }] };
}

function handleDependencies(args) {
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const graph = new DependencyGraph(ROOT);
  graph.build(tsFiles);
  if (args.filePath) {
    const adj = graph.getAdjacencyList();
    const relPath = args.filePath.replace(/\\/g, '/');
    return { content: [{ type: 'text', text: JSON.stringify({ file: relPath, imports: adj[relPath] || [] }, null, 2) }] };
  }
  return { content: [{ type: 'text', text: JSON.stringify({ stats: graph.getStats(), issues: graph.getIssues().slice(0, 10), mostCoupled: graph.getMostCoupled(5) }, null, 2) }] };
}

function handleCodeSmells(args) {
  const full = path.resolve(ROOT, args.filePath);
  const detector = new CodeSmellDetector(ROOT);
  const issues = detector.analyzeFile(full);
  return { content: [{ type: 'text', text: JSON.stringify({ file: args.filePath, smells: issues, debt: detector.getTechnicalDebt() }, null, 2) }] };
}

function handleTemplate(args) {
  const full = path.resolve(ROOT, args.filePath);
  const analyzer = new TemplateAnalyzer(ROOT);
  const issues = analyzer.analyzeFile(full);
  return { content: [{ type: 'text', text: JSON.stringify({ file: args.filePath, issues, metrics: analyzer.getMetrics() }, null, 2) }] };
}

function handleStyles(args) {
  const full = path.resolve(ROOT, args.filePath);
  const analyzer = new ScssAnalyzer(ROOT);
  const issues = analyzer.analyzeFile(full);
  return { content: [{ type: 'text', text: JSON.stringify({ file: args.filePath, issues, metrics: analyzer.getMetrics() }, null, 2) }] };
}

function handleAngularIssues(args) {
  const analyzer = new AngularPatternAnalyzer(ROOT);
  if (args.filePath) {
    const full = path.resolve(ROOT, args.filePath);
    args.filePath.endsWith('.html') ? analyzer.analyzeTemplate(full) : analyzer.analyzeFile(full);
  } else {
    const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
    for (const f of tsFiles) analyzer.analyzeFile(f);
  }
  let issues = analyzer.getIssues();
  if (args.category) issues = issues.filter(i => i.category === args.category);
  return { content: [{ type: 'text', text: JSON.stringify({ summary: analyzer.getSummary(), issues: issues.slice(0, 20) }, null, 2) }] };
}

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Parikrama Unified MCP Server v2.0 running (16 tools: 6 context + 10 analysis)');
}

main().catch(err => { console.error(`Failed: ${err.message}`); process.exit(1); });

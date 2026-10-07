#!/usr/bin/env node
/**
 * Parikrama Code Analyzer — MCP Server
 * 
 * Exposes all code analysis capabilities as MCP (Model Context Protocol) tools.
 * This allows AI agents (Kiro, Claude, etc.) to query symbols, run analysis,
 * and check quality gates programmatically.
 * 
 * Usage:
 *   node tools/code-analyzer/mcp-server.js
 * 
 * MCP Tools Exposed:
 *   - analyze_codebase       — Full or partial code analysis
 *   - query_symbols          — Search/find symbols by name, type, pattern
 *   - get_file_complexity    — Get complexity metrics for a file
 *   - check_security         — Run security scan
 *   - check_quality_gate     — Run quality gate
 *   - get_dependencies       — Get dependency info for a file
 *   - find_code_smells       — Find code smells in a file or directory
 *   - analyze_template       — Analyze an HTML template
 *   - analyze_styles         — Analyze SCSS/CSS file
 *   - get_angular_issues     — Get Angular pattern issues
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');
const fs = require('fs');

// ─── Core Imports ────────────────────────────────────────────────────────────

const { getSourceFiles, getStyleFiles, getTemplateFiles } = require('./src/ast-utils');
const { SymbolExtractor } = require('./src/symbol-extractor');
const { QueryEngine } = require('./src/query-engine');
const { analyzeFileComplexity } = require('./src/analyzers/complexity');
const { AngularPatternAnalyzer } = require('./src/analyzers/angular-patterns');
const { CodeSmellDetector } = require('./src/analyzers/code-smells');
const { SecurityScanner } = require('./src/analyzers/security');
const { ScssAnalyzer } = require('./src/analyzers/scss-analyzer');
const { TemplateAnalyzer } = require('./src/analyzers/template-analyzer');
const { DependencyGraph } = require('./src/analyzers/dependency-graph');
const { QualityGate, RELAXED_GATE } = require('./src/quality-gate');

// ─── Configuration ───────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(ROOT, 'src');
const { getAnalyzerRoots } = require('./src/analyzer-roots');
const ANALYZER_ROOTS = getAnalyzerRoots(ROOT);

// ─── Lazy-loaded cached state ────────────────────────────────────────────────

let queryEngine = null;
let lastIndexTime = 0;
const INDEX_TTL = 60000; // Re-index every 60 seconds

function getQueryEngine() {
  const now = Date.now();
  if (!queryEngine || now - lastIndexTime > INDEX_TTL) {
    queryEngine = new QueryEngine(ROOT);
    queryEngine.buildIndex(ANALYZER_ROOTS);
    lastIndexTime = now;
  }
  return queryEngine;
}

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

// ─── MCP Server Setup ────────────────────────────────────────────────────────

const server = new Server(
  { name: 'parikrama-code-analyzer', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ─── Tool Definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'query_symbols',
      description: 'Search for code symbols (classes, functions, services, components, interfaces) by name or type. Supports fuzzy matching.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Symbol name to search for (fuzzy match)' },
          type: { type: 'string', description: 'Filter by type: component, service, pipe, directive, module, guard, interface, enum, function, class, method', enum: ['component', 'service', 'pipe', 'directive', 'module', 'guard', 'interceptor', 'interface', 'enum', 'function', 'class', 'method'] },
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
          filePath: { type: 'string', description: 'Relative path to the file (from project root)' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'analyze_codebase',
      description: 'Run full or partial code analysis. Returns quality gate status, ratings, and top issues.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Analysis scope: full, security, angular, complexity, smells', enum: ['full', 'security', 'angular', 'complexity', 'smells'], default: 'full' },
          quick: { type: 'boolean', description: 'Skip dependency graph for faster results', default: true },
        },
      },
    },
    {
      name: 'check_security',
      description: 'Run security vulnerability scan. Returns CWE-tagged vulnerabilities and hotspots.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Optional: scan specific file only' },
        },
      },
    },
    {
      name: 'check_quality_gate',
      description: 'Run quality gate check with pass/fail result. Returns failed conditions and ratings.',
      inputSchema: {
        type: 'object',
        properties: {
          relaxed: { type: 'boolean', description: 'Use relaxed thresholds (for initial adoption)', default: false },
        },
      },
    },
    {
      name: 'get_dependencies',
      description: 'Get import/dependency information for a file or find circular dependencies.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'File to analyze dependencies for' },
          detectCircular: { type: 'boolean', description: 'Detect circular dependencies across codebase', default: false },
        },
      },
    },
    {
      name: 'find_code_smells',
      description: 'Find code smells in a file. Returns smell type, severity, and fix effort estimation.',
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
      description: 'Analyze an Angular HTML template for accessibility, performance, and best practice issues.',
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
      description: 'Analyze SCSS/CSS file for specificity, nesting, color consistency, and best practices.',
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
          filePath: { type: 'string', description: 'Optional: check specific file only' },
          category: { type: 'string', description: 'Filter by category: performance, reliability, security, modernization, code-smell', enum: ['performance', 'reliability', 'security', 'modernization', 'code-smell', 'best-practice'] },
        },
      },
    },
  ],
}));

// ─── Tool Handlers ───────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'query_symbols':
        return handleQuerySymbols(args);
      case 'get_file_complexity':
        return handleFileComplexity(args);
      case 'analyze_codebase':
        return handleAnalyze(args);
      case 'check_security':
        return handleSecurity(args);
      case 'check_quality_gate':
        return handleQualityGate(args);
      case 'get_dependencies':
        return handleDependencies(args);
      case 'find_code_smells':
        return handleCodeSmells(args);
      case 'analyze_template':
        return handleTemplate(args);
      case 'analyze_styles':
        return handleStyles(args);
      case 'get_angular_issues':
        return handleAngularIssues(args);
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
  }
});

// ─── Handler Implementations ─────────────────────────────────────────────────

function handleQuerySymbols(args) {
  const engine = getQueryEngine();
  let results;

  if (args.type) {
    results = engine.findByType(args.type);
    if (args.query) {
      results = results.filter(s => s.name.toLowerCase().includes(args.query.toLowerCase()));
    }
  } else {
    results = engine.search(args.query);
  }

  if (args.file) {
    results = results.filter(s => s.file.includes(args.file));
  }

  const limited = results.slice(0, 25);
  const text = limited.map(s => {
    let info = `[${s.type}] ${s.name} — ${s.file}:${s.line}`;
    if (s.metadata?.selector) info += `\n  selector: ${s.metadata.selector}`;
    if (s.extends) info += `\n  extends: ${s.extends}`;
    if (s.implements?.length) info += `\n  implements: ${s.implements.join(', ')}`;
    if (s.methods?.length) info += `\n  methods: ${s.methods.slice(0, 8).join(', ')}`;
    return info;
  }).join('\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${results.length} symbols${results.length > 25 ? ' (showing top 25)' : ''}:\n\n${text}`,
    }],
  };
}

function handleFileComplexity(args) {
  const filePath = path.resolve(ROOT, args.filePath);
  const result = analyzeFileComplexity(filePath);
  
  if (!result) {
    return { content: [{ type: 'text', text: `Could not analyze: ${args.filePath}` }] };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        file: args.filePath,
        cyclomaticComplexity: result.cyclomaticComplexity,
        cognitiveComplexity: result.cognitiveComplexity,
        maintainability: result.maintainability,
        loc: result.loc,
        methods: result.methods,
        issues: result.issues,
      }, null, 2),
    }],
  };
}

function handleAnalyze(args) {
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const htmlFiles = getTemplateFiles(SRC_DIR);
  const scssFiles = getStyleFiles(SRC_DIR);

  const results = { filesAnalyzed: tsFiles.length + htmlFiles.length + scssFiles.length };

  // Security
  const secScanner = new SecurityScanner(ROOT);
  for (const f of tsFiles) secScanner.scanFile(f);
  results.security = secScanner.getSummary();

  // Smells
  const smellDetector = new CodeSmellDetector(ROOT);
  for (const f of tsFiles) smellDetector.analyzeFile(f);
  results.codeSmells = smellDetector.getSummary();

  // Angular
  const angularAnalyzer = new AngularPatternAnalyzer(ROOT);
  for (const f of tsFiles) angularAnalyzer.analyzeFile(f);
  for (const f of htmlFiles) angularAnalyzer.analyzeTemplate(f);
  results.angular = angularAnalyzer.getSummary();

  // Quality gate
  const metrics = {
    bugs: angularAnalyzer.getIssues().filter(i => i.category === 'reliability').length,
    vulnerabilities: secScanner.getIssues().length,
    code_smells: smellDetector.getIssues().length,
    security_rating: secScanner.getSecurityRating(),
  };
  const gate = new QualityGate(args.relaxed ? RELAXED_GATE : undefined);
  results.qualityGate = gate.evaluate(metrics).status;

  return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
}

function handleSecurity(args) {
  const scanner = new SecurityScanner(ROOT);
  
  if (args.filePath) {
    const fullPath = path.resolve(ROOT, args.filePath);
    if (args.filePath.endsWith('.html')) {
      scanner.scanTemplate(fullPath);
    } else {
      scanner.scanFile(fullPath);
    }
  } else {
    const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
    const htmlFiles = getTemplateFiles(SRC_DIR);
    for (const f of tsFiles) scanner.scanFile(f);
    for (const f of htmlFiles) scanner.scanTemplate(f);
  }

  const issues = [...scanner.getIssues(), ...scanner.getHotspots()];
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        summary: scanner.getSummary(),
        issues: issues.slice(0, 20),
      }, null, 2),
    }],
  };
}

function handleQualityGate(args) {
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const htmlFiles = getTemplateFiles(SRC_DIR);

  const secScanner = new SecurityScanner(ROOT);
  for (const f of tsFiles) secScanner.scanFile(f);

  const smellDetector = new CodeSmellDetector(ROOT);
  for (const f of tsFiles) smellDetector.analyzeFile(f);

  const angularAnalyzer = new AngularPatternAnalyzer(ROOT);
  for (const f of tsFiles) angularAnalyzer.analyzeFile(f);

  const metrics = {
    bugs: angularAnalyzer.getIssues().filter(i => i.category === 'reliability').length,
    vulnerabilities: secScanner.getIssues().length,
    security_hotspots: secScanner.getHotspots().length,
    code_smells: smellDetector.getIssues().length,
    technical_debt_minutes: smellDetector.getTechnicalDebt().totalMinutes,
    security_rating: secScanner.getSecurityRating(),
    reliability_rating: 'B',
    maintainability_rating: 'C',
  };

  const gate = new QualityGate(args.relaxed ? RELAXED_GATE : undefined);
  const result = gate.evaluate(metrics);

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function handleDependencies(args) {
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const graph = new DependencyGraph(ROOT);
  graph.build(tsFiles);

  if (args.filePath) {
    const relPath = args.filePath.replace(/\\/g, '/');
    const adj = graph.getAdjacencyList();
    const deps = adj[relPath] || [];
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ file: relPath, imports: deps, importCount: deps.length }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        stats: graph.getStats(),
        mostCoupled: graph.getMostCoupled(10),
        issues: graph.getIssues().slice(0, 15),
      }, null, 2),
    }],
  };
}

function handleCodeSmells(args) {
  const fullPath = path.resolve(ROOT, args.filePath);
  const detector = new CodeSmellDetector(ROOT);
  const issues = detector.analyzeFile(fullPath);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        file: args.filePath,
        smells: issues,
        technicalDebt: detector.getTechnicalDebt(),
      }, null, 2),
    }],
  };
}

function handleTemplate(args) {
  const fullPath = path.resolve(ROOT, args.filePath);
  const analyzer = new TemplateAnalyzer(ROOT);
  const issues = analyzer.analyzeFile(fullPath);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        file: args.filePath,
        issues,
        metrics: analyzer.getMetrics(),
      }, null, 2),
    }],
  };
}

function handleStyles(args) {
  const fullPath = path.resolve(ROOT, args.filePath);
  const analyzer = new ScssAnalyzer(ROOT);
  const issues = analyzer.analyzeFile(fullPath);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        file: args.filePath,
        issues,
        metrics: analyzer.getMetrics(),
      }, null, 2),
    }],
  };
}

function handleAngularIssues(args) {
  const analyzer = new AngularPatternAnalyzer(ROOT);

  if (args.filePath) {
    const fullPath = path.resolve(ROOT, args.filePath);
    if (args.filePath.endsWith('.html')) {
      analyzer.analyzeTemplate(fullPath);
    } else {
      analyzer.analyzeFile(fullPath);
    }
  } else {
    const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
    const htmlFiles = getTemplateFiles(SRC_DIR);
    for (const f of tsFiles) analyzer.analyzeFile(f);
    for (const f of htmlFiles) analyzer.analyzeTemplate(f);
  }

  let issues = analyzer.getIssues();
  if (args.category) {
    issues = issues.filter(i => i.category === args.category);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        summary: analyzer.getSummary(),
        issues: issues.slice(0, 30),
      }, null, 2),
    }],
  };
}

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Parikrama Code Analyzer MCP Server running on stdio');
}

main().catch(err => {
  console.error(`Failed to start MCP server: ${err.message}`);
  process.exit(1);
});

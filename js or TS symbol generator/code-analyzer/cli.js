#!/usr/bin/env node
/**
 * Parikrama Code Analyzer CLI
 * 
 * A comprehensive code analysis tool inspired by SonarQube Community Edition,
 * tailored for Angular/TypeScript/SCSS/HTML projects.
 * 
 * Usage:
 *   node tools/code-analyzer/cli.js analyze          Full analysis
 *   node tools/code-analyzer/cli.js analyze --quick  Quick scan (skip deps)
 *   node tools/code-analyzer/cli.js symbols          List all symbols
 *   node tools/code-analyzer/cli.js query <name>     Search for a symbol
 *   node tools/code-analyzer/cli.js query --type component
 *   node tools/code-analyzer/cli.js report           Generate report
 *   node tools/code-analyzer/cli.js gate             Run quality gate
 *   node tools/code-analyzer/cli.js gate --relaxed   Use relaxed gate
 *   node tools/code-analyzer/cli.js security         Security scan only
 *   node tools/code-analyzer/cli.js complexity       Complexity analysis
 *   node tools/code-analyzer/cli.js angular          Angular pattern check
 *   node tools/code-analyzer/cli.js css              CSS/SCSS analysis
 *   node tools/code-analyzer/cli.js templates        Template analysis
 *   node tools/code-analyzer/cli.js deps             Dependency graph
 *   node tools/code-analyzer/cli.js smells           Code smell detection
 */

const path = require('path');
const fs = require('fs');

// ─── Resolve project root ────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(ROOT, 'src');

// ─── Imports ─────────────────────────────────────────────────────────────────

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
const { Reporter } = require('./src/reporter');

// ─── Colors ──────────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

function log(color, icon, msg) { console.log(`  ${color}${icon}${c.reset} ${msg}`); }

// ─── Commands ────────────────────────────────────────────────────────────────

const COMMANDS = {
  analyze: runFullAnalysis,
  symbols: runSymbols,
  query: runQuery,
  report: runReport,
  gate: runQualityGate,
  security: runSecurity,
  complexity: runComplexity,
  angular: runAngularPatterns,
  css: runCssAnalysis,
  templates: runTemplateAnalysis,
  deps: runDependencyAnalysis,
  smells: runCodeSmells,
  help: showHelp,
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const flags = args.slice(1);
  
  if (COMMANDS[command]) {
    await COMMANDS[command](flags);
  } else {
    // Treat as query
    await runQuery([command, ...flags]);
  }
}

// ─── Full Analysis ───────────────────────────────────────────────────────────

async function runFullAnalysis(flags) {
  const startTime = Date.now();
  const isQuick = flags.includes('--quick');
  const isVerbose = flags.includes('--verbose');
  
  printBanner('Full Code Analysis');
  
  log(c.blue, '◈', 'Scanning source files...');
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const htmlFiles = getTemplateFiles(SRC_DIR);
  const scssFiles = getStyleFiles(SRC_DIR);
  
  log(c.green, '✓', `Found ${tsFiles.length} TS, ${htmlFiles.length} HTML, ${scssFiles.length} SCSS files`);
  
  // 1. Symbol extraction
  log(c.blue, '◈', 'Extracting symbols...');
  const extractor = new SymbolExtractor(ROOT);
  for (const file of tsFiles) {
    extractor.extractFromFile(file);
  }
  const symbolDb = extractor.getDatabase();
  const symbolStats = symbolDb.getStats();
  log(c.green, '✓', `Extracted ${symbolStats.totalSymbols} symbols`);
  
  // 2. Complexity analysis
  log(c.blue, '◈', 'Analyzing complexity...');
  let maxCyclomatic = 0, maxCognitive = 0, totalMI = 0, miCount = 0;
  const complexityIssues = [];
  
  for (const file of tsFiles) {
    const result = analyzeFileComplexity(file);
    if (result) {
      if (result.cyclomaticComplexity > maxCyclomatic) maxCyclomatic = result.cyclomaticComplexity;
      if (result.cognitiveComplexity > maxCognitive) maxCognitive = result.cognitiveComplexity;
      totalMI += result.maintainability.index;
      miCount++;
      complexityIssues.push(...result.issues);
    }
  }
  log(c.green, '✓', `Max cyclomatic: ${maxCyclomatic}, Max cognitive: ${maxCognitive}`);
  
  // 3. Angular patterns
  log(c.blue, '◈', 'Checking Angular patterns...');
  const angularAnalyzer = new AngularPatternAnalyzer(ROOT);
  for (const file of tsFiles) { angularAnalyzer.analyzeFile(file); }
  for (const file of htmlFiles) { angularAnalyzer.analyzeTemplate(file); }
  const angularIssues = angularAnalyzer.getIssues();
  log(c.green, '✓', `${angularIssues.length} Angular pattern issues`);
  
  // 4. Code smells
  log(c.blue, '◈', 'Detecting code smells...');
  const smellDetector = new CodeSmellDetector(ROOT);
  for (const file of tsFiles) { smellDetector.analyzeFile(file); }
  const smellIssues = smellDetector.getIssues();
  log(c.green, '✓', `${smellIssues.length} code smells found`);
  
  // 5. Security scan
  log(c.blue, '◈', 'Scanning for security issues...');
  const secScanner = new SecurityScanner(ROOT);
  for (const file of tsFiles) { secScanner.scanFile(file); }
  for (const file of htmlFiles) { secScanner.scanTemplate(file); }
  const secIssues = secScanner.getIssues();
  const secHotspots = secScanner.getHotspots();
  log(c.green, '✓', `${secIssues.length} vulnerabilities, ${secHotspots.length} hotspots`);
  
  // 6. CSS/SCSS analysis
  log(c.blue, '◈', 'Analyzing stylesheets...');
  const cssAnalyzer = new ScssAnalyzer(ROOT);
  for (const file of scssFiles) { cssAnalyzer.analyzeFile(file); }
  const cssIssues = cssAnalyzer.getIssues();
  log(c.green, '✓', `${cssIssues.length} style issues`);
  
  // 7. Template analysis
  log(c.blue, '◈', 'Analyzing templates...');
  const tmplAnalyzer = new TemplateAnalyzer(ROOT);
  for (const file of htmlFiles) { tmplAnalyzer.analyzeFile(file); }
  const tmplIssues = tmplAnalyzer.getIssues();
  log(c.green, '✓', `${tmplIssues.length} template issues`);
  
  // 8. Dependency graph (skip in quick mode)
  let depIssues = [];
  if (!isQuick) {
    log(c.blue, '◈', 'Building dependency graph...');
    const depGraph = new DependencyGraph(ROOT);
    depGraph.build(tsFiles);
    depIssues = depGraph.getIssues();
    log(c.green, '✓', `${depIssues.length} dependency issues`);
  }
  
  const duration = Date.now() - startTime;
  
  // Aggregate all issues
  const allIssues = [
    ...complexityIssues,
    ...angularIssues,
    ...smellIssues,
    ...secIssues,
    ...secHotspots,
    ...cssIssues,
    ...tmplIssues,
    ...depIssues,
  ];
  
  // Calculate ratings
  const securityRating = secScanner.getSecurityRating();
  const avgMI = miCount > 0 ? Math.round(totalMI / miCount) : 0;
  const maintainabilityRating = avgMI >= 80 ? 'A' : avgMI >= 60 ? 'B' : avgMI >= 40 ? 'C' : avgMI >= 20 ? 'D' : 'E';
  const reliabilityRating = angularIssues.filter(i => i.severity === 'critical').length > 0 ? 'C' :
                            angularIssues.filter(i => i.severity === 'major').length > 3 ? 'B' : 'A';
  
  // Build metrics for quality gate
  const metrics = {
    bugs: angularIssues.filter(i => i.category === 'reliability').length,
    vulnerabilities: secIssues.length,
    security_hotspots: secHotspots.length,
    code_smells: smellIssues.length,
    technical_debt_minutes: smellDetector.getTechnicalDebt().totalMinutes,
    max_cyclomatic_complexity: maxCyclomatic,
    max_cognitive_complexity: maxCognitive,
    max_file_lines: 0, // TODO: calculate
    duplicate_blocks: 0, // TODO: calculate
    reliability_rating: reliabilityRating,
    security_rating: securityRating,
    maintainability_rating: maintainabilityRating,
  };
  
  // Run quality gate
  const gate = new QualityGate();
  const gateResult = gate.evaluate(metrics);
  
  // Build results
  const results = {
    filesAnalyzed: tsFiles.length + htmlFiles.length + scssFiles.length,
    totalLines: 0,
    tsFiles: tsFiles.length,
    htmlFiles: htmlFiles.length,
    scssFiles: scssFiles.length,
    duration,
    qualityGate: gateResult,
    reliabilityRating,
    securityRating,
    maintainabilityRating,
    allIssues,
    technicalDebt: smellDetector.getTechnicalDebt().formatted,
    symbols: symbolStats,
    complexity: { maxCyclomatic, maxCognitive, avgMaintainability: avgMI },
    metrics,
  };
  
  // Report
  const reporter = new Reporter();
  
  if (isVerbose) {
    reporter.printConsoleReport(results);
  } else {
    reporter.printConsoleReport(results);
  }
  
  // Save JSON report
  const reportPath = reporter.saveJsonReport(results);
  log(c.cyan, 'ℹ', `JSON report: ${path.relative(ROOT, reportPath)}`);
  console.log('');
  
  // Exit code based on gate
  if (gateResult.status === 'FAILED') {
    process.exitCode = 1;
  }
}

// ─── Symbol Commands ─────────────────────────────────────────────────────────

async function runSymbols(flags) {
  printBanner('Symbol Extraction');
  
  const queryEngine = new QueryEngine(ROOT);
  const stats = queryEngine.buildIndex(SRC_DIR);
  
  log(c.green, '✓', `Indexed ${stats.totalSymbols} symbols across ${stats.files} files`);
  console.log('');
  console.log(`  ${c.bold}Symbols by Type:${c.reset}`);
  
  for (const [type, count] of Object.entries(stats.byType)) {
    if (type !== 'import' && type !== 'export') {
      console.log(`    ${type.padEnd(15)} ${c.cyan}${count}${c.reset}`);
    }
  }
  
  // Show specific type if requested
  const typeFlag = flags.find(f => f.startsWith('--type='));
  if (typeFlag) {
    const type = typeFlag.split('=')[1];
    const symbols = queryEngine.findByType(type);
    console.log(`\n  ${c.bold}${type} symbols:${c.reset}`);
    for (const s of symbols.slice(0, 30)) {
      console.log(`    ${c.cyan}${s.name}${c.reset} ${c.dim}(${s.file}:${s.line})${c.reset}`);
    }
    if (symbols.length > 30) {
      console.log(`    ${c.dim}... and ${symbols.length - 30} more${c.reset}`);
    }
  }
  
  console.log('');
  
  // Save to JSON if requested
  if (flags.includes('--json')) {
    const output = queryEngine.exportToJson();
    const outputPath = path.join(__dirname, 'reports', 'symbols.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    log(c.cyan, 'ℹ', `Symbols exported to: ${path.relative(ROOT, outputPath)}`);
  }
}

async function runQuery(flags) {
  const query = flags[0];
  if (!query || query.startsWith('--')) {
    console.log(`\n  Usage: node tools/code-analyzer/cli.js query <name>`);
    console.log(`  Flags: --type=<type>, --file=<pattern>, --json\n`);
    return;
  }
  
  printBanner(`Symbol Query: "${query}"`);
  
  const queryEngine = new QueryEngine(ROOT);
  queryEngine.buildIndex(SRC_DIR);
  
  // Parse filter flags
  const typeFlag = flags.find(f => f.startsWith('--type='));
  const fileFlag = flags.find(f => f.startsWith('--file='));
  
  let results;
  
  if (typeFlag) {
    const type = typeFlag.split('=')[1];
    results = queryEngine.findByType(type).filter(s => s.name.toLowerCase().includes(query.toLowerCase()));
  } else {
    results = queryEngine.search(query);
  }
  
  if (fileFlag) {
    const pattern = fileFlag.split('=')[1];
    results = results.filter(s => s.file.includes(pattern));
  }
  
  if (results.length === 0) {
    log(c.yellow, '⚠', `No symbols found matching "${query}"`);
  } else {
    console.log(`  Found ${c.bold}${results.length}${c.reset} results:\n`);
    
    for (const s of results.slice(0, 20)) {
      const typeLabel = `[${s.type}]`.padEnd(14);
      console.log(`  ${c.cyan}${typeLabel}${c.reset} ${c.bold}${s.name}${c.reset}`);
      console.log(`  ${' '.repeat(14)} ${c.dim}${s.file}:${s.line}${c.reset}`);
      
      if (s.extends) console.log(`  ${' '.repeat(14)} extends: ${s.extends}`);
      if (s.implements?.length) console.log(`  ${' '.repeat(14)} implements: ${s.implements.join(', ')}`);
      if (s.metadata?.selector) console.log(`  ${' '.repeat(14)} selector: ${s.metadata.selector}`);
      if (s.methods?.length) console.log(`  ${' '.repeat(14)} methods: ${s.methods.slice(0, 5).join(', ')}${s.methods.length > 5 ? '...' : ''}`);
      console.log('');
    }
    
    if (results.length > 20) {
      log(c.dim, '...', `${results.length - 20} more results (use --json to export all)`);
    }
  }
  
  if (flags.includes('--json')) {
    const outputPath = path.join(__dirname, 'reports', `query-${query}.json`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    log(c.cyan, 'ℹ', `Results exported to: ${path.relative(ROOT, outputPath)}`);
  }
}

// ─── Individual Analyzers ────────────────────────────────────────────────────

async function runSecurity(flags) {
  printBanner('Security Scan');
  
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const htmlFiles = getTemplateFiles(SRC_DIR);
  
  const scanner = new SecurityScanner(ROOT);
  for (const file of tsFiles) { scanner.scanFile(file); }
  for (const file of htmlFiles) { scanner.scanTemplate(file); }
  
  const summary = scanner.getSummary();
  console.log(`  ${c.bold}Security Rating: ${RATING_COLORS[summary.rating]}${summary.rating}${c.reset}`);
  console.log(`  Vulnerabilities: ${c.red}${summary.vulnerabilities}${c.reset}`);
  console.log(`  Hotspots: ${c.yellow}${summary.hotspots}${c.reset}`);
  console.log('');
  
  const issues = [...scanner.getIssues(), ...scanner.getHotspots()];
  for (const issue of issues.slice(0, 15)) {
    const color = SEVERITY_COLORS[issue.severity] || c.dim;
    console.log(`  ${color}[${issue.severity}]${c.reset} ${issue.title}`);
    console.log(`  ${c.dim}  ${issue.file}:${issue.line}${c.reset}`);
    if (issue.cwe) console.log(`  ${c.dim}  ${issue.cwe}${c.reset}`);
    console.log('');
  }
}

async function runComplexity(flags) {
  printBanner('Complexity Analysis');
  
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const results = [];
  
  for (const file of tsFiles) {
    const result = analyzeFileComplexity(file);
    if (result) results.push(result);
  }
  
  // Sort by complexity
  results.sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity);
  
  console.log(`  ${c.bold}Top 15 Most Complex Files:${c.reset}\n`);
  for (const r of results.slice(0, 15)) {
    const relPath = path.relative(ROOT, r.file).replace(/\\/g, '/');
    const miColor = r.maintainability.rating === 'A' ? c.green : r.maintainability.rating === 'B' ? c.green : c.yellow;
    console.log(`  CC:${c.yellow}${String(r.cyclomaticComplexity).padStart(3)}${c.reset}  Cog:${c.yellow}${String(r.cognitiveComplexity).padStart(3)}${c.reset}  MI:${miColor}${r.maintainability.rating}${c.reset}  ${c.dim}${relPath}${c.reset}`);
  }
  console.log('');
}

async function runAngularPatterns(flags) {
  printBanner('Angular Pattern Analysis');
  
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const htmlFiles = getTemplateFiles(SRC_DIR);
  
  const analyzer = new AngularPatternAnalyzer(ROOT);
  for (const file of tsFiles) { analyzer.analyzeFile(file); }
  for (const file of htmlFiles) { analyzer.analyzeTemplate(file); }
  
  const summary = analyzer.getSummary();
  console.log(`  Total issues: ${c.bold}${summary.total}${c.reset}`);
  console.log('');
  
  if (summary.byCategory) {
    console.log(`  ${c.bold}By Category:${c.reset}`);
    for (const [cat, count] of Object.entries(summary.byCategory)) {
      console.log(`    ${cat.padEnd(20)} ${count}`);
    }
  }
  console.log('');
  
  const issues = analyzer.getIssues();
  for (const issue of issues.slice(0, 20)) {
    const color = SEVERITY_COLORS[issue.severity] || c.dim;
    console.log(`  ${color}[${issue.severity}]${c.reset} ${issue.title}`);
    console.log(`  ${c.dim}  ${issue.file}:${issue.line}${c.reset}`);
    console.log('');
  }
}

async function runCssAnalysis(flags) {
  printBanner('CSS/SCSS Analysis');
  
  const scssFiles = getStyleFiles(SRC_DIR);
  const analyzer = new ScssAnalyzer(ROOT);
  for (const file of scssFiles) { analyzer.analyzeFile(file); }
  
  const metrics = analyzer.getMetrics();
  console.log(`  ${c.bold}Style Metrics:${c.reset}`);
  console.log(`    Files:           ${metrics.totalFiles}`);
  console.log(`    Total lines:     ${metrics.totalLines}`);
  console.log(`    Selectors:       ${metrics.totalSelectors}`);
  console.log(`    !important:      ${c.yellow}${metrics.importantCount}${c.reset}`);
  console.log(`    Max nesting:     ${metrics.maxNesting}`);
  console.log(`    Unique colors:   ${metrics.uniqueColors}`);
  if (metrics.zIndexRange) {
    console.log(`    Z-index range:   ${metrics.zIndexRange.min} — ${metrics.zIndexRange.max} (${metrics.zIndexRange.count} usages)`);
  }
  console.log('');
  
  const issues = analyzer.getIssues();
  for (const issue of issues.slice(0, 15)) {
    const color = SEVERITY_COLORS[issue.severity] || c.dim;
    console.log(`  ${color}[${issue.severity}]${c.reset} ${issue.title}`);
    console.log(`  ${c.dim}  ${issue.file}:${issue.line}${c.reset}`);
    console.log('');
  }
}

async function runTemplateAnalysis(flags) {
  printBanner('Template Analysis');
  
  const htmlFiles = getTemplateFiles(SRC_DIR);
  const analyzer = new TemplateAnalyzer(ROOT);
  for (const file of htmlFiles) { analyzer.analyzeFile(file); }
  
  const metrics = analyzer.getMetrics();
  const summary = analyzer.getSummary();
  
  console.log(`  ${c.bold}Template Metrics:${c.reset}`);
  console.log(`    Templates:       ${metrics.totalTemplates}`);
  console.log(`    Total lines:     ${metrics.totalLines}`);
  console.log(`    Bindings:        ${metrics.totalBindings}`);
  console.log(`    Directives:      ${metrics.totalDirectives}`);
  console.log(`    A11y issues:     ${c.yellow}${metrics.a11yIssues}${c.reset}`);
  console.log('');
  
  const issues = analyzer.getIssues();
  for (const issue of issues.slice(0, 15)) {
    const color = SEVERITY_COLORS[issue.severity] || c.dim;
    console.log(`  ${color}[${issue.severity}]${c.reset} ${issue.title}`);
    console.log(`  ${c.dim}  ${issue.file}:${issue.line}${c.reset}`);
    console.log('');
  }
}

async function runDependencyAnalysis(flags) {
  printBanner('Dependency Graph Analysis');
  
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  
  const graph = new DependencyGraph(ROOT);
  graph.build(tsFiles);
  
  const stats = graph.getStats();
  const summary = graph.getSummary();
  
  console.log(`  ${c.bold}Dependency Stats:${c.reset}`);
  console.log(`    Files:           ${stats.totalFiles}`);
  console.log(`    Dependencies:    ${stats.totalEdges}`);
  console.log(`    Avg imports:     ${stats.averageImports.toFixed(1)}`);
  console.log('');
  
  console.log(`  ${c.bold}File Types:${c.reset}`);
  for (const [type, count] of Object.entries(stats.fileTypes)) {
    console.log(`    ${type.padEnd(15)} ${count}`);
  }
  console.log('');
  
  console.log(`  ${c.bold}Most Coupled:${c.reset}`);
  for (const item of summary.mostCoupled) {
    console.log(`    ${c.cyan}${item.connections}${c.reset} connections — ${c.dim}${item.file}${c.reset}`);
  }
  console.log('');
  
  const issues = graph.getIssues();
  if (issues.length > 0) {
    console.log(`  ${c.bold}Issues (${issues.length}):${c.reset}`);
    for (const issue of issues.slice(0, 10)) {
      const color = SEVERITY_COLORS[issue.severity] || c.dim;
      console.log(`  ${color}[${issue.severity}]${c.reset} ${issue.title}`);
      if (issue.description) console.log(`  ${c.dim}  ${issue.description.substring(0, 80)}${c.reset}`);
      console.log('');
    }
  }
}

async function runCodeSmells(flags) {
  printBanner('Code Smell Detection');
  
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const detector = new CodeSmellDetector(ROOT);
  for (const file of tsFiles) { detector.analyzeFile(file); }
  
  const summary = detector.getSummary();
  console.log(`  Total smells: ${c.bold}${summary.total}${c.reset}`);
  console.log(`  Technical debt: ${c.yellow}${summary.technicalDebt.formatted}${c.reset}`);
  console.log('');
  
  if (summary.bySeverity) {
    console.log(`  ${c.bold}By Severity:${c.reset}`);
    for (const [sev, count] of Object.entries(summary.bySeverity)) {
      const color = SEVERITY_COLORS[sev] || c.dim;
      console.log(`    ${color}${sev.padEnd(12)}${c.reset} ${count}`);
    }
  }
  console.log('');
  
  if (summary.byCategory) {
    console.log(`  ${c.bold}By Category:${c.reset}`);
    for (const [cat, count] of Object.entries(summary.byCategory)) {
      console.log(`    ${cat.padEnd(20)} ${count}`);
    }
  }
  console.log('');
  
  const issues = detector.getIssues();
  for (const issue of issues.slice(0, 15)) {
    const color = SEVERITY_COLORS[issue.severity] || c.dim;
    console.log(`  ${color}[${issue.severity}]${c.reset} ${issue.title}`);
    console.log(`  ${c.dim}  ${issue.file}:${issue.line}${c.reset}`);
    console.log('');
  }
}

async function runQualityGate(flags) {
  printBanner('Quality Gate Check');
  
  const isRelaxed = flags.includes('--relaxed');
  
  // Quick analysis to get metrics
  const tsFiles = getSourceFiles(SRC_DIR, ['.ts']).filter(f => !f.includes('.spec.'));
  const htmlFiles = getTemplateFiles(SRC_DIR);
  
  // Security
  const secScanner = new SecurityScanner(ROOT);
  for (const file of tsFiles) { secScanner.scanFile(file); }
  
  // Smells
  const smellDetector = new CodeSmellDetector(ROOT);
  for (const file of tsFiles) { smellDetector.analyzeFile(file); }
  
  // Angular
  const angularAnalyzer = new AngularPatternAnalyzer(ROOT);
  for (const file of tsFiles) { angularAnalyzer.analyzeFile(file); }
  
  // Complexity
  let maxCyclomatic = 0, maxCognitive = 0;
  for (const file of tsFiles) {
    const result = analyzeFileComplexity(file);
    if (result) {
      if (result.cyclomaticComplexity > maxCyclomatic) maxCyclomatic = result.cyclomaticComplexity;
      if (result.cognitiveComplexity > maxCognitive) maxCognitive = result.cognitiveComplexity;
    }
  }
  
  const metrics = {
    bugs: angularAnalyzer.getIssues().filter(i => i.category === 'reliability').length,
    vulnerabilities: secScanner.getIssues().length,
    security_hotspots: secScanner.getHotspots().length,
    code_smells: smellDetector.getIssues().length,
    technical_debt_minutes: smellDetector.getTechnicalDebt().totalMinutes,
    max_cyclomatic_complexity: maxCyclomatic,
    max_cognitive_complexity: maxCognitive,
    reliability_rating: 'A',
    security_rating: secScanner.getSecurityRating(),
    maintainability_rating: 'B',
  };
  
  const gate = new QualityGate(isRelaxed ? RELAXED_GATE : undefined);
  const result = gate.evaluate(metrics);
  
  const reporter = new Reporter();
  reporter._printQualityGate(result);
  
  console.log(`\n  ${c.bold}Metrics Used:${c.reset}`);
  for (const [key, value] of Object.entries(metrics)) {
    console.log(`    ${key.padEnd(30)} ${value}`);
  }
  console.log('');
  
  if (result.status === 'FAILED') process.exitCode = 1;
}

async function runReport(flags) {
  // Just run full analysis with report output
  await runFullAnalysis(['--verbose', ...flags]);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RATING_COLORS = { A: c.green, B: c.green, C: c.yellow, D: c.red, E: c.red };
const SEVERITY_COLORS = { blocker: c.red, critical: c.red, major: c.yellow, minor: c.cyan, info: c.dim };

function printBanner(title) {
  console.log('');
  console.log(`${c.magenta}${c.bold}  ┌─────────────────────────────────────────────────────────┐${c.reset}`);
  console.log(`${c.magenta}${c.bold}  │  🕉️  Parikrama Code Analyzer — ${title.padEnd(25)}│${c.reset}`);
  console.log(`${c.magenta}${c.bold}  └─────────────────────────────────────────────────────────┘${c.reset}`);
  console.log('');
}

function showHelp() {
  console.log(`
${c.magenta}${c.bold}  Parikrama Code Analyzer${c.reset} — SonarQube-style analysis for Angular

  ${c.bold}COMMANDS:${c.reset}

    ${c.cyan}analyze${c.reset}              Full analysis (all checks)
    ${c.cyan}analyze --quick${c.reset}      Quick scan (skip dependency graph)
    ${c.cyan}analyze --verbose${c.reset}    Detailed output
    
    ${c.cyan}symbols${c.reset}              Extract & list all code symbols
    ${c.cyan}symbols --type=component${c.reset}  List by type
    ${c.cyan}symbols --json${c.reset}       Export symbols to JSON

    ${c.cyan}query <name>${c.reset}         Search for a symbol by name
    ${c.cyan}query --type=service <name>${c.reset}  Filter by type
    
    ${c.cyan}gate${c.reset}                 Run quality gate check
    ${c.cyan}gate --relaxed${c.reset}       Use relaxed thresholds
    
    ${c.cyan}security${c.reset}             Security vulnerability scan
    ${c.cyan}complexity${c.reset}           Complexity metrics
    ${c.cyan}angular${c.reset}              Angular pattern analysis
    ${c.cyan}css${c.reset}                  SCSS/CSS analysis
    ${c.cyan}templates${c.reset}            Template analysis
    ${c.cyan}deps${c.reset}                 Dependency graph
    ${c.cyan}smells${c.reset}               Code smell detection
    ${c.cyan}report${c.reset}               Full report (JSON + console)

  ${c.bold}EXAMPLES:${c.reset}

    node tools/code-analyzer/cli.js analyze
    node tools/code-analyzer/cli.js query DeviceComponent
    node tools/code-analyzer/cli.js symbols --type=service --json
    node tools/code-analyzer/cli.js gate --relaxed
    node tools/code-analyzer/cli.js security

  ${c.bold}SYMBOL TYPES:${c.reset}
    component, service, pipe, directive, module, guard,
    interceptor, resolver, interface, enum, function, class, method
`);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(`${c.red}Error: ${err.message}${c.reset}`);
  console.error(err.stack);
  process.exit(1);
});

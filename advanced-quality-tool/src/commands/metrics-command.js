'use strict';

const fs = require('fs');
const path = require('path');
const { ComplexityCalculator } = require('../metrics/complexity-calculator');

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

function collectSourceFiles(root) {
  const files = [];
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !ignored.has(entry.name)) visit(path.join(directory, entry.name));
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(path.join(directory, entry.name));
      }
    }
  };
  visit(root);
  return files;
}

function parseOptions(args) {
  const options = { files: [], format: 'table', threshold: 10, workspace: process.cwd() };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--files' || arg === '-f') {
      options.files = args[++i].split(',').map(file => file.trim()).filter(Boolean);
    } else if (arg === '--format') options.format = args[++i];
    else if (arg === '--threshold') options.threshold = Number(args[++i]);
    else if (arg === '--workspace' || arg === '-w') options.workspace = args[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown metrics option: ${arg}`);
  }
  if (!['table', 'json', 'markdown'].includes(options.format)) {
    throw new Error(`Unsupported metrics format: ${options.format}`);
  }
  if (!Number.isFinite(options.threshold) || options.threshold < 1) {
    throw new Error('--threshold must be a positive number');
  }
  return options;
}

function renderMarkdown(report) {
  const lines = [
    '# Code Metrics',
    '',
    `Files analyzed: ${report.summary.filesScanned}`,
    `Functions analyzed: ${report.summary.functionsAnalyzed}`,
    `Complexity threshold: ${report.threshold}`,
    '',
    '| File | LOC | SLOC | Maintainability | Complex functions |',
    '|---|---:|---:|---:|---:|'
  ];
  for (const file of report.files) {
    if (file.error) {
      lines.push(`| ${file.filePath} | — | — | — | Error: ${file.error} |`);
      continue;
    }
    lines.push(`| ${file.filePath} | ${file.metrics.loc} | ${file.metrics.sloc} | ${file.metrics.maintainabilityIndex} | ${file.complexFunctions} |`);
  }
  return lines.join('\n');
}

async function run(args) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('Usage: aqt metrics [--workspace dir] [--files file1,file2] [--format table|json|markdown] [--threshold n]');
    return 0;
  }

  const workspace = path.resolve(options.workspace);
  const inputFiles = options.files.length
    ? options.files.map(file => path.resolve(workspace, file))
    : collectSourceFiles(workspace);
  if (inputFiles.length === 0) throw new Error(`No supported source files found in ${workspace}`);
  for (const file of inputFiles) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Source file not found: ${file}`);
    if (!SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      throw new Error(`Unsupported metrics source type: ${file}`);
    }
  }

  const calculator = new ComplexityCalculator({
    thresholds: { cyclomatic: options.threshold }
  });
  const analyzed = await calculator.analyzeFiles(inputFiles);
  const report = calculator.generateReport(analyzed);
  report.threshold = options.threshold;
  report.files = report.files.map(file => ({
    ...file,
    complexFunctions: file.functionCount === undefined
      ? 0
      : analyzed.find(result => result.filePath === file.filePath)?.functionMetrics
        .filter(fn => fn.cyclomaticComplexity >= options.threshold).length || 0
  }));

  if (options.format === 'json') console.log(JSON.stringify(report, null, 2));
  else if (options.format === 'markdown') console.log(renderMarkdown(report));
  else {
    console.log(`\nMetrics for ${workspace}`);
    console.log(`Files: ${report.summary.filesScanned} | Functions: ${report.summary.functionsAnalyzed} | Issues: ${report.summary.issuesFound}`);
    for (const file of report.files) {
      if (file.error) console.log(`ERROR ${path.relative(workspace, file.filePath)}: ${file.error}`);
      else console.log(`${path.relative(workspace, file.filePath)} | LOC ${file.metrics.loc} | SLOC ${file.metrics.sloc} | Maintainability ${file.metrics.maintainabilityIndex} | Complex functions ${file.complexFunctions}`);
    }
  }
  if (analyzed.some(result => result.error)) process.exitCode = 1;
  return report;
}

module.exports = { run, parseOptions, collectSourceFiles, renderMarkdown };

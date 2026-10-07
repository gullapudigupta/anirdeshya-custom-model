'use strict';

const fs = require('fs');
const path = require('path');

function parseOptions(args) {
  const options = { input: null, format: 'markdown', output: null, template: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' || arg === '-i') options.input = args[++i];
    else if (arg === '--format' || arg === '-f') options.format = args[++i];
    else if (arg === '--output' || arg === '-o') options.output = args[++i];
    else if (arg === '--template' || arg === '-t') options.template = args[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!arg.startsWith('-') && !options.input) options.input = arg;
    else throw new Error(`Unknown report option: ${arg}`);
  }
  if (!['json', 'markdown', 'html', 'sarif'].includes(options.format)) {
    throw new Error(`Unsupported report format: ${options.format}`);
  }
  if (options.template && options.format !== 'html' && options.format !== 'markdown') {
    throw new Error('Custom templates are supported only for markdown and html reports');
  }
  return options;
}

function readResults(inputPath) {
  if (!inputPath) throw new Error('Use --input <file> to provide analysis JSON');
  const file = path.resolve(inputPath);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const results = Array.isArray(parsed) ? parsed : parsed.results || parsed.issues;
  if (!Array.isArray(results)) throw new Error('Input JSON must be an array or contain a results/issues array');
  return results;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function issueLocation(issue) {
  const file = issue.file || issue.filePath || '(unknown file)';
  const line = issue.line || issue.startLine;
  return `${file}${line ? `:${line}` : ''}`;
}

function renderMarkdown(results) {
  const issues = results.flatMap(result => result.issues || [result]);
  const lines = [
    '# Advanced Quality Tool Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Total issues: ${issues.length}`,
    '',
    '| Severity | Location | Rule | Message |',
    '|---|---|---|---|'
  ];
  for (const issue of issues) {
    const cells = [
      issue.severity || 'INFO',
      issueLocation(issue),
      issue.rule || issue.ruleId || '',
      issue.message || issue.description || ''
    ].map(value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function renderHtml(results) {
  const issues = results.flatMap(result => result.issues || [result]);
  const rows = issues.map(issue =>
    `<tr><td>${escapeHtml(issue.severity || 'INFO')}</td><td>${escapeHtml(issueLocation(issue))}</td>` +
    `<td>${escapeHtml(issue.rule || issue.ruleId || '')}</td>` +
    `<td>${escapeHtml(issue.message || issue.description || '')}</td></tr>`
  ).join('\n');
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>AQT Report</title>
<h1>Advanced Quality Tool Report</h1>
<p>Generated ${escapeHtml(new Date().toISOString())}; ${issues.length} issue(s).</p>
<table><thead><tr><th>Severity</th><th>Location</th><th>Rule</th><th>Message</th></tr></thead>
<tbody>${rows}</tbody></table></html>`;
}

function renderSarif(results) {
  const issues = results.flatMap(result => result.issues || [result]);
  return JSON.stringify({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: { driver: { name: 'advanced-quality-tool', rules: [] } },
      results: issues.map(issue => ({
        ruleId: issue.rule || issue.ruleId || issue.type || 'unknown',
        level: /critical|high|error/i.test(issue.severity || '') ? 'error' :
          /info/i.test(issue.severity || '') ? 'note' : 'warning',
        message: { text: issue.message || issue.description || '' },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: String(issue.file || issue.filePath || '').replace(/\\/g, '/') },
            region: { startLine: issue.line || issue.startLine || 1 }
          }
        }]
      }))
    }]
  }, null, 2);
}

function renderTemplate(templatePath, results, format) {
  const template = fs.readFileSync(path.resolve(templatePath), 'utf8');
  const issues = results.flatMap(result => result.issues || [result]);
  const values = {
    generatedAt: new Date().toISOString(),
    issueCount: String(issues.length),
    issues: JSON.stringify(issues, null, 2),
    issuesMarkdown: renderMarkdown(results)
  };
  return template.replace(/\{\{([A-Za-z]+)\}\}/g, (placeholder, name) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`Unknown template placeholder: ${placeholder}`);
    }
    return format === 'html' ? escapeHtml(values[name]) : values[name];
  });
}

async function run(args) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('Usage: aqt report --input <analysis.json> [--format json|markdown|html|sarif] [--output file] [--template file]');
    return 0;
  }
  const results = readResults(options.input);
  let report;
  if (options.template) report = renderTemplate(options.template, results, options.format);
  else if (options.format === 'json') report = JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2);
  else if (options.format === 'markdown') report = renderMarkdown(results);
  else if (options.format === 'html') report = renderHtml(results);
  else report = renderSarif(results);

  if (options.output) {
    fs.writeFileSync(path.resolve(options.output), report, 'utf8');
    console.log(`Report written to ${path.resolve(options.output)}`);
  } else {
    console.log(report);
  }
  return 0;
}

module.exports = { run, parseOptions, readResults, renderMarkdown, renderHtml, renderSarif, renderTemplate };

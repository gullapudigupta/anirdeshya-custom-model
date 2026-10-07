const { execFile } = require('child_process');
const util = require('util');

const execFilePromise = util.promisify(execFile);

class ExternalLanguageAnalyzer {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.language = options.language;
    this.tools = options.tools || {};
    this.stats = { filesAnalyzed: 0, issuesFound: 0, errors: 0, warnings: 0, info: 0 };
  }

  async analyzeFile(filePath) {
    this.stats.filesAnalyzed++;
    const issues = [];
    for (const [toolName, tool] of Object.entries(this.tools)) {
      if (this.options[toolName] === false) continue;
      issues.push(...await this.runTool(toolName, tool, filePath));
    }
    issues.forEach(issue => {
      this.stats.issuesFound++;
      const severity = issue.severity.toUpperCase();
      if (severity === 'ERROR' || severity === 'CRITICAL') this.stats.errors++;
      else if (severity === 'WARNING') this.stats.warnings++;
      else this.stats.info++;
    });
    return { filePath, issues, count: issues.length, language: this.language };
  }

  async runTool(toolName, tool, filePath) {
    const command = this.options[`${toolName}Path`] || tool.command;
    const args = typeof tool.args === 'function' ? tool.args(filePath) : [...tool.args, filePath];
    try {
      const result = await execFilePromise(command, args, { maxBuffer: 20 * 1024 * 1024 });
      return this.parseOutput(toolName, result.stdout || '', filePath, tool.parser);
    } catch (error) {
      const output = `${error.stdout || ''}\n${error.stderr || ''}`;
      if (output.trim()) return this.parseOutput(toolName, output, filePath, tool.parser);
      this.log(`${toolName} is unavailable: ${error.message}`);
      return [];
    }
  }

  parseOutput(toolName, output, filePath, parser) {
    if (!output.trim()) return [];
    if (parser === 'rubocop') return this.parseRubocop(output, filePath);
    if (parser === 'phpcs') return this.parsePhpcs(output, filePath);
    if (parser === 'json') return this.parseJson(output, filePath, toolName);
    return this.parseText(output, filePath, toolName);
  }

  parseJson(output, filePath, toolName) {
    try {
      const value = JSON.parse(output);
      const entries = Array.isArray(value) ? value : (value.issues || value.results || []);
      return entries.map(issue => this.issue(toolName, issue.filePath || issue.path || filePath, {
        line: issue.line || issue.line_number,
        column: issue.column || issue.column_number,
        ruleId: issue.code || issue.rule || issue.ruleId || issue.test_id,
        message: issue.message || issue.text || issue.issue_text,
        severity: issue.severity || issue.level || issue.type
      }));
    } catch {
      return this.parseText(output, filePath, toolName);
    }
  }

  parseRubocop(output, filePath) {
    try {
      const value = JSON.parse(output);
      return (value.files || []).flatMap(file => (file.offenses || []).map(offense => this.issue('rubocop', file.path || filePath, {
        line: offense.location && offense.location.start_line,
        column: offense.location && offense.location.start_column,
        ruleId: offense.cop_name,
        message: offense.message,
        severity: offense.severity
      })));
    } catch {
      return this.parseText(output, filePath, 'rubocop');
    }
  }

  parsePhpcs(output, filePath) {
    try {
      const value = JSON.parse(output);
      return Object.entries(value.files || {}).flatMap(([source, file]) => [
        ...(file.messages || []), ...(file.errors || []), ...(file.warnings || [])
      ].map(issue => this.issue('phpcs', source || filePath, {
        line: issue.line, column: issue.column, ruleId: issue.source,
        message: issue.message, severity: issue.type
      })));
    } catch {
      return this.parseText(output, filePath, 'phpcs');
    }
  }

  parseText(output, filePath, toolName) {
    return output.split(/\r?\n/).filter(Boolean).flatMap(line => {
      const match = line.match(/^(.*?):(\d+)(?::(\d+))?[^:]*:\s*(?:(\w+)[ :]+)?(.+)$/);
      if (!match) return [];
      return [this.issue(toolName, match[1] || filePath, {
        line: Number(match[2]), column: match[3] ? Number(match[3]) : 1,
        ruleId: match[4], message: match[5], severity: match[4]
      })];
    });
  }

  issue(tool, filePath, data) {
    const severity = String(data.severity || 'info').toLowerCase();
    return {
      type: tool, tool, ruleId: data.ruleId || '',
      severity: ['error', 'fatal', 'failure'].includes(severity) ? 'ERROR' :
        ['warning', 'warn'].includes(severity) ? 'WARNING' : 'INFO',
      message: data.message || '', filePath,
      line: Number(data.line) || 1, column: Number(data.column) || 1
    };
  }

  async checkTools() {
    const available = {};
    for (const [name, tool] of Object.entries(this.tools)) {
      try {
        await execFilePromise(this.options[`${name}Path`] || tool.command, ['--version']);
        available[name] = true;
      } catch { available[name] = false; }
    }
    return available;
  }

  async analyzeFiles(filePaths) { return Promise.all(filePaths.map(filePath => this.analyzeFile(filePath))); }
  getStats() { return { ...this.stats }; }
  log(message) { if (this.verbose) console.log(`[${this.language}Analyzer] ${message}`); }
}

module.exports = { ExternalLanguageAnalyzer };
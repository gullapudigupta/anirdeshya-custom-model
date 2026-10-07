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
    const errors = [];
    for (const [toolName, tool] of Object.entries(this.tools)) {
      if (this.options[toolName] === false) continue;
      try {
        issues.push(...await this.runTool(toolName, tool, filePath));
      } catch (error) {
        const message = `${toolName}: ${error.message}`;
        errors.push(message);
        this.log(message);
      }
    }
    issues.forEach(issue => {
      this.stats.issuesFound++;
      const severity = issue.severity.toUpperCase();
      if (severity === 'ERROR' || severity === 'CRITICAL') this.stats.errors++;
      else if (severity === 'WARNING') this.stats.warnings++;
      else this.stats.info++;
    });
    const result = { filePath, issues, count: issues.length, language: this.language };
    if (errors.length > 0) result.error = errors.join('; ');
    return result;
  }

  async runTool(toolName, tool, filePath) {
    const command = this.options[`${toolName}Path`] || tool.command;
    const args = typeof tool.args === 'function' ? tool.args(filePath) : [...tool.args, filePath];
    try {
      const result = await execFilePromise(command, args, { maxBuffer: 20 * 1024 * 1024 });
      return this.parseOutput(toolName, result.stdout || '', filePath, tool.parser);
    } catch (error) {
      const output = `${error.stdout || ''}\n${error.stderr || ''}`;
      if (output.trim()) {
        const issues = this.parseOutput(toolName, output, filePath, tool.parser);
        if (issues.length > 0) return issues;
      }
      throw new Error(`Unable to run ${toolName} (${command}): ${error.message}`, { cause: error });
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
    let value;
    try {
      value = JSON.parse(output);
    } catch {
      const entries = output.split(/\r?\n/).filter(Boolean).flatMap(line => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
      if (entries.length === 0) return this.parseText(output, filePath, toolName);
      value = entries;
    }

    const entries = Array.isArray(value)
      ? value
      : value && Array.isArray(value.issues)
        ? value.issues
        : value && Array.isArray(value.results)
          ? value.results
          : value && value.reason === 'compiler-message'
            ? [value]
            : [];
    return entries.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const issue = entry.reason === 'compiler-message' && entry.message && typeof entry.message === 'object'
        ? entry.message
        : entry;
      const spans = Array.isArray(issue.spans) ? issue.spans : [];
      const span = spans.find(candidate => candidate.is_primary) || spans[0] || {};
      const code = issue.code && typeof issue.code === 'object' ? issue.code.code : issue.code;
      const normalized = this.issue(toolName, issue.filePath || issue.path || span.file_name || filePath, {
        line: issue.line || issue.line_number || span.line_start,
        column: issue.column || issue.column_number || span.column_start,
        ruleId: code || issue.rule || issue.ruleId || issue.test_id,
        message: issue.message || issue.text || issue.issue_text,
        severity: issue.severity || issue.level || issue.type
      });
      return normalized.message ? [normalized] : [];
    });
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
      return Object.entries(value.files || {}).flatMap(([source, file]) => {
        const messages = Array.isArray(file.messages)
          ? file.messages
          : [
            ...(Array.isArray(file.errors) ? file.errors : []),
            ...(Array.isArray(file.warnings) ? file.warnings : [])
          ];
        return messages.map(issue => this.issue('phpcs', source || filePath, {
          line: issue.line,
          column: issue.column,
          ruleId: issue.source,
          message: issue.message,
          severity: issue.type
        }));
      });
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
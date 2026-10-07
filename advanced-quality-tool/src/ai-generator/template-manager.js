'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE_FIELDS = new Set([
  'severity', 'category', 'summary', 'what', 'why', 'how', 'context', 'outputContract'
]);

class TemplateManager {
  constructor(options = {}) {
    const rootDir = path.resolve(options.rootDir || process.cwd());
    this.directory = path.join(rootDir, '.aqt', 'ai-templates');
  }

  list() {
    if (!fs.existsSync(this.directory)) return [];
    return fs.readdirSync(this.directory)
      .filter(file => file.endsWith('.txt'))
      .map(file => file.slice(0, -4))
      .sort();
  }

  get(name) {
    const filePath = this._filePath(name);
    if (!fs.existsSync(filePath)) throw new Error(`AI template not found: ${name}`);
    return fs.readFileSync(filePath, 'utf8');
  }

  save(name, content) {
    const filePath = this._filePath(name);
    if (typeof content !== 'string' || !content.trim()) throw new Error('Template content must not be empty');
    TemplateManager.validate(content);
    fs.mkdirSync(this.directory, { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
    return { name, path: filePath };
  }

  remove(name) {
    const filePath = this._filePath(name);
    if (!fs.existsSync(filePath)) throw new Error(`AI template not found: ${name}`);
    fs.unlinkSync(filePath);
    return { removed: name };
  }

  static validate(content) {
    const tokens = content.match(/{{\s*[^{}]+\s*}}/g) || [];
    for (const token of tokens) {
      const field = token.slice(2, -2).trim();
      if (!TEMPLATE_FIELDS.has(field)) throw new Error(`Unknown AI template placeholder: ${field}`);
    }
  }

  _filePath(name) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      throw new Error('Template name must contain 1-64 letters, numbers, underscores, or hyphens');
    }
    return path.join(this.directory, `${name}.txt`);
  }
}

module.exports = { TemplateManager, TEMPLATE_FIELDS };

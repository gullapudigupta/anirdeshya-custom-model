'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORES = new Set([
  '.git', 'node_modules', '.aqt', '.aqt-cache', '.aqt-history',
  '.aqt-reports', 'dist', 'build', 'coverage'
]);

class WorkspaceContext {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.maxFiles = options.maxFiles || 40;
    this.maxFileBytes = options.maxFileBytes || 128 * 1024;
    this.maxTotalBytes = options.maxTotalBytes || 512 * 1024;
    this.maxTokens = options.maxTokens || 32000;
    this.countTokens = options.countTokens || (content => Math.ceil(content.length / 4));
    this.ignoreNames = new Set([...DEFAULT_IGNORES, ...(options.ignoreNames || [])]);
  }

  collect(files = []) {
    const context = { files: [], missing: [], excluded: [], truncated: [], totalBytes: 0, totalTokens: 0 };
    const selected = Array.isArray(files) ? files : [];
    if (selected.length > this.maxFiles) {
      throw new Error(`Context file limit exceeded (${selected.length} > ${this.maxFiles})`);
    }

    for (const relativePath of selected) {
      if (typeof relativePath !== 'string' || !relativePath.trim()) {
        throw new Error('Context paths must be non-empty strings');
      }
      const absolutePath = path.resolve(this.workspace, relativePath);
      if (!this._isWithinWorkspace(absolutePath)) {
        throw new Error(`Context path is outside the workspace: ${relativePath}`);
      }
      const normalizedRelativePath = path.relative(this.workspace, absolutePath);
      if (normalizedRelativePath.split(/[\\/]/).some(part => this.ignoreNames.has(part))) {
        context.excluded.push({ path: relativePath, reason: 'ignored path' });
        continue;
      }
      if (!fs.existsSync(absolutePath)) {
        context.missing.push(relativePath);
        continue;
      }

      const realPath = fs.realpathSync(absolutePath);
      if (!this._isWithinWorkspace(realPath)) {
        throw new Error(`Context path resolves outside the workspace: ${relativePath}`);
      }
      const stat = fs.statSync(realPath);
      if (!stat.isFile()) {
        context.excluded.push({ path: relativePath, reason: 'not a file' });
        continue;
      }
      if (stat.size > this.maxFileBytes || context.totalBytes + stat.size > this.maxTotalBytes) {
        context.truncated.push({ path: relativePath, reason: 'context byte limit exceeded' });
        continue;
      }

      const content = fs.readFileSync(realPath, 'utf8');
      const bytes = Buffer.byteLength(content, 'utf8');
      const tokens = this.countTokens(content, relativePath);
      if (!Number.isFinite(tokens) || tokens < 0) {
        throw new Error(`Token counter returned an invalid count for ${relativePath}`);
      }
      if (context.totalTokens + tokens > this.maxTokens) {
        context.truncated.push({ path: relativePath, reason: 'context token limit exceeded' });
        continue;
      }
      context.files.push({
        path: path.relative(this.workspace, realPath).split(path.sep).join('/'),
        content,
        hash: crypto.createHash('sha256').update(content).digest('hex'),
        bytes,
        tokens
      });
      context.totalBytes += bytes;
      context.totalTokens += tokens;
    }
    return context;
  }

  _isWithinWorkspace(candidate) {
    const relative = path.relative(this.workspace, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }
}

module.exports = { WorkspaceContext };

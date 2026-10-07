'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PermissionManager } = require('./permissions');
const { WorkItemStatus } = require('./work-item');
const { validateCompletion } = require('./contracts');

const STORE_VERSION = 1;
const TERMINAL_STATUSES = new Set([
  WorkItemStatus.COMPLETED,
  WorkItemStatus.DENIED,
  WorkItemStatus.FAILED,
  WorkItemStatus.CANCELLED
]);
const VALID_STATUSES = new Set(Object.values(WorkItemStatus));

class AgentRunStore {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.storageDir = path.resolve(options.storageDir || path.join(this.workspace, '.aqt-reports', 'agent-history'));
    const relative = path.relative(this.workspace, this.storageDir);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Agent run storage must be inside the workspace');
    }
    this.permissionManager = options.permissionManager || new PermissionManager({ workspace: this.workspace });
  }

  save(item, metadata = {}) {
    if (!item || typeof item.toJSON !== 'function' || !item.id) {
      throw new Error('A valid work item is required to persist an agent run');
    }
    this._assertStoragePath();
    fs.mkdirSync(this.storageDir, { recursive: true });
    this._assertStoragePath();
    const itemRecord = JSON.parse(JSON.stringify(item.toJSON()));
    if (itemRecord.context?.files) {
      itemRecord.context.files = itemRecord.context.files.map(file => {
        const { content, ...provenance } = file;
        return {
          ...provenance,
          content: typeof content === 'string'
            ? {
              sha256: crypto.createHash('sha256').update(content).digest('hex'),
              byteLength: Buffer.byteLength(content, 'utf8')
            }
            : undefined
        };
      });
    }
    if (itemRecord.output) {
      delete itemRecord.output.results;
      itemRecord.output.appliedPatches = (itemRecord.output.appliedPatches || []).map(patch => ({
        path: patch.path,
        type: patch.type,
        diff: typeof patch.unifiedDiff === 'string'
          ? {
            sha256: crypto.createHash('sha256').update(patch.unifiedDiff).digest('hex'),
            byteLength: Buffer.byteLength(patch.unifiedDiff, 'utf8')
          }
          : null
      }));
    }
    itemRecord.toolCalls = (itemRecord.toolCalls || []).map(call => ({
      ...call,
      output: call.output === null || call.output === undefined
        ? call.output
        : {
          sha256: crypto.createHash('sha256').update(JSON.stringify(call.output)).digest('hex'),
          byteLength: Buffer.byteLength(JSON.stringify(call.output), 'utf8')
        }
    }));
    const payload = this._redact({
      storeVersion: STORE_VERSION,
      item: itemRecord,
      metadata,
      savedAt: new Date().toISOString()
    });
    const digest = this._digest(payload);
    const destination = this._getPath(item.id);
    const temporary = `${destination}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let previous = null;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ payload, digest }), { encoding: 'utf8', flag: 'wx' });
      if (fs.existsSync(destination)) {
        previous = `${destination}.${crypto.randomBytes(8).toString('hex')}.bak`;
        fs.renameSync(destination, previous);
      }
      fs.renameSync(temporary, destination);
      if (previous && fs.existsSync(previous)) fs.unlinkSync(previous);
    } catch (error) {
      if (previous && fs.existsSync(previous) && !fs.existsSync(destination)) {
        fs.renameSync(previous, destination);
      }
      throw error;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      if (previous && fs.existsSync(previous) && fs.existsSync(destination)) fs.unlinkSync(previous);
    }
    return destination;
  }

  load(id) {
    this._assertStoragePath();
    const recordPath = this._getPath(id);
    if (!fs.existsSync(recordPath)) return { status: 'missing', id };
    let envelope;
    try {
      envelope = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    } catch (error) {
      return { status: 'recovery-required', id, reason: `Run record cannot be parsed: ${error.message}` };
    }
    if (!envelope || !envelope.payload || envelope.digest !== this._digest(envelope.payload)) {
      return { status: 'recovery-required', id, reason: 'Run record integrity check failed' };
    }
    if (envelope.payload.storeVersion !== STORE_VERSION || !envelope.payload.item) {
      return { status: 'recovery-required', id, reason: 'Run record version is incompatible' };
    }
    const item = envelope.payload.item;
    if (item.status === WorkItemStatus.COMPLETED) {
      const completion = {
        schemaVersion: STORE_VERSION,
        status: item.status,
        changedFiles: item.changedFiles,
        verifiedChangedFiles: item.output?.verifiedChangedFiles,
        verification: item.verificationResults
      };
      const validation = validateCompletion(completion);
      if (!validation.valid) {
        return { status: 'recovery-required', id, reason: validation.issues.join(', ') };
      }
    } else if (!VALID_STATUSES.has(item.status)) {
      return { status: 'recovery-required', id, reason: 'Run record contains an unknown work status' };
    }
    return {
      status: 'loaded',
      id,
      item,
      metadata: envelope.payload.metadata,
      resumable: !TERMINAL_STATUSES.has(item.status)
    };
  }

  validateResume(id) {
    const loaded = this.load(id);
    if (loaded.status !== 'loaded') return loaded;
    const hashes = loaded.metadata.workspaceHashes || {};
    for (const [relativePath, expectedHash] of Object.entries(hashes)) {
      const absolutePath = path.resolve(this.workspace, relativePath);
      const permission = this.permissionManager.validatePath(absolutePath);
      if (!permission.valid) {
        return { status: 'recovery-required', id, reason: permission.reason };
      }
      if (!fs.existsSync(absolutePath)) {
        return { status: 'recovery-required', id, reason: `Checkpoint file is missing: ${relativePath}` };
      }
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
      if (actualHash !== expectedHash) {
        return { status: 'recovery-required', id, reason: `Checkpoint file changed: ${relativePath}` };
      }
    }
    return loaded;
  }

  list() {
    if (!fs.existsSync(this.storageDir)) return [];
    return fs.readdirSync(this.storageDir)
      .filter(file => file.endsWith('.json'))
      .map(file => this.load(path.basename(file, '.json')))
      .sort((left, right) => String(right.item?.createdAt || '').localeCompare(String(left.item?.createdAt || '')));
  }

  _getPath(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(id)) {
      throw new Error('Agent run ID contains invalid characters');
    }
    return path.join(this.storageDir, `${id}.json`);
  }

  _assertStoragePath() {
    const workspaceReal = fs.existsSync(this.workspace)
      ? fs.realpathSync(this.workspace)
      : this.workspace;
    const relative = path.relative(this.workspace, this.storageDir);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Agent run storage must be inside the workspace');
    }
    let current = this.workspace;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
          throw new Error('Agent run storage cannot traverse a symbolic link');
        }
        const realPath = fs.realpathSync(current);
        const realRelative = path.relative(workspaceReal, realPath);
        if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(realRelative)) {
          throw new Error('Agent run storage resolves outside the workspace');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  _redact(value) {
    if (typeof value === 'string') return this.permissionManager.redactSecrets(value);
    if (Array.isArray(value)) return value.map(item => this._redact(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        const isTokenCount = typeof item === 'number' &&
          /^(?:repairTokensUsed|inputTokens|outputTokens|totalTokens|tokenCount)$/i.test(key);
        if (/password|secret|token|credential|api[-_]?key/i.test(key) && !isTokenCount) {
          return [key, '[REDACTED]'];
        }
        if (['content', 'originalContent', 'modifiedContent'].includes(key) && typeof item === 'string') {
          return [key, {
            sha256: crypto.createHash('sha256').update(item).digest('hex'),
            byteLength: Buffer.byteLength(item, 'utf8')
          }];
        }
        if (['diff', 'unifiedDiff'].includes(key) && typeof item === 'string') {
          return [key, {
            sha256: crypto.createHash('sha256').update(item).digest('hex'),
            byteLength: Buffer.byteLength(item, 'utf8')
          }];
        }
        return [key, this._redact(item)];
      }));
    }
    return value;
  }

  _digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}

module.exports = { AgentRunStore, STORE_VERSION };

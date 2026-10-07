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

class AgentRunStore {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.storageDir = path.resolve(options.storageDir || path.join(this.workspace, '.aqt', 'agent-runs'));
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
    fs.mkdirSync(this.storageDir, { recursive: true });
    const payload = this._redact({
      storeVersion: STORE_VERSION,
      item: item.toJSON(),
      metadata,
      savedAt: new Date().toISOString()
    });
    const digest = this._digest(payload);
    const destination = this._getPath(item.id);
    const temporary = `${destination}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ payload, digest }), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return destination;
  }

  load(id) {
    const recordPath = this._getPath(id);
    if (!fs.existsSync(recordPath)) return { status: 'missing', id };
    const envelope = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
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
    } else if (!TERMINAL_STATUSES.has(item.status)) {
      return { status: 'recovery-required', id, reason: 'Incomplete runs require explicit recovery before resumption' };
    }
    return { status: 'loaded', id, item, metadata: envelope.payload.metadata };
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

  _redact(value) {
    if (typeof value === 'string') return this.permissionManager.redactSecrets(value);
    if (Array.isArray(value)) return value.map(item => this._redact(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this._redact(item)]));
    }
    return value;
  }

  _digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}

module.exports = { AgentRunStore, STORE_VERSION };

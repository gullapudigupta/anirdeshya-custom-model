'use strict';

const { execFile } = require('child_process');
const path = require('path');
const { PermissionManager } = require('./permissions');

const DEFAULT_ENVIRONMENT_KEYS = Object.freeze([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'CI', 'NODE_ENV'
]);

class ConfiguredCheckRunner {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.checks = new Map(Object.entries(options.checks || {}));
    this.timeoutMs = options.timeoutMs || 120000;
    this.maxOutputBytes = options.maxOutputBytes || 128 * 1024;
    this.environmentKeys = new Set(options.environmentKeys || DEFAULT_ENVIRONMENT_KEYS);
    this.env = options.env || process.env;
    this.permissionManager = options.permissionManager ||
      new PermissionManager({ workspace: this.workspace });
  }

  listChecks() {
    return Array.from(this.checks.keys());
  }

  run(checkId, options = {}) {
    const check = this.checks.get(checkId);
    if (!check) {
      return Promise.resolve({
        id: checkId,
        status: 'unavailable',
        required: options.required !== false,
        error: `Verification check '${checkId}' is not configured`
      });
    }
    if (!check || typeof check.command !== 'string' || !check.command.trim() ||
        !Array.isArray(check.args) || check.args.some(arg => typeof arg !== 'string')) {
      return Promise.resolve({
        id: checkId,
        status: 'errored',
        required: options.required !== false,
        error: `Verification check '${checkId}' has an invalid trusted configuration`
      });
    }

    const cwd = path.resolve(this.workspace, check.cwd || '.');
    const relative = path.relative(this.workspace, cwd);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return Promise.resolve({
        id: checkId,
        status: 'errored',
        required: options.required !== false,
        error: `Verification check '${checkId}' is configured outside the workspace`
      });
    }

    const timeout = Math.min(check.timeoutMs || this.timeoutMs, this.timeoutMs);
    const maxBuffer = Math.min(check.maxOutputBytes || this.maxOutputBytes, this.maxOutputBytes);
    const startedAt = Date.now();
    const environment = Object.fromEntries(
      Object.entries(this.env).filter(([key]) => this.environmentKeys.has(key))
    );
    return new Promise(resolve => {
      execFile(check.command, check.args, {
        cwd,
        timeout,
        maxBuffer,
        windowsHide: true,
        env: environment,
        signal: options.signal
      }, (error, stdout = '', stderr = '') => {
        const rawOutput = `${stdout}${stderr ? `\n${stderr}` : ''}`;
        const output = this.permissionManager.redactSecrets(rawOutput);
        const boundedOutput = Buffer.from(output).subarray(0, maxBuffer).toString('utf8');
        const timedOut = error && (error.code === 'ETIMEDOUT' ||
          (error.killed && !options.signal?.aborted));
        const sanitizedCommand = this.permissionManager.redactSecrets(
          [check.command, ...check.args].join(' ')
        );
        resolve({
          id: checkId,
          status: !error ? 'passed' : (timedOut ? 'timed-out' : 'failed'),
          required: options.required !== false,
          command: sanitizedCommand,
          exitCode: error ? (Number.isInteger(error.code) ? error.code : null) : 0,
          durationMs: Date.now() - startedAt,
          output: boundedOutput,
          truncated: Buffer.byteLength(output, 'utf8') > Buffer.byteLength(boundedOutput, 'utf8'),
          error: error ? this.permissionManager.redactSecrets(error.message) : null
        });
      });
    });
  }
}

module.exports = { ConfiguredCheckRunner };

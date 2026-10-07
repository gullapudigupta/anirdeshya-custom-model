'use strict';

const fs = require('fs');
const path = require('path');

class UsageAnalytics {
  constructor(options = {}) {
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.configPath = path.join(this.workspace, '.aqt', 'analytics.json');
    this.dataPath = path.join(this.workspace, '.aqt', 'usage-metrics.json');
    this.config = fs.existsSync(this.configPath)
      ? JSON.parse(fs.readFileSync(this.configPath, 'utf8'))
      : { enabled: false };
    if (!this.config || typeof this.config.enabled !== 'boolean') {
      throw new Error('Invalid analytics configuration: enabled must be a boolean');
    }
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const tempPath = `${this.configPath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify({ enabled }, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.configPath);
    this.config = { enabled };
    return this.status();
  }

  status() {
    return { enabled: this.config.enabled === true, storage: 'local', uploads: false };
  }

  record(command, outcome = {}) {
    if (!this.config.enabled) return false;
    const normalizedCommand = String(command || '').toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 80);
    if (!normalizedCommand) throw new Error('command name is required');
    const durationMs = outcome.durationMs === undefined ? 0 : outcome.durationMs;
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('durationMs must be non-negative');

    const data = fs.existsSync(this.dataPath)
      ? JSON.parse(fs.readFileSync(this.dataPath, 'utf8'))
      : { schemaVersion: 1, days: {} };
    if (!data.days || typeof data.days !== 'object') throw new Error('Invalid usage metrics data format');
    const date = new Date().toISOString().slice(0, 10);
    const day = data.days[date] || (data.days[date] = { commands: {} });
    const metric = day.commands[normalizedCommand] || (day.commands[normalizedCommand] = {
      count: 0, successes: 0, failures: 0, durationMs: 0
    });
    metric.count++;
    metric[outcome.success === false ? 'failures' : 'successes']++;
    metric.durationMs += Math.round(durationMs);

    fs.mkdirSync(path.dirname(this.dataPath), { recursive: true });
    const tempPath = `${this.dataPath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.dataPath);
    return true;
  }

  report(days = 30) {
    if (!Number.isInteger(days) || days < 1) throw new Error('days must be a positive integer');
    const data = fs.existsSync(this.dataPath)
      ? JSON.parse(fs.readFileSync(this.dataPath, 'utf8'))
      : { days: {} };
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - days + 1);
    const commands = {};
    for (const [date, record] of Object.entries(data.days || {})) {
      if (new Date(`${date}T00:00:00.000Z`) < cutoff) continue;
      for (const [name, metric] of Object.entries(record.commands || {})) {
        const aggregate = commands[name] || (commands[name] = {
          count: 0, successes: 0, failures: 0, durationMs: 0
        });
        for (const key of Object.keys(aggregate)) aggregate[key] += metric[key] || 0;
      }
    }
    return { periodDays: days, commands, collectedData: ['command name', 'success/failure', 'duration'], uploads: false };
  }

  clear() {
    if (fs.existsSync(this.dataPath)) fs.unlinkSync(this.dataPath);
    return { cleared: true };
  }
}

module.exports = { UsageAnalytics };

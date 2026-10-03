/**
 * Notification System
 *
 * Sends alerts for critical code quality issues via multiple channels:
 * - Slack (Incoming Webhooks)
 * - Email (SMTP)
 * - Generic Webhook (any HTTP endpoint)
 * - Console (always available, useful for CI logs)
 *
 * Credentials are read exclusively from environment variables.
 * Supports per-channel severity thresholds, rate limiting, and
 * batching to avoid notification fatigue.
 *
 * @module integrations/notification-system
 */

'use strict';

const https   = require('https');
const http    = require('http');
const net     = require('net');
const { URL } = require('url');

/** Numeric severity weights for threshold comparisons */
const SEVERITY_WEIGHT = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

/** Default configuration */
const DEFAULTS = {
  minSeverity:    'HIGH',   // Minimum severity to trigger a notification
  batchWindow:    30000,    // ms to collect issues before sending a batch (0 = immediate)
  maxBatchSize:   20,       // Max issues per batch notification
  rateLimit:      5,        // Max notifications per minute per channel
};

class NotificationSystem {
  /**
   * @param {object} [options={}]
   * @param {object} [options.channels]      - Channel configurations (see below)
   * @param {string} [options.minSeverity]   - Minimum severity to notify
   * @param {number} [options.batchWindow]   - Batch collection window in ms
   * @param {number} [options.maxBatchSize]  - Max issues per batch
   * @param {boolean} [options.verbose=false]
   * @param {boolean} [options.dryRun=false] - Log instead of sending
   *
   * Channel config examples:
   *   channels: {
   *     slack:   { enabled: true, webhookUrl: '...', minSeverity: 'HIGH' },
   *     email:   { enabled: true, smtp: { host, port, user, pass }, to: ['a@b.com'], from: '...' },
   *     webhook: { enabled: true, url: '...', secret: '...' },
   *     console: { enabled: true }
   *   }
   */
  constructor(options = {}) {
    this.options     = options;
    this.verbose     = options.verbose || false;
    this.dryRun      = options.dryRun  || false;
    this.minSeverity = options.minSeverity || DEFAULTS.minSeverity;
    this.batchWindow = options.batchWindow !== undefined ? options.batchWindow : DEFAULTS.batchWindow;
    this.maxBatchSize = options.maxBatchSize || DEFAULTS.maxBatchSize;

    // Channel configs — merge with env-var defaults
    this.channels = this._resolveChannels(options.channels || {});

    // Rate limiting state: { channelName: [timestamp, ...] }
    this._rateLimitState = {};
    // Batch buffer: { channelName: [issues] }
    this._batchBuffer = {};
    this._batchTimers = {};
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Notify all enabled channels about one or more issues.
   * Applies severity filtering, batching, and rate limiting.
   *
   * @param {object|object[]} issues - Single issue or array of issue objects
   * @returns {Promise<object[]>} Array of send results per channel
   */
  async notify(issues) {
    const list = Array.isArray(issues) ? issues : [issues];
    const filtered = list.filter(i => this._meetsThreshold(i, this.minSeverity));

    if (filtered.length === 0) {
      this._log('No issues meet the minimum severity threshold — nothing to send.');
      return [];
    }

    if (this.batchWindow > 0) {
      return this._bufferBatch(filtered);
    }
    return this._dispatchToAllChannels(filtered);
  }

  /**
   * Flush any pending batched notifications immediately.
   * @returns {Promise<object[]>}
   */
  async flush() {
    const results = [];
    for (const channel of Object.keys(this._batchBuffer)) {
      if (this._batchBuffer[channel] && this._batchBuffer[channel].length > 0) {
        const issues = this._batchBuffer[channel].splice(0);
        clearTimeout(this._batchTimers[channel]);
        results.push(...await this._dispatchToChannel(channel, issues));
      }
    }
    return results;
  }

  /**
   * Send a plain text message to all enabled channels (e.g. build status).
   * @param {string} title
   * @param {string} body
   * @param {string} [severity='INFO']
   * @returns {Promise<object[]>}
   */
  async sendMessage(title, body, severity = 'INFO') {
    return this._dispatchToAllChannels([], { title, body, severity });
  }

  /**
   * Test all enabled channels with a ping message.
   * @returns {Promise<object[]>}
   */
  async testChannels() {
    return this.sendMessage(
      '🔔 AQT Notification Test',
      'Advanced Quality Tool notification system is configured correctly.',
      'INFO'
    );
  }

  // ─── Batching ──────────────────────────────────────────────────────────────

  _bufferBatch(issues) {
    return new Promise((resolve) => {
      for (const channelName of Object.keys(this.channels)) {
        if (!this._batchBuffer[channelName]) this._batchBuffer[channelName] = [];
        this._batchBuffer[channelName].push(...issues);

        // Reset batch timer
        clearTimeout(this._batchTimers[channelName]);
        this._batchTimers[channelName] = setTimeout(async () => {
          const batch = this._batchBuffer[channelName].splice(0, this.maxBatchSize);
          if (batch.length > 0) {
            await this._dispatchToChannel(channelName, batch);
          }
          resolve([]);
        }, this.batchWindow);
      }
    });
  }

  // ─── Dispatch ──────────────────────────────────────────────────────────────

  async _dispatchToAllChannels(issues, overridePayload = null) {
    const results = [];
    for (const channelName of Object.keys(this.channels)) {
      const channelResults = await this._dispatchToChannel(channelName, issues, overridePayload);
      results.push(...channelResults);
    }
    return results;
  }

  async _dispatchToChannel(channelName, issues, overridePayload = null) {
    const config = this.channels[channelName];
    if (!config || !config.enabled) return [];

    // Channel-level severity filter
    const filtered = overridePayload
      ? issues
      : issues.filter(i => this._meetsThreshold(i, config.minSeverity || this.minSeverity));
    if (filtered.length === 0 && !overridePayload) return [];

    // Rate limit check
    if (!this._checkRateLimit(channelName)) {
      this._log(`Rate limit hit for channel '${channelName}' — skipping.`);
      return [{ channel: channelName, skipped: true, reason: 'rate_limit' }];
    }

    try {
      let result;
      switch (channelName) {
        case 'slack':   result = await this._sendSlack(config, filtered, overridePayload);   break;
        case 'email':   result = await this._sendEmail(config, filtered, overridePayload);   break;
        case 'webhook': result = await this._sendWebhook(config, filtered, overridePayload); break;
        case 'console': result = this._sendConsole(config, filtered, overridePayload);       break;
        default:
          result = await this._sendWebhook(config, filtered, overridePayload);
      }
      this._recordRateLimit(channelName);
      return [{ channel: channelName, ...result }];
    } catch (err) {
      this._log(`Error sending to '${channelName}': ${err.message}`);
      return [{ channel: channelName, success: false, error: err.message }];
    }
  }

  // ─── Channel: Slack ────────────────────────────────────────────────────────

  async _sendSlack(config, issues, override) {
    const webhookUrl = config.webhookUrl || process.env.AQT_SLACK_WEBHOOK_URL;
    if (!webhookUrl) return { success: false, error: 'Slack webhookUrl not configured (AQT_SLACK_WEBHOOK_URL)' };

    const payload = override
      ? { text: `*${override.title}*\n${override.body}` }
      : this._buildSlackPayload(issues);

    if (this.dryRun) {
      this._log(`[DRY RUN] Slack: ${JSON.stringify(payload).slice(0, 120)}`);
      return { success: true, dryRun: true };
    }

    const body = JSON.stringify(payload);
    await this._httpPost(webhookUrl, body, { 'Content-Type': 'application/json' });
    return { success: true, issueCount: issues.length };
  }

  _buildSlackPayload(issues) {
    const critical = issues.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH');
    const header   = critical.length
      ? `🚨 *${critical.length} critical/high issue${critical.length > 1 ? 's' : ''} detected*`
      : `⚠️ *${issues.length} quality issue${issues.length > 1 ? 's' : ''} detected*`;

    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: header } },
      { type: 'divider' }
    ];

    issues.slice(0, 10).forEach(issue => {
      const emoji = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🔵', INFO: '⚪' };
      const e = emoji[issue.severity] || '⚪';
      const loc = issue.line ? `:${issue.line}` : '';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${e} *${issue.severity}* \`${issue.filePath || 'unknown'}${loc}\`\n${issue.message}`
        }
      });
    });

    if (issues.length > 10) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `_...and ${issues.length - 10} more issues_` } });
    }

    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Advanced Quality Tool · ${new Date().toISOString()}` }]
    });

    return { blocks };
  }

  // ─── Channel: Email ────────────────────────────────────────────────────────

  async _sendEmail(config, issues, override) {
    const smtp = config.smtp || {
      host: process.env.AQT_SMTP_HOST || 'localhost',
      port: parseInt(process.env.AQT_SMTP_PORT || '587'),
      user: process.env.AQT_SMTP_USER || '',
      pass: process.env.AQT_SMTP_PASS || ''
    };
    const to   = config.to   || (process.env.AQT_EMAIL_TO || '').split(',').map(s => s.trim()).filter(Boolean);
    const from = config.from || process.env.AQT_EMAIL_FROM || 'aqt@advanced-quality-tool.dev';

    if (!to.length) return { success: false, error: 'No email recipients configured (AQT_EMAIL_TO)' };

    const subject = override
      ? override.title
      : `[AQT] ${issues.length} Quality Issue${issues.length > 1 ? 's' : ''} Detected`;

    const body = override
      ? `${override.title}\n\n${override.body}`
      : this._buildEmailBody(issues);

    if (this.dryRun) {
      this._log(`[DRY RUN] Email to ${to.join(', ')}: ${subject}`);
      return { success: true, dryRun: true };
    }

    await this._sendSMTP(smtp, { from, to, subject, body });
    return { success: true, issueCount: issues.length, recipients: to.length };
  }

  _buildEmailBody(issues) {
    const lines = [
      'Advanced Quality Tool — Quality Report',
      '='.repeat(50),
      `${issues.length} issue(s) detected at ${new Date().toISOString()}`,
      ''
    ];
    issues.forEach((issue, idx) => {
      const loc = issue.line ? `:${issue.line}` : '';
      lines.push(`${idx + 1}. [${issue.severity}] ${issue.filePath || ''}${loc}`);
      lines.push(`   ${issue.message}`);
      if (issue.suggestion) lines.push(`   → ${issue.suggestion}`);
      lines.push('');
    });
    return lines.join('\n');
  }

  /** Minimal SMTP client (plain/starttls, no auth complexity — production use should use nodemailer) */
  _sendSMTP(smtp, mail) {
    return new Promise((resolve, reject) => {
      const conn = net.createConnection(smtp.port || 587, smtp.host || 'localhost');
      const msg  = [
        `EHLO advanced-quality-tool`,
        `MAIL FROM:<${mail.from}>`,
        ...mail.to.map(t => `RCPT TO:<${t}>`),
        'DATA',
        `From: ${mail.from}`,
        `To: ${mail.to.join(', ')}`,
        `Subject: ${mail.subject}`,
        `Date: ${new Date().toUTCString()}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        mail.body,
        '.',
        'QUIT'
      ];
      let idx = 0;
      conn.setEncoding('utf8');
      conn.on('data', () => {
        if (idx < msg.length) { conn.write(msg[idx++] + '\r\n'); }
        else { conn.end(); resolve({ success: true }); }
      });
      conn.on('error', reject);
      conn.on('close', () => resolve({ success: true }));
    });
  }

  // ─── Channel: Generic Webhook ──────────────────────────────────────────────

  async _sendWebhook(config, issues, override) {
    const url = config.url || config.webhookUrl;
    if (!url) return { success: false, error: 'Webhook URL not configured' };

    const payload = override
      ? { title: override.title, body: override.body, severity: override.severity, timestamp: new Date().toISOString() }
      : { issueCount: issues.length, issues: issues.slice(0, 50), timestamp: new Date().toISOString(), source: 'advanced-quality-tool' };

    if (this.dryRun) {
      this._log(`[DRY RUN] Webhook POST to ${url}`);
      return { success: true, dryRun: true };
    }

    const headers = { 'Content-Type': 'application/json' };
    if (config.secret) headers['X-AQT-Secret'] = config.secret;

    await this._httpPost(url, JSON.stringify(payload), headers);
    return { success: true, issueCount: issues.length };
  }

  // ─── Channel: Console ─────────────────────────────────────────────────────

  _sendConsole(config, issues, override) {
    if (override) {
      console.log(`\n[AQT] ${override.title}`);
      if (override.body) console.log(override.body);
      return { success: true };
    }
    console.log(`\n[AQT] ⚠️  ${issues.length} quality issue(s) detected:`);
    issues.slice(0, 20).forEach(i => {
      const loc = i.line ? `:${i.line}` : '';
      console.log(`  [${i.severity}] ${i.filePath || ''}${loc} — ${i.message}`);
    });
    if (issues.length > 20) console.log(`  ... and ${issues.length - 20} more.`);
    return { success: true, issueCount: issues.length };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _resolveChannels(userChannels) {
    const resolved = {};

    // Always include console as a fallback
    resolved.console = Object.assign({ enabled: true }, userChannels.console || {});

    // Slack — enable if env var is set or explicitly configured
    if (userChannels.slack || process.env.AQT_SLACK_WEBHOOK_URL) {
      resolved.slack = Object.assign({ enabled: true }, userChannels.slack || {});
    }

    // Email
    if (userChannels.email || process.env.AQT_SMTP_HOST) {
      resolved.email = Object.assign({ enabled: true }, userChannels.email || {});
    }

    // Generic webhook
    if (userChannels.webhook) {
      resolved.webhook = Object.assign({ enabled: true }, userChannels.webhook);
    }

    return resolved;
  }

  _meetsThreshold(issue, minSeverity) {
    const issueWeight = SEVERITY_WEIGHT[issue.severity] ?? 0;
    const minWeight   = SEVERITY_WEIGHT[minSeverity]    ?? 0;
    return issueWeight >= minWeight;
  }

  _checkRateLimit(channelName) {
    const now    = Date.now();
    const window = 60000; // 1 minute
    const max    = DEFAULTS.rateLimit;
    if (!this._rateLimitState[channelName]) this._rateLimitState[channelName] = [];
    // Prune old timestamps
    this._rateLimitState[channelName] = this._rateLimitState[channelName].filter(t => now - t < window);
    return this._rateLimitState[channelName].length < max;
  }

  _recordRateLimit(channelName) {
    if (!this._rateLimitState[channelName]) this._rateLimitState[channelName] = [];
    this._rateLimitState[channelName].push(Date.now());
  }

  _httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib    = url.startsWith('https') ? https : http;
      const req    = lib.request({
        hostname: parsed.hostname,
        port:     parsed.port || (url.startsWith('https') ? 443 : 80),
        path:     parsed.pathname + (parsed.search || ''),
        method:   'POST',
        headers:  { ...headers, 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(raw);
          else reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _log(msg) { if (this.verbose) console.log(`[NotificationSystem] ${msg}`); }
}

module.exports = { NotificationSystem, SEVERITY_WEIGHT, DEFAULTS };

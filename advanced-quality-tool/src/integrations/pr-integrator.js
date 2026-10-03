/**
 * Pull Request Integrator
 *
 * Posts code quality analysis summaries as PR comments and
 * sets pass/fail status on GitHub and GitLab pull/merge requests.
 *
 * Supports:
 *  - GitHub (REST API v3)
 *  - GitLab (Merge Requests API)
 *  - Generic webhook output (for other providers)
 *
 * Credentials are read from environment variables only — never from source.
 *
 * @module integrations/pr-integrator
 */

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

/** Supported providers */
const PROVIDERS = {
  GITHUB: 'github',
  GITLAB: 'gitlab',
  GENERIC: 'generic'
};

class PRIntegrator {
  /**
   * @param {object} [options={}]
   * @param {string} [options.provider='github'] - 'github' | 'gitlab' | 'generic'
   * @param {string} [options.token] - Override env var (tests only; never commit tokens)
   * @param {string} [options.apiBase] - Override API base URL
   * @param {boolean} [options.dryRun=false] - Log instead of making requests
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.dryRun = options.dryRun || false;
    this.provider = (options.provider || process.env.AQT_PR_PROVIDER || 'github').toLowerCase();

    // Resolve credentials from environment
    this.token = options.token ||
                 process.env.GITHUB_TOKEN ||
                 process.env.GITLAB_TOKEN ||
                 process.env.AQT_PR_TOKEN || '';

    this.apiBase = options.apiBase ||
                   (this.provider === PROVIDERS.GITLAB
                     ? 'https://gitlab.com/api/v4'
                     : 'https://api.github.com');
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Post a quality analysis comment to a pull/merge request.
   *
   * @param {object} params
   * @param {string} params.repo - 'owner/repo' (GitHub) or project ID (GitLab)
   * @param {number|string} params.prNumber - PR number (GitHub) or MR IID (GitLab)
   * @param {object} params.analysis - Analysis result containing issues/summary
   * @param {boolean} [params.updateExisting=true] - Update existing AQT comment if found
   * @returns {Promise<{ success: boolean, commentId?: number|string, url?: string, error?: string }>}
   */
  async postComment(params) {
    const { repo, prNumber, analysis, updateExisting = true } = params;
    this._validateRequired({ repo, prNumber, analysis });

    const body = this._buildCommentBody(analysis);

    if (this.dryRun) {
      this._log(`[DRY RUN] Would post comment to ${this.provider} PR #${prNumber} in ${repo}`);
      this._log(body);
      return { success: true, dryRun: true, body };
    }

    try {
      if (this.provider === PROVIDERS.GITHUB) {
        return await this._githubPostComment(repo, prNumber, body, updateExisting);
      } else if (this.provider === PROVIDERS.GITLAB) {
        return await this._gitlabPostComment(repo, prNumber, body);
      } else {
        return { success: false, error: `Unsupported provider: ${this.provider}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Set a commit status (pass/fail) on the PR head commit.
   *
   * @param {object} params
   * @param {string} params.repo - 'owner/repo'
   * @param {string} params.sha - Commit SHA
   * @param {boolean} params.pass - Whether the quality gate passed
   * @param {string} [params.description] - Status description
   * @param {string} [params.targetUrl] - Link to full report
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async setCommitStatus(params) {
    const { repo, sha, pass, description, targetUrl } = params;
    this._validateRequired({ repo, sha });

    const state = pass ? 'success' : 'failure';
    const desc = description || (pass ? 'Quality gate passed' : 'Quality gate failed');

    if (this.dryRun) {
      this._log(`[DRY RUN] Would set commit status ${state} on ${sha} in ${repo}`);
      return { success: true, dryRun: true, state };
    }

    try {
      if (this.provider === PROVIDERS.GITHUB) {
        return await this._githubSetStatus(repo, sha, state, desc, targetUrl);
      } else if (this.provider === PROVIDERS.GITLAB) {
        return await this._gitlabSetStatus(repo, sha, state, desc, targetUrl);
      }
      return { success: false, error: `Unsupported provider: ${this.provider}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Build a Markdown comment body from analysis results.
   * @param {object} analysis
   * @returns {string}
   */
  _buildCommentBody(analysis) {
    const { summary = {}, issues = [], smells = [], patterns = [] } = analysis;
    const allIssues = [...issues, ...smells, ...patterns];
    const total = summary.total || allIssues.length;
    const pass = total === 0;

    const lines = [
      `<!-- aqt-pr-comment -->`,
      `## ${pass ? '✅' : '❌'} Advanced Quality Tool Report`,
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total Issues | ${total} |`,
      `| Critical | ${summary.bySeverity?.CRITICAL || 0} |`,
      `| High | ${summary.bySeverity?.HIGH || 0} |`,
      `| Medium | ${summary.bySeverity?.MEDIUM || 0} |`,
      `| Low | ${summary.bySeverity?.LOW || 0} |`,
      `| Status | ${pass ? '✅ PASS' : '❌ FAIL'} |`,
      ''
    ];

    if (allIssues.length > 0) {
      lines.push('### Top Issues');
      allIssues.slice(0, 15).forEach(i => {
        const loc = i.line ? `:${i.line}` : '';
        const fp = i.filePath ? `\`${i.filePath}${loc}\` — ` : '';
        lines.push(`- **${i.severity || 'INFO'}** ${fp}${i.message}`);
      });
      if (allIssues.length > 15) {
        lines.push(`_...and ${allIssues.length - 15} more issues_`);
      }
    }

    lines.push('');
    lines.push(`_Generated by [Advanced Quality Tool](https://github.com/advanced-quality-tool) · ${new Date().toISOString()}_`);

    return lines.join('\n');
  }

  // ─── GitHub ─────────────────────────────────────────────────────────────────

  async _githubPostComment(repo, prNumber, body, updateExisting) {
    const commentsUrl = `/repos/${repo}/issues/${prNumber}/comments`;
    let commentId = null;

    if (updateExisting) {
      const existing = await this._githubRequest('GET', commentsUrl);
      if (existing.ok) {
        const found = existing.data.find(c => c.body && c.body.includes('<!-- aqt-pr-comment -->'));
        if (found) commentId = found.id;
      }
    }

    let result;
    if (commentId) {
      result = await this._githubRequest('PATCH', `/repos/${repo}/issues/comments/${commentId}`, { body });
    } else {
      result = await this._githubRequest('POST', commentsUrl, { body });
    }

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, commentId: result.data.id, url: result.data.html_url };
  }

  async _githubSetStatus(repo, sha, state, description, targetUrl) {
    const payload = {
      state,
      description,
      context: 'advanced-quality-tool',
      ...(targetUrl ? { target_url: targetUrl } : {})
    };
    const result = await this._githubRequest('POST', `/repos/${repo}/statuses/${sha}`, payload);
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, state };
  }

  async _githubRequest(method, path, body) {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'User-Agent': 'advanced-quality-tool/1.0',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(this.token ? { 'Authorization': `token ${this.token}` } : {})
      }
    };
    return this._request(options, body);
  }

  // ─── GitLab ─────────────────────────────────────────────────────────────────

  async _gitlabPostComment(projectId, mrIid, body) {
    const encodedId = encodeURIComponent(projectId);
    const result = await this._gitlabRequest(
      'POST',
      `/projects/${encodedId}/merge_requests/${mrIid}/notes`,
      { body }
    );
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, commentId: result.data.id };
  }

  async _gitlabSetStatus(projectId, sha, state, description, targetUrl) {
    const stateMap = { success: 'success', failure: 'failed', pending: 'pending' };
    const encodedId = encodeURIComponent(projectId);
    const payload = {
      state: stateMap[state] || 'failed',
      description,
      name: 'advanced-quality-tool',
      ...(targetUrl ? { target_url: targetUrl } : {})
    };
    const result = await this._gitlabRequest('POST', `/projects/${encodedId}/statuses/${sha}`, payload);
    if (!result.ok) return { success: false, error: result.error };
    return { success: true };
  }

  async _gitlabRequest(method, path, body) {
    const base = new URL(this.apiBase);
    const options = {
      hostname: base.hostname,
      path: base.pathname.replace(/\/$/, '') + path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'PRIVATE-TOKEN': this.token } : {})
      }
    };
    return this._request(options, body);
  }

  // ─── HTTP helper ────────────────────────────────────────────────────────────

  _request(options, body) {
    return new Promise((resolve) => {
      const payload = body ? JSON.stringify(body) : null;
      if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

      const lib = options.hostname.startsWith('localhost') ? http : https;
      const req = lib.request(options, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : {};
            const ok = res.statusCode >= 200 && res.statusCode < 300;
            resolve({ ok, statusCode: res.statusCode, data, error: ok ? null : (data.message || raw) });
          } catch {
            resolve({ ok: false, statusCode: res.statusCode, data: null, error: raw });
          }
        });
      });
      req.on('error', err => resolve({ ok: false, error: err.message }));
      if (payload) req.write(payload);
      req.end();
    });
  }

  _validateRequired(params) {
    for (const [key, val] of Object.entries(params)) {
      if (val === undefined || val === null || val === '') {
        throw new Error(`PRIntegrator: missing required parameter '${key}'`);
      }
    }
  }

  _log(msg) { if (this.verbose) console.log(`[PRIntegrator] ${msg}`); }
}

module.exports = { PRIntegrator, PROVIDERS };

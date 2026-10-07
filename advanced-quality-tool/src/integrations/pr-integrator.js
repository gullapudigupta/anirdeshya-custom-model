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
  BITBUCKET: 'bitbucket',
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
                     : this.provider === PROVIDERS.BITBUCKET
                       ? 'https://api.bitbucket.org/2.0'
                       : 'https://api.github.com');
    this.maxRetries = Number.isInteger(options.maxRetries) ? Math.max(0, options.maxRetries) : 2;
    this.retryDelayMs = Number.isFinite(options.retryDelayMs) ? Math.max(0, options.retryDelayMs) : 250;
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
      } else if (this.provider === PROVIDERS.BITBUCKET) {
        return await this._bitbucketPostComment(repo, prNumber, body);
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
      } else if (this.provider === PROVIDERS.BITBUCKET) {
        return await this._bitbucketSetStatus(repo, sha, state, desc, targetUrl);
      }
      return { success: false, error: `Unsupported provider: ${this.provider}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Post a review comment attached to a specific changed file and line.
   * GitLab requires all three diff SHAs to construct an inline position.
   */
  async postInlineComment(params) {
      const { repo, prNumber, path, line, body, commitSha, baseSha, startSha, headSha } = params || {};
      this._validateRequired({ repo, prNumber, path, line, body });
      if (!Number.isInteger(Number(line)) || Number(line) < 1) {
        throw new Error('PRIntegrator: line must be a positive integer');
      }
      if (this.dryRun) return { success: true, dryRun: true, path, line, body };

      try {
        let result;
        if (this.provider === PROVIDERS.GITHUB) {
          this._validateRequired({ commitSha });
          result = await this._githubRequest('POST', `/repos/${repo}/pulls/${prNumber}/comments`, {
            body, commit_id: commitSha, path, line: Number(line), side: 'RIGHT'
          });
        } else if (this.provider === PROVIDERS.GITLAB) {
          this._validateRequired({ baseSha, startSha, headSha });
          result = await this._gitlabRequest(
            'POST',
            `/projects/${encodeURIComponent(repo)}/merge_requests/${prNumber}/discussions`,
            {
              body,
              position: {
                position_type: 'text', base_sha: baseSha, start_sha: startSha, head_sha: headSha,
                new_path: path, new_line: Number(line)
              }
            }
          );
        } else if (this.provider === PROVIDERS.BITBUCKET) {
          const slug = this._bitbucketSlug(repo);
          result = await this._bitbucketRequest(
            'POST',
            `/repositories/${slug}/pullrequests/${prNumber}/comments`,
            { content: { raw: body }, inline: { path, to: Number(line) } }
          );
        } else {
          return { success: false, error: `Inline comments are unsupported for provider: ${this.provider}` };
        }
        return result.ok
          ? { success: true, commentId: result.data.id, url: result.data.html_url || result.data.links?.html?.href }
          : { success: false, error: result.error };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

  async postFileComment(params) {
    return this.postInlineComment(params);
  }

  async updatePRDescription(params) {
      const { repo, prNumber, description } = params || {};
      this._validateRequired({ repo, prNumber, description });
      if (this.dryRun) return { success: true, dryRun: true, description };

      try {
        let result;
        if (this.provider === PROVIDERS.GITHUB) {
          result = await this._githubRequest('PATCH', `/repos/${repo}/pulls/${prNumber}`, { body: description });
        } else if (this.provider === PROVIDERS.GITLAB) {
          result = await this._gitlabRequest(
            'PUT',
            `/projects/${encodeURIComponent(repo)}/merge_requests/${prNumber}`,
            { description }
          );
        } else if (this.provider === PROVIDERS.BITBUCKET) {
          result = await this._bitbucketRequest(
            'PUT',
            `/repositories/${this._bitbucketSlug(repo)}/pullrequests/${prNumber}`,
            { description }
          );
        } else {
          return { success: false, error: `Description updates are unsupported for provider: ${this.provider}` };
        }
        return result.ok ? { success: true, url: result.data.html_url || result.data.links?.html?.href } :
          { success: false, error: result.error };
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

  _bitbucketSlug(repo) {
    const parts = String(repo).split('/');
    if (parts.length !== 2 || parts.some(part => !part || part === '.' || part === '..')) {
      throw new Error("PRIntegrator: Bitbucket repo must be 'workspace/repository'");
    }
    return parts.map(encodeURIComponent).join('/');
  }

  async _bitbucketPostComment(repo, prNumber, body) {
    const result = await this._bitbucketRequest(
      'POST',
      `/repositories/${this._bitbucketSlug(repo)}/pullrequests/${prNumber}/comments`,
      { content: { raw: body } }
    );
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, commentId: result.data.id, url: result.data.links?.html?.href };
  }

  async _bitbucketSetStatus(repo, sha, state, description, targetUrl) {
    const stateMap = { success: 'SUCCESSFUL', failure: 'FAILED', pending: 'INPROGRESS' };
    const result = await this._bitbucketRequest(
      'POST',
      `/repositories/${this._bitbucketSlug(repo)}/commit/${encodeURIComponent(sha)}/statuses/build`,
      {
        key: 'AQT',
        name: 'Advanced Quality Tool',
        state: stateMap[state] || 'FAILED',
        description,
        ...(targetUrl ? { url: targetUrl } : {})
      }
    );
    return result.ok ? { success: true, state } : { success: false, error: result.error };
  }

  async _bitbucketRequest(method, requestPath, body) {
    const base = new URL(this.apiBase);
    return this._request({
      hostname: base.hostname,
      path: base.pathname.replace(/\/$/, '') + requestPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'Authorization': 'Bearer ' + this.token } : {})
      }
    }, body);
  }

  // ─── HTTP helper ────────────────────────────────────────────────────────────

  async _request(options, body) {
    let result;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      result = await this._requestOnce(options, body);
      const transient = result.statusCode === 429 ||
        result.statusCode === 500 || result.statusCode === 502 ||
        result.statusCode === 503 || result.statusCode === 504 ||
        result.statusCode === 0;
      if (!transient || attempt === this.maxRetries) return result;
      const delay = result.retryAfterMs || this.retryDelayMs * (2 ** attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return result;
  }

  _requestOnce(options, body) {
    if (typeof this.options.requestFn === 'function') {
      return Promise.resolve(this.options.requestFn(options, body));
    }
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
            const retryAfter = Number(res.headers['retry-after']);
            resolve({
              ok, statusCode: res.statusCode, data, error: ok ? null : (data.message || raw),
              retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0
            });
          } catch {
            resolve({ ok: false, statusCode: res.statusCode, data: null, error: raw });
          }
        });
      });
      req.on('error', err => resolve({ ok: false, statusCode: 0, error: err.message }));
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

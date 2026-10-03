/**
 * Branch Analyzer
 *
 * Compares code quality issues across Git branches and pull requests.
 * Uses `git diff` and the existing analysis pipeline to surface new/fixed issues.
 *
 * Inspired by: SonarQube branch analysis
 *
 * @module integrations/branch-analyzer
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');

class BranchAnalyzer {
  /**
   * @param {object} [options={}]
   * @param {string} [options.cwd=process.cwd()] - Git repository root
   * @param {boolean} [options.verbose=false]
   * @param {object} [options.analyzer] - An analyzer with analyze(filePath, content) method
   */
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.cwd = options.cwd || process.cwd();
    this.analyzer = options.analyzer || null;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Get the current branch name.
   * @returns {string}
   */
  getCurrentBranch() {
    return this._git('rev-parse --abbrev-ref HEAD').trim();
  }

  /**
   * List all local branches.
   * @returns {string[]}
   */
  listBranches() {
    return this._git('branch --format=%(refname:short)')
      .split('\n')
      .map(b => b.trim())
      .filter(Boolean);
  }

  /**
   * Get the list of files changed between two refs.
   * @param {string} base - Base branch/commit
   * @param {string} [head='HEAD'] - Head branch/commit
   * @returns {Array<{status: string, filePath: string}>}
   */
  getChangedFiles(base, head = 'HEAD') {
    const output = this._git(`diff --name-status ${base}...${head}`);
    return output.split('\n')
      .filter(Boolean)
      .map(line => {
        const parts = line.split('\t');
        return { status: parts[0], filePath: parts[1] || parts[parts.length - 1] };
      });
  }

  /**
   * Get unified diff between two refs for a specific file.
   * @param {string} base
   * @param {string} head
   * @param {string} filePath
   * @returns {string} Unified diff text
   */
  getFileDiff(base, head, filePath) {
    return this._git(`diff ${base}...${head} -- "${filePath}"`);
  }

  /**
   * Get file content at a specific ref.
   * @param {string} ref - Branch name or commit hash
   * @param {string} filePath
   * @returns {string|null}
   */
  getFileAtRef(ref, filePath) {
    try {
      return this._git(`show ${ref}:${filePath}`);
    } catch {
      return null;
    }
  }

  /**
   * Compare issues between base and head branches.
   * Requires an analyzer to be set in options.
   *
   * @param {string} base - Base branch (e.g. 'main')
   * @param {string} [head='HEAD'] - Feature branch
   * @returns {{ newIssues: object[], fixedIssues: object[], changedFiles: string[], summary: object }}
   */
  compareIssues(base, head = 'HEAD') {
    if (!this.analyzer) {
      throw new Error('No analyzer configured. Pass options.analyzer to BranchAnalyzer.');
    }

    const changedFiles = this.getChangedFiles(base, head)
      .filter(f => ['A', 'M', 'D'].includes(f.status[0]))
      .map(f => f.filePath);

    this._log(`Comparing ${changedFiles.length} changed files between ${base} and ${head}`);

    const baseIssues = [];
    const headIssues = [];

    for (const filePath of changedFiles) {
      const baseContent = this.getFileAtRef(base, filePath);
      const headContent = this.getFileAtRef(head, filePath);

      if (baseContent) {
        const result = this.analyzer.analyze(filePath, baseContent);
        baseIssues.push(...(result.issues || result.smells || []));
      }
      if (headContent) {
        const result = this.analyzer.analyze(filePath, headContent);
        headIssues.push(...(result.issues || result.smells || []));
      }
    }

    const newIssues = this._diffIssues(headIssues, baseIssues);
    const fixedIssues = this._diffIssues(baseIssues, headIssues);

    return {
      base,
      head,
      changedFiles,
      newIssues,
      fixedIssues,
      summary: {
        changedFileCount: changedFiles.length,
        newIssueCount: newIssues.length,
        fixedIssueCount: fixedIssues.length,
        netChange: newIssues.length - fixedIssues.length
      }
    };
  }

  /**
   * Generate a pull request summary comment in Markdown.
   * @param {object} comparison - Result of compareIssues()
   * @returns {string}
   */
  generatePRSummary(comparison) {
    const { base, head, summary, newIssues, fixedIssues, changedFiles } = comparison;
    const lines = [
      `## 🔍 Code Quality Analysis: \`${head}\` → \`${base}\``,
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Changed Files | ${summary.changedFileCount} |`,
      `| New Issues | ${summary.newIssueCount} |`,
      `| Fixed Issues | ${summary.fixedIssueCount} |`,
      `| Net Change | ${summary.netChange >= 0 ? '+' : ''}${summary.netChange} |`,
      ''
    ];

    if (newIssues.length > 0) {
      lines.push('### ❌ New Issues Introduced');
      newIssues.slice(0, 20).forEach(issue => {
        const loc = issue.line ? `:${issue.line}` : '';
        lines.push(`- **${issue.severity || issue.smellType || issue.type}** \`${issue.filePath}${loc}\`: ${issue.message}`);
      });
      if (newIssues.length > 20) lines.push(`_...and ${newIssues.length - 20} more_`);
      lines.push('');
    }

    if (fixedIssues.length > 0) {
      lines.push('### ✅ Issues Fixed');
      fixedIssues.slice(0, 10).forEach(issue => {
        lines.push(`- ~~${issue.message}~~`);
      });
      if (fixedIssues.length > 10) lines.push(`_...and ${fixedIssues.length - 10} more_`);
      lines.push('');
    }

    lines.push('---');
    lines.push(`_Generated by Advanced Quality Tool on ${new Date().toISOString()}_`);

    return lines.join('\n');
  }

  /**
   * Get commit log between two refs.
   * @param {string} base
   * @param {string} [head='HEAD']
   * @returns {Array<{hash: string, author: string, date: string, message: string}>}
   */
  getCommitLog(base, head = 'HEAD') {
    const output = this._git(`log ${base}..${head} --pretty=format:%H|%an|%ad|%s --date=short`);
    return output.split('\n').filter(Boolean).map(line => {
      const [hash, author, date, ...msgParts] = line.split('|');
      return { hash, author, date, message: msgParts.join('|') };
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Issues in `a` that are not in `b` (by filePath + message fingerprint).
   */
  _diffIssues(a, b) {
    const bKeys = new Set(b.map(i => `${i.filePath}::${i.message}`));
    return a.filter(i => !bKeys.has(`${i.filePath}::${i.message}`));
  }

  _git(command) {
    try {
      return execSync(`git ${command}`, {
        cwd: this.cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      this._log(`git ${command} failed: ${err.message}`);
      return '';
    }
  }

  _log(msg) {
    if (this.verbose) console.log(`[BranchAnalyzer] ${msg}`);
  }
}

module.exports = { BranchAnalyzer };

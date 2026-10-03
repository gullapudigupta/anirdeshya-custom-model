/**
 * Team Collaboration Features
 *
 * Provides issue assignment, commenting, status tracking, and
 * team workflow management for code quality issues.
 *
 * Storage: file-system backed JSON store under .quality-tool/collaboration/
 * All operations are synchronous for simplicity; async wrappers provided
 * for future migration to a database backend.
 *
 * @module integrations/team-collaboration
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Issue workflow states */
const STATES = {
  OPEN:        'open',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW:   'in_review',
  RESOLVED:    'resolved',
  WONT_FIX:   'wont_fix',
  DISMISSED:  'dismissed'
};

/** Valid state transitions */
const TRANSITIONS = {
  open:        ['in_progress', 'wont_fix', 'dismissed'],
  in_progress: ['in_review', 'open', 'wont_fix'],
  in_review:   ['resolved', 'in_progress'],
  resolved:    ['open'],       // can re-open
  wont_fix:    ['open'],
  dismissed:   ['open']
};

class TeamCollaboration {
  /**
   * @param {object} [options={}]
   * @param {string} [options.dataDir]    - Directory for persisted collaboration data
   * @param {string} [options.currentUser] - Name/email of the acting user (for audit trail)
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options     = options;
    this.verbose     = options.verbose || false;
    this.currentUser = options.currentUser || process.env.GIT_AUTHOR_NAME || 'unknown';
    this.dataDir     = options.dataDir ||
                       path.join(process.cwd(), '.quality-tool', 'collaboration');
    this._ensureDataDir();
  }

  // ─── Issues ────────────────────────────────────────────────────────────────

  /**
   * Create or update a tracked issue record.
   * @param {object} issue - Must contain at minimum { id, filePath, message, severity }
   * @returns {object} Saved issue record
   */
  trackIssue(issue) {
    this._validate(issue, ['id', 'filePath', 'message']);
    const existing = this._loadIssue(issue.id);
    const record = Object.assign({
      state:      STATES.OPEN,
      assignee:   null,
      tags:       [],
      createdAt:  new Date().toISOString(),
      createdBy:  this.currentUser,
      updatedAt:  new Date().toISOString(),
      comments:   []
    }, existing || {}, issue, {
      updatedAt: new Date().toISOString()
    });
    this._saveIssue(record);
    this._log(`Tracked issue: ${record.id}`);
    return record;
  }

  /**
   * Assign an issue to a team member.
   * @param {string} issueId
   * @param {string} assignee - User name or email
   * @returns {object} Updated issue
   */
  assignIssue(issueId, assignee) {
    const issue = this._requireIssue(issueId);
    const prev  = issue.assignee;
    issue.assignee  = assignee;
    issue.updatedAt = new Date().toISOString();
    if (issue.state === STATES.OPEN) issue.state = STATES.IN_PROGRESS;
    this._addAuditEvent(issue, 'assigned', { from: prev, to: assignee });
    this._saveIssue(issue);
    return issue;
  }

  /**
   * Unassign an issue.
   * @param {string} issueId
   * @returns {object} Updated issue
   */
  unassignIssue(issueId) {
    const issue = this._requireIssue(issueId);
    issue.assignee  = null;
    issue.state     = STATES.OPEN;
    issue.updatedAt = new Date().toISOString();
    this._addAuditEvent(issue, 'unassigned', {});
    this._saveIssue(issue);
    return issue;
  }

  /**
   * Transition an issue to a new state.
   * @param {string} issueId
   * @param {string} newState - One of STATES values
   * @returns {object} Updated issue
   */
  transitionIssue(issueId, newState) {
    const issue = this._requireIssue(issueId);
    const allowed = TRANSITIONS[issue.state] || [];
    if (!allowed.includes(newState)) {
      throw new Error(
        `Cannot transition issue '${issueId}' from '${issue.state}' to '${newState}'. ` +
        `Allowed transitions: ${allowed.join(', ')}`
      );
    }
    const prevState = issue.state;
    issue.state     = newState;
    issue.updatedAt = new Date().toISOString();
    this._addAuditEvent(issue, 'state_changed', { from: prevState, to: newState });
    this._saveIssue(issue);
    return issue;
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  /**
   * Add a comment to an issue.
   * @param {string} issueId
   * @param {string} text
   * @param {object} [meta={}] - Extra metadata (e.g. { type: 'suggestion' })
   * @returns {object} The new comment
   */
  addComment(issueId, text, meta = {}) {
    if (!text || !text.trim()) throw new Error('Comment text cannot be empty.');
    const issue   = this._requireIssue(issueId);
    const comment = {
      id:        this._uid(),
      author:    this.currentUser,
      text:      text.trim(),
      createdAt: new Date().toISOString(),
      ...meta
    };
    issue.comments.push(comment);
    issue.updatedAt = new Date().toISOString();
    this._saveIssue(issue);
    return comment;
  }

  /**
   * Edit an existing comment.
   * @param {string} issueId
   * @param {string} commentId
   * @param {string} newText
   * @returns {object} Updated comment
   */
  editComment(issueId, commentId, newText) {
    const issue   = this._requireIssue(issueId);
    const comment = issue.comments.find(c => c.id === commentId);
    if (!comment) throw new Error(`Comment '${commentId}' not found on issue '${issueId}'.`);
    comment.text      = newText.trim();
    comment.editedAt  = new Date().toISOString();
    issue.updatedAt   = new Date().toISOString();
    this._saveIssue(issue);
    return comment;
  }

  /**
   * Delete a comment from an issue.
   * @param {string} issueId
   * @param {string} commentId
   */
  deleteComment(issueId, commentId) {
    const issue = this._requireIssue(issueId);
    const idx   = issue.comments.findIndex(c => c.id === commentId);
    if (idx === -1) throw new Error(`Comment '${commentId}' not found.`);
    issue.comments.splice(idx, 1);
    issue.updatedAt = new Date().toISOString();
    this._saveIssue(issue);
  }

  // ─── Tags ──────────────────────────────────────────────────────────────────

  /**
   * Add tags to an issue.
   * @param {string} issueId
   * @param {string[]} tags
   * @returns {object} Updated issue
   */
  addTags(issueId, tags) {
    const issue = this._requireIssue(issueId);
    issue.tags  = [...new Set([...(issue.tags || []), ...tags])];
    issue.updatedAt = new Date().toISOString();
    this._saveIssue(issue);
    return issue;
  }

  /**
   * Remove tags from an issue.
   * @param {string} issueId
   * @param {string[]} tags
   * @returns {object} Updated issue
   */
  removeTags(issueId, tags) {
    const issue = this._requireIssue(issueId);
    issue.tags  = (issue.tags || []).filter(t => !tags.includes(t));
    issue.updatedAt = new Date().toISOString();
    this._saveIssue(issue);
    return issue;
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  /**
   * Get a single issue by ID.
   * @param {string} issueId
   * @returns {object|null}
   */
  getIssue(issueId) {
    return this._loadIssue(issueId);
  }

  /**
   * List issues with optional filters.
   * @param {object} [filters={}]
   * @param {string}   [filters.state]    - Filter by state
   * @param {string}   [filters.assignee] - Filter by assignee
   * @param {string}   [filters.filePath] - Filter by file path (substring match)
   * @param {string[]} [filters.tags]     - Filter by tags (any match)
   * @param {string}   [filters.severity] - Filter by severity
   * @returns {object[]}
   */
  listIssues(filters = {}) {
    const all = this._loadAllIssues();
    return all.filter(issue => {
      if (filters.state    && issue.state    !== filters.state)    return false;
      if (filters.assignee && issue.assignee !== filters.assignee) return false;
      if (filters.severity && issue.severity !== filters.severity) return false;
      if (filters.filePath && !issue.filePath.includes(filters.filePath)) return false;
      if (filters.tags && filters.tags.length > 0) {
        if (!filters.tags.some(t => (issue.tags || []).includes(t))) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  /**
   * Get a summary of issue counts by state and assignee.
   * @returns {object}
   */
  getSummary() {
    const all = this._loadAllIssues();
    const byState    = {};
    const byAssignee = {};
    const bySeverity = {};

    for (const issue of all) {
      byState[issue.state]          = (byState[issue.state]          || 0) + 1;
      byAssignee[issue.assignee || 'unassigned'] = (byAssignee[issue.assignee || 'unassigned'] || 0) + 1;
      bySeverity[issue.severity || 'UNKNOWN']    = (bySeverity[issue.severity || 'UNKNOWN']    || 0) + 1;
    }

    return { total: all.length, byState, byAssignee, bySeverity };
  }

  /**
   * Get issues assigned to a specific user.
   * @param {string} user
   * @returns {object[]}
   */
  getMyIssues(user) {
    return this.listIssues({ assignee: user || this.currentUser });
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  _saveIssue(issue) {
    const filePath = path.join(this.dataDir, `${issue.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(issue, null, 2) + '\n');
  }

  _loadIssue(issueId) {
    const filePath = path.join(this.dataDir, `${issueId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return null; }
  }

  _requireIssue(issueId) {
    const issue = this._loadIssue(issueId);
    if (!issue) throw new Error(`Issue '${issueId}' not found.`);
    return issue;
  }

  _loadAllIssues() {
    if (!fs.existsSync(this.dataDir)) return [];
    return fs.readdirSync(this.dataDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(this.dataDir, f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean);
  }

  _ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _addAuditEvent(issue, type, data) {
    if (!issue.auditTrail) issue.auditTrail = [];
    issue.auditTrail.push({
      type,
      by:  this.currentUser,
      at:  new Date().toISOString(),
      ...data
    });
  }

  _validate(obj, required) {
    for (const field of required) {
      if (!obj[field]) throw new Error(`Missing required field: '${field}'`);
    }
  }

  _uid() {
    return crypto.randomBytes(6).toString('hex');
  }

  _log(msg) { if (this.verbose) console.log(`[TeamCollaboration] ${msg}`); }
}

module.exports = { TeamCollaboration, STATES, TRANSITIONS };

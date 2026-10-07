/**
 * Diff Review, Apply, Reject, and Rollback System
 * Task: P9-T015
 * 
 * Presents proposed edits as file-grouped unified diffs with apply, reject, and rollback capabilities.
 * Uses atomic writes, pre-write validation, backups, and stale-source checks.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function isWithinPath(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === '' ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`));
}

/**
 * Represents a single file diff
 */
class FileDiff {
  constructor(filePath, originalContent, modifiedContent, metadata = {}) {
    this.filePath = filePath;
    this.originalContent = originalContent;
    this.modifiedContent = modifiedContent;
    this.type = metadata.type || 'modify';
    this.expectedHash = metadata.expectedHash || hashContent(originalContent);
    this.planDigest = metadata.planDigest || null;
    this.patchDigest = metadata.patchDigest || null;
    this.structuredPatch = metadata.structuredPatch === true;
    this.reviewPath = metadata.reviewPath || filePath;
    this.hunks = this.computeHunks();
    this.status = 'pending'; // pending, applied, rejected, failed
    this.backupPath = null;
    this.error = null;
  }

  /**
   * Compute diff hunks between original and modified content
   */
  computeHunks() {
    const originalLines = this.originalContent.split('\n');
    const modifiedLines = (this.modifiedContent || '').split('\n');
    const hunks = [];
    
    let originalLine = 1;
    let modifiedLine = 1;
    let currentHunk = null;
    
    // Simple line-by-line diff algorithm
    const lcs = this.longestCommonSubsequence(originalLines, modifiedLines);
    
    let origIdx = 0;
    let modIdx = 0;
    let lcsIdx = 0;
    
    while (origIdx < originalLines.length || modIdx < modifiedLines.length) {
      if (lcsIdx < lcs.length && origIdx < originalLines.length && 
          originalLines[origIdx] === lcs[lcsIdx] && 
          modIdx < modifiedLines.length && modifiedLines[modIdx] === lcs[lcsIdx]) {
        // Match - context line
        if (currentHunk && currentHunk.lines.length > 0) {
          currentHunk.lines.push({
            type: 'context',
            content: originalLines[origIdx],
            originalLine: origIdx + 1,
            modifiedLine: modIdx + 1
          });
          currentHunk.contextLines++;
          if (currentHunk.contextLines >= 3) {
            hunks.push(currentHunk);
            currentHunk = null;
          }
        }
        origIdx++;
        modIdx++;
        lcsIdx++;
        originalLine++;
        modifiedLine++;
      } else if (modIdx < modifiedLines.length && 
                 (lcsIdx >= lcs.length || modifiedLines[modIdx] !== lcs[lcsIdx])) {
        // Addition
        if (!currentHunk) {
          currentHunk = {
            startLine: modifiedLine,
            lines: [],
            additions: 0,
            deletions: 0,
            contextLines: 0
          };
        }
        currentHunk.lines.push({
          type: 'addition',
          content: modifiedLines[modIdx],
          originalLine: null,
          modifiedLine: modIdx + 1
        });
        currentHunk.additions++;
        currentHunk.contextLines = 0;
        modIdx++;
        modifiedLine++;
      } else if (origIdx < originalLines.length) {
        // Deletion
        if (!currentHunk) {
          currentHunk = {
            startLine: originalLine,
            lines: [],
            additions: 0,
            deletions: 0,
            contextLines: 0
          };
        }
        currentHunk.lines.push({
          type: 'deletion',
          content: originalLines[origIdx],
          originalLine: origIdx + 1,
          modifiedLine: null
        });
        currentHunk.deletions++;
        currentHunk.contextLines = 0;
        origIdx++;
        originalLine++;
      }
    }
    
    if (currentHunk && currentHunk.lines.length > 0) {
      hunks.push(currentHunk);
    }
    
    return hunks;
  }

  /**
   * Compute longest common subsequence for diff algorithm
   */
  longestCommonSubsequence(arr1, arr2) {
    const m = arr1.length;
    const n = arr2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (arr1[i - 1] === arr2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    
    // Backtrack to find LCS
    const lcs = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (arr1[i - 1] === arr2[j - 1]) {
        lcs.unshift(arr1[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    
    return lcs;
  }

  /**
   * Generate unified diff format string
   */
  toUnifiedDiff() {
    const lines = [];
    const displayPath = path.normalize(this.reviewPath)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    lines.push(`--- a/${displayPath}`);
    lines.push(`+++ b/${displayPath}`);
    
    for (const hunk of this.hunks) {
      const oldStart = hunk.lines.find(l => l.originalLine)?.originalLine || 1;
      const newStart = hunk.lines.find(l => l.modifiedLine)?.modifiedLine || 1;
      const oldCount = hunk.lines.filter(l => l.type === 'deletion' || l.type === 'context').length;
      const newCount = hunk.lines.filter(l => l.type === 'addition' || l.type === 'context').length;
      
      lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
      
      for (const line of hunk.lines) {
        if (line.type === 'addition') {
          lines.push(`+${line.content}`);
        } else if (line.type === 'deletion') {
          lines.push(`-${line.content}`);
        } else {
          lines.push(` ${line.content}`);
        }
      }
    }
    
    return lines.join('\n');
  }
}

/**
 * Manages file backups for rollback
 */
class BackupManager {
  constructor(backupDir = '.aqt-backups') {
    this.backupDir = backupDir;
    this.backups = new Map();
  }

  /**
   * Create backup of a file before modification
   */
  createBackup(filePath, content) {
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(filePath).digest('hex').substring(0, 8);
    const backupFileName = `${timestamp}-${hash}-${path.basename(filePath)}`;
    const backupPath = path.join(this.backupDir, backupFileName);
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
    
    // Write backup
    fs.writeFileSync(backupPath, content, 'utf8');
    
    this.backups.set(filePath, {
      path: backupPath,
      timestamp,
      originalPath: filePath,
      content
    });
    
    return backupPath;
  }

  /**
   * Restore file from backup
   */
  restore(filePath) {
    const backup = this.backups.get(filePath);
    if (!backup) {
      throw new Error(`No backup found for ${filePath}`);
    }
    
    if (!fs.existsSync(backup.path)) {
      throw new Error(`Backup file not found: ${backup.path}`);
    }
    
    fs.writeFileSync(filePath, backup.content, 'utf8');
    return true;
  }

  /**
   * Clean up old backups
   */
  cleanup(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
    const now = Date.now();
    const toDelete = [];
    
    for (const [filePath, backup] of this.backups) {
      if (now - backup.timestamp > maxAge) {
        if (fs.existsSync(backup.path)) {
          fs.unlinkSync(backup.path);
        }
        toDelete.push(filePath);
      }
    }
    
    for (const filePath of toDelete) {
      this.backups.delete(filePath);
    }
  }
}

/**
 * Main Diff Review System
 */
class DiffReviewSystem {
  constructor(options = {}) {
    this.workspace = options.workspace ? path.resolve(options.workspace) : null;
    this.maxChangedFiles = options.maxChangedFiles === undefined ? 50 : options.maxChangedFiles;
    if (!Number.isSafeInteger(this.maxChangedFiles) || this.maxChangedFiles <= 0) {
      throw new Error('maxChangedFiles must be a positive safe integer');
    }
    this.backupManager = new BackupManager(options.backupDir ||
      (this.workspace ? path.join(this.workspace, '.aqt-backups') : '.aqt-backups'));
    this.diffs = [];
    this.status = {
      pending: 0,
      applied: 0,
      rejected: 0,
      failed: 0
    };
  }

  /**
   * Add a file diff for review
   */
  addDiff(filePath, originalContent, modifiedContent) {
    const createsFile = originalContent === '' && !fs.existsSync(filePath);
    const diff = new FileDiff(filePath, originalContent, modifiedContent, {
      type: createsFile ? 'create' : 'modify',
      expectedHash: createsFile ? null : hashContent(originalContent)
    });
    this.diffs.push(diff);
    this.status.pending++;
    return diff;
  }

  /**
   * Add a validated structured operation. Paths are relative to the configured workspace.
   */
  addPatch(patch, options = {}) {
    if (!this.workspace) throw new Error('A workspace is required for structured patches');
    if (!/^[a-f0-9]{64}$/.test(options.planDigest || '') ||
        !/^[a-f0-9]{64}$/.test(options.patchDigest || '')) {
      throw new Error('Structured patches require plan and patch SHA-256 digests');
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Patch must be an object');
    }
    if (!['create', 'modify', 'delete'].includes(patch.type)) {
      throw new Error(`Unsupported patch operation: ${patch.type}`);
    }
    if (typeof patch.filePath !== 'string' || !patch.filePath.trim() ||
        path.isAbsolute(patch.filePath) || patch.filePath.includes('\0')) {
      throw new Error('Patch path must be a non-empty workspace-relative path');
    }
    if (typeof patch.originalContent !== 'string' && patch.originalContent !== null) {
      throw new Error('Patch originalContent must be a string or null');
    }
    if (typeof patch.modifiedContent !== 'string') {
      throw new Error('Patch modifiedContent must be a string');
    }
    if (patch.type === 'create' && patch.originalContent !== null) {
      throw new Error('Create patch must not have original content');
    }
    if (patch.type !== 'create' && typeof patch.originalContent !== 'string') {
      throw new Error(`${patch.type} patch requires expected original content`);
    }
    if (patch.type === 'delete' && patch.modifiedContent !== '') {
      throw new Error('Delete patch must have empty modified content');
    }
    if (patch.type !== 'delete' && patch.modifiedContent.length === 0) {
      throw new Error('Empty create or modify patches are not allowed');
    }
    if (patch.originalContent === patch.modifiedContent) {
      throw new Error('No-op patches are not allowed');
    }
    if (this.diffs.length >= this.maxChangedFiles) {
      throw new Error(`Changed-file limit (${this.maxChangedFiles}) exceeded`);
    }

    const absolutePath = this._resolveWorkspacePath(patch.filePath);
    const current = this._readWorkspaceFile(absolutePath);
    if (patch.type === 'create') {
      if (current !== null) throw new Error(`Create target already exists: ${patch.filePath}`);
    } else if (current === null) {
      throw new Error(`Patch source does not exist: ${patch.filePath}`);
    } else if (current !== patch.originalContent) {
      throw new Error(`Expected original content does not match: ${patch.filePath}`);
    }
    const expectedHash = patch.expectedHash || (patch.originalContent === null
      ? null
      : hashContent(patch.originalContent));
    if (expectedHash !== null && expectedHash !== hashContent(patch.originalContent)) {
      throw new Error(`Expected content hash does not match original content: ${patch.filePath}`);
    }

    const diff = new FileDiff(absolutePath, patch.originalContent || '',
      patch.modifiedContent, {
        type: patch.type,
        expectedHash,
        planDigest: options.planDigest,
        patchDigest: options.patchDigest,
        structuredPatch: true,
        reviewPath: path.relative(this.workspace, absolutePath).split(path.sep).join('/')
      });
    this.diffs.push(diff);
    this.status.pending++;
    return diff;
  }

  validatePatchPath(filePath) {
    if (!this.workspace) throw new Error('A workspace is required for structured patches');
    return this._resolveWorkspacePath(filePath);
  }

  _resolveWorkspacePath(filePath) {
    const absolutePath = path.resolve(this.workspace, filePath);
    if (!isWithinPath(this.workspace, absolutePath) || absolutePath === this.workspace) {
      throw new Error(`Patch path is outside workspace boundaries: ${filePath}`);
    }
    const relativePath = path.relative(this.workspace, absolutePath);
    let current = this.workspace;
    for (const segment of relativePath.split(path.sep)) {
      current = path.join(current, segment);
      try {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
          const realPath = fs.realpathSync(current);
          if (!isWithinPath(fs.realpathSync(this.workspace), realPath)) {
            throw new Error(`Patch path resolves outside workspace (symlink escape): ${filePath}`);
          }
          throw new Error(`Patch path traverses a symbolic link: ${filePath}`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return absolutePath;
  }

  _readWorkspaceFile(absolutePath) {
    try {
      const stat = fs.lstatSync(absolutePath);
      if (!stat.isFile()) throw new Error(`Patch target is not a regular file: ${absolutePath}`);
      return fs.readFileSync(absolutePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Get all diffs grouped by status
   */
  getDiffsByStatus() {
    const grouped = {
      pending: [],
      applied: [],
      rejected: [],
      failed: [],
      'rolled-back': []
    };
    
    for (const diff of this.diffs) {
      grouped[diff.status].push(diff);
    }
    
    return grouped;
  }

  /**
   * Present diffs in reviewable format
   */
  presentForReview() {
    const output = {
      summary: {
        total: this.diffs.length,
        ...this.status
      },
      files: []
    };
    
    for (const diff of this.diffs) {
      const fileInfo = {
        path: diff.reviewPath,
        operation: diff.type,
        status: diff.status,
        additions: diff.hunks.reduce((sum, h) => sum + h.additions, 0),
        deletions: diff.hunks.reduce((sum, h) => sum + h.deletions, 0),
        hunks: diff.hunks.length,
        diff: diff.toUnifiedDiff()
      };
      
      if (diff.error) {
        fileInfo.error = diff.error;
      }
      
      output.files.push(fileInfo);
    }
    
    return output;
  }

  /**
   * Validate before applying changes
   */
  validateBeforeApply(diff) {
    const currentContent = this.workspace
      ? this._readWorkspaceFile(diff.filePath)
      : fs.existsSync(diff.filePath) ? fs.readFileSync(diff.filePath, 'utf8') : null;

    if (this.workspace) {
      try {
        this._resolveWorkspacePath(path.relative(this.workspace, diff.filePath));
      } catch (error) {
        return { valid: false, reason: error.message };
      }
    }

    if (diff.type === 'create') {
      if (currentContent !== null) {
        return { valid: false, code: 'PATCH_CONFLICT', reason: 'Create target already exists (stale patch conflict)' };
      }
      return { valid: true };
    }

    if (currentContent === null || currentContent !== diff.originalContent ||
        (diff.expectedHash && hashContent(currentContent) !== diff.expectedHash)) {
      return {
        valid: false,
        code: 'PATCH_CONFLICT',
        reason: 'Source file has changed since patch was created (stale source)',
        currentContent
      };
    }
    return { valid: true };
  }

  /**
   * Apply a single diff
   */
  async applyDiff(diffIndex, options = {}) {
    const diff = this.diffs[diffIndex];
    if (!diff) {
      throw new Error(`Diff index ${diffIndex} not found`);
    }
    
    if (diff.status !== 'pending') {
      throw new Error(`Diff already ${diff.status}`);
    }
    if (diff.structuredPatch) {
      const approval = options.approval;
      if (!approval || approval.approved !== true ||
          !/^[a-f0-9]{64}$/.test(diff.planDigest || '') ||
          !/^[a-f0-9]{64}$/.test(diff.patchDigest || '') ||
          approval.planDigest !== diff.planDigest ||
          approval.patchDigest !== diff.patchDigest) {
        throw new Error('Patch requires approval bound to its plan and patch digests');
      }
    }
    
    // Validate
    const validation = this.validateBeforeApply(diff);
    if (!validation.valid) {
      diff.status = 'failed';
      diff.error = validation.reason;
      this.status.pending--;
      this.status.failed++;
      return { success: false, code: validation.code || 'PATCH_CONFLICT', error: validation.reason };
    }
    
    try {
      // Create backup
      if (diff.type !== 'create') {
        diff.backupPath = this.backupManager.createBackup(diff.filePath, diff.originalContent);
      }
      
      if (diff.type === 'delete') {
        const beforeDelete = this.validateBeforeApply(diff);
        if (!beforeDelete.valid) {
          throw Object.assign(new Error(beforeDelete.reason), { code: beforeDelete.code || 'PATCH_CONFLICT' });
        }
        fs.unlinkSync(diff.filePath);
      } else {
        const parentDir = path.dirname(diff.filePath);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        const tempPath = `${diff.filePath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
        fs.writeFileSync(tempPath, diff.modifiedContent, 'utf8');
        const beforeRename = this.validateBeforeApply(diff);
        if (!beforeRename.valid) {
          fs.unlinkSync(tempPath);
          throw Object.assign(new Error(beforeRename.reason), { code: beforeRename.code || 'PATCH_CONFLICT' });
        }
        await this._renameWithRetry(tempPath, diff.filePath);
      }
      const intendedStatePresent = diff.type === 'delete'
        ? !fs.existsSync(diff.filePath)
        : fs.readFileSync(diff.filePath, 'utf8') === diff.modifiedContent;
      if (!intendedStatePresent) {
        throw new Error(`Applied patch content verification failed for ${diff.reviewPath}`);
      }
      
      diff.status = 'applied';
      this.status.pending--;
      this.status.applied++;
      
      return { success: true, backupPath: diff.backupPath };
    } catch (error) {
      diff.status = 'failed';
      diff.error = error.message;
      this.status.pending--;
      this.status.failed++;
      const currentContent = fs.existsSync(diff.filePath)
        ? fs.readFileSync(diff.filePath, 'utf8')
        : null;
      const containsOurWrite = diff.type === 'delete'
        ? currentContent === null
        : currentContent === diff.modifiedContent;
      if (diff.backupPath && containsOurWrite) {
        try {
          this.backupManager.restore(diff.filePath);
        } catch (restoreError) {
          diff.error = `${diff.error}; rollback failed: ${restoreError.message}`;
        }
      } else if (diff.type === 'create' && currentContent === diff.modifiedContent) {
        fs.unlinkSync(diff.filePath);
      }

      return { success: false, code: error.code || 'PATCH_APPLICATION_FAILED', error: error.message };
    }
  }

  async _renameWithRetry(source, destination, attempts = 4) {
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.promises.rename(source, destination);
        return;
      } catch (error) {
        const retryable = ['EBUSY', 'EACCES', 'EPERM'].includes(error.code);
        if (!retryable || attempt >= attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (2 ** attempt)));
      }
    }
  }

  /**
   * Apply all pending diffs
   */
  async applyAll(options = {}) {
    const results = {
      total: this.diffs.length,
      applied: 0,
      failed: 0,
      details: []
    };
    
    for (let i = 0; i < this.diffs.length; i++) {
      const diff = this.diffs[i];
      if (diff.status === 'pending') {
        const result = await this.applyDiff(i, options);
        results.details.push({
          file: diff.filePath,
          ...result
        });
        
        if (result.success) {
          results.applied++;
        } else {
          results.failed++;
        }
      }
    }
    
    return results;
  }

  /**
   * Reject a single diff
   */
  rejectDiff(diffIndex) {
    const diff = this.diffs[diffIndex];
    if (!diff) {
      throw new Error(`Diff index ${diffIndex} not found`);
    }
    
    if (diff.status !== 'pending') {
      throw new Error(`Diff already ${diff.status}`);
    }
    
    diff.status = 'rejected';
    this.status.pending--;
    this.status.rejected++;
    
    return { success: true };
  }

  /**
   * Reject all pending diffs
   */
  rejectAll() {
    const results = {
      total: 0,
      rejected: 0
    };
    
    for (let i = 0; i < this.diffs.length; i++) {
      const diff = this.diffs[i];
      if (diff.status === 'pending') {
        this.rejectDiff(i);
        results.total++;
        results.rejected++;
      }
    }
    
    return results;
  }

  /**
   * Rollback an applied diff
   */
  rollback(diffIndex) {
    const diff = this.diffs[diffIndex];
    if (!diff) {
      throw new Error(`Diff index ${diffIndex} not found`);
    }
    
    if (diff.status !== 'applied') {
      throw new Error(`Can only rollback applied diffs, current status: ${diff.status}`);
    }
    
    try {
      if (diff.backupPath) {
        this.backupManager.restore(diff.filePath);
        diff.status = 'rolled-back';
        this.status.applied--;
        
        return { success: true };
      } else {
        return { success: false, error: 'No backup available for rollback' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Rollback all applied diffs
   */
  rollbackAll() {
    const results = {
      total: 0,
      rolledBack: 0,
      failed: 0,
      details: []
    };
    
    for (let i = 0; i < this.diffs.length; i++) {
      const diff = this.diffs[i];
      if (diff.status === 'applied') {
        const result = this.rollback(i);
        results.details.push({
          file: diff.filePath,
          ...result
        });
        
        results.total++;
        if (result.success) {
          results.rolledBack++;
        } else {
          results.failed++;
        }
      }
    }
    
    return results;
  }

  /**
   * Generate summary report
   */
  generateReport() {
    return {
      timestamp: new Date().toISOString(),
      summary: {
        total: this.diffs.length,
        pending: this.status.pending,
        applied: this.status.applied,
        rejected: this.status.rejected,
        failed: this.status.failed
      },
      files: this.diffs.map(d => ({
        path: d.reviewPath,
        status: d.status,
        additions: d.hunks.reduce((sum, h) => sum + h.additions, 0),
        deletions: d.hunks.reduce((sum, h) => sum + h.deletions, 0),
        backupPath: d.backupPath,
        error: d.error
      }))
    };
  }
}

module.exports = {
  DiffReviewSystem,
  FileDiff,
  BackupManager,
  hashContent
};

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

/**
 * Represents a single file diff
 */
class FileDiff {
  constructor(filePath, originalContent, modifiedContent) {
    this.filePath = filePath;
    this.originalContent = originalContent;
    this.modifiedContent = modifiedContent;
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
    const modifiedLines = this.modifiedContent.split('\n');
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
    lines.push(`--- a/${this.filePath}`);
    lines.push(`+++ b/${this.filePath}`);
    
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
    this.backupManager = new BackupManager(options.backupDir || '.aqt-backups');
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
    const diff = new FileDiff(filePath, originalContent, modifiedContent);
    this.diffs.push(diff);
    this.status.pending++;
    return diff;
  }

  /**
   * Get all diffs grouped by status
   */
  getDiffsByStatus() {
    const grouped = {
      pending: [],
      applied: [],
      rejected: [],
      failed: []
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
        path: diff.filePath,
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
    // Check if file exists
    if (!fs.existsSync(diff.filePath)) {
      // New file - check parent directory exists
      const parentDir = path.dirname(diff.filePath);
      if (!fs.existsSync(parentDir)) {
        return { valid: false, reason: 'Parent directory does not exist' };
      }
    } else {
      // Existing file - check for stale source
      const currentContent = fs.readFileSync(diff.filePath, 'utf8');
      if (currentContent !== diff.originalContent) {
        return { 
          valid: false, 
          reason: 'Source file has changed since diff was created (stale source)',
          currentContent
        };
      }
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
    
    // Validate
    const validation = this.validateBeforeApply(diff);
    if (!validation.valid) {
      diff.status = 'failed';
      diff.error = validation.reason;
      this.status.pending--;
      this.status.failed++;
      return { success: false, error: validation.reason };
    }
    
    try {
      // Create backup
      if (fs.existsSync(diff.filePath)) {
        diff.backupPath = this.backupManager.createBackup(diff.filePath, diff.originalContent);
      }
      
      // Ensure parent directory exists
      const parentDir = path.dirname(diff.filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      
      // Write new content atomically
      const tempPath = `${diff.filePath}.tmp`;
      fs.writeFileSync(tempPath, diff.modifiedContent, 'utf8');
      fs.renameSync(tempPath, diff.filePath);
      
      diff.status = 'applied';
      this.status.pending--;
      this.status.applied++;
      
      return { success: true, backupPath: diff.backupPath };
    } catch (error) {
      diff.status = 'failed';
      diff.error = error.message;
      this.status.pending--;
      this.status.failed++;
      
      return { success: false, error: error.message };
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
        path: d.filePath,
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
  BackupManager
};

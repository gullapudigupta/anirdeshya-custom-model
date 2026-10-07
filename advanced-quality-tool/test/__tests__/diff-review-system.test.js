/**
 * Tests for Diff Review System
 * Task: P9-T015
 */

const { DiffReviewSystem, FileDiff, BackupManager } = require('../../src/agent/diff-review-system');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Test fixtures
let TEST_DIR;
let BACKUP_DIR;

// Sample file contents
const originalContent = `function hello() {
  console.log('Hello, World!');
}

function goodbye() {
  console.log('Goodbye!');
}
`;

const modifiedContent = `function hello() {
  console.log('Hello, World!');
  console.log('Welcome!');
}

function goodbye() {
  console.log('Goodbye!');
}

function newFunction() {
  console.log('I am new!');
}
`;

describe('FileDiff', () => {
  test('should compute diff hunks correctly', () => {
    const diff = new FileDiff('/test/file.js', originalContent, modifiedContent);
    
    expect(diff.hunks.length).toBeGreaterThan(0);
    expect(diff.originalContent).toBe(originalContent);
    expect(diff.modifiedContent).toBe(modifiedContent);
  });

  test('should count additions and deletions', () => {
    const diff = new FileDiff('/test/file.js', originalContent, modifiedContent);
    
    const totalAdditions = diff.hunks.reduce((sum, h) => sum + h.additions, 0);
    const totalDeletions = diff.hunks.reduce((sum, h) => sum + h.deletions, 0);
    
    expect(totalAdditions).toBeGreaterThan(0);
    expect(totalDeletions).toBeGreaterThanOrEqual(0);
  });

  test('should generate unified diff format', () => {
    const diff = new FileDiff('/test/file.js', originalContent, modifiedContent);
    const unified = diff.toUnifiedDiff();
    
    expect(unified).toContain('--- a/test/file.js');
    expect(unified).toContain('+++ b/test/file.js');
    expect(unified).toContain('@@');
  });

  test('should handle identical content', () => {
    const diff = new FileDiff('/test/file.js', originalContent, originalContent);
    
    expect(diff.hunks.length).toBe(0);
  });

  test('should handle empty original content', () => {
    const diff = new FileDiff('/test/new.js', '', 'new content');
    
    expect(diff.hunks.length).toBeGreaterThan(0);
    expect(diff.hunks[0].additions).toBeGreaterThan(0);
  });

  test('should handle empty modified content (deletion)', () => {
    const diff = new FileDiff('/test/delete.js', 'delete me', '');
    
    expect(diff.hunks.length).toBeGreaterThan(0);
    expect(diff.hunks[0].deletions).toBeGreaterThan(0);
  });
});

describe('BackupManager', () => {
  let backupManager;

  beforeEach(() => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-diff-review-'));
    BACKUP_DIR = path.join(TEST_DIR, '.backups');
    
    backupManager = new BackupManager(BACKUP_DIR);
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  test('should create backup of file', () => {
    const testFile = path.join(TEST_DIR, 'test.js');
    const content = 'original content';
    fs.writeFileSync(testFile, content);
    
    const backupPath = backupManager.createBackup(testFile, content);
    
    expect(backupPath).toBeDefined();
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(content);
  });

  test('should restore file from backup', () => {
    const testFile = path.join(TEST_DIR, 'test.js');
    const originalContent = 'original content';
    const modifiedContent = 'modified content';
    
    fs.writeFileSync(testFile, originalContent);
    backupManager.createBackup(testFile, originalContent);
    
    // Modify file
    fs.writeFileSync(testFile, modifiedContent);
    expect(fs.readFileSync(testFile, 'utf8')).toBe(modifiedContent);
    
    // Restore
    backupManager.restore(testFile);
    expect(fs.readFileSync(testFile, 'utf8')).toBe(originalContent);
  });

  test('should throw error when backup not found', () => {
    expect(() => {
      backupManager.restore('/nonexistent/file.js');
    }).toThrow('No backup found');
  });

  test('should clean up old backups', (done) => {
    const testFile = path.join(TEST_DIR, 'test.js');
    const content = 'content';
    
    backupManager.createBackup(testFile, content);
    
    // Set timestamp to past
    const backup = backupManager.backups.get(testFile);
    backup.timestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    
    backupManager.cleanup(24 * 60 * 60 * 1000);
    
    expect(backupManager.backups.has(testFile)).toBe(false);
    done();
  });
});

describe('DiffReviewSystem', () => {
  let system;
  let testFile;

  beforeEach(() => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-diff-review-'));
    BACKUP_DIR = path.join(TEST_DIR, '.backups');
    
    system = new DiffReviewSystem({ backupDir: BACKUP_DIR });
    testFile = path.join(TEST_DIR, 'test.js');
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  test('should add diff to review', () => {
    const diff = system.addDiff(testFile, originalContent, modifiedContent);
    
    expect(diff).toBeDefined();
    expect(system.diffs.length).toBe(1);
    expect(system.status.pending).toBe(1);
  });

  test('should present diffs for review', () => {
    system.addDiff(testFile, originalContent, modifiedContent);
    
    const review = system.presentForReview();
    
    expect(review.summary.total).toBe(1);
    expect(review.summary.pending).toBe(1);
    expect(review.files.length).toBe(1);
    expect(review.files[0].diff).toBeDefined();
  });

  test('should apply diff successfully', async () => {
    fs.writeFileSync(testFile, originalContent);
    
    system.addDiff(testFile, originalContent, modifiedContent);
    
    const result = await system.applyDiff(0);
    
    expect(result.success).toBe(true);
    expect(fs.readFileSync(testFile, 'utf8')).toBe(modifiedContent);
    expect(system.status.applied).toBe(1);
    expect(system.status.pending).toBe(0);
  });

  test('should detect stale source', async () => {
    fs.writeFileSync(testFile, originalContent);
    
    system.addDiff(testFile, originalContent, modifiedContent);
    
    // Modify file after diff created
    fs.writeFileSync(testFile, 'stale content');
    
    const result = await system.applyDiff(0);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('stale');
    expect(system.status.failed).toBe(1);
  });

  test('should reject diff', () => {
    system.addDiff(testFile, originalContent, modifiedContent);
    
    const result = system.rejectDiff(0);
    
    expect(result.success).toBe(true);
    expect(system.status.rejected).toBe(1);
    expect(system.status.pending).toBe(0);
  });

  test('should rollback applied diff', async () => {
    fs.writeFileSync(testFile, originalContent);
    
    system.addDiff(testFile, originalContent, modifiedContent);
    await system.applyDiff(0);
    
    const result = system.rollback(0);
    
    expect(result.success).toBe(true);
    expect(fs.readFileSync(testFile, 'utf8')).toBe(originalContent);
  });

  test('should apply all pending diffs', async () => {
    const file1 = path.join(TEST_DIR, 'file1.js');
    const file2 = path.join(TEST_DIR, 'file2.js');
    
    fs.writeFileSync(file1, originalContent);
    fs.writeFileSync(file2, originalContent);
    
    system.addDiff(file1, originalContent, modifiedContent);
    system.addDiff(file2, originalContent, modifiedContent);
    
    const results = await system.applyAll();
    
    expect(results.applied).toBe(2);
    expect(system.status.applied).toBe(2);
  });

  test('should reject all pending diffs', () => {
    const file1 = path.join(TEST_DIR, 'file1.js');
    const file2 = path.join(TEST_DIR, 'file2.js');
    
    system.addDiff(file1, originalContent, modifiedContent);
    system.addDiff(file2, originalContent, modifiedContent);
    
    const results = system.rejectAll();
    
    expect(results.rejected).toBe(2);
    expect(system.status.rejected).toBe(2);
    expect(system.status.pending).toBe(0);
  });

  test('should rollback all applied diffs', async () => {
    const file1 = path.join(TEST_DIR, 'file1.js');
    const file2 = path.join(TEST_DIR, 'file2.js');
    
    fs.writeFileSync(file1, originalContent);
    fs.writeFileSync(file2, originalContent);
    
    system.addDiff(file1, originalContent, modifiedContent);
    system.addDiff(file2, originalContent, modifiedContent);
    
    await system.applyAll();
    
    const results = system.rollbackAll();
    
    expect(results.rolledBack).toBe(2);
    expect(fs.readFileSync(file1, 'utf8')).toBe(originalContent);
    expect(fs.readFileSync(file2, 'utf8')).toBe(originalContent);
  });

  test('should create parent directories when applying diff to new file', async () => {
    const newFile = path.join(TEST_DIR, 'subdir', 'new.js');
    
    system.addDiff(newFile, '', 'new content');
    
    const result = await system.applyDiff(0);
    
    expect(result.success).toBe(true);
    expect(fs.existsSync(newFile)).toBe(true);
    expect(fs.readFileSync(newFile, 'utf8')).toBe('new content');
  });

  test('should generate summary report', () => {
    system.addDiff(testFile, originalContent, modifiedContent);
    
    const report = system.generateReport();
    
    expect(report.summary.total).toBe(1);
    expect(report.summary.pending).toBe(1);
    expect(report.files.length).toBe(1);
    expect(report.files[0].path).toBe(testFile);
  });

  test('should prevent operations on wrong status', async () => {
    fs.writeFileSync(testFile, originalContent);
    
    system.addDiff(testFile, originalContent, modifiedContent);
    
    // Try to rollback pending diff
    expect(() => system.rollback(0)).toThrow('Can only rollback applied diffs');
    
    // Apply then try to apply again
    await system.applyDiff(0);
    await expect(system.applyDiff(0)).rejects.toThrow('already applied');
    
    // Try to reject applied diff
    expect(() => system.rejectDiff(0)).toThrow('already applied');
  });
});

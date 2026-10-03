/**
 * Tests for File Watcher
 */

const { FileWatcher } = require('../../src/watcher/file-watcher');
const path = require('path');

describe('FileWatcher', () => {
  let watcher;

  beforeEach(() => {
    watcher = new FileWatcher({
      directory: __dirname,
      verbose: false,
      recursive: true
    });
  });

  afterEach(() => {
    if (watcher.isWatching) {
      watcher.stop();
    }
  });

  describe('Initialization', () => {
    test('should initialize with default options', () => {
      expect(watcher.directory).toBe(__dirname);
      expect(watcher.verbose).toBe(false);
      expect(watcher.autoFix).toBe(false);
      expect(watcher.debounceMs).toBe(500);
    });

    test('should accept custom options', () => {
      const customWatcher = new FileWatcher({
        directory: '/custom/path',
        autoFix: true,
        debounceMs: 1000,
        verbose: true
      });

      expect(customWatcher.autoFix).toBe(true);
      expect(customWatcher.debounceMs).toBe(1000);
      expect(customWatcher.verbose).toBe(true);
    });
  });

  describe('Pattern Matching', () => {
    test('should match simple glob patterns', () => {
      expect(watcher.matchPattern('test.js', '*.js')).toBe(true);
      expect(watcher.matchPattern('test.ts', '*.js')).toBe(false);
    });

    test('should match directory patterns', () => {
      expect(watcher.matchPattern('src/test.js', 'src/*.js')).toBe(true);
      expect(watcher.matchPattern('lib/test.js', 'src/*.js')).toBe(false);
    });

    test('should match recursive patterns', () => {
      expect(watcher.matchPattern('src/deep/test.js', 'src/**/*.js')).toBe(true);
      expect(watcher.matchPattern('src/test.js', 'src/**/*.js')).toBe(true);
      expect(watcher.matchPattern('lib/test.js', 'src/**/*.js')).toBe(false);
    });

    test('should match multiple extensions', () => {
      expect(watcher.matchPattern('test.js', '**/*.js')).toBe(true);
      expect(watcher.matchPattern('test.ts', '**/*.ts')).toBe(true);
      expect(watcher.matchPattern('test.jsx', '**/*.jsx')).toBe(true);
    });
  });

  describe('File Filtering', () => {
    test('should check if file should be watched', () => {
      expect(watcher.shouldWatch('test.js')).toBe(true);
      expect(watcher.shouldWatch('test.ts')).toBe(true);
      expect(watcher.shouldWatch('test.txt')).toBe(false);
    });

    test('should exclude node_modules', () => {
      expect(watcher.isExcluded('node_modules/package/file.js')).toBe(true);
      expect(watcher.isExcluded('src/file.js')).toBe(false);
    });

    test('should exclude build directories', () => {
      expect(watcher.isExcluded('dist/bundle.js')).toBe(true);
      expect(watcher.isExcluded('build/output.js')).toBe(true);
      expect(watcher.isExcluded('coverage/report.js')).toBe(true);
    });

    test('should exclude .aqt directories', () => {
      expect(watcher.isExcluded('.aqt-cache/file.js')).toBe(true);
      expect(watcher.isExcluded('.aqt-backup/file.js')).toBe(true);
    });
  });

  describe('Statistics', () => {
    test('should initialize stats correctly', () => {
      const stats = watcher.getStats();

      expect(stats.filesWatched).toBe(0);
      expect(stats.changesDetected).toBe(0);
      expect(stats.analysisRuns).toBe(0);
      expect(stats.autoFixesApplied).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.isWatching).toBe(false);
    });

    test('should include directory in stats', () => {
      const stats = watcher.getStats();

      expect(stats.directory).toBe(__dirname);
    });
  });

  describe('Debouncing', () => {
    test('should debounce file changes', (done) => {
      let callCount = 0;

      watcher.onFileChanged = jest.fn(() => {
        callCount++;
      });

      // Simulate multiple rapid changes
      watcher.handleFileChange('test.js');
      watcher.handleFileChange('test.js');
      watcher.handleFileChange('test.js');

      // Should only call once after debounce
      setTimeout(() => {
        expect(callCount).toBe(1);
        done();
      }, 600);
    });

    test('should clear existing timers on new changes', () => {
      const filePath = 'test.js';

      watcher.handleFileChange(filePath);
      expect(watcher.debounceTimers.has(filePath)).toBe(true);

      watcher.handleFileChange(filePath);
      expect(watcher.debounceTimers.has(filePath)).toBe(true);
    });
  });

  describe('Event Emission', () => {
    test('should emit fileChanged event', (done) => {
      watcher.on('fileChanged', (data) => {
        expect(data.filePath).toBeDefined();
        expect(data.relativePath).toBeDefined();
        expect(data.timestamp).toBeDefined();
        done();
      });

      watcher.emit('fileChanged', {
        filePath: 'test.js',
        relativePath: 'test.js',
        timestamp: new Date().toISOString()
      });
    });

    test('should emit analysisComplete event', (done) => {
      watcher.on('analysisComplete', (data) => {
        expect(data.issueCount).toBe(5);
        done();
      });

      watcher.emit('analysisComplete', {
        filePath: 'test.js',
        issueCount: 5,
        issues: []
      });
    });

    test('should emit error event', (done) => {
      watcher.on('error', (data) => {
        expect(data.error).toBeInstanceOf(Error);
        done();
      });

      watcher.emit('error', {
        filePath: 'test.js',
        error: new Error('Test error')
      });
    });
  });
});

describe('Integration Tests', () => {
  test('should create watcher with custom include patterns', () => {
    const watcher = new FileWatcher({
      directory: __dirname,
      include: ['**/*.test.js', '**/*.spec.js'],
      verbose: false
    });

    expect(watcher.includePatterns).toEqual(['**/*.test.js', '**/*.spec.js']);
  });

  test('should create watcher with custom exclude patterns', () => {
    const watcher = new FileWatcher({
      directory: __dirname,
      exclude: ['**/temp/**', '**/cache/**'],
      verbose: false
    });

    expect(watcher.excludePatterns).toEqual(['**/temp/**', '**/cache/**']);
  });

  test('should handle auto-fix mode', () => {
    const watcher = new FileWatcher({
      directory: __dirname,
      autoFix: true,
      verbose: false
    });

    expect(watcher.autoFix).toBe(true);
  });
});

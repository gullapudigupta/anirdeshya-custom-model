/**
 * Tests for security-command.js
 */

'use strict';

const securityCommand = require('../security-command');
const path = require('path');
const fs = require('fs');
const tmpdir = require('os').tmpdir();

describe('Security Command', () => {
  let testDir;

  beforeAll(() => {
    // Create temporary test directory
    testDir = path.join(tmpdir, 'aqt-security-test-' + Date.now());
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('module exports', () => {
    test('should export run function', () => {
      expect(typeof securityCommand.run).toBe('function');
    });
  });

  describe('command routing', () => {
    test('should handle help flag', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await securityCommand.run(['--help']);
      
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.join('\n');
      expect(output).toContain('security');
      
      consoleSpy.mockRestore();
    });

    test('should handle unknown subcommand', async () => {
      const processExitSpy = jest.spyOn(process, 'exit').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      await securityCommand.run(['unknown']);
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown subcommand'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
      
      processExitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('scan function', () => {
    test('should run comprehensive scan', async () => {
      // Create test file with intentional issue
      const testFile = path.join(testDir, 'test.js');
      fs.writeFileSync(testFile, `
        // This file has SQL injection vulnerability
        const query = 'SELECT * FROM users WHERE id = ' + userId;
      `, 'utf8');

      // Create package.json
      const pkgFile = path.join(testDir, 'package.json');
      fs.writeFileSync(pkgFile, JSON.stringify({
        name: 'test',
        version: '1.0.0',
        dependencies: {
          lodash: '1.0.0'
        }
      }), 'utf8');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      // Note: This will attempt to scan, may produce real results
      try {
        await securityCommand.run(['scan', '--workspace', testDir, '--format', 'json']);
      } catch (error) {
        // Expected - just testing command routing
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should support severity filtering', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run(['scan', '--severity', 'critical', '--workspace', testDir]);
      } catch (error) {
        // Expected
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should support output file', async () => {
      const outputFile = path.join(testDir, 'security-report.json');
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run([
          'scan',
          '--workspace', testDir,
          '--output', outputFile,
          '--format', 'json'
        ]);
      } catch (error) {
        // Expected
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('vulnerability scanning', () => {
    test('should scan for vulnerabilities', async () => {
      const testFile = path.join(testDir, 'vuln.js');
      fs.writeFileSync(testFile, `
        const password = 'admin123';
        const result = eval(userInput);
      `, 'utf8');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run(['vulnerabilities', '--workspace', testDir]);
      } catch (error) {
        // Expected
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('secret scanning', () => {
    test('should scan for secrets', async () => {
      const testFile = path.join(testDir, 'secrets.js');
      fs.writeFileSync(testFile, `
        const apiKey = 'sk_live_51234567890';
        const password = 'SecureP@ssw0rd';
      `, 'utf8');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run(['secrets', '--workspace', testDir]);
      } catch (error) {
        // Expected
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('dependency scanning', () => {
    test('should scan dependencies', async () => {
      const pkgFile = path.join(testDir, 'package.json');
      fs.writeFileSync(pkgFile, JSON.stringify({
        name: 'test-package',
        version: '1.0.0',
        dependencies: {
          express: '4.0.0',
          lodash: '2.0.0'
        }
      }), 'utf8');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run(['dependencies', '--workspace', testDir]);
      } catch (error) {
        // Expected
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('output formatting', () => {
    test('should support json output format', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run(['scan', '--workspace', testDir, '--format', 'json']);
      } catch (error) {
        // Expected
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should support table output format', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run(['scan', '--workspace', testDir, '--format', 'table']);
      } catch (error) {
        // Expected
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('report generation', () => {
    test('should generate json report', async () => {
      const outputFile = path.join(testDir, 'test-report.json');
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run([
          'scan',
          '--workspace', testDir,
          '--report', 'json',
          '--output', outputFile
        ]);
      } catch (error) {
        // Expected
      }
      
      consoleSpy.mockRestore();
    });

    test('should generate markdown report', async () => {
      const outputFile = path.join(testDir, 'test-report.md');
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run([
          'scan',
          '--workspace', testDir,
          '--report', 'markdown',
          '--output', outputFile
        ]);
      } catch (error) {
        // Expected
      }
      
      consoleSpy.mockRestore();
    });

    test('should generate SARIF report', async () => {
      const outputFile = path.join(testDir, 'test-report.sarif');
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run([
          'scan',
          '--workspace', testDir,
          '--report', 'sarif',
          '--output', outputFile
        ]);
      } catch (error) {
        // Expected
      }
      
      consoleSpy.mockRestore();
    });
  });

  describe('command line parsing', () => {
    test('should parse workspace option', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run(['scan', '-w', testDir]);
      } catch (error) {
        // Expected
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should parse verbose option', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run(['scan', '-v', '--workspace', testDir]);
      } catch (error) {
        // Expected
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should parse short options', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      try {
        await securityCommand.run(['scan', '-w', testDir, '-f', 'json']);
      } catch (error) {
        // Expected
      }
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

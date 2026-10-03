/**
 * C# Auto-Fix Rules (P2-T004)
 *
 * Deterministic, rule-based fixes for common C# style diagnostics. Two paths:
 *   1. `dotnet format` — delegates to the official formatter when available and
 *      honors dry-run via `--verify-no-changes`.
 *   2. PatternFixer (offline) — pure text transforms for the whitespace/layout
 *      issues the offline detector reports (SA1028 trailing whitespace, SA1027
 *      tabs->spaces, SA1518 final newline, CRLF normalization). Runs anywhere,
 *      no toolchain required, and is fully reversible via backups.
 *
 * Mirrors the conventions in src/fixers/rule-based-fixer.js (dryRun/backup
 * options, {success, fixedCount, errors, backupPath} result shape).
 *
 * @module fixers/csharp-fixer
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Remove the filesystem root (e.g. Windows drive `C:\`) so a source path can be
 * nested under a backup directory without resetting a path.join().
 * @param {string} filePath
 * @returns {string}
 */
function stripPathRoot(filePath) {
  const parsed = path.parse(filePath);
  if (!parsed.root) return filePath;
  return path.relative(parsed.root, filePath);
}

/**
 * Offline, deterministic C# style fixer.
 */
class CSharpPatternFixer {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.backup = options.backup !== false;
    this.verbose = options.verbose || false;
    this.backupDir = options.backupDir || '.aqt-backup';
    this.indentSize = options.indentSize || 4;
  }

  /**
   * Ordered pattern transforms applied to file content.
   * @returns {Array<{id:string, apply:(s:string)=>string, description:string}>}
   */
  getPatterns() {
    const indent = ' '.repeat(this.indentSize);
    return [
      {
        id: 'crlf-to-lf',
        description: 'Normalize CRLF line endings to LF',
        apply: (s) => s.replace(/\r\n/g, '\n')
      },
      {
        id: 'SA1027-tabs-to-spaces',
        description: 'Replace leading tabs with spaces',
        apply: (s) =>
          s
            .split('\n')
            .map((line) => {
              const m = line.match(/^(\t+)(.*)$/);
              if (!m) return line;
              return indent.repeat(m[1].length) + m[2];
            })
            .join('\n')
      },
      {
        id: 'SA1028-trailing-whitespace',
        description: 'Remove trailing whitespace',
        apply: (s) => s.replace(/[ \t]+$/gm, '')
      },
      {
        id: 'SA1518-final-newline',
        description: 'Ensure file ends with exactly one newline',
        apply: (s) => s.replace(/\n*$/, '\n')
      }
    ];
  }

  /**
   * Create a backup copy of the file.
   * @param {string} filePath
   * @returns {Promise<string|null>}
   */
  async createBackup(filePath) {
    if (!this.backup) return null;
    const backupPath = path.join(
      this.backupDir,
      new Date().toISOString().replace(/:/g, '-'),
      stripPathRoot(filePath)
    );
    const dir = path.dirname(backupPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }

  /**
   * Restore a file from a backup.
   * @param {string} filePath
   * @param {string} backupPath
   */
  async restoreBackup(filePath, backupPath) {
    if (!backupPath || !fs.existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }
    fs.copyFileSync(backupPath, filePath);
  }

  /**
   * Fix a single C# file.
   * @param {string} filePath
   * @param {Array} [issues]
   * @returns {Promise<{filePath:string, success:boolean, fixedCount:number, errors:string[], backupPath:string|null, appliedPatterns:string[]}>}
   */
  async fixFile(filePath, issues = []) {
    const result = {
      filePath,
      success: false,
      fixedCount: 0,
      errors: [],
      backupPath: null,
      appliedPatterns: []
    };

    try {
      if (!fs.existsSync(filePath)) {
        result.errors.push(`File not found: ${filePath}`);
        return result;
      }

      if (!this.dryRun) {
        result.backupPath = await this.createBackup(filePath);
      }

      const original = fs.readFileSync(filePath, 'utf8');
      let content = original;

      for (const pattern of this.getPatterns()) {
        const before = content;
        content = pattern.apply(content);
        if (content !== before) {
          result.appliedPatterns.push(pattern.id);
          result.fixedCount++;
          this.log(`Applied: ${pattern.description}`);
        }
      }

      if (!this.dryRun && content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
      }

      result.success = true;
    } catch (error) {
      result.errors.push(error.message);
      if (result.backupPath && !this.dryRun) {
        try {
          await this.restoreBackup(filePath, result.backupPath);
        } catch (restoreError) {
          result.errors.push(`Failed to restore backup: ${restoreError.message}`);
        }
      }
    }

    return result;
  }

  log(message) {
    if (this.verbose) console.log(`[CSharpPatternFixer] ${message}`);
  }
}

/**
 * Delegates to the official `dotnet format` tool when present.
 */
class DotnetFormatFixer {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
    this.dotnetPath = options.dotnetPath || 'dotnet';
  }

  /**
   * Whether `dotnet format` is available.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      await execPromise(`${this.dotnetPath} format --version`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Run `dotnet format` against a project/solution/file.
   * @param {string} target
   * @returns {Promise<{target:string, success:boolean, changed:boolean, errors:string[]}>}
   */
  async fix(target) {
    const result = { target, success: false, changed: false, errors: [] };
    try {
      const verify = this.dryRun ? '--verify-no-changes' : '';
      await execPromise(`${this.dotnetPath} format "${target}" ${verify}`.trim(), {
        maxBuffer: 50 * 1024 * 1024
      });
      // Exit 0: no changes needed (dry-run) or changes applied.
      result.success = true;
    } catch (error) {
      // In dry-run, a non-zero exit means formatting IS needed.
      if (this.dryRun) {
        result.success = true;
        result.changed = true;
      } else {
        result.errors.push(error.message);
      }
    }
    return result;
  }

  log(message) {
    if (this.verbose) console.log(`[DotnetFormatFixer] ${message}`);
  }
}

/**
 * Coordinator: prefers `dotnet format` when available, otherwise applies the
 * offline pattern fixer. Always usable.
 */
class CSharpFixEngine {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.patternFixer = new CSharpPatternFixer(options);
    this.formatFixer = new DotnetFormatFixer(options);
  }

  /**
   * Fix a single file. Uses the offline pattern fixer for per-file, reversible
   * transforms (the format tool operates per-project).
   * @param {string} filePath
   * @param {Array} [issues]
   */
  async fixFile(filePath, issues = []) {
    return this.patternFixer.fixFile(filePath, issues);
  }

  /**
   * Fix multiple files.
   * @param {Object<string, Array>} issuesMap
   * @returns {Promise<Array>}
   */
  async fixFiles(issuesMap = {}) {
    const results = [];
    for (const [filePath, issues] of Object.entries(issuesMap)) {
      results.push(await this.fixFile(filePath, issues));
    }
    return results;
  }

  /**
   * Format an entire project/solution via `dotnet format` when available.
   * @param {string} target
   */
  async fixProject(target) {
    if (await this.formatFixer.isAvailable()) {
      return this.formatFixer.fix(target);
    }
    return { target, success: false, changed: false, errors: ['dotnet format not available'] };
  }

  /**
   * Aggregate stats across fixFile results.
   * @param {Array} results
   * @returns {object}
   */
  getStats(results) {
    return {
      totalFiles: results.length,
      successfulFiles: results.filter((r) => r.success).length,
      failedFiles: results.filter((r) => !r.success).length,
      totalFixes: results.reduce((sum, r) => sum + (r.fixedCount || 0), 0),
      totalErrors: results.reduce((sum, r) => sum + (r.errors ? r.errors.length : 0), 0)
    };
  }

  log(message) {
    if (this.verbose) console.log(`[CSharpFixEngine] ${message}`);
  }
}

module.exports = {
  CSharpPatternFixer,
  DotnetFormatFixer,
  CSharpFixEngine,
  stripPathRoot
};

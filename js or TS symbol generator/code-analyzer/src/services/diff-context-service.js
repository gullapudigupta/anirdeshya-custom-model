/**
 * Diff Context Service — Ported from ai_tools_setup/sidecar-api
 * 
 * Returns only changed code lines since last commit, annotated with
 * the enclosing symbol for each hunk. 20-50x smaller than full files.
 */

const { execSync } = require('child_process');
const path = require('path');

class DiffContextService {
  constructor(rootDir, queryEngine) {
    this.rootDir = rootDir;
    this.queryEngine = queryEngine;
  }

  /**
   * Get annotated diff context
   * @param {object} options - { base: 'HEAD', staged: false }
   */
  getDiffContext(options = {}) {
    const { base = 'HEAD', staged = false } = options;

    // Run git diff
    const gitArgs = ['diff', '--unified=3', '--diff-filter=ACDMR', '--no-color'];
    if (staged) {
      gitArgs.push('--cached');
    } else if (base !== 'HEAD') {
      gitArgs.push(base);
    }

    let diffOutput;
    try {
      diffOutput = execSync(`git ${gitArgs.join(' ')}`, {
        cwd: this.rootDir,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err) {
      return { base, staged, changedFiles: [], summary: 'git diff failed: ' + err.message };
    }

    if (!diffOutput || !diffOutput.trim()) {
      return { base, staged, changedFiles: [], summary: 'No changes detected' };
    }

    // Parse the diff
    const parsedFiles = this._parseDiff(diffOutput);

    // Annotate each hunk with enclosing symbol
    for (const f of parsedFiles) {
      for (const hunk of f.hunks) {
        const midLine = Math.floor((hunk.startLine + hunk.endLine) / 2);
        hunk.enclosingSymbol = this._findSymbolAtLine(f.file, midLine);
      }
    }

    // Summary stats
    const totalHunks = parsedFiles.reduce((n, f) => n + f.hunks.length, 0);
    const additions = parsedFiles.reduce((n, f) =>
      n + f.hunks.reduce((m, h) => m + h.lines.filter(l => l.startsWith('+')).length, 0), 0);
    const deletions = parsedFiles.reduce((n, f) =>
      n + f.hunks.reduce((m, h) => m + h.lines.filter(l => l.startsWith('-')).length, 0), 0);

    return {
      base,
      staged,
      changedFiles: parsedFiles,
      summary: { files: parsedFiles.length, hunks: totalHunks, additions, deletions },
    };
  }

  /**
   * Parse unified diff output into file hunks
   */
  _parseDiff(diffText) {
    const files = [];
    let current = null;
    let hunk = null;
    let newLine = 0;

    for (const raw of diffText.split('\n')) {
      // New file block
      const fileMatch = raw.match(/^diff --git a\/.+ b\/(.+)$/);
      if (fileMatch) {
        if (current) files.push(current);
        current = { file: fileMatch[1].replace(/\\/g, '/'), status: 'M', hunks: [] };
        hunk = null;
        continue;
      }

      if (!current) continue;

      if (raw.startsWith('new file')) { current.status = 'A'; continue; }
      if (raw.startsWith('deleted file')) { current.status = 'D'; continue; }

      // Hunk header
      const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        newLine = parseInt(hunkMatch[1], 10);
        hunk = { startLine: newLine, endLine: newLine, lines: [] };
        current.hunks.push(hunk);
        continue;
      }

      if (!hunk) continue;

      if (raw.startsWith('+') && !raw.startsWith('+++')) {
        hunk.lines.push('+ ' + raw.slice(1));
        hunk.endLine = newLine;
        newLine++;
      } else if (raw.startsWith('-') && !raw.startsWith('---')) {
        hunk.lines.push('- ' + raw.slice(1));
      } else if (raw.startsWith(' ')) {
        hunk.lines.push('  ' + raw.slice(1));
        newLine++;
      }
    }

    if (current) files.push(current);

    // Filter to supported file types
    const supportedExt = ['.ts', '.js', '.html', '.scss', '.css', '.json'];
    return files.filter(f => supportedExt.some(ext => f.file.endsWith(ext)));
  }

  /**
   * Find enclosing symbol at a given line in a file
   */
  _findSymbolAtLine(file, lineNumber) {
    const symbols = this.queryEngine.getFileSymbols(file);
    if (!symbols || symbols.length === 0) return null;

    // Find nearest symbol whose line is <= lineNumber
    let best = null;
    for (const sym of symbols) {
      if (sym.type === 'import' || sym.type === 'export') continue;
      if (sym.line <= lineNumber) {
        if (!best || sym.line > best.line) best = sym;
      }
    }

    return best ? { name: best.name, kind: best.type, line: best.line } : null;
  }
}

module.exports = { DiffContextService };

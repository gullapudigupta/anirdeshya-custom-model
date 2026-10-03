/**
 * Snippet Service — Ported from ai_tools_setup/sidecar-api
 * 
 * Gets code lines ±N context around a given line number.
 * Works for any file type (TS, HTML, SCSS, JS, etc.)
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONTEXT = 5;
const MAX_LINES = 30;

class SnippetService {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  /**
   * Get code snippet around a line
   * @param {string} file - Relative path from rootDir
   * @param {number} line - Target line number (1-based)
   * @param {number} context - Lines of context on each side (default 5)
   */
  getSnippet(file, line, context = DEFAULT_CONTEXT) {
    const fullPath = path.resolve(this.rootDir, file);
    if (!fs.existsSync(fullPath)) return null;

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const lineNum = parseInt(line, 10);

    const start = Math.max(0, lineNum - 1 - context);
    const end = Math.min(lines.length, lineNum + context);

    return {
      file,
      startLine: start + 1,
      endLine: end,
      targetLine: lineNum,
      lines: lines.slice(start, end).map((text, idx) => ({
        number: start + idx + 1,
        text,
        isTarget: (start + idx + 1) === lineNum,
      })),
    };
  }

  /**
   * Get entire file content as lines
   */
  getFileLines(file) {
    const fullPath = path.resolve(this.rootDir, file);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf-8').split('\n');
  }

  /**
   * Get file content as string
   */
  getFileContent(file) {
    const fullPath = path.resolve(this.rootDir, file);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  }
}

module.exports = { SnippetService };

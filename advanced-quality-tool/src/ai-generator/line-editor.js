/**
 * Line-Level Code Applicator (P6-T010)
 *
 * Applies AI-generated, line-level edits (not full-file rewrites) that follow the
 * OUTPUT_CONTRACT from prompt-builder.js:
 *
 *   { "edits": [ { "startLine": n, "endLine": m, "replacement": "..." } ], "explanation": "..." }
 *
 * Guarantees:
 *   - Edits are validated (bounds, ordering, overlap) before anything is written.
 *   - A timestamped backup is created before modifying a file.
 *   - Transaction-style apply: if any file in a batch fails, all are rolled back.
 *   - Optional AST validation hook (code-analyzer ast-utils) can veto a bad edit;
 *     when no validator is supplied, only structural validation runs.
 *
 * This module is filesystem-only and network-free.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_OPTIONS = {
  rootDir: process.cwd(),
  backupDir: null,        // defaults to <rootDir>/.aqt-history/ai-generator
  dryRun: false,
  astValidate: null       // optional fn(newSource, filePath) => {valid:boolean, error?:string}
};

class LineEditor {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.options.backupDir =
      this.options.backupDir || path.join(this.options.rootDir, '.aqt-history', 'ai-generator');
  }

  /**
   * Parse a model response into an edit plan. Accepts a JSON string or object.
   * @returns {{edits: Array, explanation: string}}
   * @throws if the payload cannot be parsed into the expected shape
   */
  parseEditPlan(response) {
    let obj = response;
    if (typeof response === 'string') {
      const jsonText = this._extractJson(response);
      obj = JSON.parse(jsonText);
    }
    if (!obj || !Array.isArray(obj.edits)) {
      throw new Error('Edit plan must contain an "edits" array');
    }
    return {
      edits: obj.edits.map((e) => ({
        startLine: Number(e.startLine),
        endLine: Number(e.endLine != null ? e.endLine : e.startLine),
        replacement: String(e.replacement != null ? e.replacement : '')
      })),
      explanation: String(obj.explanation || '')
    };
  }

  /**
   * Validate an edit plan against the current file contents.
   * @returns {{valid: boolean, errors: string[]}}
   */
  validate(filePath, plan) {
    const errors = [];
    const source = this._readFile(filePath);
    if (source === null) {
      return { valid: false, errors: [`File not found or unreadable: ${filePath}`] };
    }
    const lineCount = source.split(/\r?\n/).length;

    const sorted = [...plan.edits].sort((a, b) => a.startLine - b.startLine);
    let prevEnd = 0;
    for (const edit of sorted) {
      if (!Number.isInteger(edit.startLine) || !Number.isInteger(edit.endLine)) {
        errors.push(`Edit has non-integer line numbers: ${JSON.stringify(edit)}`);
        continue;
      }
      if (edit.startLine < 1 || edit.endLine > lineCount) {
        errors.push(`Edit ${edit.startLine}-${edit.endLine} out of bounds (file has ${lineCount} lines)`);
      }
      if (edit.startLine > edit.endLine) {
        errors.push(`Edit start ${edit.startLine} after end ${edit.endLine}`);
      }
      if (edit.startLine <= prevEnd) {
        errors.push(`Edit ${edit.startLine}-${edit.endLine} overlaps a previous edit`);
      }
      prevEnd = Math.max(prevEnd, edit.endLine);
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Apply an edit plan to a single file. Returns a result descriptor.
   * Does NOT throw on validation failure; returns { applied:false, errors }.
   */
  applyToFile(filePath, plan) {
    const validation = this.validate(filePath, plan);
    if (!validation.valid) {
      return { file: filePath, applied: false, errors: validation.errors };
    }

    const source = this._readFile(filePath);
    const newSource = this._applyEdits(source, plan.edits);

    // Optional AST validation gate.
    if (typeof this.options.astValidate === 'function') {
      let astResult;
      try {
        astResult = this.options.astValidate(newSource, filePath);
      } catch (err) {
        astResult = { valid: false, error: err.message };
      }
      if (astResult && astResult.valid === false) {
        return { file: filePath, applied: false, errors: [`AST validation failed: ${astResult.error || 'invalid syntax'}`] };
      }
    }

    let backupPath = null;
    if (!this.options.dryRun) {
      backupPath = this._backup(filePath, source);
      this._writeFile(filePath, newSource);
    }

    return {
      file: filePath,
      applied: !this.options.dryRun,
      dryRun: this.options.dryRun,
      backupPath,
      editCount: plan.edits.length,
      explanation: plan.explanation
    };
  }

  /**
   * Apply edits across multiple files as a transaction. If any file fails,
   * previously applied files in this batch are rolled back from their backups.
   * @param {Array<{file:string, plan:object}>} batch
   */
  applyBatch(batch) {
    const results = [];
    const applied = [];

    for (const { file, plan } of batch) {
      const res = this.applyToFile(file, plan);
      results.push(res);
      if (res.applied && res.backupPath) {
        applied.push(res);
      } else if (!res.applied && !res.dryRun) {
        // Failure: roll back everything applied so far.
        for (const done of applied.reverse()) {
          this.rollback(done.file, done.backupPath);
        }
        return { success: false, results, rolledBack: applied.length };
      }
    }
    return { success: true, results, rolledBack: 0 };
  }

  /**
   * Restore a file from its backup.
   */
  rollback(filePath, backupPath) {
    if (!backupPath) return false;
    try {
      const abs = this._abs(filePath);
      const content = fs.readFileSync(backupPath, 'utf8');
      fs.writeFileSync(abs, content, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  /**
   * Apply edits to source text. Applies from the bottom up so earlier line
   * numbers stay valid as later ranges are replaced.
   */
  _applyEdits(source, edits) {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.split(/\r?\n/);
    const sorted = [...edits].sort((a, b) => b.startLine - a.startLine);

    for (const edit of sorted) {
      const replacementLines = edit.replacement.split(/\r?\n/);
      const count = edit.endLine - edit.startLine + 1;
      lines.splice(edit.startLine - 1, count, ...replacementLines);
    }
    return lines.join(eol);
  }

  _extractJson(text) {
    // Tolerate models that wrap JSON in prose or code fences.
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) return fenceMatch[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return text.slice(start, end + 1);
    return text;
  }

  _backup(filePath, source) {
    fs.mkdirSync(this.options.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = filePath.replace(/[\\/:]/g, '_');
    const backupPath = path.join(this.options.backupDir, `${safeName}.${stamp}.bak`);
    fs.writeFileSync(backupPath, source, 'utf8');
    return backupPath;
  }

  _abs(filePath) {
    return path.isAbsolute(filePath) ? filePath : path.join(this.options.rootDir, filePath);
  }

  _readFile(filePath) {
    try {
      return fs.readFileSync(this._abs(filePath), 'utf8');
    } catch {
      return null;
    }
  }

  _writeFile(filePath, content) {
    fs.writeFileSync(this._abs(filePath), content, 'utf8');
  }
}

module.exports = { LineEditor };

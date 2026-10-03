/**
 * Documentation Quality Checker
 *
 * Verifies JSDoc / TSDoc completeness and accuracy across JavaScript,
 * TypeScript, and compatible source files.
 *
 * Checks performed:
 * - Functions / methods missing a doc comment entirely
 * - @param tags missing for documented parameters
 * - @returns / @return tag missing when function has a non-void return
 * - @throws tag missing when function explicitly throws
 * - @deprecated tag present but no replacement mentioned
 * - Empty doc comments (/** with no content)
 * - @param names that don't match actual parameter names
 * - Exported symbols missing any documentation
 *
 * @module quality/doc-quality-checker
 */

'use strict';

/** Severity assigned to each rule */
const RULES = {
  'missing-jsdoc':          { severity: 'MEDIUM', description: 'Exported function/method missing JSDoc comment' },
  'missing-param-tag':      { severity: 'LOW',    description: '@param tag missing for one or more parameters' },
  'missing-returns-tag':    { severity: 'LOW',    description: '@returns tag missing for function with return value' },
  'missing-throws-tag':     { severity: 'LOW',    description: '@throws tag missing for function that throws' },
  'empty-jsdoc':            { severity: 'LOW',    description: 'Empty JSDoc comment block' },
  'param-name-mismatch':    { severity: 'MEDIUM', description: '@param name does not match actual parameter' },
  'deprecated-no-see':      { severity: 'LOW',    description: '@deprecated without a @see or replacement hint' },
  'missing-class-jsdoc':    { severity: 'MEDIUM', description: 'Class missing JSDoc comment' },
};

class DocQualityChecker {
  /**
   * @param {object} [options={}]
   * @param {string[]} [options.enabledRules] - Subset of rule IDs to run (default: all)
   * @param {boolean}  [options.exportedOnly=true] - Only flag exported symbols
   * @param {boolean}  [options.verbose=false]
   */
  constructor(options = {}) {
    this.options       = options;
    this.verbose       = options.verbose       || false;
    this.exportedOnly  = options.exportedOnly  !== false; // default true
    this.enabledRules  = options.enabledRules  || Object.keys(RULES);
    this.stats         = { filesAnalyzed: 0, issuesFound: 0, byRule: {} };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Analyze a source file for documentation quality issues.
   * @param {string} filePath
   * @param {string} content - File text
   * @returns {{ filePath: string, issues: object[], summary: object }}
   */
  analyze(filePath, content) {
    this.stats.filesAnalyzed++;
    const lines  = content.split('\n');
    const issues = [];

    // Only run on JS/TS source files
    if (!filePath.match(/\.(js|mjs|cjs|ts|tsx|jsx)$/i)) {
      return { filePath, issues: [], summary: { total: 0 } };
    }

    const blocks = this._extractDocBlocks(lines);

    issues.push(...this._checkFunctions(filePath, lines, blocks));
    issues.push(...this._checkClasses(filePath, lines, blocks));

    this.stats.issuesFound += issues.length;
    issues.forEach(i => {
      this.stats.byRule[i.rule] = (this.stats.byRule[i.rule] || 0) + 1;
    });

    return {
      filePath,
      issues,
      summary: {
        total:      issues.length,
        bySeverity: this._group(issues, 'severity'),
        byRule:     this._group(issues, 'rule')
      }
    };
  }

  /** Return metadata for all rules */
  getRules() { return { ...RULES }; }

  getStats() { return { ...this.stats }; }

  // ─── Core analysis ─────────────────────────────────────────────────────────

  /**
   * Check all function / method declarations in the file.
   */
  _checkFunctions(filePath, lines, blocks) {
    const issues = [];
    // Matches:  function foo(a, b) {  |  async function foo(  |  foo(a) {  (method in class)
    // Also arrow:  const foo = (a) =>  |  export const foo = async (a, b) =>
    const funcRx = /^(\s*)(?:(export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|(export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>|(async\s+)?(\w+)\s*\(([^)]*)\)\s*\{)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(funcRx);
      if (!m) continue;

      // Extract name and params
      const isExported = !!(m[2] || m[5]);
      const name   = m[3] || m[6] || m[9] || null;
      const params = (m[4] || m[7] || m[10] || '').split(',').map(p => p.trim().replace(/[=:].*/,'').replace(/\.\.\./,'').trim()).filter(p => p && p !== '');

      if (!name) continue;
      if (this.exportedOnly && !isExported) continue;

      // Find the doc block immediately preceding this line
      const doc = this._findPrecedingBlock(blocks, i);

      if (!doc) {
        if (this._ruleEnabled('missing-jsdoc')) {
          issues.push(this._make('missing-jsdoc', filePath, i + 1,
            `Function '${name}' is missing a JSDoc comment.`,
            `Add a /** ... */ comment above '${name}' describing its purpose, parameters, and return value.`));
        }
        continue;
      }

      // Empty doc
      if (this._ruleEnabled('empty-jsdoc') && doc.text.trim() === '') {
        issues.push(this._make('empty-jsdoc', filePath, doc.startLine + 1,
          `Empty JSDoc comment above '${name}'.`,
          'Add at least a one-line description to the JSDoc block.'));
      }

      // @param checks
      if (params.length > 0) {
        const docParams = this._extractTags(doc.text, 'param').map(t => t.name);

        if (this._ruleEnabled('missing-param-tag')) {
          for (const p of params) {
            if (p === 'this' || p === '_') continue; // skip conventional ignores
            if (!docParams.includes(p) && docParams.length === 0) {
              issues.push(this._make('missing-param-tag', filePath, doc.startLine + 1,
                `Function '${name}' has no @param tags (has ${params.length} parameter${params.length > 1 ? 's' : ''}).`,
                `Add @param {type} ${params[0]} ... tags for each parameter.`));
              break;
            }
          }
        }

        if (this._ruleEnabled('param-name-mismatch')) {
          for (const dp of docParams) {
            if (params.length > 0 && !params.includes(dp) && dp !== 'options') {
              issues.push(this._make('param-name-mismatch', filePath, doc.startLine + 1,
                `@param name '${dp}' in '${name}' doesn't match any actual parameter (${params.join(', ')}).`,
                `Rename the @param tag to match the actual parameter name.`));
            }
          }
        }
      }

      // @returns check — look ahead for return statements with values
      if (this._ruleEnabled('missing-returns-tag')) {
        const bodyLines = lines.slice(i + 1, Math.min(i + 50, lines.length));
        const hasReturn = bodyLines.some(l => /^\s*return\s+(?!;)/.test(l));
        const hasReturnsTag = /@returns?/.test(doc.text);
        if (hasReturn && !hasReturnsTag) {
          issues.push(this._make('missing-returns-tag', filePath, doc.startLine + 1,
            `Function '${name}' returns a value but has no @returns tag.`,
            'Add @returns {type} description to the JSDoc block.'));
        }
      }

      // @throws check
      if (this._ruleEnabled('missing-throws-tag')) {
        const bodyLines = lines.slice(i + 1, Math.min(i + 50, lines.length));
        const hasThrow  = bodyLines.some(l => /^\s*throw\s+/.test(l));
        const hasThrowsTag = /@throws?/.test(doc.text);
        if (hasThrow && !hasThrowsTag) {
          issues.push(this._make('missing-throws-tag', filePath, doc.startLine + 1,
            `Function '${name}' throws but has no @throws tag.`,
            'Add @throws {ErrorType} description to the JSDoc block.'));
        }
      }

      // @deprecated without @see
      if (this._ruleEnabled('deprecated-no-see')) {
        if (/@deprecated/.test(doc.text) && !/@see/.test(doc.text) && !/use\s+\w+/i.test(doc.text)) {
          issues.push(this._make('deprecated-no-see', filePath, doc.startLine + 1,
            `'${name}' is @deprecated but no replacement is mentioned.`,
            'Add @see or a note explaining what to use instead.'));
        }
      }
    }

    return issues;
  }

  /**
   * Check class declarations for JSDoc.
   */
  _checkClasses(filePath, lines, blocks) {
    const issues = [];
    const classRx = /^(\s*)(export\s+)?(?:abstract\s+)?class\s+(\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(classRx);
      if (!m) continue;
      const isExported = !!m[2];
      const name = m[3];
      if (this.exportedOnly && !isExported) continue;

      const doc = this._findPrecedingBlock(blocks, i);
      if (!doc && this._ruleEnabled('missing-class-jsdoc')) {
        issues.push(this._make('missing-class-jsdoc', filePath, i + 1,
          `Class '${name}' is missing a JSDoc comment.`,
          `Add a /** ... */ comment above class '${name}' describing its purpose.`));
      }
    }

    return issues;
  }

  // ─── JSDoc parsing helpers ─────────────────────────────────────────────────

  /**
   * Extract all /** ... * / blocks from source lines.
   * @returns {Array<{startLine: number, endLine: number, text: string}>}
   */
  _extractDocBlocks(lines) {
    const blocks = [];
    let inBlock   = false;
    let startLine = 0;
    let blockLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inBlock && /\/\*\*/.test(line)) {
        inBlock   = true;
        startLine = i;
        blockLines = [line];
        if (/\*\//.test(line)) {
          blocks.push({ startLine, endLine: i, text: blockLines.join('\n').replace(/\/\*\*|\*\//g, '').replace(/^\s*\*/gm, '').trim() });
          inBlock = false;
          blockLines = [];
        }
      } else if (inBlock) {
        blockLines.push(line);
        if (/\*\//.test(line)) {
          blocks.push({ startLine, endLine: i, text: blockLines.join('\n').replace(/\/\*\*|\*\//g, '').replace(/^\s*\*/gm, '').trim() });
          inBlock = false;
          blockLines = [];
        }
      }
    }

    return blocks;
  }

  /**
   * Find the JSDoc block that immediately precedes line `lineIndex`.
   * "Immediately" means the block ends on lineIndex-1 or lineIndex-2 (allowing one blank).
   */
  _findPrecedingBlock(blocks, lineIndex) {
    return blocks.find(b => b.endLine === lineIndex - 1 || b.endLine === lineIndex - 2) || null;
  }

  /**
   * Extract @tag entries from a doc block's text.
   * Returns objects with `name` (param name) and `description`.
   */
  _extractTags(text, tag) {
    const rx = new RegExp(`@${tag}\\s+(?:\\{[^}]*\\}\\s+)?(\\w+)`, 'g');
    const results = [];
    let m;
    while ((m = rx.exec(text)) !== null) {
      results.push({ name: m[1] });
    }
    return results;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _ruleEnabled(ruleId) {
    return this.enabledRules.includes(ruleId);
  }

  _make(rule, filePath, line, message, suggestion) {
    const meta = RULES[rule] || { severity: 'LOW' };
    return {
      type: 'doc-quality',
      rule,
      severity: meta.severity,
      filePath,
      line,
      message,
      suggestion,
      detectedAt: new Date().toISOString()
    };
  }

  _group(arr, key) {
    return arr.reduce((acc, item) => {
      acc[item[key]] = (acc[item[key]] || 0) + 1;
      return acc;
    }, {});
  }

  _log(msg) { if (this.verbose) console.log(`[DocQualityChecker] ${msg}`); }
}

module.exports = { DocQualityChecker, RULES };

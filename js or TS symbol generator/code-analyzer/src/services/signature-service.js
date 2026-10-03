/**
 * Signature Service — Ported from ai_tools_setup/sidecar-api
 * 
 * Returns ONLY the declaration line(s) of a symbol — no body.
 * The cheapest possible lookup (~80 chars).
 * 
 * Walks forward from a symbol's line until `{` or `;` is found.
 */

const path = require('path');
const { SnippetService } = require('./snippet-service');

class SignatureService {
  constructor(rootDir, queryEngine) {
    this.rootDir = rootDir;
    this.queryEngine = queryEngine;
    this.snippetService = new SnippetService(rootDir);
  }

  /**
   * Get declaration text for a symbol by name
   * @param {string} symbolName - Name to look up
   * @param {string} [file] - Optional file filter
   * @returns {Array} Array of signature results
   */
  getSignature(symbolName, file = null) {
    const symbols = this.queryEngine.search(symbolName);
    let results = symbols.filter(s => 
      s.type !== 'import' && s.type !== 'export' && s.type !== 'method'
    );

    if (file) {
      results = results.filter(s => s.file && s.file.includes(file));
    }

    return results.slice(0, 10).map(sym => {
      const declText = this._extractDeclaration(sym.file, sym.line);
      return {
        name: sym.name,
        kind: sym.type,
        file: sym.file,
        line: sym.line,
        signature: sym.metadata?.selector ? `selector: '${sym.metadata.selector}'` : null,
        declarationText: declText,
      };
    });
  }

  /**
   * Get declaration at a specific file:line
   */
  getSignatureAtLine(file, line) {
    const declText = this._extractDeclaration(file, parseInt(line));
    return declText ? {
      file,
      line: parseInt(line),
      declarationText: declText,
    } : null;
  }

  /**
   * Extract declaration text starting at a line, walking forward until { or ;
   */
  _extractDeclaration(file, startLine) {
    const lines = this.snippetService.getFileLines(file);
    if (!lines) return null;

    const idx = startLine - 1;
    if (idx < 0 || idx >= lines.length) return null;

    const decl = [];
    for (let i = idx; i < Math.min(idx + 8, lines.length); i++) {
      const text = lines[i];
      decl.push(text.trimEnd());
      // Stop at opening brace or semicolon
      if (/[{;]/.test(text)) break;
    }

    // Strip body content if brace is on same line
    return decl.join('\n').replace(/\{[\s\S]*$/, '{').trim();
  }
}

module.exports = { SignatureService };

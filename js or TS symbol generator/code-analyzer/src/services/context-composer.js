/**
 * Context Composer — Ported from ai_tools_setup/sidecar-api
 * 
 * Builds a token-budgeted LLM context bundle.
 * 
 * Modes:
 *   compact    (default) — symbol info + ±5 line snippet (~800-1500 tokens)
 *   signatures           — declaration text only, NO bodies (~50-150 tokens)
 *   full                 — symbol info + ±15 line snippet (~800-2000 tokens)
 */

const path = require('path');
const { SnippetService } = require('./snippet-service');
const { SignatureService } = require('./signature-service');

class ContextComposer {
  constructor(rootDir, queryEngine) {
    this.rootDir = rootDir;
    this.queryEngine = queryEngine;
    this.snippetService = new SnippetService(rootDir);
    this.signatureService = new SignatureService(rootDir, queryEngine);
  }

  /**
   * Compose an LLM-ready context bundle
   * @param {string} query - Symbol name or concept to build context for
   * @param {object} options - { maxTokens: 2000, mode: 'compact'|'signatures'|'full' }
   */
  compose(query, options = {}) {
    const { maxTokens = 2000, mode = 'compact' } = options;
    const charBudget = maxTokens * 4; // ~4 chars per token
    const snippetContext = mode === 'full' ? 15 : 5;

    // Step 1: Find symbols matching the query
    const symbolHits = this.queryEngine.search(query).filter(s =>
      s.type !== 'import' && s.type !== 'export'
    );

    const contextParts = [];
    let charCount = 0;

    // Step 2: Build context parts from symbol hits
    for (const sym of symbolHits.slice(0, 10)) {
      if (charCount >= charBudget) break;
      if (!sym.file || !sym.line) continue;

      let part;

      if (mode === 'signatures') {
        // Signatures mode: declaration text only — cheapest
        const declText = this.signatureService._extractDeclaration(sym.file, sym.line);
        part = {
          symbol: sym.name,
          kind: sym.type,
          file: sym.file,
          line: sym.line,
          declarationText: declText || sym.name,
        };
      } else {
        // Compact / Full mode: include snippet
        const snippet = this.snippetService.getSnippet(sym.file, sym.line, snippetContext);
        if (!snippet) continue;

        part = {
          symbol: sym.name,
          kind: sym.type,
          file: sym.file,
          line: sym.line,
          selector: sym.metadata?.selector || null,
          snippet: {
            startLine: snippet.startLine,
            endLine: snippet.endLine,
            lines: snippet.lines.map(l => `${l.number}: ${l.text}`),
          },
        };
      }

      const partSize = JSON.stringify(part).length;
      if (charCount + partSize > charBudget) break;

      contextParts.push(part);
      charCount += partSize;
    }

    const estimatedTokens = Math.ceil(charCount / 4);

    return {
      query,
      mode,
      maxTokens,
      estimatedTokens,
      parts: contextParts,
      summary: `${contextParts.length} parts | ${symbolHits.length} symbol hits | mode=${mode}`,
    };
  }
}

module.exports = { ContextComposer };

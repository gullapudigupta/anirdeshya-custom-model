// src/handlers/composeContextHandler.js
const { SearchService } = require('../services/searchService');
const { SymbolService } = require('../services/symbolService');
const { SnippetService } = require('../services/snippetService');
const logger = require('../utils/logger');
const config = require('../config/config');

function extractDeclaration(relFile, startLine) {
  const lines = SnippetService.getFileLines(relFile);
  if (!lines) return null;
  const idx = startLine - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const decl = [];
  for (let i = idx; i < Math.min(idx + 6, lines.length); i++) {
    decl.push(lines[i].trimEnd());
    if (/[{;]/.test(lines[i])) break;
  }
  return decl.join('\n').replace(/\{[\s\S]*$/, '{').trim();
}

function estimateTokens(str) {
  return Math.ceil(str.length / 4);
}

async function composeContextHandler(req, res) {
  try {
    const { query, maxTokens = 2000, mode = 'compact' } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    const validModes = ['compact', 'signatures', 'full'];
    const resolvedMode = validModes.includes(mode) ? mode : 'compact';
    const snippetContext = resolvedMode === 'full' ? 15 : 5;

    const searchResults = await SearchService.search(query, null, 10);
    if (searchResults.length === 0) {
      return res.json({ query, mode: resolvedMode, status: 'no_results', context: null });
    }

    const symbolHits = SymbolService.getSymbolInfo(query);
    const contextParts = [];
    let charCount = 0;
    const charBudget = maxTokens * 4;

    for (const sym of symbolHits.slice(0, 10)) {
      if (!sym.location || !sym.line) continue;
      if (charCount >= charBudget) break;

      const relFile = sym.location.replace(/\\/g, '/').replace(config.repoRoot.replace(/\\/g, '/') + '/', '');
      let part;

      if (resolvedMode === 'signatures') {
        const declText = extractDeclaration(relFile, parseInt(sym.line)) || sym.signature;
        part = { symbol: sym.name, kind: sym.kind, file: sym.location, line: sym.line, declarationText: declText };
      } else {
        const snippet = SnippetService.getSnippet(relFile, parseInt(sym.line), null, snippetContext);
        if (!snippet) continue;
        part = {
          symbol: sym.name, kind: sym.kind, signature: sym.signature || null, scope: sym.scope || null,
          file: sym.location, line: sym.line,
          snippet: { startLine: snippet.startLine, endLine: snippet.endLine, lines: snippet.lines.map(l => `${l.number}: ${l.text}`) },
        };
      }

      contextParts.push(part);
      charCount += JSON.stringify(part).length;
    }

    if (charCount < charBudget) {
      const coveredFiles = new Set(contextParts.map(p => p.file));
      for (const hit of searchResults.slice(0, 5)) {
        if (charCount >= charBudget) break;
        if (coveredFiles.has(hit.file)) continue;
        let part;
        if (resolvedMode === 'signatures') {
          part = { symbol: hit.symbol?.name || null, kind: hit.symbol?.kind || 'match', file: hit.file, line: hit.line, declarationText: hit.text.trim() };
        } else {
          part = { symbol: hit.symbol?.name || null, kind: hit.symbol?.kind || 'match', file: hit.file, line: hit.line, snippet: { startLine: hit.line, endLine: hit.line, lines: [`${hit.line}: ${hit.text}`] } };
        }
        contextParts.push(part);
        coveredFiles.add(hit.file);
        charCount += JSON.stringify(part).length;
      }
    }

    const estimatedTkns = estimateTokens(JSON.stringify(contextParts));
    res.json({ query, mode: resolvedMode, maxTokens, estimatedTokens: estimatedTkns, parts: contextParts, summary: `${contextParts.length} parts | ${symbolHits.length} symbol hits | ${searchResults.length} rg hits | mode=${resolvedMode}` });
  } catch (error) {
    logger.error('Compose context handler error', { error: error.message });
    res.status(500).json({ error: 'Context composition failed', message: error.message });
  }
}

module.exports = { composeContextHandler };

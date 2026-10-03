// src/handlers/signatureHandler.js
const { SymbolService } = require('../services/symbolService');
const { SnippetService } = require('../services/snippetService');
const logger = require('../utils/logger');
const config = require('../config/config');

function extractDeclaration(file, startLine) {
  const lines = SnippetService.getFileLines(file);
  if (!lines) return null;
  const idx = startLine - 1;
  if (idx < 0 || idx >= lines.length) return null;

  const decl = [];
  for (let i = idx; i < Math.min(idx + 8, lines.length); i++) {
    const text = lines[i];
    decl.push(text.trimEnd());
    if (/[{;]/.test(text)) break;
  }
  return decl.join('\n').replace(/\{[\s\S]*$/, '{').trim();
}

async function signatureHandler(req, res) {
  try {
    const { query, file, line } = req.query;

    if (query) {
      const symbols = SymbolService.getSymbolInfo(query, file || null);
      if (symbols.length === 0) return res.json({ query, count: 0, signatures: [] });

      const signatures = [];
      for (const sym of symbols.slice(0, 20)) {
        if (!sym.location || !sym.line) {
          signatures.push({ name: sym.name, kind: sym.kind, signature: sym.signature || null, file: sym.location || null, line: sym.line || null, declarationText: sym.signature || null });
          continue;
        }
        const relFile = sym.location.replace(/\\/g, '/').replace(config.repoRoot.replace(/\\/g, '/') + '/', '');
        const declText = extractDeclaration(relFile, parseInt(sym.line));
        signatures.push({ name: sym.name, kind: sym.kind, signature: sym.signature || declText, file: sym.location, line: sym.line, declarationText: declText });
      }
      return res.json({ query, count: signatures.length, signatures });
    }

    if (file && line) {
      const lineNum = parseInt(line, 10);
      const sym = SymbolService.symbolAtLine(file, lineNum);
      if (!sym) return res.status(404).json({ error: 'No symbol found at that line' });
      const declText = extractDeclaration(file, sym.line || lineNum);
      return res.json({ count: 1, signatures: [{ name: sym.name, kind: sym.kind, signature: null, file: sym.file, line: sym.line, declarationText: declText }] });
    }

    return res.status(400).json({ error: 'Provide query, or file+line parameters' });
  } catch (error) {
    logger.error('Signature handler error', { error: error.message });
    res.status(500).json({ error: 'Signature lookup failed', message: error.message });
  }
}

module.exports = { signatureHandler };

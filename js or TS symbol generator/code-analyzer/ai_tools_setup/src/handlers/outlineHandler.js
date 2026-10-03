// src/handlers/outlineHandler.js
const { SymbolService } = require('../services/symbolService');
const { CacheManager } = require('../utils/cache');
const logger = require('../utils/logger');

async function outlineHandler(req, res) {
  try {
    const { file, kind, flat } = req.query;
    if (!file) return res.status(400).json({ error: 'file parameter is required' });

    const cacheKey = CacheManager.generateKey('outline', file, kind || '', flat || '');
    const cached = CacheManager.get(cacheKey);
    if (cached) return res.json(cached);

    const allSymbols = SymbolService.getSymbolsInFile(file);
    if (allSymbols.length === 0) return res.json({ file, symbolCount: 0, classes: [], topLevel: [] });

    const kindFilter = kind ? new Set(kind.split(',').map(k => k.trim().toLowerCase())) : null;
    const matches = kindFilter ? allSymbols.filter(s => kindFilter.has((s.kind || '').toLowerCase())) : allSymbols;

    if (flat === 'true') {
      const list = matches.sort((a, b) => (a.line || 0) - (b.line || 0)).map(s => ({
        name: s.symbol || s.name, kind: s.kind, line: s.line, signature: s.signature || null, scope: s.scope || null,
      }));
      const result = { file, symbolCount: list.length, symbols: list };
      CacheManager.set(cacheKey, result);
      return res.json(result);
    }

    const classKinds = new Set(['namedtype', 'class', 'struct', 'interface', 'enum']);
    const classMap = new Map();
    const topLevel = [];

    for (const sym of matches) {
      const k = (sym.kind || '').toLowerCase();
      const n = sym.symbol || sym.name;
      if (classKinds.has(k)) {
        classMap.set(n, { name: n, kind: sym.kind, line: sym.line, signature: sym.signature || null, methods: [], properties: [], fields: [], other: [] });
      }
    }

    for (const sym of matches) {
      const k = (sym.kind || '').toLowerCase();
      const n = sym.symbol || sym.name;
      if (classKinds.has(k)) continue;

      const entry = { name: n, kind: sym.kind, line: sym.line, signature: sym.signature || null };
      const ownerName = sym.scope || null;
      const owner = ownerName ? classMap.get(ownerName) : null;

      if (owner) {
        if (k === 'method') owner.methods.push(entry);
        else if (k === 'property') owner.properties.push(entry);
        else if (k === 'field') owner.fields.push(entry);
        else owner.other.push(entry);
      } else {
        topLevel.push(entry);
      }
    }

    for (const cls of classMap.values()) {
      cls.methods.sort((a, b) => (a.line || 0) - (b.line || 0));
      cls.properties.sort((a, b) => (a.line || 0) - (b.line || 0));
    }

    const classes = [...classMap.values()].sort((a, b) => (a.line || 0) - (b.line || 0));
    topLevel.sort((a, b) => (a.line || 0) - (b.line || 0));

    const result = { file, symbolCount: matches.length, classes, topLevel };
    CacheManager.set(cacheKey, result);
    res.json(result);
  } catch (error) {
    logger.error('Outline handler error', { error: error.message });
    res.status(500).json({ error: 'Outline failed', message: error.message });
  }
}

module.exports = { outlineHandler };

// src/handlers/callersHandler.js
const { SearchService } = require('../services/searchService');
const { SymbolService } = require('../services/symbolService');
const { CacheManager } = require('../utils/cache');
const logger = require('../utils/logger');

async function callersHandler(req, res) {
  try {
    const { name, file, limit = 30 } = req.query;
    if (!name) return res.status(400).json({ error: 'name parameter is required' });

    const limitN = parseInt(limit, 10);
    const cacheKey = CacheManager.generateKey('callers', name, file || '', limitN);
    const cached = CacheManager.get(cacheKey);
    if (cached) return res.json(cached);

    const rgPattern = `\\b${name}\\b`;
    const fileFilter = file ? `**/${file}` : null;
    const rawResults = await SearchService.search(rgPattern, fileFilter, limitN * 2);

    const defPattern = new RegExp(
      `(public|private|protected|internal|static|virtual|override|abstract).*\\b${name}\\b\\s*[(<]`, 'i'
    );
    const callSites = rawResults.filter(r => !defPattern.test(r.text));

    const callers = callSites.slice(0, limitN).map(hit => {
      const enclosing = SymbolService.symbolAtLine(hit.file, hit.line);
      return {
        file: hit.file.replace(/\\/g, '/'),
        line: hit.line,
        callText: hit.text.trim(),
        enclosingSymbol: enclosing ? { name: enclosing.name, kind: enclosing.kind, line: enclosing.line } : null,
      };
    });

    const definition = SymbolService.getSymbolInfo(name).find(
      s => (s.kind || '').toLowerCase() === 'method' || (s.kind || '').toLowerCase() === 'namedtype'
    ) || null;

    const result = {
      name,
      definedAt: definition ? { file: definition.location, line: definition.line, signature: definition.signature } : null,
      count: callers.length,
      callers,
    };

    CacheManager.set(cacheKey, result);
    res.json(result);
  } catch (error) {
    logger.error('Callers handler error', { error: error.message });
    res.status(500).json({ error: 'Caller lookup failed', message: error.message });
  }
}

module.exports = { callersHandler };

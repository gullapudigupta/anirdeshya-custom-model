// src/handlers/symbolsHandler.js
const { SymbolService } = require('../services/symbolService');
const logger = require('../utils/logger');

function symbolsHandler(req, res) {
  try {
    const { file, query, all } = req.query;

    if (all === 'true') {
      const symbols = SymbolService.loadRoslynSymbols();
      return res.json({ total: symbols.length, symbols: symbols.slice(0, 100) });
    }

    if (file) {
      const symbols = SymbolService.getSymbolsInFile(file);
      return res.json({ file, count: symbols.length, symbols });
    }

    if (query) {
      const symbols = SymbolService.getSymbolInfo(query, file);
      return res.json({ query, file: file || 'all', count: symbols.length, symbols });
    }

    res.status(400).json({ error: 'Provide file, query, or all parameter' });
  } catch (error) {
    logger.error('Symbols handler error', { error: error.message });
    res.status(500).json({ error: 'Symbols lookup failed', message: error.message });
  }
}

module.exports = { symbolsHandler };

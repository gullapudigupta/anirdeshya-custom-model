// src/handlers/searchHandler.js
const { SearchService } = require('../services/searchService');
const logger = require('../utils/logger');

async function searchHandler(req, res) {
  try {
    const { q, pattern, limit = 10 } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q is required' });

    const results = await SearchService.search(q, pattern, parseInt(limit, 10));
    res.json({ query: q, pattern, count: results.length, results });
  } catch (error) {
    logger.error('Search handler error', { error: error.message });
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
}

module.exports = { searchHandler };

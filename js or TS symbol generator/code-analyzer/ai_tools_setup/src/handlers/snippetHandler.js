// src/handlers/snippetHandler.js
const { SnippetService } = require('../services/snippetService');
const logger = require('../utils/logger');

function snippetHandler(req, res) {
  try {
    const { file, start, end, context = 5 } = req.query;
    if (!file || !start) return res.status(400).json({ error: 'file and start parameters are required' });

    const startLine = parseInt(start, 10);
    const endLine = end ? parseInt(end, 10) : startLine;
    const contextLines = parseInt(context, 10);

    const snippet = SnippetService.getSnippet(file, startLine, endLine, contextLines);
    if (!snippet) return res.status(404).json({ error: 'File not found' });

    res.json(snippet);
  } catch (error) {
    logger.error('Snippet handler error', { error: error.message });
    res.status(500).json({ error: 'Snippet fetch failed', message: error.message });
  }
}

module.exports = { snippetHandler };

// src/handlers/astNodeHandler.js
const { ASTService } = require('../services/astService');
const logger = require('../utils/logger');

async function astNodeHandler(req, res) {
  try {
    const { file, type = 'method_declaration', extract } = req.query;
    if (!file) return res.status(400).json({ error: 'file parameter is required' });

    let result;
    if (extract === 'classes') result = await ASTService.extractClassNodes(file);
    else if (extract === 'methods') result = await ASTService.extractMethodNodes(file);
    else if (type) result = await ASTService.findNodesOfType(file, type);
    else result = await ASTService.parse(file);

    if (!result) return res.status(404).json({ error: 'File not found or parsing failed' });

    res.json({ file, type: extract || 'ast', count: Array.isArray(result) ? result.length : 1, data: result });
  } catch (error) {
    logger.error('AST node handler error', { error: error.message });
    res.status(500).json({ error: 'AST parsing failed', message: error.message });
  }
}

module.exports = { astNodeHandler };

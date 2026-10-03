// src/handlers/healthHandler.js
const { SymbolService } = require('../services/symbolService');
const logger = require('../utils/logger');
const config = require('../config/config');
const fs = require('fs');

function healthHandler(req, res) {
  try {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: { repoRoot: config.repoRoot, nodeEnv: process.env.NODE_ENV },
      resources: {
        symbols: checkFile(config.symbolsFile),
        tags: checkFile(config.tagsFile),
        artifacts: checkDir(config.artifactsDir)
      },
      version: '2.0.0'
    };
    res.json(health);
  } catch (error) {
    logger.error('Health check error', { error: error.message });
    res.status(500).json({ status: 'error', message: error.message });
  }
}

function checkFile(filepath) {
  return fs.existsSync(filepath) ? { exists: true, size: fs.statSync(filepath).size } : { exists: false };
}

function checkDir(dirpath) {
  return fs.existsSync(dirpath) ? { exists: true } : { exists: false };
}

module.exports = { healthHandler };

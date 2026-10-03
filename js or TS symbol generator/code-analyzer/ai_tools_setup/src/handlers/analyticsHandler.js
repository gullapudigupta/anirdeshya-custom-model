// src/handlers/analyticsHandler.js
const { getAnalyticsSummary } = require('../utils/tokenAnalytics');
const logger = require('../utils/logger');

function analyticsHandler(req, res) {
  try {
    const data = getAnalyticsSummary();
    res.json(data);
  } catch (error) {
    logger.error('Analytics handler error', { error: error.message });
    res.status(500).json({ error: 'Analytics failed', message: error.message });
  }
}

module.exports = { analyticsHandler };

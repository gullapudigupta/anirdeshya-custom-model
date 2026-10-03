// src/index.js - Sidecar API server (C#/Roslyn context serving)
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const logger = require('./utils/logger');
const { searchHandler } = require('./handlers/searchHandler');
const { symbolsHandler } = require('./handlers/symbolsHandler');
const { snippetHandler } = require('./handlers/snippetHandler');
const { astNodeHandler } = require('./handlers/astNodeHandler');
const { composeContextHandler } = require('./handlers/composeContextHandler');
const { refreshHandler, autoRefreshMiddleware } = require('./handlers/refreshHandler');
const { healthHandler } = require('./handlers/healthHandler');
const { signatureHandler } = require('./handlers/signatureHandler');
const { outlineHandler } = require('./handlers/outlineHandler');
const { callersHandler } = require('./handlers/callersHandler');
const { diffContextHandler } = require('./handlers/diffContextHandler');
const { analyticsHandler } = require('./handlers/analyticsHandler');
const { tokenAnalyticsMiddleware } = require('./utils/tokenAnalytics');
const config = require('./config/config');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { query: req.query, body: req.body });
  next();
});

app.use(autoRefreshMiddleware);
app.use(tokenAnalyticsMiddleware);

// Routes
app.get('/health', healthHandler);
app.get('/search', searchHandler);
app.get('/symbols', symbolsHandler);
app.get('/snippet', snippetHandler);
app.get('/ast-node', astNodeHandler);
app.get('/signature', signatureHandler);
app.get('/outline', outlineHandler);
app.get('/callers', callersHandler);
app.get('/diff-context', diffContextHandler);
app.get('/analytics', analyticsHandler);
app.post('/compose-context', composeContextHandler);
app.post('/refresh', refreshHandler);

app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = config.port;
app.listen(PORT, config.host, () => {
  logger.info(`Parikrama Sidecar API listening on http://${config.host}:${PORT}`);
  logger.info(`Roslyn symbols: ${config.symbolsFile}`);
  logger.info(`MCP server available: node mcp-server.js`);
});

module.exports = app;

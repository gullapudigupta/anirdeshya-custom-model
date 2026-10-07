/**
 * CAT-024: Express REST API Server
 * 
 * Optional Express HTTP server exposing all tools as REST endpoints.
 * Same pattern as sidecar (port 3002). Provides HTTP interface for
 * IDE plugins, CI tools, and other services to access the analyzer.
 * 
 * Endpoints:
 *   GET  /health                    - Health check
 *   GET  /stats                     - Current index statistics
 *   POST /snippet                   - Get code snippet (file, line, before, after)
 *   POST /signature                 - Get symbol signature (symbolName)
 *   POST /outline                   - Get file outline (file, format)
 *   POST /callers                   - Find callers (symbolName, maxResults)
 *   POST /compose                   - Compose LLM context (query, mode, budget)
 *   POST /diff-context              - Get annotated diff (staged, commit)
 *   GET  /analytics                 - Token analytics report
 *   POST /query                     - Symbol query (name, type)
 *   POST /analyze                   - Run analysis on file(s)
 *   POST /refresh                   - Force re-index
 * 
 * Usage:
 *   node tools/code-analyzer/src/api/server.js
 *   // or
 *   const { createServer } = require('./server');
 *   const app = createServer(rootDir);
 *   app.listen(3002);
 */

const path = require('path');
const { SnippetService } = require('../services/snippet-service');
const { SignatureService } = require('../services/signature-service');
const { OutlineService } = require('../services/outline-service');
const { CallersService } = require('../services/callers-service');
const { DiffContextService } = require('../services/diff-context-service');
const { ContextComposer } = require('../services/context-composer');
const { QueryEngine } = require('../query-engine');
const { getAnalyzerRoots } = require('../analyzer-roots');
const { TokenAnalytics } = require('../utils/token-analytics');
const { LRUCache } = require('../utils/cache');
const { AutoRefresh } = require('../utils/auto-refresh');

const DEFAULT_PORT = 3002;

/**
 * Create the Express-like HTTP server.
 * Uses a minimal built-in HTTP server to avoid requiring Express as a dependency.
 * If Express is available, use createExpressApp() instead.
 */
function createServer(rootDir, options = {}) {
  const { port = DEFAULT_PORT, enableAutoRefresh = true } = options;

  // Initialize services
  const snippetService = new SnippetService(rootDir);
  const signatureService = new SignatureService(rootDir);
  const outlineService = new OutlineService(rootDir);
  const callersService = new CallersService(rootDir);
  const diffContextService = new DiffContextService(rootDir);
  const queryEngine = new QueryEngine(rootDir);
  const analytics = new TokenAnalytics(rootDir);
  const cache = new LRUCache({ maxSize: 200, defaultTTL: 120000 });

  // Build index
  let indexed = false;
  function ensureIndex() {
    if (!indexed) {
      queryEngine.buildIndex(getAnalyzerRoots(rootDir));
      indexed = true;
    }
  }

  // Auto-refresh
  let autoRefresh = null;
  if (enableAutoRefresh) {
    autoRefresh = new AutoRefresh(rootDir, {
      debounceMs: 30000,
      onRefresh: (changedFiles) => {
        indexed = false;
        snippetService.clearCache();
        signatureService.clearCache();
        outlineService.clearCache();
        cache.clear();
        console.log(`[auto-refresh] Re-indexing due to ${changedFiles.length} file(s) changed`);
      },
    });
    autoRefresh.start();
  }

  // Route definitions
  const routes = {
    'GET /health': () => ({
      status: 'ok',
      uptime: process.uptime(),
      version: '1.0.0',
      indexed,
    }),

    'GET /stats': () => {
      ensureIndex();
      return {
        ...queryEngine.getStats(),
        cache: cache.getStats(),
        analytics: analytics.getReport().totals,
      };
    },

    'POST /snippet': (body) => {
      const { file, line, before = 5, after = 5 } = body;
      if (!file || !line) return { error: 'Required: file, line' };
      
      const result = snippetService.getSnippet(file, line, { before, after });
      
      // Track analytics
      const baseline = analytics.estimateFileTokens(file);
      analytics.recordRequest('snippet', {
        outputTokens: result.tokenEstimate || 0,
        baselineTokens: baseline,
        file,
      });
      
      return result;
    },

    'POST /signature': (body) => {
      const { symbolName } = body;
      if (!symbolName) return { error: 'Required: symbolName' };
      
      ensureIndex();
      const db = queryEngine.getDatabase();
      const result = signatureService.getSignature(symbolName, db);
      
      analytics.recordRequest('signature', {
        outputTokens: result.tokenEstimate || 0,
        baselineTokens: result.file ? analytics.estimateFileTokens(result.file) : 0,
        symbol: symbolName,
      });
      
      return result;
    },

    'POST /outline': (body) => {
      const { file, format = 'tree' } = body;
      if (!file) return { error: 'Required: file' };
      
      const result = outlineService.getOutline(file, { format });
      
      analytics.recordRequest('outline', {
        outputTokens: result.tokenEstimate || 0,
        baselineTokens: analytics.estimateFileTokens(file),
        file,
      });
      
      return result;
    },

    'POST /callers': (body) => {
      const { symbolName, maxResults = 50 } = body;
      if (!symbolName) return { error: 'Required: symbolName' };
      
      const result = callersService.findCallers(symbolName, { maxResults });
      
      analytics.recordRequest('callers', {
        outputTokens: result.tokenEstimate || 0,
        baselineTokens: 0,
        symbol: symbolName,
      });
      
      return result;
    },

    'POST /compose': (body) => {
      const { query, mode = 'compact', tokenBudget } = body;
      if (!query) return { error: 'Required: query' };
      
      // Use a fresh composer (it handles indexing internally)
      const composer = new ContextComposer(rootDir);
      const result = composer.compose(query, { mode, tokenBudget });
      
      analytics.recordRequest('compose', {
        outputTokens: result.tokenUsage?.used || 0,
        baselineTokens: result.tokenUsage?.budget || 0,
        symbol: query,
      });
      
      return result;
    },

    'POST /diff-context': (body) => {
      const { staged = false, commit = null, file = null } = body;
      const result = diffContextService.getDiffContext({ staged, commit, file });
      
      analytics.recordRequest('diff', {
        outputTokens: result.tokenEstimate || 0,
        baselineTokens: result.tokenEstimate ? result.tokenEstimate * 20 : 0,
      });
      
      return result;
    },

    'GET /analytics': () => {
      return analytics.getReport();
    },

    'POST /query': (body) => {
      const { name, type } = body;
      if (!name && !type) return { error: 'Required: name or type' };
      
      ensureIndex();
      
      if (type && !name) {
        return { results: queryEngine.findByType(type) };
      }
      
      const results = queryEngine.search(name);
      if (type) {
        return { results: results.filter(s => s.type === type) };
      }
      return { results };
    },

    'POST /refresh': () => {
      indexed = false;
      snippetService.clearCache();
      signatureService.clearCache();
      outlineService.clearCache();
      cache.clear();
      ensureIndex();
      return { status: 'refreshed', stats: queryEngine.getStats() };
    },
  };

  // ─── HTTP Server (built-in, no Express dependency) ─────────────────────

  const http = require('http');

  const server = http.createServer((req, res) => {
    const method = req.method;
    const url = req.url.split('?')[0]; // Ignore query params
    const routeKey = `${method} ${url}`;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const handler = routes[routeKey];
    if (!handler) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `Route not found: ${routeKey}`, availableRoutes: Object.keys(routes) }));
      return;
    }

    if (method === 'GET') {
      try {
        const result = handler({});
        res.writeHead(200);
        res.end(JSON.stringify(result, null, 2));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST: parse body
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        const result = handler(parsedBody);
        res.writeHead(200);
        res.end(JSON.stringify(result, null, 2));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });

  server.rootDir = rootDir;
  server.services = { snippetService, signatureService, outlineService, callersService, diffContextService, queryEngine, analytics, cache, autoRefresh };
  server.ensureIndex = ensureIndex;
  
  return { server, port, routes, services: server.services };
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

if (require.main === module) {
  const rootDir = path.resolve(__dirname, '../../../..');
  const port = parseInt(process.env.PORT || DEFAULT_PORT);
  
  console.log(`\n  🕉️  Parikrama Code Analyzer API Server`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Root:  ${rootDir}`);
  console.log(`  Port:  ${port}`);
  
  const { server, routes } = createServer(rootDir, { port });
  
  server.listen(port, () => {
    console.log(`  Status: Running`);
    console.log(`\n  Endpoints:`);
    for (const route of Object.keys(routes)) {
      console.log(`    ${route}`);
    }
    console.log(`\n  Ready at http://localhost:${port}\n`);
  });
}

module.exports = { createServer, DEFAULT_PORT };

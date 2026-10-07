/**
 * HTTP API Server - REST API access point for Advanced Quality Tool services
 * 
 * Provides HTTP REST endpoints for external integration with AQT capabilities.
 * Supports quality analysis, code fixing, and reporting via standardized API.
 * 
 * @module HttpApiServer
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { SharedAppServices } = require('../core/shared-app-services');
const { InterfaceAdapter } = require('../core/interface-adapter');
const { WorkOrchestrator } = require('../agent/work-orchestrator');
const { AgentPlanner } = require('../agent/planner');
const { WorkItem, WorkItemStatus } = require('../agent/work-item');
const { getRegistry } = require('../pipelines/pipeline-registry');
const { PipelineExecutor } = require('../pipelines/pipeline-executor');
const { ExecutionLedger, RunStatus } = require('../pipelines/execution-ledger');
const { DashboardIntegration } = require('../dashboard/dashboard-integration');
const { PluginManager } = require('../plugins/plugin-system');

class HttpApiServer {
  constructor(config = {}) {
    // Setup CORS configuration based on environment
    const corsConfig = this.setupCORSConfig(config.cors);
    
    this.config = {
      port: config.port || process.env.AQT_API_PORT || 3000,
      host: config.host || process.env.AQT_API_HOST || 'localhost',
      cors: corsConfig,
      rateLimit: config.rateLimit || { 
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
        legacyHeaders: false, // Disable the `X-RateLimit-*` headers
      },
      globalRateLimit: config.globalRateLimit || {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 1000, // limit all IPs combined to 1000 requests per windowMs
      },
      auth: config.auth || null,
      ...config
    };
    
    this.app = express();
    this.server = null;
    this.sharedServices = new SharedAppServices();
    this.interfaceAdapter = new InterfaceAdapter();
    this.rateLimitStore = new Map(); // In-memory store for rate limiting
    
    // Agent and Pipeline storage
    this.agentWorkStore = new Map(); // Work ID -> { orchestrator, item, options }
    this.pipelineExecutors = new Map(); // Run ID -> executor instance
    this.dashboardIntegration = null;
    this.pluginManager = null;
    this.pluginManagerInitialization = null;
    this.aiProviderConfig = this._loadAiProviderConfig();
    this.sessionApiKeys = new Map();
    this.originalApiKeys = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      google: process.env.GOOGLE_API_KEY
    };
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup CORS configuration with security best practices
   * Never use { origin: true } in production
   */
  setupCORSConfig(corsConfig) {
    // If explicit CORS config provided, use it
    if (corsConfig && typeof corsConfig === 'object' && Object.keys(corsConfig).length > 0) {
      return corsConfig;
    }

    // Environment-based CORS configuration
    const nodeEnv = process.env.NODE_ENV || 'development';
    const allowedOrigins = process.env.AQT_CORS_ORIGINS 
      ? process.env.AQT_CORS_ORIGINS.split(',').map(o => o.trim())
      : [];

    // Production: strict whitelist only
    if (nodeEnv === 'production') {
      if (allowedOrigins.length === 0) {
        console.warn('WARNING: No CORS origins configured for production. Set AQT_CORS_ORIGINS environment variable.');
        return {
          origin: false, // Block all CORS requests if not configured
          credentials: true
        };
      }

      return {
        origin: (origin, callback) => {
          // Allow requests with no origin (like mobile apps, curl, Postman)
          if (!origin) return callback(null, true);
          
          if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
          } else {
            console.warn(`Blocked CORS request from unauthorized origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
          }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
        maxAge: 600 // 10 minutes
      };
    }

    // Development: allow localhost and configured origins
    const devOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:8080',
      ...allowedOrigins
    ];

    return {
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        
        if (devOrigins.indexOf(origin) !== -1) {
          callback(null, true);
        } else {
          console.warn(`Dev mode: Blocked CORS request from: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
    };
  }

  setupMiddleware() {
    // Basic middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    this.app.use(cors(this.config.cors));

    // SECURITY: Add defensive HTTP headers
    this.app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      // Remove fingerprinting headers
      res.removeHeader('X-Powered-By');
      next();
    });
    
    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });

    // Global rate limiting (all requests combined)
    if (this.config.globalRateLimit) {
      this.app.use(this.globalRateLimitMiddleware.bind(this));
    }

    // Per-user/Per-IP rate limiting with sliding window algorithm
    if (this.config.rateLimit) {
      this.app.use(this.rateLimitMiddleware.bind(this));
    }

    // Authentication middleware (if configured)
    if (this.config.auth) {
      this.app.use(this.authMiddleware.bind(this));
    }
  }

  /**
   * Sliding window rate limiter implementation
   * Provides more accurate rate limiting than fixed window
   */
  rateLimitMiddleware(req, res, next) {
    // Identify the client (by IP or auth user)
    const identifier = this.getClientIdentifier(req);
    const now = Date.now();
    const windowMs = this.config.rateLimit.windowMs;
    const maxRequests = this.config.rateLimit.max;

    // Get or initialize request log for this client
    if (!this.rateLimitStore.has(identifier)) {
      this.rateLimitStore.set(identifier, []);
    }

    const requestLog = this.rateLimitStore.get(identifier);

    // Remove requests outside the current window (sliding window)
    const windowStart = now - windowMs;
    const recentRequests = requestLog.filter(timestamp => timestamp > windowStart);
    this.rateLimitStore.set(identifier, recentRequests);

    // Check if limit exceeded
    if (recentRequests.length >= maxRequests) {
      const oldestRequest = Math.min(...recentRequests);
      const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', new Date(oldestRequest + windowMs).toISOString());
      res.setHeader('Retry-After', retryAfter);

      if (this.config.rateLimit.standardHeaders) {
        res.setHeader('RateLimit-Limit', maxRequests);
        res.setHeader('RateLimit-Remaining', 0);
        res.setHeader('RateLimit-Reset', Math.ceil((oldestRequest + windowMs) / 1000));
      }

      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000 / 60} minutes.`,
        retryAfter: retryAfter
      });
    }

    // Add current request to log
    recentRequests.push(now);
    this.rateLimitStore.set(identifier, recentRequests);

    // Set rate limit info headers
    const remaining = maxRequests - recentRequests.length;
    const resetTime = recentRequests[0] + windowMs;

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', new Date(resetTime).toISOString());

    if (this.config.rateLimit.standardHeaders) {
      res.setHeader('RateLimit-Limit', maxRequests);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', Math.ceil(resetTime / 1000));
    }

    next();
  }

  /**
   * Global rate limiter (all requests combined)
   * Protects the server from overall overload
   */
  globalRateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const windowMs = this.config.globalRateLimit.windowMs;
    const maxRequests = this.config.globalRateLimit.max;
    const globalKey = 'global';

    // Get or initialize global request log
    if (!this.rateLimitStore.has(globalKey)) {
      this.rateLimitStore.set(globalKey, []);
    }

    const requestLog = this.rateLimitStore.get(globalKey);

    // Remove requests outside the current window
    const windowStart = now - windowMs;
    const recentRequests = requestLog.filter(timestamp => timestamp > windowStart);
    this.rateLimitStore.set(globalKey, recentRequests);

    // Check if global limit exceeded
    if (recentRequests.length >= maxRequests) {
      const oldestRequest = Math.min(...recentRequests);
      const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);

      res.setHeader('Retry-After', retryAfter);

      return res.status(503).json({
        error: 'Service Temporarily Unavailable',
        message: 'Server is experiencing high load. Please try again later.',
        retryAfter: retryAfter
      });
    }

    // Add current request to global log
    recentRequests.push(now);
    this.rateLimitStore.set(globalKey, recentRequests);

    next();
  }

  /**
   * Get unique identifier for rate limiting
   * Uses authenticated user ID if available, falls back to IP address
   */
  getClientIdentifier(req) {
    // If authenticated, use user ID
    if (req.user && req.user.id) {
      return `user:${req.user.id}`;
    }

    // SECURITY FIX: Only trust X-Forwarded-For when behind a trusted proxy.
    // Blindly trusting this header allows IP spoofing to bypass rate limits.
    // Use the direct connection address by default; set AQT_TRUST_PROXY=true
    // only when the server is behind a known reverse proxy.
    const trustProxy = process.env.AQT_TRUST_PROXY === 'true';
    if (trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      const ip = forwarded ? forwarded.split(',')[0].trim() : (req.connection && req.connection.remoteAddress) || 'unknown';
      return `ip:${ip}`;
    }
    const ip = (req.connection && req.connection.remoteAddress) || (req.socket && req.socket.remoteAddress) || 'unknown';
    return `ip:${ip}`;
  }

  authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (this.config.auth.type === 'token' && token === this.config.auth.token) {
      next();
    } else if (this.config.auth.type === 'function' && this.config.auth.validator(token)) {
      next();
    } else {
      res.status(401).json({ error: 'Invalid authentication token' });
    }
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: require('../../package.json').version
      });
    });

    // API info
    this.app.get('/api/info', (req, res) => {
      res.json({
        name: 'Advanced Quality Tool API',
        version: require('../../package.json').version,
        endpoints: [
          'GET /health',
          'GET /api/info', 
          'POST /api/analyze',
          'POST /api/fix',
          'POST /api/generate-fixes',
          'GET /api/reports',
          'GET /api/reports/:id',
          'POST /api/workspace/config',
          'GET /api/workspace/status',
          'POST /api/ai/generate/code',
          'POST /api/ai/generate/test',
          'POST /api/ai/generate/doc',
          'POST /api/ai/fix',
          'POST /api/ai/refactor',
          'POST /api/ai/configure',
          'GET /api/ai/config',
          'GET /api/ai/cost',
          'POST /api/agent/start',
          'GET /api/agent',
          'GET /api/agent/:id',
          'DELETE /api/agent/:id',
          'POST /api/agent/:id/approve',
          'GET /api/agent/:id/logs',
          'GET /api/pipelines',
          'GET /api/pipelines/:name',
          'POST /api/pipelines/:name/execute',
          'GET /api/pipelines/executions',
          'GET /api/pipelines/executions/:id',
          'POST /api/pipelines/executions/:id/replay',
          'POST /api/dashboard/configure',
          'POST /api/dashboard/record',
          'GET /api/dashboard/status',
          'GET /api/dashboard/metrics',
          'GET /api/plugins',
          'POST /api/plugins/install',
          'GET /api/plugins/:id',
          'DELETE /api/plugins/:id',
          'POST /api/plugins/:id/enable',
          'POST /api/plugins/:id/disable'
        ]
      });
    });

    // Quality Analysis
    this.app.post('/api/analyze', this.handleAnalyze.bind(this));
    
    // Code Fixing
    this.app.post('/api/fix', this.handleFix.bind(this));
    this.app.post('/api/generate-fixes', this.handleGenerateFixes.bind(this));
    this.app.post('/api/issues/batch-fix', this.handleBatchFix.bind(this));
    
    // Reports
    this.app.get('/api/reports', this.handleGetReports.bind(this));
    this.app.get('/api/reports/:id', this.handleGetReport.bind(this));
    
    // Workspace Management
    this.app.post('/api/workspace/config', this.handleWorkspaceConfig.bind(this));
    this.app.get('/api/workspace/status', this.handleWorkspaceStatus.bind(this));

    // Files endpoint for workspace file operations
    this.app.get('/api/files', this.handleListFiles.bind(this));
    this.app.get('/api/files/*', this.handleGetFile.bind(this));

    // AI Generation Endpoints (P11-T059)
    this.app.post('/api/ai/generate/code', this.handleAIGenerateCode.bind(this));
    this.app.post('/api/ai/generate/test', this.handleAIGenerateTest.bind(this));
    this.app.post('/api/ai/generate/doc', this.handleAIGenerateDoc.bind(this));
    this.app.post('/api/ai/fix', this.handleAIFixIssue.bind(this));
    this.app.post('/api/ai/refactor', this.handleAIRefactor.bind(this));
    this.app.post('/api/ai/configure', this.handleAIConfigure.bind(this));
    this.app.get('/api/ai/config', this.handleAIConfigGet.bind(this));
    this.app.get('/api/ai/cost', this.handleAICost.bind(this));

    // Agent System Endpoints (P11-T004)
    this.app.post('/api/agent/start', this.handleAgentStart.bind(this));
    this.app.get('/api/agent/:id', this.handleAgentStatus.bind(this));
    this.app.get('/api/agent', this.handleAgentList.bind(this));
    this.app.delete('/api/agent/:id', this.handleAgentCancel.bind(this));
    this.app.post('/api/agent/:id/approve', this.handleAgentApprove.bind(this));
    this.app.get('/api/agent/:id/logs', this.handleAgentLogs.bind(this));

    // Pipeline System Endpoints (P11-T005)
    this.app.get('/api/pipelines', this.handlePipelineList.bind(this));
    this.app.get('/api/pipelines/:name', this.handlePipelineInfo.bind(this));
    this.app.post('/api/pipelines/:name/execute', this.handlePipelineExecute.bind(this));
    this.app.get('/api/pipelines/executions/:id', this.handlePipelineStatus.bind(this));
    this.app.post('/api/pipelines/executions/:id/replay', this.handlePipelineReplay.bind(this));
    this.app.get('/api/pipelines/executions', this.handlePipelineHistory.bind(this));

    // Security Endpoints (P11-T006)
    this.app.post('/api/security/scan', this.handleSecurityScan.bind(this));
    this.app.get('/api/security/vulnerabilities', this.handleGetVulnerabilities.bind(this));
    this.app.get('/api/security/secrets', this.handleGetSecrets.bind(this));
    this.app.get('/api/security/dependencies', this.handleGetDependencies.bind(this));

    // Dashboard endpoints (P11-T051)
    this.app.post('/api/dashboard/configure', this.handleDashboardConfigure.bind(this));
    this.app.post('/api/dashboard/record', this.handleDashboardRecord.bind(this));
    this.app.get('/api/dashboard/status', this.handleDashboardStatus.bind(this));
    this.app.get('/api/dashboard/metrics', this.handleDashboardMetrics.bind(this));

    // Plugin management endpoints (P11-T054)
    this.app.get('/api/plugins', this.handlePluginList.bind(this));
    this.app.post('/api/plugins/install', this.handlePluginInstall.bind(this));
    this.app.get('/api/plugins/:id', this.handlePluginInfo.bind(this));
    this.app.delete('/api/plugins/:id', this.handlePluginRemove.bind(this));
    this.app.post('/api/plugins/:id/enable', this.handlePluginEnable.bind(this));
    this.app.post('/api/plugins/:id/disable', this.handlePluginDisable.bind(this));
  }

  _aiProviderConfigPath() {
    return path.join(this.config.projectRoot || process.cwd(), '.aqt', 'ai-provider.json');
  }

  _loadAiProviderConfig() {
    const defaults = {
      provider: 'ollama',
      model: '',
      maxCost: 1,
      monthlyBudget: 100,
      requestsPerMinute: 20
    };
    const configPath = this._aiProviderConfigPath();
    if (!fsSync.existsSync(configPath)) return defaults;
    const stored = JSON.parse(fsSync.readFileSync(configPath, 'utf8'));
    return { ...defaults, ...stored };
  }

  handleAIConfigGet(req, res) {
    const provider = this.aiProviderConfig.provider;
    const envKey = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      google: process.env.GOOGLE_API_KEY
    }[provider];
    res.json({
      success: true,
      data: {
        ...this.aiProviderConfig,
        credentialsConfigured: provider === 'ollama' || Boolean(this.sessionApiKeys.get(provider) || envKey),
        credentialsSource: provider === 'ollama' ? 'local' :
          this.sessionApiKeys.has(provider) ? 'runtime' : envKey ? 'environment' : 'missing'
      }
    });
  }

  _dashboardConfigPath() {
    return path.join(this.config.projectRoot || process.cwd(), '.aqt', 'dashboard.json');
  }

  _readDashboardConfig() {
    const configPath = this._dashboardConfigPath();
    if (!fsSync.existsSync(configPath)) {
      return {
        enabled: false,
        port: 3210,
        dataDir: path.join(path.dirname(path.dirname(configPath)), '.aqt', 'dashboard-data')
      };
    }
    const config = JSON.parse(fsSync.readFileSync(configPath, 'utf8'));
    return {
      enabled: config.enabled === true,
      port: config.port || 3210,
      dataDir: config.dataDir || path.join(path.dirname(path.dirname(configPath)), '.aqt', 'dashboard-data')
    };
  }

  _getDashboardIntegration(config = this._readDashboardConfig()) {
    if (!this.dashboardIntegration) {
      this.dashboardIntegration = new DashboardIntegration({
        port: config.port,
        dataDir: config.dataDir
      });
    }
    return this.dashboardIntegration;
  }

  _requireManagementAuth(req, res) {
    if (this.config.auth) return true;
    res.status(401).json({ error: 'Authentication is required for management changes' });
    return false;
  }

  async _getPluginManager() {
    if (!this.pluginManager) {
      const root = path.resolve(this.config.projectRoot || process.cwd());
      this.pluginManager = new PluginManager({
        pluginDirs: [path.join(root, '.aqt', 'plugins')]
      });
    }
    if (!this.pluginManagerInitialization) {
      this.pluginManagerInitialization = this.pluginManager.initialize();
    }
    await this.pluginManagerInitialization;
    return this.pluginManager;
  }

  async handlePluginList(req, res) {
    try {
      const manager = await this._getPluginManager();
      res.json({ success: true, data: { plugins: manager.listPlugins(), stats: manager.getStats() } });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list plugins', message: error.message });
    }
  }

  async handlePluginInfo(req, res) {
    try {
      const manager = await this._getPluginManager();
      const plugin = manager.getPlugin(req.params.id);
      if (!plugin) return res.status(404).json({ error: 'Plugin not found or disabled' });
      res.json({
        success: true,
        data: {
          ...plugin.manifest,
          path: plugin.path,
          enabled: true,
          registeredHooks: Array.from(manager.hooks.entries())
            .filter(([, hooks]) => hooks.some(hook => hook.pluginId === req.params.id))
            .map(([name]) => name)
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get plugin information', message: error.message });
    }
  }

  async handlePluginInstall(req, res) {
    if (!this._requireManagementAuth(req, res)) return;
    try {
      const root = path.resolve(this.config.projectRoot || process.cwd());
      const source = path.resolve(root, String((req.body || {}).path || ''));
      const relative = path.relative(root, source);
      if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return res.status(400).json({ error: 'Plugin source must be inside the configured project workspace' });
      }
      if (!fsSync.existsSync(source)) return res.status(404).json({ error: 'Plugin source not found' });
      const pluginDirectory = path.join(root, '.aqt', 'plugins');
      await fs.mkdir(pluginDirectory, { recursive: true });
      const destination = path.join(pluginDirectory, path.basename(source));
      if (fsSync.existsSync(destination)) return res.status(409).json({ error: 'A plugin with that path already exists' });
      await fs.cp(source, destination, { recursive: true, errorOnExist: true });
      const manager = await this._getPluginManager();
      await manager.loadPlugin(destination);
      res.status(201).json({
        success: true,
        data: {
          path: destination,
          plugins: manager.listPlugins(),
          stats: manager.getStats()
        }
      });
    } catch (error) {
      res.status(400).json({ error: 'Failed to install plugin', message: error.message });
    }
  }

  async handlePluginRemove(req, res) {
    if (!this._requireManagementAuth(req, res)) return;
    try {
      const manager = await this._getPluginManager();
      const pluginPath = manager.pluginPaths.get(req.params.id);
      if (!pluginPath) return res.status(404).json({ error: 'Plugin not found' });
      const root = path.resolve(this.config.projectRoot || process.cwd());
      const pluginRoot = path.join(root, '.aqt', 'plugins');
      const relative = path.relative(pluginRoot, path.resolve(pluginPath));
      if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return res.status(400).json({ error: 'Refusing to remove a plugin outside the managed plugin directory' });
      }
      if (!(await manager.removePlugin(req.params.id))) {
        return res.status(409).json({ error: 'Plugin could not be unloaded safely' });
      }
      await fs.rm(pluginPath, { recursive: true, force: false });
      res.json({ success: true, data: { removed: req.params.id } });
    } catch (error) {
      res.status(500).json({ error: 'Failed to remove plugin', message: error.message });
    }
  }

  async handlePluginEnable(req, res) {
    if (!this._requireManagementAuth(req, res)) return;
    try {
      const manager = await this._getPluginManager();
      if (!(await manager.enablePlugin(req.params.id))) return res.status(404).json({ error: 'Plugin could not be enabled' });
      res.json({ success: true, data: { plugin: req.params.id, enabled: true } });
    } catch (error) {
      res.status(500).json({ error: 'Failed to enable plugin', message: error.message });
    }
  }

  async handlePluginDisable(req, res) {
    if (!this._requireManagementAuth(req, res)) return;
    try {
      const manager = await this._getPluginManager();
      if (!(await manager.disablePlugin(req.params.id))) return res.status(404).json({ error: 'Plugin could not be disabled' });
      res.json({ success: true, data: { plugin: req.params.id, enabled: false } });
    } catch (error) {
      res.status(500).json({ error: 'Failed to disable plugin', message: error.message });
    }
  }

  async handleDashboardConfigure(req, res) {
    if (!this._requireManagementAuth(req, res)) return;
    try {
      const current = this._readDashboardConfig();
      const updates = req.body || {};
      if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      if (updates.port !== undefined &&
          (!Number.isInteger(updates.port) || updates.port < 1 || updates.port > 65535)) {
        return res.status(400).json({ error: 'port must be an integer between 1 and 65535' });
      }
      const next = {
        ...current,
        ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
        ...(updates.port !== undefined ? { port: updates.port } : {}),
        ...(typeof updates.dataDir === 'string' && updates.dataDir.trim()
          ? { dataDir: path.resolve(this.config.projectRoot || process.cwd(), updates.dataDir) }
          : {})
      };
      const configPath = this._dashboardConfigPath();
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      this.dashboardIntegration = new DashboardIntegration({ port: next.port, dataDir: next.dataDir });
      res.json({ success: true, data: { ...next, scans: this.dashboardIntegration.history.length } });
    } catch (error) {
      res.status(500).json({ error: 'Failed to configure dashboard', message: error.message });
    }
  }

  async handleDashboardRecord(req, res) {
    if (!this._requireManagementAuth(req, res)) return;
    try {
      const { results, metadata } = req.body || {};
      if (!Array.isArray(results)) return res.status(400).json({ error: 'results must be an array' });
      const config = this._readDashboardConfig();
      if (!config.enabled) return res.status(409).json({ error: 'Dashboard recording is disabled' });
      const record = this._getDashboardIntegration(config).recordScan(results, metadata || {});
      res.json({ success: true, data: record });
    } catch (error) {
      res.status(500).json({ error: 'Failed to record dashboard metrics', message: error.message });
    }
  }

  async handleDashboardStatus(req, res) {
    try {
      const config = this._readDashboardConfig();
      const dashboard = this._getDashboardIntegration(config);
      res.json({
        success: true,
        data: { enabled: config.enabled, port: config.port, dataDir: config.dataDir, ...dashboard.getDashboardData() }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to read dashboard status', message: error.message });
    }
  }

  async handleDashboardMetrics(req, res) {
    try {
      const config = this._readDashboardConfig();
      res.json({ success: true, data: this._getDashboardIntegration(config).currentMetrics });
    } catch (error) {
      res.status(500).json({ error: 'Failed to read dashboard metrics', message: error.message });
    }
  }

  async handleAnalyze(req, res) {
    try {
      const { workspacePath, files, options = {} } = req.body;
      
      if (!workspacePath) {
        return res.status(400).json({ error: 'workspacePath is required' });
      }

      const analysisOptions = {
        includeMetrics: options.includeMetrics !== false,
        includeSecurity: options.includeSecurity !== false,
        includePerformance: options.includePerformance !== false,
        languages: options.languages || [],
        ...options
      };

      const result = await this.sharedServices.analyzeWorkspace(workspacePath, analysisOptions);
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Analysis error:', error);
      res.status(500).json({ 
        error: 'Analysis failed', 
        message: error.message 
      });
    }
  }

  async handleFix(req, res) {
    try {
      const { workspacePath, issueId, fixType = 'auto', options = {} } = req.body;
      
      if (!workspacePath || !issueId) {
        return res.status(400).json({ 
          error: 'workspacePath and issueId are required' 
        });
      }

      const fixOptions = {
        dryRun: options.dryRun === true,
        backup: options.backup !== false,
        verification: options.verification !== false,
        ...options
      };

      const result = await this.sharedServices.fixIssue(issueId, workspacePath, fixOptions);
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Fix error:', error);
      res.status(500).json({ 
        error: 'Fix operation failed', 
        message: error.message 
      });
    }
  }

  async handleGenerateFixes(req, res) {
    try {
      const { workspacePath, issues, options = {} } = req.body;
      
      if (!workspacePath || !Array.isArray(issues)) {
        return res.status(400).json({ 
          error: 'workspacePath and issues array are required' 
        });
      }

      const generateOptions = {
        maxFixes: options.maxFixes || 50,
        priority: options.priority || 'high',
        includeAI: options.includeAI !== false,
        ...options
      };

      const result = await this.sharedServices.generateFixes(issues, workspacePath, generateOptions);
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Generate fixes error:', error);
      res.status(500).json({ 
        error: 'Fix generation failed', 
        message: error.message 
      });
    }
  }

  async handleBatchFix(req, res) {
    try {
      const { issueIds, workspacePath, options = {} } = req.body;
      
      if (!issueIds || !Array.isArray(issueIds) || issueIds.length === 0) {
        return res.status(400).json({ 
          error: 'issueIds array is required and must not be empty' 
        });
      }

      const batchOptions = {
        dryRun: options.dryRun === true,
        backup: options.backup !== false,
        verification: options.verification !== false,
        autoApply: options.autoApply === true,
        confidenceThreshold: options.confidenceThreshold || 0.8,
        ...options
      };

      const results = {
        successful: [],
        failed: [],
        skipped: [],
        totalAttempted: issueIds.length,
        startTime: new Date().toISOString()
      };

      // Process each issue fix
      for (let i = 0; i < issueIds.length; i++) {
        const issueId = issueIds[i];
        try {
          const fixResult = await this.sharedServices.fixIssue(
            issueId, 
            workspacePath || process.cwd(), 
            batchOptions
          );
          
          if (fixResult && fixResult.success) {
            results.successful.push({
              issueId,
              fixType: fixResult.fixType,
              confidence: fixResult.confidence,
              appliedAt: new Date().toISOString()
            });
          } else if (fixResult && fixResult.reason === 'confidence_too_low') {
            results.skipped.push({
              issueId,
              reason: 'Confidence below threshold',
              confidence: fixResult.confidence
            });
          } else {
            results.failed.push({
              issueId,
              reason: fixResult?.message || 'Unknown error'
            });
          }
        } catch (error) {
          results.failed.push({
            issueId,
            reason: error.message
          });
        }
      }

      results.endTime = new Date().toISOString();
      results.summary = {
        successCount: results.successful.length,
        failureCount: results.failed.length,
        skippedCount: results.skipped.length,
        successRate: results.totalAttempted > 0 
          ? ((results.successful.length / results.totalAttempted) * 100).toFixed(1) + '%'
          : '0%'
      };

      res.json({
        success: true,
        data: results,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Batch fix error:', error);
      res.status(500).json({ 
        error: 'Batch fix failed', 
        message: error.message 
      });
    }
  }

  async handleGetReports(req, res) {
    try {
      const { limit = 10, offset = 0, type } = req.query;
      
      const result = await this.sharedServices.getReports({
        limit: parseInt(limit),
        offset: parseInt(offset),
        type
      });
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get reports error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve reports', 
        message: error.message 
      });
    }
  }

  async handleGetReport(req, res) {
    try {
      const { id } = req.params;
      const { format = 'json' } = req.query;
      
      const result = await this.sharedServices.getReport(id, { format });
      
      if (!result) {
        return res.status(404).json({ error: 'Report not found' });
      }
      
      if (format === 'html') {
        res.setHeader('Content-Type', 'text/html');
        res.send(result);
      } else {
        res.json({
          success: true,
          data: result,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Get report error:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve report', 
        message: error.message 
      });
    }
  }

  async handleWorkspaceConfig(req, res) {
    try {
      const { workspacePath, config } = req.body;
      
      if (!workspacePath || !config) {
        return res.status(400).json({ 
          error: 'workspacePath and config are required' 
        });
      }

      const result = await this.sharedServices.setWorkspaceConfig(workspacePath, config);
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Workspace config error:', error);
      res.status(500).json({ 
        error: 'Failed to update workspace config', 
        message: error.message 
      });
    }
  }

  async handleWorkspaceStatus(req, res) {
    try {
      const { workspacePath } = req.query;
      
      if (!workspacePath) {
        return res.status(400).json({ error: 'workspacePath is required' });
      }

      const result = await this.sharedServices.getWorkspaceStatus(workspacePath);
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Workspace status error:', error);
      res.status(500).json({ 
        error: 'Failed to get workspace status', 
        message: error.message 
      });
    }
  }

  async handleListFiles(req, res) {
    try {
      const { workspacePath, pattern } = req.query;
      
      if (!workspacePath) {
        return res.status(400).json({ error: 'workspacePath is required' });
      }

      const result = await this.sharedServices.listWorkspaceFiles(workspacePath, pattern);
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('List files error:', error);
      res.status(500).json({ 
        error: 'Failed to list files', 
        message: error.message 
      });
    }
  }

  async handleGetFile(req, res) {
    try {
      const filePath = req.params[0]; // Captures the wildcard path
      const { workspacePath } = req.query;
      
      if (!workspacePath || !filePath) {
        return res.status(400).json({ 
          error: 'workspacePath and file path are required' 
        });
      }

      // SECURITY FIX: Prevent path traversal attacks
      const resolvedWorkspace = path.resolve(workspacePath);
      const resolvedFile = path.resolve(resolvedWorkspace, filePath);
      if (!resolvedFile.startsWith(resolvedWorkspace + path.sep) &&
          resolvedFile !== resolvedWorkspace) {
        return res.status(403).json({ error: 'Access denied: path traversal detected' });
      }

      const result = await this.sharedServices.getWorkspaceFile(workspacePath, filePath);
      
      if (!result) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get file error:', error);
      res.status(500).json({ 
        error: 'Failed to get file', 
        message: error.message 
      });
    }
  }

  // ============================================================================
  // AI Generation Endpoints (P11-T059)
  // ============================================================================

  async handleAIGenerateCode(req, res) {
    try {
      const { description, language, framework, provider, model, options = {} } = req.body;
      
      if (!description) {
        return res.status(400).json({ error: 'description is required' });
      }

      const result = await this.sharedServices.aiGenerateCode({
        description,
        language: language || 'javascript',
        framework,
        provider,
        model,
        ...options
      });
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('AI code generation error:', error);
      res.status(500).json({ 
        error: 'Code generation failed', 
        message: error.message 
      });
    }
  }

  async handleAIGenerateTest(req, res) {
    try {
      const { filePath, content, framework, provider, options = {} } = req.body;
      
      if (!filePath) {
        return res.status(400).json({ error: 'filePath is required' });
      }

      const result = await this.sharedServices.aiGenerateTest({
        filePath,
        content,
        framework: framework || 'jest',
        provider,
        ...options
      });
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('AI test generation error:', error);
      res.status(500).json({ 
        error: 'Test generation failed', 
        message: error.message 
      });
    }
  }

  async handleAIGenerateDoc(req, res) {
    try {
      const { filePath, content, format, provider, options = {} } = req.body;
      
      if (!filePath) {
        return res.status(400).json({ error: 'filePath is required' });
      }

      const result = await this.sharedServices.aiGenerateDoc({
        filePath,
        content,
        format: format || 'markdown',
        provider,
        ...options
      });
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('AI documentation generation error:', error);
      res.status(500).json({ 
        error: 'Documentation generation failed', 
        message: error.message 
      });
    }
  }

  async handleAIFixIssue(req, res) {
    try {
      const { issue, issueId, dryRun, provider, options = {} } = req.body;
      
      if (!issue && !issueId) {
        return res.status(400).json({ 
          error: 'issue or issueId is required' 
        });
      }

      const result = await this.sharedServices.aiFixIssue({
        issue,
        issueId,
        dryRun: dryRun || false,
        provider,
        ...options
      });
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('AI issue fix error:', error);
      res.status(500).json({ 
        error: 'Issue fix failed', 
        message: error.message 
      });
    }
  }

  async handleAIRefactor(req, res) {
    try {
      const { filePath, content, description, autoApply, provider, options = {} } = req.body;
      
      if (!filePath || !description) {
        return res.status(400).json({ 
          error: 'filePath and description are required' 
        });
      }

      const result = await this.sharedServices.aiRefactor({
        filePath,
        content,
        description,
        autoApply: autoApply || false,
        provider,
        ...options
      });
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('AI refactoring error:', error);
      res.status(500).json({ 
        error: 'Refactoring failed', 
        message: error.message 
      });
    }
  }

  async handleAIConfigure(req, res) {
    if (!this._requireManagementAuth(req, res)) return;
    try {
      const body = req.body || {};
      const providers = ['openai', 'anthropic', 'google', 'ollama'];
      if (body.provider !== undefined && !providers.includes(body.provider)) {
        return res.status(400).json({ error: 'provider must be openai, anthropic, google, or ollama' });
      }
      const next = { ...this.aiProviderConfig };
      if (body.provider !== undefined) next.provider = body.provider;
      if (body.model !== undefined) {
        if (typeof body.model !== 'string' || body.model.length > 128) {
          return res.status(400).json({ error: 'model must be a string no longer than 128 characters' });
        }
        next.model = body.model.trim();
      }
      for (const key of ['maxCost', 'monthlyBudget']) {
        if (body[key] !== undefined &&
            (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < 0)) {
          return res.status(400).json({ error: `${key} must be a non-negative number` });
        }
        if (body[key] !== undefined) next[key] = body[key];
      }
      if (body.requestsPerMinute !== undefined &&
          (!Number.isInteger(body.requestsPerMinute) || body.requestsPerMinute < 1)) {
        return res.status(400).json({ error: 'requestsPerMinute must be a positive integer' });
      }
      if (body.requestsPerMinute !== undefined) next.requestsPerMinute = body.requestsPerMinute;
      if (body.clearApiKey === true) {
        const envNames = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY' };
        const previousProvider = next.provider;
        if (this.sessionApiKeys.has(previousProvider)) {
          const envName = envNames[previousProvider];
          if (this.originalApiKeys[previousProvider]) process.env[envName] = this.originalApiKeys[previousProvider];
          else delete process.env[envName];
          this.sessionApiKeys.delete(previousProvider);
        }
      }
      if (body.apiKey !== undefined && body.apiKey !== '') {
        if (next.provider === 'ollama') {
          return res.status(400).json({ error: 'Ollama does not use an API key' });
        }
        if (typeof body.apiKey !== 'string' || body.apiKey.trim().length < 20 || /\s/.test(body.apiKey)) {
          return res.status(400).json({ error: 'API key must contain at least 20 non-whitespace characters' });
        }
        const envName = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY' }[next.provider];
        process.env[envName] = body.apiKey.trim();
        this.sessionApiKeys.set(next.provider, body.apiKey.trim());
      }

      const configPath = this._aiProviderConfigPath();
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      this.aiProviderConfig = next;
      const configured = next.provider === 'ollama' ||
        Boolean(this.sessionApiKeys.get(next.provider) ||
          ({ openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY, google: process.env.GOOGLE_API_KEY }[next.provider]));
      res.json({
        success: true,
        data: { ...next, credentialsConfigured: configured, credentialsSaved: false },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Configuration failed', 
        message: error.message 
      });
    }
  }

  async handleAICost(req, res) {
    try {
      const { period = 'month' } = req.query;

      const result = await this.sharedServices.aiCostTracking({
        period
      });
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('AI cost tracking error:', error);
      res.status(500).json({ 
        error: 'Cost tracking failed', 
        message: error.message 
      });
    }
  }

  // ============================================================================
  // Agent System Endpoints (P11-T004)
  // ============================================================================

  async handleAgentStart(req, res) {
    try {
      const { 
        description, 
        workspace, 
        files, 
        priority = 'medium',
        maxFiles = 50,
        autoApprove = false,
        deliverables = []
      } = req.body;
      
      if (!description) {
        return res.status(400).json({ error: 'description is required' });
      }

      const workspacePath = workspace || process.cwd();
      
      // Create work orchestrator
      const planner = new AgentPlanner({ workspace: workspacePath });
      const orchestrator = new WorkOrchestrator({
        workspace: workspacePath,
        planner,
        maxConcurrent: 1,
        permissionLimits: {
          maxFilesPerTask: maxFiles,
          requireApprovalForHighRisk: !autoApprove,
          requireApprovalForDelete: !autoApprove
        },
        onProgress: (event) => {
          // Could emit to WebSocket for real-time updates
          console.log(`[Agent] ${event.type}: ${event.item?.id || ''}`);
        },
        onApprovalRequired: async (item, plan) => {
          // Approval will be handled via separate endpoint
          return autoApprove;
        }
      });
      
      // Create work item
      const workItem = orchestrator.addWork({
        description,
        files: files || [],
        priority,
        plan: { deliverables }
      });
      
      // Store for later reference
      const workId = workItem.id;
      this.agentWorkStore.set(workId, {
        orchestrator,
        item: workItem,
        options: { workspace: workspacePath, maxFiles, autoApprove },
        logs: [],
        started: new Date().toISOString(),
        approved: false
      });
      
      // Start execution asynchronously (don't wait for completion)
      this.executeAgentWork(workId).catch(err => {
        console.error(`Agent work ${workId} failed:`, err);
      });
      
      res.json({
        success: true,
        data: {
          workId,
          status: 'started',
          description,
          workspace: workspacePath
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Agent start error:', error);
      res.status(500).json({ 
        error: 'Failed to start agent work', 
        message: error.message 
      });
    }
  }

  async executeAgentWork(workId) {
    const stored = this.agentWorkStore.get(workId);
    if (!stored) return;
    
    try {
      const results = await stored.orchestrator.executeOne(workId);
      stored.result = results;
      stored.completed = new Date().toISOString();
    } catch (error) {
      stored.error = error.message;
      stored.completed = new Date().toISOString();
    }
  }

  async handleAgentStatus(req, res) {
    try {
      const { id } = req.params;
      
      const stored = this.agentWorkStore.get(id);
      
      if (stored) {
        const summary = stored.item.getSummary();
        
        res.json({
          success: true,
          data: {
            id,
            description: summary.description,
            status: summary.status,
            priority: summary.priority,
            started: stored.started,
            completed: stored.completed || null,
            plan: summary.plan,
            output: stored.result?.output || null,
            error: stored.error || summary.error || null,
            active: true
          },
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      // Check for historical record
      const record = await this.loadAgentWorkRecord(id);
      
      if (!record) {
        return res.status(404).json({ error: 'Work item not found' });
      }
      
      res.json({
        success: true,
        data: record,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Agent status error:', error);
      res.status(500).json({ 
        error: 'Failed to get agent status', 
        message: error.message 
      });
    }
  }

  async handleAgentList(req, res) {
    try {
      const { status, limit = 50 } = req.query;
      
      const items = [];
      
      // Active work from memory
      for (const [id, stored] of this.agentWorkStore.entries()) {
        const summary = stored.item.getSummary();
        if (!status || summary.status === status) {
          items.push({
            id,
            description: summary.description,
            status: summary.status,
            priority: summary.priority,
            started: stored.started,
            active: true
          });
        }
      }
      
      // Historical work
      const historyPath = this.getAgentHistoryPath();
      if (fs.existsSync && require('fs').existsSync(historyPath)) {
        const files = require('fs').readdirSync(historyPath).filter(f => f.endsWith('.json'));
        for (const file of files.slice(0, parseInt(limit))) {
          try {
            const record = JSON.parse(require('fs').readFileSync(path.join(historyPath, file), 'utf8'));
            if (!status || record.status === status) {
              items.push({
                ...record,
                active: false
              });
            }
          } catch (e) {
            // Skip invalid records
          }
        }
      }
      
      // Sort by started date (newest first)
      items.sort((a, b) => new Date(b.started) - new Date(a.started));
      
      res.json({
        success: true,
        data: items.slice(0, parseInt(limit)),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Agent list error:', error);
      res.status(500).json({ 
        error: 'Failed to list agent work', 
        message: error.message 
      });
    }
  }

  async handleAgentCancel(req, res) {
    try {
      const { id } = req.params;
      
      const stored = this.agentWorkStore.get(id);
      
      if (!stored) {
        return res.status(404).json({ error: 'Active work item not found' });
      }
      
      stored.orchestrator.cancel(id);
      
      res.json({
        success: true,
        data: {
          id,
          status: 'cancelled',
          message: 'Work item cancelled successfully'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Agent cancel error:', error);
      res.status(500).json({ 
        error: 'Failed to cancel agent work', 
        message: error.message 
      });
    }
  }

  async handleAgentApprove(req, res) {
    try {
      const { id } = req.params;
      
      const stored = this.agentWorkStore.get(id);
      
      if (!stored) {
        return res.status(404).json({ error: 'Work item not found' });
      }
      
      if (stored.item.status !== WorkItemStatus.AWAITING_APPROVAL) {
        return res.status(400).json({ 
          error: 'Work item is not awaiting approval',
          currentStatus: stored.item.status
        });
      }
      
      // Set approval flag
      stored.approved = true;
      
      res.json({
        success: true,
        data: {
          id,
          status: 'approved',
          message: 'Work approved, execution will continue'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Agent approve error:', error);
      res.status(500).json({ 
        error: 'Failed to approve agent work', 
        message: error.message 
      });
    }
  }

  async handleAgentLogs(req, res) {
    try {
      const { id } = req.params;
      const { follow } = req.query;
      
      const stored = this.agentWorkStore.get(id);
      
      if (stored) {
        res.json({
          success: true,
          data: {
            id,
            logs: stored.logs || [],
            active: true
          },
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      // Check historical record
      const record = await this.loadAgentWorkRecord(id);
      
      if (!record) {
        return res.status(404).json({ error: 'Work item not found' });
      }
      
      res.json({
        success: true,
        data: {
          id,
          logs: record.logs || [],
          active: false
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Agent logs error:', error);
      res.status(500).json({ 
        error: 'Failed to get agent logs', 
        message: error.message 
      });
    }
  }

  getAgentHistoryPath() {
    return path.join(process.cwd(), '.aqt-reports', 'agent-history');
  }

  async loadAgentWorkRecord(workId) {
    const recordPath = path.join(this.getAgentHistoryPath(), `${workId}.json`);
    
    try {
      const content = await fs.readFile(recordPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      return null;
    }
  }

  // ============================================================================
  // Pipeline System Endpoints (P11-T005)
  // ============================================================================

  async handlePipelineList(req, res) {
    try {
      const registry = getRegistry();
      const pipelines = registry.list();
      
      res.json({
        success: true,
        data: pipelines,
        count: pipelines.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Pipeline list error:', error);
      res.status(500).json({ 
        error: 'Failed to list pipelines', 
        message: error.message 
      });
    }
  }

  async handlePipelineInfo(req, res) {
    try {
      const { name } = req.params;
      
      const registry = getRegistry();
      const pipeline = registry.get(name);
      
      if (!pipeline) {
        return res.status(404).json({ error: `Pipeline '${name}' not found` });
      }
      
      res.json({
        success: true,
        data: pipeline,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Pipeline info error:', error);
      res.status(500).json({ 
        error: 'Failed to get pipeline info', 
        message: error.message 
      });
    }
  }

  async handlePipelineExecute(req, res) {
    try {
      const { name } = req.params;
      const { 
        input = {}, 
        workspace, 
        taskId,
        stageHandlers,
        watch = false 
      } = req.body;
      
      const registry = getRegistry();
      const pipeline = registry.get(name);
      
      if (!pipeline) {
        return res.status(404).json({ error: `Pipeline '${name}' not found` });
      }
      
      const workspacePath = workspace || process.cwd();
      const ledger = new ExecutionLedger();
      const executor = new PipelineExecutor({ registry, ledger });
      
      // Store executor for status queries
      const runId = `run-${Date.now()}-${require('crypto').randomBytes(4).toString('hex')}`;
      this.pipelineExecutors.set(runId, { executor, pipeline: name, started: new Date().toISOString() });
      
      // Build stage handlers (use provided or create defaults)
      const handlers = stageHandlers || this.createDefaultStageHandlers(pipeline, { workspace: workspacePath });
      
      // Execute asynchronously
      const executionPromise = executor.execute(name, {
        input,
        taskId,
        workspace: workspacePath,
        stageHandlers: handlers,
        onProgress: watch ? (event) => {
          console.log(`[Pipeline] ${event.type}: ${event.runId}`);
        } : null
      });
      
      // Wait for run to start and return immediately
      await new Promise(resolve => setTimeout(resolve, 100));
      
      res.json({
        success: true,
        data: {
          runId,
          pipelineId: name,
          status: 'started',
          workspace: workspacePath,
          taskId: taskId || null
        },
        timestamp: new Date().toISOString()
      });
      
      // Continue execution in background
      executionPromise.then(result => {
        this.pipelineExecutors.set(runId, { 
          ...this.pipelineExecutors.get(runId),
          result,
          completed: new Date().toISOString()
        });
      }).catch(err => {
        this.pipelineExecutors.set(runId, { 
          ...this.pipelineExecutors.get(runId),
          error: err.message,
          completed: new Date().toISOString()
        });
      });
      
    } catch (error) {
      console.error('Pipeline execute error:', error);
      res.status(500).json({ 
        error: 'Failed to execute pipeline', 
        message: error.message 
      });
    }
  }

  async handlePipelineStatus(req, res) {
    try {
      const { id } = req.params;
      
      const stored = this.pipelineExecutors.get(id);
      
      if (stored) {
        const ledger = new ExecutionLedger();
        const summary = ledger.getRunSummary(id);
        
        if (summary) {
          res.json({
            success: true,
            data: summary,
            timestamp: new Date().toISOString()
          });
          return;
        }
        
        // Return from memory if ledger doesn't have it yet
        res.json({
          success: true,
          data: {
            runId: id,
            pipelineId: stored.pipeline,
            status: stored.result?.status || 'running',
            started: stored.started,
            completed: stored.completed || null,
            result: stored.result || null,
            error: stored.error || null
          },
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      // Check ledger for historical run
      const ledger = new ExecutionLedger();
      const summary = ledger.getRunSummary(id);
      
      if (!summary) {
        return res.status(404).json({ error: 'Pipeline execution not found' });
      }
      
      res.json({
        success: true,
        data: summary,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Pipeline status error:', error);
      res.status(500).json({ 
        error: 'Failed to get pipeline status', 
        message: error.message 
      });
    }
  }

  async handlePipelineReplay(req, res) {
    try {
      const { id } = req.params;
      const { stubs = {} } = req.body;
      
      const ledger = new ExecutionLedger();
      const summary = ledger.getRunSummary(id);
      
      if (!summary) {
        return res.status(404).json({ error: 'Pipeline execution not found' });
      }
      
      // Get the original run events
      const events = ledger.getRun(id);
      const startEvent = events.find(e => e.type === 'run-start');
      
      if (!startEvent) {
        return res.status(400).json({ error: 'Original run data incomplete' });
      }
      
      // For now, return what would be replayed
      // Full replay would require re-running with the same stage handlers
      res.json({
        success: true,
        data: {
          originalRunId: id,
          pipelineId: summary.pipelineId,
          originalStatus: summary.status,
          originalInput: startEvent.input,
          originalContext: startEvent.context,
          message: 'Use the CLI or SDK for full replay with custom handlers'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Pipeline replay error:', error);
      res.status(500).json({ 
        error: 'Failed to replay pipeline', 
        message: error.message 
      });
    }
  }

  async handlePipelineHistory(req, res) {
    try {
      const { pipelineId, status, since, limit = 50 } = req.query;
      
      const ledger = new ExecutionLedger();
      const criteria = {};
      
      if (pipelineId) criteria.pipelineId = pipelineId;
      if (status) criteria.status = status;
      if (since) criteria.since = since;
      
      const events = ledger.query(criteria);
      
      // Group by run
      const runs = new Map();
      for (const event of events) {
        if (!runs.has(event.runId)) {
          runs.set(event.runId, []);
        }
        runs.get(event.runId).push(event);
      }
      
      const summaries = [];
      for (const [runId, runEvents] of runs.entries()) {
        const summary = ledger.getRunSummary(runId);
        if (summary) {
          summaries.push(summary);
        }
      }
      
      // Sort by started date (newest first)
      summaries.sort((a, b) => new Date(b.started) - new Date(a.started));
      
      res.json({
        success: true,
        data: summaries.slice(0, parseInt(limit)),
        count: summaries.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Pipeline history error:', error);
      res.status(500).json({ 
        error: 'Failed to get pipeline history', 
        message: error.message 
      });
    }
  }

  createDefaultStageHandlers(pipeline, options) {
    const handlers = {};
    
    for (const stageName of pipeline.stages) {
      handlers[stageName] = async (context) => {
        // Default mock handler - in production, these would be real implementations
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          stage: stageName,
          status: 'completed',
          timestamp: new Date().toISOString(),
          workspace: options.workspace
        };
      };
    }
    
    return handlers;
  }

  // ============================================================================
  // Security Endpoints (P11-T006)
  // ============================================================================

  async handleSecurityScan(req, res) {
    try {
      const { 
        workspacePath = process.cwd(),
        scanTypes = ['vuln', 'secrets', 'deps'],
        severity = null,
        output = null 
      } = req.body;

      const { VulnerabilityScanner } = require('../security/vulnerability-scanner');
      const { SecretScanner } = require('../security/secret-scanner');
      const { DependencyScanner } = require('../security/dependency-scanner');

      const results = {
        timestamp: new Date().toISOString(),
        workspace: workspacePath,
        scanTypes,
        findings: {
          vulnerabilities: [],
          secrets: [],
          dependencies: []
        },
        stats: {
          totalIssues: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0
        }
      };

      // Scan vulnerabilities
      if (scanTypes.includes('vuln')) {
        const vulnScanner = new VulnerabilityScanner({ severity: severity || 'all' });
        const vulnResults = await vulnScanner.scanDirectory(workspacePath, {
          patterns: ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/build/**']
        });
        const vulnReport = vulnScanner.generateReport(vulnResults);
        results.findings.vulnerabilities = vulnReport.vulnerabilities;
        results.stats.critical += vulnReport.summary.critical || 0;
        results.stats.high += vulnReport.summary.high || 0;
        results.stats.medium += vulnReport.summary.medium || 0;
        results.stats.low += vulnReport.summary.low || 0;
      }

      // Scan for secrets
      if (scanTypes.includes('secrets')) {
        const secretScanner = new SecretScanner();
        const secretResults = await secretScanner.scanDirectory(workspacePath, {
          patterns: ['**/*.js', '**/*.json', '**/*.env*', '**/*.yml', '**/*.yaml'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/build/**']
        });
        const secretReport = secretScanner.generateReport(secretResults);
        results.findings.secrets = secretReport.vulnerabilities;
        results.stats.critical += secretReport.summary.critical || 0;
        results.stats.high += secretReport.summary.high || 0;
        results.stats.medium += secretReport.summary.medium || 0;
        results.stats.low += secretReport.summary.low || 0;
      }

      // Scan dependencies
      if (scanTypes.includes('deps')) {
        const depScanner = new DependencyScanner();
        const packageJsonPath = require('path').join(workspacePath, 'package.json');
        if (fsSync.existsSync(packageJsonPath)) {
          const depResults = await depScanner.scanPackageJson(packageJsonPath);
          const depReport = depScanner.generateReport([depResults]);
          results.findings.dependencies = depReport.vulnerabilities;
          results.stats.critical += depReport.summary.critical || 0;
          results.stats.high += depReport.summary.high || 0;
          results.stats.medium += depReport.summary.medium || 0;
          results.stats.low += depReport.summary.low || 0;
        }
      }

      results.stats.totalIssues = 
        results.findings.vulnerabilities.length +
        results.findings.secrets.length +
        results.findings.dependencies.length;

      res.json({
        success: true,
        data: results,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Security scan error:', error);
      res.status(500).json({ 
        error: 'Security scan failed', 
        message: error.message 
      });
    }
  }

  async handleGetVulnerabilities(req, res) {
    try {
      const { workspacePath = process.cwd(), severity = null } = req.query;

      const { VulnerabilityScanner } = require('../security/vulnerability-scanner');
      const scanner = new VulnerabilityScanner({ severity: severity || 'all' });

      const results = await scanner.scanDirectory(workspacePath, {
        patterns: ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/build/**']
      });

      const report = scanner.generateReport(results);

      res.json({
        success: true,
        data: report.vulnerabilities,
        stats: report.summary,
        count: report.vulnerabilities.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Vulnerability fetch error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch vulnerabilities', 
        message: error.message 
      });
    }
  }

  async handleGetSecrets(req, res) {
    try {
      const { workspacePath = process.cwd() } = req.query;

      const { SecretScanner } = require('../security/secret-scanner');
      const scanner = new SecretScanner();

      const results = await scanner.scanDirectory(workspacePath, {
        patterns: ['**/*.js', '**/*.json', '**/*.env*', '**/*.yml', '**/*.yaml'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/build/**']
      });

      const report = scanner.generateReport(results);

      res.json({
        success: true,
        data: report.vulnerabilities,
        stats: report.summary,
        count: report.vulnerabilities.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Secrets fetch error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch secrets', 
        message: error.message 
      });
    }
  }

  async handleGetDependencies(req, res) {
    try {
      const { workspacePath = process.cwd() } = req.query;

      const { DependencyScanner } = require('../security/dependency-scanner');
      const scanner = new DependencyScanner();

      const packageJsonPath = require('path').join(workspacePath, 'package.json');
      
      if (!fsSync.existsSync(packageJsonPath)) {
        return res.json({
          success: true,
          data: [],
          stats: { filesScanned: 0, vulnerabilitiesFound: 0 },
          count: 0,
          message: 'No package.json found',
          timestamp: new Date().toISOString()
        });
      }

      const results = await scanner.scanPackageJson(packageJsonPath);
      const report = scanner.generateReport([results]);

      res.json({
        success: true,
        data: report.vulnerabilities,
        stats: report.summary,
        count: report.vulnerabilities.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Dependency fetch error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch dependencies', 
        message: error.message 
      });
    }
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ 
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
      });
    });

    // Global error handler
    this.app.use((err, req, res, next) => {
      console.error('Unhandled error:', err);
      
      res.status(err.status || 500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
      });
    });
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          const address = this.server.address();
          console.log(`AQT HTTP API Server started on http://${address.address}:${address.port}`);
          console.log('Available endpoints:');
          console.log('  GET  /health - Health check');
          console.log('  GET  /api/info - API information');
          console.log('  POST /api/analyze - Code analysis');
          console.log('  POST /api/fix - Fix single issue');
          console.log('  POST /api/generate-fixes - Generate fixes for multiple issues');
          console.log('  GET  /api/reports - List reports');
          console.log('  GET  /api/reports/:id - Get specific report');
          console.log('  POST /api/workspace/config - Update workspace config');
          console.log('  GET  /api/workspace/status - Get workspace status');
          console.log('  --- Agent System ---');
          console.log('  POST /api/agent/start - Start agent work');
          console.log('  GET  /api/agent - List agent work');
          console.log('  GET  /api/agent/:id - Get work status');
          console.log('  DELETE /api/agent/:id - Cancel work');
          console.log('  POST /api/agent/:id/approve - Approve work');
          console.log('  GET  /api/agent/:id/logs - Get work logs');
          console.log('  --- Pipeline System ---');
          console.log('  GET  /api/pipelines - List pipelines');
          console.log('  GET  /api/pipelines/:name - Get pipeline details');
          console.log('  POST /api/pipelines/:name/execute - Execute pipeline');
          console.log('  GET  /api/pipelines/executions - List executions');
          console.log('  GET  /api/pipelines/executions/:id - Get execution status');
          console.log('  POST /api/pipelines/executions/:id/replay - Replay execution');
          console.log('  --- Security ---');
          console.log('  POST /api/security/scan - Run comprehensive security scan');
          console.log('  GET  /api/security/vulnerabilities - List vulnerabilities');
          console.log('  GET  /api/security/secrets - List found secrets');
          console.log('  GET  /api/security/dependencies - Check dependencies');
          resolve(this.server);
        });

        this.server.on('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            console.error(`Port ${this.config.port} is already in use`);
          }
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('AQT HTTP API Server stopped');
          this.server = null;
          resolve();
        });
      });
    }
  }

  getApp() {
    return this.app;
  }

  getServer() {
    return this.server;
  }
}

module.exports = { HttpApiServer };

// CLI usage
if (require.main === module) {
  const config = {
    port: process.env.AQT_API_PORT || 3000,
    host: process.env.AQT_API_HOST || 'localhost'
  };

  const server = new HttpApiServer(config);
  
  server.start().catch((error) => {
    console.error('Failed to start HTTP API server:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });
}
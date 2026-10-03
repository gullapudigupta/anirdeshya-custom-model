/**
 * WebSocket Server for Chat UI
 * 
 * Provides real-time communication between the chat UI and the AQT engine.
 * Handles issue streaming, fix generation, and live updates.
 * 
 * @module ui/websocket-server
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { AutoFixEngine } = require('../fixers/auto-fix-engine');
const { AqtService } = require('../extension/lib/aqt-service');

/**
 * Simple WebSocket implementation
 * (In production, use 'ws' package, but keeping dependencies minimal)
 */
class WebSocketServer {
  constructor(options = {}) {
    this.port = options.port || 3030;
    this.host = options.host || 'localhost';
    this.projectRoot = path.resolve(options.projectRoot || process.cwd());
    this.analysisService = new AqtService(this.projectRoot);
    this.clients = new Set();
    this.server = null;
    this.autoFixEngine = null;
    this.verbose = options.verbose || false;

    // Initialize auto-fix engine
    this.autoFixEngine = new AutoFixEngine({
      ...options,
      verbose: this.verbose
    });
  }

  /**
   * Start the server
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      this.server.on('upgrade', (req, socket, head) => {
        this.handleWebSocketUpgrade(req, socket, head);
      });

      this.server.listen(this.port, this.host, () => {
        const url = `http://${this.host}:${this.port}`;
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🚀 AQT WebSocket Server Started`);
        console.log(`${'='.repeat(60)}`);
        console.log(`  URL: ${url}`);
        console.log(`  WebSocket: ws://${this.host}:${this.port}`);
        console.log(`  Status: Running`);
        console.log(`${'='.repeat(60)}\n`);
        resolve({ url, port: this.port });
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the server
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.clients.forEach(client => client.close());
        this.server.close(() => {
          console.log('WebSocket server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle HTTP requests (serve the UI)
   */
  handleHttpRequest(req, res) {
    if (req.url === '/' || req.url === '/index.html') {
      const htmlPath = path.join(__dirname, 'chat-ui.html');

      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(htmlPath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('UI file not found');
      }
    } else if (req.url === '/chat-ui.css' || req.url === '/chat-ui.js') {
      const assetName = req.url.slice(1);
      const assetPath = path.join(__dirname, assetName);

      if (fs.existsSync(assetPath)) {
        const contentType = assetName.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'application/javascript; charset=utf-8';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(assetPath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('UI asset not found');
      }
    } else if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        clients: this.clients.size,
        uptime: process.uptime()
      }));
    } else if (req.method === 'GET' && req.url === '/api/issues') {
      this.handleAnalyzeRequest(res);
    } else if (req.method === 'POST' && req.url === '/api/generate-fix') {
      this.handleGenerateFixRequest(req, res);
    } else if (req.method === 'POST' && req.url === '/api/apply-fix') {
      this.handleApplyFixRequest(req, res);
    } else if (req.method === 'GET' && req.url === '/api/metrics') {
      this.handleMetricsRequest(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  }

  async handleAnalyzeRequest(res) {
    try {
      const result = await this.analysisService.analyze();
      this.sendJson(res, 200, result);
    } catch (error) {
      this.sendJson(res, 500, { error: `Analysis failed: ${error.message}` });
    }
  }

  async handleMetricsRequest(res) {
    try {
      const { ComplexityCalculator } = require('../metrics/complexity-calculator');
      const calculator = new ComplexityCalculator({
        projectRoot: this.projectRoot,
        verbose: this.verbose
      });

      // Discover source files (JS/TS only, skip vendor dirs)
      const sourceFiles = this._listMetricsFiles();

      if (sourceFiles.length === 0) {
        return this.sendJson(res, 200, {
          summary: { filesScanned: 0, functionsAnalyzed: 0, issuesFound: 0 },
          files: [],
          allIssues: []
        });
      }

      // Cap at 100 files to keep response fast
      const filesToAnalyze = sourceFiles.slice(0, 100);
      const results        = await calculator.analyzeFiles(filesToAnalyze);
      const report         = calculator.generateReport(results);

      this.sendJson(res, 200, report);
    } catch (error) {
      this.sendJson(res, 500, { error: `Metrics analysis failed: ${error.message}` });
    }
  }

  _listMetricsFiles() {
    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
    const skipDirs   = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.aqt-reports', '.aqt-cache', '.aqt-test-temp']);
    const files      = [];

    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }

      for (const entry of entries) {
        if (skipDirs.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
          files.push(fullPath);
        }
      }
    };

    walk(this.projectRoot);
    return files;
  }

  async handleGenerateFixRequest(req, res) {
    try {
      const { issue } = await this.readJsonBody(req);
      if (!issue || typeof issue.file !== 'string') {
        return this.sendJson(res, 400, { error: 'An analyzed issue with a file path is required.' });
      }

      const filePath = this.resolveProjectFile(issue.file);
      const originalCode = await fs.promises.readFile(filePath, 'utf8');
      const result = await this.autoFixEngine.aiCoordinator.generateFix(
        originalCode,
        issue,
        { filePath, lineNumber: issue.startLine || issue.line }
      );

      if (!result || !result.fixedCode) {
        return this.sendJson(res, 422, { error: 'No fix was generated for this issue.' });
      }

      this.sendJson(res, 200, {
        originalCode,
        fixedCode: result.fixedCode,
        confidence: result.confidence
      });
    } catch (error) {
      this.sendJson(res, error.statusCode || 500, { error: error.message });
    }
  }

  async handleApplyFixRequest(req, res) {
    let backupPath;
    let filePath;
    try {
      const { issue, originalCode, fixedCode } = await this.readJsonBody(req);
      if (!issue || typeof issue.file !== 'string' || typeof originalCode !== 'string' || typeof fixedCode !== 'string') {
        return this.sendJson(res, 400, { error: 'Issue, originalCode, and fixedCode are required.' });
      }

      filePath = this.resolveProjectFile(issue.file);
      const currentCode = await fs.promises.readFile(filePath, 'utf8');
      if (currentCode !== originalCode) {
        return this.sendJson(res, 409, { error: 'The source file changed after the preview was generated. Analyze it again before applying the fix.' });
      }

      backupPath = await this.autoFixEngine.createBackup(filePath);
      await fs.promises.writeFile(filePath, fixedCode, 'utf8');
      this.sendJson(res, 200, { success: true, backupPath });
    } catch (error) {
      if (backupPath && filePath) {
        await this.autoFixEngine.restoreBackup(filePath, backupPath).catch(() => {});
      }
      this.sendJson(res, error.statusCode || 500, { error: error.message });
    }
  }

  async readJsonBody(req) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024 * 1024) {
        const error = new Error('Request body exceeds the 1 MB limit.');
        error.statusCode = 413;
        throw error;
      }
    }

    try {
      return JSON.parse(body || '{}');
    } catch {
      const error = new Error('Request body must contain valid JSON.');
      error.statusCode = 400;
      throw error;
    }
  }

  resolveProjectFile(file) {
    const filePath = path.resolve(this.projectRoot, file);
    const relativePath = path.relative(this.projectRoot, filePath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      const error = new Error('The requested file must be inside the analyzed project.');
      error.statusCode = 400;
      throw error;
    }
    return filePath;
  }

  sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  /**
   * Handle WebSocket upgrade
   */
  handleWebSocketUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];

    if (!key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    // WebSocket handshake
    const acceptKey = this.generateAcceptKey(key);
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      ''
    ].join('\r\n');

    socket.write(headers);

    // Create WebSocket client
    const client = this.createWebSocketClient(socket);
    this.clients.add(client);

    this.log(`Client connected. Total: ${this.clients.size}`);

    // Send welcome message
    this.sendToClient(client, {
      type: 'connected',
      message: 'Connected to AQT WebSocket Server',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Generate WebSocket accept key
   */
  generateAcceptKey(key) {
    const crypto = require('crypto');
    const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    return crypto
      .createHash('sha1')
      .update(key + GUID)
      .digest('base64');
  }

  /**
   * Create WebSocket client
   */
  createWebSocketClient(socket) {
    const client = {
      socket: socket,
      id: this.generateClientId(),
      send: (data) => this.sendToClient(client, data),
      close: () => {
        try {
          socket.end();
        } catch (error) {
          // Ignore
        }
      }
    };

    // Handle incoming messages
    socket.on('data', (buffer) => {
      try {
        const message = this.parseWebSocketFrame(buffer);
        if (message) {
          this.handleClientMessage(client, message);
        }
      } catch (error) {
        this.log(`Error parsing message: ${error.message}`);
      }
    });

    // Handle disconnect
    socket.on('end', () => {
      this.clients.delete(client);
      this.log(`Client disconnected. Total: ${this.clients.size}`);
    });

    socket.on('error', (error) => {
      this.log(`Socket error: ${error.message}`);
      this.clients.delete(client);
    });

    return client;
  }

  /**
   * Parse WebSocket frame
   */
  parseWebSocketFrame(buffer) {
    const firstByte = buffer.readUInt8(0);
    const isFinalFrame = Boolean((firstByte >>> 7) & 0x1);
    const opcode = firstByte & 0xF;

    // Text frame
    if (opcode === 0x1) {
      const secondByte = buffer.readUInt8(1);
      const isMasked = Boolean((secondByte >>> 7) & 0x1);
      let payloadLength = secondByte & 0x7F;
      let offset = 2;

      if (payloadLength === 126) {
        payloadLength = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        payloadLength = buffer.readBigUInt64BE(offset);
        offset += 8;
      }

      let payload = buffer.slice(offset);

      if (isMasked) {
        const maskingKey = payload.slice(0, 4);
        payload = payload.slice(4);

        const unmasked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) {
          unmasked[i] = payload[i] ^ maskingKey[i % 4];
        }
        payload = unmasked;
      }

      try {
        return JSON.parse(payload.toString('utf8'));
      } catch (error) {
        this.log(`Failed to parse JSON: ${error.message}`);
        return null;
      }
    }

    // Close frame
    if (opcode === 0x8) {
      return { type: 'close' };
    }

    return null;
  }

  /**
   * Send message to client
   */
  sendToClient(client, data) {
    try {
      const json = JSON.stringify(data);
      const buffer = Buffer.from(json);

      const frame = this.createWebSocketFrame(buffer);
      client.socket.write(frame);
    } catch (error) {
      this.log(`Error sending to client: ${error.message}`);
    }
  }

  /**
   * Create WebSocket frame
   */
  createWebSocketFrame(payload) {
    const length = payload.length;
    let frame;

    if (length < 126) {
      frame = Buffer.alloc(2 + length);
      frame[0] = 0x81; // FIN + text frame
      frame[1] = length;
      payload.copy(frame, 2);
    } else if (length < 65536) {
      frame = Buffer.alloc(4 + length);
      frame[0] = 0x81;
      frame[1] = 126;
      frame.writeUInt16BE(length, 2);
      payload.copy(frame, 4);
    } else {
      frame = Buffer.alloc(10 + length);
      frame[0] = 0x81;
      frame[1] = 127;
      frame.writeBigUInt64BE(BigInt(length), 2);
      payload.copy(frame, 10);
    }

    return frame;
  }

  /**
   * Handle client message
   */
  async handleClientMessage(client, message) {
    this.log(`Received: ${message.type}`);

    try {
      switch (message.type) {
        case 'ping':
          this.sendToClient(client, { type: 'pong', timestamp: Date.now() });
          break;

        case 'loadIssues':
          await this.handleLoadIssues(client, message.data);
          break;

        case 'generateFix':
          await this.handleGenerateFix(client, message.data);
          break;

        case 'applyFix':
          await this.handleApplyFix(client, message.data);
          break;

        case 'batchFix':
          await this.handleBatchFix(client, message.data);
          break;

        case 'explainIssue':
          await this.handleExplainIssue(client, message.data);
          break;

        case 'getStats':
          await this.handleGetStats(client);
          break;

        default:
          this.sendToClient(client, {
            type: 'error',
            message: `Unknown message type: ${message.type}`
          });
      }
    } catch (error) {
      this.sendToClient(client, {
        type: 'error',
        message: error.message,
        stack: this.verbose ? error.stack : undefined
      });
    }
  }

  /**
   * Load issues from analysis
   */
  async handleLoadIssues(client, data) {
    this.sendToClient(client, {
      type: 'issuesLoading',
      message: 'Loading issues...'
    });

    const result = await this.analysisService.analyze();

    this.sendToClient(client, {
      type: 'issuesLoaded',
      issues: result.issues,
      count: result.issues.length,
      summary: result.summary,
      stats: result.stats
    });
  }

  /**
   * Generate fix for an issue
   */
  async handleGenerateFix(client, data) {
    const { issue, code } = data;

    this.sendToClient(client, {
      type: 'fixGenerating',
      issueId: issue.id,
      message: 'Analyzing and generating fix...'
    });

    try {
      // Generate fix using auto-fix engine
      const result = await this.autoFixEngine.aiCoordinator.generateFix(
        code,
        issue,
        { filePath: issue.filePath, lineNumber: issue.line }
      );

      this.sendToClient(client, {
        type: 'fixGenerated',
        issueId: issue.id,
        originalCode: code,
        fixedCode: result.fixedCode,
        confidence: result.confidence,
        usedFixer: result.usedFixer,
        cached: result.cached,
        success: !!result.fixedCode
      });
    } catch (error) {
      this.sendToClient(client, {
        type: 'fixError',
        issueId: issue.id,
        error: error.message
      });
    }
  }

  /**
   * Apply fix to file
   */
  async handleApplyFix(client, data) {
    const { issue, originalCode, fixedCode } = data;

    this.sendToClient(client, {
      type: 'fixApplying',
      issueId: issue.id,
      message: 'Applying fix to file...'
    });

    try {
      if (typeof originalCode !== 'string' || typeof fixedCode !== 'string') {
        throw new Error('The original and proposed source are required to apply a fix.');
      }

      const filePath = this.resolveProjectFile(issue.file || issue.filePath);
      const currentCode = await fs.promises.readFile(filePath, 'utf8');
      if (currentCode !== originalCode) {
        throw new Error('The source file changed after the preview was generated. Analyze it again before applying the fix.');
      }

      const backupPath = await this.autoFixEngine.createBackup(filePath);
      await fs.promises.writeFile(filePath, fixedCode, 'utf8');

      this.sendToClient(client, {
        type: 'fixApplied',
        issueId: issue.id,
        filePath,
        backupPath,
        success: true
      });
    } catch (error) {
      this.sendToClient(client, {
        type: 'fixError',
        issueId: issue.id,
        error: error.message
      });
    }
  }

  /**
   * Batch fix multiple issues
   */
  async handleBatchFix(client, data) {
    this.sendToClient(client, {
      type: 'error',
      message: 'Batch fixes are unavailable. Generate and apply each live fix individually.'
    });
  }

  /**
   * Explain an issue
   */
  async handleExplainIssue(client, data) {
    const { issue } = data;

    const explanations = {
      'no-unused-vars': {
        title: 'Unused Variable',
        description: 'Variables that are declared but never used clutter the code and may indicate bugs or incomplete implementations.',
        fix: 'Remove the unused variable or use it in your code.',
        severity: 'error',
        examples: {
          bad: 'let unused = 5;\nconsole.log("hello");',
          good: 'console.log("hello");'
        }
      },
      'complexity': {
        title: 'High Cyclomatic Complexity',
        description: 'Functions with high complexity are harder to test, understand, and maintain.',
        fix: 'Break down the function into smaller, focused functions.',
        severity: 'warning',
        examples: {
          bad: 'function complex(x) {\n  if (x) { if (y) { if (z) { ... } } }\n}',
          good: 'function simple(x) {\n  if (!x) return;\n  helper1();\n  helper2();\n}'
        }
      }
    };

    const explanation = explanations[issue.ruleId] || {
      title: issue.ruleId,
      description: 'Code quality issue detected.',
      fix: 'Review and fix according to the rule documentation.'
    };

    this.sendToClient(client, {
      type: 'issueExplained',
      issueId: issue.id,
      explanation: explanation
    });
  }

  /**
   * Get statistics
   */
  async handleGetStats(client) {
    const stats = this.autoFixEngine.getStats();

    this.sendToClient(client, {
      type: 'stats',
      stats: stats
    });
  }

  /**
   * Broadcast to all clients
   */
  broadcast(data) {
    this.clients.forEach(client => {
      this.sendToClient(client, data);
    });
  }

  /**
   * Generate client ID
   */
  generateClientId() {
    return `client-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  log(message) {
    if (this.verbose) {
      console.log(`[WebSocket] ${message}`);
    }
  }
}

/**
 * Create and start server
 */
async function createServer(options = {}) {
  const server = new WebSocketServer(options);
  await server.start();
  return server;
}

module.exports = {
  WebSocketServer,
  createServer
};

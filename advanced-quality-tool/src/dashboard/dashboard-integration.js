/**
 * Enterprise Dashboard Integration
 * 
 * Provides data aggregation and API for enterprise dashboards:
 * - Metrics collection
 * - Historical tracking
 * - Team analytics
 * - Trend analysis
 * - Export capabilities
 * - Dashboard REST API
 * 
 * @module dashboard/dashboard-integration
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

/**
 * Dashboard Integration
 */
class DashboardIntegration {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.port = options.port || 3000;
    this.dataDir = options.dataDir || path.join(process.cwd(), '.quality-tool', 'data');
    this.historyFile = path.join(this.dataDir, 'history.json');

    // In-memory storage
    this.currentMetrics = null;
    this.history = [];

    // Server
    this.server = null;

    // Initialize storage
    this.initializeStorage();
  }

  /**
   * Initialize storage
   */
  initializeStorage() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (fs.existsSync(this.historyFile)) {
      try {
        const data = fs.readFileSync(this.historyFile, 'utf8');
        this.history = JSON.parse(data);
        this.log(`Loaded ${this.history.length} historical records`);
      } catch (error) {
        this.log(`Failed to load history: ${error.message}`);
        this.history = [];
      }
    }
  }

  /**
   * Record scan results
   */
  recordScan(results, metadata = {}) {
    const record = {
      timestamp: new Date().toISOString(),
      ...metadata,
      metrics: this.aggregateMetrics(results)
    };

    this.currentMetrics = record.metrics;
    this.history.push(record);

    // Keep only last 1000 records
    if (this.history.length > 1000) {
      this.history = this.history.slice(-1000);
    }

    this.saveHistory();

    return record;
  }

  /**
   * Aggregate metrics from results
   */
  aggregateMetrics(results) {
    const metrics = {
      files: {
        total: 0,
        analyzed: 0,
        withIssues: 0
      },
      issues: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0
      },
      categories: {
        security: 0,
        performance: 0,
        complexity: 0,
        duplication: 0,
        quality: 0
      },
      tools: {},
      languages: {}
    };

    // Process results based on structure
    if (Array.isArray(results)) {
      results.forEach(result => {
        if (result.filePath) {
          metrics.files.total++;
          metrics.files.analyzed++;
        }

        if (result.issues && Array.isArray(result.issues)) {
          if (result.issues.length > 0) {
            metrics.files.withIssues++;
          }

          result.issues.forEach(issue => {
            metrics.issues.total++;

            const severity = (issue.severity || 'INFO').toUpperCase();
            if (metrics.issues[severity.toLowerCase()] !== undefined) {
              metrics.issues[severity.toLowerCase()]++;
            }

            // Categorize by type
            const type = (issue.type || '').toLowerCase();
            if (type.includes('security') || type.includes('vulnerability')) {
              metrics.categories.security++;
            } else if (type.includes('performance')) {
              metrics.categories.performance++;
            } else if (type.includes('complexity')) {
              metrics.categories.complexity++;
            } else if (type.includes('duplication') || type.includes('duplicate')) {
              metrics.categories.duplication++;
            } else {
              metrics.categories.quality++;
            }

            // Track by tool
            if (issue.tool) {
              metrics.tools[issue.tool] = (metrics.tools[issue.tool] || 0) + 1;
            }
          });
        }

        // Track by language
        if (result.language) {
          metrics.languages[result.language] = (metrics.languages[result.language] || 0) + 1;
        }
      });
    }

    // Calculate quality score (0-100)
    metrics.qualityScore = this.calculateQualityScore(metrics);

    return metrics;
  }

  /**
   * Calculate quality score
   */
  calculateQualityScore(metrics) {
    if (metrics.files.analyzed === 0) return 100;

    let score = 100;

    // Deduct for issues based on severity
    const totalFiles = metrics.files.analyzed;
    score -= (metrics.issues.critical / totalFiles) * 10;
    score -= (metrics.issues.high / totalFiles) * 5;
    score -= (metrics.issues.medium / totalFiles) * 2;
    score -= (metrics.issues.low / totalFiles) * 1;
    score -= (metrics.issues.info / totalFiles) * 0.5;

    // Deduct for high issue density
    const issuesPerFile = metrics.issues.total / totalFiles;
    if (issuesPerFile > 10) score -= 10;
    else if (issuesPerFile > 5) score -= 5;

    // Deduct for security issues
    if (metrics.categories.security > 0) {
      score -= Math.min(metrics.categories.security * 2, 20);
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Get trend analysis
   */
  getTrends(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const recentHistory = this.history.filter(record => {
      return new Date(record.timestamp) >= cutoff;
    });

    if (recentHistory.length === 0) {
      return {
        period: days,
        dataPoints: 0,
        trends: {}
      };
    }

    // Calculate trends
    const first = recentHistory[0].metrics;
    const last = recentHistory[recentHistory.length - 1].metrics;

    const trends = {
      qualityScore: {
        current: last.qualityScore,
        previous: first.qualityScore,
        change: last.qualityScore - first.qualityScore,
        trend: last.qualityScore > first.qualityScore ? 'improving' : last.qualityScore < first.qualityScore ? 'declining' : 'stable'
      },
      totalIssues: {
        current: last.issues.total,
        previous: first.issues.total,
        change: last.issues.total - first.issues.total,
        trend: last.issues.total < first.issues.total ? 'improving' : last.issues.total > first.issues.total ? 'declining' : 'stable'
      },
      criticalIssues: {
        current: last.issues.critical,
        previous: first.issues.critical,
        change: last.issues.critical - first.issues.critical,
        trend: last.issues.critical < first.issues.critical ? 'improving' : last.issues.critical > first.issues.critical ? 'declining' : 'stable'
      },
      filesAnalyzed: {
        current: last.files.analyzed,
        previous: first.files.analyzed,
        change: last.files.analyzed - first.files.analyzed
      }
    };

    return {
      period: days,
      dataPoints: recentHistory.length,
      startDate: recentHistory[0].timestamp,
      endDate: recentHistory[recentHistory.length - 1].timestamp,
      trends,
      history: recentHistory.map(r => ({
        timestamp: r.timestamp,
        qualityScore: r.metrics.qualityScore,
        totalIssues: r.metrics.issues.total,
        criticalIssues: r.metrics.issues.critical
      }))
    };
  }

  /**
   * Get current dashboard data
   */
  getDashboardData() {
    return {
      current: this.currentMetrics,
      trends: this.getTrends(30),
      summary: {
        totalScans: this.history.length,
        lastScan: this.history.length > 0 ? this.history[this.history.length - 1].timestamp : null
      }
    };
  }

  /**
   * Start dashboard API server
   */
  async startServer() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.port, () => {
        this.log(`Dashboard API server running on http://localhost:${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Stop server
   */
  async stopServer() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.log('Dashboard API server stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Handle HTTP request
   */
  handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // Route requests
      if (pathname === '/api/dashboard') {
        this.handleDashboardRequest(req, res, parsedUrl.query);
      } else if (pathname === '/api/trends') {
        this.handleTrendsRequest(req, res, parsedUrl.query);
      } else if (pathname === '/api/metrics') {
        this.handleMetricsRequest(req, res);
      } else if (pathname === '/api/history') {
        this.handleHistoryRequest(req, res, parsedUrl.query);
      } else if (pathname === '/api/export') {
        this.handleExportRequest(req, res, parsedUrl.query);
      } else if (pathname === '/') {
        this.handleRootRequest(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      this.log(`Error handling request: ${error.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Handle dashboard request
   */
  handleDashboardRequest(req, res, query) {
    const data = this.getDashboardData();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Handle trends request
   */
  handleTrendsRequest(req, res, query) {
    const days = parseInt(query.days) || 30;
    const trends = this.getTrends(days);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(trends, null, 2));
  }

  /**
   * Handle metrics request
   */
  handleMetricsRequest(req, res) {
    const data = {
      current: this.currentMetrics,
      timestamp: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Handle history request
   */
  handleHistoryRequest(req, res, query) {
    const limit = parseInt(query.limit) || 100;
    const offset = parseInt(query.offset) || 0;

    const page = this.history.slice(offset, offset + limit);

    const data = {
      total: this.history.length,
      offset,
      limit,
      records: page
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Handle export request
   */
  handleExportRequest(req, res, query) {
    const format = query.format || 'json';

    if (format === 'json') {
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="quality-report.json"'
      });
      res.end(JSON.stringify({
        exportDate: new Date().toISOString(),
        current: this.currentMetrics,
        history: this.history
      }, null, 2));
    } else if (format === 'csv') {
      const csv = this.exportToCSV();
      res.writeHead(200, { 
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="quality-report.csv"'
      });
      res.end(csv);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unsupported format' }));
    }
  }

  /**
   * Handle root request
   */
  handleRootRequest(req, res) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Quality Tool Dashboard API</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-left: 4px solid #007bff; }
    .endpoint code { background: #e0e0e0; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Quality Tool Dashboard API</h1>
  <p>Available endpoints:</p>

  <div class="endpoint">
    <h3>GET /api/dashboard</h3>
    <p>Get complete dashboard data with current metrics and trends</p>
  </div>

  <div class="endpoint">
    <h3>GET /api/trends?days=30</h3>
    <p>Get trend analysis for specified period</p>
  </div>

  <div class="endpoint">
    <h3>GET /api/metrics</h3>
    <p>Get current metrics only</p>
  </div>

  <div class="endpoint">
    <h3>GET /api/history?limit=100&offset=0</h3>
    <p>Get historical scan records</p>
  </div>

  <div class="endpoint">
    <h3>GET /api/export?format=json|csv</h3>
    <p>Export data in JSON or CSV format</p>
  </div>
</body>
</html>
    `;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Export to CSV
   */
  exportToCSV() {
    const headers = [
      'Timestamp',
      'Quality Score',
      'Total Issues',
      'Critical',
      'High',
      'Medium',
      'Low',
      'Files Analyzed'
    ];

    const rows = this.history.map(record => [
      record.timestamp,
      record.metrics.qualityScore,
      record.metrics.issues.total,
      record.metrics.issues.critical,
      record.metrics.issues.high,
      record.metrics.issues.medium,
      record.metrics.issues.low,
      record.metrics.files.analyzed
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
  }

  /**
   * Save history to disk
   */
  saveHistory() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
    } catch (error) {
      this.log(`Failed to save history: ${error.message}`);
    }
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.history = [];
    this.saveHistory();
    this.log('History cleared');
  }

  log(message) {
    if (this.verbose) {
      console.log(`[DashboardIntegration] ${message}`);
    }
  }
}

module.exports = {
  DashboardIntegration
};

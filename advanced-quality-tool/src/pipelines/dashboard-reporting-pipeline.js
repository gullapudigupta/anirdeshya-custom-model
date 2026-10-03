/**
 * Dashboard Reporting and Trend Pipeline (P9-T038)
 *
 * Builds dashboard views from persisted pipeline and quality records.
 * Shows run status, issue trends, gate history, fix outcomes,
 * model usage, and verification results.
 *
 * @module pipelines/dashboard-reporting-pipeline
 */

'use strict';

const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');
const path = require('path');
const fs = require('fs');

/**
 * Time periods for aggregation
 */
const TimePeriod = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year'
};

/**
 * Dashboard Reporting Pipeline
 */
class DashboardReportingPipeline {
  constructor(options = {}) {
    this.executor = options.executor || new PipelineExecutor();
    
    // Data sources
    this.pipelineLedger = options.pipelineLedger || null;
    this.metricsStore = options.metricsStore || null;
    this.historyStore = options.historyStore || null;
    
    // Configuration
    this.reportsDir = options.reportsDir || path.join(process.cwd(), '.aqt-reports', 'dashboards');
    this.cacheTimeout = options.cacheTimeout || 5 * 60 * 1000; // 5 minutes
    
    // Cache
    this.cache = new Map();
  }

  /**
   * Execute dashboard reporting pipeline
   * @param {Object} params
   * @param {Object} [params.timeRange] - Time range for data
   * @param {string[]} [params.projects] - Projects to include
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const { timeRange, projects } = params;

    const stageHandlers = {
      'load-records': async (ctx) => this._loadRecords(ctx, timeRange, projects),
      'aggregate-runs': async (ctx) => this._aggregateRuns(ctx),
      'calculate-trends': async (ctx) => this._calculateTrends(ctx),
      'group-by-project': async (ctx) => this._groupByProject(ctx),
      'render-dashboard': async (ctx) => this._renderDashboard(ctx),
      'export-report': async (ctx) => this._exportReport(ctx)
    };

    const result = await this.executor.execute('dashboard-reporting', {
      input: { timeRange, projects },
      stageHandlers
    });

    return result;
  }

  /**
   * Get cached dashboard or generate new one
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async getDashboard(options = {}) {
    const cacheKey = this._getCacheKey(options);
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    // Generate new dashboard
    const dashboard = await this.execute(options);
    
    // Cache result
    this.cache.set(cacheKey, {
      data: dashboard,
      timestamp: Date.now()
    });
    
    return dashboard;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _loadRecords(ctx, timeRange, projects) {
    const records = {
      pipelineRuns: [],
      metrics: [],
      issues: []
    };
    
    // Load pipeline runs from ledger
    if (this.pipelineLedger) {
      records.pipelineRuns = await this._loadPipelineRuns(timeRange);
    } else {
      // Load from file
      records.pipelineRuns = this._loadFromFile('pipelines', timeRange);
    }
    
    // Load metrics
    if (this.metricsStore) {
      records.metrics = await this.metricsStore.load(timeRange);
    } else {
      records.metrics = this._loadFromFile('metrics-history', timeRange);
    }
    
    // Load issues
    records.issues = this._loadFromFile('history', timeRange);
    
    // Filter by projects
    if (projects && projects.length > 0) {
      records.pipelineRuns = records.pipelineRuns.filter(r => 
        projects.includes(r.project) || projects.includes(r.workspace)
      );
    }
    
    return {
      records,
      loaded: true,
      counts: {
        pipelineRuns: records.pipelineRuns.length,
        metrics: records.metrics.length,
        issues: records.issues.length
      }
    };
  }

  async _aggregateRuns(ctx) {
    const { records } = ctx.previousResults?.['load-records'] || {};
    
    const aggregation = {
      total: 0,
      byStatus: {},
      byPipeline: {},
      byDay: {},
      successRate: 0
    };
    
    const runs = records?.pipelineRuns || [];
    aggregation.total = runs.length;
    
    let successful = 0;
    
    for (const run of runs) {
      // By status
      const status = run.status || 'unknown';
      aggregation.byStatus[status] = (aggregation.byStatus[status] || 0) + 1;
      
      // By pipeline
      const pipelineId = run.pipelineId || 'unknown';
      aggregation.byPipeline[pipelineId] = (aggregation.byPipeline[pipelineId] || 0) + 1;
      
      // By day
      const day = this._getDayKey(run.timestamp || run.started);
      aggregation.byDay[day] = aggregation.byDay[day] || { total: 0, success: 0 };
      aggregation.byDay[day].total++;
      if (status === 'completed') {
        aggregation.byDay[day].success++;
        successful++;
      }
    }
    
    aggregation.successRate = aggregation.total > 0 ?
      (successful / aggregation.total) * 100 : 0;
    
    return { aggregation };
  }

  async _calculateTrends(ctx) {
    const { records } = ctx.previousResults?.['load-records'] || {};
    const { aggregation } = ctx.previousResults?.['aggregate-runs'] || {};
    
    const trends = {
      runs: [],
      issues: [],
      metrics: []
    };
    
    // Calculate run trends
    const days = Object.keys(aggregation?.byDay || {}).sort();
    
    for (const day of days) {
      const dayData = aggregation.byDay[day];
      
      trends.runs.push({
        date: day,
        total: dayData.total,
        success: dayData.success,
        successRate: dayData.total > 0 ? 
          (dayData.success / dayData.total) * 100 : 0
      });
    }
    
    // Calculate issue trends
    const issues = records?.issues || [];
    const issuesByDay = {};
    
    for (const issue of issues) {
      const day = this._getDayKey(issue.timestamp);
      issuesByDay[day] = issuesByDay[day] || { total: 0, bySeverity: {} };
      issuesByDay[day].total++;
      
      const severity = issue.severity || 'unknown';
      issuesByDay[day].bySeverity[severity] = 
        (issuesByDay[day].bySeverity[severity] || 0) + 1;
    }
    
    trends.issues = Object.entries(issuesByDay)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate metrics trends
    const metrics = records?.metrics || [];
    
    for (const metric of metrics) {
      trends.metrics.push({
        date: this._getDayKey(metric.timestamp || metric.generatedAt),
        summary: metric.summary
      });
    }
    
    return { trends };
  }

  async _groupByProject(ctx) {
    const { records } = ctx.previousResults?.['load-records'] || {};
    
    const byProject = {};
    
    const runs = records?.pipelineRuns || [];
    
    for (const run of runs) {
      const project = run.project || run.workspace || 'default';
      
      if (!byProject[project]) {
        byProject[project] = {
          name: project,
          runs: [],
          metrics: {
            totalRuns: 0,
            successRate: 0,
            avgDuration: 0
          }
        };
      }
      
      byProject[project].runs.push(run);
    }
    
    // Calculate project metrics
    for (const project of Object.values(byProject)) {
      const runs = project.runs;
      project.metrics.totalRuns = runs.length;
      
      const successful = runs.filter(r => r.status === 'completed').length;
      project.metrics.successRate = runs.length > 0 ?
        (successful / runs.length) * 100 : 0;
      
      const durations = runs
        .filter(r => r.duration)
        .map(r => r.duration);
      
      project.metrics.avgDuration = durations.length > 0 ?
        durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    }
    
    return { byProject };
  }

  async _renderDashboard(ctx) {
    const { aggregation } = ctx.previousResults?.['aggregate-runs'] || {};
    const { trends } = ctx.previousResults?.['calculate-trends'] || {};
    const { byProject } = ctx.previousResults?.['group-by-project'] || {};
    
    const dashboard = {
      generatedAt: new Date().toISOString(),
      
      summary: {
        totalRuns: aggregation?.total || 0,
        successRate: aggregation?.successRate || 0,
        projects: Object.keys(byProject || {}).length,
        period: ctx.input?.timeRange || 'all'
      },
      
      status: {
        byStatus: aggregation?.byStatus || {},
        byPipeline: aggregation?.byPipeline || {}
      },
      
      trends: {
        runs: trends?.runs || [],
        issues: trends?.issues || [],
        metrics: trends?.metrics || []
      },
      
      projects: byProject ? Object.values(byProject) : []
    };
    
    return { dashboard };
  }

  async _exportReport(ctx) {
    const { dashboard } = ctx.previousResults?.['render-dashboard'] || {};
    
    const exports = [];
    
    // Ensure reports directory exists
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
    
    // Export JSON
    const jsonPath = path.join(
      this.reportsDir, 
      `dashboard-${Date.now()}.json`
    );
    
    fs.writeFileSync(jsonPath, JSON.stringify(dashboard, null, 2), 'utf8');
    exports.push({ format: 'json', path: jsonPath });
    
    // Export Markdown summary
    const mdPath = path.join(
      this.reportsDir,
      `dashboard-${Date.now()}.md`
    );
    
    const markdown = this._generateMarkdown(dashboard);
    fs.writeFileSync(mdPath, markdown, 'utf8');
    exports.push({ format: 'markdown', path: mdPath });
    
    return {
      exported: true,
      exports,
      dashboard
    };
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────────

  async _loadPipelineRuns(timeRange) {
    if (!this.pipelineLedger) return [];
    
    const criteria = {};
    
    if (timeRange?.start) {
      criteria.since = timeRange.start;
    }
    if (timeRange?.end) {
      criteria.until = timeRange.end;
    }
    
    return this.pipelineLedger.query(criteria);
  }

  _loadFromFile(type, timeRange) {
    const reportsDir = path.join(process.cwd(), '.aqt-reports');
    const filePath = path.join(reportsDir, `${type}.json`);
    
    if (!fs.existsSync(filePath)) {
      return [];
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      let data = JSON.parse(content);
      
      // Handle array or object with history array
      if (data && !Array.isArray(data) && data.history) {
        data = data.history;
      }
      
      if (!Array.isArray(data)) {
        return [];
      }
      
      // Filter by time range
      if (timeRange?.start || timeRange?.end) {
        data = data.filter(item => {
          const timestamp = new Date(item.timestamp || item.generatedAt || item.started);
          
          if (timeRange.start && timestamp < new Date(timeRange.start)) {
            return false;
          }
          if (timeRange.end && timestamp > new Date(timeRange.end)) {
            return false;
          }
          
          return true;
        });
      }
      
      return data;
    } catch {
      return [];
    }
  }

  _getDayKey(timestamp) {
    if (!timestamp) return 'unknown';
    
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0];
  }

  _getCacheKey(options) {
    const key = JSON.stringify(options);
    return require('crypto').createHash('md5').update(key).digest('hex');
  }

  _generateMarkdown(dashboard) {
    const lines = [];
    
    lines.push('# Quality Dashboard Report');
    lines.push('');
    lines.push(`Generated: ${dashboard.generatedAt}`);
    lines.push('');
    
    lines.push('## Summary');
    lines.push('');
    lines.push(`- **Total Runs**: ${dashboard.summary.totalRuns}`);
    lines.push(`- **Success Rate**: ${dashboard.summary.successRate.toFixed(1)}%`);
    lines.push(`- **Projects**: ${dashboard.summary.projects}`);
    lines.push('');
    
    lines.push('## Status Breakdown');
    lines.push('');
    
    for (const [status, count] of Object.entries(dashboard.status.byStatus)) {
      lines.push(`- **${status}**: ${count}`);
    }
    
    lines.push('');
    
    lines.push('## Pipeline Usage');
    lines.push('');
    
    for (const [pipeline, count] of Object.entries(dashboard.status.byPipeline)) {
      lines.push(`- **${pipeline}**: ${count} runs`);
    }
    
    lines.push('');
    
    if (dashboard.projects.length > 0) {
      lines.push('## Projects');
      lines.push('');
      
      for (const project of dashboard.projects) {
        lines.push(`### ${project.name}`);
        lines.push(`- Runs: ${project.metrics.totalRuns}`);
        lines.push(`- Success Rate: ${project.metrics.successRate.toFixed(1)}%`);
        lines.push(`- Avg Duration: ${project.metrics.avgDuration.toFixed(0)}ms`);
        lines.push('');
      }
    }
    
    return lines.join('\n');
  }
}

module.exports = {
  DashboardReportingPipeline,
  TimePeriod
};

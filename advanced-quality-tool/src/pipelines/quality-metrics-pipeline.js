/**
 * Performance and Quality Metrics Pipeline (P9-T034)
 *
 * Unifies complexity, duplicate, performance, and quality calculations
 * into a repeatable metrics pipeline with historical comparison.
 *
 * @module pipelines/quality-metrics-pipeline
 */

'use strict';

const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');
const path = require('path');
const fs = require('fs');

/**
 * Metric categories
 */
const MetricCategory = {
  COMPLEXITY: 'complexity',
  DUPLICATION: 'duplication',
  PERFORMANCE: 'performance',
  QUALITY: 'quality',
  MAINTAINABILITY: 'maintainability',
  TESTING: 'testing',
  DOCUMENTATION: 'documentation'
};

/**
 * Quality Metrics Pipeline
 */
class QualityMetricsPipeline {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.executor = options.executor || new PipelineExecutor();
    
    // Configuration
    this.thresholds = options.thresholds || this.getDefaultThresholds();
    this.historyStore = options.historyStore || null;
    
    // Metric calculators
    this.complexityCalculator = options.complexityCalculator || null;
    this.duplicateDetector = options.duplicateDetector || null;
  }

  /**
   * Execute quality metrics pipeline
   * @param {Object} params
   * @param {Object} params.scope - Scope for metrics calculation
   * @param {Object} [params.thresholds] - Override thresholds
   * @param {Object} [params.baseline] - Historical baseline for comparison
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const { scope, thresholds = null, baseline = null } = params;

    const stageHandlers = {
      'select-scope': async (ctx) => this._selectScope(ctx, scope),
      'calculate-complexity': async (ctx) => this._calculateComplexity(ctx),
      'detect-duplicates': async (ctx) => this._detectDuplicates(ctx),
      'detect-performance-issues': async (ctx) => this._detectPerformanceIssues(ctx),
      'aggregate-metrics': async (ctx) => this._aggregateMetrics(ctx),
      'compare-history': async (ctx) => this._compareHistory(ctx, baseline),
      'apply-thresholds': async (ctx) => this._applyThresholds(ctx, thresholds),
      'publish-report': async (ctx) => this._publishReport(ctx)
    };

    const result = await this.executor.execute('quality-metrics', {
      input: { scope, thresholds, baseline },
      workspace: this.workspace,
      stageHandlers
    });

    return result;
  }

  /**
   * Get default thresholds
   */
  getDefaultThresholds() {
    return {
      cyclomaticComplexity: { max: 15, warn: 10 },
      cognitiveComplexity: { max: 20, warn: 15 },
      linesOfCode: { max: 500, warn: 300 },
      duplication: { maxPercent: 5, warnPercent: 3 },
      maintainabilityIndex: { min: 65, warn: 50 },
      technicalDebt: { max: 60, warn: 30 }
    };
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _selectScope(ctx, scope) {
    const files = [];
    const directories = [];
    
    if (scope.files) {
      files.push(...scope.files);
    } else {
      const dir = scope.directory || this.workspace;
      const discovered = this._discoverFiles(dir);
      files.push(...discovered);
    }
    
    // Group by language
    const byLanguage = this._groupByLanguage(files);
    
    return {
      files,
      fileCount: files.length,
      byLanguage,
      scope
    };
  }

  async _calculateComplexity(ctx) {
    const { files, byLanguage } = ctx.previousResults?.['select-scope'] || {};
    
    const metrics = {
      total: 0,
      average: 0,
      byFile: [],
      byFunction: []
    };
    
    for (const file of files || []) {
      const complexity = await this._calculateFileComplexity(file);
      
      metrics.byFile.push({
        file,
        ...complexity
      });
      
      metrics.total += complexity.cyclomatic || 1;
      
      if (complexity.functions) {
        metrics.byFunction.push(...complexity.functions);
      }
    }
    
    metrics.average = (files?.length || 0) > 0 ? 
      metrics.total / files.length : 0;
    
    return { complexity: metrics };
  }

  async _detectDuplicates(ctx) {
    const { files } = ctx.previousResults?.['select-scope'] || {};
    
    const duplicates = {
      blocks: [],
      totalLines: 0,
      duplicatedLines: 0,
      percentage: 0
    };
    
    // Simple duplicate detection by comparing file chunks
    const chunks = new Map();
    
    for (const file of files || []) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        
        duplicates.totalLines += lines.length;
        
        // Check for duplicate blocks (minimum 5 lines)
        const blockSize = 5;
        for (let i = 0; i <= lines.length - blockSize; i++) {
          const block = lines.slice(i, i + blockSize).join('\n');
          const hash = this._hashBlock(block);
          
          if (chunks.has(hash)) {
            const existing = chunks.get(hash);
            duplicates.blocks.push({
              file,
              line: i + 1,
              duplicateOf: existing.file,
              duplicateLine: existing.line,
              lines: blockSize
            });
            duplicates.duplicatedLines += blockSize;
          } else {
            chunks.set(hash, { file, line: i + 1 });
          }
        }
      } catch (error) {
        // Skip unreadable files
      }
    }
    
    duplicates.percentage = duplicates.totalLines > 0 ?
      (duplicates.duplicatedLines / duplicates.totalLines) * 100 : 0;
    
    return { duplicates };
  }

  async _detectPerformanceIssues(ctx) {
    const { files } = ctx.previousResults?.['select-scope'] || {};
    
    const issues = [];
    
    for (const file of files || []) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const fileIssues = this._analyzePerformancePatterns(file, content);
        issues.push(...fileIssues);
      } catch (error) {
        // Skip unreadable files
      }
    }
    
    return {
      performanceIssues: issues,
      count: issues.length
    };
  }

  async _aggregateMetrics(ctx) {
    const complexity = ctx.previousResults?.['calculate-complexity']?.complexity || {};
    const duplicates = ctx.previousResults?.['detect-duplicates']?.duplicates || {};
    const performanceIssues = ctx.previousResults?.['detect-performance-issues']?.performanceIssues || [];
    
    const { files, fileCount, byLanguage } = ctx.previousResults?.['select-scope'] || {};
    
    // Calculate totals
    const totalLines = duplicates.totalLines || 0;
    const avgComplexity = complexity.average || 0;
    const duplicationPercent = duplicates.percentage || 0;
    
    // Calculate maintainability index
    const maintainabilityIndex = this._calculateMaintainabilityIndex({
      avgComplexity,
      duplicationPercent,
      totalLines
    });
    
    // Calculate technical debt (in minutes)
    const technicalDebt = this._calculateTechnicalDebt({
      complexity: complexity.byFile || [],
      duplicates: duplicates.blocks || [],
      performanceIssues
    });
    
    const metrics = {
      summary: {
        files: fileCount,
        totalLines,
        avgComplexity: Math.round(avgComplexity * 10) / 10,
        duplicationPercent: Math.round(duplicationPercent * 10) / 10,
        maintainabilityIndex: Math.round(maintainabilityIndex),
        technicalDebt: Math.round(technicalDebt)
      },
      complexity: {
        total: complexity.total || 0,
        average: avgComplexity,
        highComplexityFiles: (complexity.byFile || []).filter(f => (f.cyclomatic || 0) > 10).length
      },
      duplication: {
        percentage: duplicationPercent,
        blocks: duplicates.blocks?.length || 0,
        duplicatedLines: duplicates.duplicatedLines || 0
      },
      performance: {
        issues: performanceIssues.length,
        critical: performanceIssues.filter(i => i.severity === 'high').length
      },
      byLanguage
    };
    
    return { metrics };
  }

  async _compareHistory(ctx, baseline) {
    const { metrics } = ctx.previousResults?.['aggregate-metrics'] || {};
    
    const comparison = {
      hasBaseline: false,
      trends: {},
      changes: []
    };
    
    const historicalData = baseline || await this._loadHistory();
    
    if (historicalData) {
      comparison.hasBaseline = true;
      
      const previous = historicalData.metrics?.summary || {};
      const current = metrics?.summary || {};
      
      // Calculate trends
      for (const key of Object.keys(current)) {
        if (typeof current[key] === 'number' && typeof previous[key] === 'number') {
          const change = current[key] - previous[key];
          const percentChange = previous[key] !== 0 ? 
            (change / previous[key]) * 100 : 0;
          
          comparison.trends[key] = {
            current: current[key],
            previous: previous[key],
            change,
            percentChange: Math.round(percentChange * 10) / 10,
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'stable'
          };
          
          if (change !== 0) {
            comparison.changes.push({
              metric: key,
              change,
              percentChange
            });
          }
        }
      }
    }
    
    return { comparison };
  }

  async _applyThresholds(ctx, customThresholds) {
    const thresholds = customThresholds || this.thresholds;
    const { metrics } = ctx.previousResults?.['aggregate-metrics'] || {};
    
    const results = [];
    let passed = true;
    
    for (const [name, threshold] of Object.entries(thresholds)) {
      const metricValue = this._getMetricValue(name, metrics);
      const result = this._checkThreshold(name, metricValue, threshold);
      
      if (!result.passed) {
        passed = false;
      }
      
      results.push(result);
    }
    
    return {
      passed,
      thresholds: results,
      violations: results.filter(r => !r.passed)
    };
  }

  async _publishReport(ctx) {
    const { metrics } = ctx.previousResults?.['aggregate-metrics'] || {};
    const { comparison } = ctx.previousResults?.['compare-history'] || {};
    const { passed, thresholds, violations } = ctx.previousResults?.['apply-thresholds'] || {};
    
    const report = {
      generatedAt: new Date().toISOString(),
      workspace: this.workspace,
      
      summary: {
        ...metrics?.summary,
        passed,
        hasViolations: violations?.length > 0
      },
      
      metrics,
      
      thresholds: {
        passed,
        results: thresholds,
        violations
      },
      
      comparison,
      
      recommendations: this._generateRecommendations(metrics, violations)
    };
    
    // Save to history
    await this._saveToHistory(report);
    
    return report;
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────────

  _discoverFiles(dir) {
    const files = [];
    
    const walk = (currentDir) => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory()) {
            if (!this._isExcluded(fullPath)) {
              walk(fullPath);
            }
          } else if (entry.isFile() && this._isCodeFile(fullPath)) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Ignore errors
      }
    };
    
    walk(dir);
    return files;
  }

  _isExcluded(dir) {
    const name = path.basename(dir);
    return ['node_modules', '.git', 'dist', 'build', 'coverage'].includes(name);
  }

  _isCodeFile(file) {
    const ext = path.extname(file);
    return ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rs'].includes(ext);
  }

  _groupByLanguage(files) {
    const groups = {};
    
    for (const file of files) {
      const lang = this._detectLanguage(file);
      if (!groups[lang]) groups[lang] = [];
      groups[lang].push(file);
    }
    
    return groups;
  }

  _detectLanguage(file) {
    const ext = path.extname(file);
    const mapping = {
      '.js': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust'
    };
    
    return mapping[ext] || 'unknown';
  }

  async _calculateFileComplexity(file) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      
      // Simple cyclomatic complexity estimation
      let cyclomatic = 1;
      const patterns = [
        /\bif\b/g,
        /\belse\s+if\b/g,
        /\bfor\b/g,
        /\bwhile\b/g,
        /\bswitch\b/g,
        /\bcase\b/g,
        /\bcatch\b/g,
        /\?\s*:/g, // ternary
        /&&/g,
        /\|\|/g
      ];
      
      for (const pattern of patterns) {
        const matches = content.match(pattern);
        if (matches) {
          cyclomatic += matches.length;
        }
      }
      
      return {
        cyclomatic,
        lines: lines.length,
        functions: []
      };
    } catch {
      return { cyclomatic: 1, lines: 0, functions: [] };
    }
  }

  _hashBlock(block) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(block).digest('hex');
  }

  _analyzePerformancePatterns(file, content) {
    const issues = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Synchronous operations
      if (line.includes('fs.readFileSync') || line.includes('fs.writeFileSync')) {
        issues.push({
          file,
          line: i + 1,
          type: 'sync-io',
          severity: 'medium',
          message: 'Synchronous file operation may impact performance'
        });
      }
      
      // Large array operations
      if (line.includes('.map(') && lines[i + 1]?.includes('.filter(')) {
        issues.push({
          file,
          line: i + 1,
          type: 'chained-iteration',
          severity: 'low',
          message: 'Consider combining chained array operations'
        });
      }
      
      // Nested loops
      if (line.includes('for (') && lines[i + 1]?.includes('for (')) {
        issues.push({
          file,
          line: i + 1,
          type: 'nested-loop',
          severity: 'high',
          message: 'Nested loops may cause O(n²) performance'
        });
      }
    }
    
    return issues;
  }

  _calculateMaintainabilityIndex(params) {
    const { avgComplexity, duplicationPercent, totalLines } = params;
    
    // Simplified maintainability index calculation
    // Original formula involves HALSTEAD volume, but we'll use a simplified version
    const volume = Math.log(totalLines + 1);
    const complexityFactor = Math.max(0, 100 - avgComplexity * 5);
    const duplicationFactor = Math.max(0, 100 - duplicationPercent * 5);
    
    return (complexityFactor + duplicationFactor) / 2;
  }

  _calculateTechnicalDebt(params) {
    let debt = 0;
    
    // Complexity debt
    for (const file of params.complexity || []) {
      if (file.cyclomatic > 10) {
        debt += (file.cyclomatic - 10) * 5; // 5 minutes per excess complexity
      }
    }
    
    // Duplication debt
    debt += (params.duplicates?.length || 0) * 10; // 10 minutes per duplicate block
    
    // Performance debt
    for (const issue of params.performanceIssues || []) {
      if (issue.severity === 'high') debt += 30;
      else if (issue.severity === 'medium') debt += 15;
      else debt += 5;
    }
    
    return debt;
  }

  _getMetricValue(name, metrics) {
    const mapping = {
      cyclomaticComplexity: metrics?.complexity?.average,
      cognitiveComplexity: metrics?.complexity?.average, // Simplified
      linesOfCode: metrics?.summary?.totalLines,
      duplication: metrics?.duplication?.percentage,
      maintainabilityIndex: metrics?.summary?.maintainabilityIndex,
      technicalDebt: metrics?.summary?.technicalDebt
    };
    
    return mapping[name];
  }

  _checkThreshold(name, value, threshold) {
    if (value === undefined) {
      return {
        name,
        value: null,
        passed: false,
        reason: 'Metric not available'
      };
    }
    
    let passed = true;
    let violated = null;
    
    if (threshold.max !== undefined && value > threshold.max) {
      passed = false;
      violated = 'max';
    } else if (threshold.min !== undefined && value < threshold.min) {
      passed = false;
      violated = 'min';
    } else if (threshold.maxPercent !== undefined && value > threshold.maxPercent) {
      passed = false;
      violated = 'maxPercent';
    }
    
    return {
      name,
      value,
      threshold,
      passed,
      violated,
      reason: passed ? 'Within threshold' : `Exceeds ${violated} threshold`
    };
  }

  async _loadHistory() {
    if (this.historyStore) {
      return await this.historyStore.load();
    }
    
    const historyPath = path.join(this.workspace, '.aqt-reports', 'metrics-history.json');
    
    if (fs.existsSync(historyPath)) {
      try {
        const data = fs.readFileSync(historyPath, 'utf8');
        const history = JSON.parse(data);
        return history[history.length - 1] || null;
      } catch {
        return null;
      }
    }
    
    return null;
  }

  async _saveToHistory(report) {
    if (this.historyStore) {
      await this.historyStore.save(report);
      return;
    }
    
    const historyPath = path.join(this.workspace, '.aqt-reports', 'metrics-history.json');
    
    let history = [];
    if (fs.existsSync(historyPath)) {
      try {
        history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      } catch {
        history = [];
      }
    }
    
    history.push({
      timestamp: report.generatedAt,
      summary: report.summary,
      metrics: report.metrics
    });
    
    // Keep last 100 entries
    if (history.length > 100) {
      history = history.slice(-100);
    }
    
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
  }

  _generateRecommendations(metrics, violations) {
    const recommendations = [];
    
    if (metrics?.complexity?.highComplexityFiles > 0) {
      recommendations.push({
        category: MetricCategory.COMPLEXITY,
        priority: 'high',
        message: `Refactor ${metrics.complexity.highComplexityFiles} files with high complexity`,
        action: 'Break down complex functions into smaller, focused units'
      });
    }
    
    if (metrics?.duplication?.percentage > 5) {
      recommendations.push({
        category: MetricCategory.DUPLICATION,
        priority: 'medium',
        message: `${metrics.duplication.percentage.toFixed(1)}% code duplication detected`,
        action: 'Extract duplicated code into shared functions or modules'
      });
    }
    
    if (metrics?.performance?.critical > 0) {
      recommendations.push({
        category: MetricCategory.PERFORMANCE,
        priority: 'high',
        message: `${metrics.performance.critical} critical performance issues`,
        action: 'Review and optimize nested loops and synchronous operations'
      });
    }
    
    return recommendations;
  }
}

module.exports = {
  QualityMetricsPipeline,
  MetricCategory
};

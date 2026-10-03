/**
 * Issue Categorization and Enrichment Pipeline
 * Task: P9-T026
 * 
 * Defines the enrichment contract shared by CLI, extension, UI, reports, and fix engines.
 * Preserves original linter evidence while adding category, severity, priority, fixability, and tags.
 */

const { Pipeline } = require('../core/pipeline');

/**
 * Issue Enrichment Pipeline Stages
 */
const STAGES = [
  { name: 'load-issues', description: 'Load issues from analysis' },
  { name: 'infer-file-type', description: 'Infer file type from extension' },
  { name: 'classify-category', description: 'Classify issue category' },
  { name: 'map-severity', description: 'Map to standard severity scale' },
  { name: 'determine-fixability', description: 'Determine if auto-fixable' },
  { name: 'add-tags', description: 'Add descriptive tags' },
  { name: 'filter', description: 'Filter by rules' },
  { name: 'group', description: 'Group related issues' }
];

/**
 * Issue categories
 */
const Categories = {
  ERROR: 'error',
  STYLE: 'style',
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  UNUSED_CODE: 'unused-code',
  BEST_PRACTICE: 'best-practice',
  COMPLEXITY: 'complexity',
  DEPENDENCY: 'dependency',
  DOCUMENTATION: 'documentation',
  ACCESSIBILITY: 'accessibility',
  TESTING: 'testing',
  QUALITY: 'quality'
};

/**
 * Standard severity levels
 */
const SeverityLevels = {
  CRITICAL: 'critical',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  SUGGESTION: 'suggestion'
};

/**
 * Priority levels
 */
const PriorityLevels = {
  P0: 'p0', // Critical - must fix immediately
  P1: 'p1', // High - fix soon
  P2: 'p2', // Medium - fix when possible
  P3: 'p3', // Low - fix if time permits
  P4: 'p4'  // Suggestion - optional
};

/**
 * File type mappings
 */
const FileTypes = {
  JAVASCRIPT: 'javascript',
  TYPESCRIPT: 'typescript',
  JSX: 'jsx',
  TSX: 'tsx',
  JSON: 'json',
  CSS: 'css',
  SCSS: 'scss',
  HTML: 'html',
  MARKDOWN: 'markdown',
  YAML: 'yaml',
  UNKNOWN: 'unknown'
};

/**
 * Issue Enrichment Pipeline Implementation
 */
class IssueEnrichmentPipeline extends Pipeline {
  constructor(options = {}) {
    super('issue-enrichment', STAGES, options);
    
    this.categoryRules = options.categoryRules || this.getDefaultCategoryRules();
    this.severityMapping = options.severityMapping || this.getDefaultSeverityMapping();
    this.fixabilityRules = options.fixabilityRules || this.getDefaultFixabilityRules();
    this.filterRules = options.filterRules || [];
  }

  /**
   * Stage: load-issues
   */
  async loadIssues(context) {
    const issues = context.issues || [];
    
    return { issues: issues.map(i => ({ ...i })) };
  }

  /**
   * Stage: infer-file-type
   */
  async inferFileType(context) {
    const { issues } = context.previousResult;
    
    const enriched = issues.map(issue => ({
      ...issue,
      fileType: this.inferFileType(issue.file)
    }));
    
    return { issues: enriched };
  }

  /**
   * Infer file type from extension
   */
  inferFileType(filePath) {
    if (!filePath) return FileTypes.UNKNOWN;
    
    const ext = filePath.split('.').pop()?.toLowerCase();
    
    switch (ext) {
      case 'js':
      case 'mjs':
      case 'cjs':
        return FileTypes.JAVASCRIPT;
      case 'ts':
        return FileTypes.TYPESCRIPT;
      case 'jsx':
        return FileTypes.JSX;
      case 'tsx':
        return FileTypes.TSX;
      case 'json':
        return FileTypes.JSON;
      case 'css':
        return FileTypes.CSS;
      case 'scss':
      case 'sass':
        return FileTypes.SCSS;
      case 'html':
      case 'htm':
        return FileTypes.HTML;
      case 'md':
      case 'markdown':
        return FileTypes.MARKDOWN;
      case 'yaml':
      case 'yml':
        return FileTypes.YAML;
      default:
        return FileTypes.UNKNOWN;
    }
  }

  /**
   * Stage: classify-category
   */
  async classifyCategory(context) {
    const { issues } = context.previousResult;
    
    const enriched = issues.map(issue => ({
      ...issue,
      category: issue.category || this.classifyCategory(issue)
    }));
    
    return { issues: enriched };
  }

  /**
   * Classify issue category based on rules
   */
  classifyCategory(issue) {
    const message = (issue.message || '').toLowerCase();
    const rule = (issue.rule || '').toLowerCase();
    
    for (const categoryRule of this.categoryRules) {
      if (categoryRule.patterns.some(p => 
        message.includes(p) || rule.includes(p)
      )) {
        return categoryRule.category;
      }
    }
    
    return Categories.QUALITY;
  }

  /**
   * Stage: map-severity
   */
  async mapSeverity(context) {
    const { issues } = context.previousResult;
    
    const enriched = issues.map(issue => ({
      ...issue,
      severity: this.mapSeverity(issue),
      originalSeverity: issue.severity
    }));
    
    return { issues: enriched };
  }

  /**
   * Map to standard severity scale
   */
  mapSeverity(issue) {
    const original = issue.severity?.toLowerCase();
    
    // Direct mapping
    if (Object.values(SeverityLevels).includes(original)) {
      return original;
    }
    
    // Custom mapping
    const mapped = this.severityMapping[original];
    if (mapped) {
      return mapped;
    }
    
    // Default based on category
    if (issue.category === Categories.SECURITY) {
      return SeverityLevels.ERROR;
    }
    
    if (issue.category === Categories.ERROR) {
      return SeverityLevels.ERROR;
    }
    
    return SeverityLevels.WARNING;
  }

  /**
   * Stage: determine-fixability
   */
  async determineFixability(context) {
    const { issues } = context.previousResult;
    
    const enriched = issues.map(issue => ({
      ...issue,
      fixability: this.determineFixability(issue)
    }));
    
    return { issues: enriched };
  }

  /**
   * Determine if issue is auto-fixable
   */
  determineFixability(issue) {
    const rule = issue.rule?.toLowerCase() || '';
    
    for (const fixableRule of this.fixabilityRules) {
      if (fixableRule.patterns.some(p => rule.includes(p))) {
        return {
          fixable: true,
          type: fixableRule.type,
          confidence: fixableRule.confidence
        };
      }
    }
    
    // Check linter-specific fixability
    if (issue.linter === 'eslint' && issue.fixable !== undefined) {
      return {
        fixable: issue.fixable,
        type: 'rule-based',
        confidence: 0.95
      };
    }
    
    return {
      fixable: false,
      type: null,
      confidence: 0
    };
  }

  /**
   * Stage: add-tags
   */
  async addTags(context) {
    const { issues } = context.previousResult;
    
    const enriched = issues.map(issue => ({
      ...issue,
      tags: this.generateTags(issue)
    }));
    
    return { issues: enriched };
  }

  /**
   * Generate descriptive tags
   */
  generateTags(issue) {
    const tags = new Set();
    
    // Add category as tag
    tags.add(issue.category);
    
    // Add severity as tag
    tags.add(`severity:${issue.severity}`);
    
    // Add file type as tag
    if (issue.fileType !== FileTypes.UNKNOWN) {
      tags.add(issue.fileType);
    }
    
    // Add linter as tag
    if (issue.linter) {
      tags.add(`linter:${issue.linter}`);
    }
    
    // Add fixability tag
    if (issue.fixability?.fixable) {
      tags.add('auto-fixable');
    }
    
    // Add rule-based tags
    const message = (issue.message || '').toLowerCase();
    
    if (message.includes('unused')) tags.add('unused');
    if (message.includes('deprecated')) tags.add('deprecated');
    if (message.includes('missing')) tags.add('missing');
    if (message.includes('security')) tags.add('security-risk');
    
    return Array.from(tags);
  }

  /**
   * Stage: filter
   */
  async filter(context) {
    const { issues } = context.previousResult;
    const options = context.options || {};
    
    let filtered = issues;
    
    // Apply filter rules
    for (const rule of this.filterRules) {
      if (rule.enabled === false) continue;
      
      filtered = filtered.filter(issue => {
        if (rule.excludeCategories?.includes(issue.category)) return false;
        if (rule.excludeSeverities?.includes(issue.severity)) return false;
        if (rule.excludeRules?.includes(issue.rule)) return false;
        if (rule.minSeverity && this.compareSeverity(issue.severity, rule.minSeverity) < 0) return false;
        return true;
      });
    }
    
    // Apply options filters
    if (options.categories) {
      filtered = filtered.filter(i => options.categories.includes(i.category));
    }
    
    if (options.severities) {
      filtered = filtered.filter(i => options.severities.includes(i.severity));
    }
    
    // Track rejected issues
    const rejected = issues.filter(i => !filtered.includes(i));
    
    return { issues: filtered, rejected };
  }

  /**
   * Stage: group
   */
  async group(context) {
    const { issues, rejected } = context.previousResult;
    const options = context.options || {};
    
    const groups = {};
    
    // Group by category
    const byCategory = {};
    for (const issue of issues) {
      const cat = issue.category || 'unknown';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(issue);
    }
    groups.byCategory = byCategory;
    
    // Group by file
    const byFile = {};
    for (const issue of issues) {
      const file = issue.file || 'unknown';
      if (!byFile[file]) byFile[file] = [];
      byFile[file].push(issue);
    }
    groups.byFile = byFile;
    
    // Group by severity
    const bySeverity = {};
    for (const issue of issues) {
      const sev = issue.severity || 'warning';
      if (!bySeverity[sev]) bySeverity[sev] = [];
      bySeverity[sev].push(issue);
    }
    groups.bySeverity = bySeverity;
    
    // Calculate priority
    const prioritized = issues.map(issue => ({
      ...issue,
      priority: this.calculatePriority(issue)
    }));
    
    return {
      issues: prioritized,
      groups,
      rejected,
      summary: {
        total: issues.length,
        byCategory: Object.entries(byCategory).map(([k, v]) => ({ category: k, count: v.length })),
        bySeverity: Object.entries(bySeverity).map(([k, v]) => ({ severity: k, count: v.length }))
      }
    };
  }

  /**
   * Calculate priority based on severity and category
   */
  calculatePriority(issue) {
    if (issue.severity === SeverityLevels.CRITICAL) return PriorityLevels.P0;
    if (issue.severity === SeverityLevels.ERROR) {
      if (issue.category === Categories.SECURITY) return PriorityLevels.P0;
      return PriorityLevels.P1;
    }
    if (issue.severity === SeverityLevels.WARNING) {
      if (issue.category === Categories.SECURITY) return PriorityLevels.P1;
      return PriorityLevels.P2;
    }
    if (issue.severity === SeverityLevels.INFO) return PriorityLevels.P3;
    return PriorityLevels.P4;
  }

  /**
   * Compare severity levels
   */
  compareSeverity(a, b) {
    const order = {
      [SeverityLevels.CRITICAL]: 5,
      [SeverityLevels.ERROR]: 4,
      [SeverityLevels.WARNING]: 3,
      [SeverityLevels.INFO]: 2,
      [SeverityLevels.SUGGESTION]: 1
    };
    
    return (order[a] || 0) - (order[b] || 0);
  }

  /**
   * Default category rules
   */
  getDefaultCategoryRules() {
    return [
      { category: Categories.SECURITY, patterns: ['security', 'vulnerability', 'xss', 'injection', 'csrf'] },
      { category: Categories.UNUSED_CODE, patterns: ['unused', 'unreachable', 'dead code'] },
      { category: Categories.PERFORMANCE, patterns: ['performance', 'slow', 'inefficient', 'optimize'] },
      { category: Categories.STYLE, patterns: ['style', 'formatting', 'indentation', 'spacing', 'quote'] },
      { category: Categories.BEST_PRACTICE, patterns: ['best practice', 'prefer', 'recommend'] },
      { category: Categories.COMPLEXITY, patterns: ['complexity', 'cognitive', 'cyclomatic'] },
      { category: Categories.DEPENDENCY, patterns: ['dependency', 'import', 'require', 'module'] },
      { category: Categories.DOCUMENTATION, patterns: ['jsdoc', 'documentation', 'comment'] },
      { category: Categories.ACCESSIBILITY, patterns: ['accessibility', 'a11y', 'aria', 'wcag'] },
      { category: Categories.TESTING, patterns: ['test', 'spec', 'coverage'] }
    ];
  }

  /**
   * Default severity mapping
   */
  getDefaultSeverityMapping() {
    return {
      'off': SeverityLevels.SUGGESTION,
      'warn': SeverityLevels.WARNING,
      'warning': SeverityLevels.WARNING,
      'error': SeverityLevels.ERROR,
      'fatal': SeverityLevels.CRITICAL,
      'info': SeverityLevels.INFO
    };
  }

  /**
   * Default fixability rules
   */
  getDefaultFixabilityRules() {
    return [
      { patterns: ['semi', 'quotes', 'indent', 'comma-dangle'], type: 'rule-based', confidence: 0.99 },
      { patterns: ['prefer-const', 'prefer-arrow-callback'], type: 'rule-based', confidence: 0.95 },
      { patterns: ['no-unused-vars', 'no-console'], type: 'ai-assisted', confidence: 0.8 }
    ];
  }
}

module.exports = {
  IssueEnrichmentPipeline,
  STAGES,
  Categories,
  SeverityLevels,
  PriorityLevels,
  FileTypes
};

/**
 * Issue Categorization Engine
 * 
 * Advanced categorization system for code quality issues.
 * Categorizes by file type, severity, category, and provides
 * intelligent filtering, sorting, and prioritization.
 */

const { SEVERITY_LEVELS, CATEGORIES, AUTO_FIX_LEVELS } = require('./issue-normalizer');
const path = require('path');

/**
 * Main Categorization Engine
 */
class IssueCategorizationEngine {
  constructor(options = {}) {
    this.options = {
      autoEnrich: true,
      strictMode: false,
      ...options
    };

    this.rules = new CategorizationRules();
  }

  /**
   * Categorize a single issue
   */
  categorize(issue) {
    const categorized = { ...issue };

    // Enrich file type if missing
    if (!categorized.fileType || categorized.fileType === 'unknown') {
      categorized.fileType = this.detectFileType(categorized.file);
    }

    // Enrich severity if seems wrong
    if (this.options.autoEnrich) {
      categorized.severity = this.refineSeverity(categorized);
    }

    // Enrich category if missing or generic
    if (!categorized.category || categorized.category === 'STYLE') {
      categorized.category = this.refineCategory(categorized);
    }

    // Enrich auto-fix level
    if (!categorized.autoFixLevel) {
      categorized.autoFixLevel = this.determineAutoFixLevel(categorized);
    }

    // Add tags for easier filtering
    categorized.tags = this.generateTags(categorized);

    return categorized;
  }

  /**
   * Categorize multiple issues
   */
  categorizeAll(issues) {
    return issues.map(issue => this.categorize(issue));
  }

  /**
   * Detect file type from file path
   */
  detectFileType(filePath) {
    if (!filePath) return 'unknown';

    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath).toLowerCase();

    // Angular-specific detection
    if (basename.endsWith('.component.html')) return 'angular-template';
    if (basename.endsWith('.component.ts')) return 'angular-component';
    if (basename.endsWith('.service.ts')) return 'angular-service';
    if (basename.endsWith('.module.ts')) return 'angular-module';
    if (basename.endsWith('.directive.ts')) return 'angular-directive';
    if (basename.endsWith('.pipe.ts')) return 'angular-pipe';
    if (basename.includes('.spec.') || basename.includes('.test.')) return 'test';

    // Extension-based detection
    const typeMap = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'scss',
      '.less': 'less',
      '.html': 'html',
      '.vue': 'vue',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.cs': 'csharp'
    };

    return typeMap[ext] || 'unknown';
  }

  /**
   * Refine severity based on issue characteristics
   */
  refineSeverity(issue) {
    const originalSeverity = issue.severity || 'INFO';

    // Security issues are always at least WARNING, usually CRITICAL
    if (issue.category === 'SECURITY' || 
        issue.type?.startsWith('SEC-') ||
        this.isSecurityIssue(issue)) {

      // Specific security issues that are always CRITICAL
      const criticalPatterns = [
        /sql.?injection/i,
        /xss/i,
        /eval/i,
        /hardcoded.*(secret|password|key)/i,
        /security.?bypass/i,
        /path.?traversal/i
      ];

      if (criticalPatterns.some(p => p.test(issue.message) || p.test(issue.title))) {
        return 'CRITICAL';
      }

      // Other security issues are at least ERROR
      return this.compareServerities(originalSeverity, 'ERROR');
    }

    // Accessibility violations are at least WARNING
    if (issue.category === 'ACCESSIBILITY' || issue.type?.startsWith('A11Y-')) {
      return this.compareServerities(originalSeverity, 'WARNING');
    }

    // Syntax errors are always ERROR
    if (issue.message?.includes('syntax error') || 
        issue.type?.includes('syntax')) {
      return 'ERROR';
    }

    // Undefined variables, null references are ERROR
    if (issue.type === 'BUG-002' || 
        /undefined|is not defined|null reference/i.test(issue.message)) {
      return 'ERROR';
    }

    return originalSeverity;
  }

  /**
   * Refine category based on issue characteristics
   */
  refineCategory(issue) {
    const originalCategory = issue.category || 'STYLE';

    // Check type prefix
    if (issue.type) {
      if (issue.type.startsWith('SEC-')) return 'SECURITY';
      if (issue.type.startsWith('PERF-')) return 'PERFORMANCE';
      if (issue.type.startsWith('A11Y-') || issue.type.startsWith('HTML-')) return 'ACCESSIBILITY';
      if (issue.type.startsWith('BUG-')) return 'BUG';
      if (issue.type.startsWith('SMELL-')) return 'MAINTAINABILITY';
      if (issue.type.startsWith('STYLE-')) return 'STYLE';
      if (issue.type.startsWith('NG-')) return 'BEST_PRACTICE';
    }

    // Check message content
    const message = (issue.message || '').toLowerCase();
    const title = (issue.title || '').toLowerCase();
    const combined = message + ' ' + title;

    // Security keywords
    if (this.containsAny(combined, [
      'security', 'xss', 'injection', 'vulnerability', 'exploit',
      'auth', 'password', 'secret', 'token', 'credential'
    ])) {
      return 'SECURITY';
    }

    // Performance keywords
    if (this.containsAny(combined, [
      'performance', 'slow', 'memory leak', 'optimize', 'inefficient',
      'blocking', 'async', 'await', 'promise'
    ])) {
      return 'PERFORMANCE';
    }

    // Accessibility keywords
    if (this.containsAny(combined, [
      'accessibility', 'a11y', 'aria', 'alt text', 'screen reader',
      'keyboard', 'focus', 'contrast', 'semantic'
    ])) {
      return 'ACCESSIBILITY';
    }

    // Bug keywords
    if (this.containsAny(combined, [
      'undefined', 'null', 'error', 'exception', 'crash',
      'incorrect', 'broken', 'fail'
    ])) {
      return 'BUG';
    }

    // Maintainability keywords
    if (this.containsAny(combined, [
      'complex', 'duplicate', 'refactor', 'smell', 'technical debt',
      'maintainability', 'readability'
    ])) {
      return 'MAINTAINABILITY';
    }

    return originalCategory;
  }

  /**
   * Determine auto-fix level
   */
  determineAutoFixLevel(issue) {
    // If linter provides fix, it's AUTO
    if (issue.context?.fixedCode || issue.fix) {
      return 'AUTO';
    }

    // Format/style issues are usually AUTO
    if (issue.category === 'STYLE' && 
        (issue.source === 'prettier' || issue.source === 'eslint')) {
      return 'AUTO';
    }

    // Simple fixes
    const simpleRules = [
      'semi', 'quotes', 'indent', 'no-trailing-spaces',
      'comma-dangle', 'eol-last', 'no-multiple-empty-lines'
    ];
    if (simpleRules.includes(issue.rule)) {
      return 'AUTO';
    }

    // Security issues need manual review
    if (issue.category === 'SECURITY' || issue.severity === 'CRITICAL') {
      return 'MANUAL';
    }

    // Complex refactoring needs AI
    if (issue.category === 'MAINTAINABILITY' || 
        issue.type?.startsWith('SMELL-')) {
      return 'AI';
    }

    // Bug fixes usually need AI
    if (issue.category === 'BUG' && issue.severity !== 'INFO') {
      return 'AI';
    }

    // Default to RULE-based
    return 'RULE';
  }

  /**
   * Generate searchable tags for an issue
   */
  generateTags(issue) {
    const tags = new Set();

    // Add file type
    tags.add(issue.fileType);

    // Add severity
    tags.add(issue.severity.toLowerCase());

    // Add category
    tags.add(issue.category.toLowerCase());

    // Add fixability
    tags.add(issue.autoFixLevel === 'AUTO' || issue.autoFixLevel === 'RULE' ? 'fixable' : 'notfixable');

    // Add source
    tags.add(issue.source);

    // Add special tags based on characteristics
    if (issue.category === 'SECURITY') tags.add('security-issue');
    if (issue.severity === 'CRITICAL') tags.add('critical');
    if (issue.category === 'ACCESSIBILITY') tags.add('a11y');
    if (issue.fileType.includes('angular')) tags.add('angular');
    if (issue.fileType === 'test') tags.add('test-file');

    // Add language tags
    if (['javascript', 'typescript'].includes(issue.fileType)) {
      tags.add('js-ts');
    }
    if (['css', 'scss', 'less'].includes(issue.fileType)) {
      tags.add('styles');
    }

    return Array.from(tags);
  }

  /**
   * Check if issue is security-related
   */
  isSecurityIssue(issue) {
    const securityPatterns = [
      /security/i,
      /vulnerability/i,
      /xss/i,
      /injection/i,
      /cwe-\d+/i,
      /owasp/i
    ];

    const combined = `${issue.message} ${issue.title} ${issue.type}`;
    return securityPatterns.some(p => p.test(combined));
  }

  /**
   * Compare two severities and return the higher one
   */
  compareServerities(sev1, sev2) {
    const index1 = SEVERITY_LEVELS.indexOf(sev1);
    const index2 = SEVERITY_LEVELS.indexOf(sev2);
    return index1 < index2 ? sev1 : sev2;
  }

  /**
   * Check if text contains any of the keywords
   */
  containsAny(text, keywords) {
    return keywords.some(keyword => text.includes(keyword));
  }
}

/**
 * Advanced filtering engine
 */
class IssueFilterEngine {
  constructor() {
    this.filters = [];
  }

  /**
   * Add a filter
   */
  addFilter(name, filterFn) {
    this.filters.push({ name, filterFn });
    return this;
  }

  /**
   * Filter issues by severity
   */
  bySeverity(...severities) {
    return this.addFilter('severity', issue => 
      severities.includes(issue.severity)
    );
  }

  /**
   * Filter issues by category
   */
  byCategory(...categories) {
    return this.addFilter('category', issue => 
      categories.includes(issue.category)
    );
  }

  /**
   * Filter issues by file type
   */
  byFileType(...fileTypes) {
    return this.addFilter('fileType', issue => 
      fileTypes.includes(issue.fileType)
    );
  }

  /**
   * Filter issues by file pattern (regex)
   */
  byFilePattern(pattern) {
    const regex = new RegExp(pattern);
    return this.addFilter('filePattern', issue => 
      regex.test(issue.file)
    );
  }

  /**
   * Filter issues by fixability
   */
  byFixable(fixable = true) {
    return this.addFilter('fixable', issue => {
      const isFixable = issue.autoFixLevel === 'AUTO' || issue.autoFixLevel === 'RULE';
      return fixable ? isFixable : !isFixable;
    });
  }

  /**
   * Filter issues by source
   */
  bySource(...sources) {
    return this.addFilter('source', issue => 
      sources.includes(issue.source)
    );
  }

  /**
   * Filter issues by tag
   */
  byTag(tag) {
    return this.addFilter('tag', issue => 
      issue.tags && issue.tags.includes(tag)
    );
  }

  /**
   * Filter issues by priority class
   */
  byPriorityClass(...classes) {
    return this.addFilter('priorityClass', issue => 
      classes.includes(issue.priorityClass)
    );
  }

  /**
   * Custom filter function
   */
  custom(name, filterFn) {
    return this.addFilter(name, filterFn);
  }

  /**
   * Apply all filters to issues
   */
  apply(issues) {
    return this.filters.reduce((filtered, { filterFn }) => 
      filtered.filter(filterFn), 
      issues
    );
  }

  /**
   * Clear all filters
   */
  reset() {
    this.filters = [];
    return this;
  }
}

/**
 * Sorting engine
 */
class IssueSortEngine {
  /**
   * Sort by priority (descending)
   */
  static byPriority(issues, descending = true) {
    return [...issues].sort((a, b) => 
      descending ? b.priority - a.priority : a.priority - b.priority
    );
  }

  /**
   * Sort by severity
   */
  static bySeverity(issues, descending = true) {
    const order = SEVERITY_LEVELS;
    return [...issues].sort((a, b) => {
      const indexA = order.indexOf(a.severity);
      const indexB = order.indexOf(b.severity);
      return descending ? indexA - indexB : indexB - indexA;
    });
  }

  /**
   * Sort by file
   */
  static byFile(issues, ascending = true) {
    return [...issues].sort((a, b) => {
      const compare = a.file.localeCompare(b.file);
      return ascending ? compare : -compare;
    });
  }

  /**
   * Sort by line number
   */
  static byLine(issues, ascending = true) {
    return [...issues].sort((a, b) => {
      const compare = a.startLine - b.startLine;
      return ascending ? compare : -compare;
    });
  }

  /**
   * Sort by category
   */
  static byCategory(issues, ascending = true) {
    return [...issues].sort((a, b) => {
      const compare = a.category.localeCompare(b.category);
      return ascending ? compare : -compare;
    });
  }

  /**
   * Multi-level sort
   */
  static multiSort(issues, sortRules) {
    return [...issues].sort((a, b) => {
      for (const rule of sortRules) {
        const { field, descending = false } = rule;
        let compare = 0;

        if (field === 'priority') {
          compare = a.priority - b.priority;
        } else if (field === 'severity') {
          const orderA = SEVERITY_LEVELS.indexOf(a.severity);
          const orderB = SEVERITY_LEVELS.indexOf(b.severity);
          compare = orderB - orderA; // Note: reversed for severity
        } else if (field === 'line') {
          compare = a.startLine - b.startLine;
        } else if (typeof a[field] === 'string') {
          compare = a[field].localeCompare(b[field]);
        } else if (typeof a[field] === 'number') {
          compare = a[field] - b[field];
        }

        if (compare !== 0) {
          return descending ? -compare : compare;
        }
      }
      return 0;
    });
  }
}

/**
 * Categorization rules database
 */
class CategorizationRules {
  constructor() {
    this.rules = this.loadDefaultRules();
  }

  loadDefaultRules() {
    return {
      // Security pattern matching
      security: {
        patterns: [
          { pattern: /eval\s*\(/i, severity: 'ERROR', category: 'SECURITY' },
          { pattern: /innerHTML\s*=/i, severity: 'WARNING', category: 'SECURITY' },
          { pattern: /document\.write/i, severity: 'WARNING', category: 'SECURITY' },
          { pattern: /dangerouslySetInnerHTML/i, severity: 'WARNING', category: 'SECURITY' },
          { pattern: /password|secret|api[_-]?key/i, severity: 'CRITICAL', category: 'SECURITY' }
        ]
      },

      // Performance pattern matching
      performance: {
        patterns: [
          { pattern: /for.*of.*await/i, severity: 'WARNING', category: 'PERFORMANCE' },
          { pattern: /console\.(log|debug|info)/i, severity: 'INFO', category: 'PERFORMANCE' }
        ]
      },

      // Severity escalation rules
      severityEscalation: {
        'SECURITY': 'ERROR',        // Security issues are at least ERROR
        'ACCESSIBILITY': 'WARNING',  // A11y issues are at least WARNING
        'BUG': 'WARNING'            // Bugs are at least WARNING
      }
    };
  }

  /**
   * Get applicable rules for an issue
   */
  getApplicableRules(issue) {
    const applicable = [];

    // Check security patterns
    for (const rule of this.rules.security.patterns) {
      if (rule.pattern.test(issue.message || '') || 
          rule.pattern.test(issue.title || '')) {
        applicable.push(rule);
      }
    }

    // Check performance patterns
    for (const rule of this.rules.performance.patterns) {
      if (rule.pattern.test(issue.message || '') || 
          rule.pattern.test(issue.title || '')) {
        applicable.push(rule);
      }
    }

    return applicable;
  }
}

module.exports = {
  IssueCategorizationEngine,
  IssueFilterEngine,
  IssueSortEngine,
  CategorizationRules
};

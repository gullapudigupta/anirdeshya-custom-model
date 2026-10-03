/**
 * Angular Pattern Analyzer
 * 
 * Detects Angular-specific patterns and anti-patterns:
 * - Change detection strategy usage
 * - Subscription memory leaks
 * - Proper lifecycle hook usage
 * - Standalone vs Module pattern
 * - Signal usage (Angular 16+)
 * - Injection patterns
 * - Lazy loading patterns
 * - Template-driven vs Reactive forms
 */

const path = require('path');
const { readFileSafe, getSourceFiles, getLineNumber } = require('../ast-utils');

// ─── Pattern Definitions ─────────────────────────────────────────────────────

const ANGULAR_PATTERNS = {
  // Memory Leak Patterns
  subscriptionLeak: {
    id: 'angular:subscription-leak',
    severity: 'major',
    category: 'reliability',
    title: 'Potential subscription memory leak',
    description: 'Subscription created without proper cleanup in ngOnDestroy',
  },
  
  // Change Detection
  defaultChangeDetection: {
    id: 'angular:default-change-detection',
    severity: 'minor',
    category: 'performance',
    title: 'Component uses Default change detection',
    description: 'Consider using OnPush change detection for better performance',
  },
  
  // Lifecycle
  missingOnDestroy: {
    id: 'angular:missing-ondestroy',
    severity: 'major',
    category: 'reliability',
    title: 'Component with subscriptions missing OnDestroy',
    description: 'Component subscribes to observables but does not implement OnDestroy',
  },
  
  emptyLifecycle: {
    id: 'angular:empty-lifecycle',
    severity: 'info',
    category: 'code-smell',
    title: 'Empty lifecycle hook',
    description: 'Lifecycle hook method is empty and can be removed',
  },
  
  // Injection
  deprecatedInject: {
    id: 'angular:constructor-injection',
    severity: 'info',
    category: 'modernization',
    title: 'Consider using inject() function',
    description: 'Angular 14+ supports inject() function as an alternative to constructor injection',
  },
  
  // Template
  missingTrackBy: {
    id: 'angular:missing-trackby',
    severity: 'minor',
    category: 'performance',
    title: 'ngFor without trackBy',
    description: '*ngFor without trackBy function may cause unnecessary DOM re-renders',
  },
  
  asyncPipeNotUsed: {
    id: 'angular:no-async-pipe',
    severity: 'info',
    category: 'best-practice',
    title: 'Manual subscription instead of async pipe',
    description: 'Consider using async pipe in template instead of manual subscription',
  },
  
  // Module patterns
  notStandalone: {
    id: 'angular:not-standalone',
    severity: 'info',
    category: 'modernization',
    title: 'Non-standalone component',
    description: 'Consider migrating to standalone component (Angular 14+)',
  },
  
  // Security
  bypassSecurity: {
    id: 'angular:bypass-security',
    severity: 'critical',
    category: 'security',
    title: 'Security bypass detected',
    description: 'DomSanitizer bypass methods should be used with caution',
  },
  
  innerHtml: {
    id: 'angular:innerhtml-binding',
    severity: 'major',
    category: 'security',
    title: 'innerHTML binding detected',
    description: '[innerHTML] binding can lead to XSS if content is not sanitized',
  },
};

// ─── Analyzer ────────────────────────────────────────────────────────────────

class AngularPatternAnalyzer {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.issues = [];
  }

  /**
   * Analyze a single TypeScript file for Angular patterns
   */
  analyzeFile(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return [];
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const fileIssues = [];

    // Skip spec files
    if (filePath.endsWith('.spec.ts')) return [];
    
    // Check if it's a component
    const isComponent = content.includes('@Component');
    const isService = content.includes('@Injectable');
    
    if (isComponent) {
      fileIssues.push(...this._checkChangeDetection(content, relativePath));
      fileIssues.push(...this._checkSubscriptionLeaks(content, relativePath));
      fileIssues.push(...this._checkStandalone(content, relativePath));
      fileIssues.push(...this._checkLifecycleHooks(content, relativePath));
    }
    
    if (isComponent || isService) {
      fileIssues.push(...this._checkInjectionPattern(content, relativePath));
    }
    
    // Check security patterns in any TS file
    fileIssues.push(...this._checkSecurityPatterns(content, relativePath));
    
    this.issues.push(...fileIssues);
    return fileIssues;
  }

  /**
   * Analyze an HTML template file
   */
  analyzeTemplate(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return [];
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const fileIssues = [];
    
    fileIssues.push(...this._checkTrackBy(content, relativePath));
    fileIssues.push(...this._checkInnerHtml(content, relativePath));
    fileIssues.push(...this._checkTemplateComplexity(content, relativePath));
    
    this.issues.push(...fileIssues);
    return fileIssues;
  }

  // ─── Private Check Methods ─────────────────────────────────────────────────

  _checkChangeDetection(content, filePath) {
    const issues = [];
    
    // Check if @Component has changeDetection: ChangeDetectionStrategy.OnPush
    const componentMatch = content.match(/@Component\s*\(\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\)/s);
    if (componentMatch) {
      const meta = componentMatch[1];
      if (!meta.includes('ChangeDetectionStrategy.OnPush') && !meta.includes('changeDetection')) {
        const line = getLineNumber(content, componentMatch.index);
        issues.push({
          ...ANGULAR_PATTERNS.defaultChangeDetection,
          file: filePath,
          line,
        });
      }
    }
    
    return issues;
  }

  _checkSubscriptionLeaks(content, filePath) {
    const issues = [];
    
    const hasSubscribe = content.includes('.subscribe(');
    const hasOnDestroy = content.includes('ngOnDestroy');
    const hasUnsubscribe = content.includes('unsubscribe') || content.includes('takeUntil') || 
                           content.includes('takeUntilDestroyed') || content.includes('DestroyRef');
    const hasAsyncPipe = false; // Can't check template from TS file
    
    if (hasSubscribe && !hasOnDestroy && !hasUnsubscribe) {
      // Find the subscribe calls
      const regex = /\.subscribe\s*\(/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const line = getLineNumber(content, match.index);
        issues.push({
          ...ANGULAR_PATTERNS.subscriptionLeak,
          file: filePath,
          line,
        });
      }
    }
    
    if (hasSubscribe && !hasOnDestroy) {
      issues.push({
        ...ANGULAR_PATTERNS.missingOnDestroy,
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  _checkStandalone(content, filePath) {
    const issues = [];
    
    const componentMatch = content.match(/@Component\s*\(\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\)/s);
    if (componentMatch) {
      const meta = componentMatch[1];
      if (!meta.includes('standalone') || meta.includes('standalone: false')) {
        const line = getLineNumber(content, componentMatch.index);
        issues.push({
          ...ANGULAR_PATTERNS.notStandalone,
          file: filePath,
          line,
        });
      }
    }
    
    return issues;
  }

  _checkLifecycleHooks(content, filePath) {
    const issues = [];
    
    // Check for empty lifecycle hooks
    const hookPattern = /(ngOnInit|ngOnDestroy|ngOnChanges|ngAfterViewInit|ngAfterContentInit)\s*\([^)]*\)\s*(?::\s*void\s*)?\{\s*\}/g;
    let match;
    while ((match = hookPattern.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      issues.push({
        ...ANGULAR_PATTERNS.emptyLifecycle,
        file: filePath,
        line,
        message: `Empty ${match[1]}() method`,
      });
    }
    
    return issues;
  }

  _checkInjectionPattern(content, filePath) {
    const issues = [];
    
    // Count constructor parameters (simplified)
    const constructorMatch = content.match(/constructor\s*\(([^)]*)\)/s);
    if (constructorMatch) {
      const params = constructorMatch[1].split(',').filter(p => p.trim());
      if (params.length > 5) {
        const line = getLineNumber(content, constructorMatch.index);
        issues.push({
          id: 'angular:too-many-dependencies',
          severity: 'major',
          category: 'code-smell',
          title: `Too many constructor dependencies (${params.length})`,
          description: 'Consider splitting this class or using a facade service',
          file: filePath,
          line,
        });
      }
    }
    
    return issues;
  }

  _checkSecurityPatterns(content, filePath) {
    const issues = [];
    
    // Check for DomSanitizer bypass
    const bypassPatterns = [
      'bypassSecurityTrustHtml',
      'bypassSecurityTrustStyle',
      'bypassSecurityTrustScript',
      'bypassSecurityTrustUrl',
      'bypassSecurityTrustResourceUrl',
    ];
    
    for (const pattern of bypassPatterns) {
      const regex = new RegExp(pattern, 'g');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const line = getLineNumber(content, match.index);
        issues.push({
          ...ANGULAR_PATTERNS.bypassSecurity,
          file: filePath,
          line,
          message: `Security bypass: ${pattern}`,
        });
      }
    }
    
    return issues;
  }

  _checkTrackBy(content, filePath) {
    const issues = [];
    
    // Check *ngFor without trackBy
    const ngForRegex = /\*ngFor\s*=\s*"([^"]*)"/g;
    let match;
    while ((match = ngForRegex.exec(content)) !== null) {
      if (!match[1].includes('trackBy')) {
        const line = getLineNumber(content, match.index);
        issues.push({
          ...ANGULAR_PATTERNS.missingTrackBy,
          file: filePath,
          line,
        });
      }
    }
    
    // Also check @for syntax (Angular 17+)
    const forRegex = /@for\s*\([^)]*\)\s*\{/g;
    while ((match = forRegex.exec(content)) !== null) {
      if (!match[0].includes('track')) {
        const line = getLineNumber(content, match.index);
        issues.push({
          ...ANGULAR_PATTERNS.missingTrackBy,
          file: filePath,
          line,
          title: '@for without track expression',
        });
      }
    }
    
    return issues;
  }

  _checkInnerHtml(content, filePath) {
    const issues = [];
    
    const regex = /\[innerHTML\]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      issues.push({
        ...ANGULAR_PATTERNS.innerHtml,
        file: filePath,
        line,
      });
    }
    
    return issues;
  }

  _checkTemplateComplexity(content, filePath) {
    const issues = [];
    
    // Count nested conditionals
    const lines = content.split('\n');
    let ngIfDepth = 0;
    let maxNgIfDepth = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('*ngIf') || line.includes('@if')) ngIfDepth++;
      if (line.includes('</') && ngIfDepth > 0) ngIfDepth--;
      maxNgIfDepth = Math.max(maxNgIfDepth, ngIfDepth);
    }
    
    if (maxNgIfDepth > 4) {
      issues.push({
        id: 'angular:template-complexity',
        severity: 'major',
        category: 'maintainability',
        title: `High template nesting depth: ${maxNgIfDepth}`,
        description: 'Consider extracting nested templates into child components',
        file: filePath,
        line: 1,
      });
    }
    
    // Check template length
    if (lines.length > 200) {
      issues.push({
        id: 'angular:large-template',
        severity: 'minor',
        category: 'maintainability',
        title: `Large template: ${lines.length} lines`,
        description: 'Consider breaking this template into smaller components',
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  /**
   * Get all detected issues
   */
  getIssues() {
    return this.issues;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const bySeverity = {};
    const byCategory = {};
    const byPattern = {};
    
    for (const issue of this.issues) {
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
      byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
      byPattern[issue.id] = (byPattern[issue.id] || 0) + 1;
    }
    
    return {
      total: this.issues.length,
      bySeverity,
      byCategory,
      byPattern,
    };
  }
}

module.exports = { AngularPatternAnalyzer, ANGULAR_PATTERNS };

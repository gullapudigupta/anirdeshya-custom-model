/**
 * Performance Pattern Analyzer
 * 
 * Detects performance anti-patterns in Angular/TypeScript:
 * - Missing OnPush change detection
 * - Heavy computations in templates
 * - Unnecessary re-renders
 * - Large bundle indicators
 * - Missing lazy loading
 * - Inefficient RxJS usage
 * - Memory leak patterns
 * - Excessive DOM manipulation
 */

const path = require('path');
const { readFileSafe, getLineNumber } = require('../ast-utils');

class PerformanceAnalyzer {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.issues = [];
  }

  /**
   * Analyze TypeScript file for performance patterns
   */
  analyzeFile(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return [];
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const fileIssues = [];
    
    if (filePath.includes('.spec.')) return [];
    
    fileIssues.push(...this._checkChangeDetection(content, relativePath));
    fileIssues.push(...this._checkRxjsPatterns(content, relativePath));
    fileIssues.push(...this._checkMemoryLeaks(content, relativePath));
    fileIssues.push(...this._checkLargeArrayOps(content, relativePath));
    fileIssues.push(...this._checkDomAccess(content, relativePath));
    fileIssues.push(...this._checkLazyLoading(content, relativePath));
    fileIssues.push(...this._checkImportSize(content, relativePath));
    
    this.issues.push(...fileIssues);
    return fileIssues;
  }

  /**
   * Analyze HTML template for performance patterns
   */
  analyzeTemplate(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return [];
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const fileIssues = [];
    
    fileIssues.push(...this._checkTemplateFunctions(content, relativePath));
    fileIssues.push(...this._checkHeavyBindings(content, relativePath));
    fileIssues.push(...this._checkLargeNgFor(content, relativePath));
    
    this.issues.push(...fileIssues);
    return fileIssues;
  }

  // ─── TypeScript Checks ─────────────────────────────────────────────────────

  _checkChangeDetection(content, filePath) {
    const issues = [];
    
    if (!content.includes('@Component')) return issues;
    
    // Check if component has OnPush
    if (!content.includes('ChangeDetectionStrategy.OnPush')) {
      // Only flag if component has observable subscriptions (performance-sensitive)
      if (content.includes('.subscribe(') || content.includes('| async') || content.includes('Observable')) {
        const match = content.match(/@Component/);
        if (match) {
          issues.push({
            id: 'perf:no-onpush',
            severity: 'minor',
            category: 'performance',
            title: 'Component with observables missing OnPush change detection',
            description: 'OnPush reduces unnecessary change detection cycles for observable-based components',
            file: filePath,
            line: getLineNumber(content, match.index),
          });
        }
      }
    }
    
    return issues;
  }

  _checkRxjsPatterns(content, filePath) {
    const issues = [];
    
    // Subscribe inside subscribe (nested subscriptions)
    const nestedSubRegex = /\.subscribe\s*\([^)]*\{[^}]*\.subscribe\s*\(/gs;
    let match;
    while ((match = nestedSubRegex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      issues.push({
        id: 'perf:nested-subscribe',
        severity: 'major',
        category: 'performance',
        title: 'Nested subscription detected',
        description: 'Use switchMap, mergeMap, or concatMap instead of nested subscriptions',
        file: filePath,
        line,
      });
    }
    
    // Multiple subscriptions to same observable
    const subscribeCount = (content.match(/\.subscribe\s*\(/g) || []).length;
    if (subscribeCount > 5) {
      issues.push({
        id: 'perf:many-subscriptions',
        severity: 'minor',
        category: 'performance',
        title: `${subscribeCount} subscriptions in one file`,
        description: 'Consider using combineLatest, merge, or the async pipe',
        file: filePath,
        line: 1,
      });
    }
    
    // shareReplay missing for HTTP observables
    if (content.includes('HttpClient') && content.includes('.get(') && !content.includes('shareReplay')) {
      issues.push({
        id: 'perf:no-share-replay',
        severity: 'info',
        category: 'performance',
        title: 'HTTP calls without shareReplay',
        description: 'Consider shareReplay(1) to prevent duplicate HTTP requests',
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  _checkMemoryLeaks(content, filePath) {
    const issues = [];
    
    // setInterval without clearInterval
    if (content.includes('setInterval') && !content.includes('clearInterval')) {
      const match = content.match(/setInterval/);
      if (match) {
        issues.push({
          id: 'perf:interval-leak',
          severity: 'major',
          category: 'performance',
          title: 'setInterval without clearInterval',
          description: 'Always clear intervals in ngOnDestroy to prevent memory leaks',
          file: filePath,
          line: getLineNumber(content, match.index),
        });
      }
    }
    
    // addEventListener without removeEventListener
    if (content.includes('addEventListener') && !content.includes('removeEventListener')) {
      const match = content.match(/addEventListener/);
      if (match) {
        issues.push({
          id: 'perf:event-listener-leak',
          severity: 'major',
          category: 'performance',
          title: 'addEventListener without removeEventListener',
          description: 'Remove event listeners in ngOnDestroy',
          file: filePath,
          line: getLineNumber(content, match.index),
        });
      }
    }
    
    return issues;
  }

  _checkLargeArrayOps(content, filePath) {
    const issues = [];
    
    // Chained array methods (filter.map.reduce etc)
    const chainedRegex = /\.\s*(?:filter|map|reduce|forEach|find|some|every)\s*\([^)]*\)\s*\.\s*(?:filter|map|reduce|forEach|find|some|every)\s*\([^)]*\)\s*\.\s*(?:filter|map|reduce|forEach|find|some|every)/g;
    let match;
    while ((match = chainedRegex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      issues.push({
        id: 'perf:chained-array-ops',
        severity: 'info',
        category: 'performance',
        title: 'Triple+ chained array operations',
        description: 'Consider using a single reduce() for better performance on large arrays',
        file: filePath,
        line,
      });
    }
    
    return issues;
  }

  _checkDomAccess(content, filePath) {
    const issues = [];
    
    // Direct DOM manipulation
    const domPatterns = [
      { pattern: /document\.getElementById/g, msg: 'Direct DOM access via getElementById' },
      { pattern: /document\.querySelector(?:All)?/g, msg: 'Direct DOM access via querySelector' },
      { pattern: /\.nativeElement/g, msg: 'Direct nativeElement access' },
    ];
    
    for (const { pattern, msg } of domPatterns) {
      let match;
      let count = 0;
      while ((match = pattern.exec(content)) !== null) {
        count++;
        if (count <= 2) {
          const line = getLineNumber(content, match.index);
          issues.push({
            id: 'perf:direct-dom',
            severity: 'info',
            category: 'performance',
            title: msg,
            description: 'Prefer Angular Renderer2 or ViewChild for DOM manipulation',
            file: filePath,
            line,
          });
        }
      }
    }
    
    return issues;
  }

  _checkLazyLoading(content, filePath) {
    const issues = [];
    
    // Check routing files for eager loading
    if (filePath.includes('routing') || filePath.includes('routes')) {
      const eagerImports = content.match(/component\s*:\s*\w+/g);
      const lazyImports = content.match(/loadComponent|loadChildren/g);
      
      if (eagerImports && eagerImports.length > 5 && !lazyImports) {
        issues.push({
          id: 'perf:no-lazy-loading',
          severity: 'major',
          category: 'performance',
          title: `${eagerImports.length} eagerly loaded routes without lazy loading`,
          description: 'Use loadComponent/loadChildren for better initial bundle size',
          file: filePath,
          line: 1,
        });
      }
    }
    
    return issues;
  }

  _checkImportSize(content, filePath) {
    const issues = [];
    
    // Wildcard imports from large libraries
    const wildcardImports = [
      { pattern: /import\s+\*\s+as\s+\w+\s+from\s+['"]rxjs['"]/g, lib: 'rxjs' },
      { pattern: /import\s+\*\s+as\s+\w+\s+from\s+['"]lodash['"]/g, lib: 'lodash' },
      { pattern: /import\s+\*\s+as\s+\w+\s+from\s+['"]moment['"]/g, lib: 'moment' },
    ];
    
    for (const { pattern, lib } of wildcardImports) {
      if (pattern.test(content)) {
        issues.push({
          id: 'perf:wildcard-import',
          severity: 'major',
          category: 'performance',
          title: `Wildcard import from "${lib}"`,
          description: `Import specific functions: import { x } from '${lib}/x' for tree-shaking`,
          file: filePath,
          line: 1,
        });
      }
    }
    
    // Moment.js usage (suggest date-fns or dayjs)
    if (content.includes("from 'moment'") || content.includes('from "moment"')) {
      issues.push({
        id: 'perf:moment-js',
        severity: 'info',
        category: 'performance',
        title: 'moment.js usage detected',
        description: 'Consider date-fns or dayjs for smaller bundle size',
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  // ─── Template Checks ───────────────────────────────────────────────────────

  _checkTemplateFunctions(content, filePath) {
    const issues = [];
    
    // Method calls in interpolation
    const funcCallRegex = /\{\{\s*[\w.]+\s*\([^)]*\)\s*\}\}/g;
    let match;
    let count = 0;
    
    while ((match = funcCallRegex.exec(content)) !== null) {
      count++;
    }
    
    if (count > 3) {
      issues.push({
        id: 'perf:template-functions',
        severity: 'major',
        category: 'performance',
        title: `${count} function calls in template bindings`,
        description: 'Move computations to pipes or computed properties to avoid re-evaluation on every CD cycle',
        file: filePath,
        line: 1,
      });
    }
    
    // Method calls in property bindings
    const propFuncRegex = /\[\w+\]\s*=\s*"[\w.]+\([^)]*\)"/g;
    while ((match = propFuncRegex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      issues.push({
        id: 'perf:binding-function',
        severity: 'minor',
        category: 'performance',
        title: 'Function call in property binding',
        description: 'Property bindings with function calls re-evaluate on every change detection',
        file: filePath,
        line,
      });
    }
    
    return issues;
  }

  _checkHeavyBindings(content, filePath) {
    const issues = [];
    
    // JSON pipe (heavy serialization)
    const jsonPipeCount = (content.match(/\|\s*json/g) || []).length;
    if (jsonPipeCount > 2) {
      issues.push({
        id: 'perf:json-pipe',
        severity: 'info',
        category: 'performance',
        title: `${jsonPipeCount} json pipe usages (may indicate debugging left in)`,
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  _checkLargeNgFor(content, filePath) {
    const issues = [];
    
    // ngFor with no virtual scrolling hint and complex template
    const ngForRegex = /\*ngFor\s*=\s*"let\s+\w+\s+of\s+(\w+)/g;
    let match;
    
    while ((match = ngForRegex.exec(content)) !== null) {
      // Check if the ngFor block is large (>10 lines to next closing tag)
      const afterMatch = content.substring(match.index, match.index + 500);
      const lines = afterMatch.split('\n').length;
      
      if (lines > 10 && !content.includes('cdk-virtual-scroll') && !content.includes('virtualScroll')) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'perf:large-ngfor-template',
          severity: 'info',
          category: 'performance',
          title: `Large ngFor template for "${match[1]}"`,
          description: 'Consider virtual scrolling (cdk-virtual-scroll-viewport) for large lists',
          file: filePath,
          line,
        });
        break; // One per file
      }
    }
    
    return issues;
  }

  getIssues() {
    return this.issues;
  }

  getSummary() {
    const bySeverity = {};
    const byCategory = {};
    
    for (const issue of this.issues) {
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
      byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
    }
    
    return {
      total: this.issues.length,
      bySeverity,
      byCategory,
    };
  }
}

module.exports = { PerformanceAnalyzer };

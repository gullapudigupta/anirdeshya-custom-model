/**
 * HTML Template Analyzer
 * 
 * Analyzes Angular HTML templates for:
 * - Accessibility (a11y) compliance
 * - Structural complexity
 * - Performance patterns (trackBy, async pipe)
 * - Angular best practices
 * - Component communication patterns
 * - Template size and maintainability
 */

const path = require('path');
const { readFileSafe, getLineNumber, countLines } = require('../ast-utils');

// ─── Template Analyzer ───────────────────────────────────────────────────────

class TemplateAnalyzer {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.issues = [];
    this.metrics = {
      totalTemplates: 0,
      totalLines: 0,
      totalBindings: 0,
      totalDirectives: 0,
      a11yIssues: 0,
    };
  }

  /**
   * Analyze an HTML template file
   */
  analyzeFile(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return [];
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const fileIssues = [];
    
    this.metrics.totalTemplates++;
    this.metrics.totalLines += countLines(content);
    
    fileIssues.push(...this._checkAccessibility(content, relativePath));
    fileIssues.push(...this._checkPerformance(content, relativePath));
    fileIssues.push(...this._checkBestPractices(content, relativePath));
    fileIssues.push(...this._checkTemplateSize(content, relativePath));
    fileIssues.push(...this._checkBindings(content, relativePath));
    
    this.issues.push(...fileIssues);
    return fileIssues;
  }

  // ─── Accessibility Checks ──────────────────────────────────────────────────

  _checkAccessibility(content, filePath) {
    const issues = [];
    
    // Images without alt text
    const imgRegex = /<img\b[^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
      if (!match[0].includes('alt=') && !match[0].includes('[alt]')) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'a11y:img-alt',
          severity: 'major',
          category: 'accessibility',
          title: 'Image missing alt attribute',
          description: 'Add alt text for screen readers',
          file: filePath,
          line,
        });
        this.metrics.a11yIssues++;
      }
    }
    
    // Buttons without accessible text
    const buttonRegex = /<(?:button|ion-button)\b[^>]*>(?:\s*<(?:ion-icon|mat-icon|i)\b[^>]*>[^<]*<\/(?:ion-icon|mat-icon|i)>\s*)<\/(?:button|ion-button)>/gi;
    while ((match = buttonRegex.exec(content)) !== null) {
      if (!match[0].includes('aria-label') && !match[0].includes('[attr.aria-label]')) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'a11y:button-label',
          severity: 'major',
          category: 'accessibility',
          title: 'Icon-only button missing aria-label',
          description: 'Add aria-label for screen reader users',
          file: filePath,
          line,
        });
        this.metrics.a11yIssues++;
      }
    }
    
    // Click events without keyboard events
    const clickRegex = /\(click\)\s*=/g;
    while ((match = clickRegex.exec(content)) !== null) {
      const surroundingContent = content.substring(Math.max(0, match.index - 100), match.index + 100);
      if (!surroundingContent.includes('(keydown') && !surroundingContent.includes('(keyup') && 
          !surroundingContent.includes('(keypress') && !surroundingContent.includes('button') &&
          !surroundingContent.includes('<a ')) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'a11y:click-keyboard',
          severity: 'minor',
          category: 'accessibility',
          title: 'Click event without keyboard equivalent',
          description: 'Ensure interactive elements are keyboard accessible',
          file: filePath,
          line,
        });
        this.metrics.a11yIssues++;
      }
    }
    
    // Form inputs without labels
    const inputRegex = /<input\b[^>]*>/gi;
    while ((match = inputRegex.exec(content)) !== null) {
      if (!match[0].includes('aria-label') && !match[0].includes('[attr.aria-label]') && 
          !match[0].includes('type="hidden"') && !match[0].includes('type="submit"')) {
        // Check if there's a label nearby (within 200 chars before)
        const before = content.substring(Math.max(0, match.index - 200), match.index);
        if (!before.includes('<label') && !before.includes('mat-label') && !before.includes('ion-label')) {
          const line = getLineNumber(content, match.index);
          issues.push({
            id: 'a11y:input-label',
            severity: 'minor',
            category: 'accessibility',
            title: 'Input may be missing associated label',
            description: 'Associate a label with the input or use aria-label',
            file: filePath,
            line,
          });
          this.metrics.a11yIssues++;
        }
      }
    }
    
    // Missing role attributes on custom interactive elements
    const divClickRegex = /<div\b[^>]*\(click\)[^>]*>/gi;
    while ((match = divClickRegex.exec(content)) !== null) {
      if (!match[0].includes('role=')) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'a11y:div-click-role',
          severity: 'major',
          category: 'accessibility',
          title: 'Clickable div without role attribute',
          description: 'Use a button element or add role="button" with tabindex',
          file: filePath,
          line,
        });
        this.metrics.a11yIssues++;
      }
    }
    
    // Headings hierarchy (check for skipped levels)
    const headings = [];
    const headingRegex = /<h([1-6])\b/gi;
    while ((match = headingRegex.exec(content)) !== null) {
      headings.push({ level: parseInt(match[1]), line: getLineNumber(content, match.index) });
    }
    
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level - headings[i - 1].level > 1) {
        issues.push({
          id: 'a11y:heading-skip',
          severity: 'minor',
          category: 'accessibility',
          title: `Heading level skipped: h${headings[i - 1].level} → h${headings[i].level}`,
          description: 'Headings should not skip levels',
          file: filePath,
          line: headings[i].line,
        });
        this.metrics.a11yIssues++;
      }
    }
    
    return issues;
  }

  // ─── Performance Checks ────────────────────────────────────────────────────

  _checkPerformance(content, filePath) {
    const issues = [];
    
    // ngFor without trackBy
    const ngForRegex = /\*ngFor\s*=\s*"([^"]*)"/g;
    let match;
    while ((match = ngForRegex.exec(content)) !== null) {
      if (!match[1].includes('trackBy')) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'perf:missing-trackby',
          severity: 'minor',
          category: 'performance',
          title: '*ngFor without trackBy',
          description: 'Add trackBy function to avoid unnecessary DOM recreation',
          file: filePath,
          line,
        });
      }
    }
    
    // @for without track (Angular 17+)
    const forRegex = /@for\s*\(([^)]*)\)/g;
    while ((match = forRegex.exec(content)) !== null) {
      // In @for, track is required but check if it's present
      const forBlock = content.substring(match.index, match.index + 200);
      if (!forBlock.includes('track ')) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'perf:for-missing-track',
          severity: 'minor',
          category: 'performance',
          title: '@for block may be missing track expression',
          file: filePath,
          line,
        });
      }
    }
    
    // Function calls in templates (expensive in change detection)
    const funcCallRegex = /\{\{\s*\w+\s*\([^)]*\)\s*\}\}/g;
    let funcCallCount = 0;
    while ((match = funcCallRegex.exec(content)) !== null) {
      funcCallCount++;
      if (funcCallCount <= 3) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'perf:function-in-template',
          severity: 'minor',
          category: 'performance',
          title: 'Function call in template interpolation',
          description: 'Function calls are evaluated on every change detection cycle. Consider using a pipe or getter.',
          file: filePath,
          line,
        });
      }
    }
    
    if (funcCallCount > 3) {
      issues.push({
        id: 'perf:many-function-calls',
        severity: 'major',
        category: 'performance',
        title: `${funcCallCount} function calls in template`,
        description: 'Multiple function calls in template significantly impact performance',
        file: filePath,
        line: 1,
      });
    }
    
    // Heavy property access chains
    const chainRegex = /\{\{[^}]*(?:\?\.)(?:[^}]*\?.){2,}[^}]*\}\}/g;
    while ((match = chainRegex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      issues.push({
        id: 'perf:deep-property-chain',
        severity: 'info',
        category: 'performance',
        title: 'Deep property chain in template',
        description: 'Consider using a computed property or pipe for deep object access',
        file: filePath,
        line,
      });
    }
    
    return issues;
  }

  // ─── Best Practices ────────────────────────────────────────────────────────

  _checkBestPractices(content, filePath) {
    const issues = [];
    
    // Inline styles
    const inlineStyleRegex = /style\s*=\s*["'][^"']+["']/g;
    let match;
    let inlineCount = 0;
    
    while ((match = inlineStyleRegex.exec(content)) !== null) {
      inlineCount++;
      if (inlineCount <= 2) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'tmpl:inline-style',
          severity: 'minor',
          category: 'best-practice',
          title: 'Inline style attribute',
          description: 'Prefer [ngStyle], [class], or CSS classes',
          file: filePath,
          line,
        });
      }
    }
    
    if (inlineCount > 2) {
      issues.push({
        id: 'tmpl:many-inline-styles',
        severity: 'major',
        category: 'best-practice',
        title: `${inlineCount} inline styles in template`,
        file: filePath,
        line: 1,
      });
    }
    
    // Complex expressions in event bindings
    const complexEventRegex = /\((?:click|change|input|submit)\)\s*=\s*"([^"]+)"/g;
    while ((match = complexEventRegex.exec(content)) !== null) {
      const expression = match[1];
      if (expression.includes(';') || expression.includes('&&') || expression.includes('?')) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'tmpl:complex-event-binding',
          severity: 'minor',
          category: 'best-practice',
          title: 'Complex expression in event binding',
          description: 'Move complex logic to a component method',
          file: filePath,
          line,
        });
      }
    }
    
    // Nested subscriptions indicator (multiple async pipes on same observable)
    const asyncPipeCount = (content.match(/\|\s*async/g) || []).length;
    this.metrics.totalBindings += asyncPipeCount;
    
    return issues;
  }

  // ─── Template Size ─────────────────────────────────────────────────────────

  _checkTemplateSize(content, filePath) {
    const issues = [];
    const lines = countLines(content);
    
    if (lines > 200) {
      issues.push({
        id: 'tmpl:large-template',
        severity: 'major',
        category: 'maintainability',
        title: `Large template: ${lines} lines`,
        description: 'Consider splitting into child components',
        file: filePath,
        line: 1,
      });
    } else if (lines > 100) {
      issues.push({
        id: 'tmpl:moderate-template',
        severity: 'minor',
        category: 'maintainability',
        title: `Moderately large template: ${lines} lines`,
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  // ─── Binding Analysis ──────────────────────────────────────────────────────

  _checkBindings(content, filePath) {
    const issues = [];
    
    // Count various binding types
    const propertyBindings = (content.match(/\[\w+\]/g) || []).length;
    const eventBindings = (content.match(/\(\w+\)/g) || []).length;
    const twoWayBindings = (content.match(/\[\(\w+\)\]/g) || []).length;
    const interpolations = (content.match(/\{\{[^}]+\}\}/g) || []).length;
    
    this.metrics.totalBindings += propertyBindings + eventBindings + twoWayBindings + interpolations;
    
    // Count directives
    const ngIf = (content.match(/\*ngIf|\@if/g) || []).length;
    const ngFor = (content.match(/\*ngFor|\@for/g) || []).length;
    const ngSwitch = (content.match(/\[ngSwitch\]|\@switch/g) || []).length;
    
    this.metrics.totalDirectives += ngIf + ngFor + ngSwitch;
    
    // Excessive bindings per template
    const totalBindings = propertyBindings + eventBindings + twoWayBindings + interpolations;
    if (totalBindings > 50) {
      issues.push({
        id: 'tmpl:excessive-bindings',
        severity: 'minor',
        category: 'performance',
        title: `High binding count: ${totalBindings} bindings`,
        description: 'Many bindings can impact change detection performance',
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  /**
   * Get all issues
   */
  getIssues() {
    return this.issues;
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return this.metrics;
  }

  /**
   * Get summary
   */
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
      metrics: this.metrics,
    };
  }
}

module.exports = { TemplateAnalyzer };

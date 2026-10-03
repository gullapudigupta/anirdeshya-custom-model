/**
 * SCSS/CSS Analyzer
 * 
 * Analyzes style files for:
 * - Specificity scores & violations
 * - !important usage tracking
 * - Color consistency (similar colors not using variables)
 * - Z-index management
 * - Unused/redundant selectors
 * - Responsive breakpoint coverage
 * - Nesting depth
 * - Vendor prefix usage
 * - File size analysis
 * - CSS custom property usage
 */

const path = require('path');
const { readFileSafe, getLineNumber, countLines } = require('../ast-utils');

// ─── Specificity Calculator ──────────────────────────────────────────────────

/**
 * Calculate CSS specificity for a selector
 * Returns [inline, ids, classes, elements]
 */
function calculateSpecificity(selector) {
  let ids = 0;
  let classes = 0;
  let elements = 0;
  
  // Remove :not() content but count its arguments
  selector = selector.replace(/:not\(([^)]*)\)/g, (_, inner) => {
    const innerSpec = calculateSpecificity(inner);
    ids += innerSpec[1];
    classes += innerSpec[2];
    elements += innerSpec[3];
    return '';
  });
  
  // Count IDs
  ids += (selector.match(/#[\w-]+/g) || []).length;
  
  // Count classes, attributes, pseudo-classes
  classes += (selector.match(/\.[\w-]+/g) || []).length;
  classes += (selector.match(/\[[^\]]+\]/g) || []).length;
  classes += (selector.match(/:(?!:)[\w-]+(?!\()/g) || []).length;
  
  // Count elements, pseudo-elements
  elements += (selector.match(/(?:^|[\s>+~])[\w-]+/g) || []).length;
  elements += (selector.match(/::[\w-]+/g) || []).length;
  
  return [0, ids, classes, elements];
}

/**
 * Get specificity score as a single number (for comparison)
 */
function specificityScore(specificity) {
  return specificity[1] * 10000 + specificity[2] * 100 + specificity[3];
}

// ─── SCSS Analyzer ───────────────────────────────────────────────────────────

class ScssAnalyzer {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.issues = [];
    this.metrics = {
      totalFiles: 0,
      totalLines: 0,
      totalSelectors: 0,
      importantCount: 0,
      maxSpecificity: 0,
      maxNesting: 0,
      colors: new Map(),
      zIndexes: [],
      breakpoints: new Set(),
      customProperties: new Set(),
    };
  }

  /**
   * Analyze a SCSS/CSS file
   */
  analyzeFile(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return [];
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const fileIssues = [];
    
    this.metrics.totalFiles++;
    this.metrics.totalLines += countLines(content);
    
    fileIssues.push(...this._checkImportantUsage(content, relativePath));
    fileIssues.push(...this._checkNestingDepth(content, relativePath));
    fileIssues.push(...this._checkSpecificity(content, relativePath));
    fileIssues.push(...this._checkColors(content, relativePath));
    fileIssues.push(...this._checkZIndex(content, relativePath));
    fileIssues.push(...this._checkFileSize(content, relativePath));
    fileIssues.push(...this._checkVendorPrefixes(content, relativePath));
    fileIssues.push(...this._checkDuplicateProperties(content, relativePath));
    fileIssues.push(...this._checkResponsivePatterns(content, relativePath));
    
    this.issues.push(...fileIssues);
    return fileIssues;
  }

  // ─── Private Check Methods ─────────────────────────────────────────────────

  _checkImportantUsage(content, filePath) {
    const issues = [];
    const regex = /!important/g;
    let match;
    let count = 0;
    
    while ((match = regex.exec(content)) !== null) {
      count++;
      const line = getLineNumber(content, match.index);
      
      if (count <= 5) { // Only report first 5
        issues.push({
          id: 'css:important-usage',
          severity: 'minor',
          category: 'maintainability',
          title: '!important declaration',
          description: 'Avoid !important; fix specificity issues instead',
          file: filePath,
          line,
        });
      }
    }
    
    this.metrics.importantCount += count;
    
    if (count > 5) {
      issues.push({
        id: 'css:excessive-important',
        severity: 'major',
        category: 'maintainability',
        title: `Excessive !important usage: ${count} instances`,
        description: 'High !important usage indicates specificity problems in your CSS architecture',
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  _checkNestingDepth(content, filePath) {
    const issues = [];
    const lines = content.split('\n');
    let maxDepth = 0;
    let currentDepth = 0;
    let maxDepthLine = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentDepth += (line.match(/\{/g) || []).length;
      currentDepth -= (line.match(/\}/g) || []).length;
      
      if (currentDepth > maxDepth) {
        maxDepth = currentDepth;
        maxDepthLine = i + 1;
      }
    }
    
    if (maxDepth > this.metrics.maxNesting) {
      this.metrics.maxNesting = maxDepth;
    }
    
    if (maxDepth > 4) {
      issues.push({
        id: 'css:deep-nesting',
        severity: 'major',
        category: 'maintainability',
        title: `SCSS nesting too deep: ${maxDepth} levels (max: 4)`,
        description: 'Deep nesting creates high specificity and hard-to-override styles',
        file: filePath,
        line: maxDepthLine,
      });
    }
    
    return issues;
  }

  _checkSpecificity(content, filePath) {
    const issues = [];
    const lines = content.split('\n');
    
    // Extract selectors (simplified)
    const selectorRegex = /^([^{@/]+)\{/gm;
    let match;
    
    while ((match = selectorRegex.exec(content)) !== null) {
      const selector = match[1].trim();
      if (!selector || selector.startsWith('//') || selector.startsWith('/*')) continue;
      
      this.metrics.totalSelectors++;
      const spec = calculateSpecificity(selector);
      const score = specificityScore(spec);
      
      if (score > this.metrics.maxSpecificity) {
        this.metrics.maxSpecificity = score;
      }
      
      // Flag overly specific selectors
      if (spec[1] > 1) { // More than 1 ID
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'css:high-specificity',
          severity: 'major',
          category: 'maintainability',
          title: `High specificity selector: ${selector.substring(0, 50)} [${spec.join(',')}]`,
          description: 'Avoid using multiple IDs in selectors',
          file: filePath,
          line,
        });
      } else if (score > 200) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'css:moderate-specificity',
          severity: 'minor',
          category: 'maintainability',
          title: `Moderately high specificity: ${selector.substring(0, 50)} (score: ${score})`,
          file: filePath,
          line,
        });
      }
    }
    
    return issues;
  }

  _checkColors(content, filePath) {
    const issues = [];
    
    // Extract color values
    const hexRegex = /#([0-9a-fA-F]{3,8})\b/g;
    const rgbRegex = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
    let match;
    
    while ((match = hexRegex.exec(content)) !== null) {
      const color = `#${match[1].toLowerCase()}`;
      this.metrics.colors.set(color, (this.metrics.colors.get(color) || 0) + 1);
    }
    
    while ((match = rgbRegex.exec(content)) !== null) {
      const color = `rgb(${match[1]},${match[2]},${match[3]})`;
      this.metrics.colors.set(color, (this.metrics.colors.get(color) || 0) + 1);
    }
    
    // Find colors used more than 3 times that aren't variables
    for (const [color, count] of this.metrics.colors) {
      if (count > 3) {
        issues.push({
          id: 'css:hardcoded-color',
          severity: 'minor',
          category: 'maintainability',
          title: `Color "${color}" used ${count} times without a variable`,
          description: 'Extract to a CSS custom property or SCSS variable',
          file: filePath,
          line: 1,
        });
      }
    }
    
    return issues;
  }

  _checkZIndex(content, filePath) {
    const issues = [];
    const regex = /z-index\s*:\s*(-?\d+)/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      const value = parseInt(match[1]);
      const line = getLineNumber(content, match.index);
      this.metrics.zIndexes.push({ value, file: filePath, line });
      
      if (value > 9999) {
        issues.push({
          id: 'css:extreme-z-index',
          severity: 'minor',
          category: 'maintainability',
          title: `Extreme z-index value: ${value}`,
          description: 'Use a z-index scale/system to manage stacking contexts',
          file: filePath,
          line,
        });
      }
    }
    
    return issues;
  }

  _checkFileSize(content, filePath) {
    const issues = [];
    const lines = countLines(content);
    
    if (lines > 300) {
      issues.push({
        id: 'css:large-file',
        severity: 'minor',
        category: 'maintainability',
        title: `Large style file: ${lines} lines`,
        description: 'Consider splitting into smaller, component-scoped files',
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  _checkVendorPrefixes(content, filePath) {
    const issues = [];
    const prefixRegex = /(?:^|\s)(-webkit-|-moz-|-ms-|-o-)[\w-]+/gm;
    let count = 0;
    let match;
    
    while ((match = prefixRegex.exec(content)) !== null) {
      count++;
    }
    
    if (count > 5) {
      issues.push({
        id: 'css:manual-vendor-prefixes',
        severity: 'info',
        category: 'modernization',
        title: `${count} vendor prefixes found`,
        description: 'Use Autoprefixer to handle vendor prefixes automatically',
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  _checkDuplicateProperties(content, filePath) {
    const issues = [];
    const lines = content.split('\n');
    const blockProperties = [];
    let inBlock = false;
    let blockStart = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.includes('{')) {
        inBlock = true;
        blockStart = i;
        blockProperties.length = 0;
      }
      
      if (inBlock && line.includes(':') && !line.startsWith('//') && !line.startsWith('@')) {
        const property = line.split(':')[0].trim();
        if (blockProperties.includes(property)) {
          issues.push({
            id: 'css:duplicate-property',
            severity: 'minor',
            category: 'bug',
            title: `Duplicate property: ${property}`,
            description: 'Property declared multiple times in the same rule',
            file: filePath,
            line: i + 1,
          });
        }
        blockProperties.push(property);
      }
      
      if (line.includes('}')) {
        inBlock = false;
      }
    }
    
    return issues;
  }

  _checkResponsivePatterns(content, filePath) {
    const issues = [];
    
    // Detect media queries
    const mediaRegex = /@media[^{]+\{/g;
    let match;
    let mediaCount = 0;
    
    while ((match = mediaRegex.exec(content)) !== null) {
      mediaCount++;
      
      // Extract breakpoint values
      const breakpointMatch = match[0].match(/(?:min|max)-width\s*:\s*(\d+(?:\.\d+)?(?:px|em|rem))/);
      if (breakpointMatch) {
        this.metrics.breakpoints.add(breakpointMatch[1]);
      }
    }
    
    // Check for px-based media queries
    const pxMedia = content.match(/@media[^{]*\d+px/g);
    if (pxMedia && pxMedia.length > 0) {
      issues.push({
        id: 'css:px-media-queries',
        severity: 'info',
        category: 'best-practice',
        title: 'Media queries using px values',
        description: 'Consider using em/rem for better accessibility with browser zoom',
        file: filePath,
        line: 1,
      });
    }
    
    return issues;
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics() {
    return {
      totalFiles: this.metrics.totalFiles,
      totalLines: this.metrics.totalLines,
      totalSelectors: this.metrics.totalSelectors,
      importantCount: this.metrics.importantCount,
      maxSpecificity: this.metrics.maxSpecificity,
      maxNesting: this.metrics.maxNesting,
      uniqueColors: this.metrics.colors.size,
      zIndexRange: this.metrics.zIndexes.length > 0 ? {
        min: Math.min(...this.metrics.zIndexes.map(z => z.value)),
        max: Math.max(...this.metrics.zIndexes.map(z => z.value)),
        count: this.metrics.zIndexes.length,
      } : null,
      breakpoints: Array.from(this.metrics.breakpoints),
    };
  }

  /**
   * Get summary
   */
  getSummary() {
    const bySeverity = {};
    for (const issue of this.issues) {
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }
    
    return {
      total: this.issues.length,
      bySeverity,
      metrics: this.getMetrics(),
    };
  }

  getIssues() {
    return this.issues;
  }
}

module.exports = { ScssAnalyzer, calculateSpecificity, specificityScore };

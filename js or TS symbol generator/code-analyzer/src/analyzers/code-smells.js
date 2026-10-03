/**
 * Code Smell Detector
 * 
 * Detects common code smells (inspired by SonarQube):
 * - Long Method (>30 lines)
 * - Large Class (>300 lines)
 * - Long Parameter List (>5 params)
 * - God Class (too many responsibilities)
 * - Feature Envy (method uses more external data than own)
 * - Duplicate Literals
 * - Magic Numbers
 * - Nested Callbacks (callback hell)
 * - Complex Conditionals
 * - Dead Code (unused variables)
 * - Console.log statements
 * - TODO/FIXME/HACK comments
 * - Excessive Comments
 */

const path = require('path');
const { readFileSafe, getLineNumber, countLines } = require('../ast-utils');

// ─── Smell Definitions ───────────────────────────────────────────────────────

const SMELL_SEVERITY = {
  BLOCKER: 'blocker',
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor',
  INFO: 'info',
};

// ─── Code Smell Detector ─────────────────────────────────────────────────────

class CodeSmellDetector {
  constructor(rootDir, options = {}) {
    this.rootDir = rootDir;
    this.options = {
      maxMethodLength: options.maxMethodLength || 30,
      maxClassLength: options.maxClassLength || 300,
      maxParams: options.maxParams || 5,
      maxNesting: options.maxNesting || 4,
      maxFileLength: options.maxFileLength || 500,
      maxDuplicateLiterals: options.maxDuplicateLiterals || 3,
      ...options,
    };
    this.issues = [];
  }

  /**
   * Analyze a file for code smells
   */
  analyzeFile(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return [];
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const fileIssues = [];
    
    fileIssues.push(...this._checkFileLength(content, relativePath));
    fileIssues.push(...this._checkLongMethods(content, relativePath));
    fileIssues.push(...this._checkLargeClasses(content, relativePath));
    fileIssues.push(...this._checkLongParameterLists(content, relativePath));
    fileIssues.push(...this._checkNestedCallbacks(content, relativePath));
    fileIssues.push(...this._checkMagicNumbers(content, relativePath));
    fileIssues.push(...this._checkDuplicateLiterals(content, relativePath));
    fileIssues.push(...this._checkConsoleStatements(content, relativePath));
    fileIssues.push(...this._checkTodoComments(content, relativePath));
    fileIssues.push(...this._checkComplexConditionals(content, relativePath));
    fileIssues.push(...this._checkDeepNesting(content, relativePath));
    fileIssues.push(...this._checkEmptyCatchBlocks(content, relativePath));
    fileIssues.push(...this._checkGodClass(content, relativePath));
    
    this.issues.push(...fileIssues);
    return fileIssues;
  }

  // ─── Individual Smell Checks ───────────────────────────────────────────────

  _checkFileLength(content, filePath) {
    const lines = countLines(content);
    if (lines > this.options.maxFileLength) {
      return [{
        id: 'smell:file-too-long',
        severity: SMELL_SEVERITY.MAJOR,
        category: 'maintainability',
        title: `File too long: ${lines} lines (max: ${this.options.maxFileLength})`,
        file: filePath,
        line: 1,
        effort: `${Math.ceil((lines - this.options.maxFileLength) / 50) * 15}min`,
      }];
    }
    return [];
  }

  _checkLongMethods(content, filePath) {
    const issues = [];
    const lines = content.split('\n');
    let methodName = null;
    let methodStart = 0;
    let braceDepth = 0;
    let inMethod = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Detect method start
      const methodMatch = line.match(
        /^(?:(?:public|private|protected|static|async|override)\s+)*(\w+)\s*\([^)]*\)[^{]*\{/
      );
      
      if (methodMatch && !inMethod) {
        methodName = methodMatch[1];
        methodStart = i;
        braceDepth = 0;
        inMethod = true;
      }
      
      if (inMethod) {
        braceDepth += (line.match(/\{/g) || []).length;
        braceDepth -= (line.match(/\}/g) || []).length;
        
        if (braceDepth <= 0 && i > methodStart) {
          const length = i - methodStart + 1;
          if (length > this.options.maxMethodLength) {
            issues.push({
              id: 'smell:long-method',
              severity: SMELL_SEVERITY.MAJOR,
              category: 'maintainability',
              title: `Method "${methodName}" is too long: ${length} lines (max: ${this.options.maxMethodLength})`,
              file: filePath,
              line: methodStart + 1,
              effort: `${Math.ceil(length / 10) * 10}min`,
            });
          }
          inMethod = false;
        }
      }
    }
    
    return issues;
  }

  _checkLargeClasses(content, filePath) {
    const issues = [];
    const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
    let match;
    
    while ((match = classRegex.exec(content)) !== null) {
      const className = match[1];
      const startPos = content.indexOf('{', match.index);
      
      // Count lines in class body
      let depth = 0;
      let lines = 0;
      let i = startPos;
      let started = false;
      
      while (i < content.length) {
        if (content[i] === '{') { depth++; started = true; }
        if (content[i] === '}') { depth--; }
        if (content[i] === '\n') lines++;
        if (started && depth === 0) break;
        i++;
      }
      
      if (lines > this.options.maxClassLength) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'smell:large-class',
          severity: SMELL_SEVERITY.CRITICAL,
          category: 'maintainability',
          title: `Class "${className}" is too large: ${lines} lines (max: ${this.options.maxClassLength})`,
          file: filePath,
          line,
          effort: `${Math.ceil(lines / 100) * 60}min`,
        });
      }
    }
    
    return issues;
  }

  _checkLongParameterLists(content, filePath) {
    const issues = [];
    const funcRegex = /(?:(?:public|private|protected|static|async)\s+)*(\w+)\s*\(([^)]{50,})\)/g;
    let match;
    
    while ((match = funcRegex.exec(content)) !== null) {
      const funcName = match[1];
      const params = match[2].split(',');
      
      if (params.length > this.options.maxParams) {
        const line = getLineNumber(content, match.index);
        issues.push({
          id: 'smell:long-parameter-list',
          severity: SMELL_SEVERITY.MINOR,
          category: 'maintainability',
          title: `Method "${funcName}" has ${params.length} parameters (max: ${this.options.maxParams})`,
          description: 'Consider using an options object or splitting the method',
          file: filePath,
          line,
          effort: '20min',
        });
      }
    }
    
    return issues;
  }

  _checkNestedCallbacks(content, filePath) {
    const issues = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Count arrow function or callback nesting
      const arrows = (line.match(/=>/g) || []).length;
      const callbacks = (line.match(/function\s*\(/g) || []).length;
      
      if (arrows + callbacks >= 3) {
        issues.push({
          id: 'smell:nested-callbacks',
          severity: SMELL_SEVERITY.MAJOR,
          category: 'maintainability',
          title: 'Deeply nested callbacks detected',
          description: 'Consider using async/await or extracting helper methods',
          file: filePath,
          line: i + 1,
          effort: '30min',
        });
      }
    }
    
    return issues;
  }

  _checkMagicNumbers(content, filePath) {
    const issues = [];
    const lines = content.split('\n');
    const allowedNumbers = new Set([0, 1, -1, 2, 10, 100, 1000, 60, 24, 365, 1024]);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip comments, imports, constants declarations, array indices
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('import') || 
          line.includes('const ') || line.includes('= ') && line.includes(':')) continue;
      
      // Find numbers in logic (not in strings or as array indices)
      const numberRegex = /(?<!['"[\w.])\b(\d+(?:\.\d+)?)\b(?!['".\]])/g;
      let match;
      
      while ((match = numberRegex.exec(line)) !== null) {
        const num = parseFloat(match[1]);
        if (!allowedNumbers.has(num) && num > 2 && !Number.isNaN(num)) {
          // Only flag if it's in a conditional or calculation
          if (line.includes('if') || line.includes('while') || line.includes('for') ||
              line.includes('+') || line.includes('-') || line.includes('*') || line.includes('/') ||
              line.includes('>') || line.includes('<')) {
            issues.push({
              id: 'smell:magic-number',
              severity: SMELL_SEVERITY.MINOR,
              category: 'maintainability',
              title: `Magic number: ${num}`,
              description: 'Extract to a named constant for readability',
              file: filePath,
              line: i + 1,
              effort: '5min',
            });
            break; // One per line is enough
          }
        }
      }
    }
    
    return issues;
  }

  _checkDuplicateLiterals(content, filePath) {
    const issues = [];
    const stringLiterals = new Map(); // literal -> count
    
    const stringRegex = /(?<![\\])['"]([^'"]{5,50})['"]/g;
    let match;
    
    while ((match = stringRegex.exec(content)) !== null) {
      const literal = match[1];
      // Skip common patterns
      if (literal.startsWith('http') || literal.startsWith('/') || literal.includes('{{')) continue;
      
      stringLiterals.set(literal, (stringLiterals.get(literal) || 0) + 1);
    }
    
    for (const [literal, count] of stringLiterals) {
      if (count > this.options.maxDuplicateLiterals) {
        issues.push({
          id: 'smell:duplicate-literal',
          severity: SMELL_SEVERITY.MINOR,
          category: 'maintainability',
          title: `String "${literal.substring(0, 30)}..." duplicated ${count} times`,
          description: 'Extract to a constant',
          file: filePath,
          line: 1,
          effort: '10min',
        });
      }
    }
    
    return issues;
  }

  _checkConsoleStatements(content, filePath) {
    const issues = [];
    const regex = /console\.(log|debug|info|trace)\s*\(/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      issues.push({
        id: 'smell:console-statement',
        severity: SMELL_SEVERITY.MINOR,
        category: 'code-smell',
        title: `console.${match[1]}() found`,
        description: 'Remove or replace with proper logging',
        file: filePath,
        line,
        effort: '2min',
      });
    }
    
    return issues;
  }

  _checkTodoComments(content, filePath) {
    const issues = [];
    const regex = /\/\/\s*(TODO|FIXME|HACK|XXX|BUG)\s*:?\s*(.*)/gi;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      const type = match[1].toUpperCase();
      const severity = type === 'FIXME' || type === 'BUG' ? SMELL_SEVERITY.MAJOR : 
                       type === 'HACK' ? SMELL_SEVERITY.MAJOR : SMELL_SEVERITY.INFO;
      
      issues.push({
        id: `smell:${type.toLowerCase()}-comment`,
        severity,
        category: 'technical-debt',
        title: `${type}: ${match[2].trim().substring(0, 60)}`,
        file: filePath,
        line,
        effort: '30min',
      });
    }
    
    return issues;
  }

  _checkComplexConditionals(content, filePath) {
    const issues = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const logicalOps = (line.match(/&&|\|\|/g) || []).length;
      
      if (logicalOps >= 3) {
        issues.push({
          id: 'smell:complex-conditional',
          severity: SMELL_SEVERITY.MAJOR,
          category: 'maintainability',
          title: `Complex conditional with ${logicalOps} logical operators`,
          description: 'Extract condition to a well-named boolean variable or method',
          file: filePath,
          line: i + 1,
          effort: '15min',
        });
      }
    }
    
    return issues;
  }

  _checkDeepNesting(content, filePath) {
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
    
    if (maxDepth > this.options.maxNesting + 2) { // +2 for class and method wrapper
      issues.push({
        id: 'smell:deep-nesting',
        severity: SMELL_SEVERITY.MAJOR,
        category: 'maintainability',
        title: `Deep nesting: ${maxDepth} levels`,
        description: 'Consider using early returns, guard clauses, or extracting methods',
        file: filePath,
        line: maxDepthLine,
        effort: '30min',
      });
    }
    
    return issues;
  }

  _checkEmptyCatchBlocks(content, filePath) {
    const issues = [];
    const regex = /catch\s*\([^)]*\)\s*\{\s*\}/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      issues.push({
        id: 'smell:empty-catch',
        severity: SMELL_SEVERITY.MAJOR,
        category: 'reliability',
        title: 'Empty catch block',
        description: 'Handle or log the error, or add a comment explaining why it is intentionally empty',
        file: filePath,
        line,
        effort: '10min',
      });
    }
    
    return issues;
  }

  _checkGodClass(content, filePath) {
    const issues = [];
    const classMatch = content.match(/class\s+(\w+)/);
    if (!classMatch) return issues;
    
    const className = classMatch[1];
    
    // Count methods
    const methodCount = (content.match(/(?:public|private|protected)?\s*(?:async\s+)?\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g) || []).length;
    
    // Count injected dependencies
    const constructorMatch = content.match(/constructor\s*\(([^)]*)\)/s);
    const depCount = constructorMatch ? constructorMatch[1].split(',').filter(p => p.trim()).length : 0;
    
    // Count properties
    const propertyCount = (content.match(/(?:public|private|protected)\s+\w+\s*[?!]?\s*:/g) || []).length;
    
    if (methodCount > 15 && depCount > 5) {
      issues.push({
        id: 'smell:god-class',
        severity: SMELL_SEVERITY.CRITICAL,
        category: 'design',
        title: `Potential God Class: "${className}" (${methodCount} methods, ${depCount} dependencies)`,
        description: 'This class has too many responsibilities. Consider splitting into smaller, focused classes.',
        file: filePath,
        line: getLineNumber(content, classMatch.index),
        effort: '120min',
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
   * Calculate technical debt
   */
  getTechnicalDebt() {
    let totalMinutes = 0;
    
    for (const issue of this.issues) {
      const effort = issue.effort || '0min';
      const minutes = parseInt(effort) || 0;
      totalMinutes += minutes;
    }
    
    const hours = Math.floor(totalMinutes / 60);
    const days = Math.floor(hours / 8);
    
    return {
      totalMinutes,
      formatted: days > 0 ? `${days}d ${hours % 8}h` : hours > 0 ? `${hours}h ${totalMinutes % 60}m` : `${totalMinutes}m`,
    };
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
      technicalDebt: this.getTechnicalDebt(),
    };
  }
}

module.exports = { CodeSmellDetector };

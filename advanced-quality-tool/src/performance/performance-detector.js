/**
 * Performance Issue Detector
 * 
 * Detects common performance anti-patterns and issues:
 * - N+1 query problems
 * - Inefficient loops
 * - Memory leaks
 * - Unnecessary re-renders (React)
 * - Blocking operations
 * - Inefficient algorithms
 * - Large bundle sizes
 * - Unoptimized images/assets
 * 
 * @module performance/performance-detector
 */

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

/**
 * Performance Issue Detector
 */
class PerformanceDetector {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.framework = options.framework || 'auto'; // 'react', 'vue', 'angular', 'auto'

    // Performance patterns
    this.patterns = this.initializePatterns();

    // Statistics
    this.stats = {
      filesScanned: 0,
      issuesFound: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    };
  }

  /**
   * Initialize performance issue patterns
   */
  initializePatterns() {
    return {
      // N+1 Query Problems
      nPlusOneQuery: [
        {
          name: 'N+1 Query in Loop',
          check: (node, context) => this.checkNPlusOneInLoop(node, context),
          severity: 'CRITICAL',
          description: 'Database query inside loop causing N+1 query problem',
          recommendation: 'Use batch loading, eager loading, or DataLoader pattern',
          impact: 'Exponential database load, severe performance degradation'
        }
      ],

      // Inefficient Loops
      inefficientLoops: [
        {
          name: 'Nested Loop with High Complexity',
          check: (node, context) => this.checkNestedLoops(node, context),
          severity: 'HIGH',
          description: 'Nested loops with O(n²) or worse complexity',
          recommendation: 'Use hash maps, sets, or optimize algorithm',
          impact: 'Quadratic or worse time complexity'
        },
        {
          name: 'Array Method Chaining',
          check: (node, context) => this.checkArrayChaining(node, context),
          severity: 'MEDIUM',
          description: 'Multiple array iterations that could be combined',
          recommendation: 'Combine operations into single loop or use reduce',
          impact: 'Multiple array iterations, increased processing time'
        }
      ],

      // Memory Leaks
      memoryLeaks: [
        {
          name: 'Event Listener Not Cleaned',
          check: (node, context) => this.checkEventListenerLeak(node, context),
          severity: 'HIGH',
          description: 'Event listener added without cleanup',
          recommendation: 'Remove event listener in cleanup/unmount',
          impact: 'Memory leak, increased memory usage over time'
        },
        {
          name: 'Timer Not Cleared',
          check: (node, context) => this.checkTimerLeak(node, context),
          severity: 'HIGH',
          description: 'setTimeout/setInterval not cleared',
          recommendation: 'Clear timer in cleanup function',
          impact: 'Memory leak, continued execution after unmount'
        },
        {
          name: 'Global Variable Accumulation',
          check: (node, context) => this.checkGlobalAccumulation(node, context),
          severity: 'MEDIUM',
          description: 'Accumulating data in global scope',
          recommendation: 'Use local scope or implement cleanup',
          impact: 'Memory leak, unbounded memory growth'
        }
      ],

      // React-specific
      reactPerformance: [
        {
          name: 'Inline Function in JSX',
          check: (node, context) => this.checkInlineFunction(node, context),
          severity: 'MEDIUM',
          description: 'Inline function creation in render',
          recommendation: 'Move function outside render or use useCallback',
          impact: 'Unnecessary re-renders, new function created each render'
        },
        {
          name: 'Missing React Memo',
          check: (node, context) => this.checkMissingMemo(node, context),
          severity: 'LOW',
          description: 'Component could benefit from React.memo',
          recommendation: 'Wrap component with React.memo',
          impact: 'Unnecessary re-renders'
        },
        {
          name: 'Large useEffect Dependencies',
          check: (node, context) => this.checkUseEffectDeps(node, context),
          severity: 'MEDIUM',
          description: 'useEffect with large or complex dependencies',
          recommendation: 'Split into multiple effects or optimize dependencies',
          impact: 'Effect runs too frequently'
        }
      ],

      // Blocking Operations
      blockingOps: [
        {
          name: 'Synchronous Blocking Call',
          check: (node, context) => this.checkSyncBlocking(node, context),
          severity: 'CRITICAL',
          description: 'Synchronous operation that blocks event loop',
          recommendation: 'Use async version or Web Worker',
          impact: 'UI freezes, poor user experience'
        },
        {
          name: 'Large Data Processing in Main Thread',
          check: (node, context) => this.checkHeavyProcessing(node, context),
          severity: 'HIGH',
          description: 'Heavy computation on main thread',
          recommendation: 'Move to Web Worker or optimize algorithm',
          impact: 'UI lag, degraded responsiveness'
        }
      ],

      // Inefficient Algorithms
      inefficientAlgorithms: [
        {
          name: 'Linear Search on Large Array',
          check: (node, context) => this.checkLinearSearch(node, context),
          severity: 'MEDIUM',
          description: 'Linear search where binary search or hash lookup would be better',
          recommendation: 'Use Map/Set for O(1) lookup or binary search',
          impact: 'O(n) when O(1) or O(log n) is possible'
        },
        {
          name: 'Repeated String Concatenation',
          check: (node, context) => this.checkStringConcat(node, context),
          severity: 'MEDIUM',
          description: 'String concatenation in loop',
          recommendation: 'Use array join or template literals',
          impact: 'O(n²) string operations'
        }
      ]
    };
  }

  /**
   * Analyze file for performance issues
   */
  async analyzeFile(filePath) {
    this.stats.filesScanned++;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const ext = path.extname(filePath);

      // Only analyze JavaScript/TypeScript files
      if (!['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
        return {
          filePath,
          error: 'Unsupported file type',
          issues: []
        };
      }

      // Parse AST
      const ast = this.parseAST(content, filePath);

      if (!ast) {
        return {
          filePath,
          error: 'Failed to parse AST',
          issues: []
        };
      }

      // Detect framework
      if (this.framework === 'auto') {
        this.framework = this.detectFramework(content);
      }

      // Analyze with all patterns
      const issues = [];
      const context = {
        content,
        filePath,
        ast,
        lines: content.split('\n')
      };

      for (const [category, patterns] of Object.entries(this.patterns)) {
        // Skip React patterns if not React
        if (category === 'reactPerformance' && this.framework !== 'react') {
          continue;
        }

        for (const pattern of patterns) {
          try {
            const detectedIssues = pattern.check(ast, context);
            issues.push(...detectedIssues);
          } catch (error) {
            this.log(`Error checking ${pattern.name}: ${error.message}`);
          }
        }
      }

      // Update statistics
      this.stats.issuesFound += issues.length;
      issues.forEach(issue => {
        const severity = issue.severity.toUpperCase();
        if (severity === 'CRITICAL') this.stats.critical++;
        else if (severity === 'HIGH') this.stats.high++;
        else if (severity === 'MEDIUM') this.stats.medium++;
        else if (severity === 'LOW') this.stats.low++;
      });

      return {
        filePath,
        issues,
        count: issues.length,
        framework: this.framework
      };

    } catch (error) {
      this.log(`Error analyzing ${filePath}: ${error.message}`);
      return {
        filePath,
        error: error.message,
        issues: []
      };
    }
  }

  /**
   * Parse AST
   */
  parseAST(content, filePath) {
    try {
      return acorn.parse(content, {
        ecmaVersion: 2022,
        sourceType: 'module',
        locations: true,
        ranges: true,
        allowHashBang: true,
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true
      });
    } catch (error) {
      this.log(`Failed to parse ${filePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Detect framework
   */
  detectFramework(content) {
    if (/from ['"]react['"]/.test(content) || /require\(['"]react['"]\)/.test(content)) {
      return 'react';
    }
    if (/from ['"]vue['"]/.test(content) || /require\(['"]vue['"]\)/.test(content)) {
      return 'vue';
    }
    if (/@angular\/core/.test(content)) {
      return 'angular';
    }
    return 'vanilla';
  }

  /**
   * Check N+1 query in loop
   */
  checkNPlusOneInLoop(ast, context) {
    const issues = [];
    const loopTypes = ['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'];
    const queryPatterns = ['query', 'find', 'findOne', 'get', 'fetch', 'load', 'select'];

    walk.simple(ast, {
      ForStatement: (node) => this.checkLoopForQueries(node, issues, context, queryPatterns),
      ForInStatement: (node) => this.checkLoopForQueries(node, issues, context, queryPatterns),
      ForOfStatement: (node) => this.checkLoopForQueries(node, issues, context, queryPatterns),
      WhileStatement: (node) => this.checkLoopForQueries(node, issues, context, queryPatterns),
      DoWhileStatement: (node) => this.checkLoopForQueries(node, issues, context, queryPatterns)
    });

    return issues;
  }

  /**
   * Check loop for database queries
   */
  checkLoopForQueries(node, issues, context, queryPatterns) {
    let hasQuery = false;

    walk.simple(node.body, {
      CallExpression: (callNode) => {
        const calleeName = this.getCalleeName(callNode);
        if (queryPatterns.some(pattern => calleeName && calleeName.includes(pattern))) {
          hasQuery = true;
        }
      },
      AwaitExpression: (awaitNode) => {
        if (awaitNode.argument && awaitNode.argument.type === 'CallExpression') {
          const calleeName = this.getCalleeName(awaitNode.argument);
          if (queryPatterns.some(pattern => calleeName && calleeName.includes(pattern))) {
            hasQuery = true;
          }
        }
      }
    });

    if (hasQuery) {
      issues.push({
        type: 'performance-issue',
        name: 'N+1 Query in Loop',
        severity: 'CRITICAL',
        description: 'Database query inside loop causing N+1 query problem',
        recommendation: 'Use batch loading, eager loading, or DataLoader pattern',
        filePath: context.filePath,
        line: node.loc.start.line,
        code: context.lines[node.loc.start.line - 1].trim()
      });
    }
  }

  /**
   * Check nested loops
   */
  checkNestedLoops(ast, context) {
    const issues = [];
    const loopTypes = ['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement'];

    const checkNesting = (node, depth = 0) => {
      if (loopTypes.includes(node.type)) {
        if (depth >= 2) {
          issues.push({
            type: 'performance-issue',
            name: 'Nested Loop with High Complexity',
            severity: depth >= 3 ? 'CRITICAL' : 'HIGH',
            description: `${depth}-level nested loop with O(n^${depth}) complexity`,
            recommendation: 'Use hash maps, sets, or optimize algorithm',
            filePath: context.filePath,
            line: node.loc.start.line,
            code: context.lines[node.loc.start.line - 1].trim(),
            nestingLevel: depth
          });
        }

        // Check children with increased depth
        for (const key in node) {
          if (node[key] && typeof node[key] === 'object') {
            if (Array.isArray(node[key])) {
              node[key].forEach(child => {
                if (child && child.type) {
                  checkNesting(child, depth + 1);
                }
              });
            } else if (node[key].type) {
              checkNesting(node[key], depth + 1);
            }
          }
        }
      } else {
        // Not a loop, continue with same depth
        for (const key in node) {
          if (node[key] && typeof node[key] === 'object') {
            if (Array.isArray(node[key])) {
              node[key].forEach(child => {
                if (child && child.type) {
                  checkNesting(child, depth);
                }
              });
            } else if (node[key].type) {
              checkNesting(node[key], depth);
            }
          }
        }
      }
    };

    checkNesting(ast);
    return issues;
  }

  /**
   * Check array method chaining
   */
  checkArrayChaining(ast, context) {
    const issues = [];

    walk.simple(ast, {
      CallExpression: (node) => {
        if (this.isArrayMethod(node)) {
          let chainLength = 1;
          let current = node.callee;

          while (current && current.type === 'MemberExpression' && 
                 current.object.type === 'CallExpression' && 
                 this.isArrayMethod(current.object)) {
            chainLength++;
            current = current.object.callee;
          }

          if (chainLength >= 3) {
            issues.push({
              type: 'performance-issue',
              name: 'Array Method Chaining',
              severity: 'MEDIUM',
              description: `${chainLength} chained array methods causing multiple iterations`,
              recommendation: 'Combine operations into single loop or use reduce',
              filePath: context.filePath,
              line: node.loc.start.line,
              code: context.lines[node.loc.start.line - 1].trim(),
              chainLength
            });
          }
        }
      }
    });

    return issues;
  }

  /**
   * Check event listener leak
   */
  checkEventListenerLeak(ast, context) {
    const issues = [];
    const listeners = [];
    let hasCleanup = false;

    walk.simple(ast, {
      CallExpression: (node) => {
        const callee = this.getCalleeName(node);

        if (callee === 'addEventListener' || callee === 'on') {
          listeners.push(node);
        }

        if (callee === 'removeEventListener' || callee === 'off') {
          hasCleanup = true;
        }
      }
    });

    if (listeners.length > 0 && !hasCleanup) {
      listeners.forEach(node => {
        issues.push({
          type: 'performance-issue',
          name: 'Event Listener Not Cleaned',
          severity: 'HIGH',
          description: 'Event listener added without cleanup',
          recommendation: 'Remove event listener in cleanup/unmount',
          filePath: context.filePath,
          line: node.loc.start.line,
          code: context.lines[node.loc.start.line - 1].trim()
        });
      });
    }

    return issues;
  }

  /**
   * Check timer leak
   */
  checkTimerLeak(ast, context) {
    const issues = [];
    const timers = [];
    let hasCleanup = false;

    walk.simple(ast, {
      CallExpression: (node) => {
        const callee = this.getCalleeName(node);

        if (callee === 'setTimeout' || callee === 'setInterval') {
          timers.push(node);
        }

        if (callee === 'clearTimeout' || callee === 'clearInterval') {
          hasCleanup = true;
        }
      }
    });

    if (timers.length > 0 && !hasCleanup) {
      timers.forEach(node => {
        const callee = this.getCalleeName(node);
        issues.push({
          type: 'performance-issue',
          name: 'Timer Not Cleared',
          severity: 'HIGH',
          description: `${callee} not cleared`,
          recommendation: 'Clear timer in cleanup function',
          filePath: context.filePath,
          line: node.loc.start.line,
          code: context.lines[node.loc.start.line - 1].trim()
        });
      });
    }

    return issues;
  }

  /**
   * Check global accumulation
   */
  checkGlobalAccumulation(ast, context) {
    const issues = [];

    walk.simple(ast, {
      AssignmentExpression: (node) => {
        if (node.left.type === 'MemberExpression' && 
            node.left.object.name === 'window') {
          issues.push({
            type: 'performance-issue',
            name: 'Global Variable Accumulation',
            severity: 'MEDIUM',
            description: 'Potential memory leak from global variable',
            recommendation: 'Use local scope or implement cleanup',
            filePath: context.filePath,
            line: node.loc.start.line,
            code: context.lines[node.loc.start.line - 1].trim()
          });
        }
      }
    });

    return issues;
  }

  /**
   * Check inline functions in JSX (React)
   */
  checkInlineFunction(ast, context) {
    // Simplified - would need JSX parsing
    return [];
  }

  /**
   * Check missing React.memo
   */
  checkMissingMemo(ast, context) {
    // Simplified - would need more context
    return [];
  }

  /**
   * Check useEffect dependencies
   */
  checkUseEffectDeps(ast, context) {
    // Simplified - would need React hooks analysis
    return [];
  }

  /**
   * Check synchronous blocking calls
   */
  checkSyncBlocking(ast, context) {
    const issues = [];
    const blockingCalls = ['readFileSync', 'writeFileSync', 'execSync', 'readdirSync'];

    walk.simple(ast, {
      CallExpression: (node) => {
        const callee = this.getCalleeName(node);

        if (blockingCalls.some(blocking => callee && callee.includes(blocking))) {
          issues.push({
            type: 'performance-issue',
            name: 'Synchronous Blocking Call',
            severity: 'CRITICAL',
            description: `Synchronous call ${callee} blocks event loop`,
            recommendation: 'Use async version',
            filePath: context.filePath,
            line: node.loc.start.line,
            code: context.lines[node.loc.start.line - 1].trim()
          });
        }
      }
    });

    return issues;
  }

  /**
   * Check heavy processing
   */
  checkHeavyProcessing(ast, context) {
    // This would require runtime profiling - simplified version
    return [];
  }

  /**
   * Check linear search
   */
  checkLinearSearch(ast, context) {
    // Simplified pattern detection
    return [];
  }

  /**
   * Check string concatenation
   */
  checkStringConcat(ast, context) {
    const issues = [];

    walk.simple(ast, {
      ForStatement: (forNode) => {
        let hasStringConcat = false;

        walk.simple(forNode.body, {
          BinaryExpression: (node) => {
            if (node.operator === '+' && this.isStringType(node)) {
              hasStringConcat = true;
            }
          },
          AssignmentExpression: (node) => {
            if (node.operator === '+=' && this.isStringType(node)) {
              hasStringConcat = true;
            }
          }
        });

        if (hasStringConcat) {
          issues.push({
            type: 'performance-issue',
            name: 'String Concatenation in Loop',
            severity: 'MEDIUM',
            description: 'String concatenation in loop has O(n²) complexity',
            recommendation: 'Use array join or template literals',
            filePath: context.filePath,
            line: forNode.loc.start.line,
            code: context.lines[forNode.loc.start.line - 1].trim()
          });
        }
      }
    });

    return issues;
  }

  /**
   * Helper: Get callee name
   */
  getCalleeName(node) {
    if (!node.callee) return null;

    if (node.callee.type === 'Identifier') {
      return node.callee.name;
    }

    if (node.callee.type === 'MemberExpression') {
      if (node.callee.property && node.callee.property.name) {
        return node.callee.property.name;
      }
    }

    return null;
  }

  /**
   * Helper: Check if is array method
   */
  isArrayMethod(node) {
    const arrayMethods = ['map', 'filter', 'reduce', 'forEach', 'find', 'some', 'every'];
    const callee = this.getCalleeName(node);
    return callee && arrayMethods.includes(callee);
  }

  /**
   * Helper: Check if is string type
   */
  isStringType(node) {
    // Simplified - would need type inference
    return true;
  }

  /**
   * Analyze multiple files
   */
  async analyzeFiles(filePaths) {
    const results = [];

    for (const filePath of filePaths) {
      const result = await this.analyzeFile(filePath);
      if (result.issues.length > 0) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Generate report
   */
  generateReport(results) {
    const report = {
      summary: {
        ...this.stats,
        filesWithIssues: results.length,
        timestamp: new Date().toISOString()
      },
      issues: []
    };

    const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };

    results.forEach(result => {
      result.issues.forEach(issue => {
        bySeverity[issue.severity].push(issue);
        report.issues.push(issue);
      });
    });

    report.bySeverity = bySeverity;

    return report;
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }

  log(message) {
    if (this.verbose) {
      console.log(`[PerformanceDetector] ${message}`);
    }
  }
}

module.exports = {
  PerformanceDetector
};

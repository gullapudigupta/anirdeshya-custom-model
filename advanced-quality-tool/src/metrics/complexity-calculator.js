/**
 * Code Complexity Metrics Calculator
 * 
 * Calculates various code complexity metrics:
 * - Cyclomatic Complexity (McCabe)
 * - Cognitive Complexity
 * - Halstead Complexity Measures
 * - Lines of Code metrics (LOC, SLOC, CLOC)
 * - Maintainability Index
 * - Function/Method metrics
 * 
 * @module metrics/complexity-calculator
 */

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

/**
 * Complexity Calculator
 */
class ComplexityCalculator {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.thresholds = options.thresholds || {
      cyclomatic: 10,
      cognitive: 15,
      maintainability: 65,
      maxLines: 300,
      maxParameters: 5
    };

    // Statistics
    this.stats = {
      filesScanned: 0,
      functionsAnalyzed: 0,
      issuesFound: 0,
      avgCyclomatic: 0,
      avgCognitive: 0,
      avgMaintainability: 0
    };
  }

  /**
   * Analyze file complexity
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
          metrics: {}
        };
      }

      // Parse AST
      const ast = this.parseAST(content, filePath);

      if (!ast) {
        return {
          filePath,
          error: 'Failed to parse AST',
          metrics: {}
        };
      }

      // Calculate file-level metrics
      const fileMetrics = this.calculateFileMetrics(content, ast, filePath);

      // Calculate function-level metrics
      const functionMetrics = this.calculateFunctionMetrics(content, ast, filePath);

      // Identify issues
      const issues = this.identifyIssues(fileMetrics, functionMetrics);
      this.stats.issuesFound += issues.length;

      // Update statistics
      const avgCyclo = functionMetrics.length > 0
        ? functionMetrics.reduce((sum, f) => sum + f.cyclomaticComplexity, 0) / functionMetrics.length
        : 0;
      const avgCog = functionMetrics.length > 0
        ? functionMetrics.reduce((sum, f) => sum + f.cognitiveComplexity, 0) / functionMetrics.length
        : 0;

      this.stats.functionsAnalyzed += functionMetrics.length;
      this.stats.avgCyclomatic = (this.stats.avgCyclomatic + avgCyclo) / 2;
      this.stats.avgCognitive = (this.stats.avgCognitive + avgCog) / 2;
      this.stats.avgMaintainability = 
        (this.stats.avgMaintainability + fileMetrics.maintainabilityIndex) / 2;

      return {
        filePath,
        fileMetrics,
        functionMetrics,
        issues,
        summary: {
          totalFunctions: functionMetrics.length,
          complexFunctions: functionMetrics.filter(f => 
            f.cyclomaticComplexity > this.thresholds.cyclomatic
          ).length,
          issuesFound: issues.length
        }
      };

    } catch (error) {
      this.log(`Error analyzing ${filePath}: ${error.message}`);
      return {
        filePath,
        error: error.message,
        metrics: {}
      };
    }
  }

  /**
   * Parse AST
   */
  parseAST(content, filePath) {
    try {
      // Try parsing as ES module with JSX
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
   * Calculate file-level metrics
   */
  calculateFileMetrics(content, ast, filePath) {
    const lines = content.split('\n');

    // Lines of Code metrics
    const loc = lines.length;
    const sloc = this.countSourceLines(lines);
    const cloc = this.countCommentLines(lines);
    const blank = loc - sloc - cloc;

    // Halstead metrics
    const halstead = this.calculateHalstead(ast);

    // Maintainability Index
    const maintainabilityIndex = this.calculateMaintainabilityIndex(
      halstead.volume,
      halstead.difficulty,
      loc,
      cloc
    );

    return {
      filePath,
      loc,
      sloc,
      cloc,
      blank,
      halstead,
      maintainabilityIndex,
      maintainabilityRating: this.getMaintainabilityRating(maintainabilityIndex)
    };
  }

  /**
   * Calculate function-level metrics
   */
  calculateFunctionMetrics(content, ast, filePath) {
    const functions = [];
    const lines = content.split('\n');

    walk.simple(ast, {
      FunctionDeclaration: (node) => {
        functions.push(this.analyzeFunctionNode(node, lines, filePath, 'function'));
      },
      FunctionExpression: (node) => {
        functions.push(this.analyzeFunctionNode(node, lines, filePath, 'function'));
      },
      ArrowFunctionExpression: (node) => {
        functions.push(this.analyzeFunctionNode(node, lines, filePath, 'arrow'));
      },
      MethodDefinition: (node) => {
        if (node.value.type === 'FunctionExpression') {
          functions.push(this.analyzeFunctionNode(node.value, lines, filePath, 'method', node.key.name));
        }
      }
    });

    return functions;
  }

  /**
   * Analyze function node
   */
  analyzeFunctionNode(node, lines, filePath, type, methodName = null) {
    const name = methodName || (node.id ? node.id.name : '<anonymous>');
    const startLine = node.loc.start.line;
    const endLine = node.loc.end.line;
    const functionLines = endLine - startLine + 1;
    const params = node.params ? node.params.length : 0;

    // Calculate complexities
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(node);
    const cognitiveComplexity = this.calculateCognitiveComplexity(node);
    const nestingDepth = this.calculateMaxNesting(node);

    return {
      name,
      type,
      filePath,
      startLine,
      endLine,
      lines: functionLines,
      parameters: params,
      cyclomaticComplexity,
      cognitiveComplexity,
      nestingDepth,
      complexityRating: this.getComplexityRating(cyclomaticComplexity)
    };
  }

  /**
   * Calculate Cyclomatic Complexity (McCabe)
   * CC = E - N + 2P
   * where E = edges, N = nodes, P = connected components
   * 
   * Simplified: Count decision points + 1
   */
  calculateCyclomaticComplexity(node) {
    let complexity = 1; // Base complexity

    walk.simple(node, {
      // Conditional statements
      IfStatement: () => { complexity++; },
      ConditionalExpression: () => { complexity++; },

      // Loops
      WhileStatement: () => { complexity++; },
      DoWhileStatement: () => { complexity++; },
      ForStatement: () => { complexity++; },
      ForInStatement: () => { complexity++; },
      ForOfStatement: () => { complexity++; },

      // Switch cases
      SwitchCase: (n) => {
        if (n.test) complexity++; // Don't count default case
      },

      // Logical operators
      LogicalExpression: (n) => {
        if (n.operator === '||' || n.operator === '&&') {
          complexity++;
        }
      },

      // Try-catch
      CatchClause: () => { complexity++; },

      // Optional chaining and nullish coalescing
      ChainExpression: () => { complexity++; }
    });

    return complexity;
  }

  /**
   * Calculate Cognitive Complexity
   * More sophisticated than cyclomatic - considers nesting and structural complexity
   */
  calculateCognitiveComplexity(node) {
    let complexity = 0;
    let nestingLevel = 0;

    const incrementers = {
      IfStatement: true,
      ConditionalExpression: true,
      WhileStatement: true,
      DoWhileStatement: true,
      ForStatement: true,
      ForInStatement: true,
      ForOfStatement: true,
      CatchClause: true
    };

    const countLogical = (node, level) => {
      if (node.type === 'LogicalExpression') {
        if (node.operator === '&&' || node.operator === '||') {
          complexity += 1;
        }
        countLogical(node.left, level);
        countLogical(node.right, level);
      }
    };

    const traverse = (node, level) => {
      if (!node) return;

      // Increment for control flow with nesting bonus
      if (incrementers[node.type]) {
        complexity += 1 + level;
      }

      // Count logical operators
      if (node.test) {
        countLogical(node.test, level);
      }

      // Recursion penalty
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
        // Check if calling self (simplified check)
        complexity += 1;
      }

      // Traverse children with increased nesting
      const shouldIncreaseNesting = incrementers[node.type] || 
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression';

      const nextLevel = shouldIncreaseNesting ? level + 1 : level;

      for (const key in node) {
        if (key === 'type' || key === 'loc' || key === 'range') continue;

        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(c => {
            if (c && typeof c === 'object' && c.type) {
              traverse(c, nextLevel);
            }
          });
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child, nextLevel);
        }
      }
    };

    traverse(node, 0);
    return complexity;
  }

  /**
   * Calculate maximum nesting depth
   */
  calculateMaxNesting(node) {
    let maxDepth = 0;

    const traverse = (node, depth) => {
      if (!node) return;

      maxDepth = Math.max(maxDepth, depth);

      const nestingNodes = [
        'IfStatement', 'WhileStatement', 'DoWhileStatement',
        'ForStatement', 'ForInStatement', 'ForOfStatement',
        'SwitchStatement', 'TryStatement', 'CatchClause'
      ];

      const nextDepth = nestingNodes.includes(node.type) ? depth + 1 : depth;

      for (const key in node) {
        if (key === 'type' || key === 'loc' || key === 'range') continue;

        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(c => {
            if (c && typeof c === 'object' && c.type) {
              traverse(c, nextDepth);
            }
          });
        } else if (child && typeof child === 'object' && child.type) {
          traverse(child, nextDepth);
        }
      }
    };

    traverse(node, 0);
    return maxDepth;
  }

  /**
   * Calculate Halstead Complexity Measures
   */
  calculateHalstead(ast) {
    const operators = new Set();
    const operands = new Set();
    let totalOperators = 0;
    let totalOperands = 0;

    const operatorTypes = [
      'BinaryExpression', 'UnaryExpression', 'LogicalExpression',
      'UpdateExpression', 'AssignmentExpression', 'CallExpression'
    ];

    walk.simple(ast, {
      BinaryExpression: (node) => {
        operators.add(node.operator);
        totalOperators++;
      },
      UnaryExpression: (node) => {
        operators.add(node.operator);
        totalOperators++;
      },
      LogicalExpression: (node) => {
        operators.add(node.operator);
        totalOperators++;
      },
      UpdateExpression: (node) => {
        operators.add(node.operator);
        totalOperators++;
      },
      AssignmentExpression: (node) => {
        operators.add(node.operator);
        totalOperators++;
      },
      Identifier: (node) => {
        operands.add(node.name);
        totalOperands++;
      },
      Literal: (node) => {
        operands.add(`literal:${node.value}`);
        totalOperands++;
      }
    });

    const n1 = operators.size; // Unique operators
    const n2 = operands.size;  // Unique operands
    const N1 = totalOperators;  // Total operators
    const N2 = totalOperands;   // Total operands

    const vocabulary = n1 + n2;
    const length = N1 + N2;
    const calculatedLength = n1 * Math.log2(n1 || 1) + n2 * Math.log2(n2 || 1);
    const volume = length * Math.log2(vocabulary || 1);
    const difficulty = (n1 / 2) * (N2 / (n2 || 1));
    const effort = difficulty * volume;
    const time = effort / 18; // Seconds
    const bugs = volume / 3000; // Estimated bugs

    return {
      vocabulary,
      length,
      calculatedLength,
      volume,
      difficulty,
      effort,
      time,
      bugs,
      uniqueOperators: n1,
      uniqueOperands: n2,
      totalOperators: N1,
      totalOperands: N2
    };
  }

  /**
   * Calculate Maintainability Index
   * MI = 171 - 5.2 * ln(V) - 0.23 * G - 16.2 * ln(LOC) + 50 * sin(sqrt(2.4 * CM))
   * where V = Halstead Volume, G = Cyclomatic Complexity, CM = Comment percentage
   * 
   * Simplified version for file-level
   */
  calculateMaintainabilityIndex(volume, difficulty, loc, cloc) {
    const commentPercentage = loc > 0 ? (cloc / loc) * 100 : 0;

    // Simplified MI calculation
    let mi = 171;
    mi -= 5.2 * Math.log(volume || 1);
    mi -= 0.23 * difficulty;
    mi -= 16.2 * Math.log(loc || 1);
    mi += 50 * Math.sin(Math.sqrt(2.4 * commentPercentage));

    // Normalize to 0-100
    mi = Math.max(0, Math.min(100, mi));

    return Math.round(mi * 100) / 100;
  }

  /**
   * Count source lines (non-blank, non-comment)
   */
  countSourceLines(lines) {
    let count = 0;
    let inBlockComment = false;

    for (let line of lines) {
      line = line.trim();

      // Handle block comments
      if (line.includes('/*')) inBlockComment = true;
      if (line.includes('*/')) {
        inBlockComment = false;
        continue;
      }
      if (inBlockComment) continue;

      // Skip empty and single-line comments
      if (line === '' || line.startsWith('//')) continue;

      count++;
    }

    return count;
  }

  /**
   * Count comment lines
   */
  countCommentLines(lines) {
    let count = 0;
    let inBlockComment = false;

    for (let line of lines) {
      line = line.trim();

      if (line.includes('/*')) {
        inBlockComment = true;
        count++;
        continue;
      }

      if (inBlockComment) {
        count++;
        if (line.includes('*/')) {
          inBlockComment = false;
        }
        continue;
      }

      if (line.startsWith('//')) {
        count++;
      }
    }

    return count;
  }

  /**
   * Identify complexity issues
   */
  identifyIssues(fileMetrics, functionMetrics) {
    const issues = [];

    // File-level issues
    if (fileMetrics.maintainabilityIndex < this.thresholds.maintainability) {
      issues.push({
        type: 'complexity-issue',
        severity: 'HIGH',
        category: 'maintainability',
        description: `Low maintainability index: ${fileMetrics.maintainabilityIndex}`,
        recommendation: 'Refactor to improve code maintainability',
        filePath: fileMetrics.filePath,
        value: fileMetrics.maintainabilityIndex,
        threshold: this.thresholds.maintainability
      });
    }

    // Function-level issues
    functionMetrics.forEach(func => {
      if (func.cyclomaticComplexity > this.thresholds.cyclomatic) {
        issues.push({
          type: 'complexity-issue',
          severity: func.cyclomaticComplexity > this.thresholds.cyclomatic * 2 ? 'CRITICAL' : 'HIGH',
          category: 'cyclomatic-complexity',
          description: `Function '${func.name}' has high cyclomatic complexity: ${func.cyclomaticComplexity}`,
          recommendation: 'Break down into smaller functions',
          filePath: func.filePath,
          line: func.startLine,
          functionName: func.name,
          value: func.cyclomaticComplexity,
          threshold: this.thresholds.cyclomatic
        });
      }

      if (func.cognitiveComplexity > this.thresholds.cognitive) {
        issues.push({
          type: 'complexity-issue',
          severity: 'HIGH',
          category: 'cognitive-complexity',
          description: `Function '${func.name}' has high cognitive complexity: ${func.cognitiveComplexity}`,
          recommendation: 'Simplify logic and reduce nesting',
          filePath: func.filePath,
          line: func.startLine,
          functionName: func.name,
          value: func.cognitiveComplexity,
          threshold: this.thresholds.cognitive
        });
      }

      if (func.lines > this.thresholds.maxLines) {
        issues.push({
          type: 'complexity-issue',
          severity: 'MEDIUM',
          category: 'function-length',
          description: `Function '${func.name}' is too long: ${func.lines} lines`,
          recommendation: 'Break into smaller functions',
          filePath: func.filePath,
          line: func.startLine,
          functionName: func.name,
          value: func.lines,
          threshold: this.thresholds.maxLines
        });
      }

      if (func.parameters > this.thresholds.maxParameters) {
        issues.push({
          type: 'complexity-issue',
          severity: 'MEDIUM',
          category: 'parameter-count',
          description: `Function '${func.name}' has too many parameters: ${func.parameters}`,
          recommendation: 'Use parameter object or reduce parameter count',
          filePath: func.filePath,
          line: func.startLine,
          functionName: func.name,
          value: func.parameters,
          threshold: this.thresholds.maxParameters
        });
      }
    });

    return issues;
  }

  /**
   * Get complexity rating
   */
  getComplexityRating(complexity) {
    if (complexity <= 5) return 'Simple';
    if (complexity <= 10) return 'Moderate';
    if (complexity <= 20) return 'Complex';
    if (complexity <= 50) return 'Very Complex';
    return 'Extremely Complex';
  }

  /**
   * Get maintainability rating
   */
  getMaintainabilityRating(index) {
    if (index >= 85) return 'Excellent';
    if (index >= 65) return 'Good';
    if (index >= 50) return 'Fair';
    if (index >= 25) return 'Poor';
    return 'Critical';
  }

  /**
   * Analyze multiple files
   */
  async analyzeFiles(filePaths) {
    const results = [];

    for (const filePath of filePaths) {
      const result = await this.analyzeFile(filePath);
      results.push(result);
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
        timestamp: new Date().toISOString()
      },
      files: [],
      allIssues: []
    };

    results.forEach(result => {
      if (result.error) {
        report.files.push({
          filePath: result.filePath,
          error: result.error
        });
        return;
      }

      report.files.push({
        filePath: result.filePath,
        metrics: result.fileMetrics,
        functionCount: result.summary.totalFunctions,
        complexFunctionCount: result.summary.complexFunctions,
        issueCount: result.summary.issuesFound
      });

      report.allIssues.push(...result.issues);
    });

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
      console.log(`[ComplexityCalculator] ${message}`);
    }
  }
}

module.exports = {
  ComplexityCalculator
};

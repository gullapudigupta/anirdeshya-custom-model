/**
 * Custom Rule Engine
 * 
 * Allows users to define and run custom code quality rules.
 * 
 * Features:
 * - Rule definition language
 * - Pattern matching
 * - AST-based rules
 * - Regex-based rules
 * - Configurable severity
 * - Rule composition
 * - Rule templates
 * 
 * @module rules/custom-rule-engine
 */

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

/**
 * Custom Rule Engine
 */
class CustomRuleEngine {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.ruleFiles = options.ruleFiles || [];
    this.rulesDir = options.rulesDir || path.join(process.cwd(), '.quality-tool', 'rules');

    // Loaded rules
    this.rules = new Map();

    // Rule templates
    this.templates = this.initializeTemplates();

    // Statistics
    this.stats = {
      rulesLoaded: 0,
      rulesFailed: 0,
      filesAnalyzed: 0,
      issuesFound: 0
    };
  }

  /**
   * Initialize rule templates
   */
  initializeTemplates() {
    return {
      // Pattern matching template
      pattern: {
        name: 'Pattern Match Rule',
        description: 'Match code patterns using regex',
        schema: {
          pattern: 'string (regex)',
          severity: 'string',
          message: 'string'
        },
        executor: (rule, content, filePath) => {
          return this.executePatternRule(rule, content, filePath);
        }
      },

      // AST node template
      astNode: {
        name: 'AST Node Rule',
        description: 'Match AST node patterns',
        schema: {
          nodeType: 'string',
          condition: 'function',
          severity: 'string',
          message: 'string'
        },
        executor: (rule, content, filePath) => {
          return this.executeASTRule(rule, content, filePath);
        }
      },

      // Function complexity template
      functionComplexity: {
        name: 'Function Complexity Rule',
        description: 'Check function complexity',
        schema: {
          maxComplexity: 'number',
          severity: 'string',
          message: 'string'
        },
        executor: (rule, content, filePath) => {
          return this.executeFunctionComplexityRule(rule, content, filePath);
        }
      },

      // Naming convention template
      naming: {
        name: 'Naming Convention Rule',
        description: 'Enforce naming conventions',
        schema: {
          target: 'string (variable|function|class)',
          pattern: 'string (regex)',
          severity: 'string',
          message: 'string'
        },
        executor: (rule, content, filePath) => {
          return this.executeNamingRule(rule, content, filePath);
        }
      },

      // Import restriction template
      importRestriction: {
        name: 'Import Restriction Rule',
        description: 'Restrict specific imports',
        schema: {
          forbidden: 'array of strings',
          severity: 'string',
          message: 'string'
        },
        executor: (rule, content, filePath) => {
          return this.executeImportRestrictionRule(rule, content, filePath);
        }
      }
    };
  }

  /**
   * Load rules
   */
  async loadRules() {
    // Load from rule files
    for (const ruleFile of this.ruleFiles) {
      await this.loadRuleFile(ruleFile);
    }

    // Load from rules directory
    if (fs.existsSync(this.rulesDir)) {
      const files = fs.readdirSync(this.rulesDir);
      for (const file of files) {
        if (file.endsWith('.json') || file.endsWith('.js')) {
          await this.loadRuleFile(path.join(this.rulesDir, file));
        }
      }
    }

    this.log(`Loaded ${this.stats.rulesLoaded} custom rules`);
  }

  /**
   * Load rule file
   */
  async loadRuleFile(filePath) {
    try {
      const ext = path.extname(filePath);
      let ruleDefinitions;

      if (ext === '.json') {
        const content = fs.readFileSync(filePath, 'utf8');
        ruleDefinitions = JSON.parse(content);
      } else if (ext === '.js') {
        ruleDefinitions = require(filePath);
      } else {
        this.log(`Unsupported rule file format: ${filePath}`);
        return;
      }

      // Handle single rule or array
      const rules = Array.isArray(ruleDefinitions) ? ruleDefinitions : [ruleDefinitions];

      for (const rule of rules) {
        if (this.validateRule(rule)) {
          this.addRule(rule);
        } else {
          this.log(`Invalid rule in ${filePath}`);
          this.stats.rulesFailed++;
        }
      }

    } catch (error) {
      this.log(`Error loading rule file ${filePath}: ${error.message}`);
      this.stats.rulesFailed++;
    }
  }

  /**
   * Validate rule
   */
  validateRule(rule) {
    // Required fields
    if (!rule.id || !rule.name || !rule.severity) {
      return false;
    }

    // Must have either template or custom executor
    if (!rule.template && !rule.check) {
      return false;
    }

    // If using template, validate template exists
    if (rule.template && !this.templates[rule.template]) {
      this.log(`Unknown template: ${rule.template}`);
      return false;
    }

    return true;
  }

  /**
   * Add rule
   */
  addRule(rule) {
    this.rules.set(rule.id, rule);
    this.stats.rulesLoaded++;
    this.log(`Added rule: ${rule.id} - ${rule.name}`);
  }

  /**
   * Run rules on file
   */
  async runRules(filePath) {
    this.stats.filesAnalyzed++;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const issues = [];

      for (const [ruleId, rule] of this.rules) {
        try {
          const ruleIssues = await this.executeRule(rule, content, filePath);
          issues.push(...ruleIssues);
        } catch (error) {
          this.log(`Error executing rule ${ruleId}: ${error.message}`);
        }
      }

      this.stats.issuesFound += issues.length;

      return {
        filePath,
        issues,
        count: issues.length
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
   * Execute rule
   */
  async executeRule(rule, content, filePath) {
    if (rule.template) {
      // Use template executor
      const template = this.templates[rule.template];
      return template.executor(rule, content, filePath);
    } else if (rule.check) {
      // Custom check function
      return await this.executeCustomRule(rule, content, filePath);
    }

    return [];
  }

  /**
   * Execute custom rule
   */
  async executeCustomRule(rule, content, filePath) {
    try {
      const result = await rule.check(content, filePath);

      if (!result) return [];

      if (Array.isArray(result)) {
        return result.map(issue => ({
          ...issue,
          ruleId: rule.id,
          ruleName: rule.name,
          type: 'custom-rule'
        }));
      }

      return [{
        ...result,
        ruleId: rule.id,
        ruleName: rule.name,
        type: 'custom-rule'
      }];

    } catch (error) {
      this.log(`Error in custom rule ${rule.id}: ${error.message}`);
      return [];
    }
  }

  /**
   * Execute pattern rule
   */
  executePatternRule(rule, content, filePath) {
    const issues = [];
    const lines = content.split('\n');
    const pattern = new RegExp(rule.pattern, 'gm');

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      const line = lines[lineNumber - 1];

      issues.push({
        type: 'custom-rule',
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        description: rule.message || `Pattern match: ${rule.pattern}`,
        filePath,
        line: lineNumber,
        column: match.index - content.lastIndexOf('\n', match.index),
        code: line.trim(),
        match: match[0]
      });
    }

    return issues;
  }

  /**
   * Execute AST rule
   */
  executeASTRule(rule, content, filePath) {
    const issues = [];

    try {
      const ast = acorn.parse(content, {
        ecmaVersion: 2022,
        sourceType: 'module',
        locations: true
      });

      const lines = content.split('\n');

      walk.simple(ast, {
        [rule.nodeType]: (node) => {
          // Apply condition if provided
          if (rule.condition && !rule.condition(node)) {
            return;
          }

          issues.push({
            type: 'custom-rule',
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            description: rule.message || `AST node match: ${rule.nodeType}`,
            filePath,
            line: node.loc.start.line,
            column: node.loc.start.column,
            code: lines[node.loc.start.line - 1].trim()
          });
        }
      });

    } catch (error) {
      this.log(`Error parsing AST for ${filePath}: ${error.message}`);
    }

    return issues;
  }

  /**
   * Execute function complexity rule
   */
  executeFunctionComplexityRule(rule, content, filePath) {
    const issues = [];

    try {
      const ast = acorn.parse(content, {
        ecmaVersion: 2022,
        sourceType: 'module',
        locations: true
      });

      const lines = content.split('\n');

      const checkFunction = (node, name) => {
        const complexity = this.calculateComplexity(node);

        if (complexity > rule.maxComplexity) {
          issues.push({
            type: 'custom-rule',
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            description: rule.message || `Function '${name}' complexity (${complexity}) exceeds maximum (${rule.maxComplexity})`,
            filePath,
            line: node.loc.start.line,
            column: node.loc.start.column,
            code: lines[node.loc.start.line - 1].trim(),
            complexity,
            maxComplexity: rule.maxComplexity
          });
        }
      };

      walk.simple(ast, {
        FunctionDeclaration: (node) => {
          checkFunction(node, node.id ? node.id.name : '<anonymous>');
        },
        FunctionExpression: (node) => {
          checkFunction(node, node.id ? node.id.name : '<anonymous>');
        },
        ArrowFunctionExpression: (node) => {
          checkFunction(node, '<arrow>');
        }
      });

    } catch (error) {
      this.log(`Error analyzing functions in ${filePath}: ${error.message}`);
    }

    return issues;
  }

  /**
   * Execute naming rule
   */
  executeNamingRule(rule, content, filePath) {
    const issues = [];

    try {
      const ast = acorn.parse(content, {
        ecmaVersion: 2022,
        sourceType: 'module',
        locations: true
      });

      const lines = content.split('\n');
      const pattern = new RegExp(rule.pattern);

      const checkName = (node, name, type) => {
        if (!pattern.test(name)) {
          issues.push({
            type: 'custom-rule',
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            description: rule.message || `${type} '${name}' does not match naming convention: ${rule.pattern}`,
            filePath,
            line: node.loc.start.line,
            column: node.loc.start.column,
            code: lines[node.loc.start.line - 1].trim(),
            violatedName: name
          });
        }
      };

      walk.simple(ast, {
        VariableDeclarator: (node) => {
          if (rule.target === 'variable' && node.id.type === 'Identifier') {
            checkName(node, node.id.name, 'Variable');
          }
        },
        FunctionDeclaration: (node) => {
          if (rule.target === 'function' && node.id) {
            checkName(node, node.id.name, 'Function');
          }
        },
        ClassDeclaration: (node) => {
          if (rule.target === 'class' && node.id) {
            checkName(node, node.id.name, 'Class');
          }
        }
      });

    } catch (error) {
      this.log(`Error analyzing naming in ${filePath}: ${error.message}`);
    }

    return issues;
  }

  /**
   * Execute import restriction rule
   */
  executeImportRestrictionRule(rule, content, filePath) {
    const issues = [];

    try {
      const ast = acorn.parse(content, {
        ecmaVersion: 2022,
        sourceType: 'module',
        locations: true
      });

      const lines = content.split('\n');
      const forbidden = rule.forbidden || [];

      walk.simple(ast, {
        ImportDeclaration: (node) => {
          const source = node.source.value;

          if (forbidden.some(f => source.includes(f))) {
            issues.push({
              type: 'custom-rule',
              ruleId: rule.id,
              ruleName: rule.name,
              severity: rule.severity,
              description: rule.message || `Import of '${source}' is restricted`,
              filePath,
              line: node.loc.start.line,
              column: node.loc.start.column,
              code: lines[node.loc.start.line - 1].trim(),
              import: source
            });
          }
        }
      });

    } catch (error) {
      this.log(`Error analyzing imports in ${filePath}: ${error.message}`);
    }

    return issues;
  }

  /**
   * Calculate cyclomatic complexity (simplified)
   */
  calculateComplexity(node) {
    let complexity = 1;

    walk.simple(node, {
      IfStatement: () => { complexity++; },
      WhileStatement: () => { complexity++; },
      ForStatement: () => { complexity++; },
      ForInStatement: () => { complexity++; },
      ForOfStatement: () => { complexity++; },
      SwitchCase: (n) => { if (n.test) complexity++; },
      LogicalExpression: (n) => {
        if (n.operator === '||' || n.operator === '&&') complexity++;
      },
      ConditionalExpression: () => { complexity++; },
      CatchClause: () => { complexity++; }
    });

    return complexity;
  }

  /**
   * Get rule
   */
  getRule(ruleId) {
    return this.rules.get(ruleId);
  }

  /**
   * List rules
   */
  listRules() {
    return Array.from(this.rules.values()).map(rule => ({
      id: rule.id,
      name: rule.name,
      severity: rule.severity,
      description: rule.description,
      template: rule.template
    }));
  }

  /**
   * Get templates
   */
  getTemplates() {
    return Object.entries(this.templates).map(([id, template]) => ({
      id,
      name: template.name,
      description: template.description,
      schema: template.schema
    }));
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
      issues: []
    };

    const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [], INFO: [] };

    results.forEach(result => {
      result.issues.forEach(issue => {
        if (bySeverity[issue.severity]) {
          bySeverity[issue.severity].push(issue);
        }
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
    return {
      ...this.stats,
      activeRules: this.rules.size
    };
  }

  log(message) {
    if (this.verbose) {
      console.log(`[CustomRuleEngine] ${message}`);
    }
  }
}

module.exports = {
  CustomRuleEngine
};

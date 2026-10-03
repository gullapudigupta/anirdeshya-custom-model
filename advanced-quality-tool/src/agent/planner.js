/**
 * Agent Planner (P9-T010)
 *
 * Produces reviewable execution plans from coding requests or tasks.
 * Plans include ordered steps, affected files, expected checks, and risks.
 *
 * @module agent/planner
 */

'use strict';

/**
 * Execution Plan
 * @typedef {Object} ExecutionPlan
 * @property {Array<Object>} steps - Ordered execution steps
 * @property {Array<string>} affectedFiles - Files that will be modified
 * @property {Array<Object>} expectedChecks - Verification checks to run
 * @property {Array<Object>} risks - Identified risks
 * @property {Object} metadata - Additional plan metadata
 */

class AgentPlanner {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.contextProvider = options.contextProvider || null;
    this.guidanceProvider = options.guidanceProvider || null;
  }

  /**
   * Create an execution plan from a request or task
   * @param {Object} params
   * @param {string} params.description - Task or request description
   * @param {Array<string>} [params.deliverables] - Expected deliverables
   * @param {Array<string>} [params.dependencies] - Task dependencies
   * @param {Object} [params.context] - Additional context
   * @returns {Promise<ExecutionPlan>}
   */
  async plan(params) {
    const {
      description,
      deliverables = [],
      dependencies = [],
      context = {}
    } = params;

    // 1. Analyze the request
    const analysis = this._analyzeRequest(description, deliverables);

    // 2. Identify affected files
    const affectedFiles = await this._identifyAffectedFiles(analysis, context);

    // 3. Break down into steps
    const steps = this._generateSteps(analysis, affectedFiles, deliverables);

    // 4. Identify expected checks
    const expectedChecks = this._identifyChecks(analysis, affectedFiles);

    // 5. Assess risks
    const risks = this._assessRisks(analysis, affectedFiles, steps);

    return {
      steps,
      affectedFiles,
      expectedChecks,
      risks,
      metadata: {
        description,
        deliverables,
        dependencies,
        estimatedComplexity: this._estimateComplexity(steps, affectedFiles),
        requiresApproval: this._requiresApproval(risks, affectedFiles),
        createdAt: new Date().toISOString()
      }
    };
  }

  /**
   * Validate a plan before execution
   * @param {ExecutionPlan} plan
   * @returns {Object} { valid: boolean, issues: string[] }
   */
  validatePlan(plan) {
    const issues = [];

    if (!plan.steps || plan.steps.length === 0) {
      issues.push('Plan has no execution steps');
    }

    if (!plan.affectedFiles || plan.affectedFiles.length === 0) {
      issues.push('Plan does not identify any affected files');
    }

    // Check for circular step dependencies
    if (this._hasCircularDependencies(plan.steps)) {
      issues.push('Plan has circular step dependencies');
    }

    // Check for high-risk operations without appropriate safeguards
    const highRisks = plan.risks.filter(r => r.level === 'high' || r.level === 'critical');
    if (highRisks.length > 0 && !plan.metadata.requiresApproval) {
      issues.push('Plan has high-risk operations but does not require approval');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  // ─── Private methods ──────────────────────────────────────────────────────────

  _analyzeRequest(description, deliverables) {
    // Extract key information from the request
    const analysis = {
      type: this._classifyRequestType(description),
      scope: this._determineScope(description, deliverables),
      technologies: this._identifyTechnologies(description),
      operations: this._identifyOperations(description)
    };

    return analysis;
  }

  _classifyRequestType(description) {
    const lower = description.toLowerCase();
    if (lower.includes('fix') || lower.includes('bug')) return 'fix';
    if (lower.includes('add') || lower.includes('implement') || lower.includes('create')) return 'feature';
    if (lower.includes('refactor') || lower.includes('improve')) return 'refactor';
    if (lower.includes('test')) return 'test';
    if (lower.includes('document')) return 'documentation';
    return 'general';
  }

  _determineScope(description, deliverables) {
    const fileCount = deliverables.length;
    if (fileCount === 0) return 'unknown';
    if (fileCount === 1) return 'single-file';
    if (fileCount <= 5) return 'small';
    if (fileCount <= 20) return 'medium';
    return 'large';
  }

  _identifyTechnologies(description) {
    const techs = [];
    const lower = description.toLowerCase();
    
    if (lower.includes('javascript') || lower.includes('js')) techs.push('javascript');
    if (lower.includes('typescript') || lower.includes('ts')) techs.push('typescript');
    if (lower.includes('python')) techs.push('python');
    if (lower.includes('java')) techs.push('java');
    if (lower.includes('c#') || lower.includes('csharp')) techs.push('csharp');
    if (lower.includes('react')) techs.push('react');
    if (lower.includes('node')) techs.push('node');
    if (lower.includes('api') || lower.includes('rest')) techs.push('api');
    if (lower.includes('database') || lower.includes('sql')) techs.push('database');
    
    return techs;
  }

  _identifyOperations(description) {
    const ops = [];
    const lower = description.toLowerCase();
    
    if (lower.includes('read') || lower.includes('fetch') || lower.includes('get')) ops.push('read');
    if (lower.includes('write') || lower.includes('create') || lower.includes('add')) ops.push('write');
    if (lower.includes('update') || lower.includes('modify') || lower.includes('change')) ops.push('update');
    if (lower.includes('delete') || lower.includes('remove')) ops.push('delete');
    if (lower.includes('test')) ops.push('test');
    if (lower.includes('deploy')) ops.push('deploy');
    
    return ops;
  }

  async _identifyAffectedFiles(analysis, context) {
    // In a real implementation, this would use workspace search,
    // symbol references, and code analysis to find affected files
    const files = [];
    
    // For now, extract from context if provided
    if (context.files) {
      files.push(...context.files);
    }
    
    return files;
  }

  _generateSteps(analysis, affectedFiles, deliverables) {
    const steps = [];
    let stepId = 1;

    // Generate steps based on request type and deliverables
    if (analysis.type === 'feature') {
      steps.push({
        id: stepId++,
        description: 'Read and understand existing code structure',
        type: 'analysis',
        files: affectedFiles,
        dependencies: []
      });
      
      for (const deliverable of deliverables) {
        steps.push({
          id: stepId++,
          description: `Implement: ${deliverable}`,
          type: 'implementation',
          files: affectedFiles,
          dependencies: [stepId - 2]
        });
      }
      
      steps.push({
        id: stepId++,
        description: 'Verify implementation meets requirements',
        type: 'verification',
        files: affectedFiles,
        dependencies: [stepId - 2]
      });
    } else if (analysis.type === 'fix') {
      steps.push({
        id: stepId++,
        description: 'Analyze bug and identify root cause',
        type: 'analysis',
        files: affectedFiles,
        dependencies: []
      });
      
      steps.push({
        id: stepId++,
        description: 'Implement fix',
        type: 'fix',
        files: affectedFiles,
        dependencies: [1]
      });
      
      steps.push({
        id: stepId++,
        description: 'Verify fix resolves issue',
        type: 'verification',
        files: affectedFiles,
        dependencies: [2]
      });
    } else {
      // General workflow
      steps.push({
        id: stepId++,
        description: 'Analyze request and gather context',
        type: 'analysis',
        files: affectedFiles,
        dependencies: []
      });
      
      steps.push({
        id: stepId++,
        description: 'Execute requested changes',
        type: 'implementation',
        files: affectedFiles,
        dependencies: [1]
      });
      
      steps.push({
        id: stepId++,
        description: 'Verify changes are correct',
        type: 'verification',
        files: affectedFiles,
        dependencies: [2]
      });
    }

    return steps;
  }

  _identifyChecks(analysis, affectedFiles) {
    const checks = [];
    
    // Syntax/lint checks
    checks.push({
      type: 'lint',
      description: 'Run configured linters',
      required: true,
      files: affectedFiles
    });

    // Type checks for TypeScript
    if (analysis.technologies.includes('typescript')) {
      checks.push({
        type: 'typecheck',
        description: 'Run TypeScript type checker',
        required: true,
        files: affectedFiles
      });
    }

    // Tests
    if (analysis.type !== 'documentation') {
      checks.push({
        type: 'test',
        description: 'Run relevant test suites',
        required: true,
        files: affectedFiles
      });
    }

    // Build check
    checks.push({
      type: 'build',
      description: 'Verify project builds successfully',
      required: false,
      files: affectedFiles
    });

    return checks;
  }

  _assessRisks(analysis, affectedFiles, steps) {
    const risks = [];

    // File count risk
    if (affectedFiles.length > 10) {
      risks.push({
        level: 'medium',
        category: 'scope',
        description: `Large number of affected files (${affectedFiles.length})`,
        mitigation: 'Consider breaking into smaller tasks'
      });
    }

    // Destructive operations
    if (analysis.operations.includes('delete')) {
      risks.push({
        level: 'high',
        category: 'data-loss',
        description: 'Task involves delete operations',
        mitigation: 'Requires user approval; ensure backups exist'
      });
    }

    // Deployment risk
    if (analysis.operations.includes('deploy')) {
      risks.push({
        level: 'critical',
        category: 'production',
        description: 'Task involves deployment to production',
        mitigation: 'Requires explicit approval and rollback plan'
      });
    }

    // Database operations
    if (analysis.technologies.includes('database')) {
      risks.push({
        level: 'high',
        category: 'data',
        description: 'Task involves database modifications',
        mitigation: 'Ensure migrations are reversible and tested'
      });
    }

    // Complex step chain
    if (steps.length > 10) {
      risks.push({
        level: 'low',
        category: 'complexity',
        description: `Complex execution plan with ${steps.length} steps`,
        mitigation: 'Monitor progress carefully and handle failures gracefully'
      });
    }

    return risks;
  }

  _estimateComplexity(steps, affectedFiles) {
    let score = 0;
    score += steps.length * 10;
    score += affectedFiles.length * 5;
    
    if (score < 50) return 'low';
    if (score < 150) return 'medium';
    if (score < 300) return 'high';
    return 'very-high';
  }

  _requiresApproval(risks, affectedFiles) {
    // Require approval for high/critical risks
    const highRisks = risks.filter(r => r.level === 'high' || r.level === 'critical');
    if (highRisks.length > 0) return true;

    // Require approval for large file changes
    if (affectedFiles.length > 20) return true;

    return false;
  }

  _hasCircularDependencies(steps) {
    const visited = new Set();
    const recursionStack = new Set();

    const hasCycle = (stepId) => {
      visited.add(stepId);
      recursionStack.add(stepId);

      const step = steps.find(s => s.id === stepId);
      if (!step) return false;

      for (const depId of step.dependencies || []) {
        if (!visited.has(depId)) {
          if (hasCycle(depId)) return true;
        } else if (recursionStack.has(depId)) {
          return true;
        }
      }

      recursionStack.delete(stepId);
      return false;
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        if (hasCycle(step.id)) return true;
      }
    }

    return false;
  }
}

module.exports = {
  AgentPlanner
};

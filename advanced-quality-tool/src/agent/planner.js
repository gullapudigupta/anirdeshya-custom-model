/**
 * Agent Planner (P9-T010)
 *
 * Produces reviewable execution plans from coding requests or tasks.
 * Plans include ordered steps, affected files, expected checks, and risks.
 *
 * @module agent/planner
 */

'use strict';

const path = require('path');
const { CONTRACT_VERSION, validatePlan } = require('./contracts');

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
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.contextProvider = options.contextProvider || null;
    this.guidanceProvider = options.guidanceProvider || null;
    this.planExecutor = options.planExecutor || null;
    this.maxSteps = options.maxSteps ?? 20;
    this.maxFiles = options.maxFiles ?? 50;
    this.maxFilesBeforeApproval = options.maxFilesBeforeApproval ?? 20;
    for (const [name, value] of Object.entries({
      maxSteps: this.maxSteps,
      maxFiles: this.maxFiles,
      maxFilesBeforeApproval: this.maxFilesBeforeApproval
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive safe integer`);
      }
    }
  }

  /**
   * Create an execution plan from a request or task
   * @param {Object} params
   * @param {string} params.description - Task or request description
   * @param {Array<string>} [params.deliverables] - Expected deliverables
   * @param {Array<string>} [params.dependencies] - Task dependencies
   * @param {Array<string>} [params.acceptanceCriteria] - Required task outcomes
   * @param {Object} [params.context] - Additional context
   * @returns {Promise<ExecutionPlan>}
   */
  async plan(params) {
    const {
      description,
      deliverables = [],
      dependencies = [],
      acceptanceCriteria = [],
      context = {}
    } = params;

    const taskCriteria = acceptanceCriteria.length
      ? acceptanceCriteria
      : (deliverables.length ? deliverables : [description]);
    if (this.planExecutor) {
      const executor = typeof this.planExecutor === 'function'
        ? this.planExecutor
        : this.planExecutor.createPlan || this.planExecutor.plan || this.planExecutor.execute;
      if (typeof executor !== 'function') {
        throw new Error('Plan executor must be a function or expose createPlan(), plan(), or execute()');
      }
      const generated = await executor.call(this.planExecutor, {
        task: { description, deliverables, dependencies, acceptanceCriteria: taskCriteria },
        context,
        workspace: this.workspace,
        limits: { maxSteps: this.maxSteps, maxFiles: this.maxFiles }
      });
      if (!generated || typeof generated !== 'object' || Array.isArray(generated)) {
        throw new Error('Plan executor returned no structured plan');
      }
      return {
        ...generated,
        planVersion: generated.planVersion ?? 1,
        acceptanceCriteria: taskCriteria
      };
    }

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
      schemaVersion: CONTRACT_VERSION,
      steps,
      affectedFiles,
      expectedChecks,
      risks,
      planVersion: 1,
      acceptanceCriteria: taskCriteria,
      verificationCommands: expectedChecks.map(check => ({ checkId: check.type })),
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
  validatePlan(plan, options = {}) {
    const issues = [];

    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
      return { valid: false, issues: ['Plan must be an object'] };
    }
    if (plan.planVersion !== 1) issues.push('Plan must have planVersion 1');
    if (!Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > this.maxSteps) {
      issues.push(`Plan must contain between 1 and ${this.maxSteps} actionable steps`);
    }
    if (!Array.isArray(plan.affectedFiles) || plan.affectedFiles.length === 0 ||
        plan.affectedFiles.length > this.maxFiles) {
      issues.push(`Plan must contain between 1 and ${this.maxFiles} affected files`);
    }
    if (!Array.isArray(plan.acceptanceCriteria) || plan.acceptanceCriteria.length === 0 ||
        plan.acceptanceCriteria.some(value => typeof value !== 'string' || !value.trim())) {
      issues.push('Plan must include non-empty acceptance criteria');
    }
    if (!Array.isArray(plan.expectedChecks) || plan.expectedChecks.length === 0 ||
        plan.expectedChecks.some(check =>
          !check || typeof check !== 'object' || Array.isArray(check) ||
          typeof (check.checkId || check.type) !== 'string' ||
          !/^[a-z][a-z0-9_-]*$/.test(check.checkId || check.type) ||
          Object.prototype.hasOwnProperty.call(check, 'command'))) {
      issues.push('Plan must specify required verification checks');
    }
    if (!Array.isArray(plan.verificationCommands) || plan.verificationCommands.length === 0 ||
        plan.verificationCommands.some(command =>
          !command || typeof command.checkId !== 'string' ||
          Object.keys(command).some(key => key !== 'checkId') ||
          !/^[a-z][a-z0-9_-]*$/.test(command.checkId) ||
          !Array.isArray(plan.expectedChecks) ||
          !plan.expectedChecks.some(check => check &&
            (check.checkId === command.checkId || check.type === command.checkId)))) {
      issues.push('Plan must specify verification commands by registered check ID');
    }
    if (!Array.isArray(plan.risks) || !plan.metadata || typeof plan.metadata !== 'object' ||
        typeof plan.metadata.requiresApproval !== 'boolean') {
      issues.push('Plan must include risks and an explicit approval requirement');
    }

    const affectedFiles = Array.isArray(plan.affectedFiles) ? plan.affectedFiles : [];
    const normalizedFiles = new Set();
    for (const file of affectedFiles) {
      const normalized = normalizeWorkspacePath(file);
      if (!normalized) {
        issues.push(`Affected file is outside workspace scope: ${file}`);
        continue;
      }
      if (normalizedFiles.has(normalized)) issues.push(`Duplicate affected file: ${file}`);
      normalizedFiles.add(normalized);
      if (Array.isArray(options.allowedFiles) &&
          !options.allowedFiles.some(allowed => normalizeWorkspacePath(allowed) === normalized)) {
        issues.push(`Affected file is outside the requested scope: ${file}`);
      }
    }
    for (const check of Array.isArray(plan.expectedChecks) ? plan.expectedChecks : []) {
      if (check && Array.isArray(check.files)) {
        for (const file of check.files) {
          if (!normalizedFiles.has(normalizeWorkspacePath(file))) {
            issues.push(`Verification check references a file outside the affected-file set: ${file}`);
          }
        }
      }
    }

    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const stepIndexes = new Map();
    steps.forEach((step, index) => {
      if (!step || (typeof step.id !== 'string' && typeof step.id !== 'number') ||
          typeof step.description !== 'string' || !step.description.trim()) {
        issues.push('Every plan step must have an id and actionable description');
        return;
      }
      const id = String(step.id);
      if (stepIndexes.has(id)) issues.push(`Duplicate step id: ${step.id}`);
      stepIndexes.set(id, index);
      if (Array.isArray(step.files)) {
        for (const file of step.files) {
          if (!normalizedFiles.has(normalizeWorkspacePath(file))) {
            issues.push(`Step ${step.id} references a file outside the affected-file set: ${file}`);
          }
        }
      } else {
        issues.push(`Step ${step.id} must declare its affected files`);
      }
    });
    steps.forEach(step => {
      if (!step || !Array.isArray(step.dependencies)) {
        if (step) issues.push(`Step ${step.id} must declare dependencies`);
        return;
      }
      for (const dependency of step.dependencies) {
        const dependencyIndex = stepIndexes.get(String(dependency));
        if (dependencyIndex === undefined) {
          issues.push(`Unresolved step dependency: ${dependency}`);
        } else if (dependencyIndex >= stepIndexes.get(String(step.id))) {
          issues.push(`Step dependency must precede its dependent step: ${dependency}`);
        }
      }
    });

    const highRisks = Array.isArray(plan.risks)
      ? plan.risks.filter(risk => risk && (risk.level === 'high' || risk.level === 'critical'))
      : [];
    const destructiveSteps = steps.some(step => step &&
      ['delete', 'destructive'].includes(String(step.type || '').toLowerCase()));
    const approvalRequired = highRisks.length > 0 || destructiveSteps ||
      affectedFiles.length > this.maxFilesBeforeApproval;
    if (approvalRequired && plan.metadata?.requiresApproval !== true) {
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
      files.push(...context.files.map(file => typeof file === 'string' ? file : file.path));
    }
    if (context.scopeFiles) files.push(...context.scopeFiles);
    
    return [...new Set(files.filter(file => typeof file === 'string'))];
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

function normalizeWorkspacePath(file) {
  if (typeof file !== 'string' || !file.trim() || file.includes('\0') ||
      path.isAbsolute(file) || path.win32.isAbsolute(file)) return null;
  const segments = file.replace(/\\/g, '/').split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes(':'))) return null;
  return segments.join('/');
}

module.exports = {
  AgentPlanner
};

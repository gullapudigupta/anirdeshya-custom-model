/**
 * Task Scope Analysis and Decomposition Gate (P9-T021)
 *
 * Classifies tasks as atomic, bounded, broad, ambiguous, or multi-requirement.
 * Detects scope issues and proposes decomposition before implementation begins.
 *
 * @module agent/scope-analyzer
 */

'use strict';

/**
 * Task scope classifications
 */
const ScopeType = {
  ATOMIC: 'atomic',                   // Single, well-defined change
  BOUNDED: 'bounded',                 // Multi-file but clearly scoped
  BROAD: 'broad',                     // Many files or unclear boundaries
  AMBIGUOUS: 'ambiguous',             // Unclear requirements
  MULTI_REQUIREMENT: 'multi-requirement' // Multiple independent outcomes
};

/**
 * Scope issues
 */
const ScopeIssue = {
  MULTIPLE_OUTCOMES: 'multiple-independent-outcomes',
  EXCESSIVE_FILE_SCOPE: 'excessive-file-scope',
  MISSING_ACCEPTANCE: 'missing-acceptance-criteria',
  UNRESOLVED_DEPENDENCIES: 'unresolved-dependencies',
  AMBIGUOUS_REQUIREMENTS: 'ambiguous-requirements',
  CONFLICTING_REQUIREMENTS: 'conflicting-requirements'
};

/**
 * Task Scope Analyzer
 */
class TaskScopeAnalyzer {
  constructor(options = {}) {
    this.thresholds = {
      maxAtomicFiles: options.maxAtomicFiles || 3,
      maxBoundedFiles: options.maxBoundedFiles || 10,
      minDeliverableLength: options.minDeliverableLength || 10,
      maxDeliverablesForAtomic: options.maxDeliverablesForAtomic || 2
    };
  }

  /**
   * Analyze task scope
   * @param {Object} task
   * @param {string} task.description - Task description
   * @param {Array<string>} [task.deliverables] - Expected deliverables
   * @param {Array<string>} [task.dependencies] - Task dependencies
   * @param {Array<string>} [task.acceptanceCriteria] - Acceptance criteria
   * @param {Object} [task.context] - Additional context
   * @returns {Object} Analysis result
   */
  analyze(task) {
    const analysis = {
      scopeType: null,
      issues: [],
      metrics: {},
      recommendations: [],
      decompositionRequired: false,
      proposedSubtasks: []
    };

    // 1. Extract metrics
    analysis.metrics = this._extractMetrics(task);

    // 2. Classify scope
    analysis.scopeType = this._classifyScope(task, analysis.metrics);

    // 3. Detect issues
    analysis.issues = this._detectIssues(task, analysis.metrics);

    // 4. Generate recommendations
    analysis.recommendations = this._generateRecommendations(task, analysis);

    // 5. Determine if decomposition is needed
    analysis.decompositionRequired = this._requiresDecomposition(analysis);

    // 6. Propose subtasks if needed
    if (analysis.decompositionRequired) {
      analysis.proposedSubtasks = this._proposeSubtasks(task, analysis);
    }

    return analysis;
  }

  /**
   * Validate task is ready for implementation
   * @param {Object} task
   * @returns {Object} { ready: boolean, reason: string, analysis: Object }
   */
  validateReadiness(task) {
    const analysis = this.analyze(task);

    // Block if decomposition is required
    if (analysis.decompositionRequired) {
      return {
        ready: false,
        reason: 'Task requires decomposition before implementation',
        analysis
      };
    }

    // Block if critical issues exist
    const criticalIssues = [
      ScopeIssue.AMBIGUOUS_REQUIREMENTS,
      ScopeIssue.CONFLICTING_REQUIREMENTS,
      ScopeIssue.MISSING_ACCEPTANCE
    ];

    const hasCriticalIssues = analysis.issues.some(issue => 
      criticalIssues.includes(issue.type)
    );

    if (hasCriticalIssues) {
      return {
        ready: false,
        reason: 'Task has critical scope issues that must be resolved',
        analysis
      };
    }

    // Warn but allow for minor issues
    if (analysis.issues.length > 0) {
      return {
        ready: true,
        reason: 'Task has minor scope issues but can proceed',
        analysis,
        warnings: analysis.issues.map(i => i.description)
      };
    }

    return {
      ready: true,
      reason: null,
      analysis
    };
  }

  // ─── Private methods ──────────────────────────────────────────────────────────

  _extractMetrics(task) {
    const description = task.description || '';
    const deliverables = task.deliverables || [];
    const acceptanceCriteria = task.acceptanceCriteria || [];
    const dependencies = task.dependencies || [];

    return {
      descriptionLength: description.length,
      deliverableCount: deliverables.length,
      acceptanceCriteriaCount: acceptanceCriteria.length,
      dependencyCount: dependencies.length,
      
      // Heuristics from description
      hasMultipleVerbs: this._countActionVerbs(description) > 2,
      hasAndConjunctions: (description.match(/\sand\s/gi) || []).length,
      hasOrConjunctions: (description.match(/\sor\s/gi) || []).length,
      hasFileReferences: (description.match(/\.(js|ts|py|java|cs|go|rb|php)\b/gi) || []).length,
      
      // Deliverable analysis
      averageDeliverableLength: deliverables.length > 0
        ? deliverables.reduce((sum, d) => sum + d.length, 0) / deliverables.length
        : 0,
      hasVagueDeliverables: deliverables.some(d => this._isVague(d))
    };
  }

  _classifyScope(task, metrics) {
    const { deliverableCount, hasMultipleVerbs, hasAndConjunctions } = metrics;

    // Multi-requirement: multiple independent outcomes
    if (deliverableCount > 5 || (hasAndConjunctions > 3 && hasMultipleVerbs)) {
      return ScopeType.MULTI_REQUIREMENT;
    }

    // Ambiguous: unclear or vague requirements
    if (metrics.hasVagueDeliverables || 
        (deliverableCount === 0 && metrics.descriptionLength < 50)) {
      return ScopeType.AMBIGUOUS;
    }

    // Atomic: single, well-defined change
    if (deliverableCount <= this.thresholds.maxDeliverablesForAtomic &&
        metrics.hasFileReferences <= this.thresholds.maxAtomicFiles &&
        !hasMultipleVerbs) {
      return ScopeType.ATOMIC;
    }

    // Bounded: multi-file but clearly scoped
    if (deliverableCount <= 5 &&
        metrics.hasFileReferences <= this.thresholds.maxBoundedFiles &&
        metrics.acceptanceCriteriaCount > 0) {
      return ScopeType.BOUNDED;
    }

    // Default: broad
    return ScopeType.BROAD;
  }

  _detectIssues(task, metrics) {
    const issues = [];

    // Multiple independent outcomes
    if (metrics.hasOrConjunctions > 1) {
      issues.push({
        type: ScopeIssue.MULTIPLE_OUTCOMES,
        severity: 'high',
        description: 'Task appears to have multiple independent outcomes (uses "or" conjunctions)',
        evidence: `Found ${metrics.hasOrConjunctions} "or" conjunctions in description`
      });
    }

    if (metrics.deliverableCount > 8) {
      issues.push({
        type: ScopeIssue.MULTIPLE_OUTCOMES,
        severity: 'high',
        description: 'Too many deliverables for a single task',
        evidence: `${metrics.deliverableCount} deliverables (recommended: ≤ 8)`
      });
    }

    // Excessive file scope
    if (metrics.hasFileReferences > this.thresholds.maxBoundedFiles) {
      issues.push({
        type: ScopeIssue.EXCESSIVE_FILE_SCOPE,
        severity: 'medium',
        description: 'Task affects too many files',
        evidence: `${metrics.hasFileReferences} file references (recommended: ≤ ${this.thresholds.maxBoundedFiles})`
      });
    }

    // Missing acceptance criteria
    if (metrics.acceptanceCriteriaCount === 0 && 
        metrics.deliverableCount > 2) {
      issues.push({
        type: ScopeIssue.MISSING_ACCEPTANCE,
        severity: 'high',
        description: 'No acceptance criteria defined for multi-deliverable task',
        evidence: `${metrics.deliverableCount} deliverables but 0 acceptance criteria`
      });
    }

    // Ambiguous requirements
    if (metrics.hasVagueDeliverables) {
      issues.push({
        type: ScopeIssue.AMBIGUOUS_REQUIREMENTS,
        severity: 'high',
        description: 'Some deliverables are vague or unclear',
        evidence: 'Found deliverables with unclear wording'
      });
    }

    if (metrics.descriptionLength < 20) {
      issues.push({
        type: ScopeIssue.AMBIGUOUS_REQUIREMENTS,
        severity: 'medium',
        description: 'Task description is too brief',
        evidence: `Description is only ${metrics.descriptionLength} characters`
      });
    }

    // Unresolved dependencies
    if (metrics.dependencyCount > 5) {
      issues.push({
        type: ScopeIssue.UNRESOLVED_DEPENDENCIES,
        severity: 'medium',
        description: 'Task has many dependencies',
        evidence: `${metrics.dependencyCount} dependencies (may indicate task is too broad)`
      });
    }

    return issues;
  }

  _generateRecommendations(task, analysis) {
    const recommendations = [];
    const { scopeType, issues, metrics } = analysis;

    // Scope-specific recommendations
    if (scopeType === ScopeType.MULTI_REQUIREMENT) {
      recommendations.push({
        type: 'decompose',
        priority: 'high',
        action: 'Split into separate tasks',
        rationale: 'Task has multiple independent outcomes that should be implemented separately'
      });
    }

    if (scopeType === ScopeType.BROAD) {
      recommendations.push({
        type: 'clarify',
        priority: 'high',
        action: 'Narrow the scope or split into subtasks',
        rationale: 'Task scope is too broad for effective implementation'
      });
    }

    if (scopeType === ScopeType.AMBIGUOUS) {
      recommendations.push({
        type: 'clarify',
        priority: 'critical',
        action: 'Define clear requirements and acceptance criteria',
        rationale: 'Requirements are unclear or incomplete'
      });
    }

    // Issue-specific recommendations
    for (const issue of issues) {
      if (issue.type === ScopeIssue.MISSING_ACCEPTANCE) {
        recommendations.push({
          type: 'add-criteria',
          priority: 'high',
          action: 'Add acceptance criteria',
          rationale: 'Acceptance criteria needed to verify completion'
        });
      }

      if (issue.type === ScopeIssue.EXCESSIVE_FILE_SCOPE) {
        recommendations.push({
          type: 'reduce-scope',
          priority: 'medium',
          action: 'Reduce file scope or split by module/component',
          rationale: 'Large file scope increases implementation risk'
        });
      }
    }

    return recommendations;
  }

  _requiresDecomposition(analysis) {
    const { scopeType, issues } = analysis;

    // Always decompose multi-requirement tasks
    if (scopeType === ScopeType.MULTI_REQUIREMENT) {
      return true;
    }

    // Decompose broad tasks with multiple high-severity issues
    if (scopeType === ScopeType.BROAD) {
      const highSeverityCount = issues.filter(i => i.severity === 'high').length;
      if (highSeverityCount >= 2) {
        return true;
      }
    }

    // Decompose if multiple outcomes detected
    const hasMultipleOutcomes = issues.some(i => i.type === ScopeIssue.MULTIPLE_OUTCOMES);
    if (hasMultipleOutcomes) {
      return true;
    }

    return false;
  }

  _proposeSubtasks(task, analysis) {
    const subtasks = [];
    const deliverables = task.deliverables || [];
    const description = task.description || '';

    // Strategy 1: Split by deliverables
    if (deliverables.length > 3) {
      // Group related deliverables
      const groups = this._groupDeliverables(deliverables);
      
      for (let i = 0; i < groups.length; i++) {
        subtasks.push({
          id: `${task.id || 'task'}-sub-${i + 1}`,
          description: `${description.split('.')[0]} - Part ${i + 1}`,
          deliverables: groups[i],
          dependencies: i === 0 ? task.dependencies : [`${task.id}-sub-${i}`]
        });
      }

      return subtasks;
    }

    // Strategy 2: Split by phases (analysis, implementation, verification)
    if (analysis.scopeType === ScopeType.BROAD) {
      subtasks.push({
        id: `${task.id || 'task'}-analysis`,
        description: `Analyze and plan: ${description}`,
        deliverables: ['Analysis document', 'Implementation plan'],
        dependencies: task.dependencies || []
      });

      subtasks.push({
        id: `${task.id || 'task'}-implement`,
        description: `Implement: ${description}`,
        deliverables: deliverables,
        dependencies: [`${task.id}-analysis`]
      });

      subtasks.push({
        id: `${task.id || 'task'}-verify`,
        description: `Verify and test: ${description}`,
        deliverables: ['Tests passing', 'Documentation updated'],
        dependencies: [`${task.id}-implement`]
      });

      return subtasks;
    }

    // Strategy 3: Split by conjunction points
    const sentences = description.split(/[.;]/).filter(s => s.trim().length > 0);
    if (sentences.length > 2) {
      for (let i = 0; i < sentences.length; i++) {
        subtasks.push({
          id: `${task.id || 'task'}-sub-${i + 1}`,
          description: sentences[i].trim(),
          deliverables: deliverables.slice(
            Math.floor(i * deliverables.length / sentences.length),
            Math.floor((i + 1) * deliverables.length / sentences.length)
          ),
          dependencies: i === 0 ? task.dependencies : [`${task.id}-sub-${i}`]
        });
      }
    }

    return subtasks.length > 0 ? subtasks : [
      {
        id: `${task.id || 'task'}-sub-1`,
        description: `${description} - Part 1`,
        deliverables: deliverables.slice(0, Math.ceil(deliverables.length / 2)),
        dependencies: task.dependencies || []
      },
      {
        id: `${task.id || 'task'}-sub-2`,
        description: `${description} - Part 2`,
        deliverables: deliverables.slice(Math.ceil(deliverables.length / 2)),
        dependencies: [`${task.id}-sub-1`]
      }
    ];
  }

  _groupDeliverables(deliverables) {
    // Simple grouping: every 3 deliverables
    const groups = [];
    const groupSize = 3;
    
    for (let i = 0; i < deliverables.length; i += groupSize) {
      groups.push(deliverables.slice(i, i + groupSize));
    }
    
    return groups;
  }

  _countActionVerbs(text) {
    const verbs = [
      'add', 'create', 'implement', 'build', 'develop',
      'fix', 'update', 'modify', 'change', 'refactor',
      'remove', 'delete', 'test', 'validate', 'verify',
      'deploy', 'configure', 'setup', 'install'
    ];
    
    let count = 0;
    const lower = text.toLowerCase();
    for (const verb of verbs) {
      if (lower.includes(verb)) count++;
    }
    
    return count;
  }

  _isVague(text) {
    const vagueTerms = [
      'etc', 'and so on', 'various', 'some', 'possibly',
      'maybe', 'might', 'could', 'tbd', 'to be determined',
      'as needed', 'if necessary'
    ];
    
    const lower = text.toLowerCase();
    return vagueTerms.some(term => lower.includes(term)) || text.length < 10;
  }
}

module.exports = {
  TaskScopeAnalyzer,
  ScopeType,
  ScopeIssue
};

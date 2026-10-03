/**
 * Requirement Traceability and Acceptance Validation (P9-T023)
 *
 * Maps each task requirement and acceptance criterion to planned changes.
 * Maps acceptance criteria to tests, lint commands, builds, or other verification checks.
 * Reports unmet, satisfied, skipped, and unverifiable criteria separately.
 * Prevents a task from being reported complete when required checks were not executed.
 *
 * @module agent/requirement-traceability
 */

'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Criteria satisfaction status
 */
const SatisfactionStatus = {
  SATISFIED: 'satisfied',
  UNSATISFIED: 'unsatisfied',
  SKIPPED: 'skipped',
  UNVERIFIABLE: 'unverifiable',
  PENDING: 'pending',
  FAILED: 'failed'
};

/**
 * Verification method types
 */
const VerificationMethod = {
  TEST: 'test',
  LINT: 'lint',
  BUILD: 'build',
  MANUAL: 'manual',
  AUTOMATED: 'automated',
  REVIEW: 'review',
  INSPECTION: 'inspection'
};

/**
 * Requirement Traceability Manager
 */
class RequirementTraceability {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.traceabilityStore = options.store || new Map();
    this.strictMode = options.strictMode !== false;
    
    // Tracking
    this.traces = new Map();
    this.criteriaResults = new Map();
  }

  /**
   * Create traceability matrix for a task
   * @param {Object} task
   * @param {Object} plan
   * @returns {Object} Traceability matrix
   */
  createTraceMatrix(task, plan) {
    const matrix = {
      taskId: task.id,
      taskName: task.name,
      createdAt: Date.now(),
      requirements: [],
      criteria: [],
      changes: [],
      verifications: [],
      coverage: {
        total: 0,
        traced: 0,
        untraced: 0
      }
    };
    
    // Extract requirements from task
    const requirements = this._extractRequirements(task);
    matrix.requirements = requirements;
    
    // Map requirements to planned changes
    for (const req of requirements) {
      const changes = this._mapRequirementToChanges(req, plan);
      matrix.changes.push(...changes);
      
      req.tracedToChanges = changes.length > 0;
      if (req.tracedToChanges) {
        matrix.coverage.traced++;
      } else {
        matrix.coverage.untraced++;
      }
      matrix.coverage.total++;
    }
    
    // Extract acceptance criteria
    const criteria = this._extractCriteria(task);
    matrix.criteria = criteria;
    
    // Map criteria to verification methods
    for (const criterion of criteria) {
      const verifications = this._mapCriteriaToVerification(criterion, plan);
      matrix.verifications.push(...verifications);
      criterion.verificationMethods = verifications;
    }
    
    // Store the matrix
    this.traces.set(task.id, matrix);
    
    return matrix;
  }

  /**
   * Verify acceptance criteria
   * @param {string} taskId
   * @param {Object} verificationResults
   * @returns {Object} Validation result
   */
  verifyCriteria(taskId, verificationResults) {
    const matrix = this.traces.get(taskId);
    if (!matrix) {
      return {
        valid: false,
        error: 'No traceability matrix found for task'
      };
    }
    
    const result = {
      taskId,
      validatedAt: Date.now(),
      criteria: [],
      summary: {
        total: matrix.criteria.length,
        satisfied: 0,
        unsatisfied: 0,
        skipped: 0,
        unverifiable: 0
      },
      allSatisfied: false,
      canComplete: false
    };
    
    for (const criterion of matrix.criteria) {
      const status = this._checkCriterionStatus(criterion, verificationResults);
      
      result.criteria.push({
        id: criterion.id,
        description: criterion.description,
        status: status.status,
        evidence: status.evidence,
        reason: status.reason
      });
      
      // Update summary
      switch (status.status) {
        case SatisfactionStatus.SATISFIED:
          result.summary.satisfied++;
          break;
        case SatisfactionStatus.UNSATISFIED:
          result.summary.unsatisfied++;
          break;
        case SatisfactionStatus.SKIPPED:
          result.summary.skipped++;
          break;
        case SatisfactionStatus.UNVERIFIABLE:
          result.summary.unverifiable++;
          break;
      }
    }
    
    // Determine if all criteria are satisfied
    result.allSatisfied = result.summary.unsatisfied === 0 && 
                          result.summary.satisfied === result.summary.total;
    
    // In strict mode, cannot complete if any criteria are unsatisfied or unverifiable
    result.canComplete = this.strictMode ?
      result.allSatisfied :
      result.summary.unsatisfied === 0;
    
    // Store results
    this.criteriaResults.set(taskId, result);
    
    return result;
  }

  /**
   * Generate implementation report
   * @param {string} taskId
   * @param {Object} options
   * @returns {Object} Implementation report
   */
  generateReport(taskId, options = {}) {
    const matrix = this.traces.get(taskId);
    const criteriaResult = this.criteriaResults.get(taskId);
    
    if (!matrix) {
      return {
        error: 'No traceability data found for task'
      };
    }
    
    const report = {
      taskId,
      taskName: matrix.taskName,
      generatedAt: new Date().toISOString(),
      
      summary: {
        requirementsTotal: matrix.requirements.length,
        requirementsTraced: matrix.coverage.traced,
        requirementsUntraced: matrix.coverage.untraced,
        criteriaTotal: matrix.criteria.length,
        criteriaSatisfied: criteriaResult?.summary.satisfied || 0,
        criteriaUnsatisfied: criteriaResult?.summary.unsatisfied || 0
      },
      
      requirements: matrix.requirements.map(req => ({
        id: req.id,
        description: req.description,
        traced: req.tracedToChanges,
        changes: req.changes || []
      })),
      
      changes: matrix.changes.map(change => ({
        file: change.file,
        type: change.type,
        requirement: change.requirementId,
        description: change.description
      })),
      
      verification: matrix.verifications.map(v => ({
        criterionId: v.criterionId,
        method: v.method,
        command: v.command,
        status: v.status
      })),
      
      criteria: criteriaResult?.criteria || matrix.criteria.map(c => ({
        id: c.id,
        description: c.description,
        status: SatisfactionStatus.PENDING
      })),
      
      documentationSources: options.documentationSources || [],
      
      risks: this._identifyRisks(matrix, criteriaResult),
      
      conclusion: {
        canComplete: criteriaResult?.canComplete || false,
        allSatisfied: criteriaResult?.allSatisfied || false,
        remainingWork: this._getRemainingWork(matrix, criteriaResult)
      }
    };
    
    return report;
  }

  /**
   * Check if task can be marked complete
   * @param {string} taskId
   * @returns {Object} { canComplete: boolean, reason?: string }
   */
  canCompleteTask(taskId) {
    const criteriaResult = this.criteriaResults.get(taskId);
    
    if (!criteriaResult) {
      return {
        canComplete: false,
        reason: 'No verification results found - criteria not checked'
      };
    }
    
    if (!criteriaResult.allSatisfied && this.strictMode) {
      return {
        canComplete: false,
        reason: `${criteriaResult.summary.unsatisfied} criteria not satisfied`
      };
    }
    
    if (criteriaResult.summary.unsatisfied > 0) {
      return {
        canComplete: false,
        reason: `${criteriaResult.summary.unsatisfied} criteria failed`
      };
    }
    
    return { canComplete: true };
  }

  /**
   * Get traceability for specific requirement
   * @param {string} taskId
   * @param {string} requirementId
   * @returns {Object|null}
   */
  getTrace(taskId, requirementId) {
    const matrix = this.traces.get(taskId);
    if (!matrix) return null;
    
    const requirement = matrix.requirements.find(r => r.id === requirementId);
    if (!requirement) return null;
    
    const changes = matrix.changes.filter(c => c.requirementId === requirementId);
    const criteria = matrix.criteria.filter(c => c.requirementId === requirementId);
    
    return {
      requirement,
      changes,
      criteria
    };
  }

  // ─── Private Methods ───────────────────────────────────────────────────────────

  _extractRequirements(task) {
    const requirements = [];
    
    // Extract from deliverables
    if (task.deliverables) {
      for (let i = 0; i < task.deliverables.length; i++) {
        requirements.push({
          id: `req-${task.id}-D${i + 1}`,
          type: 'deliverable',
          description: task.deliverables[i],
          source: 'deliverables',
          required: true
        });
      }
    }
    
    // Extract from explicit requirements
    if (task.requirements) {
      for (let i = 0; i < task.requirements.length; i++) {
        requirements.push({
          id: `req-${task.id}-R${i + 1}`,
          type: 'requirement',
          description: task.requirements[i],
          source: 'requirements',
          required: true
        });
      }
    }
    
    return requirements;
  }

  _extractCriteria(task) {
    const criteria = [];
    
    // Extract from acceptance criteria
    if (task.acceptanceCriteria) {
      for (let i = 0; i < task.acceptanceCriteria.length; i++) {
        criteria.push({
          id: `crit-${task.id}-A${i + 1}`,
          description: task.acceptanceCriteria[i],
          required: true
        });
      }
    }
    
    // Generate from deliverables if no explicit criteria
    if (criteria.length === 0 && task.deliverables) {
      for (let i = 0; i < task.deliverables.length; i++) {
        criteria.push({
          id: `crit-${task.id}-D${i + 1}`,
          description: `Deliverable satisfied: ${task.deliverables[i]}`,
          required: true
        });
      }
    }
    
    return criteria;
  }

  _mapRequirementToChanges(requirement, plan) {
    const changes = [];
    
    if (!plan || !plan.steps) return changes;
    
    // Map plan steps to requirements based on keywords
    const keywords = this._extractKeywords(requirement.description);
    
    for (const step of plan.steps) {
      const stepKeywords = this._extractKeywords(step.description || '');
      const overlap = keywords.filter(k => stepKeywords.includes(k));
      
      if (overlap.length > 0) {
        changes.push({
          requirementId: requirement.id,
          stepId: step.id,
          file: step.file || 'unknown',
          type: step.action || 'modify',
          description: step.description,
          confidence: overlap.length / keywords.length
        });
      }
    }
    
    return changes;
  }

  _mapCriteriaToVerification(criterion, plan) {
    const verifications = [];
    const description = criterion.description.toLowerCase();
    
    // Detect verification method from criterion description
    if (description.includes('test') || description.includes('spec')) {
      verifications.push({
        criterionId: criterion.id,
        method: VerificationMethod.TEST,
        command: 'npm test',
        status: SatisfactionStatus.PENDING
      });
    }
    
    if (description.includes('lint') || description.includes('style')) {
      verifications.push({
        criterionId: criterion.id,
        method: VerificationMethod.LINT,
        command: 'npm run lint',
        status: SatisfactionStatus.PENDING
      });
    }
    
    if (description.includes('build') || description.includes('compile')) {
      verifications.push({
        criterionId: criterion.id,
        method: VerificationMethod.BUILD,
        command: 'npm run build',
        status: SatisfactionStatus.PENDING
      });
    }
    
    // Default to automated verification
    if (verifications.length === 0) {
      verifications.push({
        criterionId: criterion.id,
        method: VerificationMethod.AUTOMATED,
        command: null,
        status: SatisfactionStatus.PENDING
      });
    }
    
    return verifications;
  }

  _checkCriterionStatus(criterion, verificationResults) {
    const methods = criterion.verificationMethods || [];
    
    if (methods.length === 0) {
      return {
        status: SatisfactionStatus.UNVERIFIABLE,
        reason: 'No verification methods defined'
      };
    }
    
    // Check each verification method
    for (const method of methods) {
      const result = verificationResults[method.method]?.[method.command];
      
      if (!result) {
        // Verification not executed
        if (criterion.required && this.strictMode) {
          return {
            status: SatisfactionStatus.UNSATISFIED,
            reason: `Required verification not executed: ${method.method}`
          };
        }
        continue;
      }
      
      if (result.passed) {
        return {
          status: SatisfactionStatus.SATISFIED,
          evidence: result
        };
      } else {
        return {
          status: SatisfactionStatus.FAILED,
          reason: result.error || 'Verification failed',
          evidence: result
        };
      }
    }
    
    return {
      status: SatisfactionStatus.UNVERIFIABLE,
      reason: 'No verification results available'
    };
  }

  _extractKeywords(text) {
    if (!text) return [];
    
    // Simple keyword extraction
    const stopWords = ['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 
                       'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
                       'would', 'could', 'should', 'may', 'might', 'must', 'shall',
                       'can', 'need', 'to', 'for', 'of', 'and', 'or', 'in', 'on',
                       'at', 'by', 'with', 'from', 'as', 'into', 'through'];
    
    return text.toLowerCase()
      .split(/\W+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));
  }

  _identifyRisks(matrix, criteriaResult) {
    const risks = [];
    
    // Check for untraced requirements
    const untraced = matrix.requirements.filter(r => !r.tracedToChanges);
    if (untraced.length > 0) {
      risks.push({
        severity: 'high',
        type: 'untraced-requirements',
        description: `${untraced.length} requirements have no traced changes`,
        items: untraced.map(r => r.id)
      });
    }
    
    // Check for unsatisfied criteria
    if (criteriaResult && criteriaResult.summary.unsatisfied > 0) {
      risks.push({
        severity: 'high',
        type: 'unsatisfied-criteria',
        description: `${criteriaResult.summary.unsatisfied} criteria are not satisfied`,
        items: criteriaResult.criteria
          .filter(c => c.status === SatisfactionStatus.UNSATISFIED)
          .map(c => c.id)
      });
    }
    
    // Check for unverifiable criteria
    if (criteriaResult && criteriaResult.summary.unverifiable > 0) {
      risks.push({
        severity: 'medium',
        type: 'unverifiable-criteria',
        description: `${criteriaResult.summary.unverifiable} criteria cannot be verified`,
        items: criteriaResult.criteria
          .filter(c => c.status === SatisfactionStatus.UNVERIFIABLE)
          .map(c => c.id)
      });
    }
    
    return risks;
  }

  _getRemainingWork(matrix, criteriaResult) {
    const remaining = [];
    
    if (!criteriaResult) {
      remaining.push({
        type: 'verification',
        description: 'Run verification for all criteria'
      });
      return remaining;
    }
    
    for (const criterion of criteriaResult.criteria) {
      if (criterion.status !== SatisfactionStatus.SATISFIED) {
        remaining.push({
          type: 'criterion',
          id: criterion.id,
          description: criterion.description,
          status: criterion.status,
          reason: criterion.reason
        });
      }
    }
    
    return remaining;
  }
}

module.exports = {
  RequirementTraceability,
  SatisfactionStatus,
  VerificationMethod
};

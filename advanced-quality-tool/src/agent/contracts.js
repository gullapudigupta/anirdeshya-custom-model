'use strict';

const CONTRACT_VERSION = 1;

const WorkResultStatus = Object.freeze({
  COMPLETED: 'completed',
  INCOMPLETE: 'incomplete',
  BLOCKED: 'blocked',
  DENIED: 'denied',
  FAILED: 'failed'
});

const TASK_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://aqt.local/schemas/agent-task-v1.json',
  type: 'object',
  required: ['schemaVersion', 'description', 'acceptanceCriteria'],
  properties: {
    schemaVersion: { const: CONTRACT_VERSION },
    id: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    acceptanceCriteria: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 }
    },
    files: { type: 'array', items: { type: 'string', minLength: 1 } }
  },
  additionalProperties: true
});

function validateTaskContract(task) {
  const issues = [];
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return { valid: false, issues: ['Task must be an object'] };
  }
  if (task.schemaVersion !== CONTRACT_VERSION) {
    issues.push(`schemaVersion must be ${CONTRACT_VERSION}`);
  }
  if (typeof task.description !== 'string' || !task.description.trim()) {
    issues.push('Task description is required');
  }
  if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0 ||
      task.acceptanceCriteria.some(value => typeof value !== 'string' || !value.trim())) {
    issues.push('At least one non-empty acceptance criterion is required');
  }
  if (task.files !== undefined &&
      (!Array.isArray(task.files) || task.files.some(file => typeof file !== 'string' || !file.trim()))) {
    issues.push('Task files must be an array of non-empty relative paths');
  }
  return { valid: issues.length === 0, issues };
}

function validatePlan(plan, options = {}) {
  const issues = [];
  const maxSteps = options.maxSteps || 20;
  const maxFiles = options.maxFiles || 50;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { valid: false, issues: ['Plan must be an object'] };
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > maxSteps) {
    issues.push(`Plan must contain between 1 and ${maxSteps} steps`);
  }
  if (!Array.isArray(plan.affectedFiles) || plan.affectedFiles.length === 0 ||
      plan.affectedFiles.length > maxFiles) {
    issues.push(`Plan must contain between 1 and ${maxFiles} affected files`);
  }
  if (!Array.isArray(plan.expectedChecks) || plan.expectedChecks.length === 0) {
    issues.push('Plan must specify required verification checks');
  }

  const stepIds = new Set();
  for (const step of Array.isArray(plan.steps) ? plan.steps : []) {
    if (!step || (typeof step.id !== 'string' && typeof step.id !== 'number') ||
        typeof step.description !== 'string' || !step.description.trim()) {
      issues.push('Every plan step must have an id and description');
      continue;
    }
    if (stepIds.has(String(step.id))) issues.push(`Duplicate step id: ${step.id}`);
    stepIds.add(String(step.id));
  }
  for (const step of Array.isArray(plan.steps) ? plan.steps : []) {
    for (const dependency of step.dependencies || []) {
      if (!stepIds.has(String(dependency))) issues.push(`Unresolved step dependency: ${dependency}`);
      if (String(dependency) === String(step.id)) issues.push(`Step ${step.id} depends on itself`);
    }
  }
  return { valid: issues.length === 0, issues };
}

function validateCompletion(result) {
  const issues = [];
  if (!result || result.status !== WorkResultStatus.COMPLETED) {
    issues.push('Result is not completed');
  }
  if (!result || !Array.isArray(result.changedFiles) || result.changedFiles.length === 0) {
    issues.push('Completed result must prove at least one changed file');
  }
  const checks = result && result.verification && result.verification.checks;
  if (!checks || !Object.values(checks).length ||
      Object.values(checks).some(check => check.status !== 'passed')) {
    issues.push('Completed result requires evidence that every check passed');
  }
  return { valid: issues.length === 0, issues };
}

module.exports = {
  CONTRACT_VERSION,
  TASK_SCHEMA,
  WorkResultStatus,
  validateTaskContract,
  validatePlan,
  validateCompletion
};

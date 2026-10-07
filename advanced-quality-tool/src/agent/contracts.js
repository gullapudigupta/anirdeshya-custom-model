'use strict';

const path = require('path');

const CONTRACT_VERSION = 1;

const WorkResultStatus = Object.freeze({
  COMPLETED: 'completed',
  INCOMPLETE: 'incomplete',
  BLOCKED: 'blocked',
  DENIED: 'denied',
  CANCELLED: 'cancelled',
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
      uniqueItems: true,
      items: { type: 'string', minLength: 1 }
    },
    files: { type: 'array', items: { type: 'string', minLength: 1 } }
  },
  additionalProperties: true
});

const PLAN_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://aqt.local/schemas/agent-plan-v1.json',
  type: 'object',
  required: ['schemaVersion', 'steps', 'affectedFiles', 'expectedChecks', 'risks', 'metadata'],
  properties: {
    schemaVersion: { const: CONTRACT_VERSION },
    steps: { type: 'array', minItems: 1 },
    affectedFiles: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
    expectedChecks: { type: 'array', minItems: 1 },
    risks: { type: 'array' },
    metadata: { type: 'object', required: ['requiresApproval'], properties: { requiresApproval: { type: 'boolean' } } }
  },
  additionalProperties: true
});

const PATCH_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://aqt.local/schemas/agent-patch-v1.json',
  type: 'object',
  required: ['schemaVersion', 'path', 'operation', 'expectedHash', 'content'],
  properties: {
    schemaVersion: { const: CONTRACT_VERSION },
    path: { type: 'string', minLength: 1 },
    operation: { enum: ['create', 'modify', 'delete'] },
    expectedHash: { type: ['string', 'null'] },
    content: { type: ['string', 'null'] }
  },
  additionalProperties: false
});

const VERIFICATION_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://aqt.local/schemas/agent-verification-v1.json',
  type: 'object',
  required: ['schemaVersion', 'checks'],
  properties: {
    schemaVersion: { const: CONTRACT_VERSION },
    checks: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        required: ['status', 'required'],
        properties: {
          status: { enum: ['passed', 'failed', 'skipped', 'unavailable', 'errored', 'timed-out'] },
          required: { type: 'boolean' }
        }
      }
    }
  },
  additionalProperties: true
});

const APPROVAL_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://aqt.local/schemas/agent-approval-v1.json',
  type: 'object',
  required: ['schemaVersion', 'status', 'planDigest'],
  properties: {
    schemaVersion: { const: CONTRACT_VERSION },
    status: { enum: ['pending', 'approved', 'denied', 'expired'] },
    planDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    patchDigest: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
    expiresAt: { type: ['string', 'null'], format: 'date-time' }
  },
  additionalProperties: true
});

const FINAL_RESULT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://aqt.local/schemas/agent-result-v1.json',
  type: 'object',
  required: ['schemaVersion', 'status'],
  properties: {
    schemaVersion: { const: CONTRACT_VERSION },
    status: { enum: Object.values(WorkResultStatus) },
    changedFiles: { type: 'array', items: { type: 'string' } },
    verification: { $ref: VERIFICATION_SCHEMA.$id }
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
  } else if (Array.isArray(task.files) && task.files.some(file => !isRelativeWorkspacePath(file))) {
    issues.push('Task files must stay within the workspace');
  }
  if (task.acceptanceCriteria && Array.isArray(task.acceptanceCriteria)) {
    const uniqueCriteria = new Set(task.acceptanceCriteria.map(value =>
      typeof value === 'string' ? value.trim().toLowerCase() : ''
    ));
    if (uniqueCriteria.size !== task.acceptanceCriteria.length) {
      issues.push('Acceptance criteria must be unique');
    }
  }
  return { valid: issues.length === 0, issues };
}

function validatePlan(plan, options = {}) {
  const issues = [];
  const maxSteps = Number.isInteger(options.maxSteps) && options.maxSteps > 0 ? options.maxSteps : 20;
  const maxFiles = Number.isInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : 50;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { valid: false, issues: ['Plan must be an object'] };
  }
  if (plan.schemaVersion !== CONTRACT_VERSION) {
    issues.push(`Plan schemaVersion must be ${CONTRACT_VERSION}`);
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > maxSteps) {
    issues.push(`Plan must contain between 1 and ${maxSteps} steps`);
  }
  if (!Array.isArray(plan.affectedFiles) || plan.affectedFiles.length === 0 ||
      plan.affectedFiles.length > maxFiles) {
    issues.push(`Plan must contain between 1 and ${maxFiles} affected files`);
  } else {
    const files = new Set();
    for (const file of plan.affectedFiles) {
      if (typeof file !== 'string' || !file.trim()) {
        issues.push('Affected files must be non-empty relative paths');
        continue;
      }
      if (!isRelativeWorkspacePath(file)) issues.push(`Affected file is outside the workspace: ${file}`);
      if (files.has(file)) issues.push(`Duplicate affected file: ${file}`);
      files.add(file);
    }
  }
  if (!Array.isArray(plan.expectedChecks) || plan.expectedChecks.length === 0) {
    issues.push('Plan must specify required verification checks');
  } else {
    const checkIds = new Set();
    for (const check of plan.expectedChecks) {
      if (!check || typeof check.type !== 'string' || !check.type.trim()) {
        issues.push('Every verification check must have a non-empty type');
        continue;
      }
      if (checkIds.has(check.type)) issues.push(`Duplicate verification check: ${check.type}`);
      checkIds.add(check.type);
      if (typeof check.required !== 'boolean') {
        issues.push(`Verification check '${check.type}' must declare whether it is required`);
      }
    }
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
    if (step.dependencies !== undefined && !Array.isArray(step.dependencies)) {
      issues.push(`Step ${step.id} dependencies must be an array`);
    }
  }
  if (Array.isArray(plan.steps) && hasDependencyCycle(plan.steps)) {
    issues.push('Plan contains circular step dependencies');
  }
  for (const step of Array.isArray(plan.steps) ? plan.steps : []) {
    for (const dependency of Array.isArray(step.dependencies) ? step.dependencies : []) {
      if (!stepIds.has(String(dependency))) issues.push(`Unresolved step dependency: ${dependency}`);
      if (String(dependency) === String(step.id)) issues.push(`Step ${step.id} depends on itself`);
    }
  }

  const planMetadata = plan.metadata;
  if (!planMetadata || typeof planMetadata !== 'object' || Array.isArray(planMetadata)) {
    issues.push('Plan metadata is required');
  } else if (typeof planMetadata.requiresApproval !== 'boolean') {
    issues.push('Plan metadata must declare whether approval is required');
  }
  return { valid: issues.length === 0, issues };
}

function validatePatch(patch, options = {}) {
  const issues = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { valid: false, issues: ['Patch must be an object'] };
  }
  if (patch.schemaVersion !== CONTRACT_VERSION) issues.push(`Patch schemaVersion must be ${CONTRACT_VERSION}`);
  if (!Object.prototype.hasOwnProperty.call(patch, 'expectedHash')) issues.push('Patch expectedHash is required');
  if (!Object.prototype.hasOwnProperty.call(patch, 'content')) issues.push('Patch content is required');
  if (!isRelativeWorkspacePath(patch.path)) issues.push('Patch path must be a workspace-relative path');
  if (!['create', 'modify', 'delete'].includes(patch.operation)) issues.push('Patch operation is invalid');
  if (patch.operation === 'create' && patch.expectedHash != null) issues.push('Create patch expectedHash must be null');
  if (['modify', 'delete'].includes(patch.operation) && !/^[a-f0-9]{64}$/i.test(patch.expectedHash || '')) {
    issues.push(`${patch.operation} patch requires a SHA-256 expectedHash`);
  }
  if (patch.operation === 'delete' && patch.content != null) issues.push('Delete patch content must be null');
  if (patch.operation !== 'delete' && typeof patch.content !== 'string') issues.push('Patch content must be a string');
  if (typeof patch.content === 'string' &&
      Buffer.byteLength(patch.content, 'utf8') > (options.maxBytes || 1024 * 1024)) {
    issues.push('Patch content exceeds the configured byte limit');
  }
  return { valid: issues.length === 0, issues };
}

function validateVerification(verification) {
  const issues = [];
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) {
    return { valid: false, issues: ['Verification must be an object'] };
  }
  if (verification.schemaVersion !== CONTRACT_VERSION) {
    issues.push(`Verification schemaVersion must be ${CONTRACT_VERSION}`);
  }
  if (!verification.checks || typeof verification.checks !== 'object' || Array.isArray(verification.checks) ||
      Object.keys(verification.checks).length === 0) {
    issues.push('Verification requires at least one check result');
  } else {
    for (const [checkId, check] of Object.entries(verification.checks)) {
      if (!check || typeof check.required !== 'boolean' ||
          !['passed', 'failed', 'skipped', 'unavailable', 'errored', 'timed-out'].includes(check.status)) {
        issues.push(`Verification result '${checkId}' has an invalid status or required flag`);
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

function validateApproval(approval) {
  const issues = [];
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    return { valid: false, issues: ['Approval must be an object'] };
  }
  if (approval.schemaVersion !== CONTRACT_VERSION) issues.push(`Approval schemaVersion must be ${CONTRACT_VERSION}`);
  if (!['pending', 'approved', 'denied', 'expired'].includes(approval.status)) {
    issues.push('Approval status is invalid');
  }
  if (!/^[a-f0-9]{64}$/i.test(approval.planDigest || '')) issues.push('Approval requires a plan SHA-256 digest');
  if (approval.patchDigest != null && !/^[a-f0-9]{64}$/i.test(approval.patchDigest)) {
    issues.push('Approval patch digest must be a SHA-256 digest');
  }
  return { valid: issues.length === 0, issues };
}

function isRelativeWorkspacePath(file) {
  if (typeof file !== 'string' || !file.trim() || path.isAbsolute(file)) return false;
  const normalized = path.normalize(file);
  return normalized !== '..' &&
    !normalized.startsWith(`..${path.sep}`) &&
    !normalized.split(/[\\/]/).includes('..');
}

function hasDependencyCycle(steps) {
  const byId = new Map(steps.filter(step => step && step.id !== undefined)
    .map(step => [String(step.id), step]));
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const step = byId.get(id);
    for (const dependency of Array.isArray(step && step.dependencies) ? step.dependencies : []) {
      if (byId.has(String(dependency)) && visit(String(dependency))) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...byId.keys()].some(visit);
}

function validateCompletion(result) {
  const issues = [];
  if (!result || result.schemaVersion !== CONTRACT_VERSION) {
    issues.push(`Result schemaVersion must be ${CONTRACT_VERSION}`);
  }
  if (!result || result.status !== WorkResultStatus.COMPLETED) {
    issues.push('Result is not completed');
  }
  if (!result || !Array.isArray(result.changedFiles) || result.changedFiles.length === 0) {
    issues.push('Completed result must prove at least one changed file');
  }
  const checks = result && result.verification && result.verification.checks;
  const checkResults = checks ? Object.values(checks) : [];
  const statusOf = check => check && (check.status || check.state);
  const verificationValidation = validateVerification(result && result.verification);
  if (!verificationValidation.valid) issues.push(...verificationValidation.issues);
  if (!checkResults.length ||
      !checkResults.some(check => check && check.required !== false && statusOf(check) === 'passed') ||
      checkResults.some(check => !check || (check.required !== false && statusOf(check) !== 'passed'))) {
    issues.push('Completed result requires evidence that every required check passed');
  }
  if (result && result.scaffold === true) {
    issues.push('Scaffold-only output cannot be completed');
  }
  if (!result || !Array.isArray(result.verifiedChangedFiles) ||
      !result.changedFiles.every(file => result.verifiedChangedFiles.includes(file))) {
    issues.push('Every changed file must be verified in the workspace');
  }
  return { valid: issues.length === 0, issues };
}

module.exports = {
  CONTRACT_VERSION,
  TASK_SCHEMA,
  PLAN_SCHEMA,
  PATCH_SCHEMA,
  VERIFICATION_SCHEMA,
  APPROVAL_SCHEMA,
  FINAL_RESULT_SCHEMA,
  WorkResultStatus,
  validateTaskContract,
  validatePlan,
  validatePatch,
  validateVerification,
  validateApproval,
  validateCompletion
};

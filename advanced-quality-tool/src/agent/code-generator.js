/**
 * Task-Driven Code Generation Workflow (P9-T022)
 *
 * Builds implementation context from tasks, generates reviewable plans,
 * creates structured multi-file patches, and preserves traceability.
 *
 * @module agent/code-generator
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DiffReviewSystem, hashContent } = require('./diff-review-system');
const { PermissionManager } = require('./permissions');

/**
 * Code Generation Workflow
 */
class CodeGenerator {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.contextProvider = options.contextProvider || null;
    this.modelExecutor = options.modelExecutor || null;
    this.guidanceLoader = options.guidanceLoader || null;
    this.maxChangedFiles = options.maxChangedFiles === undefined ? 20 : options.maxChangedFiles;
    if (!Number.isSafeInteger(this.maxChangedFiles) || this.maxChangedFiles <= 0) {
      throw new Error('maxChangedFiles must be a positive safe integer');
    }
    this.permissionManager = options.permissionManager || new PermissionManager({
      workspace: this.workspace,
      ...(options.permissionOptions || {}),
      maxFilesPerTask: Math.min(
        options.permissionOptions?.maxFilesPerTask || this.maxChangedFiles,
        this.maxChangedFiles
      )
    });
  }

  /**
   * Generate code from a task
   * @param {Object} task
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async generate(task, options = {}) {
    const result = {
      taskId: task.id,
      success: false,
      plan: null,
      patches: [],
      context: {},
      traceability: {},
      error: null
    };

    try {
      // 1. Build implementation context
      result.context = await this._buildContext(task, options);

      // 2. Generate implementation plan
      result.plan = options.plan || await this._generatePlan(task, result.context, options);

      // 3. Generate patches from plan
      result.patches = await this._generatePatches(task, result.plan, result.context, options);

      // 4. Build traceability information
      result.traceability = this._buildTraceability(task, result.plan, result.patches, result.context);

      result.scaffold = result.patches.some(patch => patch.scaffold);
      const validation = this.validate(result);
      result.success = result.patches.length > 0 && validation.valid;
      if (!result.patches.length) {
        result.error = 'No implementation patches were generated.';
      } else if (result.scaffold) {
        result.error = 'Only scaffolding was generated; no implementation is available to verify.';
      } else if (!validation.valid) {
        result.error = validation.issues.filter(issue => issue.severity === 'error')
          .map(issue => issue.message).join('; ');
      }
    } catch (error) {
      result.error = result.patches.length === 0
        ? `No implementation patches were generated: ${error.message}`
        : error.message;
    }

    return result;
  }

  /**
   * Validate generated code
   * @param {Object} generationResult
   * @returns {Object}
   */
  validate(generationResult) {
    const issues = [];

    // Check plan exists
    if (!generationResult || !generationResult.plan) {
      issues.push({ severity: 'error', message: 'No implementation plan generated' });
    }

    // Check patches exist
    if (!generationResult || !Array.isArray(generationResult.patches) ||
        generationResult.patches.length === 0) {
      issues.push({ severity: 'error', message: 'No patches generated' });
    }
    if (generationResult && generationResult.scaffold) {
      issues.push({ severity: 'error', message: 'Scaffold output is not a completed implementation' });
    }

    // Validate each patch
    const patches = generationResult && Array.isArray(generationResult.patches)
      ? generationResult.patches
      : [];
    for (const patch of patches) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        issues.push({ severity: 'error', message: 'Patch must be an object' });
        continue;
      }
      if (!patch.filePath || !['create', 'modify', 'delete'].includes(patch.type)) {
        issues.push({ severity: 'error', message: 'Patch has a missing path or unsupported operation' });
      }
      if (patch.scaffold || /Generated implementation stub|TODO:\s*Implement functionality/i
        .test(patch.modifiedContent || '')) {
        issues.push({ severity: 'error', message: `Patch for ${patch.filePath || '(unknown file)'} contains scaffold only` });
      }
      if (typeof patch.originalContent !== 'string' && patch.originalContent !== null) {
        issues.push({ severity: 'error', message: `Patch for ${patch.filePath || '(unknown file)'} has malformed original content` });
      }
      if (typeof patch.modifiedContent !== 'string' ||
          (patch.type === 'create' && patch.originalContent !== null) ||
          (patch.type !== 'create' && typeof patch.originalContent !== 'string') ||
          (patch.type === 'delete' && patch.modifiedContent !== '') ||
          (patch.type !== 'delete' && !patch.modifiedContent.trim()) ||
          (patch.type !== 'delete' && patch.originalContent === patch.modifiedContent)) {
        issues.push({ severity: 'error', message: `Patch for ${patch.filePath || '(unknown file)'} is empty or malformed` });
      }
      if (typeof patch.originalContent === 'string' &&
          patch.expectedHash !== hashContent(patch.originalContent)) {
        issues.push({ severity: 'error', message: `Patch for ${patch.filePath || '(unknown file)'} has an invalid expected content hash` });
      }
    }
    if (patches.length > this.maxChangedFiles) {
      issues.push({ severity: 'error', message: `Changed-file limit (${this.maxChangedFiles}) exceeded` });
    }

    // Check traceability
    if (!generationResult || !generationResult.traceability || !generationResult.traceability.taskId) {
      issues.push({ severity: 'warning', message: 'Missing traceability information' });
    }

    return {
      valid: !issues.some(i => i.severity === 'error'),
      issues
    };
  }

  // ─── Private methods ──────────────────────────────────────────────────────────

  async _buildContext(task, options) {
    const context = {
      task: {
        id: task.id,
        description: task.description,
        deliverables: task.deliverables || [],
        acceptanceCriteria: task.acceptanceCriteria || [],
        dependencies: task.dependencies || []
      },
      workspace: {
        root: this.workspace,
        projectType: await this._detectProjectType(),
        structure: await this._analyzeWorkspaceStructure()
      },
      guidance: await this._loadGuidance(),
      documentation: await this._loadDocumentation(task),
      relevantCode: await this._gatherRelevantCode(task),
      tokenBudget: options.tokenBudget || 8000
    };

    return context;
  }

  async _detectProjectType() {
    // Check for common project markers
    const markers = {
      'package.json': 'javascript',
      'tsconfig.json': 'typescript',
      'requirements.txt': 'python',
      'setup.py': 'python',
      'pom.xml': 'java',
      'build.gradle': 'java',
      'Cargo.toml': 'rust',
      'go.mod': 'go',
      '*.csproj': 'csharp',
      'Gemfile': 'ruby',
      'composer.json': 'php'
    };

    for (const [marker, type] of Object.entries(markers)) {
      const filePath = path.join(this.workspace, marker);
      if (fs.existsSync(filePath)) {
        return type;
      }
    }

    return 'unknown';
  }

  async _analyzeWorkspaceStructure() {
    const structure = {
      sourceDirectories: [],
      testDirectories: [],
      configFiles: [],
      mainEntry: null
    };

    // Common source directories
    const sourceDirs = ['src', 'lib', 'source', 'app'];
    const testDirs = ['test', 'tests', '__tests__', 'spec'];

    for (const dir of sourceDirs) {
      const dirPath = path.join(this.workspace, dir);
      if (fs.existsSync(dirPath)) {
        structure.sourceDirectories.push(dir);
      }
    }

    for (const dir of testDirs) {
      const dirPath = path.join(this.workspace, dir);
      if (fs.existsSync(dirPath)) {
        structure.testDirectories.push(dir);
      }
    }

    return structure;
  }

  async _loadGuidance() {
    if (!this.guidanceLoader) {
      return { rules: [], patterns: [] };
    }

    try {
      return await this.guidanceLoader.load(this.workspace);
    } catch (error) {
      return { rules: [], patterns: [], error: error.message };
    }
  }

  async _loadDocumentation(task) {
    const docs = {
      urls: [],
      content: []
    };

    // Extract documentation URLs from task
    if (task.documentationUrls && Array.isArray(task.documentationUrls)) {
      docs.urls = task.documentationUrls;
      
      // Fetch documentation content if context provider available
      if (this.contextProvider) {
        for (const url of docs.urls) {
          try {
            const content = await this.contextProvider.fetchDocumentation(url);
            docs.content.push({ url, content });
          } catch (error) {
            docs.content.push({ url, error: error.message });
          }
        }
      }
    }

    return docs;
  }

  async _gatherRelevantCode(task) {
    const code = {
      files: [],
      symbols: [],
      dependencies: []
    };

    if (!this.contextProvider) {
      return code;
    }

    // Extract file references from task
    const fileReferences = this._extractFileReferences(task.description);
    
    for (const fileRef of fileReferences) {
      try {
        const filePath = path.join(this.workspace, fileRef);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          code.files.push({
            path: fileRef,
            content,
            size: content.length
          });
        }
      } catch (error) {
        // Skip files we can't read
      }
    }

    return code;
  }

  async _generatePlan(task, context, options) {
    const plan = {
      taskId: task.id,
      description: task.description,
      steps: [],
      affectedFiles: [],
      newFiles: [],
      modifiedFiles: [],
      risks: [],
      estimatedComplexity: 'medium',
      requiresTests: true,
      requiresDocumentation: true
    };

    // Analyze deliverables to create steps
    const deliverables = task.deliverables || [];
    
    // Step 1: Analysis
    plan.steps.push({
      id: 1,
      phase: 'analysis',
      description: 'Analyze existing code and requirements',
      actions: [
        'Review existing code structure',
        'Identify affected files',
        'Understand dependencies'
      ]
    });

    // Step 2: Implementation steps (one per deliverable group)
    let stepId = 2;
    for (const deliverable of deliverables) {
      plan.steps.push({
        id: stepId++,
        phase: 'implementation',
        description: `Implement: ${deliverable}`,
        actions: this._generateActionsForDeliverable(deliverable)
      });
    }

    // Step 3: Testing
    if (plan.requiresTests) {
      plan.steps.push({
        id: stepId++,
        phase: 'testing',
        description: 'Add or update tests',
        actions: [
          'Write unit tests for new functionality',
          'Update integration tests if needed',
          'Verify all tests pass'
        ]
      });
    }

    // Step 4: Documentation
    if (plan.requiresDocumentation) {
      plan.steps.push({
        id: stepId++,
        phase: 'documentation',
        description: 'Update documentation',
        actions: [
          'Update inline code comments',
          'Update README if needed',
          'Update API documentation'
        ]
      });
    }

    // Identify affected files from context
    plan.affectedFiles = context.relevantCode.files.map(f => f.path);

    // Assess risks
    plan.risks = this._assessImplementationRisks(task, context, plan);

    return plan;
  }

  async _generatePatches(task, plan, context, options) {
    if (!this.modelExecutor) {
      throw new Error('A configured model executor is required to generate implementation patches');
    }
    const execute = typeof this.modelExecutor === 'function'
      ? this.modelExecutor
      : this.modelExecutor.generatePatches || this.modelExecutor.generate || this.modelExecutor.execute;
    if (typeof execute !== 'function') {
      throw new Error('Model executor must be a function or expose generatePatches(), generate(), or execute()');
    }
    const generated = await execute.call(this.modelExecutor, {
      task,
      plan,
      context,
      workspace: this.workspace,
      limits: { maxChangedFiles: this.maxChangedFiles },
      outputSchema: {
        type: 'object',
        required: ['operations'],
        operations: ['create', 'modify', 'delete'],
        operationFields: { type: 'string', filePath: 'string', content: 'string' }
      },
      signal: options.signal
    });
    const operations = Array.isArray(generated) ? generated : generated && generated.operations;
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error('Model executor must return a non-empty structured operations array');
    }
    if (operations.length > this.maxChangedFiles) {
      throw new Error(`Changed-file limit (${this.maxChangedFiles}) exceeded`);
    }

    const declaredFiles = [
      ...(plan.affectedFiles || []),
      ...(plan.modifiedFiles || []),
      ...(plan.newFiles || [])
    ];
    const normalizedFiles = declaredFiles.map(normalizeRelativePath);
    if (normalizedFiles.some(file => !file)) {
      throw new Error('Approved plan contains a path outside workspace boundaries');
    }
    const allowedFiles = new Set(normalizedFiles);
    if (allowedFiles.size === 0) {
      throw new Error('The approved plan does not declare any files that may be changed');
    }

    const reviewSystem = new DiffReviewSystem({
      workspace: this.workspace,
      maxChangedFiles: this.maxChangedFiles
    });
    const patches = [];
    const seen = new Set();
    for (const operation of operations) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation) ||
          !['create', 'modify', 'delete'].includes(operation.type)) {
        throw new Error('Model executor returned a malformed patch operation');
      }
      const operationPath = operation.filePath || operation.path;
      const relativePath = normalizeRelativePath(operationPath);
      if (!relativePath || !allowedFiles.has(relativePath)) {
        throw new Error(`Patch path is not declared in the approved plan: ${operationPath}`);
      }
      if (seen.has(relativePath)) throw new Error(`Conflicting patch operations for ${relativePath}`);
      seen.add(relativePath);
      if ((operation.type === 'delete' && operation.content !== undefined) ||
          (operation.type !== 'delete' && typeof operation.content !== 'string')) {
        throw new Error(`Malformed ${operation.type} operation for ${relativePath}`);
      }
      const content = operation.type === 'delete' ? '' : operation.content;
      if (operation.type !== 'delete' && !content.trim()) {
        throw new Error(`Empty ${operation.type} patch rejected for ${relativePath}`);
      }
      if (/Generated implementation stub|TODO:\s*Implement functionality/i.test(content)) {
        throw new Error(`Scaffold-only patch rejected for ${relativePath}`);
      }
      const absolutePath = reviewSystem.validatePatchPath(relativePath);
      if (operation.type === 'create' && fs.existsSync(absolutePath)) {
        throw new Error(`Create target already exists: ${relativePath}`);
      }
      const originalContent = operation.type === 'create'
        ? null
        : readRegularFile(absolutePath, relativePath);
      const patch = {
        type: operation.type,
        filePath: relativePath,
        originalContent,
        modifiedContent: content,
        expectedHash: originalContent === null ? null : hashContent(originalContent),
        reason: typeof operation.reason === 'string' ? operation.reason : '',
        taskId: task.id,
        requiresReview: true,
        changes: [{
          type: operation.type,
          oldContent: originalContent || '',
          newContent: content,
          reason: typeof operation.reason === 'string' ? operation.reason : ''
        }]
      };
      patches.push(patch);
    }
    return patches;
  }

  async applyPatches(generationResult, options = {}) {
    const validation = this.validate(generationResult);
    if (!generationResult || !generationResult.success || !validation.valid) {
      return { success: false, code: 'INVALID_PATCH_SET', error: 'Generation result is not a valid implementation patch set', validation };
    }
    if (typeof options.approvalGate !== 'function') {
      return { success: false, code: 'APPROVAL_REQUIRED', error: 'A plan- and patch-bound approval gate is required' };
    }

    const planDigest = digest(generationResult.plan);
    const patchDigest = digest(generationResult.patches);
    const system = options.diffReviewSystem || new DiffReviewSystem({
      workspace: this.workspace,
      backupDir: options.backupDir,
      maxChangedFiles: this.maxChangedFiles
    });
    try {
      for (const patch of generationResult.patches) {
        system.addPatch(patch, { planDigest, patchDigest });
      }
      const review = system.presentForReview();
      for (const diff of system.diffs) {
        const preflight = system.validateBeforeApply(diff);
        if (!preflight.valid) {
          return {
            success: false,
            code: preflight.code || 'PATCH_CONFLICT',
            error: preflight.reason,
            review
          };
        }
      }
      const permissionDecisions = [];
      for (const patch of generationResult.patches) {
        const pathCheck = this.permissionManager.validatePath(patch.filePath);
        if (!pathCheck.valid) {
          return {
            success: false,
            code: 'PERMISSION_DENIED',
            error: pathCheck.reason,
            review
          };
        }
        const type = patch.type === 'create' ? 'create_file'
          : patch.type === 'delete' ? 'delete_file' : 'edit_file';
        const operation = {
          type,
          digest: patch.expectedHash || null,
          params: {
            path: patch.filePath,
            expectedHash: patch.type === 'modify' ? patch.expectedHash : undefined,
            content: patch.modifiedContent,
            dependencyChange: /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.toml|go\.mod)$/
              .test(patch.filePath)
          }
        };
        const decision = await this.permissionManager.checkPermission(operation, { deferApproval: true });
        permissionDecisions.push({ path: patch.filePath, type, operation, ...decision });
        if (!decision.allowed) {
          return {
            success: false,
            code: 'PERMISSION_DENIED',
            error: decision.reason || `Permission denied for ${patch.filePath}`,
            review,
            permissionDecisions
          };
        }
      }
      let approval;
      try {
        approval = await options.approvalGate({
          plan: generationResult.plan,
          planDigest,
          patchDigest,
          review,
          permissionDecisions
        });
      } catch (error) {
        for (const decision of permissionDecisions) {
          this.permissionManager.recordApproval(decision.operation, {
            approved: false,
            planDigest,
            actionDigest: patchDigest,
            outcome: 'error',
            reason: `Approval request failed: ${error.message}`
          });
        }
        return {
          success: false,
          code: 'APPROVAL_ERROR',
          error: `Approval request failed: ${error.message}`,
          review
        };
      }
      const approvalMatches = Boolean(approval && approval.approved === true &&
        approval.planDigest === planDigest && approval.patchDigest === patchDigest);
      if (digest(generationResult.plan) !== planDigest ||
          digest(generationResult.patches) !== patchDigest) {
        for (const decision of permissionDecisions) {
          this.permissionManager.recordApproval(decision.operation, {
            approved: false,
            planDigest,
            actionDigest: patchDigest,
            outcome: 'invalidated',
            reason: 'Approved plan or patch set changed while approval was pending'
          });
        }
        return {
          success: false,
          code: 'APPROVAL_INVALIDATED',
          error: 'Approved plan or patch set changed while approval was pending',
          review
        };
      }
      for (const decision of permissionDecisions) {
        this.permissionManager.recordApproval(decision.operation, {
          approved: approvalMatches,
          planDigest,
          actionDigest: patchDigest,
          outcome: approvalMatches ? 'approved' : 'denied',
          reason: approvalMatches ? null : 'Approval was denied or did not match the plan and patch digests'
        });
      }
      if (!approvalMatches) {
        return {
          success: false,
          code: 'APPROVAL_DENIED',
          error: 'Patch approval was denied or was not bound to the exact plan and patch digests',
          review
        };
      }
      const application = await system.applyAll({ approval });
      const success = application.failed === 0 &&
        application.applied === generationResult.patches.length &&
        system.diffs.every(diff => diff.type === 'delete'
          ? !fs.existsSync(diff.filePath)
          : fs.existsSync(diff.filePath) &&
            fs.readFileSync(diff.filePath, 'utf8') === diff.modifiedContent);
      return {
        success,
        code: success ? null : 'PATCH_APPLICATION_FAILED',
        error: success ? null : 'Not all intended patch contents are present after application',
        review,
        permissionDecisions,
        application
      };
    } catch (error) {
      const conflict = /Expected original content does not match|Patch source does not exist|Create target already exists/.test(error.message);
      return {
        success: false,
        code: conflict ? 'PATCH_CONFLICT' : 'PATCH_APPLICATION_FAILED',
        error: error.message
      };
    }
  }

  _buildTraceability(task, plan, patches, context) {
    return {
      taskId: task.id,
      taskDescription: task.description,
      deliverables: task.deliverables || [],
      acceptanceCriteria: task.acceptanceCriteria || [],
      implementationPlan: {
        steps: plan.steps.length,
        phases: [...new Set(plan.steps.map(s => s.phase))]
      },
      codeChanges: {
        filesModified: patches.filter(p => p.type === 'modify').length,
        filesCreated: patches.filter(p => p.type === 'create').length,
        filesDeleted: patches.filter(p => p.type === 'delete').length,
        totalChanges: patches.reduce((sum, p) => sum + p.changes.length, 0)
      },
      documentation: {
        sourcesUsed: context.documentation.urls,
        guidanceApplied: context.guidance.rules?.length || 0
      },
      generatedAt: new Date().toISOString()
    };
  }

  _extractFileReferences(text) {
    const files = [];
    const fileExtensions = /\.(js|ts|jsx|tsx|py|java|cs|go|rb|php|cpp|c|h)\b/gi;
    
    const matches = text.match(new RegExp('[\\w/.-]+' + fileExtensions.source, 'gi'));
    if (matches) {
      files.push(...matches);
    }
    
    return [...new Set(files)]; // Remove duplicates
  }

  _generateActionsForDeliverable(deliverable) {
    // Generate implementation actions based on deliverable text
    const actions = [];
    
    if (deliverable.toLowerCase().includes('add') || deliverable.toLowerCase().includes('create')) {
      actions.push('Create new implementation');
      actions.push('Add necessary imports');
      actions.push('Wire up dependencies');
    } else if (deliverable.toLowerCase().includes('update') || deliverable.toLowerCase().includes('modify')) {
      actions.push('Locate existing code');
      actions.push('Update implementation');
      actions.push('Preserve backward compatibility');
    } else if (deliverable.toLowerCase().includes('fix')) {
      actions.push('Identify root cause');
      actions.push('Implement fix');
      actions.push('Add regression test');
    } else {
      actions.push('Implement requirement');
      actions.push('Integrate with existing code');
    }
    
    return actions;
  }

  _assessImplementationRisks(task, context, plan) {
    const risks = [];

    // Risk: Many affected files
    if (plan.affectedFiles.length > 10) {
      risks.push({
        level: 'high',
        category: 'scope',
        description: `Large number of affected files (${plan.affectedFiles.length})`,
        mitigation: 'Review changes carefully; consider splitting into smaller tasks'
      });
    }

    // Risk: Missing tests
    if (!plan.requiresTests && task.deliverables && task.deliverables.length > 0) {
      risks.push({
        level: 'medium',
        category: 'quality',
        description: 'Implementation without tests',
        mitigation: 'Add tests before merging'
      });
    }

    // Risk: No acceptance criteria
    if (!task.acceptanceCriteria || task.acceptanceCriteria.length === 0) {
      risks.push({
        level: 'medium',
        category: 'requirements',
        description: 'No clear acceptance criteria',
        mitigation: 'Define success criteria before implementation'
      });
    }

    // Risk: Missing documentation sources
    if (context.documentation.urls.length === 0 && task.deliverables && task.deliverables.length > 3) {
      risks.push({
        level: 'low',
        category: 'context',
        description: 'No documentation sources provided for complex task',
        mitigation: 'Provide relevant documentation links'
      });
    }

    return risks;
  }

}

function normalizeRelativePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0') ||
      path.isAbsolute(filePath) || /^[a-zA-Z]:/.test(filePath)) return null;
  const normalized = path.normalize(filePath);
  const relative = path.relative('.', normalized);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return normalized.split(path.sep).join('/');
}

function readRegularFile(absolutePath, relativePath) {
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Patch source does not exist: ${relativePath}`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Patch source is not a regular file: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');
}

module.exports = {
  CodeGenerator
};

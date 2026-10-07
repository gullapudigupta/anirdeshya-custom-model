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
const { WorkspaceContext } = require('./workspace-context');
const { CONTRACT_VERSION, validatePlan, validatePatch } = require('./contracts');
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
    this.workspaceContext = options.workspaceContext || new WorkspaceContext({
      workspace: this.workspace,
      maxFiles: options.maxFiles || 40,
      maxFileBytes: options.maxFileBytes || 128 * 1024,
      maxTotalBytes: options.maxTotalBytes || 512 * 1024,
      maxTokens: options.maxTokens || 32000
    });
    this.permissionManager = options.permissionManager || new PermissionManager({ workspace: this.workspace });
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
      result.plan = await this._generatePlan(task, result.context, options);

      // 3. Generate patches from plan
      result.patches = await this._generatePatches(task, result.plan, result.context, options);

      // 4. Build traceability information
      result.traceability = this._buildTraceability(task, result.plan, result.patches, result.context);

      result.scaffold = result.patches.some(patch => patch.scaffold);
      result.success = result.patches.length > 0 && !result.scaffold;
      if (!result.patches.length) {
        result.error = 'No implementation patches were generated.';
      } else if (result.scaffold) {
        result.error = 'Only scaffolding was generated; no implementation is available to verify.';
      }
    } catch (error) {
      result.error = error.message;
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
    if (!generationResult.plan) {
      issues.push({ severity: 'error', message: 'No implementation plan generated' });
    }

    // Check patches exist
    if (!generationResult.patches || generationResult.patches.length === 0) {
      issues.push({ severity: 'error', message: 'No patches generated' });
    }
    if (generationResult.scaffold) {
      issues.push({ severity: 'error', message: 'Scaffold output is not a completed implementation' });
    }

    // Validate each patch
    for (const patch of generationResult.patches || []) {
      const patchValidation = validatePatch(patch);
      if (!patchValidation.valid) {
        issues.push({ severity: 'error', message: patchValidation.issues.join(', ') });
      }
      if (patch.scaffold || patch.changes?.some(change =>
        /Generated implementation stub|TODO:\s*Implement functionality/i.test(change.newContent || '')
      )) {
        issues.push({ severity: 'error', message: `Patch for ${patch.path || '(unknown file)'} contains scaffold only` });
      }
      if (patch.operation !== 'delete' && typeof patch.content !== 'string') {
        issues.push({ severity: 'error', message: `Patch for ${patch.path || '(unknown file)'} has no replacement content` });
      }
      if (patch.operation === 'modify' && !/^[a-f0-9]{64}$/i.test(patch.expectedHash || '')) {
        issues.push({ severity: 'error', message: `Patch for ${patch.path} has no valid expected content hash` });
      }
    }

    // Check traceability
    if (!generationResult.traceability || !generationResult.traceability.taskId) {
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

    context.relevantCode.files = context.relevantCode.files.map(file => ({
      ...file,
      content: this.permissionManager.redactSecrets(file.content)
    }));
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

    return this.guidanceLoader.load(this.workspace);
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
    const fileReferences = task.files || this._extractFileReferences(task.description);
    const collected = this.workspaceContext.collect(fileReferences);
    return {
      ...collected,
      symbols: [],
      dependencies: []
    };
  }

  async _generatePlan(task, context, options) {
    if (this.modelExecutor && typeof this.modelExecutor.generatePlan === 'function') {
      const generatedPlan = await this.modelExecutor.generatePlan({ task, context, options });
      const validation = validatePlan(generatedPlan);
      if (!validation.valid) {
        throw new Error(`Model generated an invalid plan: ${validation.issues.join(', ')}`);
      }
      return generatedPlan;
    }
    const plan = {
      schemaVersion: CONTRACT_VERSION,
      taskId: task.id,
      description: task.description,
      steps: [],
      affectedFiles: [],
      newFiles: [],
      modifiedFiles: [],
      risks: [],
      expectedChecks: [
        { type: 'lint', required: true },
        { type: 'test', required: true }
      ],
      metadata: { requiresApproval: false },
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

    // Identify affected files from bounded workspace context
    plan.affectedFiles = context.relevantCode.files.map(f => f.path);

    // Assess risks
    plan.risks = this._assessImplementationRisks(task, context, plan);

    return plan;
  }

  async _generatePatches(task, plan, context, options) {
    if (!this.modelExecutor || typeof this.modelExecutor.generatePatches !== 'function') {
      throw new Error('Model patch executor is not configured; no scaffold or simulated implementation was generated');
    }
    const patches = await this.modelExecutor.generatePatches({ task, plan, context, options });
    if (!Array.isArray(patches) || patches.length === 0) {
      throw new Error('Model patch executor returned no implementation patches');
    }
    const contextByPath = new Map(context.relevantCode.files.map(file => [file.path, file]));
    for (const patch of patches) {
      const patchValidation = validatePatch(patch);
      if (!patchValidation.valid) {
        throw new Error(`Model patch executor returned an invalid patch: ${patchValidation.issues.join(', ')}`);
      }
      if (!patch || typeof patch !== 'object' || !['create', 'modify', 'delete'].includes(patch.operation) ||
          typeof patch.path !== 'string' || !plan.affectedFiles.includes(patch.path)) {
        throw new Error('Model patch executor returned a malformed or out-of-scope patch');
      }
      const normalized = path.resolve(this.workspace, patch.path);
      const relative = path.relative(this.workspace, normalized);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Model patch path escapes the workspace: ${patch.path}`);
      }
      const source = contextByPath.get(patch.path);
      if (patch.operation === 'modify' &&
          (!source || patch.expectedHash !== source.hash || typeof patch.content !== 'string')) {
        throw new Error(`Model patch for ${patch.path} has a stale or missing source hash`);
      }
      if (patch.operation === 'create' && (source || patch.expectedHash != null || typeof patch.content !== 'string')) {
        throw new Error(`Model create patch for ${patch.path} conflicts with the bounded context`);
      }
      if (patch.operation === 'delete' && (!source || patch.expectedHash !== source.hash)) {
        throw new Error(`Model delete patch for ${patch.path} has a stale or missing source hash`);
      }
      if (/Generated implementation stub|TODO:\s*Implement functionality/i.test(patch.content || '')) {
        throw new Error(`Model patch for ${patch.path} contains scaffold-only output`);
      }
    }
    return patches;
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
        filesModified: patches.filter(p => p.operation === 'modify').length,
        filesCreated: patches.filter(p => p.operation === 'create').length,
        filesDeleted: patches.filter(p => p.operation === 'delete').length,
        totalChanges: patches.length
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

module.exports = {
  CodeGenerator
};

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

/**
 * Code Generation Workflow
 */
class CodeGenerator {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.contextProvider = options.contextProvider || null;
    this.modelExecutor = options.modelExecutor || null;
    this.guidanceLoader = options.guidanceLoader || null;
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

      result.success = true;
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

    // Validate each patch
    for (const patch of generationResult.patches || []) {
      if (!patch.filePath) {
        issues.push({ severity: 'error', message: 'Patch missing file path' });
      }
      if (!patch.changes || patch.changes.length === 0) {
        issues.push({ severity: 'warning', message: `No changes in patch for ${patch.filePath}` });
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
    const patches = [];

    // In a real implementation, this would use the model executor
    // to generate actual code changes. For now, create patch structure.
    
    for (const file of plan.affectedFiles) {
      patches.push({
        filePath: file,
        changes: [
          {
            type: 'modify',
            startLine: 1,
            endLine: 1,
            oldContent: '',
            newContent: '// Generated implementation stub',
            reason: 'Implementation from task requirements'
          }
        ],
        taskId: task.id,
        requiresReview: true
      });
    }

    // Add patches for new files
    for (const file of plan.newFiles || []) {
      patches.push({
        filePath: file,
        changes: [
          {
            type: 'create',
            newContent: this._generateFileTemplate(file, context),
            reason: `New file for ${task.description}`
          }
        ],
        taskId: task.id,
        requiresReview: true
      });
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
        filesModified: patches.filter(p => p.changes.some(c => c.type === 'modify')).length,
        filesCreated: patches.filter(p => p.changes.some(c => c.type === 'create')).length,
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

  _generateFileTemplate(filePath, context) {
    const ext = path.extname(filePath);
    const projectType = context.workspace.projectType;

    // Generate basic template based on file type
    if (ext === '.js' || ext === '.ts') {
      return `/**
 * ${path.basename(filePath)}
 * 
 * Generated from task ${context.task.id}
 */

'use strict';

// TODO: Implement functionality

module.exports = {
  // Export your functions here
};
`;
    }

    if (ext === '.py') {
      return `"""
${path.basename(filePath)}

Generated from task ${context.task.id}
"""

# TODO: Implement functionality
`;
    }

    // Default template
    return `// ${path.basename(filePath)}\n// Generated from task ${context.task.id}\n\n`;
  }
}

module.exports = {
  CodeGenerator
};

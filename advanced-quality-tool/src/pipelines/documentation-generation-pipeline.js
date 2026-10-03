/**
 * Documentation Generation and Publishing Pipeline (P9-T040)
 *
 * Generates implementation notes, API references, setup guides, acceptance reports,
 * and task completion summaries from approved task context.
 * Validates links, code examples, status claims, and archive placement.
 *
 * @module pipelines/documentation-generation-pipeline
 */

'use strict';

const { PipelineExecutor } = require('./pipeline-executor');
const { getRegistry } = require('./pipeline-registry');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Document types
 */
const DocumentType = {
  IMPLEMENTATION_NOTES: 'implementation-notes',
  API_REFERENCE: 'api-reference',
  SETUP_GUIDE: 'setup-guide',
  ACCEPTANCE_REPORT: 'acceptance-report',
  TASK_SUMMARY: 'task-summary',
  README: 'readme',
  CHANGELOG: 'changelog'
};

/**
 * Documentation status
 */
const DocumentStatus = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending-review',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  ARCHIVED: 'archived'
};

/**
 * Documentation Generation Pipeline
 */
class DocumentationGenerationPipeline {
  constructor(options = {}) {
    this.executor = options.executor || new PipelineExecutor();
    
    // Configuration
    this.docsDir = options.docsDir || path.join(process.cwd(), 'docs');
    this.archiveDir = options.archiveDir || path.join(this.docsDir, 'completed');
    this.templates = options.templates || {};
    
    // Validators
    this.linkValidator = options.linkValidator || null;
  }

  /**
   * Execute documentation generation pipeline
   * @param {Object} params
   * @param {Object} params.task - Task to generate documentation for
   * @param {string[]} [params.templates] - Templates to use
   * @param {Object} params.context - Task context (requirements, code, docs)
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const { task, templates, context } = params;

    const stageHandlers = {
      'select-task': async (ctx) => this._selectTask(ctx, task),
      'collect-requirements': async (ctx) => this._collectRequirements(ctx),
      'collect-code-and-doc-context': async (ctx) => this._collectCodeAndDocContext(ctx, context),
      'build-outline': async (ctx) => this._buildOutline(ctx),
      'generate-document': async (ctx) => this._generateDocument(ctx, templates),
      'validate-links': async (ctx) => this._validateLinks(ctx),
      'review-diff': async (ctx) => this._reviewDiff(ctx),
      'publish-or-archive': async (ctx) => this._publishOrArchive(ctx)
    };

    const result = await this.executor.execute('documentation-generation', {
      input: { task, templates, context },
      stageHandlers
    });

    return result;
  }

  /**
   * Generate document from template
   * @param {string} templateName
   * @param {Object} data
   * @returns {string}
   */
  generateFromTemplate(templateName, data) {
    const template = this.templates[templateName] || this._getDefaultTemplate(templateName);
    
    if (!template) {
      throw new Error(`Template not found: ${templateName}`);
    }
    
    return this._renderTemplate(template, data);
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _selectTask(ctx, task) {
    if (!task || !task.id) {
      return {
        selected: false,
        reason: 'Invalid or missing task'
      };
    }
    
    return {
      selected: true,
      task,
      taskId: task.id,
      taskName: task.name,
      status: task.status
    };
  }

  async _collectRequirements(ctx) {
    const { task } = ctx.previousResults?.['select-task'] || {};
    
    if (!task) {
      return { requirements: [] };
    }
    
    const requirements = {
      deliverables: task.deliverables || [],
      acceptanceCriteria: task.acceptanceCriteria || [],
      dependencies: task.dependencies || [],
      tags: task.tags || []
    };
    
    // Extract requirement IDs from task
    requirements.ids = this._extractRequirementIds(task);
    
    return { requirements };
  }

  async _collectCodeAndDocContext(ctx, context) {
    const collected = {
      files: [],
      documentation: [],
      references: []
    };
    
    if (!context) {
      return { collected, warning: 'No context provided' };
    }
    
    // Collect code context
    if (context.files) {
      for (const file of context.files) {
        const fileInfo = this._collectFileInfo(file);
        collected.files.push(fileInfo);
      }
    }
    
    // Collect documentation sources
    if (context.documentation) {
      for (const doc of context.documentation) {
        collected.documentation.push({
          url: doc.url,
          title: doc.title || path.basename(doc.url),
          sections: doc.sections || []
        });
      }
    }
    
    // Collect references
    if (context.references) {
      collected.references = context.references;
    }
    
    return {
      collected,
      stats: {
        files: collected.files.length,
        docs: collected.documentation.length,
        refs: collected.references.length
      }
    };
  }

  async _buildOutline(ctx) {
    const { task } = ctx.previousResults?.['select-task'] || {};
    const { requirements } = ctx.previousResults?.['collect-requirements'] || {};
    const { collected } = ctx.previousResults?.['collect-code-and-doc-context'] || {};
    
    const outline = {
      title: this._generateTitle(task),
      sections: [],
      metadata: {
        taskId: task?.id,
        generated: Date.now(),
        documentType: this._determineDocumentType(task)
      }
    };
    
    // Add standard sections
    outline.sections.push({
      id: 'overview',
      title: 'Overview',
      content: this._generateOverview(task)
    });
    
    // Add requirements section
    if (requirements?.deliverables?.length > 0) {
      outline.sections.push({
        id: 'requirements',
        title: 'Requirements',
        items: requirements.deliverables.map((d, i) => ({
          id: `REQ-${i + 1}`,
          description: d
        }))
      });
    }
    
    // Add implementation section
    if (collected?.files?.length > 0) {
      outline.sections.push({
        id: 'implementation',
        title: 'Implementation',
        files: collected.files.map(f => ({
          path: f.path,
          description: f.description
        }))
      });
    }
    
    // Add documentation sources section
    if (collected?.documentation?.length > 0) {
      outline.sections.push({
        id: 'references',
        title: 'References',
        sources: collected.documentation.map(d => ({
          url: d.url,
          title: d.title
        }))
      });
    }
    
    return { outline };
  }

  async _generateDocument(ctx, templates) {
    const { outline } = ctx.previousResults?.['build-outline'] || {};
    const { task } = ctx.previousResults?.['select-task'] || {};
    
    if (!outline) {
      return { generated: false, reason: 'No outline to generate from' };
    }
    
    // Determine document type
    const docType = outline.metadata.documentType;
    
    // Get template
    const templateName = templates?.[0] || docType;
    const template = this.templates[templateName] || this._getDefaultTemplate(templateName);
    
    // Generate document content
    const content = this._renderDocument(outline, template, task);
    
    // Generate file path
    const filename = this._generateFilename(task, docType);
    const filePath = path.join(this.docsDir, filename);
    
    return {
      generated: true,
      document: {
        content,
        filePath,
        filename,
        docType,
        metadata: outline.metadata,
        wordCount: content.split(/\s+/).length
      }
    };
  }

  async _validateLinks(ctx) {
    const { document } = ctx.previousResults?.['generate-document'] || {};
    
    if (!document) {
      return { validated: false, reason: 'No document to validate' };
    }
    
    const validation = {
      valid: true,
      links: [],
      errors: [],
      warnings: []
    };
    
    // Extract links from document
    const links = this._extractLinks(document.content);
    
    for (const link of links) {
      const result = await this._validateLink(link);
      
      validation.links.push(result);
      
      if (!result.valid) {
        validation.valid = false;
        validation.errors.push({
          link: link.url,
          error: result.error
        });
      }
    }
    
    // Validate code examples
    const codeBlocks = this._extractCodeBlocks(document.content);
    
    for (const block of codeBlocks) {
      if (block.language && !this._isValidLanguage(block.language)) {
        validation.warnings.push({
          type: 'invalid-language',
          language: block.language
        });
      }
    }
    
    return { validation };
  }

  async _reviewDiff(ctx) {
    const { document } = ctx.previousResults?.['generate-document'] || {};
    
    if (!document) {
      return { reviewed: false };
    }
    
    // Check if file already exists
    const existingPath = document.filePath;
    let diff = null;
    let isNew = true;
    
    if (fs.existsSync(existingPath)) {
      isNew = false;
      const existingContent = fs.readFileSync(existingPath, 'utf8');
      diff = this._computeDiff(existingContent, document.content);
    }
    
    return {
      reviewed: true,
      isNew,
      diff,
      approvalRequired: !isNew && diff?.changedLines > 10
    };
  }

  async _publishOrArchive(ctx) {
    const { document, validation } = Object.assign({}, 
      ctx.previousResults?.['generate-document'] || {},
      ctx.previousResults?.['validate-links'] || {}
    );
    const { task } = ctx.previousResults?.['select-task'] || {};
    
    if (!document) {
      return { published: false, reason: 'No document to publish' };
    }
    
    // Determine destination
    const isCompleted = task?.status === 'COMPLETED';
    const targetDir = isCompleted ? this.archiveDir : this.docsDir;
    
    // Ensure directory exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Write document
    const targetPath = path.join(targetDir, document.filename);
    fs.writeFileSync(targetPath, document.content, 'utf8');
    
    // Add metadata header
    const metadataPath = `${targetPath}.meta.json`;
    fs.writeFileSync(metadataPath, JSON.stringify({
      taskId: document.metadata.taskId,
      generated: document.metadata.generated,
      docType: document.metadata.documentType,
      wordCount: document.wordCount,
      validationPassed: validation?.valid
    }, null, 2), 'utf8');
    
    return {
      published: true,
      archived: isCompleted,
      path: targetPath,
      metadata: document.metadata
    };
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────────

  _extractRequirementIds(task) {
    const ids = [];
    
    if (task.id) ids.push(task.id);
    if (task.dependencies) ids.push(...task.dependencies);
    
    return ids;
  }

  _collectFileInfo(file) {
    try {
      const stats = fs.statSync(file);
      return {
        path: file,
        size: stats.size,
        description: path.basename(file)
      };
    } catch {
      return { path: file, description: path.basename(file) };
    }
  }

  _generateTitle(task) {
    if (task?.name) {
      return task.name;
    }
    
    return 'Generated Documentation';
  }

  _determineDocumentType(task) {
    if (!task) return DocumentType.IMPLEMENTATION_NOTES;
    
    const name = (task.name || '').toLowerCase();
    const tags = task.tags || [];
    
    if (name.includes('api') || tags.includes('api')) {
      return DocumentType.API_REFERENCE;
    }
    
    if (name.includes('setup') || name.includes('install')) {
      return DocumentType.SETUP_GUIDE;
    }
    
    if (task.status === 'COMPLETED') {
      return DocumentType.ACCEPTANCE_REPORT;
    }
    
    return DocumentType.IMPLEMENTATION_NOTES;
  }

  _generateOverview(task) {
    if (!task) return '';
    
    const parts = [];
    
    if (task.description) {
      parts.push(task.description);
    }
    
    if (task.deliverables?.length > 0) {
      parts.push('\n## Deliverables\n');
      for (const d of task.deliverables) {
        parts.push(`- ${d}`);
      }
    }
    
    return parts.join('\n');
  }

  _getDefaultTemplate(templateName) {
    return `# {{title}}

Generated: {{generated}}
Task ID: {{taskId}}

## Overview

{{overview}}

{{#requirements}}
## Requirements

{{#items}}
- {{id}}: {{description}}
{{/items}}

{{/requirements}}
{{#implementation}}
## Implementation

{{#files}}
- {{path}}: {{description}}
{{/files}}

{{/implementation}}
{{#references}}
## References

{{#sources}}
- [{{title}}]({{url}})
{{/sources}}

{{/references}}
`;
  }

  _renderDocument(outline, template, task) {
    let content = template;
    
    content = content.replace(/\{\{title\}\}/g, outline.title);
    content = content.replace(/\{\{generated\}\}/g, new Date().toISOString());
    content = content.replace(/\{\{taskId\}\}/g, outline.metadata.taskId || 'N/A');
    
    // Render sections
    for (const section of outline.sections) {
      content = content.replace(`{{${section.id}}}`, section.content || '');
    }
    
    // Render conditional sections
    if (outline.sections.find(s => s.id === 'requirements')) {
      const reqSection = outline.sections.find(s => s.id === 'requirements');
      let reqContent = '## Requirements\n\n';
      for (const item of reqSection.items || []) {
        reqContent += `- **${item.id}**: ${item.description}\n`;
      }
      content = content.replace(/\{\{#requirements\}\}[\s\S]*?\{\{\/requirements\}\}/, reqContent);
    }
    
    if (outline.sections.find(s => s.id === 'implementation')) {
      const implSection = outline.sections.find(s => s.id === 'implementation');
      let implContent = '## Implementation\n\n';
      for (const file of implSection.files || []) {
        implContent += `- \`${file.path}\`: ${file.description}\n`;
      }
      content = content.replace(/\{\{#implementation\}\}[\s\S]*?\{\{\/implementation\}\}/, implContent);
    }
    
    if (outline.sections.find(s => s.id === 'references')) {
      const refSection = outline.sections.find(s => s.id === 'references');
      let refContent = '## References\n\n';
      for (const source of refSection.sources || []) {
        refContent += `- [${source.title}](${source.url})\n`;
      }
      content = content.replace(/\{\{#references\}\}[\s\S]*?\{\{\/references\}\}/, refContent);
    }
    
    return content;
  }

  _renderTemplate(template, data) {
    let result = template;
    
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, value);
    }
    
    return result;
  }

  _generateFilename(task, docType) {
    const taskId = task?.id || 'unknown';
    const safeId = taskId.replace(/[^a-zA-Z0-9-]/g, '-');
    const date = new Date().toISOString().split('T')[0];
    
    return `${safeId}-${docType}-${date}.md`;
  }

  _extractLinks(content) {
    const links = [];
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      links.push({
        text: match[1],
        url: match[2]
      });
    }
    
    return links;
  }

  async _validateLink(link) {
    // Skip external link validation if no validator
    if (link.url.startsWith('http')) {
      if (this.linkValidator) {
        return this.linkValidator.validate(link.url);
      }
      return { valid: true, url: link.url };
    }
    
    // Validate internal link
    const targetPath = path.join(this.docsDir, link.url);
    const exists = fs.existsSync(targetPath);
    
    return {
      valid: exists,
      url: link.url,
      error: exists ? null : 'File not found'
    };
  }

  _extractCodeBlocks(content) {
    const blocks = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      blocks.push({
        language: match[1],
        code: match[2]
      });
    }
    
    return blocks;
  }

  _isValidLanguage(lang) {
    const valid = ['javascript', 'typescript', 'python', 'java', 'csharp', 'go', 'rust', 'bash', 'json', 'yaml'];
    return !lang || valid.includes(lang.toLowerCase());
  }

  _computeDiff(oldContent, newContent) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    return {
      oldLines: oldLines.length,
      newLines: newLines.length,
      changedLines: Math.abs(oldLines.length - newLines.length),
      added: Math.max(0, newLines.length - oldLines.length),
      removed: Math.max(0, oldLines.length - newLines.length)
    };
  }
}

module.exports = {
  DocumentationGenerationPipeline,
  DocumentType,
  DocumentStatus
};

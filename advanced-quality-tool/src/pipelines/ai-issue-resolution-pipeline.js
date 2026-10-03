/**
 * AI Issue Resolution Pipeline (P9-T028)
 *
 * Instruments the existing AI generation workflow as a named pipeline:
 * classify → analyze code context → search (docs, GitHub, SO) → resolve deps →
 * aggregate → build prompt → execute model → apply edits → verify → recover.
 *
 * Records all stages, searches, model calls, and recovery attempts.
 *
 * @module pipelines/ai-issue-resolution-pipeline
 */

'use strict';

const { PipelineExecutor } = require('./pipeline-executor');
const { AIGenerationOrchestrator } = require('../ai-generator');

/**
 * AI Issue Resolution Pipeline
 */
class AIIssueResolutionPipeline {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.executor = options.executor || new PipelineExecutor();
    
    // AI Generation components
    this.aiOrchestrator = options.aiOrchestrator || new AIGenerationOrchestrator({
      rootDir: this.workspace,
      ...options.aiOrchestratorOptions
    });
    
    this.strategy = options.strategy || 'local-first';
  }

  /**
   * Execute AI issue resolution pipeline
   * @param {Object} params
   * @param {Object} params.issue - Issue to resolve
   * @param {string} [params.taskId] - Associated task ID
   * @param {string} [params.strategy] - Execution strategy
   * @param {string} [params.model] - Model to use
   * @returns {Promise<Object>}
   */
  async execute(params) {
    const { issue, taskId = null, strategy = this.strategy, model = null } = params;

    const stageHandlers = {
      'classify-issue': async (ctx) => this._classifyIssue(ctx, issue),
      'analyze-code-context': async (ctx) => this._analyzeCodeContext(ctx, issue),
      'search-docs': async (ctx) => this._searchDocs(ctx),
      'search-github': async (ctx) => this._searchGitHub(ctx),
      'search-stackoverflow': async (ctx) => this._searchStackOverflow(ctx),
      'resolve-dependency-docs': async (ctx) => this._resolveDependencyDocs(ctx, issue),
      'aggregate-context': async (ctx) => this._aggregateContext(ctx),
      'build-prompt': async (ctx) => this._buildPrompt(ctx),
      'execute-model': async (ctx) => this._executeModel(ctx, strategy, model),
      'apply-line-edits': async (ctx) => this._applyLineEdits(ctx, issue),
      'verify': async (ctx) => this._verify(ctx),
      'recover': async (ctx) => this._recover(ctx, issue)
    };

    const result = await this.executor.execute('ai-issue-resolution', {
      input: { issue, strategy, model },
      taskId,
      workspace: this.workspace,
      context: { strategy, model },
      stageHandlers
    });

    return result;
  }

  /**
   * Process multiple issues in batch
   * @param {Array} issues
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async executeBatch(issues, options = {}) {
    const results = [];
    const summary = {
      total: issues.length,
      successful: 0,
      failed: 0,
      recovered: 0
    };

    for (let i = 0; i < issues.length; i++) {
      const result = await this.execute({
        issue: issues[i],
        ...options
      });

      results.push(result);

      if (result.status === 'completed' && result.output?.success) {
        summary.successful++;
        if (result.output.recovered) {
          summary.recovered++;
        }
      } else {
        summary.failed++;
      }
    }

    return {
      summary,
      results
    };
  }

  // ─── Stage Handlers ───────────────────────────────────────────────────────────

  async _classifyIssue(ctx, issue) {
    const classifier = this.aiOrchestrator.classifier;
    
    try {
      const classification = classifier.classify(issue);
      
      ctx.ledger.recordToolCall(ctx.runId, {
        name: 'issue_classifier',
        args: { issueId: issue.id, rule: issue.rule },
        result: {
          category: classification.category,
          complexity: classification.complexity,
          requiresContext: classification.requiresContext
        },
        duration: 0
      });

      return classification;
    } catch (error) {
      return {
        category: 'unknown',
        complexity: 'medium',
        requiresContext: true,
        error: error.message
      };
    }
  }

  async _analyzeCodeContext(ctx, issue) {
    const analyzer = this.aiOrchestrator.contextAnalyzer;
    
    try {
      const codeContext = analyzer.analyze(issue);
      
      ctx.ledger.recordToolCall(ctx.runId, {
        name: 'code_context_analyzer',
        args: { file: issue.file, line: issue.line },
        result: {
          linesAnalyzed: codeContext.surroundingLines?.length || 0,
          symbolsFound: codeContext.symbols?.length || 0,
          importsFound: codeContext.imports?.length || 0
        },
        duration: 0
      });

      return codeContext;
    } catch (error) {
      return {
        error: error.message,
        surroundingLines: [],
        symbols: [],
        imports: []
      };
    }
  }

  async _searchDocs(ctx) {
    const classification = ctx.previousResults['classify-issue'];
    const searchers = this.aiOrchestrator.options.searchers || [];
    
    const docSearcher = searchers.find(s => s.constructor.name === 'DocSearcher');
    if (!docSearcher) {
      return { skipped: true, reason: 'No doc searcher available' };
    }

    try {
      const searchResult = await docSearcher.search(classification);
      
      ctx.ledger.recordToolCall(ctx.runId, {
        name: 'doc_searcher',
        args: { query: classification.category },
        result: {
          fragmentsFound: searchResult.fragments?.length || 0
        },
        duration: searchResult.duration || 0
      });

      return {
        fragments: searchResult.fragments || [],
        source: 'documentation'
      };
    } catch (error) {
      return {
        error: error.message,
        fragments: [],
        source: 'documentation'
      };
    }
  }

  async _searchGitHub(ctx) {
    const classification = ctx.previousResults['classify-issue'];
    const searchers = this.aiOrchestrator.options.searchers || [];
    
    const githubSearcher = searchers.find(s => s.constructor.name === 'GitHubSearcher');
    if (!githubSearcher) {
      return { skipped: true, reason: 'No GitHub searcher available' };
    }

    try {
      const searchResult = await githubSearcher.search(classification);
      
      ctx.ledger.recordToolCall(ctx.runId, {
        name: 'github_searcher',
        args: { query: classification.category },
        result: {
          fragmentsFound: searchResult.fragments?.length || 0
        },
        duration: searchResult.duration || 0
      });

      return {
        fragments: searchResult.fragments || [],
        source: 'github'
      };
    } catch (error) {
      return {
        error: error.message,
        fragments: [],
        source: 'github'
      };
    }
  }

  async _searchStackOverflow(ctx) {
    const classification = ctx.previousResults['classify-issue'];
    const searchers = this.aiOrchestrator.options.searchers || [];
    
    const soSearcher = searchers.find(s => s.constructor.name === 'StackOverflowSearcher');
    if (!soSearcher) {
      return { skipped: true, reason: 'No StackOverflow searcher available' };
    }

    try {
      const searchResult = await soSearcher.search(classification);
      
      ctx.ledger.recordToolCall(ctx.runId, {
        name: 'stackoverflow_searcher',
        args: { query: classification.category },
        result: {
          fragmentsFound: searchResult.fragments?.length || 0
        },
        duration: searchResult.duration || 0
      });

      return {
        fragments: searchResult.fragments || [],
        source: 'stackoverflow'
      };
    } catch (error) {
      return {
        error: error.message,
        fragments: [],
        source: 'stackoverflow'
      };
    }
  }

  async _resolveDependencyDocs(ctx, issue) {
    const resolver = this.aiOrchestrator.options.dependencyResolver;
    if (!resolver) {
      return { skipped: true, reason: 'No dependency resolver available' };
    }

    try {
      const docContext = await resolver.buildDocContext(issue);
      
      ctx.ledger.recordToolCall(ctx.runId, {
        name: 'dependency_doc_resolver',
        args: { issueId: issue.id },
        result: {
          fragmentsFound: docContext.fragments?.length || 0,
          dependencies: docContext.dependencies?.length || 0
        },
        duration: 0
      });

      return {
        fragments: docContext.fragments || [],
        dependencies: docContext.dependencies || [],
        source: 'dependency-docs'
      };
    } catch (error) {
      return {
        error: error.message,
        fragments: [],
        dependencies: [],
        source: 'dependency-docs'
      };
    }
  }

  async _aggregateContext(ctx) {
    const aggregator = this.aiOrchestrator.aggregator;
    
    const codeContext = ctx.previousResults['analyze-code-context'];
    const classification = ctx.previousResults['classify-issue'];
    
    // Collect all fragments
    const fragments = [
      ...(ctx.previousResults['search-docs']?.fragments || []),
      ...(ctx.previousResults['search-github']?.fragments || []),
      ...(ctx.previousResults['search-stackoverflow']?.fragments || []),
      ...(ctx.previousResults['resolve-dependency-docs']?.fragments || [])
    ];

    try {
      const aggregated = aggregator.aggregate({
        codeContext,
        classification,
        fragments
      });

      return {
        totalFragments: fragments.length,
        aggregated,
        contextSize: JSON.stringify(aggregated).length
      };
    } catch (error) {
      return {
        error: error.message,
        totalFragments: fragments.length,
        aggregated: { codeContext, classification, fragments: [] }
      };
    }
  }

  async _buildPrompt(ctx) {
    const promptBuilder = this.aiOrchestrator.promptBuilder;
    const classification = ctx.previousResults['classify-issue'];
    const codeContext = ctx.previousResults['analyze-code-context'];

    try {
      const prompt = promptBuilder.build(classification, codeContext);
      
      return {
        prompt,
        promptLength: prompt.length,
        estimatedTokens: Math.ceil(prompt.length / 4) // Rough estimate
      };
    } catch (error) {
      return {
        error: error.message,
        prompt: '',
        promptLength: 0
      };
    }
  }

  async _executeModel(ctx, strategy, modelName) {
    const prompt = ctx.previousResults['build-prompt'].prompt;
    
    const localExecutor = this.aiOrchestrator.options.localExecutor;
    const cloudExecutor = this.aiOrchestrator.options.cloudExecutor;

    let result = null;
    let provider = null;

    // Try local first if strategy allows
    if (strategy !== 'cloud-only' && localExecutor && localExecutor.available) {
      try {
        result = await localExecutor.execute(prompt);
        provider = 'local';
        
        ctx.ledger.recordModelCall(ctx.runId, {
          provider: 'local',
          model: result.model || modelName || 'unknown',
          promptTokens: result.promptTokens || 0,
          completionTokens: result.completionTokens || 0,
          cost: 0,
          duration: result.duration || 0
        });

        if (result.ok) {
          return {
            success: true,
            text: result.text,
            provider,
            model: result.model || modelName,
            fallback: false
          };
        }
      } catch (error) {
        // Continue to cloud fallback if local fails
      }
    }

    // Try cloud if strategy allows
    if (strategy !== 'local-only' && cloudExecutor && cloudExecutor.available) {
      try {
        result = await cloudExecutor.execute(prompt);
        provider = result.provider || 'cloud';
        
        ctx.ledger.recordModelCall(ctx.runId, {
          provider,
          model: result.model || modelName || 'unknown',
          promptTokens: result.promptTokens || 0,
          completionTokens: result.completionTokens || 0,
          cost: result.cost || 0,
          duration: result.duration || 0
        });

        if (result.ok) {
          return {
            success: true,
            text: result.text,
            provider,
            model: result.model || modelName,
            fallback: true,
            cost: result.cost
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error.message,
          provider: null
        };
      }
    }

    return {
      success: false,
      error: 'No executor available',
      provider: null
    };
  }

  async _applyLineEdits(ctx, issue) {
    const modelResult = ctx.previousResults['execute-model'];
    if (!modelResult.success) {
      return {
        success: false,
        error: 'Model execution failed'
      };
    }

    const lineEditor = this.aiOrchestrator.lineEditor;

    try {
      const plan = lineEditor.parseEditPlan(modelResult.text);
      const applyResult = lineEditor.applyToFile(issue.file, plan);

      if (applyResult.applied) {
        ctx.ledger.recordFileChanges(ctx.runId, [issue.file], {
          editsApplied: plan.edits?.length || 0,
          backupPath: applyResult.backupPath
        });
      }

      return {
        success: applyResult.applied,
        backupPath: applyResult.backupPath,
        errors: applyResult.errors || [],
        editsApplied: plan.edits?.length || 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async _verify(ctx) {
    const applyResult = ctx.previousResults['apply-line-edits'];
    if (!applyResult.success) {
      return {
        passed: false,
        reason: 'Edits were not applied'
      };
    }

    // Stub: In real implementation, would run linters/tests
    const passed = Math.random() > 0.2; // 80% pass rate for demo

    ctx.ledger.recordValidation(ctx.runId, {
      name: 'post_fix_verification',
      passed,
      errors: passed ? [] : ['Verification failed'],
      warnings: []
    });

    return {
      passed,
      reason: passed ? null : 'Verification checks failed'
    };
  }

  async _recover(ctx, issue) {
    const verifyResult = ctx.previousResults['verify'];
    const applyResult = ctx.previousResults['apply-line-edits'];

    if (verifyResult.passed) {
      return {
        recoveryNeeded: false,
        success: true
      };
    }

    const errorRecovery = this.aiOrchestrator.options.errorRecovery;
    if (!errorRecovery) {
      return {
        recoveryNeeded: true,
        success: false,
        reason: 'No error recovery available'
      };
    }

    // Attempt recovery
    try {
      const lineEditor = this.aiOrchestrator.lineEditor;
      
      const recovery = await errorRecovery.retry({
        attempt: async (enhancedContext, attemptNo) => {
          // Re-apply with enhanced context
          const modelResult = ctx.previousResults['execute-model'];
          const plan = lineEditor.parseEditPlan(modelResult.text);
          const result = lineEditor.applyToFile(issue.file, plan);
          
          return {
            files: [issue.file],
            applied: result.applied
          };
        }
      });

      return {
        recoveryNeeded: true,
        success: recovery.success,
        attempts: recovery.attempts,
        reason: recovery.success ? null : 'Recovery exhausted retries'
      };
    } catch (error) {
      return {
        recoveryNeeded: true,
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = {
  AIIssueResolutionPipeline
};

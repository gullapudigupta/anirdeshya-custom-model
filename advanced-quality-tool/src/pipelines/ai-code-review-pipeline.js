/**
 * AI Code Review Pipeline
 * Task: P9-T029
 * 
 * Instruments AICodeReviewAssistant as a structured review pipeline with bounded context.
 * Normalizes findings with evidence locations, severity, confidence, recommendations.
 */

const { Pipeline } = require('../core/pipeline');

/**
 * AI Code Review Pipeline Stages
 */
const STAGES = [
  { name: 'select-files', description: 'Select files for review' },
  { name: 'read-code', description: 'Read file contents' },
  { name: 'bound-context', description: 'Apply context boundaries' },
  { name: 'build-review-prompt', description: 'Construct review prompt' },
  { name: 'execute-model', description: 'Execute AI model' },
  { name: 'parse-findings', description: 'Parse review findings' },
  { name: 'score-findings', description: 'Score and rank findings' },
  { name: 'publish-review', description: 'Publish review results' }
];

/**
 * Review finding types
 */
const FindingTypes = {
  BUG: 'bug',
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  STYLE: 'style',
  BEST_PRACTICE: 'best-practice',
  DOCUMENTATION: 'documentation',
  COMPLEXITY: 'complexity',
  MAINTAINABILITY: 'maintainability'
};

/**
 * AI Code Review Pipeline Implementation
 */
class AICodeReviewPipeline extends Pipeline {
  constructor(options = {}) {
    super('ai-code-review', STAGES, options);
    
    this.modelExecutor = options.modelExecutor;
    this.contextLimiter = options.contextLimiter;
    this.maxTokens = options.maxTokens || 4000;
    this.focusAreas = options.focusAreas || [];
  }

  /**
   * Stage: select-files
   */
  async selectFiles(context) {
    const files = context.files || [];
    const options = context.options || {};
    
    // Filter to supported file types
    const supportedExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs'];
    const selectedFiles = files.filter(f => 
      supportedExtensions.some(ext => f.endsWith(ext))
    );
    
    return { files: selectedFiles };
  }

  /**
   * Stage: read-code
   */
  async readCode(context) {
    const { files } = context.previousResult;
    const fs = require('fs');
    
    const fileContents = [];
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        fileContents.push({
          path: file,
          content,
          lines: content.split('\n').length
        });
      } catch (error) {
        fileContents.push({
          path: file,
          error: error.message
        });
      }
    }
    
    return { fileContents };
  }

  /**
   * Stage: bound-context
   */
  async boundContext(context) {
    const { fileContents } = context.previousResult;
    
    const bounded = fileContents.map(file => {
      if (file.error) return file;
      
      // Apply token limit
      const boundedContent = this.contextLimiter?.limit(file.content, this.maxTokens) ||
        this.defaultLimit(file.content, this.maxTokens);
      
      return {
        ...file,
        boundedContent,
        truncated: boundedContent.length < file.content.length
      };
    });
    
    return { boundedContents: bounded };
  }

  /**
   * Default content limiting
   */
  defaultLimit(content, maxTokens) {
    // Rough approximation: 4 chars per token
    const maxChars = maxTokens * 4;
    
    if (content.length <= maxChars) {
      return content;
    }
    
    return content.substring(0, maxChars) + '\n... [truncated]';
  }

  /**
   * Stage: build-review-prompt
   */
  async buildReviewPrompt(context) {
    const { boundedContents } = context.previousResult;
    const options = context.options || {};
    
    const prompt = this.constructReviewPrompt(boundedContents, options);
    
    return { prompt, focusAreas: this.focusAreas };
  }

  /**
   * Construct review prompt
   */
  constructReviewPrompt(files, options) {
    const sections = [];
    
    sections.push('# Code Review Request\n');
    
    if (this.focusAreas.length > 0) {
      sections.push('## Focus Areas');
      sections.push(this.focusAreas.map(a => `- ${a}`).join('\n'));
      sections.push('');
    }
    
    sections.push('## Instructions');
    sections.push('Review the following code for:');
    sections.push('- Bugs and potential errors');
    sections.push('- Security vulnerabilities');
    sections.push('- Performance issues');
    sections.push('- Code style and best practices');
    sections.push('- Maintainability concerns');
    sections.push('');
    sections.push('For each finding, provide:');
    sections.push('- File and line number');
    sections.push('- Severity (critical/error/warning/info)');
    sections.push('- Description of the issue');
    sections.push('- Recommended fix');
    sections.push('');
    
    sections.push('## Files to Review\n');
    
    for (const file of files) {
      if (file.error) {
        sections.push(`### ${file.path}\nError: ${file.error}\n`);
      } else {
        sections.push(`### ${file.path}`);
        if (file.truncated) {
          sections.push('(truncated for context limits)');
        }
        sections.push('```');
        sections.push(file.boundedContent);
        sections.push('```\n');
      }
    }
    
    return sections.join('\n');
  }

  /**
   * Stage: execute-model
   */
  async executeModel(context) {
    const { prompt } = context.previousResult;
    const options = context.options || {};
    
    if (!this.modelExecutor) {
      return {
        success: false,
        error: 'No model executor configured',
        rawOutput: null
      };
    }
    
    try {
      const result = await this.modelExecutor.execute(prompt, {
        maxTokens: options.maxTokens || 2000,
        temperature: 0.3 // Lower temperature for more consistent reviews
      });
      
      return {
        success: true,
        rawOutput: result.output,
        model: result.model,
        provider: result.provider,
        tokens: result.tokens
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        rawOutput: null
      };
    }
  }

  /**
   * Stage: parse-findings
   */
  async parseFindings(context) {
    const { success, rawOutput, error } = context.previousResult;
    
    if (!success) {
      return {
        findings: [],
        parseError: error
      };
    }
    
    const findings = this.parseReviewOutput(rawOutput);
    
    return { findings };
  }

  /**
   * Parse review output into structured findings
   */
  parseReviewOutput(output) {
    const findings = [];
    
    if (!output) return findings;
    
    // Parse structured findings from output
    const lines = output.split('\n');
    let currentFinding = null;
    
    for (const line of lines) {
      // Look for file references
      const fileMatch = line.match(/(?:File|Location):\s*(.+)/i);
      if (fileMatch) {
        if (currentFinding) findings.push(currentFinding);
        currentFinding = {
          file: fileMatch[1].trim(),
          line: null,
          type: FindingTypes.BUG,
          severity: 'warning',
          message: '',
          recommendation: ''
        };
        continue;
      }
      
      // Look for line numbers
      const lineMatch = line.match(/(?:Line|L):\s*(\d+)/i);
      if (lineMatch && currentFinding) {
        currentFinding.line = parseInt(lineMatch[1]);
        continue;
      }
      
      // Look for severity
      const sevMatch = line.match(/(?:Severity|Level):\s*(critical|error|warning|info)/i);
      if (sevMatch && currentFinding) {
        currentFinding.severity = sevMatch[1].toLowerCase();
        continue;
      }
      
      // Look for issue description
      const descMatch = line.match(/(?:Issue|Problem|Error):\s*(.+)/i);
      if (descMatch && currentFinding) {
        currentFinding.message = descMatch[1].trim();
        continue;
      }
      
      // Look for recommendations
      const recMatch = line.match(/(?:Recommendation|Fix|Suggestion):\s*(.+)/i);
      if (recMatch && currentFinding) {
        currentFinding.recommendation = recMatch[1].trim();
        continue;
      }
    }
    
    if (currentFinding && currentFinding.message) {
      findings.push(currentFinding);
    }
    
    return findings;
  }

  /**
   * Stage: score-findings
   */
  async scoreFindings(context) {
    const { findings } = context.previousResult;
    
    const scored = findings.map(finding => ({
      ...finding,
      confidence: this.calculateConfidence(finding),
      priority: this.calculatePriority(finding),
      impact: this.calculateImpact(finding)
    }));
    
    // Sort by priority and confidence
    scored.sort((a, b) => {
      const priorityDiff = this.priorityWeight(b.priority) - this.priorityWeight(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return b.confidence - a.confidence;
    });
    
    return { scoredFindings: scored };
  }

  /**
   * Calculate confidence score
   */
  calculateConfidence(finding) {
    let confidence = 0.5; // Base confidence
    
    // Higher confidence for specific line numbers
    if (finding.line) confidence += 0.2;
    
    // Higher confidence for recommendations
    if (finding.recommendation) confidence += 0.15;
    
    // Adjust by severity
    if (finding.severity === 'critical' || finding.severity === 'error') {
      confidence += 0.1;
    }
    
    return Math.min(1, confidence);
  }

  /**
   * Calculate priority
   */
  calculatePriority(finding) {
    if (finding.type === FindingTypes.SECURITY) return 'p0';
    if (finding.severity === 'critical') return 'p0';
    if (finding.severity === 'error') return 'p1';
    if (finding.severity === 'warning') return 'p2';
    return 'p3';
  }

  /**
   * Calculate impact score
   */
  calculateImpact(finding) {
    const severityWeights = {
      'critical': 10,
      'error': 7,
      'warning': 4,
      'info': 2
    };
    
    const typeWeights = {
      [FindingTypes.SECURITY]: 10,
      [FindingTypes.BUG]: 8,
      [FindingTypes.PERFORMANCE]: 6,
      [FindingTypes.MAINTAINABILITY]: 5,
      [FindingTypes.BEST_PRACTICE]: 4,
      [FindingTypes.COMPLEXITY]: 3,
      [FindingTypes.STYLE]: 2,
      [FindingTypes.DOCUMENTATION]: 1
    };
    
    const sevWeight = severityWeights[finding.severity] || 3;
    const typeWeight = typeWeights[finding.type] || 5;
    
    return (sevWeight + typeWeight) / 2;
  }

  /**
   * Priority weight for sorting
   */
  priorityWeight(priority) {
    const weights = { 'p0': 4, 'p1': 3, 'p2': 2, 'p3': 1 };
    return weights[priority] || 0;
  }

  /**
   * Stage: publish-review
   */
  async publishReview(context) {
    const { scoredFindings } = context.previousResult;
    const { success, model, provider, tokens } = context.stages['execute-model'];
    
    const review = {
      id: `review-${Date.now()}`,
      timestamp: new Date().toISOString(),
      findings: scoredFindings,
      summary: {
        total: scoredFindings.length,
        bySeverity: this.groupBy(scoredFindings, 'severity'),
        byType: this.groupBy(scoredFindings, 'type'),
        averageConfidence: scoredFindings.reduce((sum, f) => sum + f.confidence, 0) / (scoredFindings.length || 1)
      },
      model: {
        provider,
        model,
        tokens
      },
      success
    };
    
    return review;
  }

  /**
   * Group findings by property
   */
  groupBy(findings, prop) {
    const groups = {};
    
    for (const finding of findings) {
      const key = finding[prop] || 'unknown';
      groups[key] = (groups[key] || 0) + 1;
    }
    
    return groups;
  }
}

module.exports = {
  AICodeReviewPipeline,
  STAGES,
  FindingTypes
};

/**
 * AI Code Review Assistant
 * 
 * Uses LLMs to provide intelligent code review feedback:
 * - Architectural pattern analysis
 * - Design principle violations (SOLID, DRY, etc.)
 * - Best practice recommendations
 * - Code quality suggestions
 * - Security concerns
 * - Performance optimization hints
 * 
 * Supports both local (Ollama) and cloud (OpenAI, Anthropic) models.
 * 
 * @module ai/code-review-assistant
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * AI Code Review Assistant
 */
class AICodeReviewAssistant {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.provider = options.provider || 'ollama'; // 'ollama', 'openai', 'anthropic'
    this.model = options.model || 'codellama:13b';
    this.maxTokens = options.maxTokens || 2000;
    this.temperature = options.temperature || 0.3;

    // Context settings
    this.maxContextLines = options.maxContextLines || 100;
    this.focusAreas = options.focusAreas || [
      'architecture',
      'design-patterns',
      'security',
      'performance',
      'maintainability',
      'best-practices'
    ];

    // API configuration
    this.apiConfig = {
      ollama: {
        host: options.ollamaHost || 'localhost',
        port: options.ollamaPort || 11434,
        endpoint: '/api/generate'
      },
      openai: {
        apiKey: options.openaiApiKey || process.env.OPENAI_API_KEY,
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: options.model || 'gpt-4'
      },
      anthropic: {
        apiKey: options.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
        endpoint: 'https://api.anthropic.com/v1/messages',
        model: options.model || 'claude-3-sonnet-20240229'
      }
    };

    // Statistics
    this.stats = {
      filesReviewed: 0,
      suggestionsGenerated: 0,
      apiCalls: 0,
      errors: 0
    };
  }

  /**
   * Review code file
   */
  async reviewFile(filePath, options = {}) {
    this.stats.filesReviewed++;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      // Truncate if too long
      let codeToReview = content;
      let isTruncated = false;

      if (lines.length > this.maxContextLines) {
        codeToReview = lines.slice(0, this.maxContextLines).join('\n');
        isTruncated = true;
      }

      // Build review prompt
      const prompt = this.buildReviewPrompt(filePath, codeToReview, options);

      // Get AI review
      const review = await this.getAIReview(prompt);

      // Parse review into structured format
      const suggestions = this.parseReview(review, filePath);

      this.stats.suggestionsGenerated += suggestions.length;

      return {
        filePath,
        review,
        suggestions,
        isTruncated,
        provider: this.provider,
        model: this.model
      };

    } catch (error) {
      this.stats.errors++;
      this.log(`Error reviewing ${filePath}: ${error.message}`);
      return {
        filePath,
        error: error.message,
        suggestions: []
      };
    }
  }

  /**
   * Build review prompt
   */
  buildReviewPrompt(filePath, code, options = {}) {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath);
    const language = this.detectLanguage(ext);

    const focusAreas = options.focusAreas || this.focusAreas;

    let prompt = `You are an expert code reviewer. Analyze the following ${language} code from "${fileName}" and provide constructive feedback.\n\n`;

    prompt += `Focus areas:\n`;
    focusAreas.forEach(area => {
      prompt += `- ${area.replace(/-/g, ' ')}\n`;
    });

    prompt += `\nCode to review:\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;

    prompt += `Please provide:\n`;
    prompt += `1. Overall quality assessment\n`;
    prompt += `2. Specific issues or concerns (if any)\n`;
    prompt += `3. Recommendations for improvement\n`;
    prompt += `4. Positive aspects (what is done well)\n\n`;

    prompt += `Format your response as:\n`;
    prompt += `ASSESSMENT: [Brief overall assessment]\n`;
    prompt += `ISSUES:\n`;
    prompt += `- [Issue 1]\n`;
    prompt += `- [Issue 2]\n`;
    prompt += `RECOMMENDATIONS:\n`;
    prompt += `- [Recommendation 1]\n`;
    prompt += `- [Recommendation 2]\n`;
    prompt += `POSITIVE:\n`;
    prompt += `- [Positive aspect 1]\n\n`;

    if (options.specificConcerns) {
      prompt += `\nSpecific concerns to address:\n${options.specificConcerns}\n`;
    }

    return prompt;
  }

  /**
   * Get AI review
   */
  async getAIReview(prompt) {
    this.stats.apiCalls++;

    switch (this.provider) {
      case 'ollama':
        return await this.getOllamaReview(prompt);
      case 'openai':
        return await this.getOpenAIReview(prompt);
      case 'anthropic':
        return await this.getAnthropicReview(prompt);
      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }

  /**
   * Get review from Ollama
   */
  async getOllamaReview(prompt) {
    return new Promise((resolve, reject) => {
      const config = this.apiConfig.ollama;

      const postData = JSON.stringify({
        model: this.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens
        }
      });

      const options = {
        hostname: config.host,
        port: config.port,
        path: config.endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            resolve(response.response || response.text || '');
          } catch (error) {
            reject(new Error(`Failed to parse Ollama response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Ollama request failed: ${error.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Get review from OpenAI
   */
  async getOpenAIReview(prompt) {
    const config = this.apiConfig.openai;

    if (!config.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert code reviewer providing constructive feedback.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature
      });

      const url = new URL(config.endpoint);
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.error) {
              reject(new Error(response.error.message || 'OpenAI API error'));
              return;
            }
            resolve(response.choices[0].message.content);
          } catch (error) {
            reject(new Error(`Failed to parse OpenAI response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`OpenAI request failed: ${error.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Get review from Anthropic
   */
  async getAnthropicReview(prompt) {
    const config = this.apiConfig.anthropic;

    if (!config.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: config.model,
        max_tokens: this.maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: this.temperature
      });

      const url = new URL(config.endpoint);
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.error) {
              reject(new Error(response.error.message || 'Anthropic API error'));
              return;
            }
            resolve(response.content[0].text);
          } catch (error) {
            reject(new Error(`Failed to parse Anthropic response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Anthropic request failed: ${error.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Parse review into structured suggestions
   */
  parseReview(review, filePath) {
    const suggestions = [];

    try {
      // Extract sections
      const sections = {
        assessment: this.extractSection(review, 'ASSESSMENT'),
        issues: this.extractList(review, 'ISSUES'),
        recommendations: this.extractList(review, 'RECOMMENDATIONS'),
        positive: this.extractList(review, 'POSITIVE')
      };

      // Convert issues to suggestions
      sections.issues.forEach((issue, index) => {
        suggestions.push({
          type: 'ai-review-issue',
          category: 'issue',
          severity: this.inferSeverity(issue),
          description: issue,
          filePath,
          source: 'ai-review'
        });
      });

      // Convert recommendations to suggestions
      sections.recommendations.forEach((recommendation, index) => {
        suggestions.push({
          type: 'ai-review-recommendation',
          category: 'improvement',
          severity: 'INFO',
          description: recommendation,
          filePath,
          source: 'ai-review'
        });
      });

      // Add overall assessment
      if (sections.assessment) {
        suggestions.unshift({
          type: 'ai-review-assessment',
          category: 'assessment',
          severity: 'INFO',
          description: sections.assessment,
          filePath,
          source: 'ai-review'
        });
      }

    } catch (error) {
      this.log(`Error parsing review: ${error.message}`);
    }

    return suggestions;
  }

  /**
   * Extract section from review
   */
  extractSection(text, sectionName) {
    const regex = new RegExp(`${sectionName}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 's');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
  }

  /**
   * Extract list items from section
   */
  extractList(text, sectionName) {
    const items = [];
    const section = this.extractSection(text, sectionName);

    if (!section) return items;

    const lines = section.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
        items.push(trimmed.substring(1).trim());
      } else if (trimmed && items.length > 0) {
        // Continuation of previous item
        items[items.length - 1] += ' ' + trimmed;
      }
    }

    return items;
  }

  /**
   * Infer severity from issue text
   */
  inferSeverity(issueText) {
    const text = issueText.toLowerCase();

    if (text.includes('critical') || text.includes('security') || text.includes('vulnerability')) {
      return 'CRITICAL';
    }
    if (text.includes('major') || text.includes('serious') || text.includes('significant')) {
      return 'HIGH';
    }
    if (text.includes('minor') || text.includes('consider') || text.includes('could')) {
      return 'LOW';
    }

    return 'MEDIUM';
  }

  /**
   * Detect language from extension
   */
  detectLanguage(ext) {
    const languages = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.php': 'php',
      '.rb': 'ruby',
      '.cs': 'csharp',
      '.cpp': 'cpp',
      '.c': 'c',
      '.h': 'c'
    };

    return languages[ext] || 'javascript';
  }

  /**
   * Review multiple files
   */
  async reviewFiles(filePaths, options = {}) {
    const results = [];

    for (const filePath of filePaths) {
      const result = await this.reviewFile(filePath, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Review code diff (for pull requests)
   */
  async reviewDiff(diff, options = {}) {
    const prompt = this.buildDiffReviewPrompt(diff, options);
    const review = await this.getAIReview(prompt);
    const suggestions = this.parseReview(review, 'diff');

    return {
      diff,
      review,
      suggestions,
      provider: this.provider,
      model: this.model
    };
  }

  /**
   * Build diff review prompt
   */
  buildDiffReviewPrompt(diff, options = {}) {
    let prompt = `You are an expert code reviewer. Review the following code changes and provide feedback.\n\n`;
    prompt += `Diff:\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;
    prompt += `Focus on:\n`;
    prompt += `- Correctness of the changes\n`;
    prompt += `- Potential bugs or issues\n`;
    prompt += `- Code quality and maintainability\n`;
    prompt += `- Best practices\n`;
    prompt += `- Security concerns\n\n`;
    prompt += `Provide specific, actionable feedback.`;

    return prompt;
  }

  /**
   * Generate report
   */
  generateReport(results) {
    const report = {
      summary: {
        ...this.stats,
        timestamp: new Date().toISOString(),
        provider: this.provider,
        model: this.model
      },
      reviews: []
    };

    const allSuggestions = [];
    const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [], INFO: [] };

    results.forEach(result => {
      if (result.error) {
        report.reviews.push({
          filePath: result.filePath,
          error: result.error
        });
        return;
      }

      report.reviews.push({
        filePath: result.filePath,
        suggestionCount: result.suggestions.length,
        isTruncated: result.isTruncated
      });

      result.suggestions.forEach(suggestion => {
        allSuggestions.push(suggestion);
        if (bySeverity[suggestion.severity]) {
          bySeverity[suggestion.severity].push(suggestion);
        }
      });
    });

    report.suggestions = allSuggestions;
    report.bySeverity = bySeverity;

    return report;
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }

  log(message) {
    if (this.verbose) {
      console.log(`[AICodeReviewAssistant] ${message}`);
    }
  }
}

module.exports = {
  AICodeReviewAssistant
};

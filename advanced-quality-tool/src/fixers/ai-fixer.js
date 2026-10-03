/**
 * AI-Powered Auto-Fix Engine
 * 
 * Uses AI models (local and cloud) to generate fixes for complex code quality issues
 * that cannot be fixed by rule-based approaches.
 * 
 * Three-tier fallback strategy:
 * 1. Local AI (Ollama, LM Studio) - Privacy-first, offline
 * 2. Cloud AI (OpenAI, Anthropic) - Higher quality, requires API key
 * 3. Manual fix - User intervention required
 * 
 * @module fixers/ai-fixer
 */

const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const execAsync = promisify(exec);

/**
 * Base class for all AI-powered fixers
 */
class AIFixer {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
    this.maxTokens = options.maxTokens || 2048;
    this.temperature = options.temperature || 0.2; // Low temp for deterministic fixes
    this.timeout = options.timeout || 30000; // 30 seconds
    this.cacheDir = options.cacheDir || '.aqt-cache';
    this.enableCache = options.enableCache !== false;
  }

  /**
   * Generate cache key for a fix request
   */
  getCacheKey(code, issue) {
    const content = JSON.stringify({ code, issue: issue.ruleId, message: issue.message });
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get cached fix
   */
  getCachedFix(cacheKey) {
    if (!this.enableCache) return null;

    const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

    try {
      if (fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        const age = Date.now() - cached.timestamp;

        // Cache valid for 7 days
        if (age < 7 * 24 * 60 * 60 * 1000) {
          this.log(`Cache hit: ${cacheKey}`);
          return cached.fix;
        }
      }
    } catch (error) {
      this.log(`Cache read error: ${error.message}`);
    }

    return null;
  }

  /**
   * Save fix to cache
   */
  saveCachedFix(cacheKey, fix) {
    if (!this.enableCache) return;

    const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      const cached = {
        timestamp: Date.now(),
        fix: fix
      };

      fs.writeFileSync(cachePath, JSON.stringify(cached, null, 2), 'utf8');
      this.log(`Cached fix: ${cacheKey}`);
    } catch (error) {
      this.log(`Cache write error: ${error.message}`);
    }
  }

  /**
   * Check if AI service is available
   */
  async isAvailable() {
    throw new Error('isAvailable() must be implemented by subclass');
  }

  /**
   * Generate fix using AI
   */
  async generateFix(code, issue, context = {}) {
    throw new Error('generateFix() must be implemented by subclass');
  }

  /**
   * Validate generated fix
   */
  async validateFix(originalCode, fixedCode, issue) {
    const validation = {
      valid: true,
      errors: [],
      warnings: [],
      confidence: 1.0
    };

    try {
      // 1. Check if code is not empty
      if (!fixedCode || fixedCode.trim().length === 0) {
        validation.valid = false;
        validation.errors.push('Generated fix is empty');
        return validation;
      }

      // 2. Check if code changed
      if (originalCode === fixedCode) {
        validation.warnings.push('No changes made to code');
        validation.confidence = 0.5;
      }

      // 3. Basic syntax check (for JS/TS)
      if (issue.filePath && (issue.filePath.endsWith('.js') || issue.filePath.endsWith('.ts'))) {
        try {
          // Try to parse with Function constructor (basic check)
          new Function(fixedCode);
        } catch (syntaxError) {
          validation.valid = false;
          validation.errors.push(`Syntax error in generated fix: ${syntaxError.message}`);
          return validation;
        }
      }

      // 4. Check for suspicious patterns
      const suspiciousPatterns = [
        /eval\(/,
        /Function\(/,
        /setTimeout\(.*\$/,
        /\$\{.*exec.*\}/,
      ];

      for (const pattern of suspiciousPatterns) {
        if (pattern.test(fixedCode) && !pattern.test(originalCode)) {
          validation.warnings.push(`Suspicious pattern introduced: ${pattern}`);
          validation.confidence *= 0.7;
        }
      }

      // 5. Check code length (shouldn't grow dramatically)
      const lengthRatio = fixedCode.length / originalCode.length;
      if (lengthRatio > 3 || lengthRatio < 0.3) {
        validation.warnings.push(`Significant length change: ${Math.round(lengthRatio * 100)}%`);
        validation.confidence *= 0.8;
      }

    } catch (error) {
      validation.valid = false;
      validation.errors.push(`Validation error: ${error.message}`);
    }

    return validation;
  }

  log(message) {
    if (this.verbose) {
      console.log(`[AIFixer] ${message}`);
    }
  }
}

/**
 * Ollama-based local AI fixer
 * Uses locally-running Ollama with CodeLlama or DeepSeek Coder models
 */
class OllamaAIFixer extends AIFixer {
  constructor(options = {}) {
    super(options);
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.model = options.model || 'codellama:7b';
    this.systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
  }

  getDefaultSystemPrompt() {
    return `You are an expert code quality fixer. Your task is to fix code quality issues while preserving functionality.

Rules:
1. Only fix the specific issue mentioned
2. Preserve all existing logic and behavior
3. Keep code style consistent
4. Don't add comments unless necessary
5. Return ONLY the fixed code, no explanations
6. If you cannot fix it safely, return the original code unchanged`;
  }

  /**
   * Check if Ollama is running
   */
  async isAvailable() {
    try {
      const response = await this.makeRequest('/api/tags', 'GET');
      return response && response.models && response.models.length > 0;
    } catch (error) {
      this.log(`Ollama not available: ${error.message}`);
      return false;
    }
  }

  /**
   * Make HTTP request to Ollama API
   */
  async makeRequest(endpoint, method = 'POST', data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);
      const options = {
        method: method,
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      };

      const req = http.request(url, options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk.toString();
        });

        res.on('end', () => {
          try {
            // Ollama streaming response: multiple JSON objects separated by newlines
            if (endpoint === '/api/generate' || endpoint === '/api/chat') {
              const lines = body.trim().split('\n');
              const lastLine = lines[lines.length - 1];
              const response = JSON.parse(lastLine);
              resolve(response);
            } else {
              const response = JSON.parse(body);
              resolve(response);
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  /**
   * Generate fix using Ollama
   */
  async generateFix(code, issue, context = {}) {
    const result = {
      originalCode: code,
      fixedCode: null,
      confidence: 0,
      model: this.model,
      cached: false,
      errors: [],
      validationResult: null
    };

    try {
      // Check cache first
      const cacheKey = this.getCacheKey(code, issue);
      const cachedFix = this.getCachedFix(cacheKey);

      if (cachedFix) {
        result.fixedCode = cachedFix.code;
        result.confidence = cachedFix.confidence;
        result.cached = true;
        return result;
      }

      // Build prompt
      const prompt = this.buildPrompt(code, issue, context);

      this.log(`Generating fix for: ${issue.ruleId || issue.message}`);

      // Call Ollama API
      const response = await this.makeRequest('/api/generate', 'POST', {
        model: this.model,
        prompt: prompt,
        system: this.systemPrompt,
        stream: false,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens
        }
      });

      // Extract fixed code from response
      const generatedText = response.response || '';
      const fixedCode = this.extractCode(generatedText);

      // Validate fix
      const validation = await this.validateFix(code, fixedCode, issue);
      result.validationResult = validation;

      if (validation.valid) {
        result.fixedCode = fixedCode;
        result.confidence = validation.confidence;

        // Cache successful fix
        this.saveCachedFix(cacheKey, {
          code: fixedCode,
          confidence: validation.confidence
        });

        this.log(`Fix generated successfully (confidence: ${Math.round(validation.confidence * 100)}%)`);
      } else {
        result.errors.push(...validation.errors);
        this.log(`Fix validation failed: ${validation.errors.join(', ')}`);
      }

    } catch (error) {
      result.errors.push(error.message);
      this.log(`Error generating fix: ${error.message}`);
    }

    return result;
  }

  /**
   * Build prompt for code fixing
   */
  buildPrompt(code, issue, context) {
    let prompt = `Fix this code quality issue:\n\n`;

    prompt += `Issue: ${issue.message}\n`;
    if (issue.ruleId) {
      prompt += `Rule: ${issue.ruleId}\n`;
    }
    if (issue.severity) {
      prompt += `Severity: ${issue.severity}\n`;
    }

    prompt += `\nOriginal Code:\n\`\`\`\n${code}\n\`\`\`\n\n`;

    if (context.filePath) {
      prompt += `File: ${context.filePath}\n`;
    }

    if (context.lineNumber) {
      prompt += `Line: ${context.lineNumber}\n`;
    }

    prompt += `\nFixed Code (return only the fixed code without explanations):\n`;

    return prompt;
  }

  /**
   * Extract code from AI response
   */
  extractCode(text) {
    // Try to extract code from markdown code blocks
    const codeBlockMatch = text.match(/```(?:javascript|typescript|js|ts)?\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Try to extract code after "Fixed Code:" or similar markers
    const markerMatch = text.match(/(?:Fixed Code:|Solution:|Result:)\s*([\s\S]*?)(?:\n\n|$)/i);
    if (markerMatch) {
      return markerMatch[1].trim();
    }

    // Return trimmed text as fallback
    return text.trim();
  }
}

/**
 * Cloud AI fixer using OpenAI or Anthropic APIs
 */
class CloudAIFixer extends AIFixer {
  constructor(options = {}) {
    super(options);
    this.provider = options.provider || 'openai'; // 'openai' or 'anthropic'
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    this.model = options.model || this.getDefaultModel();
    this.systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();

    if (!this.apiKey) {
      throw new Error(`API key required for ${this.provider}. Set via options or environment variable.`);
    }
  }

  getDefaultModel() {
    return this.provider === 'openai' ? 'gpt-4' : 'claude-3-sonnet-20240229';
  }

  getDefaultSystemPrompt() {
    return `You are an expert code quality assistant. Fix code issues while preserving functionality.

Guidelines:
- Only modify code to fix the specific issue
- Maintain existing code style and formatting
- Preserve all logic and behavior
- Return ONLY the fixed code without explanations
- If unsure, return original code unchanged`;
  }

  /**
   * Check if cloud AI is available
   */
  async isAvailable() {
    return !!this.apiKey;
  }

  /**
   * Generate fix using cloud AI
   */
  async generateFix(code, issue, context = {}) {
    const result = {
      originalCode: code,
      fixedCode: null,
      confidence: 0,
      model: this.model,
      provider: this.provider,
      cached: false,
      errors: [],
      validationResult: null
    };

    try {
      // Check cache
      const cacheKey = this.getCacheKey(code, issue);
      const cachedFix = this.getCachedFix(cacheKey);

      if (cachedFix) {
        result.fixedCode = cachedFix.code;
        result.confidence = cachedFix.confidence;
        result.cached = true;
        return result;
      }

      // Generate fix based on provider
      let generatedText;
      if (this.provider === 'openai') {
        generatedText = await this.generateWithOpenAI(code, issue, context);
      } else if (this.provider === 'anthropic') {
        generatedText = await this.generateWithAnthropic(code, issue, context);
      } else {
        throw new Error(`Unsupported provider: ${this.provider}`);
      }

      // Extract and validate
      const fixedCode = this.extractCode(generatedText);
      const validation = await this.validateFix(code, fixedCode, issue);
      result.validationResult = validation;

      if (validation.valid) {
        result.fixedCode = fixedCode;
        result.confidence = validation.confidence * 0.95; // Slightly higher confidence for cloud AI

        this.saveCachedFix(cacheKey, {
          code: fixedCode,
          confidence: result.confidence
        });

        this.log(`Cloud AI fix generated (confidence: ${Math.round(result.confidence * 100)}%)`);
      } else {
        result.errors.push(...validation.errors);
      }

    } catch (error) {
      result.errors.push(error.message);
      this.log(`Cloud AI error: ${error.message}`);
    }

    return result;
  }

  /**
   * Generate fix using OpenAI
   */
  async generateWithOpenAI(code, issue, context) {
    const prompt = this.buildPrompt(code, issue, context);

    const response = await this.makeHTTPSRequest('https://api.openai.com/v1/chat/completions', {
      model: this.model,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens
    }, {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    });

    return response.choices[0].message.content;
  }

  /**
   * Generate fix using Anthropic Claude
   */
  async generateWithAnthropic(code, issue, context) {
    const prompt = this.buildPrompt(code, issue, context);

    const response = await this.makeHTTPSRequest('https://api.anthropic.com/v1/messages', {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: this.systemPrompt,
      messages: [
        { role: 'user', content: prompt }
      ]
    }, {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    });

    return response.content[0].text;
  }

  /**
   * Make HTTPS request
   */
  async makeHTTPSRequest(url, data, headers) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'POST',
        headers: headers,
        timeout: this.timeout
      };

      const req = https.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk.toString();
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(body);

            if (res.statusCode >= 400) {
              reject(new Error(response.error?.message || `HTTP ${res.statusCode}`));
            } else {
              resolve(response);
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(JSON.stringify(data));
      req.end();
    });
  }

  buildPrompt(code, issue, context) {
    let prompt = `Fix this code quality issue:\n\n`;

    prompt += `Issue: ${issue.message}\n`;
    if (issue.ruleId) prompt += `Rule: ${issue.ruleId}\n`;
    if (issue.severity) prompt += `Severity: ${issue.severity}\n`;

    prompt += `\nCode:\n\`\`\`\n${code}\n\`\`\`\n\n`;

    if (context.filePath) prompt += `File: ${context.filePath}\n`;
    if (context.lineNumber) prompt += `Line: ${context.lineNumber}\n`;

    prompt += `\nReturn only the fixed code.`;

    return prompt;
  }

  extractCode(text) {
    const codeBlockMatch = text.match(/```(?:javascript|typescript|js|ts)?\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    return text.trim();
  }
}

/**
 * AI Fix Coordinator
 * Manages multiple AI fixers with fallback logic
 */
class AIFixCoordinator {
  constructor(options = {}) {
    this.options = options;
    this.localFixer = null;
    this.cloudFixer = null;
    this.strategy = options.strategy || 'local-first'; // 'local-first', 'cloud-first', 'local-only', 'cloud-only'

    // Initialize local fixer if enabled
    if (options.localAI?.enabled !== false) {
      try {
        this.localFixer = new OllamaAIFixer({
          ...options,
          ...options.localAI
        });
      } catch (error) {
        console.warn(`Local AI not available: ${error.message}`);
      }
    }

    // Initialize cloud fixer if enabled
    if (options.cloudAI?.enabled === true && options.cloudAI?.apiKey) {
      try {
        this.cloudFixer = new CloudAIFixer({
          ...options,
          ...options.cloudAI
        });
      } catch (error) {
        console.warn(`Cloud AI not available: ${error.message}`);
      }
    }
  }

  /**
   * Get available fixers based on strategy
   */
  async getAvailableFixers() {
    const fixers = [];

    if (this.strategy === 'cloud-only' && this.cloudFixer) {
      const available = await this.cloudFixer.isAvailable();
      if (available) fixers.push({ type: 'cloud', fixer: this.cloudFixer });
    } else if (this.strategy === 'local-only' && this.localFixer) {
      const available = await this.localFixer.isAvailable();
      if (available) fixers.push({ type: 'local', fixer: this.localFixer });
    } else {
      // local-first or cloud-first
      const local = this.localFixer ? await this.localFixer.isAvailable() : false;
      const cloud = this.cloudFixer ? await this.cloudFixer.isAvailable() : false;

      if (this.strategy === 'cloud-first') {
        if (cloud && this.cloudFixer) fixers.push({ type: 'cloud', fixer: this.cloudFixer });
        if (local && this.localFixer) fixers.push({ type: 'local', fixer: this.localFixer });
      } else {
        // local-first (default)
        if (local && this.localFixer) fixers.push({ type: 'local', fixer: this.localFixer });
        if (cloud && this.cloudFixer) fixers.push({ type: 'cloud', fixer: this.cloudFixer });
      }
    }

    return fixers;
  }

  /**
   * Generate fix with fallback
   */
  async generateFix(code, issue, context = {}) {
    const fixers = await this.getAvailableFixers();

    if (fixers.length === 0) {
      return {
        originalCode: code,
        fixedCode: null,
        confidence: 0,
        errors: ['No AI fixers available'],
        attempts: []
      };
    }

    const attempts = [];

    for (const { type, fixer } of fixers) {
      try {
        const result = await fixer.generateFix(code, issue, context);
        attempts.push({ type, ...result });

        // If fix is valid and high confidence, return it
        if (result.fixedCode && result.confidence > 0.7) {
          return {
            originalCode: code,
            fixedCode: result.fixedCode,
            confidence: result.confidence,
            usedFixer: type,
            model: result.model,
            cached: result.cached,
            attempts: attempts
          };
        }
      } catch (error) {
        attempts.push({
          type,
          error: error.message
        });
      }
    }

    // No successful fix
    return {
      originalCode: code,
      fixedCode: null,
      confidence: 0,
      errors: ['All AI fixers failed or returned low confidence fixes'],
      attempts: attempts
    };
  }
}

module.exports = {
  AIFixer,
  OllamaAIFixer,
  CloudAIFixer,
  AIFixCoordinator
};

/**
 * Provider Privacy, Usage, and Cost Controls
 * Task: P9-T018
 * 
 * Shows active provider/model and whether requests are local or remote.
 * Enforces configurable per-run and daily token, request, and cost budgets.
 * Displays usage, cost, budget remaining, and rate-limit state.
 */

const EventEmitter = require('events');

/**
 * Budget enforcement modes
 */
const BudgetEnforcement = {
  WARN: 'warn',        // Warn but allow
  BLOCK: 'block',      // Block when exceeded
  SOFT_LIMIT: 'soft'   // Warn at soft limit, block at hard limit
};

/**
 * Privacy levels
 */
const PrivacyLevels = {
  LOCAL_ONLY: 'local-only',
  ALLOW_CLOUD: 'allow-cloud',
  CLOUD_PREFERRED: 'cloud-preferred'
};

/**
 * Represents a usage record
 */
class UsageRecord {
  constructor(options = {}) {
    this.timestamp = Date.now();
    this.provider = options.provider;
    this.model = options.model;
    this.isLocal = options.isLocal || false;
    this.inputTokens = options.inputTokens || 0;
    this.outputTokens = options.outputTokens || 0;
    this.totalTokens = this.inputTokens + this.outputTokens;
    this.cost = options.cost || 0;
    this.requestType = options.requestType || 'completion';
    this.sessionId = options.sessionId || null;
    this.success = options.success !== false;
  }

  toJSON() {
    return {
      timestamp: this.timestamp,
      provider: this.provider,
      model: this.model,
      isLocal: this.isLocal,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
      cost: this.cost,
      requestType: this.requestType,
      sessionId: this.sessionId,
      success: this.success
    };
  }
}

/**
 * Manages cost calculations for different providers
 */
class CostCalculator {
  constructor() {
    // Cost per 1K tokens (input, output)
    this.pricing = {
      'openai:gpt-4o': { input: 0.005, output: 0.015 },
      'openai:gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'openai:gpt-4-turbo': { input: 0.01, output: 0.03 },
      'openai:gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'anthropic:claude-3-opus': { input: 0.015, output: 0.075 },
      'anthropic:claude-3-sonnet': { input: 0.003, output: 0.015 },
      'anthropic:claude-3-haiku': { input: 0.00025, output: 0.00125 },
      'deepseek:deepseek-v4-flash': { input: 0.00007, output: 0.00028 },
      'deepseek:deepseek-r1': { input: 0.00055, output: 0.00219 },
      'glm:glm-4': { input: 0.00014, output: 0.00014 },
      'glm:glm-4-plus': { input: 0.00056, output: 0.00056 },
      'glm:glm-5': { input: 0.0003, output: 0.0003 },
      'ollama:*': { input: 0, output: 0 }  // Local is free
    };
    
    this.defaultPrice = { input: 0.001, output: 0.002 };
  }

  calculateCost(provider, model, inputTokens, outputTokens) {
    const key = `${provider}:${model}`;
    const price = this.pricing[key] || 
                  this.pricing[`${provider}:*`] ||
                  this.defaultPrice;
    
    const inputCost = (inputTokens / 1000) * price.input;
    const outputCost = (outputTokens / 1000) * price.output;
    
    return inputCost + outputCost;
  }

  setPricing(provider, model, inputPrice, outputPrice) {
    const key = `${provider}:${model}`;
    this.pricing[key] = { input: inputPrice, output: outputPrice };
  }
}

/**
 * Manages budgets and usage tracking
 */
class BudgetManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.calculator = new CostCalculator();
    
    // Budget limits
    this.perRunLimit = options.perRunLimit || null;
    this.dailyLimit = options.dailyLimit || null;
    this.softLimitRatio = options.softLimitRatio || 0.8;
    this.enforcementMode = options.enforcementMode || BudgetEnforcement.WARN;
    
    // Usage tracking
    this.usageRecords = [];
    this.currentRunUsage = {
      requests: 0,
      tokens: 0,
      cost: 0
    };
    
    // Rate limiting
    this.rateLimits = {
      requestsPerMinute: options.requestsPerMinute || 60,
      tokensPerMinute: options.tokensPerMinute || 90000
    };
    this.requestTimestamps = [];
  }

  /**
   * Check if a request would exceed budget
   */
  checkBudget(provider, model, estimatedTokens) {
    const estimatedCost = this.calculator.calculateCost(
      provider, model, estimatedTokens, estimatedTokens
    );
    
    const dailyUsage = this.getDailyUsage();
    const runUsage = this.currentRunUsage;
    
    const result = {
      allowed: true,
      reason: null,
      dailyRemaining: null,
      runRemaining: null,
      softLimitReached: false
    };
    
    // Check daily limit
    if (this.dailyLimit) {
      result.dailyRemaining = Math.max(0, this.dailyLimit - dailyUsage.cost - estimatedCost);
      
      if (dailyUsage.cost + estimatedCost > this.dailyLimit) {
        result.allowed = false;
        result.reason = `Would exceed daily budget ($${this.dailyLimit.toFixed(2)})`;
      } else if (dailyUsage.cost + estimatedCost > this.dailyLimit * this.softLimitRatio) {
        result.softLimitReached = true;
      }
    }
    
    // Check per-run limit
    if (this.perRunLimit && result.allowed) {
      result.runRemaining = Math.max(0, this.perRunLimit - runUsage.cost - estimatedCost);
      
      if (runUsage.cost + estimatedCost > this.perRunLimit) {
        result.allowed = false;
        result.reason = `Would exceed per-run budget ($${this.perRunLimit.toFixed(2)})`;
      }
    }
    
    // Apply enforcement mode
    if (!result.allowed && this.enforcementMode === BudgetEnforcement.WARN) {
      this.emit('budget-warning', result);
      result.allowed = true; // Allow with warning
    } else if (result.softLimitReached) {
      this.emit('soft-limit-reached', result);
    }
    
    return result;
  }

  /**
   * Check rate limits
   */
  checkRateLimit() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Clean old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    
    // Check requests per minute
    if (this.requestTimestamps.length >= this.rateLimits.requestsPerMinute) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded: too many requests per minute',
        retryAfter: this.requestTimestamps[0] - oneMinuteAgo
      };
    }
    
    return { allowed: true };
  }

  /**
   * Record a usage event
   */
  recordUsage(usage) {
    const record = new UsageRecord(usage);
    
    this.usageRecords.push(record);
    this.requestTimestamps.push(record.timestamp);
    
    // Update current run usage
    this.currentRunUsage.requests++;
    this.currentRunUsage.tokens += record.totalTokens;
    this.currentRunUsage.cost += record.cost;
    
    this.emit('usage-recorded', record);
    
    return record;
  }

  /**
   * Get usage for current day
   */
  getDailyUsage() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayStart = today.getTime();
    
    const todayRecords = this.usageRecords.filter(r => r.timestamp >= dayStart);
    
    return {
      requests: todayRecords.length,
      tokens: todayRecords.reduce((sum, r) => sum + r.totalTokens, 0),
      cost: todayRecords.reduce((sum, r) => sum + r.cost, 0)
    };
  }

  /**
   * Get current run usage
   */
  getRunUsage() {
    return { ...this.currentRunUsage };
  }

  /**
   * Reset run usage (start new run)
   */
  resetRunUsage() {
    this.currentRunUsage = {
      requests: 0,
      tokens: 0,
      cost: 0
    };
    this.emit('run-reset');
  }

  /**
   * Get usage summary
   */
  getUsageSummary() {
    const daily = this.getDailyUsage();
    const run = this.getRunUsage();
    
    return {
      daily: {
        ...daily,
        limit: this.dailyLimit,
        remaining: this.dailyLimit ? Math.max(0, this.dailyLimit - daily.cost) : null,
        percentUsed: this.dailyLimit ? (daily.cost / this.dailyLimit) * 100 : 0
      },
      run: {
        ...run,
        limit: this.perRunLimit,
        remaining: this.perRunLimit ? Math.max(0, this.perRunLimit - run.cost) : null,
        percentUsed: this.perRunLimit ? (run.cost / this.perRunLimit) * 100 : 0
      }
    };
  }
}

/**
 * Privacy and local-only enforcement
 */
class PrivacyManager {
  constructor(options = {}) {
    this.privacyLevel = options.privacyLevel || PrivacyLevels.ALLOW_CLOUD;
    this.allowedProviders = options.allowedProviders || null; // null = all allowed
    this.blockedProviders = options.blockedProviders || [];
    this.requireConsentForCloud = options.requireConsentForCloud !== false;
  }

  /**
   * Check if provider is allowed
   */
  isProviderAllowed(provider, isLocal) {
    // Check blocked list
    if (this.blockedProviders.includes(provider)) {
      return { allowed: false, reason: 'Provider is blocked' };
    }
    
    // Check allowed list
    if (this.allowedProviders && !this.allowedProviders.includes(provider)) {
      return { allowed: false, reason: 'Provider not in allowed list' };
    }
    
    // Check privacy level
    if (this.privacyLevel === PrivacyLevels.LOCAL_ONLY && !isLocal) {
      return { 
        allowed: false, 
        reason: 'Cloud providers not allowed in local-only mode',
        requiresLocalFallback: true
      };
    }
    
    return { allowed: true };
  }

  /**
   * Check if consent is required for sending to cloud
   */
  requiresConsent(provider, isLocal, contextData) {
    if (isLocal) {
      return { required: false };
    }
    
    if (this.privacyLevel === PrivacyLevels.LOCAL_ONLY) {
      return { 
        required: true, 
        reason: 'Cloud processing disabled by privacy policy' 
      };
    }
    
    if (this.requireConsentForCloud) {
      // Check if context contains sensitive data
      const hasSensitiveData = this.detectSensitiveData(contextData);
      
      if (hasSensitiveData) {
        return {
          required: true,
          reason: 'Context contains potentially sensitive data',
          sensitiveTypes: hasSensitiveData
        };
      }
      
      return {
        required: true,
        reason: 'Sending data to cloud provider requires consent'
      };
    }
    
    return { required: false };
  }

  /**
   * Detect potentially sensitive data in context
   */
  detectSensitiveData(contextData) {
    if (!contextData) return null;
    
    const sensitivePatterns = [
      { type: 'api-key', pattern: /(?:api[_-]?key|apikey)['":\s]*['"]?[a-zA-Z0-9_-]{20,}/gi },
      { type: 'password', pattern: /(?:password|passwd|pwd)['":\s]*['"]?[^\s'"]{8,}/gi },
      { type: 'secret', pattern: /(?:secret|token)['":\s]*['"]?[a-zA-Z0-9_-]{20,}/gi },
      { type: 'aws-key', pattern: /AKIA[0-9A-Z]{16}/g },
      { type: 'private-key', pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/g }
    ];
    
    const contextStr = typeof contextData === 'string' ? 
      contextData : JSON.stringify(contextData);
    
    const detected = [];
    
    for (const { type, pattern } of sensitivePatterns) {
      if (pattern.test(contextStr)) {
        detected.push(type);
      }
    }
    
    return detected.length > 0 ? detected : null;
  }

  /**
   * Get privacy status
   */
  getPrivacyStatus(provider, model, isLocal) {
    return {
      provider,
      model,
      isLocal,
      privacyLevel: this.privacyLevel,
      sendsToRemote: !isLocal,
      allowed: this.isProviderAllowed(provider, isLocal).allowed
    };
  }
}

/**
 * Main Privacy and Cost Control Manager
 */
class PrivacyCostManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.budgetManager = new BudgetManager({
      perRunLimit: options.perRunLimit,
      dailyLimit: options.dailyLimit,
      enforcementMode: options.enforcementMode,
      requestsPerMinute: options.requestsPerMinute,
      tokensPerMinute: options.tokensPerMinute
    });
    
    this.privacyManager = new PrivacyManager({
      privacyLevel: options.privacyLevel,
      allowedProviders: options.allowedProviders,
      blockedProviders: options.blockedProviders,
      requireConsentForCloud: options.requireConsentForCloud
    });
    
    // Forward events
    this.budgetManager.on('budget-warning', (data) => this.emit('budget-warning', data));
    this.budgetManager.on('soft-limit-reached', (data) => this.emit('soft-limit-reached', data));
  }

  /**
   * Check if request can proceed
   */
  checkRequest(provider, model, isLocal, estimatedTokens, contextData = null) {
    const result = {
      allowed: true,
      reasons: [],
      budget: null,
      privacy: null,
      rateLimit: null
    };
    
    // Check privacy
    const privacyCheck = this.privacyManager.isProviderAllowed(provider, isLocal);
    if (!privacyCheck.allowed) {
      result.allowed = false;
      result.reasons.push(privacyCheck.reason);
      result.privacy = privacyCheck;
    }
    
    // Check if consent required
    const consentCheck = this.privacyManager.requiresConsent(provider, isLocal, contextData);
    if (consentCheck.required) {
      result.consentRequired = true;
      result.consentReason = consentCheck.reason;
    }
    
    // Check budget (if not local, since local is free)
    if (!isLocal) {
      const budgetCheck = this.budgetManager.checkBudget(provider, model, estimatedTokens);
      if (!budgetCheck.allowed) {
        result.allowed = false;
        result.reasons.push(budgetCheck.reason);
      }
      result.budget = budgetCheck;
    }
    
    // Check rate limits
    const rateLimitCheck = this.budgetManager.checkRateLimit();
    if (!rateLimitCheck.allowed) {
      result.allowed = false;
      result.reasons.push(rateLimitCheck.reason);
      result.rateLimit = rateLimitCheck;
    }
    
    return result;
  }

  /**
   * Record usage after request completes
   */
  recordUsage(provider, model, isLocal, inputTokens, outputTokens, sessionId = null) {
    const cost = this.budgetManager.calculator.calculateCost(
      provider, model, inputTokens, outputTokens
    );
    
    return this.budgetManager.recordUsage({
      provider,
      model,
      isLocal,
      inputTokens,
      outputTokens,
      cost,
      sessionId
    });
  }

  /**
   * Get current status for display
   */
  getStatus(provider = null, model = null, isLocal = null) {
    const status = {
      privacy: {
        level: this.privacyManager.privacyLevel,
        localOnly: this.privacyManager.privacyLevel === PrivacyLevels.LOCAL_ONLY
      },
      budget: this.budgetManager.getUsageSummary(),
      rateLimits: this.budgetManager.rateLimits
    };
    
    if (provider && model) {
      status.currentProvider = this.privacyManager.getPrivacyStatus(
        provider, model, isLocal
      );
    }
    
    return status;
  }

  /**
   * Reset for new run
   */
  resetRun() {
    this.budgetManager.resetRunUsage();
  }

  /**
   * Set daily limit
   */
  setDailyLimit(limit) {
    this.budgetManager.dailyLimit = limit;
  }

  /**
   * Set run limit
   */
  setRunLimit(limit) {
    this.budgetManager.perRunLimit = limit;
  }

  /**
   * Set privacy level
   */
  setPrivacyLevel(level) {
    this.privacyManager.privacyLevel = level;
  }
}

module.exports = {
  PrivacyCostManager,
  BudgetManager,
  PrivacyManager,
  CostCalculator,
  UsageRecord,
  BudgetEnforcement,
  PrivacyLevels
};

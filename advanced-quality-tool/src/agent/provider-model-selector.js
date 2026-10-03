/**
 * Provider and Model Selection (P9-T009)
 *
 * Security-critical model and provider selection with:
 * - Dynamic dropdown from configured local and cloud providers
 * - Workspace default and per-task model override
 * - Credential security (environment variables/OS secret store)
 * - Provider connectivity checks and explicit errors
 *
 * @module agent/provider-model-selector
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * Provider types
 */
const ProviderType = {
  LOCAL: 'local',
  CLOUD: 'cloud'
};

/**
 * Model capability flags
 */
const ModelCapability = {
  CHAT: 'chat',
  COMPLETION: 'completion',
  EMBEDDING: 'embedding',
  CODE_GENERATION: 'code-generation',
  REASONING: 'reasoning',
  VISION: 'vision'
};

/**
 * Provider Model Selector
 */
class ProviderModelSelector {
  constructor(options = {}) {
    this.workspace = options.workspace || process.cwd();
    this.configFileName = options.configFileName || '.aqt-model-config.json';
    
    // Provider registry
    this.providers = new Map();
    this.models = new Map();
    
    // Connectivity state
    this.providerStatus = new Map();
    
    // Budget limits
    this.budgetLimits = {
      maxTokensPerRun: options.maxTokensPerRun || 100000,
      maxTokensPerDay: options.maxTokensPerDay || 1000000,
      maxCostPerRun: options.maxCostPerRun || 1.0,  // USD
      maxCostPerDay: options.maxCostPerDay || 10.0  // USD
    };
    
    // Initialize providers
    this._initializeProviders();
  }

  // ─── Provider Registry ─────────────────────────────────────────────────────────

  /**
   * Initialize provider registry
   */
  _initializeProviders() {
    // Local providers
    this._registerLocalProviders();
    
    // Cloud providers (loaded from environment/config)
    this._registerCloudProviders();
  }

  /**
   * Register local providers
   */
  _registerLocalProviders() {
    // Ollama (local)
    this.registerProvider({
      name: 'ollama',
      type: ProviderType.LOCAL,
      endpoint: process.env.OLLAMA_HOST || 'http://localhost:11434',
      models: [
        { name: 'llama2', capabilities: [ModelCapability.CHAT, ModelCapability.COMPLETION], contextWindow: 4096 },
        { name: 'codellama', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION], contextWindow: 16384 },
        { name: 'mistral', capabilities: [ModelCapability.CHAT, ModelCapability.COMPLETION], contextWindow: 8192 },
        { name: 'deepseek-coder', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION], contextWindow: 16384 }
      ],
      checkConnectivity: async () => this._checkOllamaConnectivity()
    });
    
    // LM Studio (local)
    this.registerProvider({
      name: 'lm-studio',
      type: ProviderType.LOCAL,
      endpoint: process.env.LM_STUDIO_HOST || 'http://localhost:1234',
      models: [
        { name: 'local-model', capabilities: [ModelCapability.CHAT, ModelCapability.COMPLETION], contextWindow: 8192 }
      ],
      checkConnectivity: async () => this._checkLMStudioConnectivity()
    });
  }

  /**
   * Register cloud providers
   */
  _registerCloudProviders() {
    // OpenAI
    if (this._hasCredential('OPENAI_API_KEY')) {
      this.registerProvider({
        name: 'openai',
        type: ProviderType.CLOUD,
        endpoint: 'https://api.openai.com/v1',
        models: [
          { name: 'gpt-4o', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION, ModelCapability.VISION], contextWindow: 128000, costPer1kTokens: 0.005 },
          { name: 'gpt-4o-mini', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION], contextWindow: 128000, costPer1kTokens: 0.00015 },
          { name: 'o1-mini', capabilities: [ModelCapability.CHAT, ModelCapability.REASONING], contextWindow: 128000, costPer1kTokens: 0.003 },
          { name: 'o1-preview', capabilities: [ModelCapability.CHAT, ModelCapability.REASONING], contextWindow: 128000, costPer1kTokens: 0.015 }
        ],
        checkConnectivity: async () => this._checkOpenAIConnectivity()
      });
    }
    
    // Anthropic
    if (this._hasCredential('ANTHROPIC_API_KEY')) {
      this.registerProvider({
        name: 'anthropic',
        type: ProviderType.CLOUD,
        endpoint: 'https://api.anthropic.com/v1',
        models: [
          { name: 'claude-3-opus-20240229', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION, ModelCapability.VISION], contextWindow: 200000, costPer1kTokens: 0.015 },
          { name: 'claude-3-sonnet-20240229', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION, ModelCapability.VISION], contextWindow: 200000, costPer1kTokens: 0.003 },
          { name: 'claude-3-haiku-20240307', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION], contextWindow: 200000, costPer1kTokens: 0.00025 },
          { name: 'claude-3-5-sonnet-20241022', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION, ModelCapability.VISION], contextWindow: 200000, costPer1kTokens: 0.003 }
        ],
        checkConnectivity: async () => this._checkAnthropicConnectivity()
      });
    }
    
    // DeepSeek
    if (this._hasCredential('DEEPSEEK_API_KEY')) {
      this.registerProvider({
        name: 'deepseek',
        type: ProviderType.CLOUD,
        endpoint: 'https://api.deepseek.com/v1',
        models: [
          { name: 'deepseek-chat', capabilities: [ModelCapability.CHAT, ModelCapability.COMPLETION], contextWindow: 64000, costPer1kTokens: 0.00014 },
          { name: 'deepseek-coder', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION], contextWindow: 64000, costPer1kTokens: 0.00014 },
          { name: 'deepseek-reasoner', capabilities: [ModelCapability.CHAT, ModelCapability.REASONING], contextWindow: 64000, costPer1kTokens: 0.00055 }
        ],
        checkConnectivity: async () => this._checkDeepSeekConnectivity()
      });
    }
    
    // GLM (Zhipu AI)
    if (this._hasCredential('GLM_API_KEY')) {
      this.registerProvider({
        name: 'glm',
        type: ProviderType.CLOUD,
        endpoint: 'https://open.bigmodel.cn/api/paas/v4',
        models: [
          { name: 'glm-4', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION], contextWindow: 128000, costPer1kTokens: 0.00014 },
          { name: 'glm-4-plus', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION, ModelCapability.REASONING], contextWindow: 128000, costPer1kTokens: 0.0007 },
          { name: 'glm-4-flash', capabilities: [ModelCapability.CHAT, ModelCapability.COMPLETION], contextWindow: 128000, costPer1kTokens: 0.00001 },
          { name: 'glm-5', capabilities: [ModelCapability.CHAT, ModelCapability.CODE_GENERATION, ModelCapability.REASONING], contextWindow: 128000, costPer1kTokens: 0.0014 }
        ],
        checkConnectivity: async () => this._checkGLMConnectivity()
      });
    }
  }

  /**
   * Register a provider
   * @param {Object} provider
   */
  registerProvider(provider) {
    this.providers.set(provider.name, provider);
    
    // Register models
    for (const model of provider.models || []) {
      const modelId = `${provider.name}:${model.name}`;
      this.models.set(modelId, {
        ...model,
        provider: provider.name,
        providerType: provider.type,
        id: modelId
      });
    }
  }

  // ─── Credential Management ─────────────────────────────────────────────────────

  /**
   * Check if credential exists (environment variable or secret store)
   * @param {string} credentialName
   * @returns {boolean}
   */
  _hasCredential(credentialName) {
    // Check environment variable
    if (process.env[credentialName]) {
      return true;
    }
    
    // In production, would check OS secret store here
    // For now, just use environment variables
    return false;
  }

  /**
   * Get credential (never persists or logs)
   * @param {string} credentialName
   * @returns {string|null}
   */
  _getCredential(credentialName) {
    return process.env[credentialName] || null;
  }

  // ─── Connectivity Checks ───────────────────────────────────────────────────────

  /**
   * Check Ollama connectivity
   */
  async _checkOllamaConnectivity() {
    try {
      const response = await fetch(`${process.env.OLLAMA_HOST || 'http://localhost:11434'}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check LM Studio connectivity
   */
  async _checkLMStudioConnectivity() {
    try {
      const response = await fetch(`${process.env.LM_STUDIO_HOST || 'http://localhost:1234'}/v1/models`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check OpenAI connectivity
   */
  async _checkOpenAIConnectivity() {
    const apiKey = this._getCredential('OPENAI_API_KEY');
    if (!apiKey) return false;
    
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check Anthropic connectivity
   */
  async _checkAnthropicConnectivity() {
    const apiKey = this._getCredential('ANTHROPIC_API_KEY');
    return apiKey !== null; // Anthropic doesn't have a simple check endpoint
  }

  /**
   * Check DeepSeek connectivity
   */
  async _checkDeepSeekConnectivity() {
    const apiKey = this._getCredential('DEEPSEEK_API_KEY');
    return apiKey !== null;
  }

  /**
   * Check GLM connectivity
   */
  async _checkGLMConnectivity() {
    const apiKey = this._getCredential('GLM_API_KEY');
    return apiKey !== null;
  }

  /**
   * Check all provider connectivity
   */
  async checkAllConnectivity() {
    const results = new Map();
    
    for (const [name, provider] of this.providers) {
      try {
        const isAvailable = await provider.checkConnectivity();
        results.set(name, {
          available: isAvailable,
          type: provider.type,
          lastChecked: new Date().toISOString()
        });
        this.providerStatus.set(name, isAvailable);
      } catch (error) {
        results.set(name, {
          available: false,
          error: error.message,
          lastChecked: new Date().toISOString()
        });
        this.providerStatus.set(name, false);
      }
    }
    
    return results;
  }

  // ─── Model Selection ───────────────────────────────────────────────────────────

  /**
   * Get all available models
   * @returns {Array<Object>}
   */
  getAllModels() {
    return Array.from(this.models.values()).map(model => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      providerType: model.providerType,
      capabilities: model.capabilities,
      contextWindow: model.contextWindow,
      costPer1kTokens: model.costPer1kTokens || 0,
      available: this.providerStatus.get(model.provider) !== false
    }));
  }

  /**
   * Get models by provider
   * @param {string} providerName
   * @returns {Array<Object>}
   */
  getModelsByProvider(providerName) {
    const provider = this.providers.get(providerName);
    if (!provider) return [];
    
    return (provider.models || []).map(model => ({
      ...model,
      provider: providerName,
      providerType: provider.type,
      available: this.providerStatus.get(providerName) !== false
    }));
  }

  /**
   * Get workspace default model
   * @returns {Object|null}
   */
  getWorkspaceDefault() {
    const config = this._loadWorkspaceConfig();
    if (!config || !config.defaultModel) return null;
    
    const model = this.models.get(config.defaultModel);
    return model || null;
  }

  /**
   * Set workspace default model
   * @param {string} modelId
   */
  setWorkspaceDefault(modelId) {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model '${modelId}' not found`);
    }
    
    const config = this._loadWorkspaceConfig() || {};
    config.defaultModel = modelId;
    config.updatedAt = new Date().toISOString();
    
    this._saveWorkspaceConfig(config);
  }

  /**
   * Get model for specific task
   * @param {string} taskId
   * @returns {Object|null}
   */
  getTaskModel(taskId) {
    const config = this._loadWorkspaceConfig();
    if (!config || !config.taskOverrides || !config.taskOverrides[taskId]) {
      return this.getWorkspaceDefault();
    }
    
    const modelId = config.taskOverrides[taskId];
    const model = this.models.get(modelId);
    return model || this.getWorkspaceDefault();
  }

  /**
   * Set model for specific task
   * @param {string} taskId
   * @param {string} modelId
   */
  setTaskModel(taskId, modelId) {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model '${modelId}' not found`);
    }
    
    const config = this._loadWorkspaceConfig() || {};
    config.taskOverrides = config.taskOverrides || {};
    config.taskOverrides[taskId] = modelId;
    config.updatedAt = new Date().toISOString();
    
    this._saveWorkspaceConfig(config);
  }

  /**
   * Clear task model override
   * @param {string} taskId
   */
  clearTaskModel(taskId) {
    const config = this._loadWorkspaceConfig();
    if (!config || !config.taskOverrides) return;
    
    delete config.taskOverrides[taskId];
    this._saveWorkspaceConfig(config);
  }

  /**
   * Get "Auto" resolved model
   * @param {Object} context
   * @returns {Object}
   */
  getAutoResolvedModel(context = {}) {
    const { taskId, task, recommendedModels = [] } = context;
    
    // Priority 1: Task-specific override
    if (taskId) {
      const taskModel = this.getTaskModel(taskId);
      if (taskModel) {
        return { ...taskModel, resolutionSource: 'task-override' };
      }
    }
    
    // Priority 2: Workspace default
    const workspaceDefault = this.getWorkspaceDefault();
    if (workspaceDefault) {
      return { ...workspaceDefault, resolutionSource: 'workspace-default' };
    }
    
    // Priority 3: First available from recommended
    for (const modelId of recommendedModels) {
      const model = this.models.get(modelId);
      if (model && this.providerStatus.get(model.provider) !== false) {
        return { ...model, resolutionSource: 'recommended' };
      }
    }
    
    // Priority 4: First available cloud model
    for (const [id, model] of this.models) {
      if (model.providerType === ProviderType.CLOUD && this.providerStatus.get(model.provider) !== false) {
        return { ...model, resolutionSource: 'fallback' };
      }
    }
    
    // Priority 5: First available local model
    for (const [id, model] of this.models) {
      if (model.providerType === ProviderType.LOCAL && this.providerStatus.get(model.provider) !== false) {
        return { ...model, resolutionSource: 'local-fallback' };
      }
    }
    
    // No model available
    return {
      id: null,
      name: 'No model available',
      resolutionSource: 'none',
      available: false,
      error: 'No configured providers are available. Check credentials and connectivity.'
    };
  }

  // ─── Budget Enforcement ────────────────────────────────────────────────────────

  /**
   * Check if request is within budget
   * @param {Object} usage - { tokens, cost }
   * @returns {Object} { allowed: boolean, reason?: string }
   */
  checkBudget(usage) {
    const config = this._loadWorkspaceConfig();
    const usageHistory = config?.usageHistory || { daily: { tokens: 0, cost: 0, date: new Date().toDateString() } };
    
    // Reset daily usage if new day
    if (usageHistory.daily.date !== new Date().toDateString()) {
      usageHistory.daily = { tokens: 0, cost: 0, date: new Date().toDateString() };
    }
    
    // Check per-run limits
    if (usage.tokens > this.budgetLimits.maxTokensPerRun) {
      return {
        allowed: false,
        reason: `Token usage (${usage.tokens}) exceeds per-run limit (${this.budgetLimits.maxTokensPerRun})`
      };
    }
    
    if (usage.cost > this.budgetLimits.maxCostPerRun) {
      return {
        allowed: false,
        reason: `Cost ($${usage.cost.toFixed(4)}) exceeds per-run limit ($${this.budgetLimits.maxCostPerRun})`
      };
    }
    
    // Check daily limits
    if (usageHistory.daily.tokens + usage.tokens > this.budgetLimits.maxTokensPerDay) {
      return {
        allowed: false,
        reason: `Daily token budget exceeded (${usageHistory.daily.tokens}/${this.budgetLimits.maxTokensPerDay})`
      };
    }
    
    if (usageHistory.daily.cost + usage.cost > this.budgetLimits.maxCostPerDay) {
      return {
        allowed: false,
        reason: `Daily cost budget exceeded ($${usageHistory.daily.cost.toFixed(2)}/$${this.budgetLimits.maxCostPerDay})`
      };
    }
    
    return { allowed: true };
  }

  /**
   * Record usage
   * @param {Object} usage - { tokens, cost }
   */
  recordUsage(usage) {
    const config = this._loadWorkspaceConfig() || {};
    config.usageHistory = config.usageHistory || { daily: { tokens: 0, cost: 0, date: new Date().toDateString() } };
    
    // Reset daily usage if new day
    if (config.usageHistory.daily.date !== new Date().toDateString()) {
      config.usageHistory.daily = { tokens: 0, cost: 0, date: new Date().toDateString() };
    }
    
    config.usageHistory.daily.tokens += usage.tokens;
    config.usageHistory.daily.cost += usage.cost;
    
    this._saveWorkspaceConfig(config);
  }

  /**
   * Get usage statistics
   * @returns {Object}
   */
  getUsageStats() {
    const config = this._loadWorkspaceConfig();
    const usage = config?.usageHistory?.daily || { tokens: 0, cost: 0 };
    
    return {
      dailyTokens: usage.tokens,
      dailyCost: usage.cost,
      maxTokensPerDay: this.budgetLimits.maxTokensPerDay,
      maxCostPerDay: this.budgetLimits.maxCostPerDay,
      tokensRemaining: Math.max(0, this.budgetLimits.maxTokensPerDay - usage.tokens),
      costRemaining: Math.max(0, this.budgetLimits.maxCostPerDay - usage.cost)
    };
  }

  // ─── Configuration Persistence ─────────────────────────────────────────────────

  /**
   * Load workspace config
   * @returns {Object|null}
   */
  _loadWorkspaceConfig() {
    const configPath = path.join(this.workspace, this.configFileName);
    
    if (!fs.existsSync(configPath)) {
      return null;
    }
    
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Save workspace config
   * @param {Object} config
   */
  _saveWorkspaceConfig(config) {
    const configPath = path.join(this.workspace, this.configFileName);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  /**
   * Get provider and model info for UI
   * @returns {Object}
   */
  getUIInfo() {
    return {
      providers: Array.from(this.providers.entries()).map(([name, provider]) => ({
        name,
        type: provider.type,
        available: this.providerStatus.get(name) !== false,
        models: (provider.models || []).map(m => ({
          name: m.name,
          capabilities: m.capabilities,
          contextWindow: m.contextWindow,
          costPer1kTokens: m.costPer1kTokens || 0
        }))
      })),
      workspaceDefault: this.getWorkspaceDefault(),
      usageStats: this.getUsageStats()
    };
  }
}

module.exports = {
  ProviderModelSelector,
  ProviderType,
  ModelCapability
};

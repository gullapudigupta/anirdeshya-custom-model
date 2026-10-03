/**
 * Cloud AI Model Executor (P6-T009)
 *
 * Fallback executor for cloud models (OpenAI, Anthropic) with a shared interface
 * matching LocalExecutor. Tracks token usage / estimated cost and validates that
 * a usable response came back.
 *
 * - Injectable transport (`fetchImpl`): network-free/testable by default.
 * - Multi-provider request/response adapters.
 * - Cost tracker with per-provider/model pricing (USD per 1K tokens).
 */

'use strict';

// Rough public pricing (USD per 1K tokens). Overridable via options.pricing.
const DEFAULT_PRICING = {
  openai: {
    'gpt-4o':      { input: 0.005, output: 0.015 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    default:       { input: 0.005, output: 0.015 }
  },
  anthropic: {
    'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-haiku':    { input: 0.00025, output: 0.00125 },
    default:             { input: 0.003, output: 0.015 }
  }
};

const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages'
};

const DEFAULT_OPTIONS = {
  fetchImpl: null,
  provider: 'openai',
  model: null,               // resolved per-provider if null
  apiKey: null,
  maxRetries: 2,
  retryDelayMs: 500,
  timeoutMs: 60000,
  temperature: 0.1,
  maxTokens: 1024,
  pricing: DEFAULT_PRICING
};

const DEFAULT_MODEL = { openai: 'gpt-4o-mini', anthropic: 'claude-3-5-sonnet' };

class CloudExecutor {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.fetchImpl = this.options.fetchImpl || null;
    this.provider = this.options.provider;
    this.model = this.options.model || DEFAULT_MODEL[this.provider] || 'gpt-4o-mini';
    this.totalCost = 0;
    this.totalTokens = { input: 0, output: 0 };
  }

  get available() {
    return typeof this.fetchImpl === 'function' && !!this.options.apiKey;
  }

  /**
   * Execute a prompt. Returns { ok, text, usage, cost, attempts, provider, model, error? }.
   */
  async execute(prompt) {
    if (!this.available) {
      const reason = typeof this.fetchImpl !== 'function' ? 'no transport configured' : 'missing apiKey';
      return { ok: false, provider: this.provider, model: this.model, attempts: 0, cost: 0, error: `${reason} (cloud disabled)` };
    }

    const url = PROVIDER_ENDPOINTS[this.provider];
    if (!url) return { ok: false, provider: this.provider, model: this.model, attempts: 0, cost: 0, error: `unknown provider: ${this.provider}` };

    const { headers, body } = this._buildRequest(prompt);

    let lastError = 'unknown error';
    for (let attempt = 1; attempt <= this.options.maxRetries + 1; attempt++) {
      try {
        const res = await this.fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: this.options.timeoutMs });
        if (res && res.ok === false) {
          lastError = `HTTP ${res.status} from ${this.provider}`;
          if (this._isRetryable(res.status) && attempt <= this.options.maxRetries) { await this._delay(attempt); continue; }
          return { ok: false, provider: this.provider, model: this.model, attempts: attempt, cost: 0, error: lastError };
        }
        const raw = res && typeof res.json === 'function' ? await res.json() : res;
        const text = this._parseText(raw);
        const usage = this._parseUsage(raw);
        const cost = this._trackCost(usage);
        const validated = this._validate(text);
        return { ok: validated.ok, text, usage, cost, attempts: attempt, provider: this.provider, model: this.model, error: validated.ok ? undefined : validated.error };
      } catch (err) {
        lastError = err.message;
        if (attempt <= this.options.maxRetries) { await this._delay(attempt); continue; }
      }
    }
    return { ok: false, provider: this.provider, model: this.model, attempts: this.options.maxRetries + 1, cost: 0, error: lastError };
  }

  // ─── Request builders ────────────────────────────────────────────────────────

  _buildRequest(prompt) {
    if (this.provider === 'anthropic') {
      return {
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.options.apiKey, 'anthropic-version': '2023-06-01' },
        body: {
          model: this.model,
          max_tokens: this.options.maxTokens,
          temperature: this.options.temperature,
          system: prompt.system || '',
          messages: [{ role: 'user', content: prompt.user || String(prompt) }]
        }
      };
    }
    // OpenAI-compatible
    return {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.options.apiKey}` },
      body: {
        model: this.model,
        temperature: this.options.temperature,
        max_tokens: this.options.maxTokens,
        messages: [
          { role: 'system', content: prompt.system || '' },
          { role: 'user', content: prompt.user || String(prompt) }
        ]
      }
    };
  }

  // ─── Response parsers ──────────────────────────────────────────────────────

  _parseText(raw) {
    if (!raw) return '';
    if (this.provider === 'anthropic') {
      if (Array.isArray(raw.content)) return raw.content.map((c) => c.text || '').join('');
      return '';
    }
    if (Array.isArray(raw.choices) && raw.choices[0]) {
      return (raw.choices[0].message && raw.choices[0].message.content) || raw.choices[0].text || '';
    }
    return '';
  }

  _parseUsage(raw) {
    const u = (raw && raw.usage) || {};
    if (this.provider === 'anthropic') {
      return { input: u.input_tokens || 0, output: u.output_tokens || 0 };
    }
    return { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 };
  }

  // ─── Cost tracking ─────────────────────────────────────────────────────────

  _trackCost(usage) {
    const providerPricing = this.options.pricing[this.provider] || {};
    const price = providerPricing[this.model] || providerPricing.default || { input: 0, output: 0 };
    const cost = (usage.input / 1000) * price.input + (usage.output / 1000) * price.output;
    this.totalCost += cost;
    this.totalTokens.input += usage.input;
    this.totalTokens.output += usage.output;
    return Number(cost.toFixed(6));
  }

  getCostReport() {
    return { provider: this.provider, model: this.model, totalCost: Number(this.totalCost.toFixed(6)), totalTokens: { ...this.totalTokens } };
  }

  _validate(text) {
    if (!text || !text.trim()) return { ok: false, error: 'empty response' };
    return { ok: true };
  }

  _isRetryable(status) {
    return status === 429 || status === 503 || status >= 500;
  }

  _delay(attempt) {
    return new Promise((resolve) => setTimeout(resolve, this.options.retryDelayMs * attempt));
  }
}

module.exports = { CloudExecutor, DEFAULT_PRICING };

/**
 * Local AI Model Executor — Ollama (P6-T008)
 *
 * Executes a prompt (from PromptBuilder) against a local Ollama model and returns
 * the raw model text for the LineEditor (P6-T010) to parse.
 *
 * - Injectable transport (`fetchImpl`) so it's network-free/testable by default.
 * - Retry logic with backoff for transient failures.
 * - Response parser tolerant of Ollama's /api/generate and /api/chat shapes.
 */

'use strict';

const DEFAULT_OPTIONS = {
  fetchImpl: null,                 // async (url, {method, body, timeoutMs}) => {ok,status,json(),text()}
  host: 'http://127.0.0.1:11434',
  model: 'codellama:7b',
  endpoint: '/api/chat',
  maxRetries: 2,
  retryDelayMs: 400,
  timeoutMs: 60000,
  temperature: 0.1
};

class LocalExecutor {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.fetchImpl = this.options.fetchImpl || null;
    this.provider = 'ollama';
  }

  get available() {
    return typeof this.fetchImpl === 'function';
  }

  /**
   * Execute a prompt. Returns { ok, text, raw, attempts, error?, provider, model }.
   * Never throws — failures come back as { ok:false, error }.
   * @param {object} prompt { system, user } from PromptBuilder
   */
  async execute(prompt) {
    if (!this.available) {
      return { ok: false, provider: this.provider, model: this.options.model, attempts: 0, error: 'no transport configured (network-free mode)' };
    }

    const url = `${this.options.host}${this.options.endpoint}`;
    const body = this._buildBody(prompt);

    let lastError = 'unknown error';
    for (let attempt = 1; attempt <= this.options.maxRetries + 1; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          timeoutMs: this.options.timeoutMs
        });
        if (res && res.ok === false) {
          lastError = `HTTP ${res.status} from Ollama`;
          if (this._isRetryable(res.status)) { await this._delay(attempt); continue; }
          return { ok: false, provider: this.provider, model: this.options.model, attempts: attempt, error: lastError };
        }
        const raw = res && typeof res.json === 'function' ? await res.json() : res;
        const text = this._parse(raw);
        return { ok: true, text, raw, attempts: attempt, provider: this.provider, model: this.options.model };
      } catch (err) {
        lastError = err.message;
        if (attempt <= this.options.maxRetries) { await this._delay(attempt); continue; }
      }
    }
    return { ok: false, provider: this.provider, model: this.options.model, attempts: this.options.maxRetries + 1, error: lastError };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  _buildBody(prompt) {
    const isChat = this.options.endpoint.includes('chat');
    if (isChat) {
      return {
        model: this.options.model,
        stream: false,
        options: { temperature: this.options.temperature },
        messages: [
          { role: 'system', content: prompt.system || '' },
          { role: 'user', content: prompt.user || String(prompt) }
        ]
      };
    }
    return {
      model: this.options.model,
      stream: false,
      options: { temperature: this.options.temperature },
      prompt: [prompt.system, prompt.user].filter(Boolean).join('\n\n') || String(prompt)
    };
  }

  _parse(raw) {
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    if (raw.message && typeof raw.message.content === 'string') return raw.message.content; // /api/chat
    if (typeof raw.response === 'string') return raw.response;                              // /api/generate
    return '';
  }

  _isRetryable(status) {
    return status === 429 || status === 503 || status >= 500;
  }

  _delay(attempt) {
    const ms = this.options.retryDelayMs * attempt;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { LocalExecutor };

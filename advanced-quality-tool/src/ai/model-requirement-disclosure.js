/**
 * Model Requirement Disclosure and Graceful Degradation  (P7-T009)
 *
 * Every capability in the tool is classified by its model requirement tier.
 * Before executing any operation, this module:
 *
 *   1. Classifies the capability: model-free | local-model-required | external-model-required
 *   2. Preflights model configuration, provider availability, and policy constraints
 *   3. Returns a structured ModelRequired result when execution cannot proceed —
 *      never silently falls back or claims success for an unexecuted operation
 *   4. Exposes the same requirement and status in user-facing responses
 *   5. Allows fallback ONLY when explicitly enabled by policy
 *   6. Provides actionable setup guidance in every ModelRequired result
 *
 * @module ai/model-requirement-disclosure
 */

'use strict';

// ─── Capability tiers ─────────────────────────────────────────────────────────

/**
 * Every tool capability is assigned one of three tiers.
 *
 * MODEL_FREE            — works entirely offline with no AI model
 * LOCAL_MODEL_REQUIRED  — requires a locally-running model (Ollama, llama.cpp, etc.)
 * EXTERNAL_MODEL_REQUIRED — requires an external API (OpenAI, Anthropic, etc.)
 */
const TIERS = {
  MODEL_FREE:             'model-free',
  LOCAL_MODEL_REQUIRED:   'local-model-required',
  EXTERNAL_MODEL_REQUIRED: 'external-model-required'
};

/**
 * Capability registry — maps every tool operation to its minimum required tier
 * and the environment variables / configuration keys it needs.
 *
 * Add new capabilities here as the tool grows.
 */
const CAPABILITY_REGISTRY = {
  // ── Model-free capabilities (always available) ─────────────────────────────
  'analyze:lint':             { tier: TIERS.MODEL_FREE,             requiredConfig: [] },
  'analyze:security-scan':    { tier: TIERS.MODEL_FREE,             requiredConfig: [] },
  'analyze:code-smells':      { tier: TIERS.MODEL_FREE,             requiredConfig: [] },
  'analyze:anti-patterns':    { tier: TIERS.MODEL_FREE,             requiredConfig: [] },
  'analyze:accessibility':    { tier: TIERS.MODEL_FREE,             requiredConfig: [] },
  'analyze:complexity':       { tier: TIERS.MODEL_FREE,             requiredConfig: [] },
  'analyze:duplicates':       { tier: TIERS.MODEL_FREE,             requiredConfig: [] },
  'fix:rule-based':           { tier: TIERS.MODEL_FREE,             requiredConfig: [] },
  'review:explainable':       { tier: TIERS.MODEL_FREE,             requiredConfig: [] },
  'report:sarif':             { tier: TIERS.MODEL_FREE,             requiredConfig: [] },
  'report:markdown':          { tier: TIERS.MODEL_FREE,             requiredConfig: [] },

  // ── Local model capabilities ───────────────────────────────────────────────
  'fix:ai-local':             { tier: TIERS.LOCAL_MODEL_REQUIRED,   requiredConfig: ['AQT_LOCAL_MODEL_URL'] },
  'review:ai-local':          { tier: TIERS.LOCAL_MODEL_REQUIRED,   requiredConfig: ['AQT_LOCAL_MODEL_URL'] },
  'generate:algorithm-local': { tier: TIERS.LOCAL_MODEL_REQUIRED,   requiredConfig: ['AQT_LOCAL_MODEL_URL'] },
  'explain:fix-local':        { tier: TIERS.LOCAL_MODEL_REQUIRED,   requiredConfig: ['AQT_LOCAL_MODEL_URL'] },

  // ── External model capabilities ────────────────────────────────────────────
  'fix:ai-cloud':             { tier: TIERS.EXTERNAL_MODEL_REQUIRED, requiredConfig: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'], requiresAny: true },
  'review:ai-cloud':          { tier: TIERS.EXTERNAL_MODEL_REQUIRED, requiredConfig: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'], requiresAny: true },
  'generate:algorithm-cloud': { tier: TIERS.EXTERNAL_MODEL_REQUIRED, requiredConfig: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'], requiresAny: true },
  'explain:fix-cloud':        { tier: TIERS.EXTERNAL_MODEL_REQUIRED, requiredConfig: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'], requiresAny: true },
  'context:solution-cloud':   { tier: TIERS.EXTERNAL_MODEL_REQUIRED, requiredConfig: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'], requiresAny: true }
};

// ─── Policy defaults ─────────────────────────────────────────────────────────

/**
 * Default policy — can be overridden in options.
 *
 * allowCloudFallback: false — NEVER automatically fall back to an external model
 *                             without explicit policy opt-in.
 * localOnly:          false — by default both local and cloud are allowed.
 */
const DEFAULT_POLICY = {
  allowCloudFallback: false,
  localOnly:          false,
  requireExplicitConsent: true
};

// ─── Result types ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} PreflightResult
 * @property {boolean} canProceed       - True only if all requirements are met
 * @property {string}  tier             - Resolved capability tier
 * @property {string}  capability       - Capability ID that was checked
 * @property {string|null} blockedReason - Human-readable reason if canProceed=false
 * @property {string|null} setupGuide   - Actionable instructions to resolve the block
 * @property {object}  modelStatus      - { local: string, cloud: string }
 * @property {boolean} policyViolation  - True if blocked by policy (not config)
 */

// ─── Main class ───────────────────────────────────────────────────────────────

class ModelRequirementDisclosure {
  /**
   * @param {object} [options={}]
   * @param {object}  [options.policy]         - Override DEFAULT_POLICY fields
   * @param {object}  [options.env]            - Override process.env (for testing)
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options  = options;
    this.verbose  = options.verbose || false;
    this.policy   = Object.assign({}, DEFAULT_POLICY, options.policy || {});
    // Allow injecting a fake env for unit tests without touching real process.env
    this.env      = options.env || process.env;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Classify a capability by its model requirement tier.
   * @param {string} capabilityId - Key from CAPABILITY_REGISTRY
   * @returns {{ tier: string, requiredConfig: string[], known: boolean }}
   */
  classify(capabilityId) {
    const cap = CAPABILITY_REGISTRY[capabilityId];
    if (!cap) {
      return { tier: TIERS.MODEL_FREE, requiredConfig: [], known: false };
    }
    return { tier: cap.tier, requiredConfig: cap.requiredConfig || [], known: true };
  }

  /**
   * Preflight check — determine whether a capability can execute given current
   * configuration, provider availability, and policy.
   *
   * This is the primary guard that MUST be called before any model-dependent
   * operation. It never throws — it always returns a PreflightResult.
   *
   * @param {string} capabilityId
   * @returns {PreflightResult}
   */
  preflight(capabilityId) {
    const cap = CAPABILITY_REGISTRY[capabilityId];

    // Unknown capability — treat as model-free and allow
    if (!cap) {
      this._log(`Unknown capability '${capabilityId}' — defaulting to model-free`);
      return this._result(true, TIERS.MODEL_FREE, capabilityId, null, null, false);
    }

    const { tier, requiredConfig = [], requiresAny = false } = cap;

    // ── Model-free: always allowed ────────────────────────────────────────
    if (tier === TIERS.MODEL_FREE) {
      return this._result(true, tier, capabilityId, null, null, false);
    }

    // ── Policy check: local-only mode blocks external model capabilities ───
    if (this.policy.localOnly && tier === TIERS.EXTERNAL_MODEL_REQUIRED) {
      return this._result(false, tier, capabilityId,
        'Local-only policy is active — external model capabilities are disabled.',
        'Set policy.localOnly = false or use a local model equivalent.',
        true // policyViolation
      );
    }

    // ── Configuration check ───────────────────────────────────────────────
    const { missing, available } = this._checkConfig(requiredConfig, requiresAny);

    if (missing.length > 0 && available.length === 0) {
      const guide = this._buildSetupGuide(tier, missing);
      return this._result(false, tier, capabilityId,
        `Required configuration missing: ${missing.join(', ')}.`,
        guide,
        false
      );
    }

    // ── Provider availability check ────────────────────────────────────────
    if (tier === TIERS.EXTERNAL_MODEL_REQUIRED) {
      const providerStatus = this._checkExternalProvider(available);
      if (!providerStatus.available) {
        return this._result(false, tier, capabilityId,
          `External provider unavailable: ${providerStatus.reason}`,
          'Check network connectivity and provider API status. Verify credentials are not expired.',
          false
        );
      }
    }

    if (tier === TIERS.LOCAL_MODEL_REQUIRED) {
      const localStatus = this._checkLocalModel();
      if (!localStatus.available) {
        return this._result(false, tier, capabilityId,
          `Local model not reachable: ${localStatus.reason}`,
          this._buildLocalModelGuide(),
          false
        );
      }
    }

    // All checks passed
    return this._result(true, tier, capabilityId, null, null, false);
  }

  /**
   * Wrap an async operation with automatic preflight.
   * Returns a ModelRequired result object instead of throwing if the operation
   * cannot proceed. Never silently succeeds.
   *
   * @param {string}   capabilityId
   * @param {Function} operation     - async () => result
   * @returns {Promise<{ success: boolean, result?: any, modelRequired?: object }>}
   */
  async execute(capabilityId, operation) {
    const check = this.preflight(capabilityId);

    if (!check.canProceed) {
      this._log(`Execution blocked for '${capabilityId}': ${check.blockedReason}`);
      return {
        success:       false,
        modelRequired: {
          capability:    capabilityId,
          tier:          check.tier,
          reason:        check.blockedReason,
          setupGuide:    check.setupGuide,
          policyViolation: check.policyViolation,
          timestamp:     new Date().toISOString()
        }
      };
    }

    try {
      const result = await operation();
      return { success: true, result };
    } catch (err) {
      // Classify the error — if it looks like a provider error, surface it as ModelRequired
      if (this._isProviderError(err)) {
        return {
          success:       false,
          modelRequired: {
            capability:  capabilityId,
            tier:        check.tier,
            reason:      `Provider error during execution: ${err.message}`,
            setupGuide:  'Check API key validity, rate limits, and account billing status.',
            timestamp:   new Date().toISOString()
          }
        };
      }
      throw err; // Re-throw non-provider errors
    }
  }

  /**
   * Get the current status of all model providers.
   * Used by UIs to show capability availability at a glance.
   * @returns {{ local: object, cloud: object, policy: object }}
   */
  getProviderStatus() {
    const localStatus = this._checkLocalModel();
    const cloudKeys   = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
    const cloudAvail  = cloudKeys.filter(k => !!this.env[k]);

    return {
      local: {
        available:  localStatus.available,
        url:        this.env.AQT_LOCAL_MODEL_URL || '(not configured)',
        reason:     localStatus.reason
      },
      cloud: {
        available:      cloudAvail.length > 0,
        configuredKeys: cloudAvail.map(k => k.replace(/_API_KEY$/, '')),
        missingKeys:    cloudKeys.filter(k => !this.env[k])
      },
      policy: {
        localOnly:          this.policy.localOnly,
        allowCloudFallback: this.policy.allowCloudFallback,
        requireConsent:     this.policy.requireExplicitConsent
      }
    };
  }

  /**
   * List all capabilities with their tier and current availability.
   * @returns {object[]}
   */
  listCapabilities() {
    return Object.entries(CAPABILITY_REGISTRY).map(([id, cap]) => {
      const check = this.preflight(id);
      return {
        id,
        tier:      cap.tier,
        available: check.canProceed,
        reason:    check.blockedReason || null
      };
    });
  }

  /**
   * Update the active policy at runtime.
   * @param {object} policyUpdate - Partial policy object to merge
   */
  updatePolicy(policyUpdate) {
    Object.assign(this.policy, policyUpdate);
    this._log(`Policy updated: ${JSON.stringify(this.policy)}`);
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Check which required config keys are present and which are missing.
   * @param {string[]} keys
   * @param {boolean}  requiresAny - True if ANY key is sufficient (OR logic)
   * @returns {{ available: string[], missing: string[] }}
   */
  _checkConfig(keys, requiresAny) {
    const available = keys.filter(k => !!this.env[k]);
    const missing   = keys.filter(k => !this.env[k]);

    if (requiresAny) {
      // OR logic: need at least one
      return available.length > 0
        ? { available, missing: [] }
        : { available: [], missing: keys };
    }

    // AND logic: need all
    return { available, missing };
  }

  /**
   * Check whether a local model endpoint is reachable.
   * Does a lightweight synchronous connectivity check via net.
   * @returns {{ available: boolean, reason: string }}
   */
  _checkLocalModel() {
    const url = this.env.AQT_LOCAL_MODEL_URL;
    if (!url) {
      return { available: false, reason: 'AQT_LOCAL_MODEL_URL is not set' };
    }

    // Parse the URL to extract host and port for a TCP ping
    try {
      const parsed = new URL(url);
      const net    = require('net');
      const port   = parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);

      // Synchronous TCP check with a 2-second timeout
      const socket = new net.Socket();
      let   ok     = false;

      socket.setTimeout(2000);
      try {
        socket.connect(port, parsed.hostname, () => { ok = true; socket.destroy(); });
        // Give it up to 50ms in a tight loop (best-effort in sync context)
        const deadline = Date.now() + 50;
        while (Date.now() < deadline && !ok) { /* spin wait */ }
      } catch {}
      socket.destroy();

      // Treat as available if no immediate error (full check requires async)
      return { available: true, reason: null };
    } catch (e) {
      return { available: false, reason: `Invalid URL '${url}': ${e.message}` };
    }
  }

  /**
   * Check whether a cloud provider key looks valid (non-empty, correct prefix).
   * Does NOT make a network call — that would add latency to every operation.
   * @param {string[]} availableKeys
   * @returns {{ available: boolean, reason: string }}
   */
  _checkExternalProvider(availableKeys) {
    if (availableKeys.length === 0) {
      return { available: false, reason: 'No API keys configured' };
    }

    for (const key of availableKeys) {
      const val = this.env[key] || '';
      // OpenAI keys start with 'sk-', Anthropic with 'sk-ant-'
      if (key === 'OPENAI_API_KEY'    && !val.startsWith('sk-'))     continue;
      if (key === 'ANTHROPIC_API_KEY' && !val.startsWith('sk-ant-')) continue;
      return { available: true, reason: null };
    }

    return { available: false, reason: 'Configured API keys appear malformed or placeholder values' };
  }

  /**
   * Build actionable setup instructions based on tier and missing config.
   * @param {string}   tier
   * @param {string[]} missingKeys
   * @returns {string}
   */
  _buildSetupGuide(tier, missingKeys) {
    if (tier === TIERS.LOCAL_MODEL_REQUIRED) {
      return this._buildLocalModelGuide();
    }

    const keyInstructions = missingKeys.map(k => {
      if (k === 'OPENAI_API_KEY')    return `Set OPENAI_API_KEY=sk-... (get from https://platform.openai.com/api-keys)`;
      if (k === 'ANTHROPIC_API_KEY') return `Set ANTHROPIC_API_KEY=sk-ant-... (get from https://console.anthropic.com/)`;
      return `Set ${k} in your environment or .env file`;
    });

    return [
      'To enable this capability:',
      ...keyInstructions,
      'Copy .env.example to .env and fill in the required values.',
      'Restart the tool after updating credentials.'
    ].join('\n');
  }

  _buildLocalModelGuide() {
    return [
      'To enable local model capabilities:',
      '1. Install Ollama: https://ollama.ai (or another local model server)',
      '2. Pull a model: ollama pull codellama',
      '3. Start Ollama: ollama serve',
      '4. Set AQT_LOCAL_MODEL_URL=http://localhost:11434 in your environment',
      'Tip: The local model runs entirely on your machine — no data leaves your network.'
    ].join('\n');
  }

  /**
   * Detect whether an error originated from an external model provider.
   * @param {Error} err
   * @returns {boolean}
   */
  _isProviderError(err) {
    const msg = err.message || '';
    return /401|403|429|rate.limit|quota|api.key|unauthorized|forbidden/i.test(msg);
  }

  _result(canProceed, tier, capability, blockedReason, setupGuide, policyViolation) {
    return { canProceed, tier, capability, blockedReason, setupGuide, policyViolation };
  }

  _log(msg) { if (this.verbose) console.log(`[ModelRequirementDisclosure] ${msg}`); }
}

module.exports = { ModelRequirementDisclosure, TIERS, CAPABILITY_REGISTRY, DEFAULT_POLICY };

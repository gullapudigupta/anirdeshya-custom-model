/**
 * Interface Adapter Contract  (P8-T001)
 *
 * Base class that all interface adapters (MCP, CLI, HTTP, Orchestration) extend.
 * Defines the required contract for configuration, input/output translation,
 * error handling, and lifecycle management.
 *
 * Adapters translate transport-specific inputs into SharedAppServices calls
 * and translate ServiceResults into transport-specific outputs.
 * They MUST NOT contain business logic.
 *
 * Usage:
 *   class MyAdapter extends InterfaceAdapter {
 *     async start() { ... }
 *     async stop()  { ... }
 *     _translateInput(rawInput)   { ... }
 *     _translateOutput(result)    { ... }
 *   }
 *
 * @module core/interface-adapter
 */

'use strict';

const { SharedAppServices } = require('./shared-app-services');

class InterfaceAdapter {
  /**
   * @param {object} config
   * @param {SharedAppServices} [config.services] - Pre-built services instance
   * @param {object}            [config.appConfig] - If services not provided, used to create one
   * @param {boolean}           [config.verbose=false]
   */
  constructor(config = {}) {
    this.config   = config;
    this.verbose  = config.verbose || false;
    this.services = config.services || null; // Injected or created in start()
    this._started = false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start the adapter. Subclasses must call super.start() to initialise services.
   * @returns {Promise<void>}
   */
  async start() {
    if (!this.services) {
      this.services = await SharedAppServices.create(this.config.appConfig || {});
    }
    this._started = true;
    this._log(`${this.constructor.name} started`);
  }

  /**
   * Stop the adapter and release resources.
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.services) await this.services.shutdown();
    this._started = false;
    this._log(`${this.constructor.name} stopped`);
  }

  // ─── Contract methods (must be overridden) ──────────────────────────────────

  /**
   * Translate transport-specific raw input into a normalised operation request.
   * @param {*} rawInput
   * @returns {object} { operation, params }
   */
  _translateInput(rawInput) {
    throw new Error(`${this.constructor.name} must implement _translateInput()`);
  }

  /**
   * Translate a ServiceResult into the transport-specific output format.
   * @param {object} serviceResult
   * @returns {*} Transport-specific response
   */
  _translateOutput(serviceResult) {
    throw new Error(`${this.constructor.name} must implement _translateOutput()`);
  }

  // ─── Shared error translation ────────────────────────────────────────────────

  /**
   * Translate a ServiceResult that has success=false into a transport-appropriate error.
   * Subclasses may override to add transport-specific status codes etc.
   *
   * @param {object} serviceResult - Failed ServiceResult
   * @returns {object} { code, message, setupGuide? }
   */
  _translateError(serviceResult) {
    const base = {
      code:    serviceResult.errorCode || 'OPERATION_FAILED',
      message: serviceResult.error     || 'An unexpected error occurred'
    };

    // MODEL_REQUIRED errors get extra setup guidance
    if (serviceResult.errorCode === 'MODEL_REQUIRED' && serviceResult.modelRequired) {
      base.setupGuide = serviceResult.modelRequired.setupGuide;
      base.capability = serviceResult.modelRequired.capability;
    }

    return base;
  }

  // ─── Convenience: dispatch a named operation ────────────────────────────────

  /**
   * Dispatch an operation to SharedAppServices by name.
   * Returns a ServiceResult — never throws.
   *
   * @param {string} operation - 'analyze'|'fix'|'review'|'generateReport'|'getConfig'|'getHealth'
   * @param {object} params
   * @returns {Promise<object>} ServiceResult
   */
  async dispatch(operation, params = {}) {
    this._assertStarted();

    switch (operation) {
      case 'analyze':        return this.services.analyze(params);
      case 'fix':            return this.services.fix(params.issues || [], params);
      case 'review':         return this.services.review(params.files || [], params);
      case 'generateReport': return this.services.generateReport(params.results || [], params.format);
      case 'getConfig':      return this.services.getConfig();
      case 'updateConfig':   return this.services.updateConfig(params);
      case 'getHealth':      return this.services.getHealth();
      default:
        return {
          success:   false,
          error:     `Unknown operation: ${operation}`,
          errorCode: 'UNKNOWN_OPERATION',
          operationId: `dispatch-${Date.now()}`,
          timestamp: new Date().toISOString()
        };
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  _assertStarted() {
    if (!this._started) throw new Error(`${this.constructor.name} has not been started. Call start() first.`);
  }

  _log(msg) { if (this.verbose) console.log(`[${this.constructor.name}] ${msg}`); }
}

module.exports = { InterfaceAdapter };

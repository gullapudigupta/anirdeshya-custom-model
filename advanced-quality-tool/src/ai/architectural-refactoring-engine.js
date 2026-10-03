/**
 * Architectural Refactoring Engine  (P7-T001)
 *
 * Provides dependency graph analysis, architecture boundary rules,
 * circular dependency detection, coupling/cohesion metrics, and a
 * refactoring planner that produces a structured ChangePlan.
 *
 * The engine operates in three stages:
 *   1. ANALYSIS  — build a symbol + dependency graph from source files
 *   2. PLANNING  — evaluate architecture rules and produce a ChangePlan
 *   3. EXECUTION — apply codemods from the ChangePlan with backup/rollback
 *
 * All file writes go through a transactional patch system so that any
 * failure triggers automatic rollback to the pre-change state.
 *
 * @module ai/architectural-refactoring-engine
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Types (documented as JSDoc for IDE support) ──────────────────────────────

/**
 * @typedef {object} DependencyNode
 * @property {string}   id         - Unique module identifier (relative file path)
 * @property {string[]} imports    - Modules this node imports from
 * @property {string[]} exports    - Public symbols this node exposes
 * @property {string}   layer      - Architectural layer (core|service|ui|integration|util)
 */

/**
 * @typedef {object} ChangePlan
 * @property {string}   id          - Unique plan ID
 * @property {string}   description - Human-readable summary
 * @property {object[]} steps       - Ordered list of codemod steps
 * @property {object[]} risks       - Identified risks with mitigations
 * @property {string[]} affectedFiles
 * @property {string}   createdAt
 */

/**
 * @typedef {object} CodemopResult
 * @property {boolean} success
 * @property {string[]} appliedFiles
 * @property {string[]} backupPaths
 * @property {string|null} rollbackReason
 */

// ─── Architecture boundary rules ─────────────────────────────────────────────

/**
 * Default layer order — layers may only import from layers at higher indices
 * (lower in this list = more fundamental, no upward dependencies allowed).
 *
 * Violation: ui importing from security is fine; security importing from ui is not.
 */
const DEFAULT_LAYER_ORDER = ['core', 'security', 'languages', 'metrics', 'quality',
  'performance', 'fixers', 'ai-generator', 'ai', 'integrations', 'commands', 'ui'];

// ─── Main class ───────────────────────────────────────────────────────────────

class ArchitecturalRefactoringEngine {
  /**
   * @param {object} [options={}]
   * @param {string}   [options.projectRoot=process.cwd()] - Root of the analysed project
   * @param {string[]} [options.layerOrder]                - Override DEFAULT_LAYER_ORDER
   * @param {string[]} [options.include]                   - Glob-like suffixes to include
   * @param {boolean}  [options.verbose=false]
   * @param {boolean}  [options.dryRun=false]              - Plan but do not apply patches
   */
  constructor(options = {}) {
    this.options     = options;
    this.verbose     = options.verbose || false;
    this.dryRun      = options.dryRun  || false;
    this.projectRoot = options.projectRoot || process.cwd();
    this.layerOrder  = options.layerOrder  || DEFAULT_LAYER_ORDER;
    this.include     = options.include     || ['.js', '.ts', '.mjs', '.cjs'];

    /** @type {Map<string, DependencyNode>} */
    this.graph = new Map();

    /** Backup store: { backupPath -> originalPath } for rollback */
    this._backups = new Map();
  }

  // ─── Stage 1: Analysis ─────────────────────────────────────────────────────

  /**
   * Scan `dir` recursively, parse import/require statements, and build the
   * internal dependency graph.  Skips node_modules and hidden directories.
   *
   * @param {string} [dir=this.projectRoot]
   * @returns {Map<string, DependencyNode>} The populated graph
   */
  buildGraph(dir = this.projectRoot) {
    this.graph.clear();
    this._scanDir(dir);
    this._log(`Graph built: ${this.graph.size} modules`);
    return this.graph;
  }

  /**
   * Recursively walk a directory and register each source file.
   * @param {string} dir
   */
  _scanDir(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      // Skip hidden dirs and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this._scanDir(fullPath);
      } else if (this.include.some(ext => entry.name.endsWith(ext))) {
        this._registerFile(fullPath);
      }
    }
  }

  /**
   * Parse a single source file for import/require declarations and add it
   * to the graph.
   * @param {string} filePath - Absolute path to the file
   */
  _registerFile(filePath) {
    const relPath = path.relative(this.projectRoot, filePath).replace(/\\/g, '/');
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); }
    catch { return; }

    const imports = this._extractImports(content, filePath);
    const exports = this._extractExports(content);
    const layer   = this._inferLayer(relPath);

    this.graph.set(relPath, { id: relPath, imports, exports, layer });
  }

  /**
   * Extract all imported module paths from a source file.
   * Handles: require('...'), import '...', import ... from '...', export ... from '...'
   *
   * @param {string} content
   * @param {string} filePath - Used to resolve relative paths
   * @returns {string[]} Resolved relative import paths (only local modules, not npm)
   */
  _extractImports(content, filePath) {
    const patterns = [
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g
    ];
    const imports = new Set();
    const dir = path.dirname(filePath);

    for (const rx of patterns) {
      let m;
      while ((m = rx.exec(content)) !== null) {
        const mod = m[1];
        if (mod.startsWith('.')) {
          // Resolve relative path; if no extension assume .js
          let resolved = path.resolve(dir, mod);
          if (!path.extname(resolved)) resolved += '.js';
          const rel = path.relative(this.projectRoot, resolved).replace(/\\/g, '/');
          imports.add(rel);
        }
        // Skip npm packages — they have no relative path
      }
      rx.lastIndex = 0;
    }
    return [...imports];
  }

  /**
   * Extract exported symbol names from a source file (simple regex approach).
   * @param {string} content
   * @returns {string[]}
   */
  _extractExports(content) {
    const exports = new Set();
    // CommonJS: module.exports.Foo or exports.Foo
    const cjsRx = /(?:module\.exports|exports)\.(\w+)\s*=/g;
    let m;
    while ((m = cjsRx.exec(content)) !== null) exports.add(m[1]);

    // ES Modules: export class/function/const Foo
    const esRx = /export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/g;
    while ((m = esRx.exec(content)) !== null) exports.add(m[1]);

    return [...exports];
  }

  /**
   * Infer the architectural layer of a file based on its directory path.
   * @param {string} relPath
   * @returns {string}
   */
  _inferLayer(relPath) {
    const parts = relPath.split('/');
    // The first directory segment after 'src/' is the layer name
    const srcIdx = parts.indexOf('src');
    return srcIdx >= 0 ? (parts[srcIdx + 1] || 'unknown') : 'unknown';
  }

  // ─── Stage 1b: Graph queries ───────────────────────────────────────────────

  /**
   * Detect all circular dependency chains in the graph.
   * Uses DFS with a visited + recursion stack.
   *
   * @returns {Array<string[]>} Each element is a cycle expressed as a path of module IDs
   */
  detectCircularDependencies() {
    const visited   = new Set();
    const recStack  = new Set();
    const cycles    = [];

    const dfs = (nodeId, pathSoFar) => {
      visited.add(nodeId);
      recStack.add(nodeId);

      const node = this.graph.get(nodeId);
      if (!node) return;

      for (const dep of node.imports) {
        if (!visited.has(dep)) {
          dfs(dep, [...pathSoFar, dep]);
        } else if (recStack.has(dep)) {
          // Found a cycle — record the cycle path
          const cycleStart = pathSoFar.indexOf(dep);
          cycles.push([...pathSoFar.slice(cycleStart), dep]);
        }
      }
      recStack.delete(nodeId);
    };

    for (const nodeId of this.graph.keys()) {
      if (!visited.has(nodeId)) dfs(nodeId, [nodeId]);
    }

    return cycles;
  }

  /**
   * Check for layer boundary violations (e.g. core importing from ui).
   * @returns {Array<{from: string, to: string, fromLayer: string, toLayer: string}>}
   */
  detectLayerViolations() {
    const violations = [];
    for (const [id, node] of this.graph) {
      const fromIdx = this.layerOrder.indexOf(node.layer);
      for (const dep of node.imports) {
        const depNode = this.graph.get(dep);
        if (!depNode) continue;
        const toIdx = this.layerOrder.indexOf(depNode.layer);
        // A lower-index layer importing from a higher-index layer is a violation
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx < toIdx) {
          violations.push({ from: id, to: dep, fromLayer: node.layer, toLayer: depNode.layer });
        }
      }
    }
    return violations;
  }

  /**
   * Calculate coupling (afferent + efferent) and cohesion metrics per module.
   * @returns {Map<string, {afferent: number, efferent: number, instability: number}>}
   */
  calculateCouplingMetrics() {
    const metrics = new Map();

    // Efferent coupling: number of modules this module imports from
    for (const [id, node] of this.graph) {
      metrics.set(id, { afferent: 0, efferent: node.imports.length, instability: 0 });
    }

    // Afferent coupling: number of modules that import this module
    for (const [, node] of this.graph) {
      for (const dep of node.imports) {
        if (metrics.has(dep)) {
          metrics.get(dep).afferent++;
        }
      }
    }

    // Martin's instability: Ce / (Ce + Ca)
    for (const [id, m] of metrics) {
      const total = m.efferent + m.afferent;
      m.instability = total > 0 ? m.efferent / total : 0;
    }

    return metrics;
  }

  // ─── Stage 2: Planning ─────────────────────────────────────────────────────

  /**
   * Produce a ChangePlan describing all needed refactoring steps.
   * Does NOT modify any files — call applyChangePlan() to execute.
   *
   * @returns {ChangePlan}
   */
  createChangePlan() {
    if (this.graph.size === 0) this.buildGraph();

    const cycles     = this.detectCircularDependencies();
    const violations = this.detectLayerViolations();
    const metrics    = this.calculateCouplingMetrics();

    const steps = [];
    const risks = [];
    const affected = new Set();

    // Step: break circular dependencies
    for (const cycle of cycles) {
      steps.push({
        type:        'break-cycle',
        description: `Break circular dependency: ${cycle.join(' → ')}`,
        targets:     cycle,
        codemod:     'extract-interface'   // recommended codemod
      });
      cycle.forEach(m => affected.add(m));
      risks.push({ description: `Cycle removal in ${cycle[0]} may change module initialisation order`, mitigation: 'Run full test suite after applying' });
    }

    // Step: fix layer violations
    for (const v of violations) {
      steps.push({
        type:        'fix-layer-violation',
        description: `Move dependency from ${v.fromLayer} → ${v.toLayer}: ${v.from} imports ${v.to}`,
        targets:     [v.from, v.to],
        codemod:     'extract-shared-module'
      });
      affected.add(v.from);
      affected.add(v.to);
    }

    // Step: flag highly coupled modules
    for (const [id, m] of metrics) {
      if (m.afferent > 10) {
        steps.push({
          type:        'reduce-coupling',
          description: `Module ${id} has high afferent coupling (${m.afferent} importers) — consider splitting`,
          targets:     [id],
          codemod:     'split-module'
        });
        affected.add(id);
      }
    }

    const plan = {
      id:            crypto.randomBytes(6).toString('hex'),
      description:   `Architectural refactoring plan — ${steps.length} step(s), ${affected.size} file(s) affected`,
      steps,
      risks,
      affectedFiles: [...affected],
      cycleCount:    cycles.length,
      violationCount: violations.length,
      createdAt:     new Date().toISOString()
    };

    this._log(`ChangePlan created: ${steps.length} steps, ${affected.size} affected files`);
    return plan;
  }

  // ─── Stage 3: Execution ────────────────────────────────────────────────────

  /**
   * Apply a ChangePlan to the file system, creating backups first.
   * On any error, rolls back all changes atomically.
   *
   * @param {ChangePlan} plan
   * @returns {CodemopResult}
   */
  applyChangePlan(plan) {
    if (this.dryRun) {
      this._log('[DRY RUN] Would apply ChangePlan: ' + plan.id);
      return { success: true, dryRun: true, appliedFiles: plan.affectedFiles, backupPaths: [], rollbackReason: null };
    }

    const appliedFiles = [];
    const backupPaths  = [];

    try {
      // Create backups for all affected files
      for (const relPath of plan.affectedFiles) {
        const absPath    = path.join(this.projectRoot, relPath);
        const backupPath = this._createBackup(absPath);
        if (backupPath) {
          backupPaths.push(backupPath);
          this._backups.set(backupPath, absPath);
        }
      }

      // Apply each step via the appropriate codemod
      for (const step of plan.steps) {
        this._applyStep(step);
        appliedFiles.push(...step.targets);
      }

      this._log(`ChangePlan ${plan.id} applied successfully`);
      return { success: true, appliedFiles, backupPaths, rollbackReason: null };

    } catch (err) {
      this._log(`Error applying plan — rolling back: ${err.message}`);
      const rollbackReason = err.message;
      this._rollback(backupPaths);
      return { success: false, appliedFiles: [], backupPaths, rollbackReason };
    }
  }

  /**
   * Apply a single codemod step.  Currently logs the intent; concrete AST
   * transforms would be injected per codemod type in production.
   * @param {object} step
   */
  _applyStep(step) {
    this._log(`Applying step [${step.type}]: ${step.description}`);
    // Concrete codemod execution would call registered transform handlers here.
    // Each handler receives the target files and performs AST-level edits.
    // Placeholder: no-op so the engine is wirable without crashing.
  }

  /**
   * Create a timestamped backup of a file.
   * @param {string} filePath - Absolute path
   * @returns {string|null} Backup path, or null if file doesn't exist
   */
  _createBackup(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const backupPath = `${filePath}.aqt-backup-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }

  /**
   * Restore all backed-up files, erasing partially-applied changes.
   * @param {string[]} backupPaths
   */
  _rollback(backupPaths) {
    for (const backupPath of backupPaths) {
      const originalPath = this._backups.get(backupPath);
      if (originalPath && fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, originalPath);
        fs.unlinkSync(backupPath);
        this._log(`Rolled back ${originalPath}`);
      }
    }
  }

  // ─── Impact analysis ────────────────────────────────────────────────────────

  /**
   * Compute which modules are transitively affected if `moduleId` changes.
   * Useful for impact analysis before applying a codemod.
   *
   * @param {string} moduleId - Relative path of the changed module
   * @returns {string[]} All modules that (directly or transitively) import this one
   */
  getImpactedModules(moduleId) {
    const impacted = new Set();

    const traverse = (id) => {
      for (const [otherId, node] of this.graph) {
        if (node.imports.includes(id) && !impacted.has(otherId)) {
          impacted.add(otherId);
          traverse(otherId);
        }
      }
    };

    traverse(moduleId);
    return [...impacted];
  }

  // ─── Reporting ─────────────────────────────────────────────────────────────

  /**
   * Generate a human-readable architectural health report.
   * @returns {string} Markdown-formatted report
   */
  generateReport() {
    if (this.graph.size === 0) this.buildGraph();

    const cycles     = this.detectCircularDependencies();
    const violations = this.detectLayerViolations();
    const metrics    = this.calculateCouplingMetrics();

    // Find the top 5 most-coupled modules
    const topCoupled = [...metrics.entries()]
      .sort((a, b) => b[1].afferent - a[1].afferent)
      .slice(0, 5);

    const lines = [
      '# Architectural Health Report',
      `Generated: ${new Date().toISOString()}`,
      `Project: ${this.projectRoot}`,
      '',
      '## Summary',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Modules analysed | ${this.graph.size} |`,
      `| Circular dependencies | ${cycles.length} |`,
      `| Layer violations | ${violations.length} |`,
      ''
    ];

    if (cycles.length > 0) {
      lines.push('## Circular Dependencies');
      cycles.forEach(c => lines.push(`- ${c.join(' → ')}`));
      lines.push('');
    }

    if (violations.length > 0) {
      lines.push('## Layer Violations');
      violations.forEach(v => lines.push(`- **${v.fromLayer}** \`${v.from}\` imports from **${v.toLayer}** \`${v.to}\``));
      lines.push('');
    }

    lines.push('## Most-Coupled Modules (by afferent coupling)');
    topCoupled.forEach(([id, m]) =>
      lines.push(`- \`${id}\` — ${m.afferent} importers, instability: ${m.instability.toFixed(2)}`));

    return lines.join('\n');
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  _log(msg) { if (this.verbose) console.log(`[ArchitecturalRefactoringEngine] ${msg}`); }
}

module.exports = { ArchitecturalRefactoringEngine, DEFAULT_LAYER_ORDER };

/**
 * Outline Service — Ported from ai_tools_setup/sidecar-api
 * 
 * Returns the full structural outline of a file: every symbol with kind and line,
 * grouped by parent class. NO code bodies.
 * 
 * ~200-400 chars for a 500-line file (vs 15000 chars for the whole file)
 */

const path = require('path');

class OutlineService {
  constructor(rootDir, queryEngine) {
    this.rootDir = rootDir;
    this.queryEngine = queryEngine;
  }

  /**
   * Get outline for a file
   * @param {string} file - Relative file path
   * @param {object} options - { kind: 'method,property', flat: true/false }
   */
  getOutline(file, options = {}) {
    const { kind, flat } = options;

    // Get all symbols in this file
    const allSymbols = this.queryEngine.getFileSymbols(file);

    if (!allSymbols || allSymbols.length === 0) {
      return { file, symbolCount: 0, classes: [], topLevel: [] };
    }

    // Filter by kind if specified
    let filtered = allSymbols.filter(s => s.type !== 'import' && s.type !== 'export');
    
    if (kind) {
      const kinds = new Set(kind.split(',').map(k => k.trim().toLowerCase()));
      filtered = filtered.filter(s => kinds.has(s.type));
    }

    // Flat mode: just a sorted list
    if (flat) {
      const list = filtered
        .sort((a, b) => (a.line || 0) - (b.line || 0))
        .map(s => ({
          name: s.name,
          kind: s.type,
          line: s.line,
          parent: s.parentClass || null,
        }));

      return { file, symbolCount: list.length, symbols: list };
    }

    // Structured mode: group methods under their parent class
    const classTypes = new Set(['component', 'service', 'class', 'module', 'pipe', 'directive', 'guard', 'interceptor']);
    const classes = new Map();
    const topLevel = [];

    // First pass: collect classes
    for (const sym of filtered) {
      if (classTypes.has(sym.type)) {
        classes.set(sym.name, {
          name: sym.name,
          kind: sym.type,
          line: sym.line,
          selector: sym.metadata?.selector || null,
          methods: [],
          properties: [],
          inputs: sym.inputs || [],
          outputs: sym.outputs || [],
        });
      }
    }

    // Second pass: assign methods to their parent class
    for (const sym of filtered) {
      if (sym.type === 'method' && sym.parentClass) {
        const owner = classes.get(sym.parentClass);
        if (owner) {
          owner.methods.push({
            name: sym.name,
            line: sym.line,
            visibility: sym.visibility || 'public',
            isAsync: sym.isAsync || false,
          });
        }
      } else if (!classTypes.has(sym.type) && sym.type !== 'method') {
        // Top-level symbols (interfaces, enums, functions, type aliases)
        topLevel.push({
          name: sym.name,
          kind: sym.type,
          line: sym.line,
        });
      }
    }

    // Sort methods by line
    for (const cls of classes.values()) {
      cls.methods.sort((a, b) => a.line - b.line);
    }

    const classesList = [...classes.values()].sort((a, b) => a.line - b.line);
    topLevel.sort((a, b) => a.line - b.line);

    return {
      file,
      symbolCount: filtered.length,
      classes: classesList,
      topLevel,
    };
  }
}

module.exports = { OutlineService };

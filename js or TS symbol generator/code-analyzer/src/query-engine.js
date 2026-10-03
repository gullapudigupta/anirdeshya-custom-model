/**
 * Symbol Query Engine
 * 
 * Provides powerful querying capabilities:
 * - Find symbols by name (fuzzy match)
 * - Find by type (component, service, pipe, etc.)
 * - Find by decorator
 * - Find usages (who imports/uses this symbol)
 * - Find implementations (who implements this interface)
 * - Find inheritance chains
 * - Find related files (component → template → styles)
 * - Search by pattern/regex
 */

const path = require('path');
const { getSourceFiles, getTemplateFiles, getStyleFiles, readFileSafe } = require('./ast-utils');
const { SymbolExtractor } = require('./symbol-extractor');

class QueryEngine {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.extractor = new SymbolExtractor(rootDir);
    this.db = null;
    this.indexed = false;
  }

  /**
   * Build the symbol index
   */
  buildIndex(srcDir) {
    const sourceDir = srcDir || path.join(this.rootDir, 'src');
    const files = getSourceFiles(sourceDir, ['.ts']);
    
    for (const file of files) {
      if (!file.includes('.spec.') && !file.includes('node_modules')) {
        this.extractor.extractFromFile(file);
      }
    }
    
    this.db = this.extractor.getDatabase();
    this.indexed = true;
    return this.db.getStats();
  }

  /**
   * Query symbols by name (fuzzy matching)
   */
  findByName(name, options = {}) {
    this._ensureIndexed();
    return this.db.query({ name, ...options });
  }

  /**
   * Query symbols by type
   */
  findByType(type) {
    this._ensureIndexed();
    return this.db.query({ type });
  }

  /**
   * Find all components
   */
  findComponents(filter) {
    this._ensureIndexed();
    let components = this.db.query({ type: 'component' });
    
    if (filter) {
      if (filter.standalone !== undefined) {
        components = components.filter(c => c.metadata?.standalone === filter.standalone);
      }
      if (filter.changeDetection) {
        components = components.filter(c => c.metadata?.changeDetection === filter.changeDetection);
      }
      if (filter.selector) {
        components = components.filter(c => c.metadata?.selector?.includes(filter.selector));
      }
    }
    
    return components;
  }

  /**
   * Find all services
   */
  findServices() {
    this._ensureIndexed();
    return this.db.query({ type: 'service' });
  }

  /**
   * Find all interfaces
   */
  findInterfaces() {
    this._ensureIndexed();
    return this.db.query({ type: 'interface' });
  }

  /**
   * Find symbols that implement a given interface
   */
  findImplementations(interfaceName) {
    this._ensureIndexed();
    return this.db.query({ implements: interfaceName });
  }

  /**
   * Find symbols that extend a given class
   */
  findSubclasses(className) {
    this._ensureIndexed();
    return this.db.query({ extends: className });
  }

  /**
   * Find all usages of a symbol (who imports it)
   */
  findUsages(symbolName) {
    this._ensureIndexed();
    const imports = this.db.query({ type: 'import' });
    return imports.filter(imp => 
      imp.namedImports?.includes(symbolName) || imp.defaultImport === symbolName
    );
  }

  /**
   * Find related files for a component (template, styles, spec)
   */
  findRelatedFiles(componentFile) {
    const baseName = componentFile.replace(/\.component\.ts$/, '');
    const related = {
      component: componentFile,
      template: null,
      styles: [],
      spec: null,
      module: null,
    };
    
    const templatePath = baseName + '.component.html';
    if (readFileSafe(path.join(this.rootDir, templatePath))) {
      related.template = templatePath;
    }
    
    const scssPath = baseName + '.component.scss';
    if (readFileSafe(path.join(this.rootDir, scssPath))) {
      related.styles.push(scssPath);
    }
    
    const specPath = baseName + '.component.spec.ts';
    if (readFileSafe(path.join(this.rootDir, specPath))) {
      related.spec = specPath;
    }
    
    return related;
  }

  /**
   * Find symbols with a specific decorator
   */
  findByDecorator(decoratorName) {
    this._ensureIndexed();
    return this.db.query({ decorator: decoratorName });
  }

  /**
   * Search symbols by regex pattern
   */
  searchByPattern(pattern) {
    this._ensureIndexed();
    const regex = new RegExp(pattern, 'i');
    return this.db.symbols.filter(s => regex.test(s.name));
  }

  /**
   * Get symbols in a specific file
   */
  getFileSymbols(filePath) {
    this._ensureIndexed();
    const normalizedPath = filePath.replace(/\\/g, '/');
    return this.db.query({ file: normalizedPath });
  }

  /**
   * Get the complete symbol database
   */
  getDatabase() {
    this._ensureIndexed();
    return this.db;
  }

  /**
   * Get database statistics
   */
  getStats() {
    this._ensureIndexed();
    return this.db.getStats();
  }

  /**
   * Export database to JSON
   */
  exportToJson() {
    this._ensureIndexed();
    return this.db.toJSON();
  }

  /**
   * Interactive search with ranking
   */
  search(query) {
    this._ensureIndexed();
    
    const results = {
      exact: [],
      startsWith: [],
      contains: [],
    };
    
    const lowerQuery = query.toLowerCase();
    
    for (const symbol of this.db.symbols) {
      if (symbol.type === 'import' || symbol.type === 'export') continue;
      
      const lowerName = symbol.name.toLowerCase();
      
      if (lowerName === lowerQuery) {
        results.exact.push(symbol);
      } else if (lowerName.startsWith(lowerQuery)) {
        results.startsWith.push(symbol);
      } else if (lowerName.includes(lowerQuery)) {
        results.contains.push(symbol);
      }
    }
    
    return [...results.exact, ...results.startsWith, ...results.contains];
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  _ensureIndexed() {
    if (!this.indexed) {
      this.buildIndex();
    }
  }
}

module.exports = { QueryEngine };

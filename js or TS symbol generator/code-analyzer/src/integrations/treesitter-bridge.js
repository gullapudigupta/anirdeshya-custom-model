/**
 * CAT-026: Tree-sitter Bridge (Optional External Tool)
 * 
 * Use tree-sitter for accurate method body extraction if npm package available.
 * Supports TypeScript, HTML, CSS grammars.
 * 
 * Falls back to regex-based extraction when tree-sitter is not installed.
 * This bridge provides accurate AST parsing when precision is needed
 * (e.g., exact method boundaries, nested class detection, complex expressions).
 * 
 * Usage:
 *   const bridge = new TreeSitterBridge(rootDir);
 *   if (bridge.isAvailable()) {
 *     const tree = bridge.parse('src/app/auth/auth.service.ts');
 *     const methods = bridge.extractMethods(tree);
 *   }
 */

const fs = require('fs');
const path = require('path');

class TreeSitterBridge {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.available = null;
    this.Parser = null;
    this.languages = {};
    this._initAttempted = false;
  }

  /**
   * Check if tree-sitter is available.
   * @returns {boolean}
   */
  isAvailable() {
    if (this.available !== null) return this.available;
    this._tryInit();
    return this.available;
  }

  /**
   * Get bridge info.
   * @returns {object}
   */
  getInfo() {
    return {
      available: this.isAvailable(),
      languages: Object.keys(this.languages),
      fallback: 'Regex-based parsing (ast-utils.js)',
      benefits: [
        'Accurate method body boundaries',
        'Nested class/function detection',
        'Complex expression parsing',
        'Template literal handling',
        'Decorator argument parsing',
      ],
    };
  }

  /**
   * Parse a file into a syntax tree.
   * @param {string} filePath - Relative or absolute path
   * @returns {object|null} Parsed tree or null if unavailable
   */
  parse(filePath) {
    if (!this.isAvailable()) return this._fallbackParse(filePath);

    const resolvedPath = this._resolvePath(filePath);
    const content = this._readFile(resolvedPath);
    if (!content) return null;

    const lang = this._detectLanguage(resolvedPath);
    const parser = this._getParser(lang);
    if (!parser) return this._fallbackParse(filePath);

    try {
      const tree = parser.parse(content);
      return {
        filePath: path.relative(this.rootDir, resolvedPath).replace(/\\/g, '/'),
        language: lang,
        rootNode: tree.rootNode,
        _tree: tree,
        _content: content,
        method: 'tree-sitter',
      };
    } catch (e) {
      return this._fallbackParse(filePath);
    }
  }

  /**
   * Extract all method bodies from a file with precise boundaries.
   * @param {string} filePath
   * @returns {Array} Methods with exact start/end lines and body content
   */
  extractMethods(filePath) {
    const parsed = this.parse(filePath);
    if (!parsed) return [];

    if (parsed.method === 'fallback') {
      return parsed.methods || [];
    }

    // Tree-sitter path
    const methods = [];
    this._walkNode(parsed.rootNode, (node) => {
      if (this._isMethodNode(node)) {
        const name = this._getMethodName(node, parsed._content);
        if (name) {
          methods.push({
            name,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            body: parsed._content.substring(node.startIndex, node.endIndex),
            kind: node.type,
            parent: this._getParentClass(node, parsed._content),
          });
        }
      }
    });

    return methods;
  }

  /**
   * Extract the body of a specific method.
   * @param {string} filePath
   * @param {string} methodName
   * @param {string} className - Optional: class containing the method
   * @returns {object|null} { name, startLine, endLine, body, parent }
   */
  extractMethodBody(filePath, methodName, className = null) {
    const methods = this.extractMethods(filePath);
    
    let match = methods.find(m => m.name === methodName);
    if (className) {
      match = methods.find(m => m.name === methodName && m.parent === className);
    }
    
    return match || null;
  }

  /**
   * Extract all class declarations with their full structure.
   * @param {string} filePath
   * @returns {Array} Classes with methods, properties, and boundaries
   */
  extractClasses(filePath) {
    const parsed = this.parse(filePath);
    if (!parsed) return [];

    if (parsed.method === 'fallback') {
      return parsed.classes || [];
    }

    const classes = [];
    this._walkNode(parsed.rootNode, (node) => {
      if (node.type === 'class_declaration' || node.type === 'abstract_class_declaration') {
        const name = this._getNodeName(node, parsed._content);
        if (name) {
          const methods = [];
          const properties = [];
          
          // Walk class body
          const body = node.childForFieldName('body');
          if (body) {
            for (const child of body.namedChildren) {
              if (this._isMethodNode(child)) {
                const mName = this._getMethodName(child, parsed._content);
                if (mName) methods.push({ name: mName, line: child.startPosition.row + 1 });
              } else if (child.type === 'public_field_definition' || child.type === 'property_declaration') {
                const pName = this._getNodeName(child, parsed._content);
                if (pName) properties.push({ name: pName, line: child.startPosition.row + 1 });
              }
            }
          }

          classes.push({
            name,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            methods,
            properties,
          });
        }
      }
    });

    return classes;
  }

  /**
   * Query the tree with a tree-sitter query pattern.
   * @param {string} filePath
   * @param {string} queryPattern - S-expression query
   * @returns {Array} Matching nodes
   */
  query(filePath, queryPattern) {
    if (!this.isAvailable()) return [];

    const parsed = this.parse(filePath);
    if (!parsed || parsed.method === 'fallback') return [];

    const lang = this._detectLanguage(this._resolvePath(filePath));
    const tsLang = this.languages[lang];
    if (!tsLang) return [];

    try {
      const query = tsLang.query(queryPattern);
      const matches = query.matches(parsed.rootNode);
      
      return matches.map(m => ({
        pattern: m.pattern,
        captures: m.captures.map(c => ({
          name: c.name,
          text: parsed._content.substring(c.node.startIndex, c.node.endIndex),
          startLine: c.node.startPosition.row + 1,
          endLine: c.node.endPosition.row + 1,
        })),
      }));
    } catch (e) {
      return [];
    }
  }

  /**
   * Get the symbol at a specific position.
   * @param {string} filePath
   * @param {number} line - 1-based
   * @param {number} column - 0-based
   * @returns {object|null}
   */
  getSymbolAtPosition(filePath, line, column) {
    const parsed = this.parse(filePath);
    if (!parsed || parsed.method === 'fallback') return null;

    const node = parsed.rootNode.descendantForPosition({ row: line - 1, column });
    if (!node) return null;

    // Walk up to find the meaningful parent
    let current = node;
    while (current && !this._isMeaningfulNode(current)) {
      current = current.parent;
    }

    if (!current) return null;

    return {
      name: this._getNodeName(current, parsed._content) || parsed._content.substring(node.startIndex, node.endIndex),
      type: current.type,
      startLine: current.startPosition.row + 1,
      endLine: current.endPosition.row + 1,
      text: parsed._content.substring(current.startIndex, current.endIndex).substring(0, 200),
    };
  }

  // ─── Private: Initialization ─────────────────────────────────────────────

  _tryInit() {
    if (this._initAttempted) return;
    this._initAttempted = true;

    try {
      // Try to load tree-sitter
      this.Parser = require('tree-sitter');
      
      // Try to load language grammars
      this._tryLoadLanguage('typescript', 'tree-sitter-typescript/typescript');
      this._tryLoadLanguage('tsx', 'tree-sitter-typescript/tsx');
      this._tryLoadLanguage('html', 'tree-sitter-html');
      this._tryLoadLanguage('css', 'tree-sitter-css');
      this._tryLoadLanguage('scss', 'tree-sitter-scss');
      this._tryLoadLanguage('javascript', 'tree-sitter-javascript');
      
      this.available = Object.keys(this.languages).length > 0;
    } catch (e) {
      this.available = false;
    }
  }

  _tryLoadLanguage(name, moduleName) {
    try {
      this.languages[name] = require(moduleName);
    } catch (e) {
      // Language grammar not installed — skip silently
    }
  }

  _getParser(lang) {
    if (!this.Parser || !this.languages[lang]) return null;
    
    const parser = new this.Parser();
    parser.setLanguage(this.languages[lang]);
    return parser;
  }

  // ─── Private: Fallback (Regex-based) ─────────────────────────────────────

  _fallbackParse(filePath) {
    const resolvedPath = this._resolvePath(filePath);
    const content = this._readFile(resolvedPath);
    if (!content) return null;

    const methods = this._fallbackExtractMethods(content);
    const classes = this._fallbackExtractClasses(content);

    return {
      filePath: path.relative(this.rootDir, resolvedPath).replace(/\\/g, '/'),
      language: this._detectLanguage(resolvedPath),
      method: 'fallback',
      methods,
      classes,
    };
  }

  _fallbackExtractMethods(content) {
    const methods = [];
    const lines = content.split('\n');
    const methodPattern = /(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:async\s+)?(?:override\s+)?(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(methodPattern);
      if (match && !['if', 'for', 'while', 'switch', 'catch', 'class', 'function'].includes(match[1])) {
        // Find the end of the method (simple brace counting)
        const endLine = this._findBlockEnd(lines, i);
        methods.push({
          name: match[1],
          startLine: i + 1,
          endLine: endLine + 1,
          body: lines.slice(i, endLine + 1).join('\n'),
          kind: 'method_definition',
          parent: this._findParentClassFallback(lines, i),
        });
      }
    }

    return methods;
  }

  _fallbackExtractClasses(content) {
    const classes = [];
    const lines = content.split('\n');
    const classPattern = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(classPattern);
      if (match) {
        const endLine = this._findBlockEnd(lines, i);
        classes.push({
          name: match[1],
          startLine: i + 1,
          endLine: endLine + 1,
          methods: [],
          properties: [],
        });
      }
    }

    return classes;
  }

  _findBlockEnd(lines, startLine) {
    let depth = 0;
    let started = false;
    
    for (let i = startLine; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth++; started = true; }
        if (ch === '}') {
          depth--;
          if (started && depth === 0) return i;
        }
      }
    }
    
    return Math.min(startLine + 50, lines.length - 1);
  }

  _findParentClassFallback(lines, lineIdx) {
    for (let i = lineIdx - 1; i >= 0; i--) {
      const match = lines[i].match(/class\s+(\w+)/);
      if (match) return match[1];
    }
    return null;
  }

  // ─── Private: Tree-sitter Helpers ────────────────────────────────────────

  _walkNode(node, callback) {
    callback(node);
    for (const child of node.namedChildren) {
      this._walkNode(child, callback);
    }
  }

  _isMethodNode(node) {
    return [
      'method_definition',
      'function_declaration',
      'arrow_function',
      'function',
      'generator_function_declaration',
    ].includes(node.type);
  }

  _isMeaningfulNode(node) {
    return [
      'class_declaration',
      'method_definition',
      'function_declaration',
      'arrow_function',
      'variable_declaration',
      'interface_declaration',
      'enum_declaration',
      'type_alias_declaration',
    ].includes(node.type);
  }

  _getMethodName(node, content) {
    // Try field name 'name'
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      return content.substring(nameNode.startIndex, nameNode.endIndex);
    }
    
    // Try first named child
    if (node.namedChildren.length > 0 && node.namedChildren[0].type === 'property_identifier') {
      return content.substring(node.namedChildren[0].startIndex, node.namedChildren[0].endIndex);
    }
    
    return null;
  }

  _getNodeName(node, content) {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      return content.substring(nameNode.startIndex, nameNode.endIndex);
    }
    return null;
  }

  _getParentClass(node, content) {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration' || current.type === 'abstract_class_declaration') {
        return this._getNodeName(current, content);
      }
      current = current.parent;
    }
    return null;
  }

  // ─── Private: Utilities ──────────────────────────────────────────────────

  _resolvePath(filePath) {
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(this.rootDir, filePath);
  }

  _readFile(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      return null;
    }
  }

  _detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.js': 'javascript',
      '.jsx': 'tsx',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
    };
    return map[ext] || 'typescript';
  }
}

module.exports = { TreeSitterBridge };

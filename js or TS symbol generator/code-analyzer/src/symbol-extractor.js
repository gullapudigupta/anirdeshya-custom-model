/**
 * Symbol Extractor — Core engine for extracting all code symbols
 * 
 * Extracts:
 * - Classes (Components, Services, Directives, Pipes, Guards, Interceptors)
 * - Interfaces & Type Aliases
 * - Functions & Arrow Functions
 * - Methods & Properties
 * - Enums
 * - Imports & Exports
 * - Angular Decorators with metadata
 * - Lifecycle Hooks
 * - Input/Output bindings
 */

const fs = require('fs');
const path = require('path');
const { TokenType, PATTERNS, readFileSafe, getLineNumber, stripComments, extractBlock } = require('./ast-utils');

// ─── Symbol Database ─────────────────────────────────────────────────────────

class SymbolDatabase {
  constructor() {
    this.symbols = [];
    this.fileIndex = new Map(); // filePath -> symbols[]
    this.typeIndex = new Map(); // type -> symbols[]
    this.nameIndex = new Map(); // name -> symbols[]
  }

  add(symbol) {
    this.symbols.push(symbol);
    
    // Index by file
    if (!this.fileIndex.has(symbol.file)) {
      this.fileIndex.set(symbol.file, []);
    }
    this.fileIndex.get(symbol.file).push(symbol);
    
    // Index by type
    if (!this.typeIndex.has(symbol.type)) {
      this.typeIndex.set(symbol.type, []);
    }
    this.typeIndex.get(symbol.type).push(symbol);
    
    // Index by name
    const lowerName = symbol.name.toLowerCase();
    if (!this.nameIndex.has(lowerName)) {
      this.nameIndex.set(lowerName, []);
    }
    this.nameIndex.get(lowerName).push(symbol);
  }

  query(filter) {
    let results = [...this.symbols];
    
    if (filter.type) {
      results = results.filter(s => s.type === filter.type);
    }
    if (filter.name) {
      const pattern = filter.name.toLowerCase();
      results = results.filter(s => s.name.toLowerCase().includes(pattern));
    }
    if (filter.file) {
      const pattern = filter.file.toLowerCase();
      results = results.filter(s => s.file.toLowerCase().includes(pattern));
    }
    if (filter.decorator) {
      results = results.filter(s => s.decorators && s.decorators.includes(filter.decorator));
    }
    if (filter.extends) {
      results = results.filter(s => s.extends === filter.extends);
    }
    if (filter.implements) {
      results = results.filter(s => s.implements && s.implements.includes(filter.implements));
    }
    
    return results;
  }

  getStats() {
    return {
      totalSymbols: this.symbols.length,
      files: this.fileIndex.size,
      byType: Object.fromEntries(
        Array.from(this.typeIndex.entries()).map(([k, v]) => [k, v.length])
      ),
    };
  }

  toJSON() {
    return {
      stats: this.getStats(),
      symbols: this.symbols,
    };
  }
}

// ─── Extractor ───────────────────────────────────────────────────────────────

class SymbolExtractor {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.db = new SymbolDatabase();
  }

  /**
   * Extract all symbols from a TypeScript/JavaScript file
   */
  extractFromFile(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return;

    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    
    // Extract decorators first (they apply to the next class)
    const decoratorMap = this._extractDecorators(content, relativePath);
    
    // Extract classes
    this._extractClasses(content, relativePath, decoratorMap);
    
    // Extract interfaces
    this._extractInterfaces(content, relativePath);
    
    // Extract enums
    this._extractEnums(content, relativePath);
    
    // Extract standalone functions
    this._extractFunctions(content, relativePath);
    
    // Extract arrow functions (exported)
    this._extractArrowFunctions(content, relativePath);
    
    // Extract type aliases
    this._extractTypeAliases(content, relativePath);
    
    // Extract imports
    this._extractImports(content, relativePath);
    
    // Extract exports
    this._extractExports(content, relativePath);
  }

  /**
   * Extract Angular decorators and their metadata
   */
  _extractDecorators(content, filePath) {
    const decoratorMap = new Map(); // position -> decorator info
    const regex = new RegExp(PATTERNS.decorator.source, PATTERNS.decorator.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      const args = match[2];
      const line = getLineNumber(content, match.index);
      
      decoratorMap.set(match.index, {
        name,
        args: args.trim(),
        line,
        endPos: match.index + match[0].length,
      });
    }

    return decoratorMap;
  }

  /**
   * Extract class declarations with their Angular classification
   */
  _extractClasses(content, filePath, decoratorMap) {
    const regex = new RegExp(PATTERNS.classDecl.source, PATTERNS.classDecl.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const className = match[1];
      const extendsClass = match[2] || null;
      const implementsList = match[3] ? match[3].split(',').map(s => s.trim()) : [];
      const line = getLineNumber(content, match.index);
      
      // Determine Angular type from decorators
      let angularType = TokenType.CLASS;
      const decorators = [];
      let metadata = {};

      for (const [pos, dec] of decoratorMap.entries()) {
        // Check if decorator is right before this class (within 200 chars)
        if (dec.endPos <= match.index && match.index - dec.endPos < 200) {
          decorators.push(dec.name);
          
          if (dec.name === 'Component') {
            angularType = TokenType.COMPONENT;
            metadata = this._parseComponentMeta(dec.args);
          } else if (dec.name === 'Injectable') {
            angularType = TokenType.SERVICE;
          } else if (dec.name === 'Pipe') {
            angularType = TokenType.PIPE;
            metadata = this._parsePipeMeta(dec.args);
          } else if (dec.name === 'Directive') {
            angularType = TokenType.DIRECTIVE;
            metadata = this._parseDirectiveMeta(dec.args);
          } else if (dec.name === 'NgModule') {
            angularType = TokenType.MODULE;
          }
        }
      }

      // Additional classification by naming convention
      if (angularType === TokenType.CLASS || angularType === TokenType.SERVICE) {
        if (className.endsWith('Guard')) angularType = TokenType.GUARD;
        else if (className.endsWith('Interceptor')) angularType = TokenType.INTERCEPTOR;
        else if (className.endsWith('Resolver')) angularType = TokenType.RESOLVER;
      }

      // Extract class body for methods/properties
      const blockStart = content.indexOf('{', match.index);
      const classBody = extractBlock(content, blockStart);
      const methods = this._extractMethods(classBody, className, filePath, line);
      const properties = this._extractProperties(classBody, className, filePath, line);
      const lifecycleHooks = this._extractLifecycleHooks(classBody);
      const inputs = this._extractInputs(classBody);
      const outputs = this._extractOutputs(classBody);

      this.db.add({
        type: angularType,
        name: className,
        file: filePath,
        line,
        extends: extendsClass,
        implements: implementsList,
        decorators,
        metadata,
        methods: methods.map(m => m.name),
        properties: properties.map(p => p.name),
        lifecycleHooks,
        inputs,
        outputs,
        methodCount: methods.length,
        propertyCount: properties.length,
        linesOfCode: classBody.split('\n').length,
      });

      // Add individual methods as symbols
      for (const method of methods) {
        this.db.add({
          type: TokenType.METHOD,
          name: method.name,
          file: filePath,
          line: line + method.relativeLine,
          parentClass: className,
          visibility: method.visibility,
          isAsync: method.isAsync,
          isStatic: method.isStatic,
          parameters: method.parameters,
          returnType: method.returnType,
        });
      }
    }
  }

  /**
   * Extract methods from a class body
   */
  _extractMethods(classBody, className, filePath, classStartLine) {
    const methods = [];
    const lines = classBody.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines, comments, decorators, property declarations
      if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('@')) continue;
      
      // Match method patterns
      const methodMatch = line.match(
        /^(public|private|protected)?\s*(static)?\s*(async)?\s*(?:override\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{]+))?\s*\{?$/
      );
      
      if (methodMatch && methodMatch[4] !== 'constructor' && !line.includes('=') && !line.endsWith(';')) {
        methods.push({
          name: methodMatch[4],
          visibility: methodMatch[1] || 'public',
          isStatic: !!methodMatch[2],
          isAsync: !!methodMatch[3],
          parameters: methodMatch[5] ? methodMatch[5].trim() : '',
          returnType: methodMatch[6] ? methodMatch[6].trim() : 'void',
          relativeLine: i,
        });
      }
      
      // Constructor
      if (line.startsWith('constructor(') || line.match(/^\s*(public|private|protected)?\s*constructor\s*\(/)) {
        methods.push({
          name: 'constructor',
          visibility: 'public',
          isStatic: false,
          isAsync: false,
          parameters: '',
          returnType: '',
          relativeLine: i,
        });
      }
    }
    
    return methods;
  }

  /**
   * Extract properties from a class body
   */
  _extractProperties(classBody, className, filePath, classStartLine) {
    const properties = [];
    const lines = classBody.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      const propMatch = line.match(
        /^(?:@\w+\([^)]*\)\s*)?(public|private|protected)?\s*(static)?\s*(readonly)?\s*(\w+)\s*[?!]?\s*(?::\s*([^;=]+))?(?:\s*=\s*([^;]+))?;$/
      );
      
      if (propMatch && propMatch[4] && !propMatch[4].match(/^(if|for|while|switch|return|class|interface|function)$/)) {
        properties.push({
          name: propMatch[4],
          visibility: propMatch[1] || 'public',
          isStatic: !!propMatch[2],
          isReadonly: !!propMatch[3],
          type: propMatch[5] ? propMatch[5].trim() : 'any',
          relativeLine: i,
        });
      }
    }
    
    return properties;
  }

  /**
   * Extract lifecycle hooks from class body
   */
  _extractLifecycleHooks(classBody) {
    const hooks = [];
    const hookNames = ['ngOnInit', 'ngOnDestroy', 'ngOnChanges', 'ngAfterViewInit', 
                       'ngAfterContentInit', 'ngDoCheck', 'ngAfterViewChecked', 'ngAfterContentChecked'];
    
    for (const hook of hookNames) {
      if (classBody.includes(hook + '(')) {
        hooks.push(hook);
      }
    }
    
    return hooks;
  }

  /**
   * Extract @Input() properties
   */
  _extractInputs(classBody) {
    const inputs = [];
    const regex = /@Input\s*\([^)]*\)\s*(?:set\s+)?(\w+)/g;
    let match;
    
    while ((match = regex.exec(classBody)) !== null) {
      inputs.push(match[1]);
    }
    
    // Also check for input() signal syntax (Angular 17+)
    const signalRegex = /(\w+)\s*=\s*input(?:\.required)?\s*[<(]/g;
    while ((match = signalRegex.exec(classBody)) !== null) {
      inputs.push(match[1]);
    }
    
    return inputs;
  }

  /**
   * Extract @Output() properties
   */
  _extractOutputs(classBody) {
    const outputs = [];
    const regex = /@Output\s*\([^)]*\)\s*(\w+)/g;
    let match;
    
    while ((match = regex.exec(classBody)) !== null) {
      outputs.push(match[1]);
    }
    
    // Also check for output() signal syntax
    const signalRegex = /(\w+)\s*=\s*output\s*[<(]/g;
    while ((match = signalRegex.exec(classBody)) !== null) {
      outputs.push(match[1]);
    }
    
    return outputs;
  }

  /**
   * Parse @Component metadata
   */
  _parseComponentMeta(args) {
    const meta = {};
    
    const selectorMatch = args.match(/selector\s*:\s*['"](.*?)['"]/);
    if (selectorMatch) meta.selector = selectorMatch[1];
    
    const templateUrlMatch = args.match(/templateUrl\s*:\s*['"](.*?)['"]/);
    if (templateUrlMatch) meta.templateUrl = templateUrlMatch[1];
    
    const styleUrlsMatch = args.match(/styleUrls?\s*:\s*\[(.*?)\]/s);
    if (styleUrlsMatch) meta.styleUrls = styleUrlsMatch[1].replace(/['"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
    
    const standaloneMatch = args.match(/standalone\s*:\s*(true|false)/);
    if (standaloneMatch) meta.standalone = standaloneMatch[1] === 'true';
    
    const changeDetectionMatch = args.match(/changeDetection\s*:\s*ChangeDetectionStrategy\.(\w+)/);
    if (changeDetectionMatch) meta.changeDetection = changeDetectionMatch[1];
    
    return meta;
  }

  /**
   * Parse @Pipe metadata
   */
  _parsePipeMeta(args) {
    const meta = {};
    const nameMatch = args.match(/name\s*:\s*['"](.*?)['"]/);
    if (nameMatch) meta.pipeName = nameMatch[1];
    
    const standaloneMatch = args.match(/standalone\s*:\s*(true|false)/);
    if (standaloneMatch) meta.standalone = standaloneMatch[1] === 'true';
    
    return meta;
  }

  /**
   * Parse @Directive metadata
   */
  _parseDirectiveMeta(args) {
    const meta = {};
    const selectorMatch = args.match(/selector\s*:\s*['"]\[?(.*?)\]?['"]/);
    if (selectorMatch) meta.selector = selectorMatch[1];
    
    return meta;
  }

  /**
   * Extract interfaces
   */
  _extractInterfaces(content, filePath) {
    const regex = new RegExp(PATTERNS.interfaceDecl.source, PATTERNS.interfaceDecl.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      this.db.add({
        type: TokenType.INTERFACE,
        name: match[1],
        file: filePath,
        line,
        extends: match[2] ? match[2].split(',').map(s => s.trim()) : [],
      });
    }
  }

  /**
   * Extract enums
   */
  _extractEnums(content, filePath) {
    const regex = new RegExp(PATTERNS.enumDecl.source, PATTERNS.enumDecl.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      const blockStart = content.indexOf('{', match.index);
      const block = extractBlock(content, blockStart);
      const members = block.replace(/[{}]/g, '').split(',').map(s => s.trim().split(/\s*=/)[0]).filter(Boolean);
      
      this.db.add({
        type: TokenType.ENUM,
        name: match[1],
        file: filePath,
        line,
        members,
      });
    }
  }

  /**
   * Extract standalone functions
   */
  _extractFunctions(content, filePath) {
    const regex = new RegExp(PATTERNS.functionDecl.source, PATTERNS.functionDecl.flags);
    let match;
    const strippedContent = stripComments(content);

    while ((match = regex.exec(strippedContent)) !== null) {
      const line = getLineNumber(content, match.index);
      this.db.add({
        type: TokenType.FUNCTION,
        name: match[1],
        file: filePath,
        line,
        parameters: match[2] ? match[2].trim() : '',
        returnType: match[3] ? match[3].trim() : 'void',
      });
    }
  }

  /**
   * Extract exported arrow functions
   */
  _extractArrowFunctions(content, filePath) {
    const regex = new RegExp(PATTERNS.arrowFunction.source, PATTERNS.arrowFunction.flags);
    let match;
    const strippedContent = stripComments(content);

    while ((match = regex.exec(strippedContent)) !== null) {
      // Skip if it's inside a class (indented)
      const lineStart = strippedContent.lastIndexOf('\n', match.index);
      const indent = match.index - lineStart - 1;
      if (indent > 4) continue;
      
      const line = getLineNumber(content, match.index);
      this.db.add({
        type: TokenType.FUNCTION,
        name: match[1],
        file: filePath,
        line,
        parameters: match[2] ? match[2].trim() : '',
        isArrow: true,
      });
    }
  }

  /**
   * Extract type aliases
   */
  _extractTypeAliases(content, filePath) {
    const regex = new RegExp(PATTERNS.typeAlias.source, PATTERNS.typeAlias.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      this.db.add({
        type: TokenType.TYPE_ALIAS,
        name: match[1],
        file: filePath,
        line,
        definition: match[2].trim().substring(0, 100),
      });
    }
  }

  /**
   * Extract imports
   */
  _extractImports(content, filePath) {
    const regex = new RegExp(PATTERNS.importDecl.source, PATTERNS.importDecl.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const namedImports = match[1] ? match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()) : [];
      const defaultImport = match[2] || null;
      const additionalNamed = match[3] ? match[3].split(',').map(s => s.trim()) : [];
      const source = match[4];
      const line = getLineNumber(content, match.index);

      this.db.add({
        type: TokenType.IMPORT,
        name: source,
        file: filePath,
        line,
        namedImports: [...namedImports, ...additionalNamed].filter(Boolean),
        defaultImport,
        source,
        isRelative: source.startsWith('.'),
      });
    }
  }

  /**
   * Extract exports
   */
  _extractExports(content, filePath) {
    const regex = new RegExp(PATTERNS.exportDecl.source, PATTERNS.exportDecl.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const line = getLineNumber(content, match.index);
      this.db.add({
        type: TokenType.EXPORT,
        name: match[1],
        file: filePath,
        line,
      });
    }
  }

  /**
   * Get the symbol database
   */
  getDatabase() {
    return this.db;
  }
}

module.exports = { SymbolExtractor, SymbolDatabase };

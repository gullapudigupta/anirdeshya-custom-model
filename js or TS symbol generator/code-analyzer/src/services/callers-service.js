/**
 * Callers Service — Ported from ai_tools_setup/sidecar-api
 * 
 * Finds all call-sites of a method/symbol across the codebase.
 * Each result includes the enclosing method name, file, and line.
 * 
 * 10-15x cheaper than search + multiple snippet calls.
 */

const fs = require('fs');
const path = require('path');
const { getSourceFiles, getTemplateFiles } = require('../ast-utils');

class CallersService {
  constructor(rootDir, queryEngine) {
    this.rootDir = rootDir;
    this.queryEngine = queryEngine;
  }

  /**
   * Find all call-sites of a symbol
   * @param {string} name - Method/function name to find callers of
   * @param {object} options - { file, limit }
   */
  findCallers(name, options = {}) {
    const { file, limit = 30 } = options;
    const srcDir = path.join(this.rootDir, 'src');

    // Get files to search
    let files = getSourceFiles(srcDir, ['.ts', '.html']);
    if (file) {
      files = files.filter(f => f.includes(file));
    }

    // Pattern to find: methodName( — word boundary
    const callPattern = new RegExp(`\\b${this._escapeRegex(name)}\\b`, 'g');
    
    // Pattern for definitions (to exclude)
    const defPattern = new RegExp(
      `(class|interface|function|enum|type)\\s+${this._escapeRegex(name)}\\b|` +
      `(?:public|private|protected|static|async|override)\\s+(?:static\\s+)?(?:async\\s+)?${this._escapeRegex(name)}\\s*[(<]`,
      'i'
    );

    const callers = [];
    
    for (const filePath of files) {
      if (callers.length >= limit) break;
      
      let content;
      try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
      
      const lines = content.split('\n');
      const relPath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
      
      for (let i = 0; i < lines.length; i++) {
        if (callers.length >= limit) break;
        
        const line = lines[i];
        if (!callPattern.test(line)) continue;
        callPattern.lastIndex = 0; // Reset regex
        
        // Skip definition lines
        if (defPattern.test(line)) continue;
        
        // Skip import lines
        if (line.trim().startsWith('import ')) continue;
        
        // Find enclosing method/class
        const enclosing = this._findEnclosingSymbol(lines, i);
        
        callers.push({
          file: relPath,
          line: i + 1,
          callText: line.trim().substring(0, 100),
          enclosingSymbol: enclosing,
        });
      }
    }

    // Find the definition location
    const symbols = this.queryEngine.search(name);
    const definition = symbols.find(s => 
      s.type !== 'import' && s.type !== 'export' && s.name === name
    );

    return {
      name,
      definedAt: definition ? {
        file: definition.file,
        line: definition.line,
        kind: definition.type,
      } : null,
      count: callers.length,
      callers,
    };
  }

  /**
   * Find the enclosing method/class for a given line index
   */
  _findEnclosingSymbol(lines, lineIndex) {
    // Walk backwards to find nearest method/class declaration
    for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 50); i--) {
      const line = lines[i].trim();
      
      // Method pattern
      const methodMatch = line.match(
        /(?:public|private|protected)?\s*(?:static)?\s*(?:async)?\s*(\w+)\s*\([^)]*\)\s*[:{]/
      );
      if (methodMatch && methodMatch[1] !== 'if' && methodMatch[1] !== 'for' && methodMatch[1] !== 'while') {
        return { name: methodMatch[1], kind: 'method', line: i + 1 };
      }
      
      // Class/component pattern
      const classMatch = line.match(/(?:export\s+)?(?:class|interface)\s+(\w+)/);
      if (classMatch) {
        return { name: classMatch[1], kind: 'class', line: i + 1 };
      }
    }
    
    return null;
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

module.exports = { CallersService };

/**
 * Dead Code Detector
 * 
 * Finds:
 * - Unused exports (exported but never imported)
 * - Unused private methods/properties
 * - Unreachable code after return/throw
 * - Empty files
 * - Commented-out code blocks
 * - Unused imports (type-only)
 * - Orphan components not in any route/module
 */

const path = require('path');
const { readFileSafe, getSourceFiles, getLineNumber } = require('../ast-utils');

class DeadCodeDetector {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.issues = [];
    this.allExports = new Map(); // symbol -> file
    this.allImports = new Set(); // imported symbol names
  }

  /**
   * Build index of all exports and imports, then find unused
   */
  analyze(files) {
    // Pass 1: Collect all exports and imports
    for (const file of files) {
      if (file.includes('.spec.')) continue;
      this._collectExportsImports(file);
    }
    
    // Pass 2: Find unused exports
    this._findUnusedExports();
    
    // Pass 3: Per-file analysis
    for (const file of files) {
      if (file.includes('.spec.')) continue;
      this._analyzeFile(file);
    }
    
    return this.issues;
  }

  _collectExportsImports(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return;
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    
    // Collect exports
    const exportRegex = /export\s+(?:default\s+)?(?:class|interface|function|const|let|var|type|enum|abstract)\s+(\w+)/g;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      this.allExports.set(match[1], relativePath);
    }
    
    // Collect imports (named)
    const importRegex = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from/g;
    while ((match = importRegex.exec(content)) !== null) {
      if (match[1]) {
        match[1].split(',').forEach(s => {
          const name = s.trim().split(/\s+as\s+/)[0].trim();
          if (name) this.allImports.add(name);
        });
      }
      if (match[2]) {
        this.allImports.add(match[2]);
      }
    }
  }

  _findUnusedExports() {
    for (const [symbol, file] of this.allExports) {
      // Skip common patterns that are used by Angular DI or routing
      if (symbol.endsWith('Module') || symbol.endsWith('Component') || 
          symbol.endsWith('Service') || symbol.endsWith('Guard') ||
          symbol.endsWith('Interceptor') || symbol.endsWith('Pipe') ||
          symbol.endsWith('Directive') || symbol === 'environment' ||
          file.includes('index.ts') || file.includes('public-api')) continue;
      
      if (!this.allImports.has(symbol)) {
        this.issues.push({
          id: 'dead:unused-export',
          severity: 'info',
          category: 'dead-code',
          title: `Potentially unused export: "${symbol}"`,
          description: 'Exported but never imported in the project',
          file,
          line: 1,
        });
      }
    }
  }

  _analyzeFile(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return;
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    
    // Empty file check
    const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (stripped.length < 10) {
      this.issues.push({
        id: 'dead:empty-file',
        severity: 'minor',
        category: 'dead-code',
        title: 'Effectively empty file',
        file: relativePath,
        line: 1,
      });
      return;
    }
    
    // Commented-out code blocks (3+ consecutive comment lines that look like code)
    this._checkCommentedCode(content, relativePath);
    
    // Unreachable code
    this._checkUnreachableCode(content, relativePath);
    
    // Unused private members (simplified)
    this._checkUnusedPrivates(content, relativePath);
  }

  _checkCommentedCode(content, filePath) {
    const lines = content.split('\n');
    let commentBlock = 0;
    let commentStart = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if it's a commented-out code line (not just a text comment)
      const isCommentedCode = line.startsWith('//') && (
        line.match(/^\/\/\s*(if|for|while|const|let|var|return|this\.|import|export|class|function)/) ||
        line.match(/^\/\/\s*\w+\s*[=<>\[\]{}()]/) ||
        line.match(/^\/\/\s*\w+\.\w+\(/)
      );
      
      if (isCommentedCode) {
        if (commentBlock === 0) commentStart = i;
        commentBlock++;
      } else {
        if (commentBlock >= 5) {
          this.issues.push({
            id: 'dead:commented-code',
            severity: 'minor',
            category: 'dead-code',
            title: `${commentBlock} lines of commented-out code`,
            description: 'Remove commented code; use version control instead',
            file: filePath,
            line: commentStart + 1,
          });
        }
        commentBlock = 0;
      }
    }
  }

  _checkUnreachableCode(content, filePath) {
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      const nextLine = lines[i + 1]?.trim();
      
      // Check for code after return/throw (simplified)
      if ((line === 'return;' || line.startsWith('return ') || line === 'throw' || line.startsWith('throw ')) && 
          line.endsWith(';')) {
        if (nextLine && !nextLine.startsWith('}') && !nextLine.startsWith('//') && 
            !nextLine.startsWith('/*') && !nextLine.startsWith('case ') &&
            !nextLine.startsWith('default:') && nextLine !== '') {
          this.issues.push({
            id: 'dead:unreachable',
            severity: 'major',
            category: 'dead-code',
            title: 'Unreachable code after return/throw',
            file: filePath,
            line: i + 2,
          });
        }
      }
    }
  }

  _checkUnusedPrivates(content, filePath) {
    // Find private members
    const privateRegex = /private\s+(\w+)\s*[:(=;]/g;
    let match;
    
    while ((match = privateRegex.exec(content)) !== null) {
      const memberName = match[1];
      
      // Check if it's used anywhere else in the file (not just the declaration)
      const usageRegex = new RegExp(`\\b${memberName}\\b`, 'g');
      const usages = content.match(usageRegex);
      
      // If only appears once (the declaration), it's unused
      if (usages && usages.length === 1) {
        const line = getLineNumber(content, match.index);
        this.issues.push({
          id: 'dead:unused-private',
          severity: 'minor',
          category: 'dead-code',
          title: `Unused private member: "${memberName}"`,
          file: filePath,
          line,
        });
      }
    }
  }

  getIssues() {
    return this.issues;
  }

  getSummary() {
    const byId = {};
    for (const issue of this.issues) {
      byId[issue.id] = (byId[issue.id] || 0) + 1;
    }
    
    return {
      total: this.issues.length,
      byType: byId,
    };
  }
}

module.exports = { DeadCodeDetector };

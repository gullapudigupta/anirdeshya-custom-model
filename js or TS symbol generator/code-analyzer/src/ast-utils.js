/**
 * AST Utilities - TypeScript/JavaScript AST parsing without external dependencies
 * Uses regex-based parsing for zero-dependency operation
 * 
 * Provides:
 * - Token extraction from TypeScript/JavaScript files
 * - Pattern matching for Angular decorators
 * - Import/export parsing
 * - Function/class/interface extraction
 */

const fs = require('fs');
const path = require('path');

// ─── Token Types ─────────────────────────────────────────────────────────────

const TokenType = {
  CLASS: 'class',
  INTERFACE: 'interface',
  ENUM: 'enum',
  FUNCTION: 'function',
  METHOD: 'method',
  PROPERTY: 'property',
  DECORATOR: 'decorator',
  IMPORT: 'import',
  EXPORT: 'export',
  TYPE_ALIAS: 'typeAlias',
  VARIABLE: 'variable',
  PIPE: 'pipe',
  DIRECTIVE: 'directive',
  COMPONENT: 'component',
  SERVICE: 'service',
  MODULE: 'module',
  GUARD: 'guard',
  INTERCEPTOR: 'interceptor',
  RESOLVER: 'resolver',
};

// ─── Regex Patterns ──────────────────────────────────────────────────────────

const PATTERNS = {
  // Class detection
  classDecl: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/g,
  
  // Interface detection
  interfaceDecl: /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?\s*\{/g,
  
  // Enum detection
  enumDecl: /(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/g,
  
  // Function detection (standalone)
  functionDecl: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{]+))?\s*\{/g,
  
  // Arrow function (const/let/var)
  arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\(?([^)]*)\)?\s*(?::\s*[^=]+)?\s*=>/g,
  
  // Method detection (inside class)
  methodDecl: /(?:(?:public|private|protected|static|async|abstract|override)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{;]+))?\s*[\{;]/g,
  
  // Property detection
  propertyDecl: /(?:(?:public|private|protected|static|readonly|override|abstract)\s+)+(\w+)(?:\s*[?!]?\s*:\s*([^;=]+))?(?:\s*=\s*([^;]+))?;/g,
  
  // Decorator detection
  decorator: /@(\w+)\s*\(([^)]*(?:\{[^}]*\}[^)]*)*)\)/gs,
  
  // Import detection
  importDecl: /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+['"](.*?)['"]/g,
  
  // Export detection  
  exportDecl: /export\s+(?:default\s+)?(?:class|interface|function|const|let|var|type|enum|abstract)\s+(\w+)/g,
  
  // Type alias
  typeAlias: /(?:export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=\s*([^;]+);/g,
  
  // Angular Component decorator
  componentDecorator: /@Component\s*\(\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\)/gs,
  
  // Angular Injectable decorator
  injectableDecorator: /@Injectable\s*\(\s*\{([^}]*)\}\s*\)/g,
  
  // Angular Pipe decorator
  pipeDecorator: /@Pipe\s*\(\s*\{([^}]*)\}\s*\)/g,
  
  // Angular Directive decorator
  directiveDecorator: /@Directive\s*\(\s*\{([^}]*)\}\s*\)/g,
  
  // Angular NgModule decorator
  ngModuleDecorator: /@NgModule\s*\(\s*\{([^}]*(?:\[[^\]]*\][^}]*)*)\}\s*\)/gs,
  
  // Lifecycle hooks
  lifecycleHook: /(?:ngOnInit|ngOnDestroy|ngOnChanges|ngAfterViewInit|ngAfterContentInit|ngDoCheck|ngAfterViewChecked|ngAfterContentChecked)\s*\(/g,
  
  // Subscription patterns
  subscriptionPattern: /\.subscribe\s*\(/g,
  
  // Input/Output decorators
  inputDecorator: /@Input\s*\(\s*(?:[^)]*)\s*\)/g,
  outputDecorator: /@Output\s*\(\s*(?:[^)]*)\s*\)/g,
  
  // ViewChild/ContentChild
  viewChild: /@ViewChild\s*\(\s*([^)]+)\s*\)/g,
  contentChild: /@ContentChild\s*\(\s*([^)]+)\s*\)/g,
};

// ─── File Utilities ──────────────────────────────────────────────────────────

/**
 * Read a file safely
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return null;
  }
}

/**
 * Get all TypeScript/JavaScript files recursively
 */
function getSourceFiles(dir, extensions = ['.ts', '.js'], ignore = ['node_modules', 'dist', 'www', '.angular', '.git']) {
  const results = [];
  
  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        if (!ignore.includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }
  
  walk(dir);
  return results;
}

/**
 * Get SCSS/CSS files recursively
 */
function getStyleFiles(dir) {
  return getSourceFiles(dir, ['.scss', '.css', '.sass']);
}

/**
 * Get HTML template files recursively
 */
function getTemplateFiles(dir) {
  return getSourceFiles(dir, ['.html']);
}

/**
 * Count lines in content
 */
function countLines(content) {
  return content.split('\n').length;
}

/**
 * Get line number for a character position
 */
function getLineNumber(content, position) {
  return content.substring(0, position).split('\n').length;
}

/**
 * Strip comments from source code
 */
function stripComments(content) {
  // Remove single-line comments
  let result = content.replace(/\/\/.*$/gm, '');
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

/**
 * Count comment lines
 */
function countCommentLines(content) {
  let count = 0;
  const lines = content.split('\n');
  let inMultiline = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (inMultiline) {
      count++;
      if (trimmed.includes('*/')) inMultiline = false;
    } else if (trimmed.startsWith('//')) {
      count++;
    } else if (trimmed.startsWith('/*')) {
      count++;
      if (!trimmed.includes('*/')) inMultiline = true;
    }
  }
  
  return count;
}

/**
 * Extract the body of a brace-delimited block starting from a position
 */
function extractBlock(content, startPos) {
  let depth = 0;
  let i = startPos;
  let started = false;
  
  while (i < content.length) {
    if (content[i] === '{') {
      depth++;
      started = true;
    } else if (content[i] === '}') {
      depth--;
      if (started && depth === 0) {
        return content.substring(startPos, i + 1);
      }
    }
    i++;
  }
  
  return content.substring(startPos);
}

module.exports = {
  TokenType,
  PATTERNS,
  readFileSafe,
  getSourceFiles,
  getStyleFiles,
  getTemplateFiles,
  countLines,
  getLineNumber,
  stripComments,
  countCommentLines,
  extractBlock,
};

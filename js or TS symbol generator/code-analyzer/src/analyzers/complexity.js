/**
 * Complexity Metrics Calculator
 * 
 * Implements:
 * - Cyclomatic Complexity (McCabe)
 * - Cognitive Complexity (SonarQube-style)
 * - Lines of Code metrics (LOC, SLOC, comment lines, blank lines)
 * - Method length analysis
 * - Halstead metrics (simplified)
 * - Maintainability Index
 */

const { readFileSafe, countLines, countCommentLines, stripComments } = require('../ast-utils');

// ─── Cyclomatic Complexity ───────────────────────────────────────────────────

/**
 * Calculate cyclomatic complexity for a code block
 * Counts decision points: if, else if, while, for, case, catch, &&, ||, ?, ??
 */
function calculateCyclomaticComplexity(code) {
  const stripped = stripComments(code);
  let complexity = 1; // Base complexity
  
  const decisionPatterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bwhile\s*\(/g,
    /\bfor\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\?\s*(?!\.)/g,     // Ternary (not optional chaining)
    /&&/g,
    /\|\|/g,
    /\?\?/g,           // Nullish coalescing
  ];
  
  for (const pattern of decisionPatterns) {
    const matches = stripped.match(pattern);
    if (matches) complexity += matches.length;
  }
  
  return complexity;
}

// ─── Cognitive Complexity ────────────────────────────────────────────────────

/**
 * Calculate cognitive complexity (SonarQube algorithm)
 * Penalties for:
 * - Nesting (incrementing per level)
 * - Structural breaks (if, else, for, while, switch, catch)
 * - Boolean sequences (&&, ||)
 */
function calculateCognitiveComplexity(code) {
  const lines = code.split('\n');
  let complexity = 0;
  let nestingLevel = 0;
  let inMultilineComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Handle multi-line comments
    if (inMultilineComment) {
      if (trimmed.includes('*/')) inMultilineComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inMultilineComment = true;
      continue;
    }
    if (trimmed.startsWith('//')) continue;
    
    // Count opening/closing braces for nesting
    const opens = (trimmed.match(/\{/g) || []).length;
    const closes = (trimmed.match(/\}/g) || []).length;
    
    // Structural increments (adds 1 + nesting penalty)
    if (trimmed.match(/^\s*(if|else\s+if)\s*\(/)) {
      complexity += 1 + nestingLevel;
    } else if (trimmed.match(/^\s*else\s*\{?$/)) {
      complexity += 1; // else doesn't get nesting penalty
    } else if (trimmed.match(/^\s*(for|while|do)\s*[\({]/)) {
      complexity += 1 + nestingLevel;
    } else if (trimmed.match(/^\s*switch\s*\(/)) {
      complexity += 1 + nestingLevel;
    } else if (trimmed.match(/^\s*catch\s*\(/)) {
      complexity += 1 + nestingLevel;
    }
    
    // Boolean sequence increments
    const logicalOps = (trimmed.match(/&&|\|\|/g) || []).length;
    if (logicalOps > 0) {
      complexity += logicalOps;
    }
    
    // Ternary operators
    const ternaries = (trimmed.match(/\?\s*(?![\.\[])/g) || []).length;
    complexity += ternaries;
    
    // Recursion (calling same function)
    // (simplified - would need function context)
    
    nestingLevel += opens - closes;
    if (nestingLevel < 0) nestingLevel = 0;
  }
  
  return complexity;
}

// ─── Lines of Code Metrics ──────────────────────────────────────────────────

/**
 * Calculate detailed LOC metrics for a file
 */
function calculateLOCMetrics(content) {
  const lines = content.split('\n');
  const totalLines = lines.length;
  let blankLines = 0;
  let commentLines = 0;
  let codeLines = 0;
  let inMultiline = false;

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (!trimmed) {
      blankLines++;
    } else if (inMultiline) {
      commentLines++;
      if (trimmed.includes('*/')) inMultiline = false;
    } else if (trimmed.startsWith('//')) {
      commentLines++;
    } else if (trimmed.startsWith('/*')) {
      commentLines++;
      if (!trimmed.includes('*/')) inMultiline = true;
    } else {
      codeLines++;
    }
  }

  return {
    totalLines,
    codeLines,
    commentLines,
    blankLines,
    commentRatio: totalLines > 0 ? (commentLines / totalLines * 100).toFixed(1) : 0,
    density: totalLines > 0 ? (codeLines / totalLines * 100).toFixed(1) : 0,
  };
}

// ─── Method Length Analysis ──────────────────────────────────────────────────

/**
 * Extract methods and their lengths from a file
 */
function analyzeMethodLengths(content) {
  const methods = [];
  const lines = content.split('\n');
  let currentMethod = null;
  let braceDepth = 0;
  let methodStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Detect method start
    const methodMatch = trimmed.match(
      /^(?:public|private|protected)?\s*(?:static)?\s*(?:async)?\s*(\w+)\s*\([^)]*\).*\{/
    );
    const functionMatch = trimmed.match(
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\).*\{/
    );
    
    if ((methodMatch || functionMatch) && !currentMethod) {
      currentMethod = (methodMatch && methodMatch[1]) || (functionMatch && functionMatch[1]);
      methodStart = i;
      braceDepth = 0;
    }
    
    // Track braces
    if (currentMethod) {
      braceDepth += (trimmed.match(/\{/g) || []).length;
      braceDepth -= (trimmed.match(/\}/g) || []).length;
      
      if (braceDepth <= 0 && i > methodStart) {
        methods.push({
          name: currentMethod,
          startLine: methodStart + 1,
          endLine: i + 1,
          length: i - methodStart + 1,
        });
        currentMethod = null;
      }
    }
  }
  
  return methods;
}

// ─── Maintainability Index ──────────────────────────────────────────────────

/**
 * Calculate Maintainability Index (Microsoft formula)
 * MI = MAX(0, (171 - 5.2 * ln(HV) - 0.23 * CC - 16.2 * ln(LOC)) * 100 / 171)
 * 
 * Simplified version using:
 * - HV = Halstead Volume (estimated from operators/operands)
 * - CC = Cyclomatic Complexity
 * - LOC = Lines of Code
 */
function calculateMaintainabilityIndex(content) {
  const loc = calculateLOCMetrics(content);
  const cc = calculateCyclomaticComplexity(content);
  
  // Simplified Halstead Volume estimation
  const stripped = stripComments(content);
  const operators = (stripped.match(/[+\-*/=<>!&|^~%?:;,.()[\]{}]/g) || []).length;
  const operands = (stripped.match(/\b\w+\b/g) || []).length;
  const vocabulary = new Set([...(stripped.match(/[+\-*/=<>!&|^~%?:;,.]/g) || [])]).size + 
                     new Set([...(stripped.match(/\b\w+\b/g) || [])]).size;
  const volume = (operators + operands) * Math.log2(Math.max(vocabulary, 1));
  
  // Calculate MI
  const lnVolume = Math.log(Math.max(volume, 1));
  const lnLOC = Math.log(Math.max(loc.codeLines, 1));
  
  const mi = Math.max(0, (171 - 5.2 * lnVolume - 0.23 * cc - 16.2 * lnLOC) * 100 / 171);
  
  // Rating thresholds (SonarQube style)
  let rating;
  if (mi >= 80) rating = 'A';
  else if (mi >= 60) rating = 'B';
  else if (mi >= 40) rating = 'C';
  else if (mi >= 20) rating = 'D';
  else rating = 'E';
  
  return {
    index: Math.round(mi * 10) / 10,
    rating,
    components: {
      halsteadVolume: Math.round(volume),
      cyclomaticComplexity: cc,
      linesOfCode: loc.codeLines,
    },
  };
}

// ─── File Complexity Report ─────────────────────────────────────────────────

/**
 * Generate a complete complexity report for a file
 */
function analyzeFileComplexity(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return null;
  
  const loc = calculateLOCMetrics(content);
  const cyclomaticComplexity = calculateCyclomaticComplexity(content);
  const cognitiveComplexity = calculateCognitiveComplexity(content);
  const maintainability = calculateMaintainabilityIndex(content);
  const methods = analyzeMethodLengths(content);
  
  // Find problematic methods
  const longMethods = methods.filter(m => m.length > 30);
  const complexMethods = methods.filter(m => {
    const methodContent = content.split('\n').slice(m.startLine - 1, m.endLine).join('\n');
    return calculateCyclomaticComplexity(methodContent) > 10;
  });
  
  return {
    file: filePath,
    loc,
    cyclomaticComplexity,
    cognitiveComplexity,
    maintainability,
    methods: {
      total: methods.length,
      averageLength: methods.length > 0 ? Math.round(methods.reduce((a, m) => a + m.length, 0) / methods.length) : 0,
      maxLength: methods.length > 0 ? Math.max(...methods.map(m => m.length)) : 0,
      longMethods: longMethods.map(m => ({ name: m.name, length: m.length, line: m.startLine })),
      complexMethods: complexMethods.map(m => m.name),
    },
    issues: [
      ...(cyclomaticComplexity > 20 ? [{ severity: 'critical', title: `High cyclomatic complexity: ${cyclomaticComplexity} (threshold: 20)`, file: filePath, line: 1, id: 'complexity:cyclomatic' }] : []),
      ...(cognitiveComplexity > 25 ? [{ severity: 'major', title: `High cognitive complexity: ${cognitiveComplexity} (threshold: 25)`, file: filePath, line: 1, id: 'complexity:cognitive' }] : []),
      ...(loc.codeLines > 300 ? [{ severity: 'major', title: `File too long: ${loc.codeLines} lines of code (threshold: 300)`, file: filePath, line: 1, id: 'complexity:file-size' }] : []),
      ...longMethods.map(m => ({ severity: 'minor', title: `Long method "${m.name}": ${m.length} lines (threshold: 30)`, file: filePath, line: m.startLine, id: 'complexity:long-method' })),
      ...(maintainability.rating === 'D' || maintainability.rating === 'E' ? [{ severity: 'critical', title: `Low maintainability: ${maintainability.rating} (index: ${maintainability.index})`, file: filePath, line: 1, id: 'complexity:maintainability' }] : []),
    ],
  };
}

module.exports = {
  calculateCyclomaticComplexity,
  calculateCognitiveComplexity,
  calculateLOCMetrics,
  analyzeMethodLengths,
  calculateMaintainabilityIndex,
  analyzeFileComplexity,
};

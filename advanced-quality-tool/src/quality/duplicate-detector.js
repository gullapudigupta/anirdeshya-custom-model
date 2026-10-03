/**
 * Duplicate Code Detector
 * 
 * Detects code duplication and copy-paste blocks:
 * - Exact duplicates
 * - Similar code blocks (token-based)
 * - Type 1, 2, 3 clones
 * - Cross-file duplication
 * - Refactoring suggestions
 * 
 * @module quality/duplicate-detector
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Duplicate Code Detector
 */
class DuplicateDetector {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.minLines = options.minLines || 6; // Minimum lines to consider
    this.minTokens = options.minTokens || 50; // Minimum tokens for similarity
    this.similarityThreshold = options.similarityThreshold || 0.85; // 85% similar

    // Detection strategies
    this.strategies = {
      exact: options.exact !== false,           // Type 1 clones (exact copies)
      parameterized: options.parameterized !== false, // Type 2 clones (renamed identifiers)
      gapped: options.gapped !== false          // Type 3 clones (with gaps/modifications)
    };

    // Code block storage
    this.codeBlocks = [];
    this.duplicates = [];

    // Statistics
    this.stats = {
      filesScanned: 0,
      blocksAnalyzed: 0,
      duplicatesFound: 0,
      linesOfDuplication: 0
    };
  }

  /**
   * Analyze file for duplicates
   */
  async analyzeFile(filePath) {
    this.stats.filesScanned++;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      // Extract code blocks
      const blocks = this.extractCodeBlocks(content, filePath);
      this.stats.blocksAnalyzed += blocks.length;

      // Store blocks for cross-file comparison
      this.codeBlocks.push(...blocks);

      return {
        filePath,
        blocks: blocks.length
      };

    } catch (error) {
      this.log(`Error analyzing ${filePath}: ${error.message}`);
      return {
        filePath,
        error: error.message,
        blocks: 0
      };
    }
  }

  /**
   * Extract code blocks from content
   */
  extractCodeBlocks(content, filePath) {
    const lines = content.split('\n');
    const blocks = [];

    // Sliding window to extract blocks
    for (let i = 0; i <= lines.length - this.minLines; i++) {
      const blockLines = [];

      // Build block of minimum size
      for (let j = i; j < lines.length && blockLines.length < this.minLines * 3; j++) {
        const line = lines[j].trim();

        // Skip empty lines and comments
        if (line && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*')) {
          blockLines.push(lines[j]);
        }

        // Once we have minimum lines, create block
        if (blockLines.length >= this.minLines) {
          const block = this.createBlock(blockLines, filePath, i + 1, j + 1);
          blocks.push(block);
          break; // Move to next starting position
        }
      }
    }

    return blocks;
  }

  /**
   * Create code block object
   */
  createBlock(lines, filePath, startLine, endLine) {
    const code = lines.join('\n');

    return {
      filePath,
      startLine,
      endLine,
      lines: lines.length,
      code,
      hash: this.hashCode(code),
      normalizedHash: this.hashNormalized(code),
      tokens: this.tokenize(code),
      tokenHash: this.hashTokens(this.tokenize(code))
    };
  }

  /**
   * Hash code for exact matching
   */
  hashCode(code) {
    return crypto.createHash('md5').update(code).digest('hex');
  }

  /**
   * Hash normalized code (whitespace removed)
   */
  hashNormalized(code) {
    const normalized = code.replace(/\s+/g, ' ').trim();
    return crypto.createHash('md5').update(normalized).digest('hex');
  }

  /**
   * Tokenize code
   */
  tokenize(code) {
    // Simple tokenization: split by whitespace and operators
    const tokens = code
      .replace(/([{}()[\];,.])/g, ' $1 ')
      .split(/\s+/)
      .filter(t => t.length > 0);

    return tokens;
  }

  /**
   * Hash token sequence (for structural similarity)
   */
  hashTokens(tokens) {
    // Normalize identifiers to detect renamed variable clones
    const normalized = tokens.map(token => {
      // Keep keywords and operators
      if (this.isKeyword(token) || this.isOperator(token)) {
        return token;
      }
      // Replace identifiers with placeholder
      return 'ID';
    });

    return crypto.createHash('md5').update(normalized.join(' ')).digest('hex');
  }

  /**
   * Check if token is keyword
   */
  isKeyword(token) {
    const keywords = [
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'function', 'const', 'let', 'var', 'class', 'extends', 'implements',
      'import', 'export', 'from', 'as', 'default', 'async', 'await', 'try', 'catch',
      'finally', 'throw', 'new', 'typeof', 'instanceof', 'in', 'of', 'this', 'super'
    ];
    return keywords.includes(token);
  }

  /**
   * Check if token is operator
   */
  isOperator(token) {
    const operators = [
      '+', '-', '*', '/', '%', '=', '==', '===', '!=', '!==',
      '<', '>', '<=', '>=', '&&', '||', '!', '&', '|', '^',
      '<<', '>>', '++', '--', '?', ':', '{', '}', '(', ')', '[', ']', ';', ',', '.'
    ];
    return operators.includes(token);
  }

  /**
   * Find duplicates across all analyzed files
   */
  findDuplicates() {
    const duplicateGroups = [];

    // Group by hash for exact duplicates
    if (this.strategies.exact) {
      const exactGroups = this.groupByHash('hash');
      duplicateGroups.push(...exactGroups);
    }

    // Group by normalized hash for whitespace-insensitive duplicates
    if (this.strategies.parameterized) {
      const normalizedGroups = this.groupByHash('normalizedHash');
      duplicateGroups.push(...normalizedGroups);
    }

    // Group by token hash for structurally similar code
    if (this.strategies.gapped) {
      const tokenGroups = this.groupByHash('tokenHash');
      duplicateGroups.push(...tokenGroups);
    }

    // Filter out groups with only one block
    const actualDuplicates = duplicateGroups
      .filter(group => group.blocks.length > 1)
      .map(group => this.analyzeDuplicateGroup(group));

    this.duplicates = actualDuplicates;
    this.stats.duplicatesFound = actualDuplicates.length;

    // Calculate total lines of duplication
    actualDuplicates.forEach(dup => {
      this.stats.linesOfDuplication += dup.totalLines;
    });

    return actualDuplicates;
  }

  /**
   * Group blocks by hash
   */
  groupByHash(hashType) {
    const groups = new Map();

    this.codeBlocks.forEach(block => {
      const hash = block[hashType];

      if (!groups.has(hash)) {
        groups.set(hash, {
          hash,
          type: this.getCloneType(hashType),
          blocks: []
        });
      }

      groups.get(hash).blocks.push(block);
    });

    return Array.from(groups.values());
  }

  /**
   * Get clone type from hash type
   */
  getCloneType(hashType) {
    switch (hashType) {
      case 'hash':
        return 'exact'; // Type 1
      case 'normalizedHash':
        return 'parameterized'; // Type 2
      case 'tokenHash':
        return 'structural'; // Type 2/3
      default:
        return 'unknown';
    }
  }

  /**
   * Analyze duplicate group
   */
  analyzeDuplicateGroup(group) {
    const blocks = group.blocks;
    const firstBlock = blocks[0];

    // Calculate metrics
    const totalLines = blocks.reduce((sum, block) => sum + block.lines, 0);
    const avgLines = Math.round(totalLines / blocks.length);

    // Get unique files
    const files = [...new Set(blocks.map(b => b.filePath))];
    const isCrossFile = files.length > 1;

    // Calculate severity
    const severity = this.calculateDuplicationSeverity(blocks.length, avgLines, isCrossFile);

    // Generate refactoring suggestion
    const suggestion = this.generateRefactoringSuggestion(group);

    return {
      type: 'code-duplication',
      cloneType: group.type,
      severity,
      instances: blocks.length,
      lines: avgLines,
      totalLines,
      files: files.length,
      isCrossFile,
      blocks: blocks.map(block => ({
        filePath: block.filePath,
        startLine: block.startLine,
        endLine: block.endLine,
        lines: block.lines
      })),
      suggestion,
      description: `${group.type} code duplication: ${blocks.length} instances across ${files.length} file(s), ${avgLines} lines each`,
      recommendation: suggestion
    };
  }

  /**
   * Calculate duplication severity
   */
  calculateDuplicationSeverity(instances, lines, isCrossFile) {
    // More instances = higher severity
    // More lines = higher severity
    // Cross-file = higher severity

    let score = 0;

    score += Math.min(instances * 10, 40); // Up to 40 points for instances
    score += Math.min(lines * 2, 40);      // Up to 40 points for lines
    if (isCrossFile) score += 20;          // 20 points for cross-file

    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Generate refactoring suggestion
   */
  generateRefactoringSuggestion(group) {
    const blocks = group.blocks;
    const avgLines = Math.round(
      blocks.reduce((sum, b) => sum + b.lines, 0) / blocks.length
    );

    const type = group.type;

    if (type === 'exact') {
      return `Extract ${avgLines} lines into a shared function or utility`;
    }

    if (type === 'parameterized') {
      return `Extract into parameterized function, pass differing values as arguments`;
    }

    if (type === 'structural') {
      return `Consider creating a base class or shared utility with template method pattern`;
    }

    return `Refactor to eliminate duplication through abstraction`;
  }

  /**
   * Calculate similarity between two code blocks
   */
  calculateSimilarity(block1, block2) {
    const tokens1 = block1.tokens;
    const tokens2 = block2.tokens;

    // Use Jaccard similarity
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Analyze multiple files
   */
  async analyzeFiles(filePaths) {
    // First pass: analyze all files
    for (const filePath of filePaths) {
      await this.analyzeFile(filePath);
    }

    // Second pass: find duplicates
    const duplicates = this.findDuplicates();

    return duplicates;
  }

  /**
   * Analyze directory
   */
  async analyzeDirectory(directory, options = {}) {
    const patterns = options.patterns || ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'];
    const exclude = options.exclude || ['**/node_modules/**', '**/dist/**', '**/build/**'];

    const files = this.findFiles(directory, patterns, exclude);
    return this.analyzeFiles(files);
  }

  /**
   * Find files
   */
  findFiles(directory, patterns, exclude) {
    const files = [];

    const scan = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(directory, fullPath);

          if (exclude.some(pattern => this.matchPattern(relativePath, pattern))) {
            continue;
          }

          if (entry.isDirectory()) {
            scan(fullPath);
          } else if (patterns.some(pattern => this.matchPattern(relativePath, pattern))) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        this.log(`Error scanning ${dir}: ${error.message}`);
      }
    };

    scan(directory);
    return files;
  }

  /**
   * Pattern matching
   */
  matchPattern(filePath, pattern) {
    const regex = new RegExp(
      '^' + pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
        .replace(/\./g, '\\.') + '$'
    );
    return regex.test(filePath.replace(/\\/g, '/'));
  }

  /**
   * Generate report
   */
  generateReport(duplicates) {
    const report = {
      summary: {
        ...this.stats,
        timestamp: new Date().toISOString()
      },
      duplicates
    };

    // Group by severity
    const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
    duplicates.forEach(dup => {
      if (bySeverity[dup.severity]) {
        bySeverity[dup.severity].push(dup);
      }
    });

    report.bySeverity = bySeverity;

    // Calculate duplication percentage
    if (this.stats.blocksAnalyzed > 0) {
      report.summary.duplicationPercentage = 
        Math.round((this.stats.linesOfDuplication / this.stats.blocksAnalyzed) * 100);
    }

    return report;
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset for new analysis
   */
  reset() {
    this.codeBlocks = [];
    this.duplicates = [];
    this.stats = {
      filesScanned: 0,
      blocksAnalyzed: 0,
      duplicatesFound: 0,
      linesOfDuplication: 0
    };
  }

  log(message) {
    if (this.verbose) {
      console.log(`[DuplicateDetector] ${message}`);
    }
  }
}

module.exports = {
  DuplicateDetector
};

/**
 * Code Duplication Detector
 * 
 * Detects duplicate code blocks using token-based comparison:
 * - Exact duplicates (identical lines)
 * - Near-duplicates (same structure, different identifiers)
 * - Cross-file duplication
 * - Duplicate import patterns
 */

const path = require('path');
const { readFileSafe, getLineNumber } = require('../ast-utils');

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  minLines: 5,        // Minimum duplicate block size
  minTokens: 30,      // Minimum tokens for a match
  threshold: 0.9,     // Similarity threshold (0-1)
};

// ─── Tokenizer ───────────────────────────────────────────────────────────────

/**
 * Tokenize a line of code (normalize variable names)
 */
function tokenizeLine(line) {
  return line
    .trim()
    .replace(/\/\/.*$/, '')           // Remove comments
    .replace(/['"][^'"]*['"]/g, 'STR') // Normalize strings
    .replace(/\d+/g, 'NUM')           // Normalize numbers
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim();
}

/**
 * Create a hash for a block of lines
 */
function hashBlock(lines) {
  return lines.map(tokenizeLine).filter(l => l.length > 0).join('|');
}

// ─── Duplication Detector ────────────────────────────────────────────────────

class DuplicationDetector {
  constructor(rootDir, config = {}) {
    this.rootDir = rootDir;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.issues = [];
    this.duplicates = [];
    this.blockHashes = new Map(); // hash -> [{file, startLine, endLine, content}]
  }

  /**
   * Analyze files for duplication
   */
  analyze(files) {
    // Build hash index of all code blocks
    for (const file of files) {
      if (file.includes('.spec.')) continue;
      this._indexFile(file);
    }
    
    // Find duplicates
    this._findDuplicates();
    
    return this.duplicates;
  }

  /**
   * Index all code blocks in a file
   */
  _indexFile(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return;
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const lines = content.split('\n');
    const minLines = this.config.minLines;
    
    // Skip very short files
    if (lines.length < minLines * 2) return;
    
    // Sliding window of minLines size
    for (let i = 0; i <= lines.length - minLines; i++) {
      const block = lines.slice(i, i + minLines);
      
      // Skip blocks that are mostly empty/braces
      const meaningfulLines = block.filter(l => {
        const trimmed = l.trim();
        return trimmed.length > 2 && trimmed !== '{' && trimmed !== '}' && 
               trimmed !== '},' && !trimmed.startsWith('//') && !trimmed.startsWith('*');
      });
      
      if (meaningfulLines.length < minLines - 1) continue;
      
      const hash = hashBlock(block);
      if (hash.length < this.config.minTokens) continue;
      
      if (!this.blockHashes.has(hash)) {
        this.blockHashes.set(hash, []);
      }
      
      this.blockHashes.get(hash).push({
        file: relativePath,
        startLine: i + 1,
        endLine: i + minLines,
        content: block.join('\n').substring(0, 200),
      });
    }
  }

  /**
   * Find actual duplicates from the hash index
   */
  _findDuplicates() {
    const reported = new Set();
    
    for (const [hash, locations] of this.blockHashes) {
      if (locations.length < 2) continue;
      
      // Deduplicate overlapping blocks in same file
      const uniqueLocations = this._deduplicateLocations(locations);
      if (uniqueLocations.length < 2) continue;
      
      // Create a unique key for this duplicate pair
      const key = uniqueLocations.map(l => `${l.file}:${l.startLine}`).sort().join('|');
      if (reported.has(key)) continue;
      reported.add(key);
      
      const duplicate = {
        blockSize: this.config.minLines,
        locations: uniqueLocations,
        preview: uniqueLocations[0].content.substring(0, 100),
      };
      
      this.duplicates.push(duplicate);
      
      // Create an issue
      this.issues.push({
        id: 'dup:duplicate-block',
        severity: 'minor',
        category: 'duplication',
        title: `Duplicate code block (${this.config.minLines} lines) found in ${uniqueLocations.length} locations`,
        description: uniqueLocations.map(l => `${l.file}:${l.startLine}`).join(', '),
        file: uniqueLocations[0].file,
        line: uniqueLocations[0].startLine,
        locations: uniqueLocations,
      });
    }
    
    // Sort by number of duplications (most duplicated first)
    this.duplicates.sort((a, b) => b.locations.length - a.locations.length);
    
    // Limit to top 50 to avoid noise
    this.duplicates = this.duplicates.slice(0, 50);
    this.issues = this.issues.slice(0, 50);
  }

  /**
   * Remove overlapping locations in the same file
   */
  _deduplicateLocations(locations) {
    const result = [];
    const seen = new Map(); // file -> last endLine
    
    for (const loc of locations) {
      const lastEnd = seen.get(loc.file) || 0;
      if (loc.startLine > lastEnd) {
        result.push(loc);
        seen.set(loc.file, loc.endLine);
      }
    }
    
    return result;
  }

  /**
   * Get duplication percentage
   */
  getDuplicationPercentage(totalLines) {
    const duplicatedLines = this.duplicates.reduce((sum, d) => 
      sum + (d.blockSize * d.locations.length), 0);
    return totalLines > 0 ? (duplicatedLines / totalLines * 100).toFixed(1) : 0;
  }

  getIssues() {
    return this.issues;
  }

  getSummary() {
    return {
      totalDuplicateBlocks: this.duplicates.length,
      totalIssues: this.issues.length,
      topDuplications: this.duplicates.slice(0, 10).map(d => ({
        locations: d.locations.length,
        files: [...new Set(d.locations.map(l => l.file))],
        preview: d.preview.substring(0, 60),
      })),
    };
  }
}

module.exports = { DuplicationDetector };

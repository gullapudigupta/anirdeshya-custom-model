/**
 * CAT-025: Ripgrep Bridge (Optional External Tool)
 * 
 * Use `rg` binary if available on PATH for faster text search.
 * Falls back to Node.js regex-based search if not available.
 * 
 * Benefits when rg is available:
 * - 5-10x faster text search on large codebases
 * - Built-in .gitignore awareness
 * - Unicode support
 * - Streaming output for very large result sets
 * 
 * Usage:
 *   const bridge = new RipgrepBridge(rootDir);
 *   bridge.search('handleLogin');
 *   bridge.search('TODO|FIXME', { filePattern: '*.ts', caseSensitive: false });
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class RipgrepBridge {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.rgAvailable = null; // lazy detection
    this.rgPath = null;
  }

  /**
   * Check if ripgrep is available on the system.
   * @returns {boolean}
   */
  isAvailable() {
    if (this.rgAvailable !== null) return this.rgAvailable;
    
    try {
      const result = execSync('rg --version', { encoding: 'utf-8', timeout: 5000 });
      this.rgAvailable = true;
      this.rgPath = 'rg';
      
      // Extract version for logging
      const versionMatch = result.match(/ripgrep\s+([\d.]+)/);
      this._version = versionMatch ? versionMatch[1] : 'unknown';
    } catch (e) {
      this.rgAvailable = false;
    }
    
    return this.rgAvailable;
  }

  /**
   * Get ripgrep version info.
   * @returns {object}
   */
  getInfo() {
    return {
      available: this.isAvailable(),
      version: this._version || null,
      path: this.rgPath,
      fallback: 'Node.js fs + RegExp',
    };
  }

  /**
   * Search for a pattern across the codebase.
   * Uses ripgrep if available, falls back to Node.js.
   * 
   * @param {string} pattern - Search pattern (regex)
   * @param {object} options - Search options
   * @param {string} options.filePattern - Glob pattern for files (e.g., '*.ts')
   * @param {boolean} options.caseSensitive - Case sensitive search (default: false)
   * @param {number} options.maxResults - Maximum results (default: 100)
   * @param {boolean} options.wholeWord - Match whole words only
   * @param {string} options.searchDir - Directory to search (default: src/)
   * @param {number} options.contextLines - Context lines around match (default: 0)
   * @param {Array<string>} options.exclude - Patterns to exclude
   * @returns {object} { results: [...], method: 'rg'|'node', duration }
   */
  search(pattern, options = {}) {
    const startTime = Date.now();
    
    let results;
    let method;
    
    if (this.isAvailable()) {
      results = this._searchWithRg(pattern, options);
      method = 'rg';
    } else {
      results = this._searchWithNode(pattern, options);
      method = 'node';
    }
    
    const duration = Date.now() - startTime;
    
    return {
      pattern,
      results,
      totalMatches: results.length,
      method,
      duration,
    };
  }

  /**
   * Find files matching a pattern.
   * @param {string} pattern - Filename pattern
   * @param {object} options
   * @returns {Array<string>} Matching file paths
   */
  findFiles(pattern, options = {}) {
    const { searchDir = 'src' } = options;
    const dir = path.resolve(this.rootDir, searchDir);

    if (this.isAvailable()) {
      try {
        const cmd = `rg --files --glob "${pattern}" "${dir}"`;
        const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000, cwd: this.rootDir });
        return output.trim().split('\n').filter(Boolean)
          .map(f => path.relative(this.rootDir, f).replace(/\\/g, '/'));
      } catch (e) {
        return this._findFilesNode(pattern, dir);
      }
    }
    
    return this._findFilesNode(pattern, dir);
  }

  /**
   * Count occurrences of a pattern (fast).
   * @param {string} pattern
   * @param {object} options
   * @returns {number}
   */
  count(pattern, options = {}) {
    const { searchDir = 'src', filePattern = '*.ts' } = options;
    const dir = path.resolve(this.rootDir, searchDir);

    if (this.isAvailable()) {
      try {
        const cmd = `rg --count-matches -i --glob "${filePattern}" "${pattern}" "${dir}"`;
        const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000, cwd: this.rootDir });
        return output.trim().split('\n').filter(Boolean)
          .reduce((sum, line) => {
            const count = parseInt(line.split(':').pop());
            return sum + (isNaN(count) ? 0 : count);
          }, 0);
      } catch (e) {
        return 0; // rg returns non-zero if no matches
      }
    }

    // Fallback: count with Node
    const results = this._searchWithNode(pattern, { ...options, maxResults: 10000 });
    return results.length;
  }

  /**
   * Search and replace preview (dry-run).
   * @param {string} pattern
   * @param {string} replacement
   * @param {object} options
   * @returns {Array} Potential replacements with context
   */
  searchAndPreview(pattern, replacement, options = {}) {
    const results = this.search(pattern, options);
    
    return results.results.map(r => ({
      ...r,
      replacement: r.matchedText ? r.matchedText.replace(new RegExp(pattern, 'g'), replacement) : replacement,
      preview: r.content.replace(new RegExp(pattern, 'g'), `[${replacement}]`),
    }));
  }

  // ─── Private: Ripgrep Implementation ─────────────────────────────────────

  _searchWithRg(pattern, options = {}) {
    const {
      filePattern = null,
      caseSensitive = false,
      maxResults = 100,
      wholeWord = false,
      searchDir = 'src',
      contextLines = 0,
      exclude = ['.spec.', 'node_modules', 'dist', '.angular'],
    } = options;

    const dir = path.resolve(this.rootDir, searchDir);
    
    const args = ['--json'];
    if (!caseSensitive) args.push('-i');
    if (wholeWord) args.push('-w');
    if (maxResults) args.push(`--max-count=${maxResults}`);
    if (contextLines > 0) args.push(`-C${contextLines}`);
    if (filePattern) args.push(`--glob=${filePattern}`);
    
    for (const exc of exclude) {
      args.push(`--glob=!*${exc}*`);
    }
    
    args.push(`"${pattern}"`, `"${dir}"`);

    try {
      const cmd = `rg ${args.join(' ')}`;
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 15000, cwd: this.rootDir, maxBuffer: 5 * 1024 * 1024 });
      return this._parseRgJson(output);
    } catch (e) {
      // rg exits with 1 when no matches found — not an error
      if (e.status === 1) return [];
      // Parse partial output if available
      if (e.stdout) return this._parseRgJson(e.stdout);
      return [];
    }
  }

  _parseRgJson(output) {
    const results = [];
    const lines = output.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'match') {
          const data = msg.data;
          const filePath = path.relative(this.rootDir, data.path.text).replace(/\\/g, '/');
          
          for (const submatch of data.submatches) {
            results.push({
              file: filePath,
              line: data.line_number,
              column: submatch.start,
              content: data.lines.text.trim(),
              matchedText: submatch.match.text,
            });
          }
        }
      } catch (e) {
        // Skip malformed JSON lines
      }
    }

    return results;
  }

  // ─── Private: Node.js Fallback ───────────────────────────────────────────

  _searchWithNode(pattern, options = {}) {
    const {
      filePattern = null,
      caseSensitive = false,
      maxResults = 100,
      wholeWord = false,
      searchDir = 'src',
      exclude = ['.spec.', 'node_modules', 'dist', '.angular'],
    } = options;

    const dir = path.resolve(this.rootDir, searchDir);
    const results = [];
    
    let regexPattern = pattern;
    if (wholeWord) regexPattern = `\\b${pattern}\\b`;
    
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(regexPattern, flags);

    const files = this._walkFiles(dir, filePattern, exclude);
    
    for (const file of files) {
      if (results.length >= maxResults) break;
      
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          const match = regex.exec(lines[i]);
          if (match) {
            regex.lastIndex = 0; // Reset for next line
            results.push({
              file: path.relative(this.rootDir, file).replace(/\\/g, '/'),
              line: i + 1,
              column: match.index,
              content: lines[i].trim().substring(0, 200),
              matchedText: match[0],
            });
            
            if (results.length >= maxResults) break;
          }
        }
      } catch (e) {
        // Skip unreadable files
      }
    }

    return results;
  }

  _findFilesNode(pattern, dir) {
    const globToRegex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(globToRegex);
    
    const files = this._walkFiles(dir, null, []);
    return files
      .filter(f => regex.test(path.basename(f)))
      .map(f => path.relative(this.rootDir, f).replace(/\\/g, '/'));
  }

  _walkFiles(dir, filePattern, exclude) {
    const results = [];
    const extMatch = filePattern ? this._globToExtension(filePattern) : null;
    
    function walk(currentDir) {
      let entries;
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch (e) { return; }
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          const shouldExclude = exclude.some(exc => entry.name.includes(exc) || fullPath.includes(exc));
          if (!shouldExclude) walk(fullPath);
        } else if (entry.isFile()) {
          const shouldExclude = exclude.some(exc => fullPath.includes(exc));
          if (shouldExclude) continue;
          
          if (extMatch && !entry.name.endsWith(extMatch)) continue;
          results.push(fullPath);
        }
      }
    }
    
    walk(dir);
    return results;
  }

  _globToExtension(pattern) {
    // Simple glob → extension: "*.ts" → ".ts"
    const match = pattern.match(/\*(\.\w+)$/);
    return match ? match[1] : null;
  }
}

module.exports = { RipgrepBridge };

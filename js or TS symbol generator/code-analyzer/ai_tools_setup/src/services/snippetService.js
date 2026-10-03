// src/services/snippetService.js
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config/config');
const { CacheManager } = require('../utils/cache');

class SnippetService {
  static getSnippet(file, startLine, endLine = null, contextLines = config.minSnippetContext) {
    const cacheKey = CacheManager.generateKey('snippet', file, startLine, endLine);
    const cached = CacheManager.get(cacheKey);
    if (cached) return cached;

    try {
      const fullPath = path.join(config.repoRoot, file);
      if (!fs.existsSync(fullPath)) {
        logger.warn('File not found', { file: fullPath });
        return null;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      const start = Math.max(0, startLine - 1 - contextLines);
      const end = endLine
        ? Math.min(lines.length, endLine + contextLines)
        : Math.min(lines.length, startLine + config.maxSnippetLines);

      const snippet = {
        file,
        startLine: start + 1,
        endLine: end,
        lines: lines.slice(start, end).map((line, idx) => ({
          number: start + idx + 1,
          text: line,
          isHighlight: (start + idx + 1) >= startLine && (start + idx + 1) <= (endLine || startLine)
        })),
        context: { contextLinesBefore: contextLines, contextLinesAfter: contextLines }
      };

      CacheManager.set(cacheKey, snippet);
      return snippet;
    } catch (error) {
      logger.error('Snippet service error', { error: error.message, file, startLine, endLine });
      throw error;
    }
  }

  static getFileContent(file) {
    const fullPath = path.join(config.repoRoot, file);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  }

  static getFileLines(file) {
    const content = this.getFileContent(file);
    if (!content) return null;
    return content.split('\n');
  }
}

module.exports = { SnippetService };

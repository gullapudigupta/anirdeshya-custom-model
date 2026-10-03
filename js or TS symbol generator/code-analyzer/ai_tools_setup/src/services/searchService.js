// src/services/searchService.js
//
// Pipeline: rg (fast text scan) → enrichWithSymbols() → ctags + Roslyn

const { ToolExecutor } = require('../utils/toolExecutor');
const { SymbolService } = require('./symbolService');
const { CacheManager } = require('../utils/cache');
const logger = require('../utils/logger');
const config = require('../config/config');

class SearchService {
  static async search(query, filePattern = null, limit = config.maxSearchResults) {
    const cacheKey = CacheManager.generateKey('search', query, filePattern, limit);
    const cached = CacheManager.get(cacheKey);
    if (cached) return cached;

    try {
      const args = [
        '--json',
        '--line-number',
        '--hidden',
        '--max-count', String(limit * 2),
      ];

      if (filePattern) args.push('--glob', filePattern);
      args.push(query);
      args.push(config.repoRoot);

      const result = await ToolExecutor.executeSpawn('rg', args);
      const rgResults = [];

      for (const line of result.stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'match') {
            rgResults.push({
              file: parsed.data.path.text,
              line: parsed.data.line_number,
              column: parsed.data.submatches[0]?.start ?? 0,
              text: parsed.data.lines.text.trim(),
              matches: parsed.data.submatches.map(m => ({
                text: m.match.text,
                start: m.start,
                end: m.end,
              })),
            });
          }
        } catch (_) {
          logger.warn('Failed to parse rg output line', { line });
        }
      }

      const enriched = SymbolService.enrichSearchResults(rgResults);
      const sliced = enriched.slice(0, limit);
      CacheManager.set(cacheKey, sliced);
      return sliced;
    } catch (err) {
      logger.error('Search service error', { error: err.message, query });
      throw err;
    }
  }
}

module.exports = { SearchService };

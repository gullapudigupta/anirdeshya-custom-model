// src/services/symbolService.js
//
// Roslyn + ctags merged symbol service.
// Provides cross-project C# symbol resolution.
//
// Data linkage:
//   rg (text match) → enrichWithSymbols() → ctags + Roslyn
//   ctags (position index) → Roslyn (Kind/Signature)

const { CacheManager } = require('../utils/cache');
const logger = require('../utils/logger');
const config = require('../config/config');
const fs = require('fs');
const path = require('path');

class SymbolService {
  static roslynSymbols = null;
  static ctagsIndex = null;
  static ctagsByName = null;

  // ─── Roslyn symbols.json ───────────────────────────────────────────────

  static loadRoslynSymbols() {
    if (this.roslynSymbols) return this.roslynSymbols;
    try {
      if (fs.existsSync(config.symbolsFile)) {
        const content = fs.readFileSync(config.symbolsFile, 'utf-8');
        this.roslynSymbols = JSON.parse(content);
        logger.info(`Loaded Roslyn symbols: ${this.roslynSymbols.length}`);
        return this.roslynSymbols;
      }
    } catch (err) {
      logger.warn('Failed to load Roslyn symbols', { error: err.message });
    }
    return [];
  }

  static getRoslynByName(name) {
    return this.loadRoslynSymbols().find(
      s => s.Name === name || s.Name?.endsWith(`.${name}`)
    ) || null;
  }

  // ─── ctags (JSON-lines format) ─────────────────────────────────────────

  static loadCtagsIndex() {
    if (this.ctagsIndex) return this.ctagsIndex;

    this.ctagsIndex = new Map();
    this.ctagsByName = new Map();

    const fileLines = new Map();
    const getLines = (filePath) => {
      const norm = filePath.replace(/\//g, '\\');
      if (fileLines.has(norm)) return fileLines.get(norm);
      try {
        const content = fs.existsSync(norm) ? fs.readFileSync(norm, 'utf-8') : '';
        const lines = content.split('\n');
        fileLines.set(norm, lines);
        return lines;
      } catch (_) {
        fileLines.set(norm, []);
        return [];
      }
    };

    const patternText = (p) => {
      if (!p) return null;
      return p.replace(/^\/\^?/, '').replace(/\$?\/$/, '').trim();
    };

    try {
      if (!fs.existsSync(config.tagsFile)) {
        logger.warn('Tags file not found', { tagsFile: config.tagsFile });
        return this.ctagsIndex;
      }

      const raw = fs.readFileSync(config.tagsFile, 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const tag = JSON.parse(line);
          if (tag._type !== 'tag') continue;

          let lineNum = tag.line ? parseInt(tag.line) : null;
          if (!lineNum && tag.pattern) {
            const needle = patternText(tag.pattern);
            if (needle) {
              const lines = getLines(tag.path);
              const idx = lines.findIndex(l => l.includes(needle.substring(0, 60)));
              if (idx >= 0) lineNum = idx + 1;
            }
          }

          const entry = {
            name: tag.name,
            file: tag.path,
            line: lineNum || 0,
            kind: tag.kind,
            scope: tag.scope || null,
            scopeKind: tag.scopeKind || null,
          };

          if (!this.ctagsIndex.has(entry.file)) this.ctagsIndex.set(entry.file, []);
          this.ctagsIndex.get(entry.file).push(entry);

          if (!this.ctagsByName.has(entry.name)) this.ctagsByName.set(entry.name, []);
          this.ctagsByName.get(entry.name).push(entry);
        } catch (_) { /* malformed line */ }
      }

      logger.info(`Ctags index built: ${this.ctagsIndex.size} files, ${this.ctagsByName.size} unique names`);
    } catch (err) {
      logger.error('Failed to build ctags index', { error: err.message });
    }

    return this.ctagsIndex;
  }

  static searchCtags(file, query = null) {
    const cacheKey = CacheManager.generateKey('ctags', file, query);
    const cached = CacheManager.get(cacheKey);
    if (cached) return cached;

    this.loadCtagsIndex();
    let results = [];

    if (file) {
      const normFile = file.replace(/\\/g, '/').toLowerCase();
      for (const [key, tags] of this.ctagsIndex) {
        const normKey = key.replace(/\\/g, '/').toLowerCase();
        if (normKey.includes(normFile) || normFile.includes(normKey)) {
          results.push(...tags);
        }
      }
    } else {
      for (const tags of this.ctagsIndex.values()) results.push(...tags);
    }

    if (query) {
      results = results.filter(t => t.name.toLowerCase().includes(query.toLowerCase()));
    }

    CacheManager.set(cacheKey, results);
    return results;
  }

  static symbolAtLine(filePath, lineNumber) {
    this.loadCtagsIndex();
    const normTarget = filePath.replace(/\\/g, '/').toLowerCase();

    let best = null;
    for (const [key, tags] of this.ctagsIndex) {
      const normKey = key.replace(/\\/g, '/').toLowerCase();
      if (!normTarget.includes(normKey) && !normKey.includes(normTarget)) continue;
      for (const tag of tags) {
        if (tag.line <= lineNumber) {
          if (!best || tag.line > best.line) best = tag;
        }
      }
    }
    return best;
  }

  // ─── Merged queries ────────────────────────────────────────────────────

  static getSymbolInfo(symbolName, file = null) {
    const roslyn = this.loadRoslynSymbols().filter(s =>
      (s.Name && s.Name.toLowerCase().includes(symbolName.toLowerCase())) ||
      (s.Signature && s.Signature.toLowerCase().includes(symbolName.toLowerCase()))
    );

    this.loadCtagsIndex();
    const ctags = [];
    for (const tags of this.ctagsByName.values()) {
      for (const t of tags) {
        if (t.name.toLowerCase().includes(symbolName.toLowerCase())) ctags.push(t);
      }
    }

    const merged = roslyn.map(r => {
      const tag = ctags.find(t =>
        t.name === r.Name &&
        (r.Location ? r.Location.includes(t.file) || t.file.includes(r.Location) : true)
      );
      return {
        name: r.Name,
        kind: r.Kind,
        signature: r.Signature || null,
        location: r.Location || tag?.file || null,
        line: r.Line ? parseInt(r.Line) : (tag?.line ?? null),
        scope: tag?.scope || null,
        scopeKind: tag?.scopeKind || null,
      };
    });

    const roslynNames = new Set(roslyn.map(r => r.Name));
    for (const t of ctags) {
      if (!roslynNames.has(t.name)) {
        merged.push({
          name: t.name,
          kind: t.kind,
          signature: null,
          location: t.file,
          line: t.line,
          scope: t.scope,
          scopeKind: t.scopeKind,
        });
      }
    }

    let results = merged;
    if (file) {
      results = results.filter(s => s.location && s.location.includes(file));
    }
    return results.slice(0, 100);
  }

  static getSymbolsInFile(file) {
    const cacheKey = CacheManager.generateKey('symbols-in-file', file);
    const cached = CacheManager.get(cacheKey);
    if (cached) return cached;

    const tags = this.searchCtags(file);
    const roslynInFile = this.loadRoslynSymbols().filter(s => {
      if (!s.Location) return false;
      const normLoc = s.Location.replace(/\\/g, '/').toLowerCase();
      const normFile = file.replace(/\\/g, '/').toLowerCase();
      return normLoc.includes(normFile) || normFile.includes(path.basename(normLoc));
    });

    const combined = tags.map(tag => {
      const roslyn = roslynInFile.find(r => r.Name === tag.name);
      return {
        symbol: tag.name,
        kind: roslyn?.Kind || tag.kind,
        signature: roslyn?.Signature || null,
        file: tag.file,
        line: tag.line,
        scope: tag.scope,
        roslynEnriched: !!roslyn,
      };
    });

    CacheManager.set(cacheKey, combined);
    return combined;
  }

  static enrichSearchResults(rgResults) {
    this.loadCtagsIndex();
    const roslyn = this.loadRoslynSymbols();

    return rgResults.map(hit => {
      const tag = this.symbolAtLine(hit.file, hit.line);
      const roslynEntry = tag
        ? roslyn.find(r => r.Name === tag.name || r.Name?.endsWith(`.${tag.name}`))
        : null;

      return {
        ...hit,
        symbol: tag ? {
          name: tag.name,
          kind: roslynEntry?.Kind || tag.kind,
          signature: roslynEntry?.Signature || null,
          definedAt: tag.line,
          scope: tag.scope || null,
        } : null,
      };
    });
  }

  static refreshSymbols() {
    CacheManager.flush();
    this.roslynSymbols = null;
    this.ctagsIndex = null;
    this.ctagsByName = null;
    logger.info('Symbol indexes refreshed');
  }
}

module.exports = { SymbolService };

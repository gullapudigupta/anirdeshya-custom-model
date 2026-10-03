// src/handlers/diffContextHandler.js
const { ToolExecutor } = require('../utils/toolExecutor');
const { SymbolService } = require('../services/symbolService');
const { CacheManager } = require('../utils/cache');
const logger = require('../utils/logger');

function parseDiff(diffText) {
  const files = [];
  let current = null;
  let hunk = null;
  let newLine = 0;

  for (const raw of diffText.split('\n')) {
    const fileMatch = raw.match(/^diff --git a\/.+ b\/(.+)$/);
    if (fileMatch) {
      if (current) files.push(current);
      current = { file: fileMatch[1].replace(/\\/g, '/'), status: 'M', hunks: [] };
      hunk = null;
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('new file')) { current.status = 'A'; continue; }
    if (raw.startsWith('deleted file')) { current.status = 'D'; continue; }
    if (raw.startsWith('rename to')) { current.status = 'R'; continue; }

    const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      hunk = { startLine: newLine, endLine: newLine, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      hunk.lines.push('+  ' + raw.slice(1));
      hunk.endLine = newLine;
      newLine++;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      hunk.lines.push('-  ' + raw.slice(1));
    } else if (raw.startsWith(' ')) {
      hunk.lines.push('   ' + raw.slice(1));
      newLine++;
    }
  }
  if (current) files.push(current);
  return files.filter(f => f.file.endsWith('.cs'));
}

function trimContextLines(lines, maxCtx) {
  const first = lines.findIndex(l => l.startsWith('+') || l.startsWith('-'));
  const last = [...lines].reverse().findIndex(l => l.startsWith('+') || l.startsWith('-'));
  if (first === -1) return lines;
  const lastIdx = lines.length - 1 - last;
  const start = Math.max(0, first - maxCtx);
  const end = Math.min(lines.length, lastIdx + maxCtx + 1);
  return lines.slice(start, end);
}

async function diffContextHandler(req, res) {
  try {
    const base = req.query.base || 'HEAD';
    const staged = req.query.staged === 'true';

    const cacheKey = CacheManager.generateKey('diff-context', base, String(staged));
    const cached = CacheManager.get(cacheKey);
    if (cached) return res.json(cached);

    const gitArgs = ['diff', '--unified=3', '--diff-filter=ACDMR', '--no-color'];
    if (staged) gitArgs.push('--cached');
    else if (base !== 'HEAD') gitArgs.push(base);

    let diffOutput;
    try {
      const result = await ToolExecutor.executeSpawn('git', gitArgs);
      diffOutput = result.stdout;
    } catch (err) {
      return res.status(500).json({ error: 'git diff failed', message: err.message });
    }

    if (!diffOutput || !diffOutput.trim()) {
      return res.json({ base, staged, changedFiles: [], summary: 'No changes detected' });
    }

    const parsedFiles = parseDiff(diffOutput);

    for (const f of parsedFiles) {
      for (const hunk of f.hunks) {
        const midLine = Math.floor((hunk.startLine + hunk.endLine) / 2);
        const enclosing = SymbolService.symbolAtLine(f.file, midLine);
        hunk.enclosingSymbol = enclosing ? { name: enclosing.name, kind: enclosing.kind, line: enclosing.line } : null;
        hunk.lines = trimContextLines(hunk.lines, 2);
      }
    }

    const totalHunks = parsedFiles.reduce((n, f) => n + f.hunks.length, 0);
    const totalAdditions = parsedFiles.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.filter(l => l.startsWith('+')).length, 0), 0);
    const totalDeletions = parsedFiles.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.filter(l => l.startsWith('-')).length, 0), 0);

    const result = { base, staged, changedFiles: parsedFiles, summary: { files: parsedFiles.length, hunks: totalHunks, additions: totalAdditions, deletions: totalDeletions } };
    CacheManager.set(cacheKey, result, 60);
    res.json(result);
  } catch (error) {
    logger.error('Diff-context handler error', { error: error.message });
    res.status(500).json({ error: 'Diff context failed', message: error.message });
  }
}

module.exports = { diffContextHandler };

// src/handlers/refreshHandler.js
// Roslyn + ctags auto-refresh with change detection
const { SymbolService } = require('../services/symbolService');
const { ToolExecutor } = require('../utils/toolExecutor');
const logger = require('../utils/logger');
const config = require('../config/config');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');

let _lastSymbolsHash = null;
let _lastRunAt = 0;
const MIN_RERUN_INTERVAL_MS = 30000;

function gitHasChanges() {
  try {
    const staged = execSync('git diff --name-only HEAD -- "*.cs"', { cwd: config.repoRoot, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const unstaged = execSync('git ls-files --others --exclude-standard -- "*.cs"', { cwd: config.repoRoot, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return staged.length > 0 || unstaged.length > 0;
  } catch (_) { return false; }
}

function hashSymbolsFile() {
  try {
    if (!fs.existsSync(config.symbolsFile)) return null;
    const buf = fs.readFileSync(config.symbolsFile);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch (_) { return null; }
}

function shouldReExtract() {
  const now = Date.now();
  if (_lastRunAt > 0 && now - _lastRunAt < MIN_RERUN_INTERVAL_MS) return { needed: false, reason: 'debounced' };
  if (!fs.existsSync(config.symbolsFile)) return { needed: true, reason: 'symbols.json missing' };
  if (gitHasChanges()) return { needed: true, reason: 'git detected C# source changes' };

  const currentHash = hashSymbolsFile();
  if (_lastSymbolsHash === null) { _lastSymbolsHash = currentHash; return { needed: false, reason: 'first hash recorded' }; }
  if (currentHash !== _lastSymbolsHash) {
    SymbolService.refreshSymbols();
    _lastSymbolsHash = currentHash;
    return { needed: false, reason: 'symbols.json externally updated; caches refreshed' };
  }
  return { needed: false, reason: 'no changes detected' };
}

async function refreshHandler(req, res) {
  try {
    const force = req.body?.force === true;
    const { needed, reason } = force ? { needed: true, reason: 'forced by caller' } : shouldReExtract();

    if (!needed) return res.json({ timestamp: new Date().toISOString(), skipped: true, reason, results: [] });

    const results = [];

    // 1. Roslyn symbol extraction
    try {
      const solutionPath = path.join(config.repoRoot, 'Energy_ReconversionSystem.sln');
      const outFile = config.symbolsFile;
      const extractorBase = path.join(config.repoRoot, 'tools/code-analyzer/ai_tools_setup/RoslynSymbolExtractor/bin');

      const exeCandidates = [
        path.join(extractorBase, 'Release/net48/RoslynSymbolExtractor.exe'),
        path.join(extractorBase, 'Debug/net48/RoslynSymbolExtractor.exe'),
      ];
      const exePath = exeCandidates.find(p => fs.existsSync(p));

      if (exePath) {
        await ToolExecutor.executeSpawn(exePath, [solutionPath, outFile, '--json']);
      } else {
        const scriptPath = path.join(config.repoRoot, 'tools/code-analyzer/ai_tools_setup/run_symbol_extractor.ps1');
        if (fs.existsSync(scriptPath)) {
          await ToolExecutor.executeSpawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-SolutionPath', solutionPath]);
        }
      }

      SymbolService.refreshSymbols();
      _lastSymbolsHash = hashSymbolsFile();
      _lastRunAt = Date.now();
      results.push({ task: 'symbol-extraction', status: 'success' });
    } catch (error) {
      results.push({ task: 'symbol-extraction', status: 'failed', error: error.message });
    }

    // 2. ctags regeneration
    try {
      await ToolExecutor.executeSpawn('ctags', ['-R', '--languages=C#', '--output-format=json', '-f', config.tagsFile, config.repoRoot]);
      results.push({ task: 'ctags-regeneration', status: 'success' });
    } catch (error) {
      results.push({ task: 'ctags-regeneration', status: 'failed', error: error.message });
    }

    res.json({ timestamp: new Date().toISOString(), skipped: false, reason, results });
  } catch (error) {
    logger.error('Refresh handler error', { error: error.message });
    res.status(500).json({ error: 'Refresh failed', message: error.message });
  }
}

function autoRefreshMiddleware(req, res, next) {
  if (req.path === '/refresh' || req.path === '/health') return next();
  const { needed, reason } = shouldReExtract();
  if (needed) {
    refreshHandler({ body: { force: true } }, { json: () => {} }).catch(() => {});
  }
  next();
}

module.exports = { refreshHandler, autoRefreshMiddleware };

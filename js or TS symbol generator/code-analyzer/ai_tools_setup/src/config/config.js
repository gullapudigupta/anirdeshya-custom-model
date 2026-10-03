// src/config/config.js
// Sidecar configuration — paths adjusted for new location under tools/code-analyzer/ai_tools_setup/
const path = require('path');

const REPO_ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '../../../../..');

module.exports = {
  port: process.env.SIDECAR_PORT || process.env.PORT || 3001,
  host: process.env.SIDECAR_HOST || 'localhost',
  repoRoot: REPO_ROOT,
  artifactsDir: path.join(REPO_ROOT, 'tools/code-analyzer/ai_tools_setup/artifacts'),
  symbolsFile: path.join(REPO_ROOT, 'tools/code-analyzer/ai_tools_setup/symbols/symbols.json'),
  tagsFile: path.join(REPO_ROOT, 'tools/code-analyzer/ai_tools_setup/artifacts/tags'),
  toolsDir: path.join(REPO_ROOT, 'tools'),
  cacheDir: path.join(REPO_ROOT, 'tools/code-analyzer/ai_tools_setup/.cache'),
  cacheTTL: 3600, // 1 hour in seconds
  maxSearchResults: 50,
  maxSnippetLines: 30,
  minSnippetContext: 5,
  rateLimit: {
    windowMs: 60000,
    maxRequests: 100
  },
  tools: {
    rg: 'rg',
    ctags: 'ctags',
    treeSitter: 'tree-sitter',
    git: 'git'
  }
};

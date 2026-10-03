#!/usr/bin/env node
/**
 * Parikrama Sidecar MCP Server (Standalone)
 * 
 * Exposes C#/Roslyn sidecar tools via MCP protocol.
 * Forwards calls to the Express API on localhost:3001.
 * 
 * Tools:
 *   health, search_code, lookup_symbols, get_snippet, get_signature,
 *   get_outline, get_callers, get_diff_context, get_ast_node,
 *   compose_context, refresh_index, get_token_analytics
 * 
 * Usage:
 *   node tools/code-analyzer/ai_tools_setup/mcp-server.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http = require('http');
const readline = require('readline');

const SIDECAR_HOST = process.env.MCP_SIDECAR_HOST || process.env.SIDECAR_HOST || 'localhost';
const SIDECAR_PORT = parseInt(process.env.MCP_SIDECAR_PORT || process.env.SIDECAR_PORT || '3001', 10);

function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: SIDECAR_HOST,
      port: SIDECAR_PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (_) { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function qs(params) {
  const p = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return p ? '?' + p : '';
}

const TOOLS = [
  {
    name: 'health',
    description: 'Check sidecar API status and resource availability.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async call() { return httpRequest('GET', '/health'); },
  },
  {
    name: 'search_code',
    description: 'Full-text search across C# source files using ripgrep. Returns file, line, text, and enclosing symbol.',
    inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'Search query or regex (required)' }, limit: { type: 'integer', description: 'Max results (default 10)' } }, required: ['q'] },
    async call({ q, limit }) { return httpRequest('GET', `/search${qs({ q, limit })}`); },
  },
  {
    name: 'lookup_symbols',
    description: 'Look up C# symbols (classes, methods, properties) from Roslyn+ctags merged index.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Symbol name (fuzzy match)' }, file: { type: 'string', description: 'Relative .cs file path' }, all: { type: 'boolean', description: 'Return first 100 symbols' } } },
    async call({ query, file, all }) { return httpRequest('GET', `/symbols${qs({ query, file, all: all ? 'true' : undefined })}`); },
  },
  {
    name: 'get_snippet',
    description: 'Get source lines around a line number. Use for context at a specific location.',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Relative .cs file path' }, line: { type: 'integer', description: 'Centre line number' }, context: { type: 'integer', description: 'Lines of context (default 5)' } }, required: ['file', 'line'] },
    async call({ file, line, context }) { return httpRequest('GET', `/snippet${qs({ file, start: line, context })}`); },
  },
  {
    name: 'get_signature',
    description: 'CHEAPEST LOOKUP. Declaration line(s) only (~80 chars). No body.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Symbol name' }, file: { type: 'string', description: 'Restrict to file' }, line: { type: 'integer', description: 'Line number (requires file)' } } },
    async call({ query, file, line }) { return httpRequest('GET', `/signature${qs({ query, file, line })}`); },
  },
  {
    name: 'get_outline',
    description: 'File structural outline: all symbols with kind+line, NO bodies. ~200 chars for 500-line file.',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Relative .cs file (required)' }, kind: { type: 'string', description: 'Filter: method,property,field,class' }, flat: { type: 'boolean', description: 'Flat sorted list' } }, required: ['file'] },
    async call({ file, kind, flat }) { return httpRequest('GET', `/outline${qs({ file, kind, flat: flat ? 'true' : undefined })}`); },
  },
  {
    name: 'get_callers',
    description: 'Find all call-sites of a method. 10-15x cheaper than search+snippets.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Method/symbol name (required)' }, file: { type: 'string', description: 'Restrict to file' }, limit: { type: 'integer', description: 'Max results (default 30)' } }, required: ['name'] },
    async call({ name, file, limit }) { return httpRequest('GET', `/callers${qs({ name, file, limit })}`); },
  },
  {
    name: 'get_diff_context',
    description: 'Changed C# lines annotated with enclosing symbol. 20-50x smaller than full files.',
    inputSchema: { type: 'object', properties: { base: { type: 'string', description: 'Branch/commit (default: HEAD)' }, staged: { type: 'boolean', description: 'Only staged changes' } } },
    async call({ base, staged }) { return httpRequest('GET', `/diff-context${qs({ base, staged: staged ? 'true' : undefined })}`); },
  },
  {
    name: 'get_ast_node',
    description: 'Tree-sitter C# AST extraction. Full method/class bodies with exact line ranges.',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Relative .cs file (required)' }, extract: { type: 'string', description: '"methods" or "classes"' }, type: { type: 'string', description: 'AST node type e.g. "method_declaration"' } }, required: ['file'] },
    async call({ file, extract, type }) { return httpRequest('GET', `/ast-node${qs({ file, extract, type })}`); },
  },
  {
    name: 'compose_context',
    description: 'Token-budgeted LLM context bundle. Modes: compact (default), signatures (cheapest), full (most detail).',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Symbol/concept (required)' }, maxTokens: { type: 'integer', description: 'Token budget (default 2000)' }, mode: { type: 'string', enum: ['compact', 'signatures', 'full'] } }, required: ['query'] },
    async call({ query, maxTokens, mode }) { return httpRequest('POST', '/compose-context', { query, maxTokens, mode }); },
  },
  {
    name: 'refresh_index',
    description: 'Re-run Roslyn symbol extractor and regenerate ctags index.',
    inputSchema: { type: 'object', properties: { force: { type: 'boolean', description: 'Bypass change detection' } } },
    async call({ force }) { return httpRequest('POST', '/refresh', { force: force === true }); },
  },
  {
    name: 'get_token_analytics',
    description: 'Show token-reduction statistics per endpoint since API started.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async call() { return httpRequest('GET', '/analytics'); },
  },
];

const TOOL_MAP = Object.fromEntries(TOOLS.map(t => [t.name, t]));

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function replyError(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    reply(id, { protocolVersion: '2024-11-05', serverInfo: { name: 'parikrama-sidecar', version: '2.0.0' }, capabilities: { tools: {} } });
    return;
  }
  if (method === 'tools/list') {
    reply(id, { tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    return;
  }
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
    const tool = TOOL_MAP[name];
    if (!tool) { replyError(id, -32601, `Unknown tool: ${name}`); return; }
    try {
      const result = await tool.call(args);
      reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (err) { replyError(id, -32000, `Tool execution failed: ${err.message}`); }
    return;
  }
  if (id !== undefined && id !== null) replyError(id, -32601, `Method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try { await handleMessage(JSON.parse(trimmed)); } catch (err) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
  }
});
rl.on('close', () => process.exit(0));
process.stderr.write(`[parikrama-sidecar MCP] ready — forwarding to http://${SIDECAR_HOST}:${SIDECAR_PORT}\n`);

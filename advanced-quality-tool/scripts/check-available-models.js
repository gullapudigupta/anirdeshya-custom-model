#!/usr/bin/env node
/**
 * check-available-models.js
 *
 * Queries every configured provider and lists the exact models your API keys
 * can actually use. Run this before assigning models to tasks so your
 * recommendedModel arrays only contain models you genuinely have access to.
 *
 * Usage:
 *   node scripts/check-available-models.js
 *   node scripts/check-available-models.js --json          # machine-readable output
 *   node scripts/check-available-models.js --update-tasks  # patch phase9-tasks.json
 *
 * Providers checked:
 *   - OpenAI     (OPENAI_API_KEY)
 *   - Anthropic  (ANTHROPIC_API_KEY)
 *   - DeepSeek   (DEEPSEEK_API_KEY)       ← not in .env.example yet, add if needed
 *   - Ollama     (AQT_LOCAL_MODEL_URL)    ← local, no key needed
 *
 * Add a provider: implement a new entry in PROVIDERS below.
 */

'use strict';

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

// ─── Load .env if present ────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
}

// ─── CLI flags ───────────────────────────────────────────────────────────────
const args         = process.argv.slice(2);
const JSON_MODE    = args.includes('--json');
const UPDATE_TASKS = args.includes('--update-tasks');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simple HTTPS/HTTP GET that returns parsed JSON */
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib     = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => reject(new Error('Request timed out (5s)')), 5000);
    lib.get(url, { headers }, res => {
      clearTimeout(timeout);
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    }).on('error', e => { clearTimeout(timeout); reject(e); });
  });
}

function log(...args) { if (!JSON_MODE) console.log(...args); }
function hr()         { log('─'.repeat(60)); }

// ─── Provider definitions ─────────────────────────────────────────────────────
//
// Each provider object has:
//   name        — display name
//   envKey      — environment variable that holds the API key
//   keyPrefix   — expected key prefix (used for key format validation)
//   check()     — async function; returns { available, models, error, note }
//
const PROVIDERS = [

  // ── OpenAI ─────────────────────────────────────────────────────────────────
  {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    keyPrefix: 'sk-',
    docsUrl: 'https://platform.openai.com/api-keys',
    async check() {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return { available: false, models: [], error: 'OPENAI_API_KEY not set' };
      if (!key.startsWith('sk-')) return { available: false, models: [], error: 'Key looks malformed (expected sk-…)' };

      try {
        const { status, data } = await get('https://api.openai.com/v1/models', {
          Authorization: `Bearer ${key}`
        });

        if (status === 401) return { available: false, models: [], error: 'API key rejected (401 Unauthorized)' };
        if (status === 429) return { available: false, models: [], error: 'Rate limited (429) — key is valid but throttled' };
        if (status !== 200) return { available: false, models: [], error: `Unexpected status ${status}` };

        // Filter to the most relevant chat/code/reasoning models
        const relevant = (data.data || [])
          .map(m => m.id)
          .filter(id => /^(gpt-|o1|o3|o4)/.test(id))
          .sort();

        return { available: true, models: relevant, note: `${relevant.length} chat/code models available` };
      } catch (e) {
        return { available: false, models: [], error: e.message };
      }
    }
  },

  // ── Anthropic ──────────────────────────────────────────────────────────────
  {
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    docsUrl: 'https://console.anthropic.com/',
    async check() {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) return { available: false, models: [], error: 'ANTHROPIC_API_KEY not set' };
      if (!key.startsWith('sk-ant-')) return { available: false, models: [], error: 'Key looks malformed (expected sk-ant-…)' };

      // Anthropic has a /v1/models endpoint (added 2024)
      try {
        const { status, data } = await get('https://api.anthropic.com/v1/models', {
          'x-api-key':         key,
          'anthropic-version': '2023-06-01'
        });

        if (status === 401) return { available: false, models: [], error: 'API key rejected (401 Unauthorized)' };
        if (status === 403) return { available: false, models: [], error: 'Forbidden (403) — check account permissions' };
        if (status !== 200) {
          // Fallback: key looks valid, list known tiers based on common availability
          return {
            available: true,
            models: ['claude-haiku-4', 'claude-sonnet-4-5', 'claude-opus-4'],
            note: `Could not list models (status ${status}) — showing known tier names. Verify at console.anthropic.com`
          };
        }

        const models = (data.data || []).map(m => m.id).sort();
        return { available: true, models, note: `${models.length} models available` };
      } catch (e) {
        return { available: false, models: [], error: e.message };
      }
    }
  },

  // ── DeepSeek ───────────────────────────────────────────────────────────────
  {
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    keyPrefix: 'sk-',
    docsUrl: 'https://platform.deepseek.com/api-keys',
    note: '⚠  Not yet in .env.example — add DEEPSEEK_API_KEY= to enable',
    async check() {
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) return {
        available: false,
        models: [],
        error: 'DEEPSEEK_API_KEY not set',
        setupNote: 'Add DEEPSEEK_API_KEY=sk-... to your .env file. Get a key at https://platform.deepseek.com/api-keys'
      };

      try {
        const { status, data } = await get('https://api.deepseek.com/models', {
          Authorization: `Bearer ${key}`
        });

        if (status === 401) return { available: false, models: [], error: 'API key rejected (401 Unauthorized)' };
        if (status !== 200) return { available: false, models: [], error: `Unexpected status ${status}` };

        const models = (data.data || []).map(m => m.id).sort();
        return { available: true, models, note: `${models.length} models available` };
      } catch (e) {
        return { available: false, models: [], error: e.message };
      }
    }
  },

  // ── Ollama (local) ─────────────────────────────────────────────────────────
  {
    name: 'Ollama (Local)',
    envKey: 'AQT_LOCAL_MODEL_URL',
    keyPrefix: null,
    docsUrl: 'https://ollama.ai',
    async check() {
      const baseUrl = process.env.AQT_LOCAL_MODEL_URL || 'http://localhost:11434';

      try {
        const { status, data } = await get(`${baseUrl}/api/tags`);
        if (status !== 200) return { available: false, models: [], error: `Ollama not reachable at ${baseUrl} (status ${status})` };

        const models = (data.models || []).map(m => m.name).sort();
        return {
          available: models.length > 0,
          models,
          note: models.length > 0
            ? `${models.length} local models pulled`
            : 'Ollama is running but no models pulled yet. Run: ollama pull codellama'
        };
      } catch (e) {
        return {
          available: false,
          models: [],
          error: `Cannot reach Ollama at ${baseUrl} — is it running? Try: ollama serve`,
          setupNote: 'Install from https://ollama.ai then run: ollama serve && ollama pull codellama'
        };
      }
    }
  }
];

// ─── Known model → provider mapping (for task recommendations) ───────────────
//
// Maps the model IDs used in phase9-tasks.json to the provider that serves them.
// Used when --update-tasks is passed to flag unavailable recommendations.
//
const MODEL_PROVIDER_MAP = {
  // OpenAI
  'gpt-4o-mini':    'OpenAI',
  'gpt-4.1':        'OpenAI',
  'o1-mini':        'OpenAI',
  'o3-mini':        'OpenAI',
  'gpt-4o':         'OpenAI',
  // Anthropic
  'claude-haiku-4': 'Anthropic',
  'claude-haiku-4-5': 'Anthropic',
  'claude-sonnet-4-5': 'Anthropic',
  'claude-opus-4':  'Anthropic',
  'claude-opus-5':  'Anthropic',
  // DeepSeek
  'deepseek-v4-flash':  'DeepSeek',
  'deepseek-v4-pro':    'DeepSeek',
  'deepseek-r1':        'DeepSeek',
  'deepseek-coder':     'Ollama (Local)',
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log('\n🔍 AQT — Available Model Check');
  log(`   Env file: ${fs.existsSync(envPath) ? envPath : '(no .env found — using process.env)'}`);
  hr();

  const results = {};

  for (const provider of PROVIDERS) {
    log(`\n▶  Checking ${provider.name}…`);
    if (provider.note) log(`   ${provider.note}`);

    const r = await provider.check();
    results[provider.name] = { ...r, providerDef: provider };

    if (r.available) {
      log(`   ✅ AVAILABLE`);
      if (r.note) log(`   ℹ  ${r.note}`);
      if (r.models.length > 0) {
        log(`   Models:`);
        r.models.forEach(m => log(`     • ${m}`));
      }
    } else {
      log(`   ❌ NOT AVAILABLE`);
      log(`   Reason : ${r.error}`);
      if (r.setupNote) log(`   Setup  : ${r.setupNote}`);
      else             log(`   Docs   : ${provider.docsUrl}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  hr();
  log('\n📋 SUMMARY\n');

  const allAvailableModels = [];
  for (const [name, r] of Object.entries(results)) {
    const icon = r.available ? '✅' : '❌';
    log(`   ${icon} ${name.padEnd(20)} ${r.available ? `(${r.models.length} models)` : r.error}`);
    if (r.available) allAvailableModels.push(...r.models.map(m => ({ model: m, provider: name })));
  }

  // ── Cross-check phase9-tasks.json ─────────────────────────────────────────
  hr();
  log('\n🔗 PHASE 9 TASKS — MODEL AVAILABILITY CHECK\n');

  const tasksPath = path.join(__dirname, '..', 'tasks', 'phase9-tasks.json');
  if (!fs.existsSync(tasksPath)) {
    log('   phase9-tasks.json not found — skipping task cross-check');
  } else {
    const tasks       = JSON.parse(fs.readFileSync(tasksPath, 'utf8')).tasks;
    const issues      = [];
    const taskReport  = [];

    for (const task of tasks) {
      const models  = Array.isArray(task.recommendedModel)
        ? task.recommendedModel
        : [task.recommendedModel];

      const modelStatuses = models.map(modelId => {
        const providerName  = MODEL_PROVIDER_MAP[modelId];
        const providerResult = providerName && results[providerName];
        const modelExists   = providerResult?.available &&
                              providerResult.models.some(m =>
                                m === modelId || m.startsWith(modelId.replace(/-\d+$/, ''))
                              );

        // For providers that returned no models list (Anthropic fallback), trust if provider available
        const providerAvailable = providerResult?.available ?? false;

        return {
          modelId,
          providerName: providerName || 'UNKNOWN',
          providerAvailable,
          modelFound: modelExists || (providerAvailable && !providerResult?.models?.length),
          status: !providerName              ? '⚠ UNKNOWN_PROVIDER'
                : !providerAvailable         ? '❌ PROVIDER_UNAVAILABLE'
                : modelExists                ? '✅ AVAILABLE'
                : providerAvailable          ? '⚠ MODEL_UNCERTAIN'
                                             : '❌ NOT_FOUND'
        };
      });

      const hasAtLeastOneAvailable = modelStatuses.some(s => s.status.startsWith('✅') || s.status.startsWith('⚠ MODEL'));
      const firstAvailable = modelStatuses.find(s => s.status.startsWith('✅') || s.status.startsWith('⚠ MODEL'));

      taskReport.push({ task, modelStatuses, hasAtLeastOneAvailable, firstAvailable });

      if (!hasAtLeastOneAvailable) {
        issues.push({ taskId: task.id, taskName: task.name, models, modelStatuses });
      }
    }

    // Print problematic tasks
    if (issues.length === 0) {
      log('   ✅ All tasks have at least one available model in their array');
    } else {
      log(`   ⚠  ${issues.length} tasks have NO available model in their recommendedModel array:\n`);
      for (const issue of issues) {
        log(`   ${issue.taskId} — ${issue.taskName}`);
        issue.modelStatuses.forEach(s =>
          log(`     ${s.status.padEnd(25)} ${s.modelId} (via ${s.providerName})`)
        );
        log('');
      }
    }

    // Print full per-task report in verbose / JSON mode
    if (JSON_MODE) {
      // handled below
    } else {
      log('\n   Per-task first-choice model status:');
      log('   ' + '─'.repeat(56));
      for (const { task, modelStatuses, firstAvailable } of taskReport) {
        const first = modelStatuses[0];
        const icon  = first.status.startsWith('✅') ? '✅'
                    : first.status.startsWith('⚠')  ? '⚠ '
                    : '❌';
        log(`   ${icon} ${task.id.padEnd(9)} ${first.modelId.padEnd(25)} ${first.providerName}`);
      }
    }

    // ── --update-tasks: write suggested model arrays back ─────────────────
    if (UPDATE_TASKS) {
      log('\n⚙  --update-tasks: rewriting recommendedModel arrays based on actual availability…');

      const phase9 = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
      let changed  = 0;

      for (const { task, modelStatuses } of taskReport) {
        const available = modelStatuses.filter(s =>
          s.status.startsWith('✅') || s.status.startsWith('⚠ MODEL')
        );

        if (available.length < modelStatuses.length) {
          const phaseTask = phase9.tasks.find(t => t.id === task.id);
          if (phaseTask) {
            const newArray = available.length > 0
              ? available.map(s => s.modelId)
              : ['<NO_AVAILABLE_MODEL — ADD KEY>'];
            phaseTask.recommendedModel  = newArray;
            phaseTask.modelRationale    = phaseTask.modelRationale
              + ' [Updated by check-available-models.js — removed unavailable providers]';
            changed++;
          }
        }
      }

      if (changed > 0) {
        fs.writeFileSync(tasksPath, JSON.stringify(phase9, null, 2));
        log(`   ✅ Updated ${changed} tasks. Backup not created — use git diff to review.`);
      } else {
        log('   ✅ No changes needed — all model arrays already reflect available providers.');
      }
    }
  }

  // ── JSON output ────────────────────────────────────────────────────────────
  if (JSON_MODE) {
    const output = {
      timestamp: new Date().toISOString(),
      providers: Object.fromEntries(
        Object.entries(results).map(([name, r]) => [name, {
          available: r.available,
          models:    r.models,
          error:     r.error || null,
          note:      r.note  || null
        }])
      ),
      allAvailableModels
    };
    console.log(JSON.stringify(output, null, 2));
  }

  hr();
  log('\n💡 TIP: Add missing API keys to your .env file to unlock more models.');
  log('   • OpenAI  → https://platform.openai.com/api-keys');
  log('   • Anthropic → https://console.anthropic.com/');
  log('   • DeepSeek  → https://platform.deepseek.com/api-keys   (add DEEPSEEK_API_KEY to .env)');
  log('   • Ollama    → https://ollama.ai  (run: ollama serve && ollama pull codellama)\n');
}

main().catch(e => { console.error(e); process.exit(1); });

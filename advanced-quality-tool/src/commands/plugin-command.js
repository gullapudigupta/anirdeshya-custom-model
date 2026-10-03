'use strict';
/**
 * aqt plugin - Manage AQT plugins
 *
 * P11-T052: Plugin System CLI
 */

const path = require('path');
const fs   = require('fs');

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m'
};

// ─── Run ────────────────────────────────────────────────────────────────────

async function run(args) {
  const [subcommand, ...subArgs] = args;
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  const workspace  = resolveWorkspace(subArgs);
  const pluginsDir = path.join(workspace, '.aqt', 'plugins');
  const verbose    = subArgs.includes('--verbose') || subArgs.includes('-v');

  const { PluginManager } = require('../plugins/plugin-system');
  const manager = new PluginManager({
    pluginDirs: [pluginsDir],
    verbose
  });

  try {
    switch (subcommand) {
      case 'list':
        return await listPlugins(manager, subArgs);

      case 'install':
        return await installPlugin(manager, subArgs, pluginsDir);

      case 'remove':
      case 'uninstall':
        return await removePlugin(manager, subArgs, pluginsDir);

      case 'info':
        return await pluginInfo(manager, subArgs);

      case 'reload':
        return await reloadPlugin(manager, subArgs);

      case 'stats':
        return await pluginStats(manager);

      default:
        console.error(`\n${c.red}❌ Unknown subcommand: ${subcommand}${c.reset}\n`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(`\n${c.red}❌ Plugin command failed: ${error.message}${c.reset}\n`);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

async function listPlugins(manager, args) {
  await manager.initialize();
  const plugins = manager.listPlugins();
  const stats   = manager.getStats();

  if (args.includes('--json')) {
    console.log(JSON.stringify({ plugins, stats }, null, 2));
    return;
  }

  console.log(`\n${c.bold}Installed Plugins${c.reset} (${plugins.length})\n`);

  if (plugins.length === 0) {
    console.log(`  ${c.gray}No plugins installed.${c.reset}`);
    console.log(`  Use ${c.cyan}aqt plugin install <path>${c.reset} to add a plugin.\n`);
    return;
  }

  // Header
  const COL = { id: 22, name: 22, ver: 10 };
  console.log(
    `  ${c.bold}${'ID'.padEnd(COL.id)}${'Name'.padEnd(COL.name)}${'Version'.padEnd(COL.ver)}Description${c.reset}`
  );
  console.log('  ' + '─'.repeat(76));

  for (const p of plugins) {
    console.log(
      `  ${c.cyan}${(p.id      || '').padEnd(COL.id)}${c.reset}` +
      `${(p.name    || '').padEnd(COL.name)}` +
      `${(p.version || '').padEnd(COL.ver)}` +
      `${p.description || ''}`
    );
  }

  console.log(
    `\n  ${stats.pluginsLoaded || plugins.length} loaded  ` +
    `${stats.hooksRegistered || 0} hooks  ` +
    `${stats.rulesRegistered || 0} rules\n`
  );
}

async function installPlugin(manager, args, pluginsDir) {
  const source = args.find(a => !a.startsWith('-'));
  if (!source) {
    console.error(
      `\n${c.red}❌ Plugin path required.  ` +
      `Usage: aqt plugin install <path>${c.reset}\n`
    );
    process.exit(1);
  }

  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath)) {
    console.error(`\n${c.red}❌ File not found: ${sourcePath}${c.reset}\n`);
    process.exit(1);
  }

  console.log(`\n📦 Installing plugin from: ${sourcePath}\n`);

  // Ensure plugins dir exists
  fs.mkdirSync(pluginsDir, { recursive: true });

  const dest = path.join(pluginsDir, path.basename(sourcePath));

  try {
    if (fs.statSync(sourcePath).isDirectory()) {
      copyDir(sourcePath, dest);
    } else {
      fs.copyFileSync(sourcePath, dest);
    }
  } catch (err) {
    throw new Error(`Copy failed: ${err.message}`);
  }

  // Reload manager to pick up the new plugin
  await manager.initialize();
  const plugins = manager.listPlugins();

  console.log(`${c.green}✅ Plugin installed.${c.reset}`);
  console.log(`   Location : ${dest}`);
  console.log(`   Loaded   : ${plugins.length} plugin(s) total\n`);
}

async function removePlugin(manager, args, pluginsDir) {
  const pluginId = args.find(a => !a.startsWith('-'));
  if (!pluginId) {
    console.error(
      `\n${c.red}❌ Plugin ID required.  ` +
      `Usage: aqt plugin remove <id>${c.reset}\n`
    );
    process.exit(1);
  }

  await manager.initialize();
  const plugin = manager.getPlugin(pluginId);

  if (!plugin) {
    console.error(`\n${c.red}❌ Plugin not found: ${pluginId}${c.reset}\n`);
    process.exit(1);
  }

  const pluginPath = plugin.path;
  const unloaded   = await manager.unloadPlugin(pluginId);

  if (!unloaded) {
    console.error(`\n${c.red}❌ Failed to unload plugin: ${pluginId}${c.reset}\n`);
    process.exit(1);
  }

  // Remove from disk
  try {
    if (pluginPath && fs.existsSync(pluginPath)) {
      if (fs.statSync(pluginPath).isDirectory()) {
        fs.rmSync(pluginPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(pluginPath);
      }
    }
  } catch (err) {
    console.warn(`  ${c.yellow}⚠️  Could not delete plugin file: ${err.message}${c.reset}`);
  }

  console.log(`\n${c.green}✅ Plugin '${pluginId}' removed.${c.reset}\n`);
}

async function pluginInfo(manager, args) {
  const pluginId = args.find(a => !a.startsWith('-'));
  if (!pluginId) {
    console.error(
      `\n${c.red}❌ Plugin ID required.  ` +
      `Usage: aqt plugin info <id>${c.reset}\n`
    );
    process.exit(1);
  }

  await manager.initialize();
  const plugin = manager.getPlugin(pluginId);

  if (!plugin) {
    console.error(`\n${c.red}❌ Plugin not found: ${pluginId}${c.reset}\n`);
    process.exit(1);
  }

  if (args.includes('--json')) {
    // Avoid exposing compiled code in JSON output
    const safe = {
      manifest: plugin.manifest,
      path:     plugin.path,
      loaded:   !!plugin.instance
    };
    console.log(JSON.stringify(safe, null, 2));
    return;
  }

  const m = plugin.manifest || {};
  console.log(`\n${c.bold}Plugin: ${m.name || pluginId}${c.reset}`);
  console.log('─'.repeat(50));
  console.log(`  ID           ${m.id || '-'}`);
  console.log(`  Version      ${m.version || '-'}`);
  console.log(`  Description  ${m.description || '-'}`);
  console.log(`  Author       ${m.author || '-'}`);
  console.log(`  Path         ${plugin.path || '-'}`);
  console.log(`  Status       ${plugin.instance ? `${c.green}loaded${c.reset}` : `${c.gray}unloaded${c.reset}`}`);

  if (m.hooks && m.hooks.length > 0) {
    console.log(`  Hooks        ${m.hooks.join(', ')}`);
  }
  if (m.rules && m.rules.length > 0) {
    const ruleIds = m.rules.map(r => (typeof r === 'string' ? r : r.id));
    console.log(`  Rules        ${ruleIds.join(', ')}`);
  }
  if (m.dependencies && Object.keys(m.dependencies).length > 0) {
    console.log(`  Dependencies ${Object.keys(m.dependencies).join(', ')}`);
  }
  console.log('');
}

async function reloadPlugin(manager, args) {
  const pluginId = args.find(a => !a.startsWith('-'));
  if (!pluginId) {
    console.error(
      `\n${c.red}❌ Plugin ID required.  ` +
      `Usage: aqt plugin reload <id>${c.reset}\n`
    );
    process.exit(1);
  }

  await manager.initialize();
  const success = await manager.reloadPlugin(pluginId);

  if (success) {
    console.log(`\n${c.green}✅ Plugin '${pluginId}' reloaded.${c.reset}\n`);
  } else {
    console.error(`\n${c.red}❌ Failed to reload plugin: ${pluginId}${c.reset}\n`);
    process.exit(1);
  }
}

async function pluginStats(manager) {
  await manager.initialize();
  const stats = manager.getStats();
  console.log(`\n${c.bold}Plugin System Stats${c.reset}\n`);
  for (const [k, v] of Object.entries(stats)) {
    console.log(`  ${k.padEnd(22)} ${v}`);
  }
  console.log('');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function resolveWorkspace(args) {
  const idx = args.findIndex(a => a === '--workspace' || a === '-w');
  return idx >= 0 ? path.resolve(args[idx + 1]) : process.cwd();
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
aqt plugin - Manage AQT plugins

${c.bold}Usage:${c.reset}
  aqt plugin <subcommand> [options]

${c.bold}Subcommands:${c.reset}
  list                    List installed plugins
  install <path>          Install a plugin from file or directory
  remove  <id>            Remove an installed plugin
  info    <id>            Show plugin details
  reload  <id>            Reload a plugin at runtime
  stats                   Show plugin system statistics

${c.bold}Options:${c.reset}
  --workspace, -w         Project directory (default: current directory)
  --json                  Output as JSON (for list, info)
  --verbose, -v           Verbose output
  --help, -h              Show this help

${c.bold}Plugin directory:${c.reset}
  .aqt/plugins/  (relative to workspace)

${c.bold}Plugin format:${c.reset}
  A plugin is a .js file with an embedded manifest comment, or a directory
  containing plugin.json + index.js.  See docs/plugins.md for the API.

${c.bold}Examples:${c.reset}
  aqt plugin list
  aqt plugin install ./my-plugin.js
  aqt plugin install ./my-plugin-dir/
  aqt plugin info    my-plugin-id
  aqt plugin remove  my-plugin-id
  aqt plugin reload  my-plugin-id
`);
}

module.exports = { run };

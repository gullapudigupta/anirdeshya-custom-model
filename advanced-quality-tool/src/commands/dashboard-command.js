'use strict';

const fs = require('fs');
const path = require('path');
const { DashboardIntegration } = require('../dashboard/dashboard-integration');

function configPath(workspace) {
  return path.join(workspace, '.aqt', 'dashboard.json');
}

function loadDashboardConfig(workspace) {
  const file = configPath(workspace);
  if (!fs.existsSync(file)) return { enabled: false, port: 3210, dataDir: path.join(workspace, '.aqt', 'dashboard-data') };
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    enabled: config.enabled === true,
    port: config.port || 3210,
    dataDir: config.dataDir || path.join(workspace, '.aqt', 'dashboard-data')
  };
}

function saveDashboardConfig(workspace, config) {
  const file = configPath(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function parseOptions(args) {
  const options = { workspace: process.cwd(), command: args[0] || 'status', values: {} };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--workspace' || args[i] === '-w') options.workspace = args[++i];
    else if (args[i] === '--port') options.values.port = Number(args[++i]);
    else if (args[i] === '--data-dir') options.values.dataDir = args[++i];
    else throw new Error(`Unknown dashboard option: ${args[i]}`);
  }
  if (!['config', 'enable', 'disable', 'status', 'record'].includes(options.command)) {
    throw new Error(`Unknown dashboard command: ${options.command}`);
  }
  if (options.values.port !== undefined &&
      (!Number.isInteger(options.values.port) || options.values.port < 1 || options.values.port > 65535)) {
    throw new Error('--port must be an integer between 1 and 65535');
  }
  return options;
}

function makeDashboard(workspace, config) {
  return new DashboardIntegration({
    port: config.port,
    dataDir: config.dataDir || path.join(workspace, '.aqt', 'dashboard-data')
  });
}

function recordIfEnabled(workspace, results, metadata = {}) {
  const config = loadDashboardConfig(path.resolve(workspace));
  if (!config.enabled) return null;
  return makeDashboard(path.resolve(workspace), config).recordScan(results, metadata);
}

async function run(args) {
  const options = parseOptions(args);
  const workspace = path.resolve(options.workspace);
  const config = loadDashboardConfig(workspace);

  if (options.command === 'config') {
    if (options.values.port !== undefined) config.port = options.values.port;
    if (options.values.dataDir !== undefined) config.dataDir = path.resolve(workspace, options.values.dataDir);
    saveDashboardConfig(workspace, config);
    console.log(JSON.stringify(config, null, 2));
    return config;
  }
  if (options.command === 'enable' || options.command === 'disable') {
    config.enabled = options.command === 'enable';
    saveDashboardConfig(workspace, config);
  } else if (options.command === 'record') {
    throw new Error('Use the analyze command to record metrics after an analysis run.');
  }

  const dashboard = makeDashboard(workspace, config);
  if (options.command === 'status') {
    console.log(JSON.stringify({
      enabled: config.enabled,
      port: config.port,
      dataDir: config.dataDir,
      scans: dashboard.history.length,
      current: dashboard.currentMetrics
    }, null, 2));
    return dashboard.getDashboardData();
  }
  console.log(`Dashboard metric recording ${config.enabled ? 'enabled' : 'disabled'}.`);
  return config;
}

module.exports = { run, parseOptions, loadDashboardConfig, saveDashboardConfig, recordIfEnabled };

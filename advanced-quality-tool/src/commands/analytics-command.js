'use strict';

const path = require('path');
const { UsageAnalytics } = require('../metrics/usage-analytics');

async function run(args) {
  const action = args[0] || 'status';
  const workspaceIndex = args.indexOf('--workspace');
  const workspace = workspaceIndex >= 0 ? path.resolve(args[workspaceIndex + 1]) : process.cwd();
  const analytics = new UsageAnalytics({ workspace });

  if (action === 'enable') {
    console.log(JSON.stringify(analytics.setEnabled(true), null, 2));
  } else if (action === 'disable') {
    console.log(JSON.stringify(analytics.setEnabled(false), null, 2));
  } else if (action === 'status') {
    console.log(JSON.stringify(analytics.status(), null, 2));
  } else if (action === 'report') {
    const daysIndex = args.indexOf('--days');
    const days = daysIndex >= 0 ? Number(args[daysIndex + 1]) : 30;
    console.log(JSON.stringify(analytics.report(days), null, 2));
  } else if (action === 'clear') {
    console.log(JSON.stringify(analytics.clear(), null, 2));
  } else {
    throw new Error('Usage: aqt analytics <enable|disable|status|report|clear> [--days n] [--workspace dir]');
  }
}

module.exports = { run };

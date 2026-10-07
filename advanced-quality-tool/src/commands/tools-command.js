'use strict';

const { listToolGroups, getToolGroup } = require('../core/tool-groups');

function formatToolGroups(groupId, json = false) {
  if (groupId) {
    const group = getToolGroup(groupId);
    if (!group) throw new Error(`Unknown tool group '${groupId}'. Run 'aqt tools' to list groups.`);
    if (json) return JSON.stringify(group, null, 2);
    return formatGroup(group);
  }

  const groups = listToolGroups();
  if (json) return JSON.stringify(groups, null, 2);
  return groups.map(formatGroup).join('\n\n');
}

function formatGroup(group) {
  const lines = [`${group.name} (${group.id})`, `  ${group.description}`];
  if (group.cliCommands.length) lines.push(`  CLI: ${group.cliCommands.map(command => `aqt ${command}`).join(', ')}`);
  if (group.apiEndpoints.length) lines.push(`  API: ${group.apiEndpoints.length} endpoints`);
  if (group.mcpTools.length) lines.push(`  MCP: ${group.mcpTools.join(', ')}`);
  return lines.join('\n');
}

async function run(args = []) {
  const positional = args.filter(arg => !arg.startsWith('--'));
  const json = args.includes('--json');
  const groupId = positional[0];
  console.log(formatToolGroups(groupId, json));
}

module.exports = { run, formatToolGroups };

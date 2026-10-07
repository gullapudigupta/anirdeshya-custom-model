#!/usr/bin/env node
'use strict';
const { parseArgs } = require('./lib/common');

const HELP = `Task toolkit (no model tokens needed for these commands)
  validate [--profile original|final]   check task files against the templates, write TEMPLATE_CONFORMANCE_*.md/json
  optimize                               assign equal-grade first-choice models, order tasks by cost band, add new properties
  next [--folder <name>]                 show the next cost batch to run per spec folder
  cost                                   estimated spend by first-choice model
  clarify <ID> --question "..." --answer "..." [--status confirmed|recorded_decision|awaiting_user_input]
  complete <ID> --model <id> --confidence 0..1 [--notes "..."] [--artifacts a,b] [--force]
  jev [<ID>] [--folder f] [--limit n] [--refresh] [--dry-run]   ask the JEV system for a model pick and store it
  models                                 list Copilot CLI models in the catalog with prices and the CLI id used by start-task.ps1
  scaffold [<ID>] [--dir <target>] [--dry-run]   run scriptable tasks that carry an automation block (js-script, $0)`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._.shift();
  switch (cmd) {
    case 'validate':
      return (
        require('./commands/validate').main?.(args) ??
        require('child_process').spawnSync(
          process.execPath,
          [require.resolve('./commands/validate'), ...process.argv.slice(3)],
          { stdio: 'inherit' },
        )
      );
    case 'optimize':
      return require('./commands/optimize').run();
    case 'next':
      return require('./commands/next').next(args);
    case 'cost':
      return require('./commands/next').cost();
    case 'clarify':
      console.log(
        JSON.stringify(
          require('./commands/clarify').recordClarification(require('./lib/common').loadFolders(), args._[0], args),
          null,
          2,
        ),
      );
      return;
    case 'complete':
      console.log(
        JSON.stringify(
          require('./commands/complete').completeTask(require('./lib/common').loadFolders(), args._[0], args),
          null,
          2,
        ),
      );
      return;
    case 'models': {
      const cat = require('./model-catalog.json');
      const map = require('./copilot-model-map.json').models || {};
      console.table(
        cat.models.map((m) => ({
          id: m.id,
          cliId: map[m.id] || m.id,
          grade: m.grade,
          'in/M': m.inputPerM,
          'out/M': m.outputPerM,
        })),
      );
      return;
    }
    case 'jev':
      return require('./commands/jev').run(args);
    case 'scaffold':
      return require('./commands/scaffold').runScripted(args);
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

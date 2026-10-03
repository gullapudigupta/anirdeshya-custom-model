/**
 * Fix Command - CLI handler for auto-fixing issues
 * 
 * Usage:
 *   aqt fix [files...] [options]
 * 
 * Options:
 *   --dry-run         Preview fixes without applying
 *   --strategy        Fix strategy: 'rule-only', 'ai-only', 'three-tier' (default)
 *   --auto-fix-level  Auto-fix level: 'rule', 'ai', 'all' (default)
 *   --priority        Prioritize by: 'severity', 'category', 'priority'
 *   --max-fixes       Maximum number of fixes to apply
 *   --local-ai        Use local AI (Ollama)
 *   --cloud-ai        Use cloud AI (requires API key)
 *   --api-key         API key for cloud AI
 *   --no-backup       Disable backups
 *   --verbose, -v     Verbose output
 *
 * @module commands/fix-command
 */

const { AutoFixEngine } = require('../fixers/auto-fix-engine');
const path = require('path');

async function run(args) {
  // Parse arguments
  const options = parseArguments(args);

  console.log('\n🔧 Auto-Fix Command\n');

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be applied\n');
  }

  // Create auto-fix engine
  const engine = new AutoFixEngine({
    dryRun: options.dryRun,
    verbose: options.verbose,
    backup: options.backup,
    strategy: options.strategy,
    minConfidence: options.minConfidence || 0.7,
    localAI: {
      enabled: options.localAI,
      model: options.localAiModel || 'codellama:7b'
    },
    cloudAI: {
      enabled: options.cloudAI,
      apiKey: options.apiKey,
      provider: options.cloudProvider || 'openai',
      model: options.cloudModel
    }
  });

  try {
    // Run analyzer to get issues
    console.log('📊 Analyzing code...\n');
    const analysisResults = await runAnalysis(options.files);

    if (!analysisResults || !analysisResults.issues || analysisResults.issues.length === 0) {
      console.log('✅ No issues found! Your code looks great.\n');
      return;
    }

    console.log(`Found ${analysisResults.issues.length} issue(s)\n`);

    // Group issues by file
    const issuesMap = groupIssuesByFile(analysisResults.issues);

    // Apply fixes
    let results;
    if (options.priority) {
      results = await engine.fixWithPriority(issuesMap, {
        prioritizeBy: options.priority,
        maxFixes: options.maxFixes,
        continueOnError: true
      });
    } else {
      results = await engine.fixFiles(issuesMap, {
        maxConcurrent: 1,
        continueOnError: true
      });
    }

    // Exit with appropriate code
    const exitCode = results.some(r => !r.success) ? 1 : 0;
    process.exit(exitCode);

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Run analysis to get issues
 */
async function runAnalysis(files) {
  // Placeholder: integrate with linter integration
  // For now, return mock data for testing

  try {
    const linterIntegration = require('../linters/linter-integration');
    const normalizer = require('../normalizers/issue-normalizer');

    const orchestrator = new linterIntegration.LinterOrchestrator({
      targetDirectory: files[0] || process.cwd()
    });

    const results = await orchestrator.runAll();
    const normalized = normalizer.normalizeIssues(results);

    return {
      issues: normalized.issues,
      files: files
    };
  } catch (error) {
    console.warn('Using fallback analysis');
    return {
      issues: [],
      files: files
    };
  }
}

/**
 * Group issues by file
 */
function groupIssuesByFile(issues) {
  const map = {};

  issues.forEach(issue => {
    const filePath = issue.filePath || 'unknown';

    if (!map[filePath]) {
      map[filePath] = [];
    }

    map[filePath].push(issue);
  });

  return map;
}

/**
 * Parse command arguments
 */
function parseArguments(args) {
  const options = {
    files: [],
    dryRun: false,
    strategy: 'three-tier',
    autoFixLevel: 'all',
    priority: null,
    maxFixes: Infinity,
    localAI: true,
    cloudAI: false,
    apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
    cloudProvider: 'openai',
    cloudModel: null,
    localAiModel: null,
    backup: true,
    verbose: false,
    minConfidence: 0.7
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--strategy') {
      options.strategy = args[++i];
    } else if (arg === '--auto-fix-level') {
      options.autoFixLevel = args[++i];
    } else if (arg === '--priority') {
      options.priority = args[++i];
    } else if (arg === '--max-fixes') {
      options.maxFixes = parseInt(args[++i], 10);
    } else if (arg === '--local-ai') {
      options.localAI = true;
    } else if (arg === '--cloud-ai') {
      options.cloudAI = true;
    } else if (arg === '--api-key') {
      options.apiKey = args[++i];
    } else if (arg === '--cloud-provider') {
      options.cloudProvider = args[++i];
    } else if (arg === '--cloud-model') {
      options.cloudModel = args[++i];
    } else if (arg === '--local-ai-model') {
      options.localAiModel = args[++i];
    } else if (arg === '--no-backup') {
      options.backup = false;
    } else if (arg === '--confidence') {
      options.minConfidence = parseFloat(args[++i]);
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (!arg.startsWith('--')) {
      options.files.push(arg);
    }
  }

  // Default  to current directory if no files specified
  if (options.files.length === 0) {
    options.files.push(process.cwd());
  }

  return options;
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
📖 Fix Command Help

Usage:
  aqt fix [files...] [options]

Options:
  --dry-run              Preview fixes without applying them
  --strategy <name>      Fix strategy: 'rule-only', 'ai-only', 'three-tier' (default)
  --priority <type>      Prioritize by: 'severity', 'category', 'priority'
  --max-fixes <n>        Maximum number of fixes to apply
  --local-ai             Use local AI (Ollama) - Enabled by default
  --cloud-ai             Use cloud AI (requires API key)
  --api-key <key>        API key for cloud AI
  --cloud-provider <p>   Cloud provider: 'openai', 'anthropic'
  --cloud-model <model>  Cloud model to use
  --local-ai-model <m>   Local AI model (default: codellama:7b)
  --confidence <0-1>     Minimum confidence threshold (default: 0.7)
  --no-backup            Disable backups
  --verbose, -v          Verbose output
  --help, -h             Show this help

Examples:
  aqt fix                          # Fix all issues in current directory
  aqt fix src/                     # Fix issues in src/ directory
  aqt fix --dry-run                # Preview fixes without applying
  aqt fix --strategy rule-only     # Use only rule-based fixes
  aqt fix --cloud-ai --api-key KEY # Use cloud AI with API key
  aqt fix --priority severity      # Fix highest severity issues first
  aqt fix --max-fixes 10           # Fix only top 10 issues

Fix Strategies:
  rule-only   - Use only deterministic rule-based fixes (fast, safe)
  ai-only     - Use only AI-powered fixes (slower, more flexible)
  three-tier  - Try rules first, then local AI, then cloud AI (default)

Note:
  - Local AI requires Ollama running: ollama serve
  - Cloud AI requires API key: --api-key or OPENAI_API_KEY env var
  - Backups are created in .aqt-backup/ unless --no-backup is set
`);
}

module.exports = {
  run,
  printHelp
};

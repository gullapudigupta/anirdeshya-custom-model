/**
 * Auto-Fix Orchestrator
 * 
 * Coordinates all fixers (rule-based and AI-powered) with intelligent fallback strategy.
 * Implements three-tier fix approach:
 * 1. Rule-based (ESLint, Prettier, StyleLint) - Fast, deterministic
 * 2. Local AI (Ollama) - Privacy-first, offline
 * 3. Cloud AI (OpenAI, Anthropic) - Highest quality, requires API key
 * 
 * @module fixers/auto-fix-engine
 */

const fs = require('fs');
const path = require('path');
const { RuleBasedFixEngine } = require('./rule-based-fixer');
const { AIFixCoordinator } = require('./ai-fixer');

/**
 * Remove the filesystem root from a path so it can be safely nested under a
 * backup directory. Handles Windows drive roots (`C:\`), UNC-ish leading
 * separators, and POSIX absolute paths. Relative paths are returned unchanged.
 *
 * @param {string} filePath
 * @returns {string} root-relative path
 */
function stripPathRoot(filePath) {
  const parsed = path.parse(filePath);
  if (!parsed.root) return filePath;
  // path.relative(root, filePath) yields the portion below the root without
  // the drive letter or leading separators.
  return path.relative(parsed.root, filePath);
}

/**
 * Auto-Fix Engine - Main orchestrator
 */
class AutoFixEngine {
  constructor(options = {}) {
    this.options = options;
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
    this.backup = options.backup !== false;
    this.backupDir = options.backupDir || '.aqt-backup';
    this.historyDir = options.historyDir || '.aqt-history';

    // Fix strategy
    this.strategy = options.strategy || 'three-tier'; // 'rule-only', 'ai-only', 'three-tier'
    this.minConfidence = options.minConfidence || 0.7;
    this.maxAttempts = options.maxAttempts || 3;

    // Initialize fixers
    this.ruleBasedEngine = new RuleBasedFixEngine({
      ...options,
      dryRun: this.dryRun,
      backup: this.backup,
      verbose: this.verbose
    });

    this.aiCoordinator = new AIFixCoordinator({
      ...options,
      dryRun: this.dryRun,
      verbose: this.verbose,
      localAI: options.localAI || { enabled: true },
      cloudAI: options.cloudAI || { enabled: false }
    });

    // Statistics
    this.stats = {
      totalIssues: 0,
      fixableIssues: 0,
      fixedByRule: 0,
      fixedByLocalAI: 0,
      fixedByCloudAI: 0,
      manualFixRequired: 0,
      failedFixes: 0,
      totalTime: 0
    };

    // Fix history
    this.fixHistory = [];
  }

  /**
   * Determine if issue can be fixed by rule-based approach
   */
  canFixByRule(issue) {
    // Issues explicitly marked as rule-fixable
    if (issue.fixable === true) return true;
    if (issue.autoFixLevel === 'RULE' || issue.autoFixLevel === 'AUTO') return true;

    // Common fixable rules
    const ruleFixablePatterns = [
      /semi$/,              // semicolons
      /quotes$/,            // quotes
      /indent/,             // indentation
      /spacing/,            // spacing
      /^prettier\//,        // prettier rules
      /^@stylistic\//,      // stylistic rules
      /no-trailing-spaces/, // whitespace
      /eol-last/,           // end of line
      /comma-dangle/        // trailing commas
    ];

    return ruleFixablePatterns.some(pattern => 
      issue.ruleId && pattern.test(issue.ruleId)
    );
  }

  /**
   * Determine if issue requires AI to fix
   */
  requiresAI(issue) {
    if (issue.autoFixLevel === 'AI') return true;

    // Complex issues that benefit from AI
    const aiRequiredPatterns = [
      /no-unused-vars/,     // Removing unused code requires understanding
      /complexity/,         // Reducing complexity
      /cognitive-complexity/,
      /max-lines/,          // Code splitting
      /max-params/,         // Parameter reduction
      /prefer-const/,       // const vs let requires scope analysis
      /require-await/       // async/await logic
    ];

    return aiRequiredPatterns.some(pattern => 
      issue.ruleId && pattern.test(issue.ruleId)
    );
  }

  /**
   * Fix a single file with all its issues
   */
  async fixFile(filePath, issues = []) {
    const startTime = Date.now();

    const result = {
      filePath,
      success: false,
      originalIssueCount: issues.length,
      fixedIssueCount: 0,
      remainingIssues: [],
      fixes: [],
      errors: [],
      time: 0,
      backupPath: null
    };

    try {
      this.log(`\n${'='.repeat(60)}`);
      this.log(`Fixing file: ${filePath}`);
      this.log(`Issues: ${issues.length}`);

      // Create backup
      if (!this.dryRun && this.backup) {
        result.backupPath = await this.createBackup(filePath);
      }

      // Categorize issues
      const ruleFixable = issues.filter(i => this.canFixByRule(i));
      const aiRequired = issues.filter(i => !this.canFixByRule(i) && this.requiresAI(i));
      const manualFix = issues.filter(i => !this.canFixByRule(i) && !this.requiresAI(i));

      this.log(`  Rule-fixable: ${ruleFixable.length}`);
      this.log(`  AI-required: ${aiRequired.length}`);
      this.log(`  Manual-fix: ${manualFix.length}`);

      // Phase 1: Rule-based fixes
      if (ruleFixable.length > 0 && this.strategy !== 'ai-only') {
        this.log(`\nPhase 1: Applying rule-based fixes...`);
        const ruleResult = await this.applyRuleFixes(filePath, ruleFixable);

        result.fixes.push(...ruleResult.fixes);
        result.fixedIssueCount += ruleResult.fixedCount;
        this.stats.fixedByRule += ruleResult.fixedCount;
      }

      // Phase 2: AI fixes
      if (aiRequired.length > 0 && this.strategy !== 'rule-only') {
        this.log(`\nPhase 2: Applying AI fixes...`);
        const aiResult = await this.applyAIFixes(filePath, aiRequired);

        result.fixes.push(...aiResult.fixes);
        result.fixedIssueCount += aiResult.fixedCount;

        // Track which AI fixed it
        aiResult.fixes.forEach(fix => {
          if (fix.usedFixer === 'local') this.stats.fixedByLocalAI++;
          if (fix.usedFixer === 'cloud') this.stats.fixedByCloudAI++;
        });
      }

      // Remaining issues
      result.remainingIssues = [
        ...manualFix,
        ...this.getUnfixedIssues(issues, result.fixes)
      ];

      this.stats.manualFixRequired += result.remainingIssues.length;

      result.success = result.fixedIssueCount > 0;
      result.time = Date.now() - startTime;
      this.stats.totalTime += result.time;

      // Save to history
      this.addToHistory(result);

      this.log(`\nFixed ${result.fixedIssueCount}/${issues.length} issues in ${result.time}ms`);

    } catch (error) {
      result.errors.push(error.message);
      this.stats.failedFixes++;
      this.log(`Error fixing file: ${error.message}`);

      // Restore backup on error
      if (result.backupPath && !this.dryRun) {
        await this.restoreBackup(filePath, result.backupPath);
      }
    }

    return result;
  }

  /**
   * Apply rule-based fixes
   */
  async applyRuleFixes(filePath, issues) {
    const result = {
      fixedCount: 0,
      fixes: [],
      errors: []
    };

    try {
      const fixResult = await this.ruleBasedEngine.fixFile(filePath, issues);

      if (fixResult.success) {
        result.fixedCount = fixResult.fixedCount;

        // Record each fixed issue
        issues.forEach(issue => {
          result.fixes.push({
            issue: issue,
            method: 'rule',
            fixedBy: 'rule-based',
            success: true
          });
        });
      } else {
        result.errors.push(...fixResult.errors);
      }
    } catch (error) {
      result.errors.push(error.message);
    }

    return result;
  }

  /**
   * Apply AI fixes
   */
  async applyAIFixes(filePath, issues) {
    const result = {
      fixedCount: 0,
      fixes: [],
      errors: []
    };

    // Read file content
    let fileContent;
    try {
      fileContent = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      result.errors.push(`Cannot read file: ${error.message}`);
      return result;
    }

    // Fix each issue
    for (const issue of issues) {
      try {
        // Extract code context around the issue
        const codeContext = this.extractCodeContext(fileContent, issue);

        // Generate fix
        const fixResult = await this.aiCoordinator.generateFix(
          codeContext.code,
          issue,
          {
            filePath,
            lineNumber: issue.line,
            context: codeContext
          }
        );

        if (fixResult.fixedCode && fixResult.confidence >= this.minConfidence) {
          // Apply fix to file
          if (!this.dryRun) {
            fileContent = this.applyCodeFix(fileContent, codeContext, fixResult.fixedCode);
            fs.writeFileSync(filePath, fileContent, 'utf8');
          }

          result.fixedCount++;
          result.fixes.push({
            issue: issue,
            method: 'ai',
            fixedBy: fixResult.usedFixer,
            success: true,
            confidence: fixResult.confidence,
            cached: fixResult.cached
          });

          this.log(`  ✓ Fixed: ${issue.message} (${fixResult.usedFixer}, conf: ${Math.round(fixResult.confidence * 100)}%)`);
        } else {
          result.fixes.push({
            issue: issue,
            method: 'ai',
            success: false,
            errors: fixResult.errors
          });

          this.log(`  ✗ Failed: ${issue.message} (${fixResult.errors?.join(', ')})`);
        }
      } catch (error) {
        result.errors.push(`Issue ${issue.ruleId}: ${error.message}`);
        this.log(`  ✗ Error: ${issue.message} (${error.message})`);
      }
    }

    return result;
  }

  /**
   * Extract code context around an issue
   */
  extractCodeContext(fileContent, issue) {
    const lines = fileContent.split('\n');
    const lineIndex = (issue.line || 1) - 1;

    // Extract a window of surrounding lines for context
    const contextBefore = 2;
    const contextAfter = 3;
    const startLine = Math.max(0, lineIndex - contextBefore);
    const endLine = Math.min(lines.length, lineIndex + contextAfter + 1);

    const codeLines = lines.slice(startLine, endLine);

    return {
      code: codeLines.join('\n'),
      startLine: startLine + 1,
      endLine: endLine,
      targetLine: lineIndex + 1,
      fullContent: fileContent
    };
  }

  /**
   * Apply a code fix to file content
   */
  applyCodeFix(fileContent, context, fixedCode) {
    const lines = fileContent.split('\n');
    const startLine = context.startLine - 1;
    const endLine = context.endLine - 1;

    // Replace the code section
    const before = lines.slice(0, startLine);
    const after = lines.slice(endLine);
    const fixedLines = fixedCode.split('\n');

    return [...before, ...fixedLines, ...after].join('\n');
  }

  /**
   * Get unfixed issues
   */
  getUnfixedIssues(allIssues, fixes) {
    const fixedIssueIds = fixes
      .filter(f => f.success)
      .map(f => f.issue.id || `${f.issue.line}-${f.issue.ruleId}`);

    return allIssues.filter(issue => {
      const issueId = issue.id || `${issue.line}-${issue.ruleId}`;
      return !fixedIssueIds.includes(issueId);
    });
  }

  /**
   * Fix multiple files in batch
   */
  async fixFiles(issuesMap, options = {}) {
    const batchOptions = {
      maxConcurrent: options.maxConcurrent || 1, // Sequential by default
      continueOnError: options.continueOnError !== false
    };

    const results = [];
    const files = Object.keys(issuesMap);

    this.stats.totalIssues = Object.values(issuesMap).reduce((sum, issues) => sum + issues.length, 0);
    this.stats.fixableIssues = this.stats.totalIssues; // Optimistic

    this.log(`\n${'='.repeat(60)}`);
    this.log(`Auto-Fix Engine - Batch Processing`);
    this.log(`Files: ${files.length}`);
    this.log(`Total issues: ${this.stats.totalIssues}`);
    this.log(`Strategy: ${this.strategy}`);
    this.log(`Dry run: ${this.dryRun}`);
    this.log(`${'='.repeat(60)}`);

    // Process files
    for (const filePath of files) {
      const issues = issuesMap[filePath];

      try {
        const result = await this.fixFile(filePath, issues);
        results.push(result);
      } catch (error) {
        results.push({
          filePath,
          success: false,
          errors: [error.message]
        });

        if (!batchOptions.continueOnError) {
          break;
        }
      }
    }

    // Summary
    this.printSummary(results);

    return results;
  }

  /**
   * Fix with prioritization
   */
  async fixWithPriority(issuesMap, options = {}) {
    const priorityOptions = {
      prioritizeBy: options.prioritizeBy || 'severity', // 'severity', 'category', 'priority'
      maxFixes: options.maxFixes || Infinity,
      ...options
    };

    // Flatten and prioritize issues
    const allIssues = [];
    for (const [filePath, issues] of Object.entries(issuesMap)) {
      issues.forEach(issue => {
        allIssues.push({ filePath, issue });
      });
    }

    // Sort by priority
    allIssues.sort((a, b) => {
      if (priorityOptions.prioritizeBy === 'severity') {
        const severityOrder = { CRITICAL: 5, ERROR: 4, WARNING: 3, INFO: 2, SUGGESTION: 1 };
        return (severityOrder[b.issue.severity] || 0) - (severityOrder[a.issue.severity] || 0);
      } else if (priorityOptions.prioritizeBy === 'priority') {
        return (b.issue.priority || 0) - (a.issue.priority || 0);
      }
      return 0;
    });

    // Take top N issues
    const topIssues = allIssues.slice(0, priorityOptions.maxFixes);

    // Group back by file
    const prioritizedMap = {};
    topIssues.forEach(({ filePath, issue }) => {
      if (!prioritizedMap[filePath]) {
        prioritizedMap[filePath] = [];
      }
      prioritizedMap[filePath].push(issue);
    });

    // Fix
    return this.fixFiles(prioritizedMap, options);
  }

  /**
   * Create backup
   */
  async createBackup(filePath) {
    const backupPath = path.join(
      this.backupDir,
      new Date().toISOString().replace(/:/g, '-'),
      // Strip any absolute-path root (e.g. Windows drive `C:\`) so the source
      // path nests safely under the backup dir instead of resetting the join.
      stripPathRoot(filePath)
    );

    const backupDirPath = path.dirname(backupPath);
    if (!fs.existsSync(backupDirPath)) {
      fs.mkdirSync(backupDirPath, { recursive: true });
    }

    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }

  /**
   * Restore backup
   */
  async restoreBackup(filePath, backupPath) {
    if (!backupPath || !fs.existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }
    fs.copyFileSync(backupPath, filePath);
  }

  /**
   * Rollback all fixes from a run
   */
  async rollback(sessionId) {
    const session = this.fixHistory.find(s => s.sessionId === sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    for (const result of session.results) {
      if (result.backupPath && fs.existsSync(result.backupPath)) {
        await this.restoreBackup(result.filePath, result.backupPath);
        this.log(`Restored: ${result.filePath}`);
      }
    }

    return { sessionId, filesRestored: session.results.length };
  }

  /**
   * Add to fix history
   */
  addToHistory(result) {
    const sessionId = this.currentSessionId || this.generateSessionId();
    this.currentSessionId = sessionId;

    let session = this.fixHistory.find(s => s.sessionId === sessionId);

    if (!session) {
      session = {
        sessionId,
        timestamp: new Date().toISOString(),
        results: []
      };
      this.fixHistory.push(session);
    }

    session.results.push(result);

    // Cap history size: keep the 50 most recent sessions plus the current one.
    const maxHistory = 50;
    if (this.fixHistory.length > maxHistory + 1) {
      // Preserve the current session (last item) while trimming older ones.
      const overflow = this.fixHistory.length - (maxHistory + 1);
      this.fixHistory.splice(0, overflow);
    }

    // Save to disk
    this.saveHistory();
  }

  /**
   * Generate session ID
   */
  generateSessionId() {
    return `fix-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Save history to disk
   */
  saveHistory() {
    try {
      if (!fs.existsSync(this.historyDir)) {
        fs.mkdirSync(this.historyDir, { recursive: true });
      }

      const historyFile = path.join(this.historyDir, 'fix-history.json');
      fs.writeFileSync(historyFile, JSON.stringify(this.fixHistory, null, 2), 'utf8');
    } catch (error) {
      this.log(`Failed to save history: ${error.message}`);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalIssues > 0
        ? Math.round((this.stats.fixedByRule + this.stats.fixedByLocalAI + this.stats.fixedByCloudAI) / this.stats.totalIssues * 100)
        : 0,
      averageTime: this.stats.totalIssues > 0
        ? Math.round(this.stats.totalTime / this.stats.totalIssues)
        : 0
    };
  }

  /**
   * Print summary
   */
  printSummary(results) {
    const stats = this.getStats();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`AUTO-FIX SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`\n📊 Statistics:`);
    console.log(`  Total issues: ${stats.totalIssues}`);
    console.log(`  Fixed by rule: ${stats.fixedByRule}`);
    console.log(`  Fixed by local AI: ${stats.fixedByLocalAI}`);
    console.log(`  Fixed by cloud AI: ${stats.fixedByCloudAI}`);
    console.log(`  Manual fix required: ${stats.manualFixRequired}`);
    console.log(`  Failed fixes: ${stats.failedFixes}`);
    console.log(`  Success rate: ${stats.successRate}%`);
    console.log(`  Total time: ${stats.totalTime}ms`);
    console.log(`  Average time: ${stats.averageTime}ms/issue`);

    console.log(`\n📁 Files:`);
    results.forEach(result => {
      const status = result.success ? '✓' : '✗';
      console.log(`  ${status} ${result.filePath}: ${result.fixedIssueCount}/${result.originalIssueCount} fixed (${result.time}ms)`);
    });

    if (this.currentSessionId) {
      console.log(`\n💾 Session ID: ${this.currentSessionId}`);
      console.log(`   Use this to rollback: aqt rollback ${this.currentSessionId}`);
    }

    console.log(`\n${'='.repeat(60)}\n`);
  }

  log(message) {
    if (this.verbose) {
      console.log(`[AutoFixEngine] ${message}`);
    }
  }
}

module.exports = {
  AutoFixEngine
};

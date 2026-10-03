/**
 * Tests for Auto-Fix Engine
 */

const { AutoFixEngine } = require('../../src/fixers/auto-fix-engine');

describe('AutoFixEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new AutoFixEngine({
      dryRun: true,
      verbose: false,
      backup: false
    });
  });

  describe('Issue Classification', () => {
    test('should identify rule-fixable issues', () => {
      const issue1 = { ruleId: 'semi', fixable: true };
      const issue2 = { ruleId: 'quotes' };
      const issue3 = { ruleId: 'prettier/prettier' };

      expect(engine.canFixByRule(issue1)).toBe(true);
      expect(engine.canFixByRule(issue2)).toBe(true);
      expect(engine.canFixByRule(issue3)).toBe(true);
    });

    test('should identify AI-required issues', () => {
      const issue1 = { ruleId: 'no-unused-vars' };
      const issue2 = { ruleId: 'complexity' };
      const issue3 = { ruleId: 'max-lines' };

      expect(engine.requiresAI(issue1)).toBe(true);
      expect(engine.requiresAI(issue2)).toBe(true);
      expect(engine.requiresAI(issue3)).toBe(true);
    });

    test('should not classify simple issues as AI-required', () => {
      const issue = { ruleId: 'semi' };

      expect(engine.requiresAI(issue)).toBe(false);
    });
  });

  describe('Code Context Extraction', () => {
    test('should extract code context around issue', () => {
      const fileContent = 'line1\nline2\nline3\nline4\nline5\nline6\nline7';
      const issue = { line: 4 };

      const context = engine.extractCodeContext(fileContent, issue);

      expect(context.startLine).toBe(2); // 3 lines before
      expect(context.endLine).toBe(7); // 3 lines after
      expect(context.targetLine).toBe(4);
      expect(context.code).toContain('line2');
      expect(context.code).toContain('line4');
      expect(context.code).toContain('line7');
    });

    test('should handle edge cases at file start', () => {
      const fileContent = 'line1\nline2\nline3';
      const issue = { line: 1 };

      const context = engine.extractCodeContext(fileContent, issue);

      expect(context.startLine).toBe(1);
      expect(context.code).toContain('line1');
    });

    test('should handle edge cases at file end', () => {
      const fileContent = 'line1\nline2\nline3';
      const issue = { line: 3 };

      const context = engine.extractCodeContext(fileContent, issue);

      expect(context.endLine).toBeLessThanOrEqual(3);
      expect(context.code).toContain('line3');
    });
  });

  describe('Statistics', () => {
    test('should initialize stats correctly', () => {
      const stats = engine.getStats();

      expect(stats.totalIssues).toBe(0);
      expect(stats.fixedByRule).toBe(0);
      expect(stats.fixedByLocalAI).toBe(0);
      expect(stats.fixedByCloudAI).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    test('should calculate success rate correctly', () => {
      engine.stats.totalIssues = 100;
      engine.stats.fixedByRule = 50;
      engine.stats.fixedByLocalAI = 20;

      const stats = engine.getStats();

      expect(stats.successRate).toBe(70); // (50+20)/100 * 100
    });

    test('should handle zero issues for success rate', () => {
      engine.stats.totalIssues = 0;
      engine.stats.fixableIssues = 0;

      const stats = engine.getStats();

      expect(stats.successRate).toBe(0);
    });
  });

  describe('Session Management', () => {
    test('should generate unique session IDs', () => {
      const id1 = engine.generateSessionId();
      const id2 = engine.generateSessionId();

      expect(id1).toMatch(/^fix-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    test('should add results to history', () => {
      const result = {
        filePath: 'test.js',
        success: true,
        fixedIssueCount: 5
      };

      engine.addToHistory(result);

      expect(engine.fixHistory.length).toBeGreaterThan(0);
      expect(engine.currentSessionId).toBeDefined();
    });

    test('should limit history size', () => {
      // Add more than 50 items
      for (let i = 0; i < 60; i++) {
        engine.fixHistory.push({
          sessionId: `session-${i}`,
          timestamp: new Date().toISOString(),
          results: []
        });
      }

      engine.addToHistory({ filePath: 'test.js' });

      expect(engine.fixHistory.length).toBeLessThanOrEqual(51); // 50 + current
    });
  });

  describe('Unfixed Issues', () => {
    test('should identify unfixed issues', () => {
      const allIssues = [
        { id: 'issue-1', line: 1, ruleId: 'semi' },
        { id: 'issue-2', line: 2, ruleId: 'quotes' },
        { id: 'issue-3', line: 3, ruleId: 'indent' }
      ];

      const fixes = [
        { issue: allIssues[0], success: true },
        { issue: allIssues[2], success: true }
      ];

      const unfixed = engine.getUnfixedIssues(allIssues, fixes);

      expect(unfixed).toHaveLength(1);
      expect(unfixed[0].id).toBe('issue-2');
    });

    test('should handle issues without IDs', () => {
      const allIssues = [
        { line: 1, ruleId: 'semi' },
        { line: 2, ruleId: 'quotes' }
      ];

      const fixes = [
        { issue: allIssues[0], success: true }
      ];

      const unfixed = engine.getUnfixedIssues(allIssues, fixes);

      expect(unfixed).toHaveLength(1);
      expect(unfixed[0].line).toBe(2);
    });
  });
});

describe('Integration Tests', () => {
  test('should handle dry run mode', async () => {
    const engine = new AutoFixEngine({
      dryRun: true,
      verbose: false
    });

    expect(engine.dryRun).toBe(true);
    expect(engine).toBeInstanceOf(AutoFixEngine);
  });

  test('should support different strategies', () => {
    const ruleOnly = new AutoFixEngine({ strategy: 'rule-only', verbose: false });
    const aiOnly = new AutoFixEngine({ strategy: 'ai-only', verbose: false });
    const threeTier = new AutoFixEngine({ strategy: 'three-tier', verbose: false });

    expect(ruleOnly.strategy).toBe('rule-only');
    expect(aiOnly.strategy).toBe('ai-only');
    expect(threeTier.strategy).toBe('three-tier');
  });

  test('should configure AI fixers correctly', () => {
    const engine = new AutoFixEngine({
      verbose: false,
      localAI: {
        enabled: true,
        model: 'codellama:7b'
      },
      cloudAI: {
        enabled: false
      }
    });

    expect(engine.aiCoordinator).toBeDefined();
  });
});

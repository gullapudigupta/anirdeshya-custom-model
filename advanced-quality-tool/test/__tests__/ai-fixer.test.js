/**
 * Tests for AI Fixer
 */

const { AIFixer, OllamaAIFixer, CloudAIFixer, AIFixCoordinator } = require('../../src/fixers/ai-fixer');

describe('AIFixer', () => {
  describe('Base Class', () => {
    let fixer;

    beforeEach(() => {
      fixer = new AIFixer({ verbose: false });
    });

    test('should generate cache key', () => {
      const code = 'let x = 1;';
      const issue = { ruleId: 'no-unused-vars', message: 'x is unused' };

      const key1 = fixer.getCacheKey(code, issue);
      const key2 = fixer.getCacheKey(code, issue);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should validate fix correctly', async () => {
      const originalCode = 'let x = 1;';
      const fixedCode = 'const x = 1;';
      const issue = { filePath: 'test.js' };

      const validation = await fixer.validateFix(originalCode, fixedCode, issue);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.confidence).toBeGreaterThan(0);
    });

    test('should reject empty fix', async () => {
      const originalCode = 'let x = 1;';
      const fixedCode = '';
      const issue = { filePath: 'test.js' };

      const validation = await fixer.validateFix(originalCode, fixedCode, issue);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Generated fix is empty');
    });

    test('should warn on no changes', async () => {
      const originalCode = 'let x = 1;';
      const fixedCode = 'let x = 1;';
      const issue = { filePath: 'test.js' };

      const validation = await fixer.validateFix(originalCode, fixedCode, issue);

      expect(validation.warnings).toContain('No changes made to code');
      expect(validation.confidence).toBeLessThan(1.0);
    });

    test('should detect suspicious patterns', async () => {
      const originalCode = 'let x = 1;';
      const fixedCode = 'eval("dangerous");';
      const issue = { filePath: 'test.js' };

      const validation = await fixer.validateFix(originalCode, fixedCode, issue);

      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.confidence).toBeLessThan(1.0);
    });
  });

  describe('OllamaAIFixer', () => {
    let fixer;

    beforeEach(() => {
      fixer = new OllamaAIFixer({ verbose: false });
    });

    test('should build prompt correctly', () => {
      const code = 'let x = 1;';
      const issue = {
        message: 'Unused variable',
        ruleId: 'no-unused-vars',
        severity: 'error'
      };
      const context = {
        filePath: 'test.js',
        lineNumber: 1
      };

      const prompt = fixer.buildPrompt(code, issue, context);

      expect(prompt).toContain('Unused variable');
      expect(prompt).toContain('no-unused-vars');
      expect(prompt).toContain('test.js');
      expect(prompt).toContain(code);
    });

    test('should extract code from markdown', () => {
      const text = '```javascript\nconst x = 1;\n```';
      const extracted = fixer.extractCode(text);

      expect(extracted).toBe('const x = 1;');
    });

    test('should extract code from marked response', () => {
      const text = 'Fixed Code:\nconst x = 1;\n\nThis is better.';
      const extracted = fixer.extractCode(text);

      expect(extracted).toBe('const x = 1;');
    });

    test('should return trimmed text as fallback', () => {
      const text = '  const x = 1;  ';
      const extracted = fixer.extractCode(text);

      expect(extracted).toBe('const x = 1;');
    });
  });

  describe('AIFixCoordinator', () => {
    test('should initialize with local AI by default', () => {
      const coordinator = new AIFixCoordinator({
        verbose: false
      });

      expect(coordinator.localFixer).toBeDefined();
      expect(coordinator.strategy).toBe('local-first');
    });

    test('should support cloud-only strategy', () => {
      const coordinator = new AIFixCoordinator({
        verbose: false,
        strategy: 'cloud-only',
        cloudAI: {
          enabled: true,
          apiKey: 'test-key'
        }
      });

      expect(coordinator.cloudFixer).toBeDefined();
      expect(coordinator.strategy).toBe('cloud-only');
    });

    test('should handle no fixers available', async () => {
      const coordinator = new AIFixCoordinator({
        verbose: false,
        localAI: { enabled: false },
        cloudAI: { enabled: false }
      });

      const result = await coordinator.generateFix('let x = 1;', { ruleId: 'test' });

      expect(result.fixedCode).toBeNull();
      expect(result.errors).toContain('No AI fixers available');
    });
  });
});

describe('Integration Tests', () => {
  test('should handle cached fixes', async () => {
    const fixer = new OllamaAIFixer({
      verbose: false,
      enableCache: true
    });

    const code = 'let x = 1;';
    const issue = { ruleId: 'test', message: 'test issue' };

    const cacheKey = fixer.getCacheKey(code, issue);

    // Manually cache a fix
    fixer.saveCachedFix(cacheKey, {
      code: 'const x = 1;',
      confidence: 0.9
    });

    const result = await fixer.generateFix(code, issue);

    expect(result.cached).toBe(true);
    expect(result.fixedCode).toBe('const x = 1;');
  });

  test('should handle fix generation errors gracefully', async () => {
    const fixer = new OllamaAIFixer({
      verbose: false,
      baseUrl: 'http://invalid-url'
    });

    const result = await fixer.generateFix('let x = 1;', { ruleId: 'test' });

    expect(result.fixedCode).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

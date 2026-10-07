'use strict';

const { AISafetyValidator } = require('../../src/ai-generator/ai-safety');

describe('AISafetyValidator TypeScript checks', () => {
  const validator = new AISafetyValidator({ enableAuditLog: false });

  test('accepts code that passes TypeScript syntax and type checking', async () => {
    const result = await validator.validateTypeScript('const count: number = 3;');

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('rejects TypeScript type errors', async () => {
    const result = await validator.validateTypeScript('const count: number = "three";');

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('a TypeScript validation failure fails generated-code validation', async () => {
    const result = await validator.validateGeneratedCode(
      'const count: number = "three";',
      { language: 'typescript' }
    );

    expect(result.passed).toBe(false);
    expect(result.issues.some(issue => issue.category === 'types')).toBe(true);
  });
});

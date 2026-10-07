'use strict';

const { CodeGenerator } = require('../../src/agent/code-generator');

describe('CodeGenerator completion reporting', () => {
  test('does not report an empty generation as successful', async () => {
    const generator = new CodeGenerator({ workspace: process.cwd() });
    const result = await generator.generate({
      id: 'test-task',
      name: 'Test task',
      description: 'Implement a task with no referenced source files',
      deliverables: []
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No implementation patches');
    expect(generator.validate(result).valid).toBe(false);
  });

  test('rejects scaffold patches as incomplete implementations', () => {
    const generator = new CodeGenerator();
    const result = generator.validate({
      plan: { steps: [] },
      patches: [{
        filePath: 'src/generated.js',
        scaffold: true,
        changes: [{ newContent: '// TODO: Implement functionality' }]
      }],
      traceability: { taskId: 'test-task' },
      scaffold: true
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => issue.message.includes('scaffold'))).toBe(true);
  });
});

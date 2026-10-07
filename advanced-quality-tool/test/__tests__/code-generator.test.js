'use strict';

const { CodeGenerator } = require('../../src/agent/code-generator');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CONTRACT_VERSION } = require('../../src/agent/contracts');

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
    expect(result.error).toContain('Model patch executor is not configured');
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

  test('accepts structured model patches with a matching source hash', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aqt-codegen-'));
    try {
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'src/example.js'), 'original\n');
      const generator = new CodeGenerator({
        workspace,
        modelExecutor: {
          generatePlan: async () => ({
            schemaVersion: CONTRACT_VERSION,
            steps: [{ id: 'edit', description: 'Update the source', dependencies: [] }],
            affectedFiles: ['src/example.js'],
            expectedChecks: [{ type: 'test', required: true }],
            risks: [],
            metadata: { requiresApproval: false }
          }),
          generatePatches: async ({ context }) => [{
            schemaVersion: CONTRACT_VERSION,
            path: 'src/example.js',
            operation: 'modify',
            expectedHash: context.relevantCode.files[0].hash,
            content: 'implemented\n'
          }]
        }
      });
      const result = await generator.generate({
        id: 'model-backed',
        description: 'Update source',
        acceptanceCriteria: ['The source is updated'],
        files: ['src/example.js']
      });
      expect(result.success).toBe(true);
      expect(result.patches[0].operation).toBe('modify');
      expect(generator.validate(result).valid).toBe(true);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

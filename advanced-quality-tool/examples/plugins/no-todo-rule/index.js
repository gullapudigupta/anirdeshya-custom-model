'use strict';

module.exports = class NoTodoRulePlugin {
  constructor(api) {
    this.api = api;
  }

  async onLoad() {
    this.api.registerRule({
      id: 'no-todo-marker',
      name: 'Avoid TODO markers',
      severity: 'low',
      // Rules receive (filePath, ast, context); pass context.source to avoid a file read.
      check: (filePath, ast, context = {}) => {
        const source = typeof context.source === 'string' ? context.source : this.api.fs.readFile(filePath);
        return source.includes('TODO')
          ? { file: filePath, severity: 'low', message: 'TODO marker found' }
          : null;
      }
    });
    this.api.log('Registered no-todo-marker rule');
  }
};

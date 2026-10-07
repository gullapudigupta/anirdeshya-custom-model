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
      check: (source) => source.includes('TODO')
    });
    this.api.log('Registered no-todo-marker rule');
  }
};

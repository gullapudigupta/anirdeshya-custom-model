'use strict';

module.exports = class AnalysisHookPlugin {
  constructor(api) {
    this.api = api;
  }

  async onLoad() {
    this.api.registerHook('afterAnalysis', async (result) => {
      this.api.log(`Analysis completed with ${result.issues?.length || 0} issue(s)`);
      return result;
    });
  }
};

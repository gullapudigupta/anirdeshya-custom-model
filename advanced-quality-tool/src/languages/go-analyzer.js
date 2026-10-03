const { ExternalLanguageAnalyzer } = require('./external-language-analyzer');

class GoAnalyzer extends ExternalLanguageAnalyzer {
  constructor(options = {}) {
    super({ ...options, language: 'go', tools: {
      golint: { command: 'golint', args: [], parser: 'text' },
      gofmt: { command: 'gofmt', args: ['-d'], parser: 'text' },
      govet: { command: 'go', args: ['vet'], parser: 'text' }
    }});
  }
}

module.exports = { GoAnalyzer };
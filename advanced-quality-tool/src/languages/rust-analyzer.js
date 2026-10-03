const { ExternalLanguageAnalyzer } = require('./external-language-analyzer');

class RustAnalyzer extends ExternalLanguageAnalyzer {
  constructor(options = {}) {
    super({ ...options, language: 'rust', tools: {
      clippy: { command: 'cargo', args: ['clippy', '--message-format=json'], parser: 'json' },
      rustfmt: { command: 'rustfmt', args: ['--check'], parser: 'text' }
    }});
  }
}

module.exports = { RustAnalyzer };
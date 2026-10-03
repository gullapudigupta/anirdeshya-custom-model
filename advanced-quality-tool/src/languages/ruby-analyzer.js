const { ExternalLanguageAnalyzer } = require('./external-language-analyzer');

class RubyAnalyzer extends ExternalLanguageAnalyzer {
  constructor(options = {}) {
    super({ ...options, language: 'ruby', tools: {
      rubocop: { command: 'rubocop', args: ['--format', 'json'], parser: 'rubocop' },
      reek: { command: 'reek', args: [], parser: 'text' }
    }});
  }
}

module.exports = { RubyAnalyzer };
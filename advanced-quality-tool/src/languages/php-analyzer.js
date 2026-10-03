const { ExternalLanguageAnalyzer } = require('./external-language-analyzer');

class PhpAnalyzer extends ExternalLanguageAnalyzer {
  constructor(options = {}) {
    super({ ...options, language: 'php', tools: {
      phpcs: { command: 'phpcs', args: ['--report=json'], parser: 'phpcs' },
      phpmd: { command: 'phpmd', args: ['text', 'cleancode,codesize,controversial,design,naming,unusedcode'], parser: 'text' },
      phpstan: { command: 'phpstan', args: ['analyse', '--error-format=raw'], parser: 'text' }
    }});
  }
}

module.exports = { PhpAnalyzer, PHPAnalyzer: PhpAnalyzer };
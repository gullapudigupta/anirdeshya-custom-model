# Languages Module

## Overview

The `src/languages` module provides language-specific analyzers for detecting issues in various programming languages. Each analyzer integrates with language-specific tooling to provide accurate, idiomatic issue detection.

## Contents

| File | Description |
|------|-------------|
| `external-language-analyzer.js` | Base class for external tool integration |
| `python-analyzer.js` | Python analyzer (Pylint, Flake8) |
| `csharp-analyzer.js` | C# analyzer (Roslyn analyzers) |
| `go-analyzer.js` | Go analyzer (golint, staticcheck) |
| `php-analyzer.js` | PHP analyzer (PHPStan, Psalm) |
| `ruby-analyzer.js` | Ruby analyzer (RuboCop) |
| `rust-analyzer.js` | Rust analyzer (clippy) |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              ExternalLanguageAnalyzer (Base)             │
│  - runTool()    - parseOutput()    - analyzeFile()      │
└────────────────────────┬────────────────────────────────┘
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
    ▼                    ▼                    ▼
┌──────────┐      ┌──────────┐      ┌──────────┐
│ Python   │      │ CSharp   │      │ Go       │
│ Analyzer │      │ Analyzer │      │ Analyzer │
└──────────┘      └──────────┘      └──────────┘
```

## Key Components

### ExternalLanguageAnalyzer

Base class for language analyzers:

```javascript
const { ExternalLanguageAnalyzer } = require('./languages/external-language-analyzer');

class CustomAnalyzer extends ExternalLanguageAnalyzer {
  constructor(options = {}) {
    super(options);
    this.toolName = 'custom-linter';
  }

  async analyzeFile(filePath) {
    const output = await this.runTool('custom-linter', this.tool, filePath);
    return this.parseOutput('custom-linter', output, filePath, this.parser);
  }
}
```

### PythonAnalyzer

Analyzes Python code using Pylint:

```javascript
const { PythonAnalyzer } = require('./languages/python-analyzer');

const analyzer = new PythonAnalyzer({
  pylintPath: 'pylint',
  configPath: '.pylintrc'
});

const issues = await analyzer.analyzeFile('src/main.py');
```

**Supported Tools:**
- Pylint
- Flake8
- mypy (type checking)

### CSharpAnalyzer

Analyzes C# code using Roslyn analyzers:

```javascript
const { CSharpAnalyzer } = require('./languages/csharp-analyzer');

const analyzer = new CSharpAnalyzer({
  dotnetPath: 'dotnet',
  solutionPath: 'MySolution.sln'
});

const issues = await analyzer.analyzeProject();
```

**Features:**
- Roslyn rule mapping
- Rule categorization (CA####, IDE####)
- Fixability detection

### GoAnalyzer

Analyzes Go code:

```javascript
const { GoAnalyzer } = require('./languages/go-analyzer');

const analyzer = new GoAnalyzer({
  golintPath: 'golint',
  staticcheckPath: 'staticcheck'
});

const issues = await analyzer.analyzeFile('main.go');
```

### PHPAnalyzer

Analyzes PHP code:

```javascript
const { PhpAnalyzer } = require('./languages/php-analyzer');

const analyzer = new PhpAnalyzer({
  phpstanPath: 'vendor/bin/phpstan'
});

const issues = await analyzer.analyzeFile('src/Controller.php');
```

### RubyAnalyzer

Analyzes Ruby code:

```javascript
const { RubyAnalyzer } = require('./languages/ruby-analyzer');

const analyzer = new RubyAnalyzer({
  rubocopPath: 'bundle exec rubocop'
});

const issues = await analyzer.analyzeFile('app/models/user.rb');
```

### RustAnalyzer

Analyzes Rust code:

```javascript
const { RustAnalyzer } = require('./languages/rust-analyzer');

const analyzer = new RustAnalyzer({
  cargoPath: 'cargo'
});

const issues = await analyzer.analyzeFile('src/main.rs');
```

## Issue Format

All analyzers normalize issues to a common format:

```javascript
{
  id: 'unique-id',
  file: 'path/to/file.ext',
  line: 42,
  column: 10,
  endLine: 42,
  endColumn: 20,
  rule: 'rule-id',
  message: 'Issue description',
  severity: 'error',  // error | warning | info
  source: 'tool-name',
  fixable: true,
  language: 'language-id'
}
```

## Severity Mapping

### Python (Pylint)

| Pylint | AQT |
|--------|-----|
| fatal | error |
| error | error |
| warning | warning |
| convention | info |
| refactor | info |

### C# (Roslyn)

| Roslyn | AQT |
|--------|-----|
| Error | error |
| Warning | warning |
| Info | info |
| Hidden | info |

## Configuration

### Per-Language Config

```javascript
{
  python: {
    enabled: true,
    tools: ['pylint', 'mypy'],
    configPath: '.pylintrc'
  },
  csharp: {
    enabled: true,
    solutionPath: 'MySolution.sln',
    rules: { 'CA1031': 'suppress' }
  },
  go: {
    enabled: true,
    tools: ['golint', 'staticcheck']
  }
}
```

## Usage Examples

### Multi-Language Analysis

```javascript
const analyzers = {
  js: new JavaScriptAnalyzer(),
  py: new PythonAnalyzer(),
  cs: new CSharpAnalyzer()
};

async function analyzeProject(files) {
  const issues = [];
  
  for (const file of files) {
    const ext = path.extname(file);
    const analyzer = analyzers[ext.slice(1)];
    
    if (analyzer) {
      issues.push(...await analyzer.analyzeFile(file));
    }
  }
  
  return issues;
}
```

### Custom Analyzer

```javascript
class MyLanguageAnalyzer extends ExternalLanguageAnalyzer {
  constructor(options) {
    super(options);
    this.tool = {
      command: 'my-linter',
      args: ['--json', '${file}']
    };
  }

  parseOutput(output, filePath) {
    const results = JSON.parse(output);
    return results.issues.map(i => ({
      file: filePath,
      line: i.line,
      rule: i.code,
      message: i.message,
      severity: this.mapSeverity(i.level)
    }));
  }
}
```

## Dependencies

- Language-specific tooling (pylint, dotnet, golint, etc.)
- Node.js child_process
- File system access

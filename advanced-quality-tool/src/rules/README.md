# Rules Module

## Overview

The `src/rules` module provides a custom rule engine and rule pack marketplace for defining and sharing custom quality rules.

## Contents

| File | Description |
|------|-------------|
| `custom-rule-engine.js` | Custom rule definition and execution |
| `rule-pack-marketplace.js` | Rule pack discovery and installation |

## Key Components

### CustomRuleEngine

Defines and executes custom rules:

```javascript
const { CustomRuleEngine } = require('./rules/custom-rule-engine');

const engine = new CustomRuleEngine({
  rulesDir: './custom-rules',
  projectRoot: process.cwd()
});

// Load rules
await engine.loadRules();

// Analyze with custom rules
const issues = await engine.analyze('src/app.js', content);
```

### RulePackMarketplace

Discovers and installs rule packs:

```javascript
const { RulePackMarketplace } = require('./rules/rule-pack-marketplace');

const marketplace = new RulePackMarketplace({
  registryUrl: 'https://registry.aqt-rules.io'
});

// List available packs
const packs = await marketplace.listAvailable();

// Install a pack
await marketplace.install('react-best-practices');
```

## Rule Definition

### Basic Rule Structure

```javascript
// custom-rules/my-rule.js
module.exports = {
  id: 'no-console-log',
  name: 'No Console Log',
  description: 'Prevents use of console.log in production code',
  severity: 'warning',
  languages: ['javascript', 'typescript'],
  
  // Rule implementation
  check(content, filePath) {
    const issues = [];
    const regex = /console\.log\(/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      issues.push({
        file: filePath,
        line: this.getLineNumber(content, match.index),
        column: match.index,
        message: 'Avoid console.log in production code',
        rule: this.id,
        severity: this.severity
      });
    }
    
    return issues;
  }
};
```

### Template-Based Rules

Use templates for common patterns:

```javascript
const engine = new CustomRuleEngine();

// Regex template
engine.registerTemplate('regex', {
  create(config) {
    return {
      check(content, filePath) {
        const regex = new RegExp(config.pattern, config.flags || 'g');
        const issues = [];
        let match;
        
        while ((match = regex.exec(content)) !== null) {
          issues.push({
            file: filePath,
            line: getLineNumber(content, match.index),
            message: config.message,
            rule: config.id,
            severity: config.severity || 'warning'
          });
        }
        
        return issues;
      }
    };
  }
});

// Define rule from template
engine.defineRule({
  id: 'no-todo',
  template: 'regex',
  pattern: 'TODO\\s*\\(',
  message: 'Resolve TODO comments',
  severity: 'info'
});
```

### AST-Based Rules

For complex analysis:

```javascript
module.exports = {
  id: 'no-nested-callbacks',
  name: 'No Nested Callbacks',
  languages: ['javascript', 'typescript'],
  
  check(content, filePath) {
    const ast = this.parseAST(content);
    const issues = [];
    
    // Traverse AST
    this.traverse(ast, {
      CallExpression: (node) => {
        if (this.isNestedCallback(node)) {
          issues.push({
            file: filePath,
            line: node.loc.start.line,
            message: 'Avoid deeply nested callbacks',
            rule: this.id,
            severity: 'warning'
          });
        }
      }
    });
    
    return issues;
  }
};
```

## Rule Packs

### Pack Structure

```
my-rule-pack/
├── package.json
├── index.js
└── rules/
    ├── rule1.js
    └── rule2.js
```

### Pack Manifest

```javascript
// package.json
{
  "name": "aqt-rule-pack-my-rules",
  "version": "1.0.0",
  "aqt": {
    "rules": [
      { "id": "rule1", "path": "./rules/rule1.js" },
      { "id": "rule2", "path": "./rules/rule2.js" }
    ]
  }
}
```

### Installing Packs

```javascript
const marketplace = new RulePackMarketplace();

// List available
const available = await marketplace.listAvailable();
// [
//   { id: 'react-best-practices', name: 'React Best Practices', version: '2.0.0' },
//   { id: 'security-rules', name: 'Security Rules', version: '1.5.0' }
// ]

// Install
await marketplace.install('react-best-practices');

// List installed
const installed = marketplace.listInstalled();
```

## Built-in Templates

| Template | Description |
|----------|-------------|
| `regex` | Pattern matching with regex |
| `string-match` | Simple string matching |
| `ast-visitor` | AST traversal rules |
| `file-pattern` | File name/path patterns |

## Usage Examples

### Load and Run Rules

```javascript
const engine = new CustomRuleEngine();

// Load from directory
await engine.loadRules('./custom-rules');

// Or load from file
await engine.loadRuleFile('./specific-rule.js');

// Analyze
const issues = await engine.analyze('src/app.js', content);
```

### Programmatic Rule Definition

```javascript
const engine = new CustomRuleEngine();

// Define inline
engine.defineRule({
  id: 'my-custom-check',
  check(content, filePath) {
    // Custom logic
    return issues;
  }
});
```

### Rule with Fix

```javascript
module.exports = {
  id: 'prefer-const',
  
  check(content, filePath) {
    // Find issues
    return issues;
  },
  
  fix(issue, content) {
    // Return fixed content
    return content.replace('let ', 'const ');
  }
};
```

## Configuration

```javascript
{
  rulesDir: string,          // Directory for custom rules
  projectRoot: string,       // Project root
  enabledRules: string[],    // Specific rules to enable
  disabledRules: string[],   // Rules to disable
  ruleConfig: {              // Per-rule configuration
    'my-rule': { option: 'value' }
  }
}
```

## Dependencies

- AST parser
- File system access
- HTTP client (for marketplace)

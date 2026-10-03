# Plugins Module

## Overview

The `src/plugins` module provides a plugin system for extending Advanced Quality Tool with custom analyzers, fixers, and integrations.

## Contents

| File | Description |
|------|-------------|
| `plugin-system.js` | Plugin manager and lifecycle handling |

## Key Components

### PluginManager

Discovers and loads plugins:

```javascript
const { PluginManager } = require('./plugins/plugin-system');

const manager = new PluginManager({
  pluginsDir: './plugins',
  builtinPlugins: ['core-analyzer', 'core-fixer']
});

// Initialize plugin system
await manager.initialize();

// Discover available plugins
const plugins = await manager.discoverPlugins();

// Load specific plugin
const plugin = await manager.loadPlugin('./plugins/custom-analyzer');
```

## Plugin Interface

Plugins must implement the following interface:

```javascript
// my-plugin/index.js
module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  
  // Plugin initialization
  async initialize(context) {
    this.context = context;
    // Register analyzers, fixers, etc.
  },
  
  // Register analyzers
  registerAnalyzers(registry) {
    registry.register('my-analyzer', {
      analyze: async (file, content) => { ... }
    });
  },
  
  // Register fixers
  registerFixers(registry) {
    registry.register('my-fixer', {
      canFix: (issue) => issue.rule === 'my-rule',
      fix: async (issue, content) => { ... }
    });
  },
  
  // Plugin lifecycle
  async activate() {
    console.log('Plugin activated');
  },
  
  async deactivate() {
    console.log('Plugin deactivated');
  }
};
```

## Plugin Types

### Analyzer Plugins

Add custom code analysis:

```javascript
module.exports = {
  name: 'custom-analyzer',
  registerAnalyzers(registry) {
    registry.register('security-check', {
      languages: ['javascript', 'typescript'],
      analyze: async (file, content, options) => {
        const issues = [];
        // Custom analysis logic
        return issues;
      }
    });
  }
};
```

### Fixer Plugins

Add custom fix strategies:

```javascript
module.exports = {
  name: 'custom-fixer',
  registerFixers(registry) {
    registry.register('my-fixer', {
      canFix: (issue) => issue.rule.startsWith('my-'),
      fix: async (issue, content) => {
        // Generate fix
        return { fixed: true, content: newContent };
      }
    });
  }
};
```

### Integration Plugins

Add external tool integrations:

```javascript
module.exports = {
  name: 'custom-integration',
  registerIntegrations(registry) {
    registry.register('my-linter', {
      type: 'linter',
      languages: ['mylang'],
      run: async (files) => { ... }
    });
  }
};
```

## Plugin Discovery

Plugins are discovered from:

1. Built-in plugins directory
2. Project plugins directory (`./plugins`)
3. Node modules with `aqt-plugin` keyword

```javascript
const plugins = await manager.discoverPlugins();
// [
//   { name: 'core-analyzer', path: '...', version: '1.0.0' },
//   { name: 'custom-plugin', path: '...', version: '2.0.0' }
// ]
```

## Plugin Lifecycle

```
┌─────────────┐
│   Discover  │  Find available plugins
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    Load     │  Load plugin module
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Initialize  │  Call initialize() with context
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Activate   │  Call activate()
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Running   │  Plugin is active
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Deactivate  │  Call deactivate()
└─────────────┘
```

## Usage Examples

### Using a Plugin

```javascript
const manager = new PluginManager();
await manager.initialize();

// Plugins are automatically loaded
const issues = await manager.runAnalyzers(['src/']);

// Use plugin fixers
const fixed = await manager.runFixers(issues);
```

### Creating a Plugin

```javascript
// plugins/my-plugin/index.js

module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  
  async initialize(context) {
    this.logger = context.logger;
    this.config = context.config;
  },
  
  registerAnalyzers(registry) {
    registry.register('my-check', {
      languages: ['javascript'],
      analyze: async (file, content) => {
        // Check for specific patterns
        if (content.includes('TODO')) {
          return [{
            file,
            line: 1,
            rule: 'my-todo-check',
            message: 'TODO found in code',
            severity: 'info'
          }];
        }
        return [];
      }
    });
  },
  
  async activate() {
    this.logger.info('My plugin activated');
  }
};
```

## Configuration

```javascript
{
  pluginsDir: string,        // Directory to search for plugins
  builtinPlugins: string[],  // Built-in plugins to enable
  disabledPlugins: string[], // Plugins to disable
  pluginConfig: {            // Per-plugin configuration
    'my-plugin': {
      enabled: true,
      customOption: 'value'
    }
  }
}
```

## Dependencies

- File system access
- Node.js module system

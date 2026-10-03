# Workspace Module

## Overview

The `src/workspace` module provides utilities for workspace management, context assembly, configuration reading, and documentation ingestion.

## Contents

| File | Description |
|------|-------------|
| `index.js` | Module exports |
| `workspace-resolver.js` | Resolves workspace root and configuration |
| `context-assembler.js` | Assembles context for analysis |
| `package-config-reader.js` | Reads package.json configuration |
| `linter-config-manager.js` | Manages linter configurations |
| `documentation-ingestion.js` | Ingests documentation from various sources |

## Key Components

### WorkspaceResolver

Resolves workspace information:

```javascript
const { WorkspaceResolver } = require('./workspace/workspace-resolver');

const resolver = new WorkspaceResolver({
  projectRoot: process.cwd()
});

// Resolve workspace
const workspace = resolver.resolve({
  path: process.cwd()
});

// Returns:
// {
//   root: '/project',
//   type: 'node',  // 'node', 'python', 'dotnet', etc.
//   config: { packageJson, ... },
//   markers: ['.git', 'package.json']
// }
```

**Workspace Markers:**

| Project Type | Markers |
|--------------|---------|
| Node.js | package.json |
| Python | requirements.txt, setup.py, pyproject.toml |
| .NET | *.sln, *.csproj |
| Go | go.mod |
| Rust | Cargo.toml |

### ContextAssembler

Assembles context for analysis:

```javascript
const { ContextAssembler } = require('./workspace/context-assembler');

const assembler = new ContextAssembler({
  projectRoot: process.cwd()
});

// Attach current file
assembler.attachCurrentFile('src/app.js', {
  includeImports: true,
  includeRelated: true
});

// Attach editor selection
assembler.attachEditorSelection('src/app.js', {
  start: { line: 10, column: 0 },
  end: { line: 20, column: 0 }
});

// Attach task file
assembler.attachTaskFile('tasks/phase1-tasks.json');

// Get assembled context
const context = assembler.getContext();
```

### PackageConfigReader

Reads package configuration:

```javascript
const { PackageConfigReader } = require('./workspace/package-config-reader');

const reader = new PackageConfigReader();

// Read package.json
const pkg = reader.read();
// {
//   name: 'my-project',
//   version: '1.0.0',
//   scripts: { ... },
//   dependencies: { ... }
// }

// Discover scripts
const scripts = reader.discoverCommands();
// ['test', 'build', 'lint', 'start']

// Detect linters
const linters = reader.detectLinters();
// ['eslint', 'prettier']
```

### LinterConfigManager

Manages linter configurations:

```javascript
const { LinterConfigManager } = require('./workspace/linter-config-manager');

const manager = new LinterConfigManager({
  projectRoot: process.cwd()
});

// Get configuration
const config = manager.getConfig(['eslint', 'prettier']);
// {
//   eslint: { configPath: '.eslintrc.js', ... },
//   prettier: { configPath: '.prettierrc', ... }
// }

// Save configuration
manager.saveConfig({
  eslint: { rules: { 'no-console': 'error' } }
});

// Update selection
manager.updateSelection(['eslint'], ['eslint', 'prettier']);
```

### DocumentationIngestion

Ingests documentation from various sources:

```javascript
const { DocumentationIngestion } = require('./workspace/documentation-ingestion');

const ingestion = new DocumentationIngestion({
  cacheDir: '.aqt-cache/docs',
  cacheEnabled: true
});

// Ingest documentation
const docs = await ingestion.ingest({
  urls: ['https://react.dev/learn'],
  files: ['README.md', 'docs/API.md'],
  extractCodeBlocks: true
});

// Get cached
const cached = ingestion.getCached('https://react.dev/learn');

// Clear cache
ingestion.clearCache(all = true);
```

## Usage Examples

### Full Workspace Analysis

```javascript
const { WorkspaceResolver, ContextAssembler, PackageConfigReader } = require('./workspace');

// 1. Resolve workspace
const resolver = new WorkspaceResolver();
const workspace = resolver.resolve();

// 2. Read configuration
const reader = new PackageConfigReader();
const config = reader.read();

// 3. Assemble context
const assembler = new ContextAssembler();
assembler.attachCurrentFile('src/app.js');

const context = assembler.getContext();

// 4. Use context for analysis
const issues = await analyzeWithContext(context);
```

### Multi-File Context

```javascript
const assembler = new ContextAssembler();

// Add multiple files
files.forEach(file => {
  assembler.attachCurrentFile(file, {
    includeImports: true
  });
});

const context = assembler.getContext();
```

### Documentation Context

```javascript
const ingestion = new DocumentationIngestion();

// Ingest library docs
const docs = await ingestion.ingest({
  urls: ['https://nodejs.org/api/fs.html'],
  extractCodeBlocks: true,
  maxLength: 10000
});

// Use for context
context.addDocumentation(docs);
```

## Configuration

### WorkspaceResolver

```javascript
{
  projectRoot: string,       // Initial project root
  markers: string[],         // Custom workspace markers
  ignoreDirs: string[]       // Directories to ignore
}
```

### ContextAssembler

```javascript
{
  projectRoot: string,       // Project root
  maxFileSize: number,       // Maximum file size to include
  maxFiles: number,          // Maximum files in context
  includeNodeModules: boolean
}
```

### DocumentationIngestion

```javascript
{
  cacheDir: string,          // Cache directory
  cacheEnabled: boolean,     // Enable caching
  cacheTTL: number,          // Cache TTL in seconds
  maxDocSize: number,        // Maximum document size
  userAgent: string          // User agent for requests
}
```

## Dependencies

- File system access
- HTTP client (for documentation)
- Cache storage

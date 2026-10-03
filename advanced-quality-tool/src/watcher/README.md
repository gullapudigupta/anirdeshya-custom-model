# Watcher Module

## Overview

The `src/watcher` module provides file system watching capabilities for automatic re-analysis when files change.

## Contents

| File | Description |
|------|-------------|
| `file-watcher.js` | File system watcher implementation |

## Key Components

### FileWatcher

Watches files for changes and triggers analysis:

```javascript
const { FileWatcher } = require('./watcher/file-watcher');

const watcher = new FileWatcher({
  paths: ['src', 'test'],
  ignore: ['node_modules', 'dist', '.git'],
  debounce: 500
});

// Start watching
await watcher.start();

// Listen for changes
watcher.on('change', (event) => {
  console.log(`File ${event.path} was ${event.type}`);
  // Trigger re-analysis
});

watcher.on('add', (event) => {
  console.log(`File ${event.path} was added`);
});

watcher.on('delete', (event) => {
  console.log(`File ${event.path} was deleted`);
});

// Stop watching
watcher.stop();
```

## Features

### Debounced Events

Prevents rapid-fire events during bulk changes:

```javascript
const watcher = new FileWatcher({
  debounce: 500  // Wait 500ms after last change
});

watcher.on('change', (event) => {
  // Called once after changes settle
});
```

### Pattern Matching

Include/exclude specific files:

```javascript
const watcher = new FileWatcher({
  include: ['**/*.{js,ts,jsx,tsx}'],
  exclude: ['**/node_modules/**', '**/dist/**']
});
```

### Recursive Watching

Watches directories recursively:

```javascript
// Discovers all files in directory
const files = await watcher.discoverFiles('./src');
// ['src/app.js', 'src/utils.js', ...]
```

## Event Types

| Event | Description |
|-------|-------------|
| `add` | File added |
| `change` | File modified |
| `delete` | File deleted |
| `error` | Watch error occurred |

## Usage Examples

### Watch and Analyze

```javascript
const { FileWatcher } = require('./watcher/file-watcher');
const analyzer = require('./core/analyzer');

const watcher = new FileWatcher({
  paths: ['src'],
  debounce: 300
});

watcher.on('change', async (event) => {
  if (event.path.endsWith('.js')) {
    const issues = await analyzer.analyzeFile(event.path);
    console.log(`Found ${issues.length} issues in ${event.path}`);
  }
});

await watcher.start();
console.log('Watching for changes...');
```

### Multiple Directories

```javascript
const watcher = new FileWatcher({
  paths: ['src', 'test', 'lib'],
  ignore: ['**/node_modules/**', '**/coverage/**']
});

await watcher.start();
```

### Handle Initial Scan

```javascript
const watcher = new FileWatcher({
  paths: ['src'],
  initialScan: true
});

watcher.on('ready', async () => {
  // Called after initial scan completes
  const files = await watcher.discoverFiles('./src');
  console.log(`Watching ${files.length} files`);
});

await watcher.start();
```

### Cleanup on Exit

```javascript
const watcher = new FileWatcher();

await watcher.start();

// Clean shutdown
process.on('SIGINT', async () => {
  await watcher.stop();
  process.exit(0);
});
```

## Configuration

```javascript
{
  paths: string[],           // Directories to watch
  ignore: string[],          // Patterns to ignore
  debounce: number,          // Debounce interval (ms)
  usePolling: boolean,       // Use polling instead of native
  interval: number,          // Polling interval (ms)
  binaryInterval: number,    // Polling for binary files (ms)
  alwaysStat: boolean,       // Always include file stats
  depth: number              // Maximum recursion depth
}
```

## Best Practices

- Use debouncing to avoid excessive re-analysis
- Exclude `node_modules` and build directories
- Handle errors gracefully
- Clean up watchers on process exit
- Use appropriate debounce for your workflow

## Dependencies

- chokidar (file watching library)
- File system access

# UI Module

## Overview

The `src/ui` module provides user interface components including a chat interface, custom rule UI, task import UI, agent activity view, and WebSocket server for real-time updates.

## Contents

| File | Description |
|------|-------------|
| `chat-ui.js` | Interactive chat interface for AI interactions |
| `websocket-server.js` | WebSocket server for real-time updates |
| `custom-rule-ui.js` | UI for creating and testing custom rules |
| `task-import-ui.js` | UI for importing and managing tasks |
| `agent-activity-view.js` | View for monitoring agent activities |

## Key Components

### ChatUI

Interactive chat interface for AI interactions:

```javascript
const { init, renderIssues, analyzeProject } = require('./ui/chat-ui');

// Initialize UI
init({
  container: '#chat-container',
  theme: 'dark'
});

// Render issues
renderIssues(issues);

// Analyze project
await analyzeProject({ quiet: false });
```

**Features:**
- Interactive chat with AI
- Issue visualization
- Project analysis triggers
- Sidebar views for tasks/issues

### WebSocketServer

Real-time communication server:

```javascript
const { WebSocketServer } = require('./ui/websocket-server');

const server = new WebSocketServer({
  port: 3456,
  host: 'localhost'
});

server.start();

// Broadcast to clients
server.broadcast({ type: 'issues', data: issues });

// Handle client messages
server.on('message', (client, message) => {
  console.log('Received:', message);
});

server.stop();
```

**Features:**
- Real-time issue updates
- Bidirectional communication
- HTTP fallback for static files

### CustomRuleUI

Interface for custom rule creation:

```javascript
const { CustomRuleUI } = require('./ui/custom-rule-ui');

const ui = new CustomRuleUI({
  container: '#rule-editor'
});

// Handle HTTP requests
const response = ui.handleRequest('GET', '/api/rules', {});

// Test a rule
const result = ui.testRule(ruleDefinition, sampleCode);
```

**Features:**
- Rule definition editor
- Real-time rule testing
- Rule templates

### TaskImportUI

UI for importing tasks from specifications:

```javascript
const { TaskImportUI } = require('./ui/task-import-ui');

const ui = new TaskImportUI('task-container', {
  onImport: async (tasks) => {
    // Handle imported tasks
  }
});

ui.initializeUI();
ui.setupEventListeners();
```

**Features:**
- Task file upload
- Task preview and editing
- Import to project

### AgentActivityView

Monitors agent activities in real-time:

```javascript
const { AgentActivityView } = require('./ui/agent-activity-view');

const view = new AgentActivityView({
  container: '#agent-activity'
});

// Register work item
view.registerWork({
  id: 'work-123',
  type: 'fix',
  description: 'Fixing security issues'
});

// Update state
view.updateState('work-123', 'running', {
  progress: 50,
  message: 'Processing files...'
});

// Add tool activity
view.addToolActivity('work-123', {
  tool: 'file-reader',
  action: 'read',
  file: 'src/app.js'
});
```

**Features:**
- Real-time activity stream
- Progress tracking
- Tool execution visualization

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser Client                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   ChatUI    │  │ CustomRuleUI│  │ TaskImportUI│     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
│         └────────────────┼────────────────┘             │
│                          │                              │
│                          ▼                              │
│              ┌───────────────────────┐                  │
│              │   WebSocketServer     │                  │
│              └───────────────────────┘                  │
│                          │                              │
└──────────────────────────┼──────────────────────────────┘
                           │
                           ▼
              ┌───────────────────────┐
              │   Backend Services    │
              └───────────────────────┘
```

## Usage Examples

### Starting the UI Server

```javascript
const { WebSocketServer } = require('./ui/websocket-server');
const http = require('http');

const server = new WebSocketServer({ port: 3456 });
server.start();

// Serve static files
const httpServer = http.createServer((req, res) => {
  server.handleHttpRequest(req, res);
});

httpServer.listen(3456);
```

### Real-Time Issue Updates

```javascript
// Backend
server.broadcast({
  type: 'issues-updated',
  issues: newIssues
});

// Frontend (chat-ui.js)
websocket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'issues-updated') {
    renderIssues(data.issues);
  }
};
```

### Creating Custom Rules

```javascript
const ui = new CustomRuleUI();

// User creates rule in UI
const rule = {
  id: 'no-console',
  pattern: 'console\\.(log|error|warn)',
  message: 'Avoid console in production',
  severity: 'warning'
};

// Test against sample code
const result = ui.testRule(rule, sampleCode);
// { matches: 3, issues: [...] }
```

## Configuration

### WebSocketServer

```javascript
{
  port: number,              // Server port (default: 3456)
  host: string,              // Server host (default: 'localhost')
  staticDir: string,         // Directory for static files
  maxClients: number         // Maximum concurrent clients
}
```

### ChatUI

```javascript
{
  container: string,         // DOM container selector
  theme: string,             // 'light' | 'dark'
  showSidebar: boolean,      // Show sidebar
  defaultView: string        // 'issues' | 'tasks'
}
```

### AgentActivityView

```javascript
{
  container: string,         // DOM container selector
  maxItems: number,          // Maximum items to show
  autoScroll: boolean        // Auto-scroll to new items
}
```

## Dependencies

- WebSocket library
- HTTP server
- DOM APIs (browser)

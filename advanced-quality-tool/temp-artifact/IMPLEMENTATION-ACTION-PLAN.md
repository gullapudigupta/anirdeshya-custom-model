# Advanced Quality Tool - Implementation Action Plan

## Overview

This document provides a prioritized action plan to align the actual implementation with README.md claims and enhance the chat-ui.html to expose all documented features.

---

## Phase 1: Critical Fixes (Immediate)

### Task 1.1: Fix CLI Missing Commands

**Issue**: `aqt security` command documented but not implemented

**Action**:
```javascript
// Add to cli.js
case 'security':
  const securityCommand = require('./src/commands/security-command');
  await securityCommand.run(args);
  break;
```

**Files to Modify**:
- `cli.js` - Add security command handler
- Create `src/commands/security-command.js`

**Priority**: 🔴 Critical  
**Effort**: 2 hours

---

### Task 1.2: Document HTTP API Endpoints

**Issue**: README lacks HTTP API documentation

**Action**: Add comprehensive HTTP API section to README.md

```markdown
## HTTP API Reference

### Endpoints

#### Health & Info
- `GET /health` - Server health check
- `GET /api/info` - API information and version

#### Analysis & Fixing
- `POST /api/analyze` - Run code analysis
- `POST /api/fix` - Fix single issue
- `POST /api/generate-fixes` - Generate fixes for multiple issues

#### Reports
- `GET /api/reports` - List all reports
- `GET /api/reports/:id` - Get specific report

#### Workspace
- `POST /api/workspace/config` - Update workspace configuration
- `GET /api/workspace/status` - Get workspace status
- `GET /api/files` - List workspace files
- `GET /api/files/*` - Get specific file content

### Usage Examples
[Add detailed examples with curl/axios]
```

**Files to Modify**:
- `README.md`

**Priority**: 🔴 Critical  
**Effort**: 3 hours

---

### Task 1.3: Clarify WebSocket Status

**Issue**: WebSocket server claimed but not found

**Action**:
1. Search codebase for WebSocket implementation
2. If not found, either:
   - Remove WebSocket claim from README
   - Implement WebSocket server

**Files to Investigate**:
- `src/integrations/`
- `src/ui/`

**Priority**: 🔴 Critical  
**Effort**: 1 hour investigation + 8 hours implementation (if needed)

---

## Phase 2: Chat UI Enhancements (High Priority)

### Task 2.1: Add Issue Filtering

**Feature**: Filter issues by severity, category, file, rule

**Implementation**:
```javascript
// Add to chat-ui.html
<div class="filter-controls">
  <select id="severityFilter">
    <option value="all">All Severities</option>
    <option value="critical">Critical</option>
    <option value="error">Error</option>
    <option value="warning">Warning</option>
    <option value="info">Info</option>
  </select>
  
  <input type="text" id="fileFilter" placeholder="Filter by file...">
  
  <select id="categoryFilter">
    <option value="all">All Categories</option>
    <option value="security">Security</option>
    <option value="performance">Performance</option>
    <option value="quality">Quality</option>
  </select>
</div>

// Add to chat-ui.js
function filterIssues() {
  const severity = document.getElementById('severityFilter').value;
  const fileText = document.getElementById('fileFilter').value.toLowerCase();
  const category = document.getElementById('categoryFilter').value;
  
  return state.issues.filter(issue => {
    const severityMatch = severity === 'all' || issue.severity === severity;
    const fileMatch = !fileText || issue.file.toLowerCase().includes(fileText);
    const categoryMatch = category === 'all' || issue.category === category;
    return severityMatch && fileMatch && categoryMatch;
  });
}
```

**Files to Modify**:
- `src/ui/chat-ui.html`
- `src/ui/chat-ui.js`
- `src/ui/chat-ui.css`

**Priority**: 🟡 High  
**Effort**: 4 hours

---

### Task 2.2: Add Search Functionality

**Feature**: Search through issues by text

**Implementation**:
```javascript
// Add to chat-ui.html
<div class="search-bar">
  <input type="text" id="issueSearch" placeholder="Search issues..." />
  <button id="clearSearch">×</button>
</div>

// Add to chat-ui.js
function searchIssues(query) {
  const lowerQuery = query.toLowerCase();
  return state.issues.filter(issue => 
    issue.message.toLowerCase().includes(lowerQuery) ||
    issue.file.toLowerCase().includes(lowerQuery) ||
    issue.ruleId.toLowerCase().includes(lowerQuery)
  );
}

document.getElementById('issueSearch').addEventListener('input', (e) => {
  const filtered = searchIssues(e.target.value);
  renderFilteredIssues(filtered);
});
```

**Files to Modify**:
- `src/ui/chat-ui.html`
- `src/ui/chat-ui.js`
- `src/ui/chat-ui.css`

**Priority**: 🟡 High  
**Effort**: 3 hours

---

### Task 2.3: Add Multi-Issue Selection

**Feature**: Select multiple issues for batch operations

**Implementation**:
```javascript
// Update state in chat-ui.js
const state = {
  issues: [],
  selectedIssues: new Set(), // Changed from single to Set
  // ... rest
};

// Update issue card HTML
<div class="issue-card">
  <input type="checkbox" class="issue-checkbox" data-issue-id="${issue.id}">
  <!-- rest of card -->
</div>

// Add selection handlers
function toggleIssueSelection(issueId) {
  if (state.selectedIssues.has(issueId)) {
    state.selectedIssues.delete(issueId);
  } else {
    state.selectedIssues.add(issueId);
  }
  renderIssues();
  updateSelectionUI();
}

// Add bulk action bar
<div class="bulk-actions" id="bulkActions" style="display: none;">
  <span id="selectedCount">0 selected</span>
  <button onclick="fixSelected()">Fix Selected</button>
  <button onclick="exportSelected()">Export Selected</button>
  <button onclick="clearSelection()">Clear</button>
</div>
```

**Files to Modify**:
- `src/ui/chat-ui.html`
- `src/ui/chat-ui.js`
- `src/ui/chat-ui.css`

**Priority**: 🟡 High  
**Effort**: 6 hours

---

### Task 2.4: Implement Batch Fixing

**Feature**: Fix multiple selected issues at once

**Implementation**:
```javascript
// Add to chat-ui.js
async function fixSelected() {
  const issueIds = Array.from(state.selectedIssues);
  const issues = state.issues.filter(i => issueIds.includes(i.id));
  
  addAssistantMessage(`🔧 Starting batch fix for ${issues.length} issues...`);
  
  const results = {
    successful: [],
    failed: [],
    total: issues.length
  };
  
  for (const issue of issues) {
    try {
      const response = await fetch('api/generate-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue })
      });
      const result = await response.json();
      
      if (response.ok) {
        // Auto-apply if confidence > 0.8
        if (result.confidence > 0.8) {
          await applyFixSilent(issue, result);
          results.successful.push(issue);
        } else {
          results.failed.push({ issue, reason: 'Low confidence' });
        }
      } else {
        results.failed.push({ issue, reason: result.error });
      }
    } catch (error) {
      results.failed.push({ issue, reason: error.message });
    }
  }
  
  // Show results
  addAssistantMessage(
    `✅ Batch fix complete!<br><br>` +
    `Successful: ${results.successful.length}/${results.total}<br>` +
    `Failed: ${results.failed.length}/${results.total}`
  );
  
  state.selectedIssues.clear();
  await analyzeProject({ quiet: true });
}
```

**Files to Modify**:
- `src/ui/chat-ui.js`

**Priority**: 🟡 High  
**Effort**: 5 hours

---

### Task 2.5: Add Security Scan Button

**Feature**: Dedicated security analysis trigger

**Implementation**:
```javascript
// Add to chat-ui.html sidebar
<button id="securityScanBtn" class="sidebar-action" type="button">
  🔒 Security Scan
</button>

// Add to chat-ui.js
async function runSecurityScan() {
  elements.securityScanBtn.disabled = true;
  elements.sidebarStatus.textContent = 'Running security analysis...';
  
  try {
    const response = await fetch('api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath: '.',
        options: {
          includeSecurity: true,
          includePerformance: false,
          includeMetrics: false,
          categories: ['security']
        }
      })
    });
    
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    
    state.issues = (result.data.issues || []).map(normalizeIssue);
    const securityIssues = state.issues.filter(i => i.category === 'security');
    
    switchSidebarView('issues');
    updateStats();
    
    addAssistantMessage(
      `🔒 Security scan complete!<br><br>` +
      `Found ${securityIssues.length} security issue${securityIssues.length === 1 ? '' : 's'}:<br>` +
      `• Critical: ${securityIssues.filter(i => i.severity === 'critical').length}<br>` +
      `• High: ${securityIssues.filter(i => i.severity === 'error').length}<br>` +
      `• Medium: ${securityIssues.filter(i => i.severity === 'warning').length}<br>` +
      `• Low: ${securityIssues.filter(i => i.severity === 'info').length}`
    );
  } catch (error) {
    addAssistantMessage(`Security scan failed: ${escapeHtml(error.message)}`);
  } finally {
    elements.securityScanBtn.disabled = false;
  }
}
```

**Files to Modify**:
- `src/ui/chat-ui.html`
- `src/ui/chat-ui.js`

**Priority**: 🟡 High  
**Effort**: 3 hours

---

### Task 2.6: Add Metrics Dashboard Tab

**Feature**: View code metrics (complexity, maintainability, etc.)

**Implementation**:
```javascript
// Add to chat-ui.html
<button id="metricsTab" class="sidebar-tab" type="button" 
        role="tab" aria-selected="false" data-sidebar-view="metrics">
  Metrics <span id="metricsCount">0</span>
</button>

// Add metrics rendering
function renderMetrics() {
  if (!state.metrics || state.metrics.length === 0) {
    elements.issuesList.innerHTML = `
      <div class="empty-state">
        <h3>No metrics available</h3>
        <p>Run analysis with metrics enabled.</p>
      </div>
    `;
    return;
  }
  
  elements.issuesList.innerHTML = `
    <div class="metrics-grid">
      ${state.metrics.map(metric => `
        <div class="metric-card">
          <div class="metric-header">
            <h4>${escapeHtml(metric.file)}</h4>
          </div>
          <div class="metric-values">
            <div class="metric-item">
              <span class="metric-label">Complexity</span>
              <span class="metric-value ${getComplexityClass(metric.complexity)}">
                ${metric.complexity}
              </span>
            </div>
            <div class="metric-item">
              <span class="metric-label">Maintainability</span>
              <span class="metric-value">${metric.maintainability}</span>
            </div>
            <div class="metric-item">
              <span class="metric-label">Lines of Code</span>
              <span class="metric-value">${metric.loc}</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function getComplexityClass(complexity) {
  if (complexity > 25) return 'critical';
  if (complexity > 15) return 'warning';
  return 'ok';
}
```

**Files to Modify**:
- `src/ui/chat-ui.html`
- `src/ui/chat-ui.js`
- `src/ui/chat-ui.css`

**Priority**: 🟡 High  
**Effort**: 6 hours

---

### Task 2.7: Add Export Functionality

**Feature**: Export analysis results in multiple formats

**Implementation**:
```javascript
// Add to chat-ui.html
<button id="exportBtn" class="sidebar-action" type="button">
  📥 Export
</button>

// Add to chat-ui.js
async function exportResults() {
  const format = await showExportDialog(); // 'json', 'csv', 'markdown', 'sarif'
  
  let content;
  let filename;
  let mimeType;
  
  switch (format) {
    case 'json':
      content = JSON.stringify({
        timestamp: new Date().toISOString(),
        issues: state.issues,
        stats: state.stats,
        metrics: state.metrics
      }, null, 2);
      filename = `aqt-report-${Date.now()}.json`;
      mimeType = 'application/json';
      break;
      
    case 'csv':
      content = issuesToCSV(state.issues);
      filename = `aqt-report-${Date.now()}.csv`;
      mimeType = 'text/csv';
      break;
      
    case 'markdown':
      content = issuesToMarkdown(state.issues, state.stats);
      filename = `aqt-report-${Date.now()}.md`;
      mimeType = 'text/markdown';
      break;
      
    case 'sarif':
      content = JSON.stringify(issuesToSARIF(state.issues), null, 2);
      filename = `aqt-report-${Date.now()}.sarif`;
      mimeType = 'application/json';
      break;
  }
  
  // Download file
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  
  addAssistantMessage(`✅ Report exported as ${filename}`);
}

function issuesToCSV(issues) {
  const headers = ['File', 'Line', 'Severity', 'Rule', 'Message'];
  const rows = issues.map(i => [
    i.file,
    i.line,
    i.severity,
    i.ruleId,
    i.message.replace(/,/g, ';') // Escape commas
  ]);
  
  return [
    headers.join(','),
    ...rows.map(r => r.join(','))
  ].join('\n');
}

function issuesToMarkdown(issues, stats) {
  return `# Code Quality Report

**Generated**: ${new Date().toISOString()}

## Summary

- **Total Issues**: ${stats.total}
- **Fixed**: ${stats.fixed}
- **Success Rate**: ${stats.successRate}%

## Issues by Severity

${['critical', 'error', 'warning', 'info'].map(severity => {
  const count = issues.filter(i => i.severity === severity).length;
  return `- **${severity.toUpperCase()}**: ${count}`;
}).join('\n')}

## Detailed Issues

${issues.map(issue => `
### ${issue.severity.toUpperCase()}: ${issue.message}

- **File**: \`${issue.file}:${issue.line}\`
- **Rule**: ${issue.ruleId}
`).join('\n')}
`;
}

function issuesToSARIF(issues) {
  // SARIF 2.1.0 format
  return {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: 'Advanced Quality Tool',
          version: '1.0.0',
          informationUri: 'https://github.com/your-org/aqt'
        }
      },
      results: issues.map(issue => ({
        ruleId: issue.ruleId,
        level: issue.severity === 'critical' || issue.severity === 'error' ? 'error' : 
               issue.severity === 'warning' ? 'warning' : 'note',
        message: { text: issue.message },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: issue.file },
            region: {
              startLine: parseInt(issue.line) || 1
            }
          }
        }]
      }))
    }]
  };
}
```

**Files to Modify**:
- `src/ui/chat-ui.html`
- `src/ui/chat-ui.js`

**Priority**: 🟡 High  
**Effort**: 8 hours

---

## Phase 3: Documentation Alignment (Medium Priority)

### Task 3.1: Add MCP Tools Documentation

**Action**: Add detailed MCP section to README

```markdown
## MCP Integration

The Advanced Quality Tool provides Model Context Protocol (MCP) integration for AI assistants.

### Available Tools

#### aqt_analyze
Run quality analysis on a project workspace.

**Input**:
- `projectRoot` (string, optional): Path to project
- `files` (array, optional): Specific files to analyze
- `categories` (array, optional): Filter by category

**Output**: Normalized issues array

**Example**:
\`\`\`json
{
  "name": "aqt_analyze",
  "arguments": {
    "projectRoot": "/path/to/project",
    "categories": ["security", "performance"]
  }
}
\`\`\`

[Document all 5 MCP tools in detail]
```

**Files to Modify**:
- `README.md`

**Priority**: 🟢 Medium  
**Effort**: 4 hours

---

### Task 3.2: Create Configuration Guide

**Action**: Add comprehensive configuration documentation

```markdown
## Configuration Guide

### Environment Variables

\`\`\`bash
# Project settings
AQT_PROJECT_ROOT=/path/to/project

# AI Provider settings
OPENAI_API_KEY=sk-...
AQT_LOCAL_MODEL_URL=http://localhost:11434

# Server settings
AQT_API_PORT=3000
AQT_API_HOST=localhost

# Policy settings
AQT_LOCAL_ONLY=false
AQT_ALLOW_CLOUD_FALLBACK=true

# Debug
AQT_VERBOSE=true
\`\`\`

### Config File (.aqt.config.js)

[Detailed configuration options with examples]

### MCP Configuration

[MCP client setup for Claude Desktop, Kiro, etc.]

### VS Code Settings

[VS Code extension configuration]
```

**Files to Modify**:
- `README.md`
- Create `docs/CONFIGURATION.md`

**Priority**: 🟢 Medium  
**Effort**: 5 hours

---

### Task 3.3: Create Usage Examples

**Action**: Add comprehensive usage examples

```markdown
## Usage Examples

### Example 1: Basic Workflow
[Step-by-step tutorial]

### Example 2: CI/CD Integration
[GitHub Actions, GitLab CI examples]

### Example 3: MCP Integration
[Claude Desktop, Kiro integration]

### Example 4: HTTP API Usage
[Complete API workflow with curl/axios]

### Example 5: Custom Rules
[Creating and using custom rules]
```

**Files to Create**:
- `docs/EXAMPLES.md`

**Files to Modify**:
- `README.md` (link to examples)

**Priority**: 🟢 Medium  
**Effort**: 6 hours

---

## Phase 4: Advanced Features (Low Priority)

### Task 4.1: Implement Pipeline Interface

**Feature**: Expose pipeline execution in all interfaces

**CLI**:
```bash
aqt pipeline list
aqt pipeline run <name> [options]
aqt pipeline status <execution-id>
```

**API**:
```
POST /api/pipelines/:name/execute
GET /api/pipelines
GET /api/pipelines/:name
GET /api/pipelines/executions/:id
```

**MCP**:
```
aqt_pipeline_list
aqt_pipeline_execute
aqt_pipeline_status
```

**Chat UI**:
- Add Pipelines tab
- Show available pipelines
- Execute pipeline with parameters
- Show execution status

**Priority**: 🔵 Low  
**Effort**: 20 hours

---

### Task 4.2: Implement Agent System Interface

**Feature**: Expose autonomous agent capabilities

**Decision Required**: 
- Should agent system be exposed?
- What level of autonomy is safe?
- What permission controls are needed?

**If implementing**:
- Add agent commands to CLI
- Add agent endpoints to API
- Add agent tools to MCP
- Add agent panel to Chat UI

**Priority**: 🔵 Low  
**Effort**: 40+ hours

---

### Task 4.3: Implement WebSocket Server

**Feature**: Real-time updates and notifications

**Implementation**:
```javascript
// src/integrations/websocket-server.js
const WebSocket = require('ws');

class WebSocketServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer });
    this.clients = new Set();
    this.setupHandlers();
  }
  
  setupHandlers() {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      
      ws.on('message', (message) => {
        this.handleMessage(ws, JSON.parse(message));
      });
      
      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }
  
  broadcast(event, data) {
    const message = JSON.stringify({ event, data });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
  
  // Events to broadcast:
  // - analysis_started
  // - analysis_progress
  // - analysis_complete
  // - fix_applied
  // - issue_detected
}
```

**Priority**: 🔵 Low  
**Effort**: 12 hours

---

### Task 4.4: Custom Rule Interface

**Feature**: Create and test custom rules via UI

**Implementation**:
- Rule editor with syntax highlighting
- Test panel with sample code
- Rule validation
- Save/load custom rules
- Apply custom rules to analysis

**Priority**: 🔵 Low  
**Effort**: 24 hours

---

## Phase 5: Quality Assurance

### Task 5.1: Integration Testing

**Action**: Comprehensive testing of all features

- CLI command testing
- API endpoint testing
- MCP tool testing
- Chat UI feature testing
- Cross-interface consistency testing

**Priority**: 🔴 Critical  
**Effort**: 16 hours

---

### Task 5.2: Documentation Review

**Action**: Complete documentation audit

- README.md accuracy review
- API documentation completeness
- Code comments and JSDoc
- User guides and tutorials
- Troubleshooting guide

**Priority**: 🟡 High  
**Effort**: 8 hours

---

### Task 5.3: Performance Testing

**Action**: Test at scale

- Large codebase analysis
- Concurrent API requests
- Memory usage profiling
- Response time benchmarks

**Priority**: 🟢 Medium  
**Effort**: 12 hours

---

## Effort Summary

| Phase | Total Hours | Priority |
|-------|-------------|----------|
| Phase 1: Critical Fixes | 14 hours | 🔴 Critical |
| Phase 2: Chat UI Enhancements | 35 hours | 🟡 High |
| Phase 3: Documentation | 15 hours | 🟢 Medium |
| Phase 4: Advanced Features | 96+ hours | 🔵 Low |
| Phase 5: QA | 36 hours | 🟡 High |
| **Total** | **196+ hours** | |

## Recommended Execution Order

### Week 1-2: Critical Fixes
- Task 1.1: Fix CLI (2h)
- Task 1.2: Document API (3h)
- Task 1.3: WebSocket investigation (9h)
- Task 5.1: Integration testing (16h)

### Week 3-4: Core Chat UI Features
- Task 2.1: Issue filtering (4h)
- Task 2.2: Search (3h)
- Task 2.3: Multi-select (6h)
- Task 2.4: Batch fixing (5h)
- Task 2.5: Security scan (3h)

### Week 5: Advanced Chat UI
- Task 2.6: Metrics dashboard (6h)
- Task 2.7: Export (8h)
- Task 5.2: Documentation review (8h)

### Week 6: Documentation
- Task 3.1: MCP docs (4h)
- Task 3.2: Configuration guide (5h)
- Task 3.3: Usage examples (6h)
- Task 5.3: Performance testing (12h)

### Future: Advanced Features
- Phase 4 tasks as needed

---

## Success Criteria

### Phase 1 Complete When:
- ✅ All documented CLI commands work
- ✅ HTTP API fully documented
- ✅ WebSocket status clarified
- ✅ Integration tests pass

### Phase 2 Complete When:
- ✅ Chat UI has filtering, search, multi-select
- ✅ Batch fixing works
- ✅ Security scan button functional
- ✅ Metrics dashboard implemented
- ✅ Export in 4 formats works

### Phase 3 Complete When:
- ✅ MCP tools documented
- ✅ Configuration guide complete
- ✅ Usage examples available
- ✅ All docs reviewed and accurate

### Phase 4 Complete When:
- ✅ Pipelines exposed (if decided)
- ✅ Agent system exposed (if decided)
- ✅ WebSocket implemented (if decided)
- ✅ Custom rules UI built (if decided)

### Phase 5 Complete When:
- ✅ All features tested
- ✅ Documentation accurate
- ✅ Performance benchmarks met

---

**Document Version**: 1.0  
**Created**: October 1, 2026  
**Status**: Ready for Implementation

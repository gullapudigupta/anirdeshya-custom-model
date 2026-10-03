# MCP (Model Context Protocol) Interface

## Overview

The MCP interface provides integration between the Advanced Quality Tool and AI development environments through the Model Context Protocol standard. This allows AQT to be used as a server providing code analysis and quality improvement capabilities to MCP-compatible clients.

## Architecture

```
MCP Client (IDE/Editor) ←→ MCP Protocol ←→ AQT MCP Server ←→ AQT Core Services
```

## Server Implementation

**File**: `src/integrations/mcp-server.js`

The AQT MCP Server implements the standard MCP protocol and exposes the following capabilities:

### Resources

- **Workspace Analysis**: Access to code quality reports and metrics
- **Issue Database**: Searchable repository of detected code issues
- **Fix Repository**: Library of available fixes and their metadata

### Tools

#### `analyze_workspace`
Performs comprehensive code quality analysis on a workspace.

**Parameters**:
- `workspacePath` (string, required): Path to the workspace directory
- `options` (object, optional): Analysis configuration
  - `languages`: Array of languages to analyze
  - `includeMetrics`: Include complexity metrics (default: true)
  - `includeSecurity`: Include security analysis (default: true)
  - `includePerformance`: Include performance checks (default: true)

**Returns**: Analysis report with issues, metrics, and recommendations

#### `fix_issue`
Applies a fix to a specific code issue.

**Parameters**:
- `issueId` (string, required): Unique identifier of the issue
- `workspacePath` (string, required): Path to the workspace
- `fixType` (string, optional): Type of fix ('auto', 'ai', 'manual')
- `options` (object, optional): Fix configuration
  - `dryRun`: Preview changes without applying (default: false)
  - `backup`: Create backup before applying (default: true)

**Returns**: Fix result with applied changes and verification status

#### `generate_fixes`
Generates multiple fixes for a set of issues.

**Parameters**:
- `issues` (array, required): Array of issue IDs or issue objects
- `workspacePath` (string, required): Path to the workspace
- `options` (object, optional): Generation configuration
  - `maxFixes`: Maximum number of fixes to generate
  - `priority`: Fix priority level ('low', 'medium', 'high')

**Returns**: Array of generated fixes with metadata

#### `get_report`
Retrieves a quality report by ID.

**Parameters**:
- `reportId` (string, required): Unique identifier of the report
- `format` (string, optional): Output format ('json', 'html', 'markdown')

**Returns**: Report data in requested format

### Prompts

#### `quality_analysis`
Template for requesting code quality analysis with context.

**Arguments**:
- `code` (string): Code snippet to analyze
- `language` (string): Programming language
- `context` (string, optional): Additional context about the code

#### `fix_suggestion`
Template for requesting fix suggestions for specific issues.

**Arguments**:
- `issue` (object): Issue details including type, severity, location
- `codeContext` (string): Surrounding code context

## Client Integration

### Kiro IDE Integration

The MCP server integrates seamlessly with Kiro IDE through the standard MCP client:

```json
{
  "mcpServers": {
    "aqt": {
      "command": "node",
      "args": ["path/to/aqt/src/integrations/mcp-server.js"],
      "env": {
        "AQT_WORKSPACE_PATH": "${workspaceFolder}",
        "AQT_CONFIG_PATH": "${workspaceFolder}/.aqt-config.json"
      }
    }
  }
}
```

### VS Code Integration

For VS Code with MCP extension:

```json
{
  "mcp.servers": {
    "aqt-quality": {
      "command": "node",
      "args": ["./node_modules/@aqt/mcp-server/dist/index.js"],
      "cwd": "${workspaceFolder}",
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

## Usage Examples

### Basic Workspace Analysis

```typescript
// In MCP client context
const result = await mcpClient.callTool('analyze_workspace', {
  workspacePath: '/path/to/project',
  options: {
    languages: ['javascript', 'typescript'],
    includeMetrics: true
  }
});

console.log(`Found ${result.issues.length} issues`);
console.log(`Overall quality score: ${result.qualityScore}`);
```

### Automated Issue Fixing

```typescript
// Get issues from analysis
const analysis = await mcpClient.callTool('analyze_workspace', {
  workspacePath: '/path/to/project'
});

// Generate fixes for high-priority issues
const highPriorityIssues = analysis.issues.filter(i => i.severity === 'error');
const fixes = await mcpClient.callTool('generate_fixes', {
  issues: highPriorityIssues,
  workspacePath: '/path/to/project',
  options: { priority: 'high' }
});

// Apply fixes
for (const fix of fixes) {
  if (fix.confidence > 0.8) {
    await mcpClient.callTool('fix_issue', {
      issueId: fix.issueId,
      workspacePath: '/path/to/project',
      options: { dryRun: false }
    });
  }
}
```

## Configuration

### Server Configuration

The MCP server can be configured through environment variables or configuration files:

**Environment Variables**:
- `AQT_MCP_PORT`: Server port (default: 8080)
- `AQT_MCP_HOST`: Server host (default: localhost)
- `AQT_LOG_LEVEL`: Logging level (debug, info, warn, error)
- `AQT_WORKSPACE_ROOT`: Default workspace path
- `AQT_CONFIG_PATH`: Path to AQT configuration file

**Configuration File** (`.aqt-mcp-config.json`):
```json
{
  "server": {
    "port": 8080,
    "host": "localhost",
    "maxConnections": 10
  },
  "analysis": {
    "defaultLanguages": ["javascript", "typescript", "python"],
    "enabledAnalyzers": ["security", "performance", "complexity"],
    "maxFileSize": "10MB"
  },
  "fixes": {
    "autoApplyThreshold": 0.9,
    "backupEnabled": true,
    "verificationEnabled": true
  }
}
```

## Error Handling

The MCP server implements comprehensive error handling:

### Error Types

- **ValidationError**: Invalid parameters or configuration
- **AnalysisError**: Failures during code analysis
- **FixError**: Issues during fix application
- **WorkspaceError**: Workspace access or permission issues

### Error Response Format

```json
{
  "error": {
    "code": "ANALYSIS_FAILED",
    "message": "Unable to analyze workspace",
    "details": {
      "workspacePath": "/invalid/path",
      "reason": "Directory not found"
    },
    "timestamp": "2023-12-01T10:30:00Z"
  }
}
```

## Security Considerations

### Authentication

The MCP server supports multiple authentication methods:

1. **Token-based**: Bearer token authentication
2. **Certificate-based**: mTLS for secure connections
3. **IP-based**: Whitelist of allowed client IPs

### Data Privacy

- Code content is never logged or stored permanently
- Analysis results are encrypted in transit
- Workspace access is restricted to configured paths
- Sensitive data is automatically redacted from reports

### Sandboxing

- Fix applications run in isolated environments
- File system access is restricted to workspace boundaries
- Network access is limited for analysis tools

## Performance Optimization

### Caching

- Analysis results are cached based on file checksums
- Fix templates are pre-compiled and cached
- Resource metadata is cached with TTL

### Streaming

Large analysis results support streaming responses:

```typescript
const stream = await mcpClient.streamTool('analyze_workspace', {
  workspacePath: '/large/project',
  options: { streaming: true }
});

stream.on('data', (chunk) => {
  // Process incremental results
  console.log(`Analyzed ${chunk.progress}% of files`);
});
```

## Monitoring and Metrics

The MCP server exposes metrics for monitoring:

- **Analysis Performance**: Time per analysis, files processed per second
- **Fix Success Rate**: Percentage of successful fix applications
- **Error Rate**: Categorized error frequencies
- **Resource Usage**: Memory and CPU utilization

Access metrics via `/metrics` endpoint (Prometheus format):

```
# HELP aqt_mcp_analysis_duration_seconds Time spent on workspace analysis
# TYPE aqt_mcp_analysis_duration_seconds histogram
aqt_mcp_analysis_duration_seconds_bucket{language="javascript",le="1"} 45
aqt_mcp_analysis_duration_seconds_bucket{language="javascript",le="5"} 120
```

## Troubleshooting

### Common Issues

1. **Connection Refused**
   - Check server is running on correct port
   - Verify firewall settings
   - Ensure MCP client configuration is correct

2. **Analysis Timeout**
   - Increase timeout in client configuration
   - Check workspace size and complexity
   - Enable streaming for large projects

3. **Fix Application Failed**
   - Verify file permissions
   - Check for conflicting changes
   - Review backup and rollback options

### Debug Mode

Enable debug logging:

```bash
AQT_LOG_LEVEL=debug node src/integrations/mcp-server.js
```

### Health Checks

The server provides health check endpoints:

- `GET /health`: Basic health status
- `GET /health/detailed`: Comprehensive system status
- `GET /health/ready`: Readiness probe for orchestration

## Related Documentation

- [Shared Configuration Guide](SHARED-CONFIG.md)
- [CLI Interface](CLI.md)
- [HTTP API Interface](API.md)
- [Orchestration Integration](ORCHESTRATION.md)
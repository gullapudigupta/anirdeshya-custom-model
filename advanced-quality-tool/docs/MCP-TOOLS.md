# MCP Tools Documentation

This document provides comprehensive documentation for all Model Context Protocol (MCP) tools available in Advanced Quality Tool (AQT).

## Table of Contents

1. [Overview](#overview)
2. [Integration](#integration)
3. [Tool Reference](#tool-reference)
   - [Agent Tools](#agent-tools)
   - [Pipeline Tools](#pipeline-tools)
   - [Security Tools](#security-tools)
   - [AI Generation Tools](#ai-generation-tools)
   - [Plugin Tools](#plugin-tools)
   - [Dashboard Tools](#dashboard-tools)
4. [Usage Examples](#usage-examples)
5. [Troubleshooting](#troubleshooting)

---

## Overview

Advanced Quality Tool provides MCP (Model Context Protocol) tools for integration with AI assistants like Claude Desktop and Kiro. These tools allow AI assistants to:

- Execute autonomous code tasks
- Run quality pipelines
- Perform security scans
- Generate code, tests, and documentation
- Manage plugins
- Track metrics

Use `aqt_tools_list` to discover available capabilities by group. Existing tools
are labeled with their group in their descriptions for clients that display the
standard MCP tool list.

| Group ID | Capabilities |
| --- | --- |
| `quality` | Analysis, review, issue fixes, and reports |
| `security` | Vulnerability, secret, and dependency scans |
| `ai` | Code, test, documentation, fix, and refactoring assistance |
| `agents` | Autonomous work lifecycle |
| `pipelines` | Pipeline discovery, execution, and status |
| `workspace` | Workspace settings, file access, and workspace-scoped analysis |
| `insights` | Dashboard and local metrics |
| `extensions` | Plugin management and hooks |

## Integration

### Claude Desktop Integration

Add the following to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "aqt": {
      "command": "node",
      "args": ["/path/to/advanced-quality-tool/src/mcp/mcp-server.js"],
      "env": {
        "AQT_WORKSPACE": "/path/to/your/project"
      }
    }
  }
}
```

### Kiro Integration

Add to your `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "aqt": {
      "command": "node",
      "args": ["./src/mcp/mcp-server.js"],
      "cwd": "/path/to/advanced-quality-tool"
    }
  }
}
```

---

## Tool Reference

Dashboard and plugin tools use project-local storage. Dashboard history remains
local to the workspace, while plugin lifecycle operations may load and execute
project plugin code; only install plugins that have been reviewed.

### Agent Tools

Agent tools provide access to AQT's autonomous agent system.

#### aqt_agent_start

Start autonomous agent work on a coding task.

**Schema:**
```json
{
  "name": "aqt_agent_start",
  "description": "Start an autonomous agent to perform a coding task",
  "inputSchema": {
    "type": "object",
    "properties": {
      "description": {
        "type": "string",
        "description": "Description of the work to perform"
      },
      "files": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Files to include in the work"
      },
      "priority": {
        "type": "string",
        "enum": ["critical", "high", "medium", "low"],
        "default": "medium"
      },
      "maxFiles": {
        "type": "integer",
        "default": 50,
        "description": "Maximum files to modify"
      },
      "autoApprove": {
        "type": "boolean",
        "default": false,
        "description": "Automatically approve high-risk operations"
      }
    },
    "required": ["description"]
  }
}
```

**Returns:**
```json
{
  "workId": "work-1697123456789-abc123",
  "status": "started",
  "description": "Fix the authentication bug in login.js"
}
```

#### aqt_agent_status

Get the status of agent work.

**Schema:**
```json
{
  "name": "aqt_agent_status",
  "description": "Get the status of agent work",
  "inputSchema": {
    "type": "object",
    "properties": {
      "workId": {
        "type": "string",
        "description": "The work ID to check"
      }
    },
    "required": ["workId"]
  }
}
```

**Returns:**
```json
{
  "id": "work-1697123456789-abc123",
  "description": "Fix the authentication bug",
  "status": "working",
  "priority": "high",
  "started": "2024-10-12T10:30:00.000Z",
  "plan": {
    "steps": [...],
    "affectedFiles": [...],
    "risks": [...]
  }
}
```

#### aqt_agent_list

List all agent work items.

**Schema:**
```json
{
  "name": "aqt_agent_list",
  "description": "List all agent work items",
  "inputSchema": {
    "type": "object",
    "properties": {
      "status": {
        "type": "string",
        "enum": ["queued", "working", "completed", "failed", "cancelled"]
      }
    }
  }
}
```

#### aqt_agent_cancel

Cancel active agent work.

**Schema:**
```json
{
  "name": "aqt_agent_cancel",
  "description": "Cancel active agent work",
  "inputSchema": {
    "type": "object",
    "properties": {
      "workId": {
        "type": "string",
        "description": "The work ID to cancel"
      }
    },
    "required": ["workId"]
  }
}
```

---

### Pipeline Tools

Pipeline tools provide access to AQT's pipeline orchestration system.

#### aqt_pipeline_list

List all available pipelines.

**Schema:**
```json
{
  "name": "aqt_pipeline_list",
  "description": "List all available pipelines",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

**Returns:**
```json
{
  "pipelines": [
    {
      "id": "workspace-quality-analysis",
      "name": "Workspace Quality Analysis",
      "version": "1.0.0",
      "stages": ["resolve-workspace", "detect-tools", ...]
    },
    ...
  ],
  "count": 17
}
```

#### aqt_pipeline_info

Get detailed information about a pipeline.

**Schema:**
```json
{
  "name": "aqt_pipeline_info",
  "description": "Get detailed pipeline information",
  "inputSchema": {
    "type": "object",
    "properties": {
      "pipelineId": {
        "type": "string",
        "description": "The pipeline ID"
      }
    },
    "required": ["pipelineId"]
  }
}
```

#### aqt_pipeline_execute

Execute a pipeline.

**Schema:**
```json
{
  "name": "aqt_pipeline_execute",
  "description": "Execute a pipeline",
  "inputSchema": {
    "type": "object",
    "properties": {
      "pipelineId": {
        "type": "string",
        "description": "The pipeline ID to execute"
      },
      "input": {
        "type": "object",
        "description": "Pipeline input parameters"
      },
      "workspace": {
        "type": "string",
        "description": "Workspace path"
      },
      "taskId": {
        "type": "string",
        "description": "Associated task ID"
      }
    },
    "required": ["pipelineId"]
  }
}
```

**Returns:**
```json
{
  "runId": "run-1697123456789-abc123",
  "pipelineId": "auto-fix",
  "status": "started"
}
```

#### aqt_pipeline_status

Get pipeline execution status.

**Schema:**
```json
{
  "name": "aqt_pipeline_status",
  "description": "Get pipeline execution status",
  "inputSchema": {
    "type": "object",
    "properties": {
      "runId": {
        "type": "string",
        "description": "The execution run ID"
      }
    },
    "required": ["runId"]
  }
}
```

---

### Security Tools

Security tools provide access to AQT's security scanning capabilities.

#### aqt_security_scan

Run a comprehensive security scan.

**Schema:**
```json
{
  "name": "aqt_security_scan",
  "description": "Run a comprehensive security scan",
  "inputSchema": {
    "type": "object",
    "properties": {
      "scope": {
        "type": "string",
        "enum": ["workspace", "files", "dependencies"],
        "default": "workspace"
      },
      "scanTypes": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["vulnerabilities", "secrets", "dependencies"]
        },
        "default": ["vulnerabilities", "secrets", "dependencies"]
      },
      "severity": {
        "type": "string",
        "enum": ["critical", "high", "medium", "low", "all"],
        "default": "all"
      }
    }
  }
}
```

**Returns:**
```json
{
  "scanId": "scan-1697123456789",
  "findings": [
    {
      "type": "vulnerability",
      "severity": "high",
      "title": "CVE-2024-1234",
      "description": "Prototype pollution vulnerability",
      "file": "package.json",
      "package": "lodash@4.17.15",
      "fix": "Upgrade to lodash@4.17.21"
    }
  ],
  "summary": {
    "critical": 0,
    "high": 1,
    "medium": 3,
    "low": 5
  }
}
```

#### aqt_security_vulnerabilities

Scan for known vulnerabilities.

**Schema:**
```json
{
  "name": "aqt_security_vulnerabilities",
  "description": "Scan for known vulnerabilities",
  "inputSchema": {
    "type": "object",
    "properties": {
      "files": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Files to scan"
      }
    }
  }
}
```

#### aqt_security_secrets

Scan for hardcoded secrets.

**Schema:**
```json
{
  "name": "aqt_security_secrets",
  "description": "Scan for hardcoded secrets and credentials",
  "inputSchema": {
    "type": "object",
    "properties": {
      "files": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Files to scan"
      }
    }
  }
}
```

#### aqt_security_dependencies

Check dependencies for CVEs.

**Schema:**
```json
{
  "name": "aqt_security_dependencies",
  "description": "Check dependencies for known vulnerabilities",
  "inputSchema": {
    "type": "object",
    "properties": {
      "workspace": {
        "type": "string",
        "description": "Workspace path"
      }
    }
  }
}
```

---

### AI Generation Tools

AI generation tools provide access to AQT's AI-powered code generation.

#### aqt_ai_generate_code

Generate code from a description.

**Schema:**
```json
{
  "name": "aqt_ai_generate_code",
  "description": "Generate code from a natural language description",
  "inputSchema": {
    "type": "object",
    "properties": {
      "description": {
        "type": "string",
        "description": "What code to generate"
      },
      "language": {
        "type": "string",
        "enum": ["javascript", "typescript", "python", "java", "csharp", "go", "rust"],
        "default": "javascript"
      },
      "framework": {
        "type": "string",
        "description": "Framework to use (e.g., react, express)"
      },
      "provider": {
        "type": "string",
        "enum": ["openai", "anthropic", "google", "ollama"]
      }
    },
    "required": ["description"]
  }
}
```

#### aqt_ai_generate_test

Generate unit tests for a file.

**Schema:**
```json
{
  "name": "aqt_ai_generate_test",
  "description": "Generate unit tests for a file",
  "inputSchema": {
    "type": "object",
    "properties": {
      "filePath": {
        "type": "string",
        "description": "Path to the file to test"
      },
      "framework": {
        "type": "string",
        "enum": ["jest", "mocha", "vitest", "pytest", "junit"],
        "default": "jest"
      }
    },
    "required": ["filePath"]
  }
}
```

#### aqt_ai_generate_doc

Generate documentation for a file.

**Schema:**
```json
{
  "name": "aqt_ai_generate_doc",
  "description": "Generate documentation for a file",
  "inputSchema": {
    "type": "object",
    "properties": {
      "filePath": {
        "type": "string",
        "description": "Path to the file to document"
      },
      "format": {
        "type": "string",
        "enum": ["markdown", "jsdoc", "jsdoc-markdown"],
        "default": "markdown"
      }
    },
    "required": ["filePath"]
  }
}
```

#### aqt_ai_fix_issue

Generate a fix for a specific issue.

**Schema:**
```json
{
  "name": "aqt_ai_fix_issue",
  "description": "Generate an AI-powered fix for an issue",
  "inputSchema": {
    "type": "object",
    "properties": {
      "issueId": {
        "type": "string",
        "description": "The issue ID to fix"
      },
      "dryRun": {
        "type": "boolean",
        "default": false,
        "description": "Preview without applying"
      }
    },
    "required": ["issueId"]
  }
}
```

#### aqt_ai_refactor

Refactor code with AI assistance.

**Schema:**
```json
{
  "name": "aqt_ai_refactor",
  "description": "Refactor code with AI assistance",
  "inputSchema": {
    "type": "object",
    "properties": {
      "filePath": {
        "type": "string",
        "description": "Path to the file to refactor"
      },
      "description": {
        "type": "string",
        "description": "What refactoring to perform"
      },
      "autoApply": {
        "type": "boolean",
        "default": false,
        "description": "Automatically apply changes"
      }
    },
    "required": ["filePath", "description"]
  }
}
```

---

### Plugin Tools

Plugin tools provide access to AQT's plugin management system.

#### aqt_plugin_list

List installed plugins.

#### aqt_plugin_install

Install a plugin.

**Schema:**
```json
{
  "name": "aqt_plugin_install",
  "description": "Install a plugin",
  "inputSchema": {
    "type": "object",
    "properties": {
      "plugin": {
        "type": "string",
        "description": "Plugin name or path"
      }
    },
    "required": ["plugin"]
  }
}
```

#### aqt_plugin_remove

Remove a plugin.

#### aqt_plugin_info

Get plugin information.

---

### Dashboard Tools

Dashboard tools provide access to metrics and reporting.

#### aqt_dashboard_configure

Configure dashboard settings.

#### aqt_dashboard_record_metrics

Record metrics to the dashboard.

#### aqt_dashboard_status

Get dashboard connection status.

---

## Usage Examples

### Example 1: Start Agent Work

```json
// Request
{
  "name": "aqt_agent_start",
  "arguments": {
    "description": "Add input validation to the createUser function",
    "files": ["src/services/userService.js"],
    "priority": "high"
  }
}

// Response
{
  "workId": "work-1697123456789-abc123",
  "status": "started",
  "message": "Agent work started successfully"
}
```

### Example 2: Execute Pipeline

```json
// Request
{
  "name": "aqt_pipeline_execute",
  "arguments": {
    "pipelineId": "auto-fix",
    "input": {
      "strategy": "three-tier",
      "dryRun": false
    },
    "workspace": "/path/to/project"
  }
}

// Response
{
  "runId": "run-1697123456789-xyz789",
  "status": "started",
  "message": "Pipeline execution started"
}
```

### Example 3: Security Scan

```json
// Request
{
  "name": "aqt_security_scan",
  "arguments": {
    "scanTypes": ["vulnerabilities", "secrets"],
    "severity": "high"
  }
}

// Response
{
  "scanId": "scan-1697123456789",
  "findings": [
    {
      "type": "secret",
      "severity": "critical",
      "title": "API Key Detected",
      "file": ".env",
      "line": 5
    }
  ],
  "summary": {
    "critical": 1,
    "high": 0,
    "medium": 0,
    "low": 0
  }
}
```

### Example 4: Generate Code

```json
// Request
{
  "name": "aqt_ai_generate_code",
  "arguments": {
    "description": "Create a function that validates email addresses",
    "language": "typescript",
    "framework": "react"
  }
}

// Response
{
  "code": "export function validateEmail(email: string): boolean {\n  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n  return emailRegex.test(email);\n}",
  "language": "typescript",
  "cost": 0.0023
}
```

---

## Troubleshooting

### Common Issues

#### 1. MCP Server Not Starting

**Symptom:** Claude Desktop shows "Server not responding"

**Solution:**
- Check that Node.js is installed and in PATH
- Verify the path to mcp-server.js is correct
- Check the AQT_WORKSPACE environment variable

#### 2. Tool Execution Timeout

**Symptom:** Tool execution times out

**Solution:**
- Increase timeout in MCP configuration
- Check if the operation is long-running
- Use async patterns (start then poll status)

#### 3. Permission Denied

**Symptom:** Tool returns permission error

**Solution:**
- Check file permissions
- Verify workspace path is accessible
- Ensure autoApprove is set correctly for high-risk operations

### Debug Mode

Enable debug logging in the MCP server:

```json
{
  "mcpServers": {
    "aqt": {
      "command": "node",
      "args": ["./src/mcp/mcp-server.js"],
      "env": {
        "AQT_DEBUG": "true",
        "AQT_LOG_LEVEL": "debug"
      }
    }
  }
}
```

---

## Best Practices

1. **Use async patterns for long operations:** Start work, then poll status
2. **Set appropriate priorities:** Use "critical" sparingly
3. **Review agent plans:** Always review plans before approving high-risk operations
4. **Monitor costs:** Track AI generation costs with the cost tracking tools
5. **Use dry-run mode:** Test fixes before applying them

---

## Additional Resources

- [Main Documentation](../README.md)
- [API Documentation](./openapi.yaml)
- [Agent Guide](./guides/AGENT_GUIDE.md)
- [Pipeline Guide](./guides/PIPELINE_GUIDE.md)
- [Plugin Development Guide](./PLUGIN-DEVELOPMENT-GUIDE.md)

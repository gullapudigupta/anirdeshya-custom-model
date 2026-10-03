# Interface Documentation

## Overview

The Advanced Quality Tool provides multiple interfaces for different use cases and integration scenarios. Each interface offers full access to AQT functionality while maintaining consistent behavior and results across all access methods.

## Available Interfaces

### 📋 [CLI Interface](CLI.md)
Command-line interface for terminal usage, scripts, and automation.

**Best for**: 
- Terminal users and developers
- CI/CD pipeline integration
- Scripting and automation
- Batch processing and reporting

**Key Features**:
- Comprehensive command set
- Machine-readable output formats
- Configuration file support
- Workspace-aware operations

### 🌐 [API Interface](API.md)
HTTP/REST API for programmatic integration.

**Best for**:
- Web applications and services
- Integration with other tools
- Custom dashboards and reporting
- Remote access scenarios

**Key Features**:
- RESTful endpoints
- JSON request/response format
- Authentication and rate limiting
- WebSocket for real-time updates

### 🔌 [MCP Interface](MCP.md)
Model Context Protocol server for AI development environments.

**Best for**:
- IDE and editor integrations
- AI-assisted development workflows
- Real-time code analysis
- Context-aware AI interactions

**Key Features**:
- Standard MCP protocol compliance
- Resource and tool definitions
- Real-time workspace analysis
- Structured fix recommendations

### ⚙️ [Orchestration Interface](ORCHESTRATION.md)
Tool adapter for orchestration and workflow systems.

**Best for**:
- CI/CD orchestration platforms
- Workflow automation systems
- Task scheduling and coordination
- Enterprise integration scenarios

**Key Features**:
- Machine-readable capabilities
- Input/output contract definitions
- Error state handling
- Cancellation and timeout support

### 🔧 [Shared Configuration](SHARED-CONFIG.md)
Shared configuration system used across all interfaces.

**Best for**:
- Consistent configuration management
- Cross-interface settings
- Environment-specific configurations
- Team and project settings

**Key Features**:
- Unified configuration format
- Environment variable support
- Configuration inheritance
- Validation and defaults

## Interface Comparison

| Interface | Access Method | Primary Use Case | Real-time | Authentication |
|-----------|--------------|------------------|-----------|----------------|
| CLI | Command Line | Automation, Scripting | No | File system |
| API | HTTP/REST | Web Integration | Yes | API Keys, OAuth |
| MCP | MCP Protocol | IDE Integration | Yes | Protocol-level |
| Orchestration | Tool Adapter | Workflow Systems | Optional | System-dependent |

## Getting Started

### Choose the Right Interface

1. **For terminal usage or scripts**: Use [CLI Interface](CLI.md)
2. **For web applications or remote access**: Use [API Interface](API.md)  
3. **For IDE/editor integration**: Use [MCP Interface](MCP.md)
4. **For workflow/orchestration**: Use [Orchestration Interface](ORCHESTRATION.md)

### Common Configuration

All interfaces share common configuration through the [Shared Configuration](SHARED-CONFIG.md) system. Configure once, use everywhere:

```json
{
  "workspace": {
    "path": "./",
    "exclude": ["node_modules", ".git", "dist"]
  },
  "analysis": {
    "languages": ["javascript", "typescript", "css"],
    "severity": ["error", "warning", "suggestion"]
  },
  "ai": {
    "enabled": true,
    "strategy": "local-first",
    "budget": {
      "daily": 10.0,
      "perRun": 2.0
    }
  }
}
```

## Implementation Details

### Shared Core Architecture

All interfaces use the same underlying AQT core services, ensuring consistent behavior:

```
┌─────────────────────────────────────────────────┐
│              Interface Layer                     │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌────────────┐  │
│  │ CLI  │  │ API  │  │ MCP  │  │Orchestration│ │
│  └──────┘  └──────┘  └──────┘  └────────────┘  │
├─────────────────────────────────────────────────┤
│            Interface Adapters                    │
│  (transforms interface-specific inputs/outputs)  │
├─────────────────────────────────────────────────┤
│            Shared Core Services                  │
│  • Analysis Engine                              │
│  • Fix Orchestrator                             │
│  • Issue Database                               │
│  • Configuration Manager                        │
└─────────────────────────────────────────────────┘
```

### Consistent Behavior

Regardless of the interface used, you can expect:

1. **Same analysis results** - Identical issues detected with same severity
2. **Same fix behavior** - Consistent application of fixes and rollbacks
3. **Same configuration** - Unified configuration system
4. **Same error handling** - Consistent error messages and recovery

## Integration Examples

### CLI + API Combination
```bash
# Use CLI for local analysis
aqt analyze --format json > analysis.json

# Send to API for team dashboard
curl -X POST https://api.example.com/analysis \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @analysis.json
```

### MCP + Orchestration Workflow
```yaml
# Orchestration workflow using MCP
workflow:
  - analyze:
      tool: mcp://aqt/analyze_workspace
      params:
        workspacePath: "{{workspace}}"
        options:
          includeSecurity: true
  - fix_issues:
      tool: mcp://aqt/fix_issue
      for_each: "{{analysis.issues}}"
      params:
        issueId: "{{item.id}}"
        workspacePath: "{{workspace}}"
```

## Related Documentation

- [AI Generator API](../api/AI_GENERATOR_API.md) - AI-specific API documentation
- [CLI Quick Start](../guides/CLI-QUICK-START.md) - CLI usage guide
- [Shared Configuration](SHARED-CONFIG.md) - Configuration system details
- [Project Documentation](../project/) - Project overview and architecture

## Support and Troubleshooting

### Common Issues

1. **Configuration not applied**: Verify configuration file location and syntax
2. **Authentication failures**: Check API keys or credentials
3. **Connection issues**: Verify network connectivity and firewall settings
4. **Permission errors**: Check file system permissions for workspace access

### Getting Help

- Check interface-specific documentation for detailed troubleshooting
- Review [Shared Configuration](SHARED-CONFIG.md) for configuration issues
- Consult [Project Documentation](../project/) for architectural questions
- Use `--verbose` flag (CLI) or enable debug logging (API/MCP) for detailed logs

---

*Last Updated: 2026-10-01*  
*Interface Version: 1.0*  
*Compatibility: All interfaces compatible with AQT Core v0.4.0+*
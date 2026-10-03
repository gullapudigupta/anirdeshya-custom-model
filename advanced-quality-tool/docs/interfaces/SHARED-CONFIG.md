# Shared Configuration Guide

## Overview

The Advanced Quality Tool uses a unified configuration system that supports multiple interfaces (CLI, API, MCP, Orchestration) while maintaining consistency across all access points. This guide covers configuration structure, inheritance, validation, and best practices.

## Configuration Hierarchy

Configuration is resolved in the following order (later sources override earlier ones):

1. **Built-in Defaults**: Base configuration embedded in AQT
2. **Global Config**: User-level configuration (`~/.aqt/config.json`)
3. **Workspace Config**: Project-specific configuration (`.aqt-config.json`)
4. **Environment Variables**: Runtime environment overrides
5. **Command Arguments**: Direct parameter overrides (CLI/API)

```
Built-in Defaults
       ↓
Global Config (~/.aqt/config.json)
       ↓
Workspace Config (.aqt-config.json)
       ↓
Environment Variables (AQT_*)
       ↓
Command Arguments/API Parameters
```

## Configuration File Structure

### Primary Configuration File

**Locations**:
- Workspace: `.aqt-config.json`
- Global: `~/.aqt/config.json`

**Full Schema**:
```json
{
  "$schema": "https://schemas.aqt.dev/config/v1.json",
  "version": "1.0",
  "workspace": {
    "root": ".",
    "name": "My Project",
    "type": "javascript"
  },
  "analysis": {
    "includeMetrics": true,
    "includeSecurity": true,
    "includePerformance": true,
    "languages": ["javascript", "typescript"],
    "excludePatterns": [
      "node_modules/**",
      "**/*.test.js",
      "dist/**",
      "coverage/**"
    ],
    "includePatterns": [
      "src/**/*.js",
      "src/**/*.ts"
    ],
    "severity": {
      "minimum": "warning",
      "failOn": "error"
    },
    "timeout": 300000,
    "maxFileSize": "10MB",
    "maxFiles": 10000,
    "parallel": {
      "enabled": true,
      "maxProcesses": 4
    }
  },
  "rules": {
    "enabled": true,
    "rulesets": [
      "@aqt/recommended",
      "@aqt/security",
      "./custom-rules.js"
    ],
    "overrides": {
      "no-console": "off",
      "security/detect-eval-with-expression": "error"
    },
    "custom": {
      "enableExperimental": false,
      "strictMode": true
    }
  },
  "fixes": {
    "autoApply": false,
    "confidence": {
      "minimum": 0.8,
      "autoApply": 0.95
    },
    "types": {
      "ruleBased": true,
      "aiAssisted": true,
      "manual": false
    },
    "backup": {
      "enabled": true,
      "directory": ".aqt-backup",
      "retention": "7d"
    },
    "verification": {
      "enabled": true,
      "runTests": false,
      "checkSyntax": true,
      "runLinters": true
    }
  },
  "reporting": {
    "formats": ["json", "html"],
    "outputDirectory": "reports",
    "includeMetrics": true,
    "includeTrends": false,
    "template": "default",
    "customFields": {
      "project": "My Project",
      "team": "Development Team"
    }
  },
  "integrations": {
    "cli": {
      "colors": true,
      "interactive": true,
      "progress": true
    },
    "api": {
      "enabled": true,
      "port": 3000,
      "host": "localhost",
      "cors": {
        "enabled": true,
        "origins": ["http://localhost:3000"]
      },
      "auth": {
        "type": "none"
      }
    },
    "mcp": {
      "enabled": true,
      "port": 8080,
      "resources": ["analysis", "fixes", "reports"]
    },
    "orchestration": {
      "enabled": false,
      "platforms": ["github", "gitlab"],
      "webhooks": {
        "secret": "${WEBHOOK_SECRET}"
      }
    }
  },
  "cache": {
    "enabled": true,
    "directory": ".aqt-cache",
    "ttl": "1h",
    "maxSize": "100MB"
  },
  "logging": {
    "level": "info",
    "format": "pretty",
    "outputs": ["console"],
    "files": {
      "enabled": false,
      "directory": "logs",
      "maxSize": "10MB",
      "retention": 5
    }
  },
  "plugins": {
    "enabled": true,
    "directories": ["./plugins", "~/.aqt/plugins"],
    "autoload": ["@aqt/eslint-plugin"]
  },
  "security": {
    "allowRemoteConfig": false,
    "allowArbitraryExecution": false,
    "sandboxFixes": true,
    "maxMemoryUsage": "1GB"
  }
}
```

## Configuration Sections

### Analysis Configuration

Controls how code analysis is performed:

```json
{
  "analysis": {
    "includeMetrics": true,
    "includeSecurity": true,
    "includePerformance": true,
    "languages": ["javascript", "typescript", "python"],
    "excludePatterns": ["node_modules/**", "**/*.test.js"],
    "severity": {
      "minimum": "warning",
      "failOn": "error"
    },
    "timeout": 300000,
    "parallel": {
      "enabled": true,
      "maxProcesses": 4
    }
  }
}
```

**Options**:
- `includeMetrics`: Enable complexity and maintainability metrics
- `includeSecurity`: Enable security vulnerability detection
- `includePerformance`: Enable performance issue detection
- `languages`: Array of languages to analyze
- `excludePatterns`: Glob patterns to exclude from analysis
- `includePatterns`: Glob patterns to include (overrides excludes)
- `severity.minimum`: Minimum severity to report ('info', 'warning', 'error', 'critical')
- `severity.failOn`: Severity level that causes failure
- `timeout`: Analysis timeout in milliseconds
- `parallel.enabled`: Enable parallel processing
- `parallel.maxProcesses`: Maximum concurrent processes

### Rules Configuration

Manages rule execution and customization:

```json
{
  "rules": {
    "enabled": true,
    "rulesets": [
      "@aqt/recommended",
      "@aqt/security",
      "@aqt/performance",
      "./custom-rules.js"
    ],
    "overrides": {
      "no-console": "off",
      "security/detect-eval": "error",
      "complexity/max-depth": ["warning", { "max": 4 }]
    },
    "custom": {
      "enableExperimental": false,
      "strictMode": true
    }
  }
}
```

**Built-in Rulesets**:
- `@aqt/recommended`: General best practices
- `@aqt/security`: Security-focused rules
- `@aqt/performance`: Performance optimization rules
- `@aqt/accessibility`: Accessibility compliance rules

### Fix Configuration

Controls automated fix behavior:

```json
{
  "fixes": {
    "autoApply": false,
    "confidence": {
      "minimum": 0.8,
      "autoApply": 0.95
    },
    "types": {
      "ruleBased": true,
      "aiAssisted": true,
      "manual": false
    },
    "backup": {
      "enabled": true,
      "directory": ".aqt-backup",
      "retention": "7d"
    },
    "verification": {
      "enabled": true,
      "runTests": false,
      "checkSyntax": true,
      "runLinters": true
    }
  }
}
```

### Integration-Specific Configuration

#### CLI Configuration

```json
{
  "integrations": {
    "cli": {
      "colors": true,
      "interactive": true,
      "progress": true,
      "pager": "auto",
      "editor": "${EDITOR:-nano}"
    }
  }
}
```

#### API Configuration

```json
{
  "integrations": {
    "api": {
      "enabled": true,
      "port": 3000,
      "host": "localhost",
      "cors": {
        "enabled": true,
        "origins": ["http://localhost:3000", "https://app.example.com"],
        "credentials": true
      },
      "auth": {
        "type": "token",
        "token": "${API_TOKEN}",
        "expiry": "24h"
      },
      "rateLimit": {
        "windowMs": 900000,
        "max": 100
      }
    }
  }
}
```

#### MCP Configuration

```json
{
  "integrations": {
    "mcp": {
      "enabled": true,
      "port": 8080,
      "host": "localhost",
      "resources": ["analysis", "fixes", "reports"],
      "tools": ["analyze_workspace", "fix_issue", "generate_fixes"],
      "prompts": ["quality_analysis", "fix_suggestion"]
    }
  }
}
```

#### Orchestration Configuration

```json
{
  "integrations": {
    "orchestration": {
      "enabled": false,
      "platforms": {
        "github": {
          "enabled": true,
          "appId": "${GITHUB_APP_ID}",
          "privateKeyPath": "/secrets/github-app.pem",
          "webhookSecret": "${GITHUB_WEBHOOK_SECRET}"
        },
        "gitlab": {
          "enabled": false,
          "url": "https://gitlab.com",
          "token": "${GITLAB_TOKEN}"
        }
      },
      "workflows": {
        "qualityGate": "./workflows/quality-gate.yml",
        "autoFix": "./workflows/auto-fix.yml"
      }
    }
  }
}
```

## Environment Variables

Configuration values can be overridden using environment variables:

### General Variables

```bash
AQT_CONFIG_PATH=/path/to/config.json
AQT_WORKSPACE_PATH=/path/to/workspace
AQT_LOG_LEVEL=debug
AQT_CACHE_ENABLED=true
AQT_CACHE_DIR=/tmp/aqt-cache
```

### Analysis Variables

```bash
AQT_ANALYSIS_TIMEOUT=600000
AQT_ANALYSIS_PARALLEL=8
AQT_ANALYSIS_LANGUAGES=javascript,typescript,python
AQT_EXCLUDE_PATTERNS="node_modules/**,**/*.test.js"
```

### Integration Variables

```bash
# API Server
AQT_API_PORT=3000
AQT_API_HOST=0.0.0.0
AQT_API_TOKEN=your-secret-token

# MCP Server  
AQT_MCP_PORT=8080
AQT_MCP_HOST=localhost

# Orchestration
AQT_GITHUB_APP_ID=123456
AQT_GITHUB_WEBHOOK_SECRET=webhook-secret
AQT_GITLAB_TOKEN=gitlab-token
```

### Variable Naming Convention

Environment variables follow the pattern `AQT_<SECTION>_<OPTION>`:

- `AQT_ANALYSIS_INCLUDE_METRICS=true` → `analysis.includeMetrics`
- `AQT_FIXES_AUTO_APPLY=false` → `fixes.autoApply`
- `AQT_API_PORT=8080` → `integrations.api.port`

Nested objects use underscores:
- `AQT_FIXES_CONFIDENCE_MINIMUM=0.8` → `fixes.confidence.minimum`

## Configuration Templates

### Minimal Configuration

```json
{
  "analysis": {
    "languages": ["javascript"]
  }
}
```

### JavaScript/TypeScript Project

```json
{
  "analysis": {
    "languages": ["javascript", "typescript"],
    "excludePatterns": [
      "node_modules/**",
      "dist/**",
      "**/*.test.{js,ts}",
      "**/*.spec.{js,ts}"
    ]
  },
  "rules": {
    "rulesets": ["@aqt/recommended", "@aqt/typescript"]
  },
  "fixes": {
    "autoApply": false,
    "confidence": {
      "minimum": 0.9
    }
  }
}
```

### Python Project

```json
{
  "analysis": {
    "languages": ["python"],
    "excludePatterns": [
      "__pycache__/**",
      "*.pyc",
      "venv/**",
      "**/*_test.py"
    ]
  },
  "rules": {
    "rulesets": ["@aqt/recommended", "@aqt/python"]
  },
  "reporting": {
    "formats": ["json", "html"]
  }
}
```

### Multi-Language Project

```json
{
  "analysis": {
    "languages": ["javascript", "typescript", "python", "java"],
    "excludePatterns": [
      "node_modules/**",
      "__pycache__/**", 
      "target/**",
      "**/*test*"
    ]
  },
  "rules": {
    "rulesets": [
      "@aqt/recommended",
      "@aqt/security", 
      "@aqt/performance"
    ]
  },
  "integrations": {
    "api": {
      "enabled": true,
      "port": 3000
    },
    "orchestration": {
      "enabled": true,
      "platforms": ["github"]
    }
  }
}
```

### CI/CD Configuration

```json
{
  "analysis": {
    "includeMetrics": true,
    "includeSecurity": true,
    "severity": {
      "failOn": "error"
    },
    "timeout": 600000
  },
  "fixes": {
    "autoApply": false
  },
  "reporting": {
    "formats": ["json", "junit"],
    "outputDirectory": "ci-reports"
  },
  "cache": {
    "enabled": false
  },
  "logging": {
    "level": "info",
    "format": "json"
  }
}
```

## Configuration Validation

### Schema Validation

AQT validates configuration against JSON Schema:

```bash
# Validate configuration file
aqt config validate

# Validate specific file
aqt config validate --config custom-config.json

# Show validation errors
aqt config validate --verbose
```

### Common Validation Errors

1. **Invalid Language**: Specified language not supported
2. **Invalid Severity**: Severity level not recognized
3. **Invalid Pattern**: Malformed glob pattern
4. **Missing Dependency**: Required plugin or ruleset not found
5. **Invalid Path**: Specified directory or file doesn't exist

### Custom Validation

Add custom validation rules:

```javascript
// custom-validator.js
module.exports = {
  name: 'custom-validator',
  validate(config) {
    const errors = [];
    
    if (config.analysis?.languages?.includes('cobol')) {
      errors.push('COBOL is not supported yet');
    }
    
    if (config.fixes?.autoApply && config.fixes?.confidence?.minimum < 0.9) {
      errors.push('Auto-apply requires minimum 0.9 confidence');
    }
    
    return errors;
  }
};
```

## Configuration Management

### Initialization

Create new configuration:

```bash
# Interactive initialization
aqt config init

# Initialize with template
aqt config init --template javascript

# Initialize with defaults
aqt config init --minimal
```

### Configuration Editing

```bash
# Show current configuration
aqt config show

# Edit configuration
aqt config edit

# Set specific values
aqt config set analysis.languages javascript,typescript
aqt config set fixes.autoApply true

# Get specific values  
aqt config get analysis.excludePatterns
```

### Configuration Import/Export

```bash
# Export configuration
aqt config export --output my-config.json

# Import configuration
aqt config import --file shared-config.json

# Merge configurations
aqt config merge --file additional-config.json
```

## Best Practices

### Organization

1. **Use Templates**: Start with appropriate templates for your project type
2. **Modular Configuration**: Split large configs into multiple files
3. **Environment-Specific**: Use separate configs for dev/staging/production
4. **Version Control**: Include configuration in version control
5. **Documentation**: Comment complex configuration choices

### Security

1. **Secrets Management**: Use environment variables for sensitive data
2. **Path Restrictions**: Limit workspace and output paths
3. **Plugin Security**: Only use trusted plugins
4. **Access Control**: Restrict API access appropriately

### Performance

1. **Appropriate Exclusions**: Exclude unnecessary files and directories
2. **Language Filtering**: Only analyze relevant languages
3. **Parallel Processing**: Enable parallel analysis for large projects
4. **Caching**: Use caching for repeated analyses

### Maintainability

1. **Clear Naming**: Use descriptive names for custom rules and configs
2. **Regular Updates**: Keep rulesets and plugins updated
3. **Validation**: Regularly validate configuration files
4. **Monitoring**: Track configuration changes and their impact

## Troubleshooting

### Common Issues

1. **Configuration Not Found**
   ```bash
   # Check search paths
   aqt config show --paths
   
   # Specify explicit path
   aqt --config /path/to/config.json analyze
   ```

2. **Invalid Configuration**
   ```bash
   # Validate configuration
   aqt config validate --verbose
   
   # Reset to defaults
   aqt config reset
   ```

3. **Environment Variable Conflicts**
   ```bash
   # Show resolved configuration
   aqt config show --resolved
   
   # Show environment variables
   env | grep AQT_
   ```

4. **Plugin Issues**
   ```bash
   # List loaded plugins
   aqt plugins list
   
   # Validate plugin configuration
   aqt plugins validate
   ```

### Debug Configuration Resolution

Enable debug logging to trace configuration resolution:

```bash
AQT_LOG_LEVEL=debug aqt analyze --verbose
```

This will show:
- Configuration file search paths
- Loaded configuration sources
- Environment variable overrides
- Final resolved configuration

## Related Documentation

- [CLI Interface](CLI.md)
- [HTTP API Interface](API.md)
- [MCP Interface](MCP.md)
- [Orchestration Interface](ORCHESTRATION.md)
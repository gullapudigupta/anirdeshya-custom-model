# HTTP API Interface

## Overview

The Advanced Quality Tool HTTP API provides RESTful endpoints for integrating AQT functionality into web applications, services, and third-party tools. The API supports comprehensive workspace analysis, issue management, fix application, and reporting capabilities.

## Base Information

**Implementation**: `src/integrations/http-api-server.js`  
**Base URL**: `http://localhost:3000` (configurable)  
**API Version**: `v1`  
**Content Type**: `application/json`

## Authentication

The API supports multiple authentication methods:

### Bearer Token Authentication

```http
Authorization: Bearer <token>
```

### API Key Authentication

```http
X-API-Key: <api-key>
```

### Configuration

```json
{
  "auth": {
    "type": "token",
    "token": "your-secret-token"
  }
}
```

## Rate Limiting

Default rate limits (configurable):
- **Window**: 15 minutes
- **Requests**: 100 per window per IP
- **Headers**: `X-RateLimit-Remaining`, `X-RateLimit-Reset`

## Standard Response Format

### Success Response

```json
{
  "success": true,
  "data": { /* response data */ },
  "timestamp": "2023-12-01T10:30:00Z"
}
```

### Error Response

```json
{
  "error": "Error type",
  "message": "Human readable error message",
  "details": { /* additional error context */ },
  "timestamp": "2023-12-01T10:30:00Z"
}
```

## Core Endpoints

### Health and Status

#### `GET /health`

System health check endpoint.

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2023-12-01T10:30:00Z",
  "version": "1.0.0"
}
```

#### `GET /api/info`

API information and available endpoints.

**Response**:
```json
{
  "name": "Advanced Quality Tool API",
  "version": "1.0.0",
  "endpoints": [
    "GET /health",
    "POST /api/analyze",
    "POST /api/fix"
  ]
}
```

### Code Analysis

#### `POST /api/analyze`

Performs comprehensive code quality analysis on a workspace.

**Request Body**:
```json
{
  "workspacePath": "/path/to/project",
  "files": ["src/main.js", "src/utils.js"],
  "options": {
    "includeMetrics": true,
    "includeSecurity": true,
    "includePerformance": true,
    "languages": ["javascript", "typescript"],
    "excludePatterns": ["**/*.test.js", "dist/**"],
    "severity": "warning"
  }
}
```

**Parameters**:
- `workspacePath` (string, required): Path to the workspace directory
- `files` (array, optional): Specific files to analyze (analyzes all if not provided)
- `options` (object, optional): Analysis configuration options

**Response**:
```json
{
  "success": true,
  "data": {
    "analysisId": "analysis-001",
    "timestamp": "2023-12-01T10:30:00Z",
    "workspace": "/path/to/project",
    "summary": {
      "filesAnalyzed": 42,
      "issuesFound": 15,
      "qualityScore": 0.82,
      "categories": {
        "errors": 3,
        "warnings": 8,
        "info": 4
      }
    },
    "issues": [
      {
        "id": "ISSUE-001",
        "severity": "error",
        "category": "security",
        "rule": "no-eval",
        "message": "Use of eval() is dangerous",
        "file": "src/utils.js",
        "line": 42,
        "column": 15,
        "context": {
          "beforeLines": ["function process(input) {", "  // Validate input"],
          "currentLine": "  return eval(input);",
          "afterLines": ["}"]
        },
        "fixable": true,
        "confidence": 0.95,
        "metadata": {
          "cwe": "CWE-94",
          "impact": "high"
        }
      }
    ],
    "metrics": {
      "complexity": {
        "average": 2.3,
        "max": 8.5,
        "files": {
          "src/utils.js": 4.2,
          "src/main.js": 1.8
        }
      },
      "maintainability": 0.82,
      "testCoverage": 0.67,
      "duplication": 0.05
    },
    "performance": {
      "analysisTime": 12.5,
      "filesPerSecond": 3.36
    }
  },
  "timestamp": "2023-12-01T10:30:00Z"
}
```

**Status Codes**:
- `200`: Analysis completed successfully
- `400`: Invalid request parameters
- `404`: Workspace not found
- `500`: Analysis failed

#### `GET /api/analyze/{analysisId}`

Retrieve analysis results by ID.

**Response**: Same format as POST `/api/analyze`

### Issue Management

#### `POST /api/fix`

Apply a fix to a specific code issue.

**Request Body**:
```json
{
  "workspacePath": "/path/to/project",
  "issueId": "ISSUE-001",
  "fixType": "auto",
  "options": {
    "dryRun": false,
    "backup": true,
    "verification": true,
    "confidence": 0.8
  }
}
```

**Parameters**:
- `workspacePath` (string, required): Path to the workspace
- `issueId` (string, required): Unique identifier of the issue to fix
- `fixType` (string, optional): Type of fix ('auto', 'ai', 'manual') - default: 'auto'
- `options` (object, optional): Fix application options

**Response**:
```json
{
  "success": true,
  "data": {
    "fixId": "fix-001",
    "issueId": "ISSUE-001",
    "appliedAt": "2023-12-01T10:35:00Z",
    "fixType": "auto",
    "status": "applied",
    "changes": {
      "filesModified": 1,
      "linesChanged": 3,
      "files": [
        {
          "file": "src/utils.js",
          "changes": [
            {
              "line": 42,
              "before": "  return eval(input);",
              "after": "  return JSON.parse(input);"
            }
          ]
        }
      ]
    },
    "verification": {
      "passed": true,
      "tests": {
        "syntax": "passed",
        "linting": "passed", 
        "compilation": "passed"
      }
    },
    "backup": {
      "enabled": true,
      "path": ".aqt-backup/2023-12-01-10-35-00"
    }
  }
}
```

**Status Codes**:
- `200`: Fix applied successfully
- `400`: Invalid request parameters
- `404`: Issue not found
- `409`: Fix conflicts with existing changes
- `500`: Fix application failed

#### `POST /api/generate-fixes`

Generate fix suggestions for multiple issues.

**Request Body**:
```json
{
  "workspacePath": "/path/to/project",
  "issues": ["ISSUE-001", "ISSUE-002"],
  "options": {
    "maxFixes": 50,
    "priority": "high",
    "includeAI": true,
    "includeRules": true,
    "confidence": 0.7
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "generationId": "gen-001",
    "timestamp": "2023-12-01T10:40:00Z",
    "fixes": [
      {
        "fixId": "fix-001",
        "issueId": "ISSUE-001",
        "type": "auto",
        "confidence": 0.95,
        "description": "Replace eval() with safer JSON.parse()",
        "changes": [
          {
            "file": "src/utils.js",
            "line": 42,
            "before": "return eval(input);",
            "after": "return JSON.parse(input);"
          }
        ],
        "metadata": {
          "ruleName": "no-eval-replacement",
          "category": "security"
        }
      }
    ],
    "summary": {
      "totalIssues": 2,
      "fixesGenerated": 1,
      "avgConfidence": 0.85,
      "categories": {
        "auto": 1,
        "ai": 0,
        "manual": 0
      }
    }
  }
}
```

### Reports

#### `GET /api/reports`

List available quality reports.

**Query Parameters**:
- `limit` (number): Maximum number of reports (default: 10)
- `offset` (number): Offset for pagination (default: 0)
- `type` (string): Filter by report type
- `since` (string): ISO date string to filter reports since date

**Response**:
```json
{
  "success": true,
  "data": {
    "reports": [
      {
        "id": "report-001",
        "type": "analysis",
        "timestamp": "2023-12-01T10:30:00Z",
        "workspace": "/path/to/project",
        "summary": {
          "qualityScore": 0.82,
          "issuesFound": 15
        }
      }
    ],
    "pagination": {
      "total": 45,
      "limit": 10,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

#### `GET /api/reports/{id}`

Retrieve a specific report by ID.

**Query Parameters**:
- `format` (string): Response format ('json', 'html', 'markdown') - default: 'json'

**Response** (JSON format):
```json
{
  "success": true,
  "data": {
    "id": "report-001",
    "type": "analysis",
    "timestamp": "2023-12-01T10:30:00Z",
    "workspace": "/path/to/project",
    "content": {
      /* Full report data matching analyze response format */
    }
  }
}
```

**Response** (HTML format):
```html
<!DOCTYPE html>
<html>
<head>
  <title>Quality Analysis Report</title>
  <style>/* Report styling */</style>
</head>
<body>
  <!-- Rich HTML report content -->
</body>
</html>
```

### Workspace Management

#### `POST /api/workspace/config`

Update workspace configuration.

**Request Body**:
```json
{
  "workspacePath": "/path/to/project",
  "config": {
    "analysis": {
      "includeMetrics": true,
      "languages": ["javascript", "typescript"],
      "excludePatterns": ["**/*.test.js"]
    },
    "fixes": {
      "autoApply": false,
      "confidence": 0.8,
      "backup": true
    }
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "configPath": "/path/to/project/.aqt-config.json",
    "updatedAt": "2023-12-01T10:45:00Z",
    "config": {
      /* Updated configuration */
    }
  }
}
```

#### `GET /api/workspace/status`

Get workspace status and configuration.

**Query Parameters**:
- `workspacePath` (string, required): Path to workspace

**Response**:
```json
{
  "success": true,
  "data": {
    "workspace": "/path/to/project",
    "status": "ready",
    "config": {
      /* Current configuration */
    },
    "stats": {
      "totalFiles": 156,
      "analyzableFiles": 89,
      "lastAnalysis": "2023-12-01T09:15:00Z",
      "issueCount": 12
    },
    "capabilities": {
      "languages": ["javascript", "typescript", "python"],
      "analyzers": ["security", "performance", "complexity"],
      "fixers": ["auto", "ai"]
    }
  }
}
```

### File Operations

#### `GET /api/files`

List files in a workspace.

**Query Parameters**:
- `workspacePath` (string, required): Path to workspace
- `pattern` (string): Glob pattern to filter files
- `recursive` (boolean): Include subdirectories (default: true)

**Response**:
```json
{
  "success": true,
  "data": {
    "files": [
      {
        "path": "src/main.js",
        "size": 2048,
        "modified": "2023-12-01T09:15:00Z",
        "type": "javascript",
        "analyzable": true
      }
    ],
    "summary": {
      "totalFiles": 156,
      "analyzableFiles": 89,
      "totalSize": 1048576
    }
  }
}
```

#### `GET /api/files/*`

Get specific file content and metadata.

**Query Parameters**:
- `workspacePath` (string, required): Path to workspace
- `includeContent` (boolean): Include file content (default: false)
- `includeAnalysis` (boolean): Include analysis data (default: false)

**Response**:
```json
{
  "success": true,
  "data": {
    "path": "src/main.js",
    "size": 2048,
    "modified": "2023-12-01T09:15:00Z",
    "type": "javascript",
    "encoding": "utf8",
    "content": "// File content (if requested)",
    "analysis": {
      /* Analysis data (if requested) */
    }
  }
}
```

## Async Operations

### Long-Running Operations

For operations that may take significant time, the API supports asynchronous processing:

#### `POST /api/analyze` (Async Mode)

**Request**:
```json
{
  "workspacePath": "/path/to/large-project",
  "options": {
    "async": true,
    "callbackUrl": "https://your-app.com/webhooks/aqt"
  }
}
```

**Immediate Response**:
```json
{
  "success": true,
  "data": {
    "operationId": "op-001",
    "status": "pending",
    "estimatedDuration": 300,
    "statusUrl": "/api/operations/op-001"
  }
}
```

#### `GET /api/operations/{operationId}`

Check operation status:

**Response**:
```json
{
  "success": true,
  "data": {
    "operationId": "op-001",
    "status": "running",
    "progress": 0.65,
    "startedAt": "2023-12-01T10:30:00Z",
    "estimatedCompletion": "2023-12-01T10:35:00Z",
    "result": null
  }
}
```

When complete:
```json
{
  "success": true,
  "data": {
    "operationId": "op-001",
    "status": "completed",
    "progress": 1.0,
    "startedAt": "2023-12-01T10:30:00Z",
    "completedAt": "2023-12-01T10:34:30Z",
    "result": {
      /* Analysis result data */
    }
  }
}
```

## Webhooks

### Webhook Configuration

Configure webhooks to receive notifications:

**POST /api/webhooks**:
```json
{
  "url": "https://your-app.com/webhooks/aqt",
  "events": ["analysis.completed", "fix.applied"],
  "secret": "webhook-secret"
}
```

### Webhook Events

#### `analysis.completed`

```json
{
  "event": "analysis.completed",
  "timestamp": "2023-12-01T10:35:00Z",
  "data": {
    "analysisId": "analysis-001",
    "workspace": "/path/to/project",
    "summary": {
      "qualityScore": 0.82,
      "issuesFound": 15
    }
  }
}
```

#### `fix.applied`

```json
{
  "event": "fix.applied",
  "timestamp": "2023-12-01T10:40:00Z",
  "data": {
    "fixId": "fix-001",
    "issueId": "ISSUE-001",
    "status": "success"
  }
}
```

## Client Libraries

### JavaScript/Node.js

```javascript
const AQTClient = require('@aqt/api-client');

const client = new AQTClient({
  baseUrl: 'https://aqt-api.example.com',
  apiKey: 'your-api-key'
});

// Analyze workspace
const analysis = await client.analyze('/path/to/project', {
  includeMetrics: true,
  includeSecurity: true
});

// Apply fixes
for (const issue of analysis.issues) {
  if (issue.fixable && issue.confidence > 0.8) {
    await client.fix(issue.id, '/path/to/project');
  }
}
```

### Python

```python
from aqt_client import AQTClient

client = AQTClient(
    base_url='https://aqt-api.example.com',
    api_key='your-api-key'
)

# Analyze workspace
analysis = client.analyze('/path/to/project', 
                         include_metrics=True,
                         include_security=True)

# Generate report
report = client.generate_report(analysis['analysisId'], 
                               format='html')
```

### cURL Examples

```bash
# Analyze workspace
curl -X POST https://aqt-api.example.com/api/analyze \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "workspacePath": "/path/to/project",
    "options": {
      "includeMetrics": true
    }
  }'

# Get report
curl https://aqt-api.example.com/api/reports/report-001 \
  -H "Authorization: Bearer your-token" \
  -G -d "format=html"
```

## Error Handling

### Error Categories

- **ValidationError** (400): Invalid request parameters
- **AuthenticationError** (401): Missing or invalid authentication
- **AuthorizationError** (403): Insufficient permissions
- **NotFoundError** (404): Resource not found
- **ConflictError** (409): Resource conflict
- **RateLimitError** (429): Rate limit exceeded
- **ServerError** (500): Internal server error

### Retry Logic

Implement exponential backoff for transient errors:

```javascript
async function callAPI(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      
      if (response.status >= 500 || response.status === 429) {
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```

## Performance Considerations

### Caching

- Analysis results are cached based on file content hashes
- Cache headers indicate freshness and validation
- Use `If-None-Match` for conditional requests

### Pagination

Large result sets support pagination:

```http
GET /api/reports?limit=50&offset=100
```

Response includes pagination metadata:
```json
{
  "data": { /* results */ },
  "pagination": {
    "total": 1000,
    "limit": 50,
    "offset": 100,
    "hasMore": true,
    "nextUrl": "/api/reports?limit=50&offset=150"
  }
}
```

### Compression

Enable gzip compression for responses:
```http
Accept-Encoding: gzip, deflate
```

## Security

### HTTPS

Always use HTTPS in production:
- TLS 1.2 or higher
- Valid SSL certificates
- HSTS headers

### CORS

Configure CORS for browser-based clients:
```json
{
  "cors": {
    "origin": ["https://your-app.com"],
    "methods": ["GET", "POST"],
    "credentials": true
  }
}
```

### Input Validation

- All inputs are validated against schemas
- Path traversal protection
- File size limits
- Request timeout limits

## Related Documentation

- [CLI Interface](CLI.md)
- [MCP Interface](MCP.md)
- [Orchestration Interface](ORCHESTRATION.md)
- [Shared Configuration Guide](SHARED-CONFIG.md)
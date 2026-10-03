# API Documentation

## Overview

The Advanced Quality Tool provides comprehensive API interfaces for programmatic access to all functionality. These APIs enable integration with custom tools, dashboards, automation systems, and third-party services.

## Available APIs

### [AI Generator API](AI_GENERATOR_API.md)
AI-powered issue resolution and code generation API.

**Endpoint Base**: `/api/v1/ai`

**Key Features**:
- AI-powered issue classification and resolution
- Code generation with context awareness
- Multi-model support with fallback strategies
- Cost control and budget management

**Primary Use Cases**:
- AI-assisted code review and fixes
- Automated code quality improvement
- Intelligent code generation
- Research and learning systems

### REST API (Coming Soon)
General-purpose REST API for all AQT functionality.

**Endpoint Base**: `/api/v1`

**Planned Features**:
- Workspace analysis and management
- Issue tracking and resolution
- Report generation and export
- Configuration management
- Real-time monitoring and alerts

## Quick Start

### Base URL

```
http://localhost:3000/api/v1
```

### Authentication

```bash
# API Key Authentication
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/v1/ai/analyze

# Bearer Token Authentication  
curl -H "Authorization: Bearer your-token" \
  http://localhost:3000/api/v1/ai/analyze
```

### Example: AI Issue Analysis

```bash
curl -X POST http://localhost:3000/api/v1/ai/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "workspacePath": "/path/to/project",
    "files": ["src/main.js", "src/utils.js"],
    "options": {
      "includeContext": true,
      "searchDocumentation": true,
      "modelPreference": "local-first"
    }
  }'
```

## API Architecture

### Request Flow

```
Client Request → API Gateway → Authentication → Routing → 
Handler → AQT Core Services → Response Formatter → Client Response
```

### Response Format

All API responses follow this structure:

```json
{
  "success": true,
  "data": { /* Response data */ },
  "metadata": {
    "requestId": "req_123456",
    "timestamp": "2026-10-01T12:00:00Z",
    "version": "1.0",
    "cost": {
      "tokens": 1500,
      "estimatedCost": 0.015
    }
  },
  "errors": null,
  "warnings": []
}
```

### Error Handling

```json
{
  "success": false,
  "data": null,
  "metadata": {
    "requestId": "req_123456",
    "timestamp": "2026-10-01T12:00:00Z"
  },
  "errors": [
    {
      "code": "AUTH_001",
      "message": "Invalid API key",
      "details": "The provided API key is invalid or expired"
    }
  ],
  "warnings": []
}
```

## Rate Limiting

API requests are rate-limited to ensure fair usage:

- **Free Tier**: 100 requests/hour
- **Standard Tier**: 1,000 requests/hour  
- **Enterprise Tier**: 10,000 requests/hour

Rate limit headers are included in all responses:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 3600
```

## WebSocket Support

Real-time updates are available via WebSocket connections:

```javascript
const ws = new WebSocket('ws://localhost:3000/api/v1/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Update:', data);
  
  // Handle different message types
  switch (data.type) {
    case 'analysis_progress':
      updateProgress(data.progress);
      break;
    case 'issue_detected':
      addIssue(data.issue);
      break;
    case 'fix_applied':
      updateFixStatus(data.fix);
      break;
  }
};
```

## SDKs and Client Libraries

### JavaScript/Node.js

```bash
npm install @advanced-quality-tool/api-client
```

```javascript
import { AQTClient } from '@advanced-quality-tool/api-client';

const client = new AQTClient({
  apiKey: 'your-api-key',
  baseURL: 'http://localhost:3000/api/v1'
});

// Analyze workspace
const analysis = await client.ai.analyze({
  workspacePath: './project',
  options: { includeSecurity: true }
});

// Apply AI fix
const fixResult = await client.ai.fixIssue({
  issueId: analysis.issues[0].id,
  workspacePath: './project'
});
```

### Python (Coming Soon)

```python
# pip install advanced-quality-tool
from aqt_client import AQTClient

client = AQTClient(api_key='your-api-key')
analysis = client.analyze_workspace('./project')
```

## Integration Examples

### CI/CD Pipeline Integration

```yaml
# GitHub Actions workflow
name: Code Quality Check
on: [push, pull_request]

jobs:
  quality-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run AQT Analysis
        run: |
          curl -X POST ${{ secrets.AQT_API_URL }}/api/v1/ai/analyze \
            -H "X-API-Key: ${{ secrets.AQT_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "workspacePath": ".",
              "options": {
                "includeSecurity": true,
                "failOnCritical": true
              }
            }' > analysis.json
          
          # Check for critical issues
          if jq '.data.issues[] | select(.severity == "CRITICAL")' analysis.json; then
            echo "Critical issues found!"
            exit 1
          fi
```

### Custom Dashboard Integration

```javascript
// React component for quality dashboard
import React, { useEffect, useState } from 'react';
import { AQTClient } from '@advanced-quality-tool/api-client';

function QualityDashboard({ projectId }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = new AQTClient({
      apiKey: process.env.REACT_APP_AQT_API_KEY
    });

    async function fetchAnalysis() {
      const result = await client.ai.analyze({
        workspacePath: `/projects/${projectId}`,
        options: {
          includeMetrics: true,
          includeTrends: true
        }
      });
      setAnalysis(result.data);
      setLoading(false);
    }

    fetchAnalysis();
  }, [projectId]);

  if (loading) return <div>Loading analysis...</div>;

  return (
    <div className="dashboard">
      <h2>Code Quality Analysis</h2>
      <IssueSummary issues={analysis.issues} />
      <QualityMetrics metrics={analysis.metrics} />
      <TrendChart trends={analysis.trends} />
    </div>
  );
}
```

## Security Considerations

### API Key Management

1. **Store securely**: Use environment variables or secret management systems
2. **Rotate regularly**: Implement key rotation policies
3. **Scope appropriately**: Use different keys for different environments
4. **Monitor usage**: Track API key usage for security auditing

### Data Privacy

- Source code is processed locally when using local AI models
- Cloud processing requires explicit user consent
- Sensitive data is redacted from logs and responses
- Compliance with data protection regulations

## Related Documentation

- [Interface Documentation](../interfaces/) - Overview of all interfaces
- [CLI Quick Start](../guides/CLI-QUICK-START.md) - Command-line interface guide
- [AI Features](../guides/AI_ISSUE_GENERATOR.md) - AI functionality overview
- [Project Documentation](../project/) - Project architecture and design

## Support and Troubleshooting

### Common Status Codes

- `200 OK`: Request successful
- `400 Bad Request`: Invalid request parameters
- `401 Unauthorized`: Missing or invalid authentication
- `403 Forbidden`: Insufficient permissions
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server-side error

### Debugging

```bash
# Enable verbose logging
curl -v -X POST http://localhost:3000/api/v1/ai/analyze \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"workspacePath": "./"}'

# Check API status
curl http://localhost:3000/api/v1/status
```

### Getting Help

1. Check the [AI Generator API](AI_GENERATOR_API.md) for specific endpoint documentation
2. Review error messages and status codes
3. Enable debug logging for detailed information
4. Contact support with request IDs for specific issues

---

*API Version: 1.0*  
*Base URL: /api/v1*  
*Authentication: API Key, Bearer Token*  
*Rate Limits: Tier-based*  
*WebSocket Support: Yes*  
*Last Updated: 2026-10-01*
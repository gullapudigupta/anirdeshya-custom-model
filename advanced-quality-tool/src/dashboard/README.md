# Dashboard Module

## Overview

The `src/dashboard` module provides dashboard integration capabilities for visualizing quality metrics and scan results over time.

## Contents

| File | Description |
|------|-------------|
| `dashboard-integration.js` | Main dashboard integration component |

## Key Components

### DashboardIntegration

Records and aggregates quality metrics for dashboard display:

```javascript
const { DashboardIntegration } = require('./dashboard/dashboard-integration');

const dashboard = new DashboardIntegration({
  storagePath: '.aqt-reports/dashboards',
  retentionDays: 30
});

// Initialize storage
await dashboard.initializeStorage();

// Record scan results
await dashboard.recordScan(analysisResults, {
  branch: 'main',
  commit: 'abc123',
  timestamp: Date.now()
});

// Get aggregated metrics
const metrics = dashboard.aggregateMetrics(results);
```

## Features

### Scan Recording

Records each scan with metadata:

```javascript
await dashboard.recordScan(results, {
  branch: 'feature/my-feature',
  commit: 'def456',
  author: 'developer',
  ci: 'github-actions'
});
```

### Metric Aggregation

Aggregates metrics across multiple scans:

```javascript
const metrics = dashboard.aggregateMetrics(results);
// Returns:
// {
//   totalIssues: number,
//   bySeverity: { error: n, warning: n, info: n },
//   byCategory: { ... },
//   trends: { ... }
// }
```

### Historical Data

Tracks quality metrics over time:

- Issue counts by type and severity
- Trend analysis
- Comparison with baselines

## Configuration

```javascript
{
  storagePath: string,     // Path to store dashboard data
  retentionDays: number,   // Days to retain historical data
  compressOld: boolean     // Compress data older than threshold
}
```

## Dependencies

- File system for storage
- No external dependencies

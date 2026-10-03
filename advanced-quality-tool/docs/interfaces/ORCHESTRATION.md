# Orchestration Interface

## Overview

The Orchestration interface enables seamless integration between the Advanced Quality Tool and various orchestration platforms, workflow engines, and CI/CD systems. This interface provides standardized mechanisms for automated quality assurance workflows, distributed analysis, and collaborative development processes.

## Architecture

```
Orchestration Platform ←→ Orchestration Adapter ←→ AQT Core Services
     ↕                           ↕                         ↕
Workflow Engine         Message Queue/Events        Analysis Pipeline
```

## Core Components

**File**: `src/integrations/orchestration-adapter.js`

The orchestration adapter serves as the primary interface between external orchestration systems and AQT's internal services.

### Supported Platforms

#### GitHub Actions
Integration with GitHub's native CI/CD platform.

**Configuration**:
```yaml
name: AQT Quality Check
on: [push, pull_request]
jobs:
  quality-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: advanced-quality-tool/github-action@v1
        with:
          workspace-path: "."
          analysis-config: ".aqt-config.json"
          report-format: "github-checks"
```

#### Jenkins Pipeline
Support for Jenkins declarative and scripted pipelines.

**Jenkinsfile Example**:
```groovy
pipeline {
    agent any
    stages {
        stage('Quality Analysis') {
            steps {
                script {
                    def aqtResult = sh(
                        script: "aqt analyze --workspace . --format json",
                        returnStdout: true
                    )
                    def report = readJSON text: aqtResult
                    publishQualityReport(report)
                }
            }
        }
    }
}
```

#### GitLab CI/CD
Native integration with GitLab's CI/CD pipelines.

**.gitlab-ci.yml Example**:
```yaml
quality_check:
  stage: test
  image: node:18
  script:
    - npm install -g @aqt/cli
    - aqt analyze --workspace $CI_PROJECT_DIR
    - aqt report --format gitlab-mr
  artifacts:
    reports:
      quality: aqt-quality-report.json
```

#### Azure DevOps
Integration with Azure Pipelines and DevOps services.

**azure-pipelines.yml**:
```yaml
stages:
- stage: QualityAnalysis
  jobs:
  - job: RunAQT
    steps:
    - task: NodeTool@0
      inputs:
        versionSpec: '18.x'
    - script: |
        npm install -g @aqt/cli
        aqt analyze --workspace $(Build.SourcesDirectory)
      displayName: 'Run Quality Analysis'
```

## Event-Driven Integration

### Event Types

The orchestration adapter supports various event types for triggering analyses:

#### Code Events
- `code.pushed`: New code committed to repository
- `code.merged`: Pull request merged
- `code.tagged`: Version tag created
- `code.branch_created`: New branch created

#### Workflow Events
- `workflow.started`: CI/CD pipeline initiated
- `workflow.completed`: Pipeline finished
- `workflow.failed`: Pipeline encountered error
- `workflow.cancelled`: Pipeline manually cancelled

#### Quality Events
- `quality.analysis_requested`: Manual analysis trigger
- `quality.threshold_violated`: Quality metrics below threshold
- `quality.regression_detected`: Quality degradation identified
- `quality.improvement_achieved`: Quality metrics improved

### Event Payloads

**Standard Event Format**:
```json
{
  "eventType": "code.pushed",
  "timestamp": "2023-12-01T10:30:00Z",
  "source": "github",
  "repository": {
    "name": "example/project",
    "url": "https://github.com/example/project",
    "branch": "main",
    "commit": "abc123def456"
  },
  "trigger": {
    "user": "developer@example.com",
    "automated": false
  },
  "context": {
    "pullRequest": 123,
    "reviewers": ["reviewer1@example.com"]
  }
}
```

## Workflow Definitions

### Quality Gate Workflow

**File**: `workflows/quality-gate.yml`
```yaml
name: Quality Gate
version: "1.0"

triggers:
  - event: code.pushed
    branches: [main, develop, "release/*"]
  - event: code.pull_request
    actions: [opened, synchronize]

steps:
  - name: Workspace Setup
    action: orchestration.setup_workspace
    inputs:
      checkout_depth: 1
      install_dependencies: true

  - name: Quality Analysis
    action: aqt.analyze_workspace
    inputs:
      workspace_path: ${{ workspace.path }}
      config_file: ".aqt-config.json"
      include_metrics: true
      include_security: true

  - name: Quality Gate Check
    action: orchestration.quality_gate
    inputs:
      report: ${{ steps.analysis.outputs.report }}
      thresholds:
        quality_score: 0.8
        security_issues: 0
        critical_issues: 0

  - name: Generate Report
    action: aqt.generate_report
    inputs:
      format: ["html", "markdown", "json"]
      output_path: "reports/"

  - name: Publish Results
    action: orchestration.publish_results
    inputs:
      reports: ${{ steps.report.outputs.files }}
      notify_reviewers: true
      post_comment: true
```

### Automated Fix Workflow

**File**: `workflows/auto-fix.yml`
```yaml
name: Automated Fix Application
version: "1.0"

triggers:
  - event: quality.analysis_completed
    conditions:
      - fixable_issues > 0
      - auto_fix_enabled: true

steps:
  - name: Generate Fixes
    action: aqt.generate_fixes
    inputs:
      issues: ${{ trigger.analysis.issues }}
      confidence_threshold: 0.9
      fix_types: ["rule-based", "ai-assisted"]

  - name: Apply Fixes
    action: aqt.apply_fixes
    inputs:
      fixes: ${{ steps.generate.outputs.fixes }}
      create_backup: true
      verify_changes: true

  - name: Create Pull Request
    action: orchestration.create_pr
    inputs:
      title: "🔧 Automated quality fixes"
      body: ${{ steps.apply.outputs.summary }}
      branch: "auto-fix/${{ trigger.commit }}"
      reviewers: ${{ trigger.repository.reviewers }}
```

## API Integration Points

### Webhook Endpoints

The orchestration adapter exposes webhook endpoints for real-time integration:

#### `/webhooks/github`
Handles GitHub webhook events (push, PR, review, etc.)

**Configuration**:
```bash
curl -X POST https://api.github.com/repos/owner/repo/hooks \
  -H "Authorization: token $GITHUB_TOKEN" \
  -d '{
    "name": "web",
    "active": true,
    "events": ["push", "pull_request", "pull_request_review"],
    "config": {
      "url": "https://your-aqt-instance.com/webhooks/github",
      "content_type": "json",
      "secret": "your-webhook-secret"
    }
  }'
```

#### `/webhooks/gitlab`
Processes GitLab webhook notifications

#### `/webhooks/generic`
Generic webhook endpoint for custom integrations

### REST API Endpoints

#### Workflow Management

**GET /api/workflows**
Lists all available workflows

**POST /api/workflows/{id}/trigger**
Manually triggers a workflow execution

**GET /api/workflows/{id}/status**
Returns current workflow execution status

#### Execution Monitoring

**GET /api/executions**
Lists recent workflow executions

**GET /api/executions/{id}**
Gets detailed execution information

**POST /api/executions/{id}/cancel**
Cancels a running execution

## Message Queue Integration

### Supported Message Brokers

#### Redis
```javascript
const config = {
  type: 'redis',
  connection: {
    host: 'localhost',
    port: 6379,
    password: 'secret'
  },
  queues: {
    'analysis': { priority: 'high' },
    'fixes': { priority: 'medium' },
    'reports': { priority: 'low' }
  }
};
```

#### RabbitMQ
```javascript
const config = {
  type: 'rabbitmq',
  connection: {
    hostname: 'localhost',
    port: 5672,
    username: 'guest',
    password: 'guest'
  },
  exchanges: {
    'aqt.events': { type: 'topic' },
    'aqt.tasks': { type: 'direct' }
  }
};
```

#### Apache Kafka
```javascript
const config = {
  type: 'kafka',
  brokers: ['localhost:9092'],
  topics: {
    'aqt.analysis': { partitions: 3 },
    'aqt.fixes': { partitions: 2 },
    'aqt.notifications': { partitions: 1 }
  }
};
```

## Distributed Analysis

### Multi-Node Configuration

**Cluster Setup**:
```yaml
cluster:
  nodes:
    - id: "node-1"
      host: "aqt-node-1.internal"
      port: 8080
      capabilities: ["javascript", "typescript"]
      resources:
        cpu: 4
        memory: "8GB"
    
    - id: "node-2"
      host: "aqt-node-2.internal"
      port: 8080
      capabilities: ["python", "java"]
      resources:
        cpu: 8
        memory: "16GB"

  load_balancer:
    strategy: "capability_aware"
    health_check_interval: 30s
    max_concurrent_analyses: 5
```

### Work Distribution

**Analysis Partitioning**:
```javascript
const distributionStrategy = {
  partitionBy: 'language',
  balancing: 'least_loaded',
  fallback: 'round_robin',
  maxRetries: 3,
  timeout: 300000 // 5 minutes
};
```

## Configuration Management

### Orchestration Configuration

**File**: `config/orchestration.json`
```json
{
  "platforms": {
    "github": {
      "enabled": true,
      "app_id": "123456",
      "private_key_path": "/secrets/github-app.pem",
      "webhook_secret": "${GITHUB_WEBHOOK_SECRET}",
      "permissions": ["checks", "pull_requests", "contents"]
    },
    "jenkins": {
      "enabled": true,
      "url": "https://jenkins.example.com",
      "username": "${JENKINS_USER}",
      "api_token": "${JENKINS_TOKEN}",
      "job_template": "aqt-analysis-template"
    }
  },
  "workflows": {
    "default_timeout": 1800,
    "max_concurrent": 10,
    "retry_policy": {
      "max_attempts": 3,
      "backoff_multiplier": 2,
      "initial_delay": 5000
    }
  },
  "notifications": {
    "slack": {
      "webhook_url": "${SLACK_WEBHOOK_URL}",
      "channels": {
        "success": "#dev-success",
        "failure": "#dev-alerts",
        "quality_gate": "#quality-reports"
      }
    }
  }
}
```

## Security and Compliance

### Authentication Methods

#### OAuth 2.0 / OpenID Connect
```javascript
const authConfig = {
  provider: 'github',
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  scope: ['repo', 'user:email'],
  callbackUrl: 'https://aqt.example.com/auth/callback'
};
```

#### Service Account
```javascript
const serviceAccount = {
  type: 'service_account',
  keyFile: '/secrets/service-account.json',
  scopes: ['https://www.googleapis.com/auth/cloud-platform']
};
```

### Audit Logging

All orchestration activities are logged for compliance:

```json
{
  "timestamp": "2023-12-01T10:30:00Z",
  "event": "workflow.executed",
  "user": "system",
  "workflow_id": "quality-gate",
  "execution_id": "exec-123456",
  "repository": "example/project",
  "commit": "abc123",
  "duration": 120.5,
  "outcome": "success",
  "changes": {
    "files_analyzed": 42,
    "issues_found": 8,
    "fixes_applied": 3
  }
}
```

## Monitoring and Observability

### Metrics Collection

**Prometheus Metrics**:
```
# Workflow execution metrics
aqt_orchestration_workflow_duration_seconds{workflow="quality-gate"} 120.5
aqt_orchestration_workflow_success_total{platform="github"} 42
aqt_orchestration_workflow_failure_total{platform="github"} 2

# Queue metrics
aqt_orchestration_queue_depth{queue="analysis"} 5
aqt_orchestration_queue_processing_time_seconds{queue="analysis"} 45.2

# Integration metrics  
aqt_orchestration_webhook_requests_total{platform="github"} 150
aqt_orchestration_api_calls_total{platform="jenkins"} 75
```

### Health Checks

The orchestration adapter provides comprehensive health monitoring:

- **Platform Connectivity**: Checks connection to integrated platforms
- **Queue Health**: Monitors message queue performance
- **Workflow Status**: Tracks active and pending workflows
- **Resource Utilization**: Monitors CPU, memory, and network usage

### Distributed Tracing

Integration with distributed tracing systems:

```javascript
const tracing = {
  jaeger: {
    serviceName: 'aqt-orchestration',
    agentHost: 'jaeger-agent',
    agentPort: 6832
  },
  sampling: {
    type: 'probabilistic',
    param: 0.1 // 10% sampling rate
  }
};
```

## Troubleshooting

### Common Issues

1. **Webhook Delivery Failures**
   - Verify endpoint accessibility
   - Check webhook secret configuration
   - Review payload format compatibility

2. **Workflow Execution Timeouts**
   - Increase timeout values
   - Optimize analysis scope
   - Check resource availability

3. **Authentication Errors**
   - Validate credentials and permissions
   - Check token expiration
   - Verify OAuth flow configuration

### Debug Mode

Enable comprehensive logging:

```bash
AQT_ORCHESTRATION_DEBUG=true \
AQT_LOG_LEVEL=debug \
node src/integrations/orchestration-adapter.js
```

### Integration Testing

**Test Workflow Execution**:
```bash
# Trigger test workflow
curl -X POST http://localhost:8080/api/workflows/quality-gate/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "test/repo",
    "branch": "main", 
    "commit": "test123"
  }'

# Check execution status
curl http://localhost:8080/api/executions/latest
```

## Related Documentation

- [MCP Interface](MCP.md)
- [CLI Interface](CLI.md)
- [HTTP API Interface](API.md)
- [Shared Configuration Guide](SHARED-CONFIG.md)
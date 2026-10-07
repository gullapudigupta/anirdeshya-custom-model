# Advanced Code Quality Tool (AQT)

A comprehensive, AI-powered code quality analysis and auto-fix platform with multi-language support, autonomous agents, CI/CD integration, and enterprise-grade security.

## 🚀 What's New in Phase 11

- **🤖 AI Code Generation** - Generate code, tests, and docs from natural language
- **🔐 Security Hardened** - Path traversal fix, IP spoofing mitigation, security headers, rate limiting, CORS hardening — production clearance granted
- **🔍 Security Scanning** - Vulnerability, secret, and dependency scanning via `aqt security`
- **🤝 Agent System** - Autonomous code improvement workflows via `aqt agent`
- **⚡ Pipeline System** - 20+ pre-built orchestration workflows via `aqt pipeline`
- **📊 UI Enhancements** - Multi-issue selection, batch fixing, search, filters, security scan button
- **🔌 API & MCP** - Full REST API (30+ endpoints) and Model Context Protocol support
- **🧩 Plugin System** - Extensible plugin architecture via `aqt plugin`
- **📁 New CLI Commands** - `aqt analyze`, `aqt detect`, `aqt categorize`, `aqt config`, `aqt plugin`
- **📋 Export** - Export issues to JSON, CSV, Markdown, and SARIF formats

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [AI Features](#ai-features)
- [Agent System](#agent-system)
- [Pipeline System](#pipeline-system)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Architecture](#architecture)
- [Modules](#modules)
- [CLI Reference](#cli-reference)
- [API & Integrations](#api--integrations)
- [Configuration](#configuration)
- [Security](#security)
- [Documentation](#documentation)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

### 🎯 Core Capabilities

- **Multi-Linter Integration** - ESLint, Prettier, StyleLint, TypeScript-ESLint, Pylint, and more
- **AI-Powered Auto-Fix** - 3-tier strategy (Rule-based → Local AI → Cloud AI)
- **Multi-Language Support** - JavaScript, TypeScript, Python, C#, Go, PHP, Ruby, Rust
- **Autonomous Agent System** - Plan, execute, and verify code changes automatically
- **Pipeline Architecture** - 20+ orchestrated workflows for quality operations
- **AI Code Generation** - Generate code, tests, and documentation from descriptions

### 🤖 AI Features (New!)

| Feature | Description | CLI | API | MCP |
|---------|-------------|-----|-----|-----|
| **Code Generation** | Generate code from natural language | ✅ | ✅ | ✅ |
| **Test Generation** | Auto-generate comprehensive test suites | ✅ | ✅ | ✅ |
| **Documentation** | Generate docs from code | ✅ | ✅ | ✅ |
| **Issue Fixing** | AI-powered complex issue resolution | ✅ | ✅ | ✅ |
| **Refactoring** | Intelligent code refactoring | ✅ | ✅ | ✅ |
| **Cost Tracking** | Monitor and control AI costs | ✅ | ✅ | ✅ |
| **Safety Validation** | Security scanning of generated code | ✅ | ✅ | ✅ |

**Supported AI Providers:**
- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude 3 Opus, Sonnet, Haiku)
- Google (Gemini Pro, Ultra)
- Ollama (Local models - CodeLlama, Mistral, etc.)

[→ AI Generator Guide](docs/AI-GENERATOR-GUIDE.md)

### 🤝 Agent System (New!)

Autonomous workflows that plan, execute, and verify code changes:

- **Work Orchestration** - Queue and manage multiple work items
- **Intelligent Planning** - Auto-generate execution plans
- **Permission Control** - Granular operation permissions
- **Verification Loops** - Automatic verification and repair
- **Approval Workflows** - Human-in-the-loop for critical changes
- **Progress Tracking** - Real-time monitoring and logging

**Agent Capabilities:**
- Fix security vulnerabilities autonomously
- Implement features from specifications
- Refactor code with safety guarantees
- Generate and apply comprehensive fixes

[→ Agent User Guide](docs/guides/AGENT_GUIDE.md)

### ⚡ Pipeline System (New!)

Pre-built orchestration workflows for common tasks:

- **Workspace Quality** - Complete project analysis
- **AI Code Review** - AI-powered code reviews
- **Security Scan** - Comprehensive security checks
- **CI Quality Gate** - CI/CD integration
- **Auto-Fix** - Automated issue resolution
- **Documentation Generation** - Auto-generate docs
- **Watch & Fix** - Real-time fix application
- **Pipeline Replay** - Debug and re-run executions

**15+ Pipelines Available** - Each with configurable stages and replay capability

[→ Pipeline User Guide](docs/guides/PIPELINE_GUIDE.md)

### Analysis Features

| Category | Capabilities |
|----------|-------------|
| **Security** | Vulnerability scanning, secret detection, dependency CVE analysis, taint flow analysis |
| **Quality** | Code smell detection, anti-pattern recognition, duplicate code finder, accessibility checker |
| **Performance** | Performance anti-patterns, memory leak detection, I/O bottleneck identification |
| **Metrics** | Cyclomatic complexity, cognitive complexity, maintainability index, nesting depth |
| **Architecture** | Dependency graph analysis, architectural refactoring suggestions |

### Integrations

- **CI/CD Platforms** - GitHub Actions, GitLab CI, Jenkins, CircleCI, Travis CI, Azure Pipelines
- **Pull Request Integration** - GitHub, GitLab, Bitbucket
- **IDE Extensions** - VS Code extension with real-time diagnostics
- **MCP Server** - Model Context Protocol for AI tool integration
- **HTTP API** - RESTful API for remote access
- **WebSocket Server** - Real-time updates and notifications

### User Interfaces

- **CLI** - Full-featured command-line interface
- **Chat UI** - Interactive AI-powered chat interface with real-time updates
  - Issues Panel - Browse and manage code quality issues
  - Tasks Panel - Track and manage fix tasks
  - Pipeline Panel - Execute and monitor pipelines with real-time progress
  - Agent Panel - Monitor autonomous agents, view logs, and approve operations
  - AI Generation Panel - Generate code, tests, and documentation with AI
- **Web Dashboard** - Quality metrics visualization and trends
- **Custom Rule UI** - Create and test custom rules
- **Agent Activity View** - Monitor autonomous agent activities

**Chat UI Features:**
- Real-time WebSocket updates for pipelines and agents
- Interactive pipeline execution with step-by-step progress
- Agent monitoring with approval workflows
- AI code generation with cost tracking
- Issue browsing with fix previews
- **Multi-issue selection** with bulk fix (batch operations)
- **Search and filter** — search by message/file/rule, filter by severity/category
- **Security scan button** — run security scan directly from UI
- **Export** — download issues as JSON, CSV, Markdown, or SARIF
- **Metrics Dashboard** — complexity, maintainability, LOC per file
- **Settings dialog** — configure AI provider/model/budget; API keys are kept in memory only

### Local Usage Analytics

Usage analytics are opt-in and disabled by default. Enable or manage them with:

```bash
aqt analytics enable
aqt analytics report --days 30
aqt analytics disable
aqt analytics clear
```

When enabled, AQT stores only command names, success/failure totals, and elapsed
time in `.aqt/usage-metrics.json`. Nothing is uploaded; source code, prompts,
file paths, and credentials are not collected. See the [AI generator guide](docs/AI-GENERATOR.md)
and [API documentation](docs/API.md) for configuration and integration details.

## Project Structure

```
tools/advanced-quality-tool/
├── bin/                        # CLI binaries
├── docs/                       # Documentation
│   ├── FEASIBILITY.md          # Feasibility analysis
│   └── ISSUE_TAXONOMY.md       # Issue type catalog
├── examples/                   # Usage examples
├── scripts/                    # Build and utility scripts
├── src/
│   ├── agent/                  # Autonomous agent system
│   ├── ai/                     # AI engines (review, fix, remediation)
│   ├── ai-generator/           # AI orchestration pipeline
│   ├── commands/               # CLI command implementations
│   ├── core/                   # Core architecture & categorization
│   ├── dashboard/              # Dashboard integration
│   ├── extension/              # VS Code extension
│   ├── fixers/                 # Auto-fix engines
│   ├── integrations/           # External integrations
│   ├── languages/              # Language-specific analyzers
│   ├── metrics/                # Code metrics calculators
│   ├── monitor/                # CI/CD monitoring
│   ├── performance/            # Performance detectors
│   ├── pipelines/              # Workflow orchestration
│   ├── plugins/                # Plugin system
│   ├── quality/                # Quality detectors
│   ├── rules/                  # Custom rule engine
│   ├── security/               # Security scanners
│   ├── ui/                     # User interface components
│   ├── watcher/                # File watching
│   └── workspace/              # Workspace utilities
├── tasks/                      # Task tracking
├── tests/                      # Test suite
├── cli.js                      # CLI entry point
└── package.json
```

## Quick Start

### Installation

```bash
cd tools/advanced-quality-tool
npm install

# Global installation
npm install -g .
aqt --version
```

### Basic Usage

```bash
# Analyze project
aqt analyze

# Fix issues automatically
aqt fix --auto

# Watch mode
aqt watch --paths src/

# Launch interactive UI
aqt ui --port 3456
```

### AI Features

```bash
# Generate code
aqt ai generate code "Create a REST API endpoint for user authentication"

# Generate tests
aqt ai generate test src/auth.js

# Generate documentation
aqt ai generate doc src/utils.js

# Fix issues with AI
aqt ai fix <issue-id>

# Refactor code
aqt ai refactor src/app.js "Split into smaller modules"

# Configure AI provider
aqt ai config openai --model gpt-4

# Track costs
aqt ai cost
```

### Agent System

```bash
# Start autonomous agent work
aqt agent start "Fix all security vulnerabilities"

# Check status
aqt agent status <work-id>

# List all work items
aqt agent list

# View logs
aqt agent logs <work-id>

# Approve changes
aqt agent approve <work-id>
```

### Pipeline System

```bash
# List available pipelines
aqt pipeline list

# Run a pipeline
aqt pipeline run workspace-quality

# Check execution status
aqt pipeline status <execution-id>

# Replay execution
aqt pipeline replay <execution-id>
```

### Programmatic Usage

```javascript
const { AutoFixEngine } = require('./src/fixers');
const { VulnerabilityScanner } = require('./src/security');
const { PipelineExecutor } = require('./src/pipelines');

// Run security scan
const scanner = new VulnerabilityScanner();
const issues = await scanner.scanProject();

// Auto-fix issues
const engine = new AutoFixEngine();
const results = await engine.fixAll(issues);

// Execute pipeline
const executor = new PipelineExecutor();
const report = await executor.execute('ci-quality-gate', {
  failThreshold: 'error'
});
```

## Architecture

### 3-Tier Fix Strategy

```
┌─────────────────────────────────────┐
│     Tier 1: Rule-Based Fixer        │
│     • Pattern matching              │
│     • AST transformations           │ → 70% success rate
│     • Cost: $0                      │
└──────────────┬──────────────────────┘
               │ Falls through
┌──────────────▼──────────────────────┐
│     Tier 2: Local AI Model          │
│     • Ollama/LM Studio              │
│     • CodeLlama 7B / DeepSeek       │ → 25% success rate
│     • Cost: $0                      │
└──────────────┬──────────────────────┘
               │ Falls through
┌──────────────▼──────────────────────┐
│     Tier 3: Cloud AI                │
│     • OpenAI GPT-4 / Claude         │
│     • Cost: $0.0004-$0.011 per fix  │ → 5% success rate
└─────────────────────────────────────┘
```

### Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PipelineExecutor                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    PipelineRegistry                     │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │ Code Review │  │ Auto Fix    │  │ Security    │   │  │
│  │  │ Pipeline    │  │ Pipeline    │  │ Pipeline    │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │  ExecutionLedger      │                      │
│              │  (Audit & Replay)     │                      │
│              └───────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

### Agent Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     WorkOrchestrator                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                     AgentPlanner                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │ Scope       │  │ Tool        │  │ Permission  │   │  │
│  │  │ Analyzer    │  │ Registry    │  │ Manager     │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│              ┌───────────┴───────────┐                     │
│              ▼                       ▼                     │
│      ┌───────────────┐       ┌───────────────┐            │
│      │ CodeGenerator │       │ Verification  │            │
│      │               │       │ Repair Loop   │            │
│      └───────────────┘       └───────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## Modules

### AI Module (`src/ai`)

AI-powered capabilities for code analysis and fix generation.

| Component | Description |
|-----------|-------------|
| AICodeReviewAssistant | Automated code reviews with contextual suggestions |
| CompilerFixEngine | Auto-fix compiler errors using AI |
| ArchitecturalRefactoringEngine | Architecture analysis and refactoring suggestions |
| FixGenerationV2 | Fix generation with approval workflow |
| SecurityPerfRemediation | Security and performance issue remediation |

[→ Full Documentation](src/ai/README.md)

### Agent Module (`src/agent`)

Autonomous agent system for automated code changes.

| Component | Description |
|-----------|-------------|
| WorkOrchestrator | Queue and execute work items |
| AgentPlanner | Plan execution steps |
| PermissionManager | Control operation permissions |
| ToolRegistry | Register and execute tools |
| CodeGenerator | Generate code from specifications |
| VerificationRepairLoop | Verify and auto-repair |

[→ Full Documentation](src/agent/README.md)

### Pipelines Module (`src/pipelines`)

Workflow orchestration for quality operations.

[→ Full Documentation](src/pipelines/README.md)

### Security Module (`src/security`)

Security scanning and vulnerability detection.

| Scanner | Description |
|---------|-------------|
| VulnerabilityScanner | Detect code vulnerabilities |
| SecretScanner | Find hardcoded secrets |
| DependencyScanner | Check dependencies for CVEs |

[→ Full Documentation](src/security/README.md)

### Quality Module (`src/quality`)

Code quality detection and analysis.

| Detector | Description |
|----------|-------------|
| CodeSmellDetector | Detect code smells |
| AntiPatternDetector | Identify anti-patterns |
| AccessibilityChecker | WCAG compliance checks |
| DocQualityChecker | Documentation quality |
| DuplicateDetector | Find duplicated code |

[→ Full Documentation](src/quality/README.md)

### Languages Module (`src/languages`)

Multi-language analyzer support.

| Language | Analyzer |
|----------|----------|
| JavaScript/TypeScript | Built-in ESLint integration |
| Python | Pylint, Flake8, mypy |
| C# | Roslyn analyzers |
| Go | golint, staticcheck |
| PHP | PHPStan, Psalm |
| Ruby | RuboCop |
| Rust | clippy |

[→ Full Documentation](src/languages/README.md)

### Fixers Module (`src/fixers`)

Auto-fix engines and strategies.

| Fixer | Description |
|-------|-------------|
| RuleBasedFixer | Pattern-based fixes |
| AIFixer | AI-powered fix generation |
| CSharpPatternFixer | C#-specific patterns |

[→ Full Documentation](src/fixers/README.md)

### Integrations Module (`src/integrations`)

External tool and platform integrations.

| Integration | Description |
|-------------|-------------|
| MCPServer | Model Context Protocol server |
| HttpApiServer | RESTful API server |
| PRIntegrator | Pull request integration |
| LinterIntegration | External linter execution |
| NotificationSystem | Multi-channel notifications |

[→ Full Documentation](src/integrations/README.md)

### Extension Module (`src/extension`)

VS Code extension implementation.

[→ Full Documentation](src/extension/README.md)

### Commands Module (`src/commands`)

CLI command implementations.

| Command | Description |
|---------|-------------|
| fix | Auto-fix issues |
| monitor | CI/CD monitoring |
| watch | File watching |
| ui | Launch web UI |

[→ Full Documentation](src/commands/README.md)

## Pipelines

### Available Pipelines

| Pipeline | Description |
|----------|-------------|
| `ai-code-review` | AI-powered code review workflow |
| `ai-issue-resolution` | AI issue resolution workflow |
| `auto-fix` | Automatic fix application |
| `chat-interaction` | Chat-based interactions |
| `ci-quality-gate` | CI/CD quality gates |
| `cli-command` | CLI command execution |
| `dashboard-reporting` | Dashboard report generation |
| `documentation-generation` | Documentation generation |
| `issue-enrichment` | Issue enrichment workflow |
| `language-analysis` | Multi-language analysis |
| `pipeline-replay` | Pipeline replay capability |
| `quality-metrics` | Quality metrics collection |
| `security-scan` | Security scanning workflow |
| `vscode-diagnostics` | VS Code diagnostics |
| `watch-and-fix` | Watch and auto-fix |
| `workspace-quality` | Workspace quality analysis |

### Pipeline Usage

```javascript
const { PipelineExecutor } = require('./src/pipelines');

const executor = new PipelineExecutor();

// Execute single pipeline
const result = await executor.execute('security-scan', {
  paths: ['src/']
});

// Execute multiple pipelines
const results = await executor.executeAll([
  { id: 'security-scan', params: { paths: ['src/'] } },
  { id: 'quality-metrics', params: { files: ['**/*.js'] } }
]);
```

## CLI Reference

### Core Commands

```bash
# Analysis
aqt analyze [options]
  --files <patterns>    File patterns to analyze
  --format <type>       Output format (json, markdown, html)
  --output <file>       Output file path

# Auto-fix
aqt fix [options]
  --auto                Enable automatic fixing
  --dry-run             Preview fixes without applying
  --strategy <type>     Fix strategy (rule-based, ai, all)
  --max-issues <n>      Maximum issues to fix

# Watch mode
aqt watch [options]
  --paths <dirs>        Directories to watch
  --debounce <ms>       Debounce interval

# CI/CD monitor
aqt monitor [options]
  --fail-on <level>     Fail on severity level
  --report <file>       Output report file
  --format <type>       Report format (json, junit)

# Launch UI
aqt ui [options]
  --port <number>       Server port
  --no-open             Don't open browser

# Security scan
aqt security [options]
  --scan-type <type>    Scan type (vuln, secrets, deps, all)
  --severity <level>    Minimum severity to report
```

### AI Commands (New!)

```bash
# Generate code
aqt ai generate code <description> [options]
  --language <lang>     Programming language (default: javascript)
  --framework <name>    Framework to use
  --output <file>       Save to file
  --auto-apply          Automatically apply

# Generate tests
aqt ai generate test <file> [options]
  --framework <name>    Test framework (default: jest)
  --output <file>       Test file path

# Generate documentation
aqt ai generate doc <file> [options]
  --format <type>       Format (markdown, jsdoc, rst)
  --output <file>       Documentation file

# Fix issue with AI
aqt ai fix <issue-id> [options]
  --dry-run             Preview fix
  --auto-apply          Apply automatically

# Refactor code
aqt ai refactor <file> <description> [options]
  --auto-apply          Apply automatically

# Configure AI provider
aqt ai config [provider] [options]
  --model <name>        Model name
  --max-cost <amount>   Max cost per request

# Cost tracking
aqt ai cost [options]
  --period <time>       Period (day, week, month)
  --export <file>       Export report
```

### Agent Commands (New!)

```bash
# Start agent work
aqt agent start <description> [options]
  --type <type>         Agent type (autonomous, interactive, guided)
  --files <patterns>    Limit to specific files
  --priority <level>    Priority (low, medium, high, critical)
  --max-iterations <n>  Maximum iterations (default: 10)
  --auto-approve        Auto-approve safe operations
  --dry-run             Preview without executing

# Check status
aqt agent status <work-id>

# List work items
aqt agent list [options]
  --status <status>     Filter by status (running, paused, completed, failed)
  --verbose             Show details

# View logs
aqt agent logs <work-id> [options]
  --follow              Stream logs in real-time
  --level <level>       Filter by log level (info, warn, error)
  --limit <n>           Number of log entries (default: 50)

# Approve work
aqt agent approve <work-id> [options]
  --comment <text>      Approval comment

# Cancel work
aqt agent cancel <work-id> [options]
  --reason <text>       Cancellation reason

# Agent health
aqt agent health
```

**Agent Types:**
- **autonomous** - Fully autonomous operation with minimal human intervention
- **interactive** - Pauses for approval on each major step
- **guided** - User provides guidance at key decision points

**Agent Status Values:**
- `pending` - Work item queued
- `running` - Currently executing
- `paused` - Paused awaiting approval
- `completed` - Successfully finished
- `failed` - Execution failed

### Pipeline Commands (New!)

```bash
# List pipelines
aqt pipeline list [options]
  --category <cat>      Filter by category (security, quality, ai, ci)
  --verbose             Show descriptions and steps

# Get pipeline info
aqt pipeline info <pipeline-name>
  Shows: description, steps, parameters, timeout

# Run pipeline
aqt pipeline run <pipeline-name> [options]
  --param <key=value>   Pipeline parameters (can be repeated)
  --dry-run             Preview execution without applying changes
  --auto-approve        Auto-approve safe fixes

# Check execution status
aqt pipeline status <execution-id> [options]
  --watch               Watch progress in real-time
  --verbose             Show stage details

# View execution history
aqt pipeline history [options]
  --pipeline <name>     Filter by pipeline name
  --status <status>     Filter by status
  --limit <n>           Number of entries (default: 20)

# Replay execution
aqt pipeline replay <execution-id> [options]
  --param <key=value>   Modified parameters
  --stages <names>      Replay specific stages only (comma-separated)

# List executions
aqt pipeline executions [options]
  --pipeline <name>     Filter by pipeline
  --status <status>     Filter by status
  --since <date>        Since date
```

**Pipeline Categories:**

| Category | Pipelines |
|----------|-----------|
| **Security** | `security-scan`, `vulnerability-check`, `secret-detection` |
| **Quality** | `workspace-quality`, `quality-metrics`, `code-smell-detection` |
| **AI** | `ai-code-review`, `ai-issue-resolution`, `auto-fix` |
| **CI/CD** | `ci-quality-gate`, `pr-validation`, `release-check` |
| **Documentation** | `documentation-generation`, `api-docs` |
| **Utility** | `watch-and-fix`, `pipeline-replay` |

### New CLI Commands (Phase 11)

```bash
# Full workspace analysis with language detection, metrics, and reporting
aqt analyze [path] [options]
  --format <type>       Output format: json | markdown | table (default: table)
  --output <file>       Save report to file
  --languages <list>    Comma-separated languages to include
  --include-metrics     Include complexity/maintainability metrics
  --include-security    Include security scan results
  --severity <level>    Minimum severity: critical | high | medium | low
  --fix                 Auto-fix fixable issues after analysis
  --dry-run             Show what would be fixed

# Detect languages, frameworks, and linters in the workspace
aqt detect [path] [options]
  --format <type>       Output format: json | table (default: table)
  --verbose             Show detailed detection results

# Categorize and classify issues
aqt categorize [options]
  --issues <file>       Load issues from JSON file
  --by <field>          Group by: severity | category | file | rule
  --severity <level>    Filter by minimum severity
  --format <type>       Output format: json | table | markdown

# Manage configuration
aqt config [options]
  get <key>             Get a configuration value
  set <key> <value>     Set a configuration value
  list                  List all configuration values
  reset                 Reset to defaults
  --global              Use global config (~/.aqt/config.json)
  --file <path>         Custom config file path

# Plugin management
aqt plugin [options]
  list                  List installed plugins
  install <name>        Install a plugin
  uninstall <name>      Uninstall a plugin
  enable <name>         Enable a disabled plugin
  disable <name>        Disable an enabled plugin
  info <name>           Show plugin details
  search <query>        Search available plugins
  --registry <url>      Custom plugin registry URL
```

**Execution Status Values:**
- `pending` - Execution queued
- `running` - Currently executing
- `paused` - Paused at approval step
- `completed` - Successfully finished
- `failed` - Execution failed
- `cancelled` - User cancelled

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success, no issues |
| 1 | Issues found |
| 2 | Execution error |
| 3 | Configuration error |

## API & Integrations

### REST API

AQT provides a comprehensive REST API for remote access:

```bash
# Start API server
aqt api start --port 3000

# Or via Node.js
node src/integrations/http-api-server.js
```

**Available Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/analyze` | POST | Run analysis |
| `/api/fix` | POST | Apply fixes |
| `/api/ai/generate/code` | POST | Generate code |
| `/api/ai/generate/test` | POST | Generate tests |
| `/api/ai/generate/doc` | POST | Generate docs |
| `/api/ai/fix` | POST | AI-powered fix |
| `/api/ai/refactor` | POST | Refactor code |
| `/api/ai/configure` | POST | Configure AI |
| `/api/ai/cost` | GET | Get cost tracking |
| `/api/agent/start` | POST | Start agent work |
| `/api/agent/:id` | GET | Get agent status |
| `/api/agent` | GET | List agent work |
| `/api/pipelines` | GET | List pipelines |
| `/api/pipelines/:name/execute` | POST | Execute pipeline |
| `/api/pipelines/executions/:id` | GET | Get execution status |

**Authentication:**

```bash
# Set API token
export AQT_API_TOKEN="your-token"

# Make authenticated request
curl -H "Authorization: Bearer $AQT_API_TOKEN" \
  http://localhost:3000/api/analyze
```

**Example API Usage:**

```bash
# Generate code
curl -X POST http://localhost:3000/api/ai/generate/code \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Create a function to validate email addresses",
    "language": "javascript"
  }'

# Start agent work
curl -X POST http://localhost:3000/api/agent/start \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Fix all security vulnerabilities",
    "priority": "high"
  }'
```

[→ Full API Documentation](docs/API.md)

### Model Context Protocol (MCP)

AQT implements MCP for integration with AI assistants like Claude Desktop:

```bash
# Start MCP server
node src/integrations/mcp-server.js
```

**Configuration (Claude Desktop):**

```json
{
  "mcpServers": {
    "aqt": {
      "command": "node",
      "args": ["/path/to/aqt/src/integrations/mcp-server.js"],
      "env": {
        "AQT_PROJECT_ROOT": "/path/to/your/project",
        "OPENAI_API_KEY": "your-key"
      }
    }
  }
}
```

**Available MCP Tools:**

| Tool | Description |
|------|-------------|
| `aqt_analyze` | Run code analysis |
| `aqt_fix` | Apply fixes |
| `aqt_review` | AI code review |
| `aqt_ai_generate_code` | Generate code |
| `aqt_ai_generate_test` | Generate tests |
| `aqt_ai_generate_doc` | Generate docs |
| `aqt_ai_fix_issue` | Fix issue with AI |
| `aqt_ai_refactor` | Refactor code |
| `aqt_agent_start` | Start agent work |
| `aqt_pipeline_execute` | Execute pipeline |

[→ MCP Integration Guide](docs/MCP.md)

### WebSocket Support

Real-time updates via WebSocket:

```javascript
const ws = new WebSocket('ws://localhost:3000/api/stream');

ws.on('message', (data) => {
  const event = JSON.parse(data);
  console.log(event.type, event.data);
});
```

### CI/CD Integration

Supported platforms:
- GitHub Actions
- GitLab CI
- Jenkins
- CircleCI
- Travis CI
- Azure DevOps

**Example (GitHub Actions):**

```yaml
- name: Code Quality Check
  run: |
    npm install -g advanced-quality-tool
    aqt analyze --fail-on error
    aqt security --fail-on high
```

## Security

### Built-in Security Features

#### Rate Limiting

Protects against abuse with sliding window algorithm:

```javascript
// Configurable per-user and global rate limits
{
  rateLimit: {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,                   // 100 requests per window
    standardHeaders: true
  },
  globalRateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 1000                   // 1000 requests total
  }
}
```

#### CORS Protection

Environment-based CORS configuration:

```bash
# Production: whitelist only
export AQT_CORS_ORIGINS="https://app.example.com,https://dashboard.example.com"

# Development: localhost allowed
# Automatically allows localhost:3000, localhost:3001, etc.
```

#### AI Safety Validation

All AI-generated code is validated:

- ✅ **Syntax validation** - Ensures code is syntactically correct
- ✅ **Security scanning** - Detects malicious patterns
- ✅ **Secret detection** - Finds hardcoded credentials
- ✅ **Pattern blocking** - Blocks dangerous code patterns
- ✅ **Prompt injection protection** - Prevents prompt manipulation
- ✅ **Audit logging** - Complete audit trail

**Blocked Patterns:**
- Remote code execution (`eval`, `Function()`)
- Command injection
- SQL injection
- Network exfiltration
- Crypto mining
- Obfuscated code

**Example Validation:**

```bash
# All AI operations automatically validated
aqt ai generate code "..."

# Output shows validation results:
# ✅ Syntax: PASSED
# ✅ Security: PASSED
# ✅ Secrets: NONE FOUND
# ⚠️  Warning: Uses file system APIs
```

#### Authentication

```bash
# Token-based authentication
export AQT_API_TOKEN="your-secure-token"

# API key validation
aqt config set api.auth.type token
aqt config set api.auth.token "your-token"
```

#### Permission Management

Agent system includes granular permissions:

```javascript
{
  permissions: {
    allowedPaths: ['src/', 'lib/'],
    deniedPaths: ['config/prod/', 'secrets/'],
    allowNetwork: false,
    allowShell: false,
    autoApprove: ['lint', 'format']
  }
}
```

[→ Security Guide](docs/SECURITY.md)

## Configuration

### Configuration File (`.aqt.config.js`)

```javascript
module.exports = {
  // Project settings
  projectRoot: process.cwd(),
  
  // Analysis settings
  analysis: {
    exclude: ['node_modules', 'dist', 'coverage'],
    maxFileSize: 1024 * 1024,  // 1MB
    followSymlinks: false
  },
  
  // Linter settings
  linters: {
    eslint: { enabled: true, config: '.eslintrc.js' },
    prettier: { enabled: true, config: '.prettierrc' }
  },
  
  // Auto-fix settings
  autofix: {
    enabled: true,
    strategy: 'rule-based-then-ai',
    createBackups: true,
    maxIterations: 5
  },
  
  // AI settings
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    cacheDir: '.aqt-cache',
    enableCaching: true
  },
  
  // Security settings
  security: {
    vulnerabilityScan: true,
    secretScan: true,
    dependencyScan: true,
    failOnSeverity: 'high'
  },
  
  // Quality settings
  quality: {
    complexityThreshold: 25,
    accessibilityCheck: true,
    docQualityCheck: true
  },
  
  // Pipeline settings
  pipelines: {
    ledger: { enabled: true, path: '.aqt-reports/pipelines' }
  }
};
```

### VS Code Settings

```json
{
  "aqt.enabled": true,
  "aqt.lintOnSave": true,
  "aqt.maxIssuesPerFile": 100,
  "aqt.showStatusBar": true
}
```

## Development

### Scripts

```bash
# Run tests
npm test

# Run linter
npm run lint

# Build
npm run build

# Generate documentation
npm run docs
```

### Development Phases

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | ✅ Complete | Foundation, taxonomy, CLI |
| Phase 1 | ✅ Complete | Auto-fix, AI integration, UI |
| Phase 2 | ✅ Complete | VS Code extension, LSP |
| Phase 3 | ✅ Complete | Multi-language support |
| Phase 4 | ✅ Complete | Pipeline architecture |
| Phase 5 | ✅ Complete | Agent system |
| Phase 6 | ✅ Complete | Security scanners |
| Phase 7 | ✅ Complete | Quality detectors |
| Phase 8 | ✅ Complete | CLI completion |
| Phase 9 | ✅ Complete | Pipeline consolidation |
| Phase 10 | ✅ Complete | Documentation |

## Related Documentation

- [Feasibility Analysis](docs/FEASIBILITY.md)
- [Issue Taxonomy](docs/ISSUE_TAXONOMY.md)
- [Source Documentation](src/) - README files for each module

## Cost Analysis

**Per 1,000 developers:**
- Local AI (primary): $0/month
- Cloud fallback (5% usage): $19-$550/month
- **Average per developer: $0.02-$0.55/month**

Compare to:
- SonarQube Developer: $120/year
- DeepSource: $360/year
- Codacy: $180/year

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Run linter: `npm run lint`
6. Submit a pull request

## License

MIT

---

**Status:** Production Ready  
**Version:** 1.0.0  
**Last Updated:** October 2026


## Documentation

### 📚 User Guides

- **[AI Generator Guide](docs/AI-GENERATOR-GUIDE.md)** - Complete guide to AI-powered code generation
- **[Agent User Guide](docs/guides/AGENT_GUIDE.md)** - Autonomous agent system usage
- **[Pipeline User Guide](docs/guides/PIPELINE_GUIDE.md)** - Pipeline system and workflows
- **[Security Guide](docs/SECURITY.md)** - Security features and best practices
- **[API Documentation](docs/API.md)** - REST API reference
- **[MCP Integration](docs/MCP.md)** - Model Context Protocol setup

### 🔧 Module Documentation

- [Agent Module](src/agent/README.md) - Autonomous agent architecture
- [AI Generator](src/ai-generator/README.md) - AI orchestration internals
- [Pipelines](src/pipelines/README.md) - Pipeline architecture
- [Security](src/security/README.md) - Security scanners
- [Quality](src/quality/README.md) - Quality detectors
- [Commands](src/commands/README.md) - CLI commands
- [Integrations](src/integrations/README.md) - External integrations

### 📖 Reference Documentation

- [Feasibility Analysis](docs/FEASIBILITY.md) - Technical feasibility
- [Issue Taxonomy](docs/ISSUE_TAXONOMY.md) - Issue categorization
- [Architecture](docs/ARCHITECTURE.md) - System architecture

## Phase 11 Highlights

### What's New

✅ **AI Code Generation**
- Generate code, tests, and documentation from natural language
- Support for OpenAI, Anthropic, Google, and local models (Ollama)
- Cost tracking and budget management
- Multi-language support

✅ **Enterprise Security**
- Sliding window rate limiting (per-user + global)
- Environment-based CORS protection
- AI safety validation (syntax, security, secrets)
- Prompt injection protection
- Comprehensive audit logging

✅ **Complete API Access**
- 30+ REST API endpoints
- 12+ MCP tools for AI assistant integration
- WebSocket support for real-time updates
- Full authentication and authorization

✅ **Comprehensive Documentation**
- 150+ pages of user guides
- Step-by-step tutorials
- Best practices and troubleshooting
- API and MCP integration examples

### Phase 11 Statistics

- **New Commands:** 7 (ai generate code/test/doc, ai fix, ai refactor, ai config, ai cost)
- **New API Endpoints:** 7 (/api/ai/*)
- **New MCP Tools:** 7 (AI generation suite)
- **Security Features:** 4 (rate limiting, CORS, AI safety, audit logging)
- **Documentation Pages:** 150+
- **Code Safety Checks:** 10+ patterns detected
- **Supported AI Providers:** 4 (OpenAI, Anthropic, Google, Ollama)

## Cost Analysis

### AI Usage Costs

**Per 1,000 developers (monthly):**
- Local AI (Ollama - primary): **$0**
- Cloud AI fallback (5% usage): **$19-$550**
- **Average per developer: $0.02-$0.55/month**

**Comparison:**
- SonarQube Developer: **$120/year** ($10/month)
- DeepSource: **$360/year** ($30/month)
- Codacy: **$180/year** ($15/month)

**AQT Advantage:** 98% cost reduction with local-first AI strategy

### Cost Control Features

- ✅ Per-request cost limits
- ✅ Monthly budget enforcement
- ✅ Real-time cost tracking
- ✅ Provider fallback (cloud → local)
- ✅ Cost optimization recommendations

## Project Statistics

| Metric | Value |
|--------|-------|
| Total Lines of Code | 30,000+ |
| Modules | 50+ |
| CLI Commands | 40+ |
| API Endpoints | 30+ |
| MCP Tools | 12+ |
| Supported Languages | 8 |
| Available Pipelines | 20+ |
| Test Coverage | 80%+ |
| Documentation Pages | 200+ |

## Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
4. **Run tests**
   ```bash
   npm test
   npm run lint
   ```
5. **Commit with conventional commits**
   ```bash
   git commit -m "feat: add new feature"
   ```
6. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

### Contribution Guidelines

- Follow existing code style
- Add tests for new features
- Update documentation
- Keep PRs focused and small
- Write clear commit messages

### Development Setup

```bash
# Clone repository
git clone https://github.com/your-org/advanced-quality-tool
cd advanced-quality-tool

# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Build
npm run build
```

## Support

- **Issues:** [GitHub Issues](https://github.com/your-org/advanced-quality-tool/issues)
- **Discussions:** [GitHub Discussions](https://github.com/your-org/advanced-quality-tool/discussions)
- **Documentation:** [Full Docs](docs/)
- **Email:** support@example.com

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Acknowledgments

Built with modern tools and best practices:
- **AI Models:** OpenAI GPT-4, Anthropic Claude, Google Gemini, Ollama
- **Linters:** ESLint, Prettier, Pylint, RuboCop, and more
- **Testing:** Jest, Mocha
- **CI/CD:** GitHub Actions, GitLab CI, Jenkins
- **Monitoring:** Custom telemetry and analytics

---

**Status:** ✅ Production Ready  
**Version:** 1.0.0  
**Phase:** 11 Complete  
**Last Updated:** October 1, 2026

Made with ❤️ by the AQT Team

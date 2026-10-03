# Parikrama Code Analyzer

A comprehensive, zero-dependency code analysis tool inspired by **SonarQube Community Edition**, built specifically for Angular/TypeScript/SCSS/HTML projects.

## Features

### 🔍 Symbol Extraction & Querying
- Extract all symbols: classes, interfaces, enums, functions, methods, properties
- Angular-aware: identifies Components, Services, Pipes, Directives, Guards, Interceptors
- Fuzzy search with type filtering
- Dependency tracking (who imports what)
- Related file discovery (component → template → styles)

### 📊 Complexity Metrics
- **Cyclomatic Complexity** (McCabe) — decision point counting
- **Cognitive Complexity** (SonarQube-style) — human-readable complexity
- **Maintainability Index** (Microsoft formula)
- Method length analysis
- Lines of Code metrics (LOC, SLOC, comment ratio)

### 🐛 Code Smell Detection
- Long methods (>30 lines)
- Large classes (>300 lines)
- God classes (too many responsibilities)
- Long parameter lists (>5 params)
- Deep nesting
- Magic numbers
- Duplicate literals
- Console statements
- Empty catch blocks
- TODO/FIXME tracking with debt estimation

### 🔒 Security Hotspot Scanner
- Hardcoded secrets/API keys (CWE-798)
- XSS vulnerabilities (CWE-79)
- Unsafe eval/Function usage (CWE-95)
- Insecure HTTP (CWE-319)
- Open redirects (CWE-601)
- Sensitive data in localStorage (CWE-922)
- Security sanitizer bypasses
- Weak cryptography (CWE-327)

### 🅰️ Angular Pattern Analysis
- Change detection strategy usage
- Subscription memory leaks
- Missing OnDestroy
- Standalone vs Module patterns
- Empty lifecycle hooks
- Too many constructor dependencies
- Template complexity
- trackBy usage

### 🎨 CSS/SCSS Analysis
- Specificity scoring & violations
- !important usage tracking
- Color consistency (hardcoded vs variables)
- Z-index management
- Nesting depth
- Duplicate properties
- Vendor prefix detection
- Responsive breakpoint coverage

### 📝 HTML Template Analysis
- Accessibility (a11y) compliance
  - Image alt text
  - Button aria-labels
  - Keyboard accessibility
  - Heading hierarchy
  - Form input labels
  - Role attributes
- Performance patterns
  - trackBy in ngFor
  - Function calls in templates
  - Deep property chains
- Template size & binding count

### 🔗 Dependency Graph
- Import relationship mapping
- Circular dependency detection
- Coupling analysis (fan-in/fan-out)
- Layer violation detection
- Orphaned file detection
- Cross-feature coupling warnings

### ✅ Quality Gate
- Configurable pass/fail thresholds
- Default gate (strict) & Relaxed gate (adoption)
- Rating-based conditions (A-E)
- Metric-based conditions (numeric)
- CI/CD compatible exit codes

## Quick Start

```bash
# Full analysis
node tools/code-analyzer/cli.js analyze

# Quick scan (skip dependency graph)
node tools/code-analyzer/cli.js analyze --quick

# Search for a symbol
node tools/code-analyzer/cli.js query DeviceComponent

# List all components
node tools/code-analyzer/cli.js symbols --type=component

# Security scan only
node tools/code-analyzer/cli.js security

# Quality gate check
node tools/code-analyzer/cli.js gate

# Relaxed quality gate (for initial adoption)
node tools/code-analyzer/cli.js gate --relaxed
```

## Commands

| Command | Description |
|---------|-------------|
| `analyze` | Full analysis (all checks) |
| `analyze --quick` | Skip dependency graph |
| `symbols` | List all extracted symbols |
| `symbols --type=<type>` | Filter by type |
| `symbols --json` | Export to JSON |
| `query <name>` | Search symbols by name |
| `gate` | Quality gate check |
| `gate --relaxed` | Relaxed thresholds |
| `security` | Security scan |
| `complexity` | Complexity metrics |
| `angular` | Angular patterns |
| `css` | SCSS/CSS analysis |
| `templates` | Template analysis |
| `deps` | Dependency graph |
| `smells` | Code smells |
| `report` | Full JSON report |

## Architecture

```
tools/code-analyzer/
├── cli.js                          # Main CLI entry point
├── package.json                    # Package configuration
├── README.md                       # This file
├── reports/                        # Generated reports (gitignored)
│   ├── analysis-report.json
│   └── symbols.json
└── src/
    ├── ast-utils.js               # AST utilities & file helpers
    ├── symbol-extractor.js        # Core symbol extraction engine
    ├── query-engine.js            # Symbol querying & search
    ├── quality-gate.js            # Quality gate conditions
    ├── reporter.js                # Report formatting & output
    └── analyzers/
        ├── angular-patterns.js    # Angular-specific patterns
        ├── code-smells.js         # Code smell detection
        ├── complexity.js          # Complexity metrics
        ├── dependency-graph.js    # Dependency analysis
        ├── scss-analyzer.js       # CSS/SCSS analysis
        ├── security.js            # Security scanner
        └── template-analyzer.js   # HTML template analysis
```

## Quality Ratings

| Rating | Meaning |
|--------|---------|
| **A** | Excellent — No issues |
| **B** | Good — Minor issues only |
| **C** | Acceptable — Some major issues |
| **D** | Poor — Critical issues present |
| **E** | Failing — Blockers present |

## Technical Debt Estimation

Each code smell includes an effort estimate (in minutes) to fix. The total is aggregated into a human-readable format:
- `45m` — less than an hour
- `3h 20m` — hours and minutes
- `2d 4h` — days and hours

## Integration

### With existing CLI
```bash
node tools/custom_cli/cli.js        # → Tab 8 (AI Tools) includes analyzer commands
```

### With npm scripts (add to package.json)
```json
{
  "scripts": {
    "analyze": "node tools/code-analyzer/cli.js analyze",
    "analyze:quick": "node tools/code-analyzer/cli.js analyze --quick",
    "analyze:security": "node tools/code-analyzer/cli.js security",
    "analyze:gate": "node tools/code-analyzer/cli.js gate"
  }
}
```

### In CI/CD
The quality gate returns exit code 1 on failure, making it suitable for CI pipelines:
```yaml
- run: node tools/code-analyzer/cli.js gate
```

## Zero Dependencies

This tool requires **no additional npm packages**. It uses:
- Node.js built-in `fs` and `path` modules
- Regex-based parsing (no TypeScript compiler API needed)
- Fast file scanning
- Pattern matching for symbol extraction

## Comparison with SonarQube

| Feature | SonarQube CE | Parikrama Analyzer |
|---------|-------------|-------------------|
| Language support | 30+ | TS/JS/HTML/SCSS |
| Angular-aware | Limited | Full (decorators, patterns) |
| Zero-config | No | Yes |
| Offline | No | Yes |
| Quality Gate | ✅ | ✅ |
| Security Rules | ✅ | ✅ (focused) |
| Complexity | ✅ | ✅ |
| Code Smells | ✅ | ✅ |
| Symbol Query | ❌ | ✅ |
| CSS Analysis | Limited | Full (specificity, z-index) |
| Template Analysis | ❌ | ✅ (a11y, perf) |
| Dependency Graph | Limited | ✅ (circular, coupling) |
| Setup time | Hours | 0 seconds |

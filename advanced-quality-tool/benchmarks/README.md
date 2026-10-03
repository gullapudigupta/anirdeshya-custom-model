# Performance Benchmarks

Comprehensive performance benchmarking suite for Advanced Quality Tool.

## Quick Start

```bash
# Run all benchmarks
node benchmarks/performance-suite.js

# Or via npm
npm run benchmark
```

## What Gets Benchmarked

### 1. CLI Commands
- Help command execution
- Version check
- Command initialization
- Argument parsing

### 2. API Endpoints
- Health check response time
- API info endpoint
- Request/response cycle
- JSON serialization

### 3. Pipeline Execution
- Pipeline initialization
- Stage execution
- Result aggregation
- Ledger recording

### 4. AI Generation
- Issue classification speed
- Context analysis
- Prompt building
- Token estimation

### 5. Code Analysis
- File parsing
- Issue detection
- Pattern matching
- Report generation

## Configuration

### Environment Variables

```bash
# Number of iterations per benchmark (default: 10)
export BENCHMARK_ITERATIONS=20

# Number of warmup runs (default: 2)
export BENCHMARK_WARMUP=5

# Output directory (default: ./benchmarks/results)
export BENCHMARK_OUTPUT=./bench-results
```

### Programmatic Usage

```javascript
const { PerformanceBenchmark } = require('./benchmarks/performance-suite');

const benchmark = new PerformanceBenchmark({
  iterations: 20,
  warmupRuns: 5,
  outputDir: './results',
  timeout: 60000
});

const results = await benchmark.runAll();
console.log(results.summary);
```

## Output

### Generated Files

1. **benchmark-report.json** - Complete results in JSON
2. **benchmark-report.md** - Human-readable markdown report
3. **benchmark-report.csv** - CSV for spreadsheet analysis

### Report Structure

```json
{
  "timestamp": "2026-10-01T10:00:00.000Z",
  "system": {
    "platform": "win32",
    "arch": "x64",
    "cpus": 8,
    "memory": "16GB",
    "nodeVersion": "v18.0.0"
  },
  "summary": {
    "totalBenchmarks": 25,
    "fastest": { "category": "CLI", "name": "version", "time": 5.23 },
    "slowest": { "category": "Pipeline", "name": "workspace-quality", "time": 1250.45 }
  },
  "benchmarks": [...]
}
```

## Performance Targets

### Expected Performance

| Category | Target | Notes |
|----------|--------|-------|
| CLI Commands | < 100ms | Cold start |
| API Endpoints | < 50ms | Health check |
| Issue Classification | < 10ms | Per issue |
| Context Analysis | < 50ms | Per issue |
| Prompt Building | < 5ms | Per prompt |

### Performance Alerts

The benchmark suite will warn if:
- Any command exceeds 1000ms
- API response time > 200ms
- Classification > 50ms per issue
- Memory usage > 500MB

## Interpreting Results

### Mean vs Median

- **Mean**: Average time across all iterations
- **Median**: Middle value (less affected by outliers)

**Use median** for more stable performance indicators.

### Standard Deviation

- Low (< 10% of mean): Consistent performance
- Medium (10-25%): Some variability
- High (> 25%): Investigate outliers

## Regression Testing

Compare benchmarks over time:

```bash
# Run and save baseline
node benchmarks/performance-suite.js
cp benchmarks/results/benchmark-report.json benchmarks/baseline.json

# After changes, compare
node benchmarks/compare.js benchmarks/baseline.json benchmarks/results/benchmark-report.json
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run Performance Benchmarks
  run: npm run benchmark

- name: Upload Results
  uses: actions/upload-artifact@v2
  with:
    name: benchmark-results
    path: benchmarks/results/
```

### Performance Budget

Fail CI if performance regresses:

```bash
# Set performance budgets
export BENCHMARK_MAX_CLI=100
export BENCHMARK_MAX_API=200
export BENCHMARK_MAX_PIPELINE=5000

node benchmarks/performance-suite.js --enforce-budgets
```

## Troubleshooting

### Inconsistent Results

**Problem**: Wide variation in benchmark times

**Solutions**:
1. Increase iterations: `BENCHMARK_ITERATIONS=50`
2. Close other applications
3. Run with higher priority
4. Disable antivirus temporarily

### Slow Benchmarks

**Problem**: Benchmarks take too long

**Solutions**:
1. Reduce iterations: `BENCHMARK_ITERATIONS=5`
2. Skip slow categories
3. Use `--quick` mode

### Out of Memory

**Problem**: Node.js runs out of memory

**Solution**:
```bash
NODE_OPTIONS="--max-old-space-size=4096" node benchmarks/performance-suite.js
```

## Best Practices

1. **Run on dedicated hardware** - Minimize background processes
2. **Multiple runs** - Run 3-5 times and average
3. **Consistent environment** - Same OS, Node version, load
4. **Track trends** - Store historical results
5. **Set baselines** - Establish performance budgets

## Example Output

```
🏁 Starting Performance Benchmark Suite

Iterations: 10
Warmup runs: 2

📋 CLI Command Benchmarks
──────────────────────────────────────────────────
  help                 avg: 45.23ms | median: 43.12ms | min: 41.50ms | max: 52.30ms
  version              avg: 5.67ms | median: 5.45ms | min: 5.12ms | max: 6.89ms
  detect               avg: 78.45ms | median: 76.23ms | min: 72.10ms | max: 89.34ms

🌐 API Endpoint Benchmarks
──────────────────────────────────────────────────
  health               avg: 12.34ms | median: 11.89ms | min: 10.23ms | max: 15.67ms
  api-info             avg: 15.67ms | median: 15.12ms | min: 14.23ms | max: 18.90ms

✅ All benchmarks completed!
📊 Results saved to: benchmarks/results/benchmark-report.json
```

## License

MIT License - see LICENSE file for details

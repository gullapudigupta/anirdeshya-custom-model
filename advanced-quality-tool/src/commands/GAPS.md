# Commands Module - Gap Analysis

## Overview
Analysis of missing features and improvements needed in the Commands module.

---

## Critical Gaps

### 1. Missing `security` Command (HIGH PRIORITY)
**Status**: ❌ Not Implemented

**Issue**: The main README.md documents an `aqt security` command, but it's not implemented in this module.

**Expected Implementation**:
```bash
aqt security [options]
  --scan-type <type>    Scan type (vuln, secrets, deps, all)
  --severity <level>    Minimum severity to report
```

**Required File**: `security-command.js`

**Impact**: Users cannot run dedicated security scans via CLI

---

### 2. Missing `analyze` Command Implementation
**Status**: ⚠️ Referenced but Not Found

**Issue**: README references `analyze` command in standalone-cli.js but no dedicated `analyze-command.js` exists.

**Expected File**: `analyze-command.js`

**Workaround**: Functionality may be in standalone-cli.js directly

---

### 3. Missing `detect` Command Implementation
**Status**: ⚠️ No Dedicated Command

**Issue**: `aqt detect` is a documented feature but has no dedicated command file.

**Expected File**: `detect-command.js`

**Current State**: Likely in examples/detect-linters.js instead

---

## Medium Priority Gaps

### 4. Missing `categorize` Command
**Status**: ❌ Not Implemented

**Expected**: `categorize-command.js` for running categorization independently

**Use Case**: Users want to recategorize existing analysis results

---

### 5. Limited Test Coverage
**Status**: ⚠️ Partial

**Found**: `__tests__` directory exists

**Gap**: Unknown if all commands have comprehensive tests

**Recommendation**: Add tests for:
- Each command's error handling
- Option parsing
- Exit code scenarios
- Edge cases (empty files, missing paths, etc.)

---

### 6. No Pipeline Command
**Status**: ❌ Not Implemented

**Gap**: Despite 20+ pipelines existing, there's no CLI command to:
- List available pipelines
- Execute a specific pipeline
- View pipeline status
- Replay past pipeline executions

**Expected Implementation**:
```bash
aqt pipeline list
aqt pipeline run <name> [options]
aqt pipeline status <execution-id>
aqt pipeline replay <execution-id>
```

**Required File**: `pipeline-command.js`

---

### 7. No Config Command
**Status**: ❌ Not Implemented

**Gap**: No command to manage configuration:
- View current config
- Set config values
- Validate config
- Reset to defaults

**Expected Implementation**:
```bash
aqt config get <key>
aqt config set <key> <value>
aqt config list
aqt config validate
```

**Required File**: `config-command.js`

---

### 8. Missing Report Command
**Status**: ❌ Not Implemented

**Gap**: No dedicated command to generate reports from existing data

**Expected Implementation**:
```bash
aqt report [options]
  --input <file>      Input data file
  --format <type>     Output format (json, markdown, html, sarif)
  --output <file>     Output file
```

**Required File**: `report-command.js`

---

## Low Priority Gaps

### 9. No Interactive Mode
**Status**: ❌ Not Implemented

**Gap**: No interactive CLI mode for guided workflows

**Expected**: `interactive-command.js` or `--interactive` flag

**Features**:
- Guided setup wizard
- Interactive issue review
- Step-by-step fix application

---

### 10. No Plugin Command
**Status**: ❌ Not Implemented

**Gap**: No CLI management for plugins despite plugins module existing

**Expected Implementation**:
```bash
aqt plugin list
aqt plugin install <name>
aqt plugin remove <name>
aqt plugin info <name>
```

**Required File**: `plugin-command.js`

---

### 11. Missing Metrics Command
**Status**: ❌ Not Implemented

**Gap**: No dedicated command to view code metrics

**Expected Implementation**:
```bash
aqt metrics [options]
  --files <patterns>    Files to analyze
  --format <type>       Output format
  --threshold <value>   Complexity threshold
```

**Required File**: `metrics-command.js`

---

### 12. No Agent Command
**Status**: ❌ Not Implemented

**Gap**: Agent system exists but no CLI interface

**Expected Implementation**:
```bash
aqt agent start <task-description>
aqt agent status <work-id>
aqt agent list
aqt agent cancel <work-id>
```

**Required File**: `agent-command.js`

---

## Feature Enhancements

### 13. Limited Progress Indicators
**Gap**: Commands don't show progress for long-running operations

**Recommendation**:
- Add progress bars for file scanning
- Show spinner during AI operations
- Display estimated time remaining

---

### 14. No Dry-Run for All Commands
**Gap**: Only `fix` command has `--dry-run` option

**Recommendation**: Add `--dry-run` to:
- `watch-command.js`
- `monitor-command.js`
- Future `security-command.js`

---

### 15. Missing --json Flag
**Gap**: Not all commands support structured JSON output

**Recommendation**: Add `--json` flag to all commands for:
- CI/CD integration
- Programmatic parsing
- Tool chaining

---

### 16. No Global Options
**Gap**: No standard global options across commands

**Recommendation**: Add support for:
- `--verbose` - Detailed output
- `--quiet` - Minimal output
- `--config <file>` - Custom config file
- `--no-color` - Disable color output

---

### 17. Limited Error Messages
**Gap**: Error messages may not be user-friendly

**Recommendation**:
- Add detailed error explanations
- Suggest solutions for common errors
- Include relevant documentation links

---

## Documentation Gaps

### 18. Missing Usage Examples
**Gap**: README has basic examples but lacks advanced scenarios

**Recommendations**:
- Add multi-command workflows
- Show integration with CI/CD
- Document environment variable usage
- Add troubleshooting section

---

### 19. No Migration Guide
**Gap**: No guide for upgrading between versions

**Recommendation**: Add migration documentation for breaking changes

---

## Implementation Priority

### Immediate (Week 1)
1. ✅ Implement `security-command.js`
2. ✅ Add `analyze-command.js` 
3. ✅ Add `pipeline-command.js`

### Short Term (Weeks 2-3)
4. Add `config-command.js`
5. Add `report-command.js`
6. Add comprehensive tests
7. Add progress indicators

### Medium Term (Month 2)
8. Add `plugin-command.js`
9. Add `metrics-command.js`
10. Add `agent-command.js`
11. Add interactive mode

### Long Term (Month 3+)
12. Enhance error messages
13. Add global options support
14. Create advanced documentation

---

## Testing Recommendations

### Unit Tests Needed
- [ ] All command option parsing
- [ ] Error handling for missing files
- [ ] Exit code validation
- [ ] Output format validation

### Integration Tests Needed
- [ ] Full workflow tests
- [ ] CI/CD simulation
- [ ] Multi-command chains
- [ ] Error recovery scenarios

---

## Compatibility Considerations

### Cross-Platform Issues
- [ ] Verify path handling on Windows
- [ ] Test terminal color support
- [ ] Validate signal handling (SIGINT, SIGTERM)

### Node Version Support
- [ ] Document minimum Node.js version
- [ ] Test on LTS versions
- [ ] Handle deprecated APIs

---

**Last Updated**: October 1, 2026  
**Status**: Comprehensive Gap Analysis Complete  
**Priority Items**: 3 Critical, 8 Medium, 6 Low

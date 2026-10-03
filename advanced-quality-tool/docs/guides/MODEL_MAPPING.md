# Model Mapping and Selection Guide

<!--
@metadata
purpose: Document model equivalencies and selection criteria for task execution
scope: All phases and tasks in the advanced-quality-tool project
audience: Developers, AI agents, task planners
status: active
last-updated: 2026-10-01
-->

## Overview

This document provides a comprehensive mapping between recommended models in task specifications and their equivalents in the GLM/DeepSeek/GPT model families. Use this guide to select the appropriate model for each task based on complexity, security requirements, and cost considerations.

---

## Model Tier Classification

### 🔴 Tier 1: Highest Reasoning & Security (Critical Tasks)

| Primary Model | Equivalent | Use Case | Cost Profile |
|---------------|------------|----------|--------------|
| `o1-mini` | **`glm-5`** | Security-critical logic, complex reasoning, financial calculations, risk scoring | Higher cost, highest accuracy |
| `claude-opus-5` | `glm-5-plus` | Maximum safety requirements, privacy-critical operations | Highest cost, maximum safety |
| `gpt-4.1` | `glm-4-plus` | Foundational architecture, complex system design, escalation path | High cost, excellent reasoning |

**When to Use Tier 1:**
- Security-sensitive operations (authentication, authorization, secrets management)
- Financial calculations and budget enforcement
- Complex architectural decisions
- Multi-step reasoning with high stakes
- Tasks where errors have significant consequences

### 🟡 Tier 2: Balanced Reasoning (Moderate Complexity)

| Primary Model | Equivalent | Use Case | Cost Profile |
|---------------|------------|----------|--------------|
| `gpt-4o-mini` | `glm-4` | General-purpose implementation, dependency ordering, verification logic | Moderate cost, 7-7.5/10 reasoning |
| `deepseek-r1` | `deepseek-r1` | Reasoning-capable tasks, complex logic, cost-conscious | Lower cost, good reasoning |

**When to Use Tier 2:**
- Task planning and orchestration
- Dependency resolution
- Verification and validation logic
- Context assembly and token budget calculations
- Multi-file coordination
- Integration testing design

### 🟢 Tier 3: Cost-Optimized (Standard Implementation)

| Primary Model | Equivalent | Use Case | Cost Profile |
|---------------|------------|----------|--------------|
| `deepseek-v4-flash` | `deepseek-v4-flash` | Mechanical patterns, file operations, pipeline implementation | 94% cheaper than Haiku |
| `claude-haiku-4` | `glm-4-flash` | Simple transformations, well-documented patterns | Low cost, fast execution |
| `gpt-4o-mini` | `glm-4-flash` | Fallback for standard tasks | Moderate cost |

**When to Use Tier 3:**
- File operations (reading, writing, moving)
- Template-based generation
- Link validation
- Data aggregation and metrics
- UI state management
- Pipeline instrumentation (after design)
- Standard CRUD operations
- Well-documented API integrations

---

## Model Selection Decision Matrix

### By Task Priority

| Priority | Recommended Tier | Example Tasks |
|----------|------------------|---------------|
| CRITICAL | Tier 1 (`glm-5`, `glm-5-plus`) | Security scanning, execution permissions, tool registry |
| HIGH (complex) | Tier 1-2 (`glm-5`, `glm-4`) | Workspace resolution, context assembly, planning |
| HIGH (standard) | Tier 2-3 (`glm-4`, `deepseek-v4-flash`) | UI components, diff review, pipelines |
| MEDIUM | Tier 3 (`deepseek-v4-flash`, `glm-4-flash`) | Documentation, validation, reporting |

### By Task Type

| Task Type | Recommended Model | Rationale |
|-----------|-------------------|-----------|
| **Security/Credentials** | `glm-5` | 90% security accuracy, secret redaction |
| **Architecture/Design** | `glm-4-plus` or `glm-5` | Complex system interactions |
| **Planning/Orchestration** | `glm-4` or `deepseek-r1` | 7/10 reasoning, cost-effective |
| **File Operations** | `deepseek-v4-flash` | Mechanical, 94% cost savings |
| **UI/Frontend** | `deepseek-v4-flash` or `glm-4-flash` | Well-documented patterns |
| **Testing** | `glm-4` or `deepseek-v4-flash` | Contract verification, deterministic |
| **Documentation** | `deepseek-v4-flash` | Template-based, straightforward |
| **Pipelines** | `deepseek-v4-flash` | After architectural design complete |
| **Verification** | `glm-4` | Retry logic, failure recovery |
| **CI/CD Integration** | `glm-4` or `deepseek-r1` | Gate logic, threshold reasoning |

---

## Model Mapping by Task ID

### Phase 9 Task Model Recommendations

#### Critical Priority Tasks

| Task ID | Task Name | Original Model | Mapped Model | Tier |
|---------|-----------|----------------|--------------|------|
| P9-T009 | Provider and Model Selection | `o1-mini`, `gpt-4.1`, `claude-opus-5` | **`glm-5`**, `glm-4-plus`, `glm-5-plus` | 1 |
| P9-T014 | Execution Permissions | `o1-mini`, `gpt-4.1`, `claude-opus-5` | **`glm-5`**, `glm-4-plus`, `glm-5-plus` | 1 |
| P9-T018 | Provider Privacy & Cost Controls | `o1-mini`, `gpt-4.1`, `claude-opus-5` | **`glm-5`**, `glm-4-plus`, `glm-5-plus` | 1 |
| P9-T033 | Security Scanning Pipeline | `o1-mini`, `gpt-4.1`, `claude-opus-5` | **`glm-5`**, `glm-4-plus`, `glm-5-plus` | 1 |

#### High Priority Tasks (Complex Reasoning)

| Task ID | Task Name | Original Model | Mapped Model | Tier |
|---------|-----------|----------------|--------------|------|
| P9-T003 | Redundant Documentation Consolidation | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |
| P9-T007 | Workspace Linter Configuration | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |
| P9-T010 | Agent Planning & Orchestration | `gpt-4o-mini`, `o1-mini`, `gpt-4.1` | **`glm-4`**, `glm-5`, `glm-4-plus` | 2 |
| P9-T012 | Workspace Context Assembly | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |
| P9-T016 | Streaming Conversation | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |
| P9-T017 | Post-Edit Verification | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |
| P9-T019 | E2E Acceptance & Reliability | `gpt-4o-mini`, `o1-mini`, `gpt-4.1` | **`glm-4`**, `glm-5`, `glm-4-plus` | 2 |
| P9-T021 | Task Scope Analysis | `gpt-4o-mini`, `o1-mini`, `deepseek-r1` | **`glm-4`**, `glm-5`, `deepseek-r1` | 2 |
| P9-T022 | Task-Driven Code Generation | `gpt-4o-mini`, `o1-mini`, `deepseek-r1` | **`glm-4`**, `glm-5`, `deepseek-r1` | 2 |
| P9-T023 | Requirement Traceability | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |
| P9-T024 | Pipeline Catalog & Ledger | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |
| P9-T027 | Rule and AI Auto-Fix Pipeline | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |
| P9-T028 | AI Issue Resolution Pipeline | `gpt-4o-mini`, `o1-mini`, `deepseek-r1` | **`glm-4`**, `glm-5`, `deepseek-r1` | 2 |
| P9-T031 | CI Build Monitoring Pipeline | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |
| P9-T032 | Multi-Language Analyzer Pipeline | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |
| P9-T039 | Pipeline Replay & Contract Testing | `gpt-4o-mini`, `gpt-4.1`, `deepseek-r1` | **`glm-4`**, `glm-4-plus`, `deepseek-r1` | 2 |

#### High Priority Tasks (Standard Implementation)

| Task ID | Task Name | Original Model | Mapped Model | Tier |
|---------|-----------|----------------|--------------|------|
| P9-T006 | Documentation Validation | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T011 | Agent Assignment UI | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T015 | Diff Review & Rollback | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T020 | Documentation Link Ingestion | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T025 | Workspace Quality Analysis Pipeline | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T026 | Issue Categorization Pipeline | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T029 | AI Code Review Pipeline | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T030 | Continuous Watch Pipeline | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T034 | Quality Metrics Pipeline | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T035 | VS Code Diagnostics Pipeline | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T036 | Chat UI & WebSocket Pipeline | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T037 | CLI Command Pipelines | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |

#### Medium Priority Tasks

| Task ID | Task Name | Original Model | Mapped Model | Tier |
|---------|-----------|----------------|--------------|------|
| P9-T038 | Dashboard Reporting Pipeline | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |
| P9-T040 | Documentation Generation Pipeline | `deepseek-v4-flash`, `gpt-4o-mini`, `claude-haiku-4` | **`deepseek-v4-flash`**, `glm-4`, `glm-4-flash` | 3 |

---

## Cost Optimization Strategy

### Recommended Execution Order

1. **Start with Tier 1 tasks** (security-critical, foundational)
   - Use `glm-5` for maximum accuracy
   - These tasks block many downstream tasks

2. **Proceed with Tier 2 tasks** (complex reasoning)
   - Use `glm-4` for balanced cost/quality
   - Parallelize where dependencies allow

3. **Batch Tier 3 tasks** (standard implementation)
   - Use `deepseek-v4-flash` for 94% cost savings
   - Group similar pipeline implementations

### Estimated Cost Savings

Using the tiered model selection strategy:
- **Tier 1 tasks** (~6 tasks): Higher cost but critical accuracy
- **Tier 2 tasks** (~16 tasks): Balanced cost with good reasoning
- **Tier 3 tasks** (~15 tasks): 70-94% cost savings vs. using higher-tier models

**Overall savings**: Approximately 60-70% reduction in model costs compared to using highest-tier models for all tasks.

---

## Model Capability Comparison

| Capability | glm-5 | glm-4-plus | glm-4 | deepseek-r1 | deepseek-v4-flash |
|------------|-------|------------|-------|-------------|-------------------|
| **Security Reasoning** | 90% | 85% | 75% | 70% | 60% |
| **Complex Logic** | 9/10 | 8.5/10 | 7.5/10 | 7/10 | 5/10 |
| **Code Generation** | 9/10 | 8/10 | 8/10 | 7.5/10 | 6/10 |
| **Planning** | 9/10 | 8/10 | 7/10 | 7/10 | 5/10 |
| **File Operations** | 8/10 | 7/10 | 7/10 | 6/10 | 9/10 |
| **Speed** | 6/10 | 7/10 | 8/10 | 7/10 | 10/10 |
| **Cost Efficiency** | 4/10 | 5/10 | 7/10 | 8/10 | 10/10 |

---

## Escalation Rules

### When to Escalate to Higher Tier

1. **From Tier 3 to Tier 2**:
   - Unexpected complexity in implementation
   - Ambiguous requirements discovered
   - Integration issues requiring reasoning
   - Edge cases not covered by documentation

2. **From Tier 2 to Tier 1**:
   - Security vulnerabilities detected
   - Financial/privacy implications discovered
   - Architectural decisions with lasting impact
   - Complex failure recovery logic needed

### Escalation Process

```
Tier 3 (deepseek-v4-flash)
    ↓ if complexity > expected
Tier 2 (glm-4 or deepseek-r1)
    ↓ if security/financial stakes detected
Tier 1 (glm-5 or glm-4-plus)
```

---

## Provider Configuration

### Environment Variables

```bash
# GLM Models (Zhipu AI)
GLM_API_KEY=your_glm_api_key
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/

# DeepSeek Models
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
```

### Model Configuration in Task Files

```json
{
  "recommendedModel": ["glm-5", "glm-4-plus"],
  "modelRationale": "Security-critical logic requiring highest accuracy. glm-5 provides 90% security accuracy."
}
```

---

## Quick Reference Card

| Task Characteristic | Recommended Model |
|---------------------|-------------------|
| 🔐 Security/Secrets | `glm-5` |
| 💰 Financial/Budget | `glm-5` |
| 🏗️ Architecture | `glm-4-plus` or `glm-5` |
| 📋 Planning/Dependencies | `glm-4` or `deepseek-r1` |
| ✅ Verification/Testing | `glm-4` |
| 📄 File Operations | `deepseek-v4-flash` |
| 🎨 UI Components | `deepseek-v4-flash` |
| 📊 Metrics/Reporting | `deepseek-v4-flash` |
| 🔄 Pipelines | `deepseek-v4-flash` |
| 📚 Documentation | `deepseek-v4-flash` |

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-10-01 | 1.0 | Initial model mapping document with GLM 5 equivalence |

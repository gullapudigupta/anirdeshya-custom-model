# Documentation Metadata Standard (P9-T002)

## Overview

This document defines the metadata summary block standard for all documentation in the Advanced Quality Tool repository. Consistent metadata helps users quickly understand document purpose, status, and relevance.

## Metadata Block Format

All maintained documentation files should include the following metadata block at the top of the file, immediately after the main heading:

```markdown
<!-- METADATA
Purpose: [Brief description of document purpose]
Scope: [What topics/issues the document covers]
Audience: [Intended readers/users]
Status: [ACTIVE | COMPLETED | DEPRECATED | HISTORICAL]
Created: YYYY-MM-DD
Last Updated: YYYY-MM-DD
Owner: [Team/Individual responsible]
Phase: [Associated development phase, e.g., phase6]
Task: [Related task ID, e.g., P9-T002]
Dependencies: [Related documents or requirements]
-->

```

## Field Definitions

### Purpose (Required)
A concise statement explaining why the document exists and what problem it addresses.

**Examples:**
- `Provide installation and basic usage instructions for the CLI`
- `Document the architecture of the AI issue generator system`
- `Define coding standards and conventions for the project`

### Scope (Required)
Defines the boundaries of what the document covers and what it excludes.

**Examples:**
- `Covers CLI installation, basic commands, and common workflows`
- `Includes architecture overview, component interactions, and error handling`
- `Limited to JavaScript/TypeScript code standards; excludes CSS/HTML conventions`

### Audience (Required)
Identifies the intended readers/users of the document.

**Examples:**
- `Developers integrating the tool into their workflow`
- `Contributors extending or modifying the codebase`
- `Project maintainers and technical leads`

### Status (Required)
Indicates the current state and maintenance level of the document.

**Values:**
- `ACTIVE`: Actively maintained and relevant
- `COMPLETED`: Complete but no longer actively updated (moved to docs/completed/)
- `DEPRECATED`: Superseded by newer documentation
- `HISTORICAL`: Archived for historical reference only

### Created (Required)
The original creation date of the document in ISO format (YYYY-MM-DD).

### Last Updated (Required)
The date of the most recent substantive update in ISO format (YYYY-MM-DD).

### Owner (Optional)
Team or individual responsible for maintaining the document.

**Examples:**
- `Core Development Team`
- `Documentation Working Group`
- `@username`

### Phase (Optional)
Associated development phase for phase-specific documentation.

**Examples:**
- `phase6`
- `phase8`
- `phase9`

### Task (Optional)
Related task ID from the project task tracking system.

**Examples:**
- `P9-T002`
- `P8-T006`
- `ST-004`

### Dependencies (Optional)
References to related documents, requirements, or external resources.

**Examples:**
- `See docs/project/ISSUE_TAXONOMY.md for issue type definitions`
- `Requires Node.js 18+ and npm 9+`
- `Complements API.md and CLI.md interface documentation`

## Examples

### Example 1: Feature Documentation
```markdown
# AI Issue Generator (Phase 6)

<!-- METADATA
Purpose: Document the architecture and usage of the AI-powered issue resolution system
Scope: Covers pipeline design, component interactions, configuration, and CLI usage
Audience: Developers integrating AI features, maintainers extending the system
Status: ACTIVE
Created: 2026-09-15
Last Updated: 2026-09-30
Owner: AI Features Team
Phase: phase6
Task: P6-T012
Dependencies: See docs/project/AI_ISSUE_GENERATOR_DESIGN.md for implementation details
-->
```

### Example 2: API Documentation
```markdown
# CLI Interface

<!-- METADATA
Purpose: Provide comprehensive reference for the Advanced Quality Tool CLI
Scope: Covers all commands, options, configuration, and integration patterns
Audience: CLI users, script authors, CI/CD pipeline developers
Status: ACTIVE
Created: 2026-09-20
Last Updated: 2026-09-30
Owner: Interfaces Team
Phase: phase8
Task: P8-T004
Dependencies: See docs/interfaces/ for other interface documentation
-->
```

### Example 3: Quick Start Guide
```markdown
# CLI Quick Start Guide

<!-- METADATA
Purpose: Provide quick installation and basic usage instructions
Scope: Installation, basic commands, common workflows; excludes advanced features
Audience: New users evaluating or starting with the tool
Status: ACTIVE
Created: 2026-09-25
Last Updated: 2026-09-30
Owner: Documentation Team
Phase: phase8
Task: ST-004
Dependencies: See docs/interfaces/CLI.md for complete CLI reference
-->
```

## Implementation Guidelines

### Placement
The metadata block should be placed immediately after the main document heading (the first `#` heading), before any other content.

### Formatting
- Use HTML-style comments (`<!-- -->`) to prevent rendering in markdown viewers
- Each field on its own line for readability
- Maintain consistent field order as shown above
- Use clear, concise values

### Maintenance
1. Update `Last Updated` whenever making substantive changes
2. Change `Status` when document lifecycle changes
3. Update `Owner` when responsibility transfers
4. Update `Phase` and `Task` when associated work changes

### Validation
Documentation should be validated against this standard during:
- Code reviews for documentation changes
- Documentation inventory processes
- Publication workflows

## Tools and Automation

Metadata blocks can be:
- Generated automatically from document analysis
- Validated with scripts checking for required fields
- Extracted for documentation catalogs and indexes

## Related Documents

- [Documentation Inventory Process](docs/guides/AI_ISSUE_GENERATOR.md)
- [Documentation Structure Guidelines](docs/README.md)
- [Interface Documentation Standards](docs/interfaces/README.md)

---

**Standard Version**: 1.0  
**Established**: 2026-10-01  
**Task Reference**: P9-T002  
**Next Review**: 2026-12-01
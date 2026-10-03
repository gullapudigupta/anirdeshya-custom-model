# Security Module

## Overview

The `src/security` module provides security scanners for detecting vulnerabilities, secrets, and dependency issues in code.

## Contents

| File | Description |
|------|-------------|
| `vulnerability-scanner.js` | Scans code for known vulnerabilities |
| `secret-scanner.js` | Detects hardcoded secrets and credentials |
| `dependency-scanner.js` | Checks dependencies for known CVEs |

## Key Components

### VulnerabilityScanner

Scans code for security vulnerabilities:

```javascript
const { VulnerabilityScanner } = require('./security/vulnerability-scanner');

const scanner = new VulnerabilityScanner({
  projectRoot: process.cwd()
});

const issues = await scanner.scanFile('src/api.js');
```

**Detected Vulnerabilities:**

| Category | Patterns |
|----------|----------|
| Injection | SQL injection, command injection, XSS |
| Authentication | Weak passwords, session issues |
| Cryptography | Weak algorithms, hardcoded keys |
| Data Exposure | Sensitive data in logs, responses |
| Security Misconfiguration | CORS, headers, debug modes |

### SecretScanner

Detects hardcoded secrets:

```javascript
const { SecretScanner } = require('./security/secret-scanner');

const scanner = new SecretScanner({
  projectRoot: process.cwd()
});

const secrets = await scanner.scanFile('src/config.js');
```

**Detected Secret Types:**

| Type | Pattern |
|------|---------|
| API Keys | AWS, GCP, Azure, GitHub, etc. |
| Tokens | JWT, OAuth, Bearer tokens |
| Passwords | Hardcoded passwords in code |
| Private Keys | RSA, SSH, PGP keys |
| Connection Strings | Database URLs with credentials |

### DependencyScanner

Scans dependencies for CVEs:

```javascript
const { DependencyScanner } = require('./security/dependency-scanner');

const scanner = new DependencyScanner({
  projectRoot: process.cwd()
});

const issues = await scanner.scanProject();
```

**Supported Package Managers:**

- npm/yarn (package.json)
- pip (requirements.txt)
- Maven (pom.xml)
- Gradle (build.gradle)
- NuGet (packages.config)

## Usage Examples

### Full Security Scan

```javascript
const vulnScanner = new VulnerabilityScanner();
const secretScanner = new SecretScanner();
const depScanner = new DependencyScanner();

// Scan files
const files = glob.sync('src/**/*.{js,ts}');
const issues = [];

for (const file of files) {
  issues.push(...await vulnScanner.scanFile(file));
  issues.push(...await secretScanner.scanFile(file));
}

// Scan dependencies
issues.push(...await depScanner.scanProject());
```

### Vulnerability Categories

```javascript
const scanner = new VulnerabilityScanner();
const issues = await scanner.scanFile('src/api.js');

// Group by category
const byCategory = issues.reduce((acc, issue) => {
  acc[issue.category] = acc[issue.category] || [];
  acc[issue.category].push(issue);
  return acc;
}, {});

// {
//   injection: [...],
//   authentication: [...],
//   cryptography: [...]
// }
```

### Secret Redaction

```javascript
const scanner = new SecretScanner();
const content = fs.readFileSync('src/config.js', 'utf8');

// Find secrets
const secrets = await scanner.scanFile('src/config.js');

// Redact from logs
const redacted = scanner.redact(content);
console.log(redacted);  // Secrets replaced with ***REDACTED***
```

### Dependency Audit

```javascript
const scanner = new DependencyScanner();

// Check specific package
const issues = await scanner.checkPackage('lodash', '4.17.0');

// Full project scan
const report = await scanner.scanProject();
// {
//   total: 5,
//   critical: 1,
//   high: 2,
//   medium: 2,
//   dependencies: [...]
// }
```

## Severity Levels

| Level | Description |
|-------|-------------|
| Critical | Immediate exploitation possible |
| High | Significant security impact |
| Medium | Moderate security impact |
| Low | Minor security concern |
| Info | Informational, no direct risk |

## Configuration

### VulnerabilityScanner

```javascript
{
  projectRoot: string,
  categories: string[],      // Categories to check
  excludePatterns: string[], // Files to exclude
  customPatterns: object[]   // Additional patterns
}
```

### SecretScanner

```javascript
{
  projectRoot: string,
  entropyThreshold: number,  // For random string detection
  customPatterns: object[],  // Additional secret patterns
  ignorePatterns: string[]   // Patterns to ignore
}
```

### DependencyScanner

```javascript
{
  projectRoot: string,
  registryUrl: string,       // Vulnerability database
  offline: boolean,          // Use cached database
  severityThreshold: string  // Minimum severity to report
}
```

## Best Practices

1. **Run regularly** - Scan on every commit and in CI
2. **Act on critical findings** - Fix critical vulnerabilities immediately
3. **Use secret scanning** - Prevent credential leaks
4. **Update dependencies** - Keep dependencies up to date
5. **Enable pre-commit hooks** - Catch issues before commit

## Dependencies

- Vulnerability database (NVD, Snyk, etc.)
- File system access
- HTTP client (for database updates)

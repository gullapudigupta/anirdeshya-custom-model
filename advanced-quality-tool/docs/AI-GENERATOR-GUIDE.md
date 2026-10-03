# AI Generator - User Guide

## Overview

The AI Generator module powers Advanced Quality Tool's AI-assisted code generation, fixing, and refactoring capabilities. It provides intelligent code improvements by combining contextual analysis with state-of-the-art AI models.

## Features

🤖 **Multi-Provider Support** - OpenAI, Anthropic, Google, and local models via Ollama
💡 **Intelligent Context** - Gathers code context, dependencies, and documentation
🔧 **Code Generation** - Generate code from natural language descriptions
✅ **Test Generation** - Automatically create comprehensive test suites
📚 **Documentation** - Generate clear documentation from code
🛠️ **Issue Fixing** - AI-powered fixes for complex code issues
♻️ **Refactoring** - Intelligent code refactoring with safety checks
💰 **Cost Tracking** - Monitor and control AI provider costs
🔒 **Safety First** - Built-in security validation and content filtering
📊 **Quality Assurance** - Syntax validation and security scanning

## Quick Start

### 1. Configure AI Provider

```bash
# Set your API key
export OPENAI_API_KEY="sk-..."

# Configure provider
aqt ai config openai --model gpt-4
```

### 2. Generate Code

```bash
# Generate code from description
aqt ai generate code "Create a REST API endpoint for user authentication"

# Generate tests
aqt ai generate test src/auth.js

# Generate documentation
aqt ai generate doc src/utils.js
```

### 3. Fix Issues with AI

```bash
# Fix a specific issue
aqt ai fix <issue-id>

# Refactor code
aqt ai refactor src/app.js "Split into smaller modules"
```

## Supported Providers

### OpenAI

**Models**: GPT-4, GPT-4 Turbo, GPT-3.5 Turbo

**Setup**:
```bash
export OPENAI_API_KEY="sk-..."
aqt ai config openai --model gpt-4
```

**Cost**: ~$0.03/1K input tokens, ~$0.06/1K output tokens (GPT-4)

### Anthropic Claude

**Models**: Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku

**Setup**:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
aqt ai config anthropic --model claude-3-opus-20240229
```

**Cost**: ~$0.015/1K input tokens, ~$0.075/1K output tokens (Opus)

### Google AI

**Models**: Gemini Pro, Gemini Ultra

**Setup**:
```bash
export GOOGLE_AI_API_KEY="AI..."
aqt ai config google --model gemini-pro
```

**Cost**: ~$0.0005/1K input tokens, ~$0.0015/1K output tokens (Gemini Pro)

### Ollama (Local)

**Models**: CodeLlama, Mistral, Llama 2, and many more

**Setup**:
```bash
# Install Ollama first: https://ollama.ai
ollama pull codellama

# Configure AQT
aqt ai config ollama --model codellama
```

**Cost**: Free (runs locally)

## Use Cases

### 1. Code Generation

Generate production-ready code from natural language:

```bash
# Basic code generation
aqt ai generate code "Create a function to validate email addresses"

# With framework
aqt ai generate code "Create an Express middleware for authentication" \
  --framework express

# Specify language
aqt ai generate code "Create a class for user management" \
  --language python

# Save to file
aqt ai generate code "Create a utility for date formatting" \
  --output src/utils/date.js
```

**Example Output**:
```javascript
/**
 * Validates an email address
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Example usage:
// validateEmail('user@example.com'); // true
// validateEmail('invalid-email'); // false
```

### 2. Test Generation

Automatically generate comprehensive test suites:

```bash
# Generate tests for a file
aqt ai generate test src/auth.js

# Specify test framework
aqt ai generate test src/utils.js --framework mocha

# Save to specific file
aqt ai generate test src/calculator.js --output test/calculator.test.js

# For Python with pytest
aqt ai generate test src/calculator.py --framework pytest
```

**Example Output**:
```javascript
const { validateEmail } = require('../utils/email');

describe('validateEmail', () => {
  it('should return true for valid email', () => {
    expect(validateEmail('user@example.com')).toBe(true);
  });

  it('should return false for email without @', () => {
    expect(validateEmail('userexample.com')).toBe(false);
  });

  it('should return false for email without domain', () => {
    expect(validateEmail('user@')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(validateEmail('')).toBe(false);
  });
});
```

### 3. Documentation Generation

Generate clear, comprehensive documentation:

```bash
# Generate markdown documentation
aqt ai generate doc src/api.js

# Generate JSDoc comments
aqt ai generate doc src/utils.js --format jsdoc

# Save to docs folder
aqt ai generate doc src/core.js --output docs/core.md
```

**Example Output**:
```markdown
# Email Validation Module

## Overview

Provides email validation functionality with comprehensive regex-based validation.

## Functions

### validateEmail(email)

Validates an email address against RFC 5322 standards.

**Parameters:**
- `email` (string): The email address to validate

**Returns:**
- (boolean): `true` if the email is valid, `false` otherwise

**Example:**
\`\`\`javascript
validateEmail('user@example.com'); // true
validateEmail('invalid'); // false
\`\`\`
```

### 4. Issue Fixing

AI-powered fixes for complex issues:

```bash
# Fix a specific issue
aqt ai fix eslint-no-unused-vars

# Preview fix without applying
aqt ai fix typescript-missing-return-type --dry-run

# Auto-apply fix
aqt ai fix security-sql-injection --auto-apply
```

**Process**:
1. Loads issue details from analysis
2. Gathers code context
3. Searches for solutions (docs, GitHub, Stack Overflow)
4. Generates intelligent fix
5. Validates syntax and security
6. Applies fix (with approval)

### 5. Code Refactoring

Intelligent refactoring with AI:

```bash
# Refactor with description
aqt ai refactor src/legacy.js "Convert to modern ES6+ syntax"

# Extract functionality
aqt ai refactor src/monolith.js "Extract database logic into separate module"

# Improve architecture
aqt ai refactor src/app.js "Apply SOLID principles"

# Auto-apply refactoring
aqt ai refactor src/utils.js "Split into smaller functions" --auto-apply
```

**Safety Features**:
- Maintains existing functionality
- Validates syntax before applying
- Creates backups automatically
- Security scans all changes

## Cost Management

### Track Costs

```bash
# View cost summary
aqt ai cost

# Export cost report
aqt ai cost --export cost-report.json

# View specific period
aqt ai cost --period week
```

**Output**:
```
💰 AI Cost Tracking
────────────────────────────────────────
Total Cost: $2.45
Requests: 25
Average Cost/Request: $0.098

By Type:
────────────────────────────────────────
code-generation      $1.20
test-generation      $0.75
refactoring          $0.50

Budget Status:
────────────────────────────────────────
Monthly Budget: $100.00
Used: $2.45 (2.5%)
Remaining: $97.55
```

### Set Budget Limits

```bash
# Set monthly budget
export AQT_AI_MONTHLY_BUDGET=100.0

# Set per-request limit
export AQT_AI_MAX_COST=1.0

# Configure in file
aqt config set ai.monthlyBudget 100.0
aqt config set ai.maxCost 1.0
```

### Cost Optimization Tips

1. **Use Cheaper Models for Simple Tasks**
   ```bash
   # Use GPT-3.5 for simple tasks
   aqt ai generate code "Simple function" --model gpt-3.5-turbo
   
   # Use GPT-4 for complex tasks
   aqt ai generate code "Complex algorithm" --model gpt-4
   ```

2. **Use Local Models When Possible**
   ```bash
   # Free, runs locally
   aqt ai config ollama --model codellama
   ```

3. **Batch Operations**
   ```bash
   # Fix multiple issues at once
   aqt ai fix --issues issues.json --batch
   ```

## Safety & Security

### Built-in Safety Features

1. **Code Validation**
   - Syntax checking
   - Type validation (TypeScript)
   - Linting integration

2. **Security Scanning**
   - Malicious pattern detection
   - Hardcoded secret detection
   - SQL injection patterns
   - Command injection patterns
   - Remote code execution patterns

3. **Prompt Injection Protection**
   - Detects manipulation attempts
   - Filters harmful instructions
   - Sanitizes inputs

4. **Content Filtering**
   - Removes dangerous code patterns
   - Redacts sensitive data
   - Validates outputs

### Validation Example

```bash
# All AI-generated code is automatically validated
aqt ai generate code "..." --verbose

# Output shows validation:
# ✅ Syntax validation: PASSED
# ✅ Security scan: PASSED  
# ✅ Pattern check: PASSED
# ⚠️  Warning: Uses file system APIs
```

### Audit Trail

All AI operations are logged:

```bash
# View audit log
cat .aqt-reports/ai-audit.jsonl

# Each entry contains:
# - Validation ID
# - Timestamp
# - Generated code hash
# - Security findings
# - Applied fixes
```

## Advanced Configuration

### Configuration File

Create `.aqt/ai-config.json`:

```json
{
  "provider": "openai",
  "model": "gpt-4",
  "maxCost": 1.0,
  "monthlyBudget": 100.0,
  "autoApply": false,
  "safety": {
    "strictMode": true,
    "allowEval": false,
    "allowNetworkCalls": false,
    "enableAuditLog": true
  },
  "fallback": {
    "enabled": true,
    "provider": "ollama",
    "model": "codellama"
  }
}
```

### Environment Variables

```bash
# Provider Configuration
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GOOGLE_AI_API_KEY="AI..."

# Provider Selection
export AQT_AI_PROVIDER=openai
export AQT_AI_MODEL=gpt-4

# Cost Controls
export AQT_AI_MAX_COST=1.0
export AQT_AI_MONTHLY_BUDGET=100.0

# Safety Settings
export AQT_AI_STRICT_MODE=true
export AQT_AI_ALLOW_EVAL=false
export AQT_AI_ENABLE_AUDIT=true

# Local Model Settings
export OLLAMA_BASE_URL=http://localhost:11434
```

### Custom Prompts

Create custom prompt templates:

```javascript
// .aqt/prompts/custom-test.js
module.exports = {
  name: 'custom-test',
  template: `Generate comprehensive tests for:
  
{{code}}

Requirements:
- Use {{framework}} framework
- Test all edge cases
- Include setup and teardown
- Aim for 100% coverage
`
};
```

Use with:
```bash
aqt ai generate test src/file.js --template custom-test
```

## API Integration

### Use AI Generation in Your Code

```javascript
const { AICommand } = require('advanced-quality-tool/commands/ai-command');

const ai = new AICommand({
  provider: 'openai',
  model: 'gpt-4'
});

// Generate code
const result = await ai.generateCode({
  description: 'Create a user authentication function',
  language: 'javascript'
});

console.log(result.data.code);
console.log(`Cost: $${result.data.cost}`);
```

### REST API

```bash
# Generate code
curl -X POST http://localhost:3000/api/ai/generate/code \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Create a REST API endpoint",
    "language": "javascript",
    "framework": "express"
  }'

# Generate tests
curl -X POST http://localhost:3000/api/ai/generate/test \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "src/auth.js",
    "framework": "jest"
  }'
```

### MCP Tools

Use from Claude Desktop or other MCP clients:

```json
{
  "name": "aqt_ai_generate_code",
  "arguments": {
    "description": "Create a function to validate emails",
    "language": "javascript"
  }
}
```

## Best Practices

### 1. Be Specific in Descriptions

✅ **Good**:
```bash
aqt ai generate code "Create a function that validates email addresses using RFC 5322 standards, returns boolean"
```

❌ **Bad**:
```bash
aqt ai generate code "Make email function"
```

### 2. Review Before Applying

Always review AI-generated code:

```bash
# Preview first
aqt ai refactor src/app.js "..." --dry-run

# Review output
# Then apply if satisfied
aqt ai refactor src/app.js "..." --auto-apply
```

### 3. Use Appropriate Models

- **Simple tasks**: GPT-3.5, Claude Haiku, Gemini Pro
- **Complex tasks**: GPT-4, Claude Opus
- **Local development**: CodeLlama via Ollama

### 4. Monitor Costs

```bash
# Check costs regularly
aqt ai cost

# Set budgets
aqt config set ai.monthlyBudget 100.0
```

### 5. Leverage Context

Provide context for better results:

```bash
# Specify framework
aqt ai generate code "..." --framework react

# Specify language features
aqt ai generate code "... using async/await" --language javascript
```

### 6. Validate Generated Code

```bash
# Always run tests
npm test

# Run linting
npm run lint

# Type check (TypeScript)
npm run type-check
```

## Troubleshooting

### API Key Errors

**Problem**: `API key not found for provider`

**Solution**:
```bash
# Check environment variable
echo $OPENAI_API_KEY

# Set if missing
export OPENAI_API_KEY="sk-..."

# Or add to .env file
echo "OPENAI_API_KEY=sk-..." >> .env
```

### Cost Limit Exceeded

**Problem**: `Estimated cost exceeds limit`

**Solution**:
```bash
# Increase limit
aqt config set ai.maxCost 2.0

# Or use --force flag
aqt ai generate code "..." --force
```

### Generation Quality Issues

**Problem**: Generated code doesn't meet expectations

**Solutions**:
1. Be more specific in description
2. Try a different model (GPT-4 vs GPT-3.5)
3. Provide example code or patterns
4. Use custom prompt templates

### Rate Limiting

**Problem**: Provider rate limit errors

**Solution**:
```bash
# Wait and retry
# Or switch to different provider
aqt ai config anthropic

# Or use local model
aqt ai config ollama --model codellama
```

## Examples

### Complete Workflow Example

```bash
# 1. Configure provider
export OPENAI_API_KEY="sk-..."
aqt ai config openai --model gpt-4

# 2. Generate code
aqt ai generate code "Create a REST API for todo management" \
  --framework express \
  --output src/api/todos.js

# 3. Generate tests
aqt ai generate test src/api/todos.js \
  --framework jest \
  --output test/api/todos.test.js

# 4. Generate documentation
aqt ai generate doc src/api/todos.js \
  --output docs/api/todos.md

# 5. Run analysis
aqt analyze src/api/

# 6. Fix issues with AI
aqt ai fix <issue-id> --auto-apply

# 7. Check costs
aqt ai cost
```

## Support

- **Documentation**: https://github.com/your-org/advanced-quality-tool/docs
- **Issues**: https://github.com/your-org/advanced-quality-tool/issues
- **Discussions**: https://github.com/your-org/advanced-quality-tool/discussions

## License

MIT License - see LICENSE file for details

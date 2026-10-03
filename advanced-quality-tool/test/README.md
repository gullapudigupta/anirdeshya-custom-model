# Advanced Quality Tool - Test Suite

Comprehensive test suite for the Advanced Quality Tool.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run with coverage
npm test -- --coverage
```

## Test Structure

```
test/
├── __tests__/
│   ├── ai-fixer.test.js           # AI fixer tests
│   ├── auto-fix-engine.test.js    # Auto-fix engine tests
│   ├── file-watcher.test.js       # File watcher tests
│   └── build-monitor.test.js      # Build monitor tests
├── package.json                    # Test dependencies
└── README.md                       # This file
```

## Test Coverage

The test suite covers:

### AI Fixer (`ai-fixer.test.js`)
- ✓ Cache key generation
- ✓ Fix validation (syntax, safety, patterns)
- ✓ Empty fix detection
- ✓ Code extraction from markdown
- ✓ Prompt building
- ✓ Coordinator fallback logic
- ✓ Local/cloud AI integration

### Auto-Fix Engine (`auto-fix-engine.test.js`)
- ✓ Issue classification (rule vs AI)
- ✓ Code context extraction
- ✓ Statistics calculation
- ✓ Session management
- ✓ Unfixed issue tracking
- ✓ Strategy configuration
- ✓ Dry run mode

### File Watcher (`file-watcher.test.js`)
- ✓ Initialization and configuration
- ✓ Pattern matching (glob patterns)
- ✓ File filtering (include/exclude)
- ✓ Debouncing behavior
- ✓ Event emission
- ✓ Statistics tracking
- ✓ Auto-fix integration

### Build Monitor (`build-monitor.test.js`)
- ✓ CI environment detection (6 platforms)
- ✓ Metrics calculation
- ✓ Quality gate enforcement
- ✓ Regression detection
- ✓ Report generation (HTML, JUnit XML)
- ✓ Exit code control
- ✓ History tracking

## Writing Tests

### Unit Test Example

```javascript
describe('MyComponent', () => {
  let component;

  beforeEach(() => {
    component = new MyComponent({ verbose: false });
  });

  test('should initialize correctly', () => {
    expect(component).toBeDefined();
    expect(component.verbose).toBe(false);
  });

  test('should handle errors gracefully', async () => {
    const result = await component.process('invalid');

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
```

### Integration Test Example

```javascript
describe('Integration Tests', () => {
  test('should handle full workflow', async () => {
    const engine = new AutoFixEngine({ dryRun: true });

    const results = await engine.fixFiles({
      'test.js': [{ ruleId: 'semi', severity: 'error' }]
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].success).toBeDefined();
  });
});
```

## Mocking

When testing components that interact with external services:

```javascript
// Mock AI fixer
jest.mock('../../src/fixers/ai-fixer', () => ({
  AIFixCoordinator: jest.fn().mockImplementation(() => ({
    generateFix: jest.fn().mockResolvedValue({
      fixedCode: 'const x = 1;',
      confidence: 0.9
    })
  }))
}));
```

## Test Best Practices

1. **Isolate Tests**: Each test should be independent
2. **Clean Up**: Use `afterEach` to clean up resources
3. **Mock External Dependencies**: Don't rely on external services
4. **Test Edge Cases**: Zero values, empty arrays, null inputs
5. **Descriptive Names**: Test names should describe what they test
6. **Fast Tests**: Keep tests fast (< 1s per test)
7. **Arrange-Act-Assert**: Structure tests clearly

## Coverage Goals

We aim for:
- **80%+ statement coverage**
- **70%+ branch coverage**
- **80%+ function coverage**

Current coverage: Run `npm test -- --coverage` to see.

## Continuous Integration

Tests run automatically on:
- Every commit (pre-commit hook)
- Every pull request (GitHub Actions)
- Before deployment (CI/CD pipeline)

## Troubleshooting

### Tests Failing Locally

```bash
# Clear jest cache
npx jest --clearCache

# Run with verbose output
npm test -- --verbose

# Run specific test file
npm test -- ai-fixer.test.js
```

### Timeouts

If tests timeout, increase the timeout:

```javascript
test('long running test', async () => {
  // Test code
}, 30000); // 30 second timeout
```

### Mock Issues

If mocks aren't working:

```javascript
// Clear all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
```

## Future Tests

Planned test additions:
- [ ] Command integration tests
- [ ] WebSocket server tests
- [ ] Chat UI interaction tests
- [ ] End-to-end workflow tests
- [ ] Performance benchmarks
- [ ] Load testing

## Contributing

When adding new features:
1. Write tests first (TDD)
2. Ensure 80%+ coverage for new code
3. Run full test suite before committing
4. Update this README if adding new test categories

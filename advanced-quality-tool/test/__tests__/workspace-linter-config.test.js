/**
 * Workspace and Package-Driven Linter Configuration Tests (P9-T007)
 *
 * Fixture-based tests proving discovery uses the selected project's package.json
 * rather than the tool's own package.json.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { WorkspaceResolver } = require('../../src/workspace/workspace-resolver');
const { PackageConfigReader } = require('../../src/workspace/package-config-reader');
const { LinterConfigManager } = require('../../src/workspace/linter-config-manager');

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

/**
 * Create temporary test workspace with package.json
 */
function createTestWorkspace(name, packageJson, configFiles = {}) {
  const testDir = path.join(__dirname, '..', '.fixtures', `workspace-${name}-${Date.now()}`);
  
  fs.mkdirSync(testDir, { recursive: true });
  
  // Write package.json
  fs.writeFileSync(
    path.join(testDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
    'utf8'
  );
  
  // Write config files
  for (const [filename, content] of Object.entries(configFiles)) {
    fs.writeFileSync(path.join(testDir, filename), content, 'utf8');
  }
  
  return testDir;
}

/**
 * Clean up test workspace
 */
function cleanupTestWorkspace(workspacePath) {
  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

/**
 * Test: Uses selected project's package.json, not tool's package.json
 */
function test_usesSelectedProjectPackageJson() {
  console.log('  Test: Uses selected project\'s package.json, not tool\'s');
  
  // Create workspace with ESLint in dependencies
  const workspace = createTestWorkspace('with-eslint', {
    name: 'test-project',
    version: '1.0.0',
    scripts: {
      lint: 'eslint src/',
      test: 'jest'
    },
    dependencies: {
      eslint: '^8.50.0'
    },
    devDependencies: {
      jest: '^29.0.0'
    }
  });
  
  try {
    const reader = new PackageConfigReader({ workspace });
    
    // Verify it reads the test workspace's package.json
    const pkg = reader.read();
    assert.strictEqual(pkg.name, 'test-project', 'Should read workspace package.json');
    assert.strictEqual(pkg.version, '1.0.0', 'Should read correct version');
    
    // Verify it detects ESLint from test workspace, not tool's own package.json
    const linters = reader.detectLinters();
    const eslintLinter = linters.available.find(l => l.name === 'eslint');
    
    assert.ok(eslintLinter, 'ESLint should be detected as available');
    assert.strictEqual(eslintLinter.version, '^8.50.0', 'Should use test workspace version');
    
    console.log('    ✓ Correctly uses selected project\'s package.json');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Discovers lint commands from scripts
 */
function test_discoversLintCommands() {
  console.log('  Test: Discovers lint commands from scripts');
  
  const workspace = createTestWorkspace('with-scripts', {
    name: 'project-with-scripts',
    scripts: {
      lint: 'eslint .',
      'lint:fix': 'eslint . --fix',
      test: 'jest',
      'test:coverage': 'jest --coverage',
      build: 'tsc'
    },
    devDependencies: {
      eslint: '^8.0.0',
      jest: '^29.0.0',
      typescript: '^5.0.0'
    }
  });
  
  try {
    const reader = new PackageConfigReader({ workspace });
    const commands = reader.discoverCommands();
    
    // Should discover lint commands
    assert.strictEqual(commands.lint.length, 2, 'Should find 2 lint commands');
    assert.ok(commands.lint.some(c => c.name === 'lint'), 'Should find "lint" script');
    assert.ok(commands.lint.some(c => c.name === 'lint:fix'), 'Should find "lint:fix" script');
    
    // Should discover test commands
    assert.strictEqual(commands.test.length, 2, 'Should find 2 test commands');
    
    // Should discover build commands
    assert.strictEqual(commands.build.length, 1, 'Should find 1 build command');
    
    console.log('    ✓ Correctly discovers all command types');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Detects linters from dependencies
 */
function test_detectsLintersFromDependencies() {
  console.log('  Test: Detects linters from dependencies');
  
  const workspace = createTestWorkspace('multi-linter', {
    name: 'multi-linter-project',
    devDependencies: {
      eslint: '^8.50.0',
      prettier: '^3.0.0',
      stylelint: '^15.0.0'
    }
  }, {
    '.eslintrc.json': '{}',
    '.prettierrc': '{}',
    '.stylelintrc.json': '{}'
  });
  
  try {
    const reader = new PackageConfigReader({ workspace });
    const linters = reader.detectLinters();
    
    // Should detect all three linters as available
    assert.strictEqual(linters.available.length, 3, 'Should detect 3 available linters');
    assert.strictEqual(linters.unavailable.length, 2, 'Should have 2 unavailable (tslint, jshint)');
    
    const names = linters.available.map(l => l.name);
    assert.ok(names.includes('eslint'), 'Should detect ESLint');
    assert.ok(names.includes('prettier'), 'Should detect Prettier');
    assert.ok(names.includes('stylelint'), 'Should detect StyleLint');
    
    // Should detect config files
    const eslint = linters.available.find(l => l.name === 'eslint');
    assert.strictEqual(eslint.hasConfig, true, 'Should detect ESLint config');
    
    console.log('    ✓ Correctly detects all linters and configs');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Linter config manager persistence
 */
function test_linterConfigPersistence() {
  console.log('  Test: Linter config manager persistence');
  
  const workspace = createTestWorkspace('config-test', {
    name: 'config-project',
    devDependencies: {
      eslint: '^8.0.0',
      prettier: '^3.0.0'
    }
  });
  
  try {
    const reader = new PackageConfigReader({ workspace });
    const manager = new LinterConfigManager({ workspace });
    
    const linters = reader.detectLinters();
    
    // Get initial config
    let config = manager.getConfig(linters);
    assert.ok(config.selectedLinters.includes('eslint'), 'ESLint should be selected by default');
    
    // Update selection
    config = manager.updateSelection(['prettier'], linters);
    assert.ok(config.selectedLinters.includes('prettier'), 'Prettier should be selected');
    assert.ok(!config.selectedLinters.includes('eslint'), 'ESLint should not be selected');
    
    // Reload and verify persistence
    const newManager = new LinterConfigManager({ workspace });
    const reloadedConfig = newManager.getConfig(linters);
    assert.ok(reloadedConfig.selectedLinters.includes('prettier'), 'Prettier selection should persist');
    
    console.log('    ✓ Config persists correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Workspace resolution from explicit path
 */
function test_workspaceResolutionFromExplicitPath() {
  console.log('  Test: Workspace resolution from explicit path');
  
  const workspace = createTestWorkspace('explicit', {
    name: 'explicit-project'
  });
  
  try {
    const resolver = new WorkspaceResolver();
    const result = resolver.resolve({ explicitPath: workspace });
    
    assert.strictEqual(result.source, 'explicit', 'Should use explicit source');
    assert.strictEqual(result.root, path.resolve(workspace), 'Should resolve to explicit path');
    assert.strictEqual(result.isMultiRoot, false, 'Should not be multi-root');
    
    console.log('    ✓ Correctly resolves explicit workspace path');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Workspace resolution from context hint
 */
function test_workspaceResolutionFromContextHint() {
  console.log('  Test: Workspace resolution from context hint');
  
  const workspace = createTestWorkspace('context-hint', {
    name: 'context-project'
  });
  
  try {
    // Create a nested file path
    const nestedFile = path.join(workspace, 'src', 'lib', 'file.js');
    
    const resolver = new WorkspaceResolver();
    const result = resolver.resolve({ contextHint: nestedFile });
    
    assert.strictEqual(result.source, 'context', 'Should use context source');
    assert.strictEqual(result.root, path.resolve(workspace), 'Should resolve to workspace root');
    
    console.log('    ✓ Correctly resolves from context hint');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Project metadata extraction
 */
function test_projectMetadataExtraction() {
  console.log('  Test: Project metadata extraction');
  
  const workspace = createTestWorkspace('metadata', {
    name: 'metadata-project',
    version: '2.0.0',
    type: 'module',
    main: 'dist/index.js',
    engines: {
      node: '>=18.0.0'
    },
    scripts: {
      build: 'tsc',
      test: 'jest'
    },
    dependencies: {
      typescript: '^5.0.0'
    }
  });
  
  try {
    const reader = new PackageConfigReader({ workspace });
    const metadata = reader.getProjectMetadata();
    
    assert.strictEqual(metadata.name, 'metadata-project', 'Should extract name');
    assert.strictEqual(metadata.version, '2.0.0', 'Should extract version');
    assert.strictEqual(metadata.type, 'module', 'Should extract type');
    assert.strictEqual(metadata.hasTypeScript, true, 'Should detect TypeScript');
    assert.strictEqual(metadata.nodeVersion, '>=18.0.0', 'Should extract node version');
    assert.strictEqual(metadata.main, 'dist/index.js', 'Should extract main');
    assert.ok(metadata.scripts.includes('build'), 'Should list build script');
    
    console.log('    ✓ Correctly extracts project metadata');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Config validation
 */
function test_configValidation() {
  console.log('  Test: Config validation');
  
  const workspace = createTestWorkspace('validation', {
    name: 'validation-project',
    devDependencies: {
      eslint: '^8.0.0'
    }
  });
  
  try {
    const reader = new PackageConfigReader({ workspace });
    const manager = new LinterConfigManager({ workspace });
    const linters = reader.detectLinters();
    
    // Valid config
    let config = { selectedLinters: ['eslint'], enabled: true };
    let validation = manager.validateConfig(config, linters);
    assert.strictEqual(validation.valid, true, 'Valid config should pass');
    assert.strictEqual(validation.issues.length, 0, 'Should have no issues');
    
    // Invalid: selected unavailable linter
    config = { selectedLinters: ['prettier'], enabled: true };
    validation = manager.validateConfig(config, linters);
    assert.strictEqual(validation.valid, false, 'Should be invalid');
    assert.ok(validation.issues.some(i => i.severity === 'error'), 'Should have error');
    
    // Warning: no linters selected
    config = { selectedLinters: [], enabled: true };
    validation = manager.validateConfig(config, linters);
    assert.strictEqual(validation.valid, true, 'Should be technically valid');
    assert.ok(validation.issues.some(i => i.severity === 'warning'), 'Should have warning');
    
    console.log('    ✓ Config validation works correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Recommended linters based on project type
 */
function test_recommendedLinters() {
  console.log('  Test: Recommended linters based on project type');
  
  const workspace = createTestWorkspace('recommended', {
    name: 'recommended-project',
    devDependencies: {
      eslint: '^8.0.0',
      prettier: '^3.0.0',
      stylelint: '^15.0.0',
      typescript: '^5.0.0'
    }
  });
  
  try {
    const reader = new PackageConfigReader({ workspace });
    const manager = new LinterConfigManager({ workspace });
    const linters = reader.detectLinters();
    const metadata = reader.getProjectMetadata();
    
    const recommended = manager.getRecommendedLinters(metadata, linters);
    
    assert.ok(recommended.includes('eslint'), 'Should recommend ESLint');
    assert.ok(recommended.includes('prettier'), 'Should recommend Prettier');
    assert.ok(recommended.includes('stylelint'), 'Should recommend StyleLint for CSS');
    
    console.log('    ✓ Recommends correct linters');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

// ─── Run Tests ─────────────────────────────────────────────────────────────────

function runTests() {
  console.log('\n=== Workspace Linter Configuration Tests (P9-T007) ===\n');
  
  // Create fixtures directory
  const fixturesDir = path.join(__dirname, '..', '.fixtures');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  
  try {
    test_usesSelectedProjectPackageJson();
    test_discoversLintCommands();
    test_detectsLintersFromDependencies();
    test_linterConfigPersistence();
    test_workspaceResolutionFromExplicitPath();
    test_workspaceResolutionFromContextHint();
    test_projectMetadataExtraction();
    test_configValidation();
    test_recommendedLinters();
    
    console.log('\n✅ All P9-T007 tests passed!\n');
    return { passed: 9, failed: 0 };
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    return { passed: 0, failed: 1, error: error.message };
  } finally {
    // Clean up all fixtures
    if (fs.existsSync(fixturesDir)) {
      const entries = fs.readdirSync(fixturesDir);
      for (const entry of entries) {
        const entryPath = path.join(fixturesDir, entry);
        if (fs.statSync(entryPath).isDirectory()) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        }
      }
    }
  }
}

module.exports = { runTests };

// Run if called directly
if (require.main === module) {
  runTests();
}

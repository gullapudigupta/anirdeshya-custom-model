/**
 * Provider and Model Selection Tests (P9-T009)
 *
 * Tests for security-critical model and provider selection with
 * credential security and connectivity checks.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ProviderModelSelector, ProviderType, ModelCapability } = require('../../src/agent/provider-model-selector');

// ─── Test Helpers ───────────────────────────────────────────────────────────────

function createTestWorkspace(name) {
  const testDir = path.join(__dirname, '..', '.fixtures', `provider-test-${name}-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  return testDir;
}

function cleanupTestWorkspace(workspacePath) {
  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

/**
 * Test: Provider registration
 */
function test_providerRegistration() {
  console.log('  Test: Provider registration');
  
  const workspace = createTestWorkspace('registration');
  
  try {
    const selector = new ProviderModelSelector({ workspace });
    
    // Local providers should always be registered
    assert.ok(selector.providers.has('ollama'), 'Ollama provider should be registered');
    assert.ok(selector.providers.has('lm-studio'), 'LM Studio provider should be registered');
    
    // Check provider types
    const ollama = selector.providers.get('ollama');
    assert.strictEqual(ollama.type, ProviderType.LOCAL, 'Ollama should be local provider');
    
    console.log('    ✓ Providers registered correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Model discovery
 */
function test_modelDiscovery() {
  console.log('  Test: Model discovery');
  
  const workspace = createTestWorkspace('discovery');
  
  try {
    const selector = new ProviderModelSelector({ workspace });
    
    // Get all models
    const models = selector.getAllModels();
    
    // Should have models from local providers
    assert.ok(models.length > 0, 'Should have available models');
    
    // Check model structure
    const firstModel = models[0];
    assert.ok(firstModel.id, 'Model should have ID');
    assert.ok(firstModel.name, 'Model should have name');
    assert.ok(firstModel.provider, 'Model should have provider');
    assert.ok(Array.isArray(firstModel.capabilities), 'Model should have capabilities');
    
    console.log('    ✓ Models discovered correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Workspace default model
 */
function test_workspaceDefaultModel() {
  console.log('  Test: Workspace default model');
  
  const workspace = createTestWorkspace('default-model');
  
  try {
    const selector = new ProviderModelSelector({ workspace });
    
    // Initially no default
    let defaultModel = selector.getWorkspaceDefault();
    assert.strictEqual(defaultModel, null, 'Initially no default model');
    
    // Set default
    const models = selector.getAllModels();
    if (models.length > 0) {
      selector.setWorkspaceDefault(models[0].id);
      
      defaultModel = selector.getWorkspaceDefault();
      assert.ok(defaultModel, 'Should have default model after setting');
      assert.strictEqual(defaultModel.id, models[0].id, 'Default should match set value');
    }
    
    console.log('    ✓ Workspace default model works correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Task model override
 */
function test_taskModelOverride() {
  console.log('  Test: Task model override');
  
  const workspace = createTestWorkspace('task-override');
  
  try {
    const selector = new ProviderModelSelector({ workspace });
    const models = selector.getAllModels();
    
    if (models.length >= 2) {
      // Set workspace default
      selector.setWorkspaceDefault(models[0].id);
      
      // Set task override
      const taskId = 'test-task-123';
      selector.setTaskModel(taskId, models[1].id);
      
      // Get task model
      const taskModel = selector.getTaskModel(taskId);
      assert.ok(taskModel, 'Should have task model');
      assert.strictEqual(taskModel.id, models[1].id, 'Task model should use override');
      
      // Clear override
      selector.clearTaskModel(taskId);
      const clearedModel = selector.getTaskModel(taskId);
      assert.strictEqual(clearedModel.id, models[0].id, 'Should fall back to workspace default');
    }
    
    console.log('    ✓ Task model override works correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Auto-resolved model
 */
function test_autoResolvedModel() {
  console.log('  Test: Auto-resolved model');
  
  const workspace = createTestWorkspace('auto-resolve');
  
  try {
    const selector = new ProviderModelSelector({ workspace });
    
    // Without any defaults, should fall back
    const resolved = selector.getAutoResolvedModel();
    assert.ok(resolved, 'Should resolve a model');
    assert.ok(resolved.resolutionSource, 'Should have resolution source');
    
    // With recommended models
    const models = selector.getAllModels();
    const recommendedIds = models.slice(0, 2).map(m => m.id);
    
    const resolvedWithRecommended = selector.getAutoResolvedModel({
      recommendedModels: recommendedIds
    });
    
    assert.ok(resolvedWithRecommended, 'Should resolve from recommended');
    
    console.log('    ✓ Auto-resolution works correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Budget enforcement
 */
function test_budgetEnforcement() {
  console.log('  Test: Budget enforcement');
  
  const workspace = createTestWorkspace('budget');
  
  try {
    const selector = new ProviderModelSelector({ 
      workspace,
      maxTokensPerRun: 1000,
      maxCostPerRun: 0.1
    });
    
    // Within budget
    const withinBudget = selector.checkBudget({ tokens: 500, cost: 0.05 });
    assert.strictEqual(withinBudget.allowed, true, 'Should allow within budget');
    
    // Exceeds token limit
    const exceedsTokens = selector.checkBudget({ tokens: 1500, cost: 0.01 });
    assert.strictEqual(exceedsTokens.allowed, false, 'Should reject excessive tokens');
    assert.ok(exceedsTokens.reason, 'Should provide rejection reason');
    
    // Exceeds cost limit
    const exceedsCost = selector.checkBudget({ tokens: 100, cost: 0.5 });
    assert.strictEqual(exceedsCost.allowed, false, 'Should reject excessive cost');
    
    console.log('    ✓ Budget enforcement works correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Usage tracking
 */
function test_usageTracking() {
  console.log('  Test: Usage tracking');
  
  const workspace = createTestWorkspace('usage');
  
  try {
    const selector = new ProviderModelSelector({ workspace });
    
    // Record usage
    selector.recordUsage({ tokens: 1000, cost: 0.05 });
    
    // Get stats
    const stats = selector.getUsageStats();
    assert.strictEqual(stats.dailyTokens, 1000, 'Should track daily tokens');
    assert.strictEqual(stats.dailyCost, 0.05, 'Should track daily cost');
    
    // Record more usage
    selector.recordUsage({ tokens: 500, cost: 0.02 });
    
    const updatedStats = selector.getUsageStats();
    assert.strictEqual(updatedStats.dailyTokens, 1500, 'Should accumulate tokens');
    assert.strictEqual(updatedStats.dailyCost, 0.07, 'Should accumulate cost');
    
    console.log('    ✓ Usage tracking works correctly');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: UI info
 */
function test_uiInfo() {
  console.log('  Test: UI info');
  
  const workspace = createTestWorkspace('ui-info');
  
  try {
    const selector = new ProviderModelSelector({ workspace });
    
    const uiInfo = selector.getUIInfo();
    
    assert.ok(Array.isArray(uiInfo.providers), 'Should have providers array');
    assert.ok(uiInfo.usageStats, 'Should have usage stats');
    
    // Check provider structure
    if (uiInfo.providers.length > 0) {
      const provider = uiInfo.providers[0];
      assert.ok(provider.name, 'Provider should have name');
      assert.ok(provider.type, 'Provider should have type');
      assert.ok(Array.isArray(provider.models), 'Provider should have models');
    }
    
    console.log('    ✓ UI info structure is correct');
  } finally {
    cleanupTestWorkspace(workspace);
  }
}

/**
 * Test: Credentials from environment
 */
function test_credentialsFromEnvironment() {
  console.log('  Test: Credentials from environment');
  
  const workspace = createTestWorkspace('credentials');
  
  // Save original env
  const originalKey = process.env.OPENAI_API_KEY;
  
  try {
    // Without API key
    delete process.env.OPENAI_API_KEY;
    
    let selectorNoKey = new ProviderModelSelector({ workspace });
    assert.ok(!selectorNoKey.providers.has('openai'), 'Should not register OpenAI without key');
    
    // With API key
    process.env.OPENAI_API_KEY = 'test-key-12345';
    
    let selectorWithKey = new ProviderModelSelector({ workspace });
    assert.ok(selectorWithKey.providers.has('openai'), 'Should register OpenAI with key');
    
    console.log('    ✓ Credentials loaded from environment correctly');
  } finally {
    // Restore original env
    if (originalKey !== undefined) {
      process.env.OPENAI_API_KEY = originalKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    
    cleanupTestWorkspace(workspace);
  }
}

// ─── Run Tests ─────────────────────────────────────────────────────────────────

function runTests() {
  console.log('\n=== Provider and Model Selection Tests (P9-T009) ===\n');
  
  const fixturesDir = path.join(__dirname, '..', '.fixtures');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  
  try {
    test_providerRegistration();
    test_modelDiscovery();
    test_workspaceDefaultModel();
    test_taskModelOverride();
    test_autoResolvedModel();
    test_budgetEnforcement();
    test_usageTracking();
    test_uiInfo();
    test_credentialsFromEnvironment();
    
    console.log('\n✅ All P9-T009 tests passed!\n');
    return { passed: 9, failed: 0 };
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    return { passed: 0, failed: 1, error: error.message };
  } finally {
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

if (require.main === module) {
  runTests();
}

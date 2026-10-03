/**
 * Example usage of TaskImporter for P9-T008
 * 
 * Demonstrates JSON parsing, validation, and task selection.
 */

const TaskImporter = require('../src/agent/task-importer');
const path = require('path');

async function runExample() {
  console.log('=== Task Importer Example (P9-T008) ===\n');
  
  // Create importer for current workspace
  const workspacePath = process.cwd();
  const importer = new TaskImporter(workspacePath);
  
  // Example 1: Import phase9 tasks
  console.log('1. Importing phase9-tasks.json...');
  const phase9Result = importer.selectTaskFile('./tasks/phase9-tasks.json');
  
  if (phase9Result.success) {
    console.log(`   ✅ Successfully imported ${phase9Result.tasks.length} tasks`);
    console.log(`   Format: ${phase9Result.validation.format}`);
    console.log(`   Phase: ${phase9Result.validation.phase}`);
    
    if (phase9Result.warnings.length > 0) {
      console.log(`   Warnings: ${phase9Result.warnings.length}`);
      phase9Result.warnings.forEach(w => console.log(`     - ${w}`));
    }
    
    // Get summary
    const summary = importer.getTaskSummary();
    console.log(`\n   Summary:`);
    console.log(`     Total tasks: ${summary.totalTasks}`);
    console.log(`     Status: PENDING=${summary.statusCounts.PENDING}, COMPLETED=${summary.statusCounts.COMPLETED}`);
    console.log(`     Priority: HIGH=${summary.priorityCounts.HIGH}, MEDIUM=${summary.priorityCounts.MEDIUM}`);
    console.log(`     Estimated hours: ${summary.totalEstimatedHours}`);
    
    // Select some tasks
    console.log('\n2. Selecting tasks for agent execution...');
    const taskIdsToSelect = ['P9-T008', 'P9-T001', 'P9-T002'];
    importer.selectTasks(taskIdsToSelect, true);
    
    const selectedTasks = importer.getSelectedTasks();
    console.log(`   Selected ${selectedTasks.length} tasks:`);
    selectedTasks.forEach(task => {
      console.log(`     • ${task.id}: ${task.name} (${task.status}, ${task.priority})`);
    });
    
    // Example 2: Try invalid file
    console.log('\n3. Testing error handling with invalid file...');
    const invalidResult = importer.selectTaskFile('./nonexistent-tasks.json');
    
    if (!invalidResult.success) {
      console.log(`   ❌ Expected error: ${invalidResult.error}`);
      console.log(`   Actionable message: ${invalidResult.actionableError}`);
    }
    
    // Example 3: Refresh functionality
    console.log('\n4. Testing refresh functionality...');
    const refreshResult = importer.refresh();
    
    if (refreshResult.success) {
      console.log(`   ✅ Refreshed ${refreshResult.tasks.length} tasks`);
    }
    
    // Example 4: Clear and import different format
    console.log('\n5. Testing different task file format...');
    importer.clear();
    
    // Try with master index (should show warning)
    const masterResult = importer.selectTaskFile('./tasks/master_tasks_index.json');
    
    if (masterResult.success) {
      console.log(`   Imported ${masterResult.validation.format} format`);
      if (masterResult.warnings.length > 0) {
        console.log(`   Warning: ${masterResult.warnings[0]}`);
      }
    }
    
    console.log('\n=== Example Complete ===');
    
  } else {
    console.log(`   ❌ Failed to import: ${phase9Result.error}`);
    console.log(`   Actionable error: ${phase9Result.actionableError}`);
  }
}

// Run example if this file is executed directly
if (require.main === module) {
  runExample().catch(console.error);
}

module.exports = { runExample };
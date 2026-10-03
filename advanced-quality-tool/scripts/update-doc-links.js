#!/usr/bin/env node
/**
 * Documentation Link Update Script for P9-T004/T005
 * 
 * Updates links in documentation files after reorganization.
 */

const fs = require('fs');
const path = require('path');

// Mapping of old paths to new paths
const PATH_MAPPINGS = {
  // Files moved from root to docs/project/
  'CLEANUP_SUMMARY.md': 'project/CLEANUP_SUMMARY.md',
  'IMPLEMENTATION_SUMMARY.md': 'project/IMPLEMENTATION_SUMMARY.md',
  'INDEX.md': 'project/INDEX.md',
  'ONLINE_RESEARCH.md': 'project/ONLINE_RESEARCH.md',
  'PROJECT_SUMMARY.md': 'project/PROJECT_SUMMARY.md',
  'REQUIREMENTS.md': 'project/REQUIREMENTS.md',
  'ROADMAP.md': 'project/ROADMAP.md',
  'STRUCTURE.md': 'project/STRUCTURE.md',
  
  // Files moved from docs/ to subdirectories
  'AI_ISSUE_GENERATOR.md': 'guides/AI_ISSUE_GENERATOR.md',
  'AI_ISSUE_GENERATOR_DESIGN.md': 'project/AI_ISSUE_GENERATOR_DESIGN.md',
  'AI_ISSUE_GENERATOR_FINAL_SUMMARY.md': 'project/AI_ISSUE_GENERATOR_FINAL_SUMMARY.md',
  'AI_ISSUE_GENERATOR_SUMMARY.md': 'project/AI_ISSUE_GENERATOR_SUMMARY.md',
  'AI_ISSUE_GENERATOR_TASKS.md': 'project/AI_ISSUE_GENERATOR_TASKS.md',
  'CLI-QUICK-START.md': 'guides/CLI-QUICK-START.md',
  'CSHARP_SUPPORT.md': 'guides/CSHARP_SUPPORT.md',
  'EXAMPLE_TASK_UPDATE.md': 'guides/EXAMPLE_TASK_UPDATE.md',
  'FEASIBILITY.md': 'project/FEASIBILITY.md',
  'ISSUE_TAXONOMY.md': 'project/ISSUE_TAXONOMY.md',
  'METADATA_STANDARD.md': 'standards/METADATA_STANDARD.md',
  'MODEL_BUDGET_CONTROL.md': 'guides/MODEL_BUDGET_CONTROL.md',
  'PHASE6_APPROVAL_REQUEST.md': 'project/PHASE6_APPROVAL_REQUEST.md',
  'PHASE9_IMPLEMENTATION_SUMMARY.md': 'project/PHASE9_IMPLEMENTATION_SUMMARY.md',
  'QUICK_MODEL_GUIDE.md': 'guides/QUICK_MODEL_GUIDE.md',
  'SUPPORTING_FEATURES_AI_GENERATOR.md': 'project/SUPPORTING_FEATURES_AI_GENERATOR.md',
  'WELCOME.txt': 'guides/WELCOME.txt'
};

/**
 * Update links in a single file
 */
function updateLinksInFile(filePath, dryRun = true) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let updatedContent = content;
    let changes = 0;
    
    // Update each mapping
    Object.entries(PATH_MAPPINGS).forEach(([oldName, newPath]) => {
      const oldNameLower = oldName.toLowerCase();
      
      // Pattern 1: ](FILENAME.md)
      const pattern1 = new RegExp(`\\]\\(${oldName}\\)`, 'gi');
      const replacement1 = `](docs/${newPath})`;
      if (pattern1.test(updatedContent)) {
        updatedContent = updatedContent.replace(pattern1, replacement1);
        changes++;
      }
      
      // Pattern 2: ](./FILENAME.md)
      const pattern2 = new RegExp(`\\]\\(\\.\\/${oldName}\\)`, 'gi');
      const replacement2 = `](docs/${newPath})`;
      if (pattern2.test(updatedContent)) {
        updatedContent = updatedContent.replace(pattern2, replacement2);
        changes++;
      }
      
      // Pattern 3: ](filename.md) - lowercase
      const pattern3 = new RegExp(`\\]\\(${oldNameLower}\\)`, 'gi');
      const replacement3 = `](docs/${newPath})`;
      if (pattern3.test(updatedContent)) {
        updatedContent = updatedContent.replace(pattern3, replacement3);
        changes++;
      }
      
      // Pattern 4: ](./filename.md) - lowercase
      const pattern4 = new RegExp(`\\]\\(\\.\\/${oldNameLower}\\)`, 'gi');
      const replacement4 = `](docs/${newPath})`;
      if (pattern4.test(updatedContent)) {
        updatedContent = updatedContent.replace(pattern4, replacement4);
        changes++;
      }
      
      // Pattern 5: See FILENAME.md
      const pattern5 = new RegExp(`See\\s+${oldName}`, 'gi');
      const replacement5 = `See docs/${newPath}`;
      if (pattern5.test(updatedContent)) {
        updatedContent = updatedContent.replace(pattern5, replacement5);
        changes++;
      }
      
      // Pattern 6: `FILENAME.md` inline code
      const pattern6 = new RegExp(`\`${oldName}\``, 'gi');
      const replacement6 = `docs/${newPath}`;
      if (pattern6.test(updatedContent)) {
        updatedContent = updatedContent.replace(pattern6, replacement6);
        changes++;
      }
    });
    
    // Also update references to interface and API docs
    const interfacePatterns = [
      { old: ']\(interfaces/', new: '](docs/interfaces/' },
      { old: ']\(api/', new: '](docs/api/' },
      { old: ']\(docs/interfaces/', new: '](docs/interfaces/' }, // Already correct
      { old: ']\(docs/api/', new: '](docs/api/' } // Already correct
    ];
    
    interfacePatterns.forEach(({ old, new: newPattern }) => {
      const pattern = new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      if (pattern.test(updatedContent)) {
        updatedContent = updatedContent.replace(pattern, newPattern);
        changes++;
      }
    });
    
    if (!dryRun && changes > 0 && content !== updatedContent) {
      fs.writeFileSync(filePath, updatedContent);
    }
    
    return {
      success: true,
      filePath,
      changes,
      changed: content !== updatedContent,
      dryRun
    };
  } catch (error) {
    return {
      success: false,
      filePath,
      error: error.message,
      dryRun
    };
  }
}

/**
 * Scan for documentation files
 */
function scanForFiles(dirPath) {
  const files = [];
  
  function scan(currentPath) {
    const items = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);
      
      if (item.isDirectory()) {
        // Skip certain directories
        if (!item.name.startsWith('.') && 
            item.name !== 'node_modules' &&
            item.name !== '.git' &&
            item.name !== 'dist' &&
            item.name !== 'build') {
          scan(fullPath);
        }
      } else if (item.name.endsWith('.md') || item.name.endsWith('.txt')) {
        files.push(fullPath);
      }
    }
  }
  
  scan(dirPath);
  return files;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const specificFile = args.find(arg => !arg.startsWith('-') && (arg.endsWith('.md') || arg.endsWith('.txt')));
  
  console.log('=== Documentation Link Update Tool ===\n');
  console.log(`Mode: ${dryRun ? 'Dry Run (no changes will be made)' : 'Live (changes will be applied)'}\n`);
  
  const workspaceRoot = process.cwd();
  
  if (specificFile) {
    // Update specific file
    const result = updateLinksInFile(specificFile, dryRun);
    
    if (result.success) {
      console.log(`File: ${path.basename(result.filePath)}`);
      console.log(`Changes: ${result.changes} link patterns updated`);
      console.log(`Modified: ${result.changed ? 'Yes' : 'No (no changes needed)'}`);
      
      if (dryRun && result.changed) {
        console.log('\nNote: This was a dry run. Use --dry-run=false to apply changes.');
      }
    } else {
      console.log(`Error processing ${specificFile}: ${result.error}`);
    }
  } else {
    // Update all documentation files
    const files = scanForFiles(workspaceRoot);
    console.log(`Found ${files.length} documentation files\n`);
    
    const results = [];
    for (const file of files) {
      // Skip files in .git, node_modules, etc.
      if (!file.includes('.git') && !file.includes('node_modules')) {
        const result = updateLinksInFile(file, dryRun);
        results.push(result);
        
        if (result.success && result.changed) {
          console.log(`✓ ${path.relative(workspaceRoot, file)}: ${result.changes} links updated`);
        }
      }
    }
    
    const changedFiles = results.filter(r => r.success && r.changed).length;
    const unchangedFiles = results.filter(r => r.success && !r.changed).length;
    const failedFiles = results.filter(r => !r.success).length;
    
    console.log(`\n=== Summary ===`);
    console.log(`Changed: ${changedFiles} files`);
    console.log(`Unchanged: ${unchangedFiles} files`);
    console.log(`Failed: ${failedFiles} files`);
    console.log(`Total: ${results.length} files`);
    
    if (dryRun && changedFiles > 0) {
      console.log('\nNote: This was a dry run. Use --dry-run=false to apply changes.');
    }
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  updateLinksInFile,
  scanForFiles,
  PATH_MAPPINGS
};
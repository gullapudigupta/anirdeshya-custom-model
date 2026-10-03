#!/usr/bin/env node
/**
 * Documentation Reorganization Script for P9-T004
 * 
 * Moves documentation files from root to docs/ subdirectories
 * and updates references and links.
 */

const fs = require('fs');
const path = require('path');

// Mapping of source files to destination categories
const DOCUMENTATION_MAP = {
  // Project documentation
  'PROJECT_SUMMARY.md': { dest: 'project/', category: 'project-summary' },
  'REQUIREMENTS.md': { dest: 'project/', category: 'requirements' },
  'ROADMAP.md': { dest: 'project/', category: 'roadmap' },
  'STRUCTURE.md': { dest: 'project/', category: 'structure' },
  'INDEX.md': { dest: 'project/', category: 'index' },
  
  // Implementation documentation
  'IMPLEMENTATION_SUMMARY.md': { dest: 'project/', category: 'implementation' },
  'CLEANUP_SUMMARY.md': { dest: 'project/', category: 'cleanup' },
  
  // Research documentation
  'ONLINE_RESEARCH.md': { dest: 'project/', category: 'research' },
  
  // Standards documentation
  'METADATA_STANDARD.md': { dest: 'standards/', category: 'metadata-standard' },
  
  // Guides (some files might already be in docs/)
  'CLI-QUICK-START.md': { dest: 'guides/', category: 'cli-quick-start' },
  'CSHARP_SUPPORT.md': { dest: 'guides/', category: 'csharp-support' },
  
  // AI documentation (already in docs/, might need reorganization)
  'AI_ISSUE_GENERATOR.md': { dest: 'guides/', category: 'ai-issue-generator' },
  'AI_ISSUE_GENERATOR_DESIGN.md': { dest: 'project/', category: 'ai-design' },
  'AI_ISSUE_GENERATOR_FINAL_SUMMARY.md': { dest: 'project/', category: 'ai-final-summary' },
  'AI_ISSUE_GENERATOR_SUMMARY.md': { dest: 'project/', category: 'ai-summary' },
  'AI_ISSUE_GENERATOR_TASKS.md': { dest: 'project/', category: 'ai-tasks' },
  
  // Other docs files
  'FEASIBILITY.md': { dest: 'project/', category: 'feasibility' },
  'ISSUE_TAXONOMY.md': { dest: 'project/', category: 'issue-taxonomy' },
  'EXAMPLE_TASK_UPDATE.md': { dest: 'guides/', category: 'task-example' },
  'MODEL_BUDGET_CONTROL.md': { dest: 'guides/', category: 'model-budget' },
  'QUICK_MODEL_GUIDE.md': { dest: 'guides/', category: 'model-guide' },
  'SUPPORTING_FEATURES_AI_GENERATOR.md': { dest: 'project/', category: 'ai-features' },
  'PHASE6_APPROVAL_REQUEST.md': { dest: 'project/', category: 'phase-approval' },
  'PHASE9_IMPLEMENTATION_SUMMARY.md': { dest: 'project/', category: 'phase9-summary' },
  
  // Welcome/Introduction
  'WELCOME.txt': { dest: 'guides/', category: 'welcome' }
};

// Files to keep at root (per P9-T004 requirements)
const KEEP_AT_ROOT = ['README.md', 'QUICKSTART.md'];

// Link update patterns
const LINK_PATTERNS = [
  { pattern: /\]\(([^)]+\.md)\)/g, description: 'Markdown links' },
  { pattern: /\]\(\.\/([^)]+\.md)\)/g, description: 'Relative Markdown links' },
  { pattern: /See\s+([A-Z_]+\.md)/gi, description: 'See references' },
  { pattern: /`([A-Z_]+\.md)`/g, description: 'Inline code references' }
];

/**
 * Move a documentation file with link updates
 * @param {string} sourceFile - Source file path
 * @param {string} destDir - Destination directory
 * @param {boolean} dryRun - If true, only show what would be done
 */
function moveDocumentationFile(sourceFile, destDir, dryRun = true) {
  const fileName = path.basename(sourceFile);
  const destPath = path.join(destDir, fileName);
  
  try {
    // Read source file
    const content = fs.readFileSync(sourceFile, 'utf8');
    
    // Update links in content
    let updatedContent = content;
    const movedFiles = Object.keys(DOCUMENTATION_MAP);
    
    movedFiles.forEach(movedFile => {
      if (movedFile !== fileName) {
        const destInfo = DOCUMENTATION_MAP[movedFile];
        if (destInfo) {
          const newPath = path.posix.join(destInfo.dest, movedFile);
          const oldPatterns = [
            `](${movedFile})`,
            `](./${movedFile})`,
            `](${movedFile.toLowerCase()})`,
            `](./${movedFile.toLowerCase()})`
          ];
          
          oldPatterns.forEach(pattern => {
            updatedContent = updatedContent.replace(
              new RegExp(pattern, 'g'),
              `](${newPath})`
            );
          });
        }
      }
    });
    
    // Update references to moved file from other files
    if (!dryRun) {
      // Write updated content to destination
      fs.writeFileSync(destPath, updatedContent);
      
      // Remove source file (if not in keep list)
      if (!KEEP_AT_ROOT.includes(fileName)) {
        fs.unlinkSync(sourceFile);
      }
    }
    
    return {
      success: true,
      source: sourceFile,
      destination: destPath,
      dryRun,
      contentChanged: content !== updatedContent,
      linksUpdated: content !== updatedContent ? 'Yes' : 'No'
    };
  } catch (error) {
    return {
      success: false,
      source: sourceFile,
      error: error.message,
      dryRun
    };
  }
}

/**
 * Scan for documentation files in a directory
 * @param {string} dirPath - Directory to scan
 * @returns {Array} List of documentation files
 */
function scanDocumentationFiles(dirPath) {
  const files = [];
  
  function scan(currentPath) {
    const items = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);
      
      if (item.isDirectory()) {
        // Skip certain directories
        if (!item.name.startsWith('.') && 
            item.name !== 'node_modules' && 
            item.name !== 'src' &&
            item.name !== 'bin' &&
            item.name !== 'test' &&
            item.name !== 'tests' &&
            item.name !== 'examples' &&
            item.name !== 'scripts' &&
            item.name !== 'tasks') {
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
 * Create documentation index file
 * @param {string} docsDir - docs directory path
 * @param {boolean} dryRun - If true, only show what would be created
 */
function createDocumentationIndex(docsDir, dryRun = true) {
  const indexContent = `# Documentation Index

Welcome to the Advanced Quality Tool documentation. This index provides organized access to all documentation resources.

## Documentation Structure

### 📁 Project Documentation
Project overview, requirements, planning, and summaries.

- [Project Summary](project/PROJECT_SUMMARY.md) - Overview of project creation and status
- [Requirements](project/REQUIREMENTS.md) - Detailed requirements and specifications  
- [Roadmap](project/ROADMAP.md) - Development timeline and phase breakdown
- [Project Structure](project/STRUCTURE.md) - Directory structure and organization
- [Implementation Summary](project/IMPLEMENTATION_SUMMARY.md) - Implementation progress
- [Cleanup Summary](project/CLEANUP_SUMMARY.md) - Duplicate file cleanup report
- [Online Research](project/ONLINE_RESEARCH.md) - Research findings and analysis
- [Feasibility Analysis](project/FEASIBILITY.md) - Technical and financial feasibility
- [Issue Taxonomy](project/ISSUE_TAXONOMY.md) - Complete issue type catalog

### 📁 AI Features Documentation
AI-powered issue resolution and generation systems.

- [AI Issue Generator](guides/AI_ISSUE_GENERATOR.md) - Main AI issue resolution system
- [AI Issue Generator Design](project/AI_ISSUE_GENERATOR_DESIGN.md) - Architecture and design
- [AI Issue Generator Summary](project/AI_ISSUE_GENERATOR_SUMMARY.md) - Implementation summary
- [AI Features Documentation](project/SUPPORTING_FEATURES_AI_GENERATOR.md) - Supporting AI features

### 📁 Guides and Tutorials
How-to guides, quick starts, and usage instructions.

- [CLI Quick Start](guides/CLI-QUICK-START.md) - Command-line interface quick start
- [C# Support Guide](guides/CSHARP_SUPPORT.md) - C# language support information
- [Model Budget Control](guides/MODEL_BUDGET_CONTROL.md) - AI model cost control
- [Quick Model Guide](guides/QUICK_MODEL_GUIDE.md) - AI model selection guide
- [Task Update Example](guides/EXAMPLE_TASK_UPDATE.md) - Example task update workflow
- [Welcome Guide](guides/WELCOME.txt) - Introduction to the tool

### 📁 Interface Documentation
Interface-specific documentation for different access methods.

- [CLI Interface](interfaces/CLI.md) - Command-line interface reference
- [API Interface](interfaces/API.md) - Application programming interface
- [MCP Interface](interfaces/MCP.md) - Model Context Protocol server
- [Orchestration Interface](interfaces/ORCHESTRATION.md) - Orchestration tool integration
- [Shared Configuration](interfaces/SHARED-CONFIG.md) - Shared configuration system
- [AI Generator API](api/AI_GENERATOR_API.md) - AI generator API reference

### 📁 Standards and Conventions
Documentation standards and project conventions.

- [Metadata Standard](standards/METADATA_STANDARD.md) - Documentation metadata format

### 📁 Phase Documentation
Phase-specific implementation details.

- [Phase 6 Approval](project/PHASE6_APPROVAL_REQUEST.md) - Phase 6 approval request
- [Phase 9 Implementation](project/PHASE9_IMPLEMENTATION_SUMMARY.md) - Phase 9 implementation summary

## Root Documentation

The following documentation remains at the repository root for quick access:

- [README.md](../README.md) - Main project README
- [QUICKSTART.md](../QUICKSTART.md) - Getting started guide

## How to Use This Documentation

1. **New Users**: Start with [QUICKSTART.md](../QUICKSTART.md) and [CLI Quick Start](guides/CLI-QUICK-START.md)
2. **Developers**: Review [Project Structure](project/STRUCTURE.md) and [Requirements](project/REQUIREMENTS.md)
3. **Contributors**: See [Roadmap](project/ROADMAP.md) and [Issue Taxonomy](project/ISSUE_TAXONOMY.md)
4. **AI Feature Users**: Read [AI Issue Generator](guides/AI_ISSUE_GENERATOR.md) and [Model Budget Control](guides/MODEL_BUDGET_CONTROL.md)

## Documentation Standards

All documentation follows the [Metadata Standard](standards/METADATA_STANDARD.md) for consistent formatting and metadata.

---

*Last Updated: ${new Date().toISOString().split('T')[0]}*
*Maintained by: Documentation Team*
`;

  const indexPath = path.join(docsDir, 'README.md');
  
  if (!dryRun) {
    fs.writeFileSync(indexPath, indexContent);
  }
  
  return {
    success: true,
    file: indexPath,
    dryRun,
    contentPreview: indexContent.substring(0, 200) + '...'
  };
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const applyAll = args.includes('--all') || args.includes('-a');
  const createIndex = args.includes('--create-index') || args.includes('-i');
  
  console.log('=== Documentation Reorganization Tool (P9-T004) ===\n');
  console.log(`Mode: ${dryRun ? 'Dry Run (no changes will be made)' : 'Live (changes will be applied)'}\n`);
  
  const workspaceRoot = process.cwd();
  const docsDir = path.join(workspaceRoot, 'docs');
  
  if (createIndex) {
    console.log('Creating documentation index...\n');
    const result = createDocumentationIndex(docsDir, dryRun);
    
    if (result.success) {
      console.log(`✓ ${dryRun ? 'Would create' : 'Created'} documentation index at ${result.file}`);
      console.log(`Preview: ${result.contentPreview}\n`);
    }
    
    if (dryRun) {
      console.log('Note: Use --dry-run=false to actually create the index file.');
    }
    return;
  }
  
  if (applyAll) {
    console.log('Reorganizing all documentation files...\n');
    
    // First, move files already in docs/ that need reorganization
    const existingDocsFiles = scanDocumentationFiles(docsDir);
    const results = [];
    
    console.log('Phase 1: Reorganizing existing docs/ files...');
    for (const file of existingDocsFiles) {
      const fileName = path.basename(file);
      if (DOCUMENTATION_MAP[fileName] && !file.includes('/interfaces/') && !file.includes('/api/')) {
        const destInfo = DOCUMENTATION_MAP[fileName];
        const destDir = path.join(docsDir, destInfo.dest);
        const destPath = path.join(destDir, fileName);
        
        // Only move if not already in correct location
        if (!file.startsWith(destDir)) {
          const result = moveDocumentationFile(file, destDir, dryRun);
          results.push(result);
          
          if (result.success) {
            console.log(`✓ ${fileName}: ${dryRun ? 'Would move' : 'Moved'} to ${destInfo.dest}`);
          } else {
            console.log(`✗ ${fileName}: ERROR - ${result.error}`);
          }
        }
      }
    }
    
    // Second, move files from root
    console.log('\nPhase 2: Moving documentation from root to docs/...');
    const rootFiles = scanDocumentationFiles(workspaceRoot);
    
    for (const file of rootFiles) {
      const fileName = path.basename(file);
      
      // Skip files to keep at root
      if (KEEP_AT_ROOT.includes(fileName)) {
        continue;
      }
      
      // Only process files in our map
      if (DOCUMENTATION_MAP[fileName]) {
        const destInfo = DOCUMENTATION_MAP[fileName];
        const destDir = path.join(docsDir, destInfo.dest);
        
        const result = moveDocumentationFile(file, destDir, dryRun);
        results.push(result);
        
        if (result.success) {
          const action = dryRun ? 'Would move' : 'Moved';
          console.log(`✓ ${fileName}: ${action} to ${destInfo.dest} (links updated: ${result.linksUpdated})`);
        } else {
          console.log(`✗ ${fileName}: ERROR - ${result.error}`);
        }
      }
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`\n=== Summary ===`);
    console.log(`Successful: ${successful} files`);
    console.log(`Failed: ${failed} files`);
    console.log(`Total processed: ${results.length} files`);
    
    if (dryRun) {
      console.log('\nNote: This was a dry run. Use --dry-run=false to apply changes.');
      console.log('Use --create-index to create documentation index after reorganization.');
    } else {
      console.log('\nCreating documentation index...');
      const indexResult = createDocumentationIndex(docsDir, false);
      if (indexResult.success) {
        console.log(`✓ Created documentation index at ${indexResult.file}`);
      }
    }
  } else {
    // Show help
    console.log('Usage:');
    console.log('  node scripts/reorganize-docs.js [options]');
    console.log('\nOptions:');
    console.log('  --dry-run, -d        Show what would be changed without making changes (default)');
    console.log('  --all, -a           Reorganize all documentation files');
    console.log('  --create-index, -i  Create documentation index in docs/');
    console.log('\nExamples:');
    console.log('  node scripts/reorganize-docs.js --dry-run --all');
    console.log('  node scripts/reorganize-docs.js --all --dry-run=false');
    console.log('  node scripts/reorganize-docs.js --create-index');
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  moveDocumentationFile,
  createDocumentationIndex,
  scanDocumentationFiles,
  DOCUMENTATION_MAP,
  KEEP_AT_ROOT
};
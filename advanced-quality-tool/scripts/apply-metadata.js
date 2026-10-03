#!/usr/bin/env node
/**
 * Metadata Application Script for P9-T002
 * 
 * Applies metadata summary blocks to documentation files based on analysis
 * of file content and existing metadata.
 */

const fs = require('fs');
const path = require('path');

/**
 * Analyze a documentation file to extract metadata
 * @param {string} filePath - Path to documentation file
 * @returns {object} Extracted metadata
 */
function analyzeDocument(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  // Extract basic information
  const fileName = path.basename(filePath);
  const fileStats = fs.statSync(filePath);
  
  // Parse existing metadata if present
  let existingMetadata = {};
  let inMetadataBlock = false;
  let metadataLines = [];
  
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const line = lines[i];
    
    if (line.includes('<!-- METADATA')) {
      inMetadataBlock = true;
      continue;
    }
    
    if (inMetadataBlock && line.includes('-->')) {
      break;
    }
    
    if (inMetadataBlock) {
      metadataLines.push(line);
    }
  }
  
  // Parse metadata lines
  metadataLines.forEach(line => {
    const match = line.match(/^\s*([^:]+):\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      existingMetadata[key] = value;
    }
  });
  
  // Analyze document content for metadata hints
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : fileName.replace('.md', '').replace(/_/g, ' ');
  
  // Determine document type and purpose based on content
  let purpose = existingMetadata.Purpose || '';
  let scope = existingMetadata.Scope || '';
  let audience = existingMetadata.Audience || '';
  let status = existingMetadata.Status || 'ACTIVE';
  let phase = existingMetadata.Phase || '';
  let task = existingMetadata.Task || '';
  
  // Infer metadata from content analysis
  if (!purpose) {
    if (content.includes('CLI') && content.includes('command')) {
      purpose = 'Document CLI interface and commands';
    } else if (content.includes('API') || content.includes('endpoint')) {
      purpose = 'Document API interface and usage';
    } else if (content.includes('AI') && content.includes('generator')) {
      purpose = 'Document AI-powered issue resolution system';
    } else if (content.includes('install') || content.includes('setup')) {
      purpose = 'Provide installation and setup instructions';
    } else if (content.includes('architecture') || content.includes('design')) {
      purpose = 'Document system architecture and design';
    } else {
      purpose = 'Documentation file';
    }
  }
  
  if (!scope) {
    const lines = content.split('\n').slice(0, 20).join('\n');
    if (lines.includes('##')) {
      scope = 'Covers multiple topics as indicated by section headings';
    } else {
      scope = 'General documentation';
    }
  }
  
  if (!audience) {
    if (content.includes('developer') || content.includes('contributor')) {
      audience = 'Developers and contributors';
    } else if (content.includes('user') || content.includes('usage')) {
      audience = 'Tool users and integrators';
    } else if (content.includes('maintainer') || content.includes('admin')) {
      audience = 'Project maintainers and administrators';
    } else {
      audience = 'General audience';
    }
  }
  
  // Infer phase from file path or content
  if (!phase) {
    if (filePath.includes('phase')) {
      const phaseMatch = filePath.match(/phase(\d+)/);
      if (phaseMatch) {
        phase = `phase${phaseMatch[1]}`;
      }
    } else if (content.includes('Phase')) {
      const phaseMatch = content.match(/Phase\s+(\d+)/i);
      if (phaseMatch) {
        phase = `phase${phaseMatch[1]}`;
      }
    }
  }
  
  // Infer status from file location
  if (filePath.includes('archive') || filePath.includes('completed')) {
    status = 'COMPLETED';
  }
  
  return {
    filePath,
    fileName,
    title,
    existingMetadata,
    inferredMetadata: {
      Purpose: purpose,
      Scope: scope,
      Audience: audience,
      Status: status,
      Created: existingMetadata.Created || fileStats.birthtime.toISOString().split('T')[0],
      LastUpdated: existingMetadata.LastUpdated || fileStats.mtime.toISOString().split('T')[0],
      Owner: existingMetadata.Owner || 'Documentation Team',
      Phase: phase,
      Task: task,
      Dependencies: existingMetadata.Dependencies || ''
    }
  };
}

/**
 * Generate metadata block from metadata object
 * @param {object} metadata - Metadata object
 * @returns {string} Formatted metadata block
 */
function generateMetadataBlock(metadata) {
  const fields = [
    `Purpose: ${metadata.Purpose}`,
    `Scope: ${metadata.Scope}`,
    `Audience: ${metadata.Audience}`,
    `Status: ${metadata.Status}`,
    `Created: ${metadata.Created}`,
    `Last Updated: ${metadata.LastUpdated}`
  ];
  
  if (metadata.Owner) {
    fields.push(`Owner: ${metadata.Owner}`);
  }
  
  if (metadata.Phase) {
    fields.push(`Phase: ${metadata.Phase}`);
  }
  
  if (metadata.Task) {
    fields.push(`Task: ${metadata.Task}`);
  }
  
  if (metadata.Dependencies) {
    fields.push(`Dependencies: ${metadata.Dependencies}`);
  }
  
  return `<!-- METADATA\n${fields.join('\n')}\n-->\n\n`;
}

/**
 * Apply metadata block to a documentation file
 * @param {string} filePath - Path to documentation file
 * @param {boolean} dryRun - If true, only show what would be changed
 * @returns {object} Application result
 */
function applyMetadataToFile(filePath, dryRun = true) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const analysis = analyzeDocument(filePath);
    
    // Check if metadata block already exists
    const hasMetadataBlock = content.includes('<!-- METADATA');
    
    // Generate new content
    let newContent;
    let action;
    
    if (hasMetadataBlock) {
      // Replace existing metadata block
      const lines = content.split('\n');
      let inMetadata = false;
      const newLines = [];
      
      for (const line of lines) {
        if (line.includes('<!-- METADATA')) {
          inMetadata = true;
          newLines.push(generateMetadataBlock(analysis.inferredMetadata).trim());
          continue;
        }
        
        if (inMetadata && line.includes('-->')) {
          inMetadata = false;
          continue;
        }
        
        if (!inMetadata) {
          newLines.push(line);
        }
      }
      
      newContent = newLines.join('\n');
      action = 'updated';
    } else {
      // Insert metadata block after main heading
      const lines = content.split('\n');
      const newLines = [];
      let headingProcessed = false;
      
      for (const line of lines) {
        newLines.push(line);
        
        // Insert after the first # heading
        if (!headingProcessed && line.startsWith('# ') && !line.startsWith('##')) {
          newLines.push(''); // Add blank line
          newLines.push(generateMetadataBlock(analysis.inferredMetadata).trim());
          headingProcessed = true;
        }
      }
      
      newContent = newLines.join('\n');
      action = 'added';
    }
    
    if (!dryRun) {
      fs.writeFileSync(filePath, newContent);
    }
    
    return {
      success: true,
      filePath,
      action,
      dryRun,
      metadata: analysis.inferredMetadata,
      changes: content !== newContent
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
 * Scan directory for documentation files
 * @param {string} dirPath - Directory to scan
 * @returns {Array} List of documentation files
 */
function scanForDocumentationFiles(dirPath) {
  const files = [];
  
  function scan(currentPath) {
    const items = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);
      
      if (item.isDirectory()) {
        // Skip node_modules, .git, etc.
        if (!item.name.startsWith('.') && item.name !== 'node_modules') {
          scan(fullPath);
        }
      } else if (item.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }
  
  scan(dirPath);
  return files;
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const applyAll = args.includes('--all') || args.includes('-a');
  const specificFile = args.find(arg => !arg.startsWith('-') && arg.endsWith('.md'));
  
  console.log('=== Documentation Metadata Application Tool ===\n');
  console.log(`Mode: ${dryRun ? 'Dry Run (no changes will be made)' : 'Live (changes will be applied)'}\n`);
  
  if (specificFile) {
    // Apply to specific file
    const result = applyMetadataToFile(specificFile, dryRun);
    
    if (result.success) {
      console.log(`File: ${path.basename(result.filePath)}`);
      console.log(`Action: ${result.action} metadata block`);
      console.log(`Changes: ${result.changes ? 'Yes' : 'No (already up to date)'}`);
      console.log('\nMetadata:');
      Object.entries(result.metadata).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    } else {
      console.log(`Error processing ${specificFile}: ${result.error}`);
    }
  } else if (applyAll) {
    // Apply to all documentation files
    const workspaceRoot = process.cwd();
    const docsFiles = scanForDocumentationFiles(workspaceRoot);
    
    console.log(`Found ${docsFiles.length} documentation files\n`);
    
    const results = [];
    for (const file of docsFiles) {
      const result = applyMetadataToFile(file, dryRun);
      results.push(result);
      
      if (result.success && result.changes) {
        console.log(`✓ ${path.basename(file)}: ${result.action} metadata`);
      } else if (!result.success) {
        console.log(`✗ ${path.basename(file)}: ERROR - ${result.error}`);
      }
    }
    
    const successful = results.filter(r => r.success && r.changes).length;
    const failed = results.filter(r => !r.success).length;
    const unchanged = results.filter(r => r.success && !r.changes).length;
    
    console.log(`\n=== Summary ===`);
    console.log(`Successful: ${successful} files`);
    console.log(`Failed: ${failed} files`);
    console.log(`Unchanged: ${unchanged} files`);
    console.log(`Total: ${docsFiles.length} files`);
    
    if (dryRun) {
      console.log('\nNote: This was a dry run. Use --dry-run=false to apply changes.');
    }
  } else {
    // Show help
    console.log('Usage:');
    console.log('  node scripts/apply-metadata.js [options] [file.md]');
    console.log('\nOptions:');
    console.log('  --dry-run, -d     Show what would be changed without making changes (default)');
    console.log('  --all, -a         Apply to all documentation files in the workspace');
    console.log('  file.md           Apply to specific documentation file');
    console.log('\nExamples:');
    console.log('  node scripts/apply-metadata.js --dry-run --all');
    console.log('  node scripts/apply-metadata.js docs/CLI-QUICK-START.md');
    console.log('  node scripts/apply-metadata.js --all --dry-run=false');
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  analyzeDocument,
  generateMetadataBlock,
  applyMetadataToFile,
  scanForDocumentationFiles
};
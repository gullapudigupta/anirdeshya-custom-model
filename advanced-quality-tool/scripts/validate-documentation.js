#!/usr/bin/env node

/**
 * Documentation Reference and Structure Validation Script
 * Task: P9-T006 - Documentation Reference and Structure Validation
 * 
 * Validates internal Markdown links, relative paths, and documentation navigation.
 * Detects remaining duplicate or unclassified documentation and reports exceptions.
 */

const fs = require('fs');
const path = require('path');

// Configuration
const ROOT_DIR = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const COMPLETED_DIR = path.join(DOCS_DIR, 'completed');

// Allowed root-level documentation files
const ALLOWED_ROOT_DOCS = ['README.md', 'QUICKSTART.md', 'CHANGELOG.md', 'LICENSE.md'];

// Expected documentation structure
const EXPECTED_STRUCTURE = {
  'docs/api': { description: 'API documentation', required: true },
  'docs/guides': { description: 'User guides', required: true },
  'docs/standards': { description: 'Documentation standards', required: true },
  'docs/project': { description: 'Project documentation', required: true },
  'docs/interfaces': { description: 'Interface documentation', required: true },
  'docs/completed': { description: 'Completed/archive documentation', required: true }
};

/**
 * Extract all links from a markdown file
 */
function extractLinks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const links = [];
  
  // Match markdown links: [text](url)
  const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = mdLinkRegex.exec(content)) !== null) {
    links.push({
      text: match[1],
      url: match[2],
      line: content.substring(0, match.index).split('\n').length,
      type: 'markdown'
    });
  }
  
  // Match HTML links: <a href="url">
  const htmlLinkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
  while ((match = htmlLinkRegex.exec(content)) !== null) {
    links.push({
      text: '',
      url: match[1],
      line: content.substring(0, match.index).split('\n').length,
      type: 'html'
    });
  }
  
  // Match image references: ![alt](src)
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  while ((match = imgRegex.exec(content)) !== null) {
    links.push({
      text: match[1],
      url: match[2],
      line: content.substring(0, match.index).split('\n').length,
      type: 'image'
    });
  }
  
  return links;
}

/**
 * Validate a link
 */
function validateLink(link, sourceFile) {
  const result = {
    link,
    sourceFile,
    valid: true,
    issues: []
  };
  
  const url = link.url;
  
  // Skip external URLs
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
    result.type = 'external';
    return result;
  }
  
  // Skip anchors
  if (url.startsWith('#')) {
    result.type = 'anchor';
    return result;
  }
  
  // Resolve relative path
  const sourceDir = path.dirname(sourceFile);
  let targetPath;
  
  if (url.startsWith('/')) {
    // Absolute path from root
    targetPath = path.join(ROOT_DIR, url);
  } else {
    // Relative path
    targetPath = path.resolve(sourceDir, url);
  }
  
  // Check if file exists
  if (!fs.existsSync(targetPath)) {
    result.valid = false;
    result.issues.push('File not found');
    result.resolvedPath = targetPath;
  } else {
    result.resolvedPath = targetPath;
    result.type = 'internal';
  }
  
  return result;
}

/**
 * Check documentation structure
 */
function checkStructure() {
  const issues = [];
  
  // Check expected directories
  for (const [dirPath, config] of Object.entries(EXPECTED_STRUCTURE)) {
    const fullPath = path.join(ROOT_DIR, dirPath);
    if (!fs.existsSync(fullPath)) {
      issues.push({
        type: 'missing-directory',
        path: dirPath,
        description: `Missing required directory: ${dirPath} (${config.description})`,
        severity: config.required ? 'error' : 'warning'
      });
    }
  }
  
  return issues;
}

/**
 * Check root-level documentation
 */
function checkRootDocumentation() {
  const issues = [];
  const rootMdFiles = fs.readdirSync(ROOT_DIR)
    .filter(f => f.endsWith('.md') && fs.statSync(path.join(ROOT_DIR, f)).isFile());
  
  for (const file of rootMdFiles) {
    if (!ALLOWED_ROOT_DOCS.includes(file)) {
      issues.push({
        type: 'root-documentation-exception',
        path: file,
        description: `Unexpected root-level documentation: ${file}. Should be in docs/ or explicitly allowed.`,
        severity: 'warning'
      });
    }
  }
  
  return issues;
}

/**
 * Check docs/completed/ placement
 */
function checkCompletedPlacement() {
  const issues = [];
  
  if (!fs.existsSync(COMPLETED_DIR)) {
    issues.push({
      type: 'missing-completed-directory',
      path: 'docs/completed',
      description: 'Missing docs/completed/ directory for archived documentation',
      severity: 'error'
    });
    return issues;
  }
  
  // Check for completed/historical content in active directories
  const activeDirs = ['docs/guides', 'docs/project', 'docs/api', 'docs/interfaces'];
  
  for (const dir of activeDirs) {
    const fullDir = path.join(ROOT_DIR, dir);
    if (!fs.existsSync(fullDir)) continue;
    
    const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.md'));
    
    for (const file of files) {
      const filePath = path.join(fullDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Check for completed/historical markers
      if (content.includes('Status: Completed') || 
          content.includes('Status: Archived') ||
          content.includes('status: completed') ||
          content.includes('status: archived')) {
        issues.push({
          type: 'completed-in-active-directory',
          path: path.join(dir, file),
          description: `Completed/archived document found in active directory: ${file}. Should be moved to docs/completed/`,
          severity: 'warning'
        });
      }
    }
  }
  
  return issues;
}

/**
 * Find all markdown files
 */
function findMarkdownFiles(dir) {
  const files = [];
  
  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;
    
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

/**
 * Main validation function
 */
function validateDocumentation() {
  console.log('=== Documentation Validation Report ===\n');
  
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalFiles: 0,
      totalLinks: 0,
      validLinks: 0,
      brokenLinks: 0,
      externalLinks: 0,
      anchorLinks: 0,
      structureIssues: 0,
      placementIssues: 0
    },
    brokenLinks: [],
    structureIssues: [],
    placementIssues: [],
    files: []
  };
  
  // Check structure
  console.log('Checking documentation structure...');
  report.structureIssues = checkStructure();
  report.summary.structureIssues = report.structureIssues.length;
  
  // Check root documentation
  console.log('Checking root-level documentation...');
  report.placementIssues.push(...checkRootDocumentation());
  
  // Check completed placement
  console.log('Checking completed documentation placement...');
  report.placementIssues.push(...checkCompletedPlacement());
  report.summary.placementIssues = report.placementIssues.length;
  
  // Validate links in all markdown files
  console.log('Validating links in documentation files...');
  const mdFiles = findMarkdownFiles(ROOT_DIR)
    .filter(f => !f.includes('node_modules') && !f.includes('.git'));
  
  report.summary.totalFiles = mdFiles.length;
  
  for (const file of mdFiles) {
    const links = extractLinks(file);
    const fileResult = {
      path: path.relative(ROOT_DIR, file),
      totalLinks: links.length,
      validLinks: 0,
      brokenLinks: 0,
      issues: []
    };
    
    for (const link of links) {
      report.summary.totalLinks++;
      const validation = validateLink(link, file);
      
      if (validation.type === 'external') {
        report.summary.externalLinks++;
      } else if (validation.type === 'anchor') {
        report.summary.anchorLinks++;
      }
      
      if (validation.valid) {
        report.summary.validLinks++;
        fileResult.validLinks++;
      } else {
        report.summary.brokenLinks++;
        fileResult.brokenLinks++;
        report.brokenLinks.push({
          file: path.relative(ROOT_DIR, file),
          link: link.url,
          text: link.text,
          line: link.line,
          issues: validation.issues,
          resolvedPath: path.relative(ROOT_DIR, validation.resolvedPath)
        });
        fileResult.issues.push({
          link: link.url,
          line: link.line,
          issues: validation.issues
        });
      }
    }
    
    report.files.push(fileResult);
  }
  
  // Output summary
  console.log('\n=== Summary ===');
  console.log(`Total files checked: ${report.summary.totalFiles}`);
  console.log(`Total links found: ${report.summary.totalLinks}`);
  console.log(`Valid internal links: ${report.summary.validLinks}`);
  console.log(`Broken links: ${report.summary.brokenLinks}`);
  console.log(`External links: ${report.summary.externalLinks}`);
  console.log(`Anchor links: ${report.summary.anchorLinks}`);
  console.log(`Structure issues: ${report.summary.structureIssues}`);
  console.log(`Placement issues: ${report.summary.placementIssues}`);
  
  // Output broken links
  if (report.brokenLinks.length > 0) {
    console.log('\n=== Broken Links ===');
    report.brokenLinks.forEach((bl, i) => {
      console.log(`\n${i + 1}. ${bl.file}:${bl.line}`);
      console.log(`   Link: ${bl.link}`);
      console.log(`   Text: ${bl.text}`);
      console.log(`   Issues: ${bl.issues.join(', ')}`);
    });
  }
  
  // Output structure issues
  if (report.structureIssues.length > 0) {
    console.log('\n=== Structure Issues ===');
    report.structureIssues.forEach((issue, i) => {
      console.log(`${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`);
    });
  }
  
  // Output placement issues
  if (report.placementIssues.length > 0) {
    console.log('\n=== Placement Issues ===');
    report.placementIssues.forEach((issue, i) => {
      console.log(`${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`);
    });
  }
  
  // Save detailed report
  const reportPath = path.join(ROOT_DIR, '.aqt-reports', 'documentation-validation-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nDetailed report saved to: ${reportPath}`);
  
  return report;
}

// Run if executed directly
if (require.main === module) {
  const report = validateDocumentation();
  process.exit(report.summary.brokenLinks > 0 || report.summary.structureIssues > 0 ? 1 : 0);
}

module.exports = { validateDocumentation, extractLinks, validateLink, checkStructure };

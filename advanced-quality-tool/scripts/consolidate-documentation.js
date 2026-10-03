#!/usr/bin/env node

/**
 * Documentation Consolidation Script
 * Task: P9-T003 - Redundant Documentation Consolidation
 * 
 * This script analyzes documentation files to identify duplicates and overlapping content,
 * then consolidates them into canonical documents.
 */

const fs = require('fs');
const path = require('path');

// Configuration
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const ROOT_DIR = path.join(__dirname, '..');

// Documentation groups that may have overlapping content
const DOC_GROUPS = {
  'ai-issue-generator': {
    patterns: [
      'AI_ISSUE_GENERATOR*.md',
      'SUPPORTING_FEATURES_AI_GENERATOR.md'
    ],
    canonicalLocation: 'docs/guides/AI_ISSUE_GENERATOR.md',
    description: 'AI Issue Generator documentation'
  }
};

/**
 * Extract metadata and content summary from a markdown file
 */
function analyzeDocument(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    // Extract title (first h1)
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : path.basename(filePath);
    
    // Extract metadata header if present
    const metadata = {};
    const metadataMatch = content.match(/---\n([\s\S]+?)\n---/);
    if (metadataMatch) {
      const metadataText = metadataMatch[1];
      const lines = metadataText.split('\n');
      lines.forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          metadata[key.trim()] = valueParts.join(':').trim();
        }
      });
    }
    
    // Extract headings structure
    const headings = [];
    lines.forEach(line => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        headings.push({
          level: match[1].length,
          text: match[2]
        });
      }
    });
    
    // Extract key topics (from headings and bold text)
    const topics = new Set();
    headings.forEach(h => topics.add(h.text.toLowerCase()));
    
    // Count words and sections
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    const sectionCount = headings.filter(h => h.level === 2).length;
    
    return {
      path: filePath,
      title,
      metadata,
      headings,
      topics: Array.from(topics),
      wordCount,
      sectionCount,
      relativePath: path.relative(ROOT_DIR, filePath)
    };
  } catch (error) {
    console.error(`Error analyzing ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Calculate similarity between two documents
 */
function calculateSimilarity(doc1, doc2) {
  // Jaccard similarity on topics
  const topics1 = new Set(doc1.topics);
  const topics2 = new Set(doc2.topics);
  
  const intersection = new Set([...topics1].filter(x => topics2.has(x)));
  const union = new Set([...topics1, ...topics2]);
  
  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0;
  
  // Title similarity
  const titleWords1 = new Set(doc1.title.toLowerCase().split(/\s+/));
  const titleWords2 = new Set(doc2.title.toLowerCase().split(/\s+/));
  const titleIntersection = new Set([...titleWords1].filter(x => titleWords2.has(x)));
  const titleUnion = new Set([...titleWords1, ...titleWords2]);
  const titleSimilarity = titleUnion.size > 0 ? titleIntersection.size / titleUnion.size : 0;
  
  return {
    topicSimilarity: jaccardSimilarity,
    titleSimilarity,
    overallSimilarity: (jaccardSimilarity * 0.7 + titleSimilarity * 0.3)
  };
}

/**
 * Find all markdown files in a directory
 */
function findMarkdownFiles(dir, pattern = '*.md') {
  const files = [];
  
  function walk(currentDir) {
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
 * Identify duplicate and overlapping documentation
 */
function identifyDuplicates(documents) {
  const duplicates = [];
  const analyzed = [];
  
  for (let i = 0; i < documents.length; i++) {
    for (let j = i + 1; j < documents.length; j++) {
      const doc1 = documents[i];
      const doc2 = documents[j];
      
      if (!doc1 || !doc2) continue;
      
      const similarity = calculateSimilarity(doc1, doc2);
      
      if (similarity.overallSimilarity > 0.3) {
        duplicates.push({
          doc1: doc1.relativePath,
          doc2: doc2.relativePath,
          similarity,
          recommendation: similarity.overallSimilarity > 0.6 ? 'merge' : 'review'
        });
      }
    }
  }
  
  return duplicates.sort((a, b) => b.similarity.overallSimilarity - a.similarity.overallSimilarity);
}

/**
 * Generate consolidation report
 */
function generateReport(documents, duplicates) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalDocuments: documents.filter(d => d !== null).length,
      duplicatePairs: duplicates.length,
      mergeRecommendations: duplicates.filter(d => d.recommendation === 'merge').length,
      reviewRecommendations: duplicates.filter(d => d.recommendation === 'review').length
    },
    documents: documents.filter(d => d !== null).map(d => ({
      path: d.relativePath,
      title: d.title,
      wordCount: d.wordCount,
      sectionCount: d.sectionCount,
      status: d.metadata.status || 'unknown'
    })),
    duplicates,
    recommendations: []
  };
  
  // Generate specific recommendations
  const processedDocs = new Set();
  
  duplicates.forEach(dup => {
    if (dup.recommendation === 'merge' && !processedDocs.has(dup.doc1) && !processedDocs.has(dup.doc2)) {
      report.recommendations.push({
        type: 'consolidate',
        documents: [dup.doc1, dup.doc2],
        action: `Merge ${dup.doc1} and ${dup.doc2} (${(dup.similarity.overallSimilarity * 100).toFixed(0)}% similar)`,
        priority: dup.similarity.overallSimilarity > 0.8 ? 'high' : 'medium'
      });
      processedDocs.add(dup.doc1);
      processedDocs.add(dup.doc2);
    }
  });
  
  return report;
}

/**
 * Main execution
 */
function main() {
  console.log('=== Documentation Consolidation Analysis ===\n');
  
  // Find all markdown files
  const docsFiles = findMarkdownFiles(DOCS_DIR);
  const rootFiles = findMarkdownFiles(ROOT_DIR).filter(f => 
    !f.includes('node_modules') && 
    !f.includes('.git') &&
    path.dirname(f) === ROOT_DIR
  );
  
  const allFiles = [...docsFiles, ...rootFiles];
  
  console.log(`Found ${allFiles.length} documentation files\n`);
  
  // Analyze each document
  const documents = allFiles.map(analyzeDocument);
  
  // Identify duplicates
  const duplicates = identifyDuplicates(documents);
  
  // Generate report
  const report = generateReport(documents, duplicates);
  
  // Output report
  console.log('=== Summary ===');
  console.log(`Total documents: ${report.summary.totalDocuments}`);
  console.log(`Duplicate pairs found: ${report.summary.duplicatePairs}`);
  console.log(`Merge recommendations: ${report.summary.mergeRecommendations}`);
  console.log(`Review recommendations: ${report.summary.reviewRecommendations}`);
  console.log('');
  
  if (duplicates.length > 0) {
    console.log('=== Top Duplicate Pairs ===');
    duplicates.slice(0, 10).forEach((dup, i) => {
      console.log(`\n${i + 1}. ${(dup.similarity.overallSimilarity * 100).toFixed(0)}% similar (${dup.recommendation})`);
      console.log(`   - ${dup.doc1}`);
      console.log(`   - ${dup.doc2}`);
    });
  }
  
  console.log('\n=== Recommendations ===');
  report.recommendations.forEach((rec, i) => {
    console.log(`\n${i + 1}. [${rec.priority.toUpperCase()}] ${rec.action}`);
    console.log(`   Type: ${rec.type}`);
  });
  
  // Write detailed report to file
  const reportPath = path.join(ROOT_DIR, '.aqt-reports', 'documentation-consolidation-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nDetailed report saved to: ${reportPath}`);
  
  return report;
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { analyzeDocument, calculateSimilarity, identifyDuplicates, generateReport };

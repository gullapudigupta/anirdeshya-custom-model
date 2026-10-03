/**
 * Examples and tests for Issue Categorization Engine
 */

const {
  IssueCategorizationEngine,
  IssueFilterEngine,
  IssueSortEngine
} = require('./issue-categorizer');

// Sample issues for testing
const sampleIssues = [
  {
    type: 'SEC-001',
    title: 'Hardcoded API Key',
    message: 'Found hardcoded API key in source code',
    file: 'src/services/api.service.ts',
    startLine: 15,
    severity: 'WARNING',  // Will be escalated to CRITICAL
    category: 'STYLE',    // Will be corrected to SECURITY
    source: 'internal-analyzer'
  },
  {
    type: 'BUG-001',
    title: 'Unused variable',
    message: 'Variable "count" is declared but never used',
    file: 'src/app/app.component.ts',
    startLine: 42,
    severity: 'INFO',
    category: 'BUG',
    source: 'eslint',
    rule: 'no-unused-vars'
  },
  {
    type: 'STYLE-001',
    title: 'Missing semicolon',
    message: 'Expected semicolon',
    file: 'src/utils/helpers.js',
    startLine: 8,
    severity: 'INFO',
    category: 'STYLE',
    source: 'eslint',
    rule: 'semi'
  },
  {
    type: 'CSS-001',
    title: 'Excessive !important',
    message: 'Avoid using !important',
    file: 'src/app/app.component.scss',
    startLine: 23,
    severity: 'WARNING',
    category: 'STYLE',
    source: 'stylelint'
  },
  {
    type: 'HTML-001',
    title: 'Missing alt text',
    message: 'img element must have alt attribute',
    file: 'src/app/components/header.component.html',
    startLine: 12,
    severity: 'INFO',  // Will be escalated to WARNING (accessibility)
    category: 'STYLE',
    source: 'internal-analyzer'
  }
];

/**
 * Example 1: Basic categorization
 */
function example1_basicCategorization() {
  console.log('=== Example 1: Basic Categorization ===\n');

  const engine = new IssueCategorizationEngine();

  const issue = {
    type: 'UNKNOWN',
    message: 'Found use of eval() which is a security risk',
    file: 'src/app.js',
    startLine: 10,
    severity: 'INFO',
    category: 'STYLE',
    source: 'eslint'
  };

  const categorized = engine.categorize(issue);

  console.log('Original issue:');
  console.log(`  Severity: ${issue.severity}`);
  console.log(`  Category: ${issue.category}`);
  console.log(`  File Type: ${issue.fileType || 'N/A'}`);

  console.log('\nCategorized issue:');
  console.log(`  Severity: ${categorized.severity} (escalated from INFO)`);
  console.log(`  Category: ${categorized.category} (corrected from STYLE)`);
  console.log(`  File Type: ${categorized.fileType}`);
  console.log(`  Auto-Fix Level: ${categorized.autoFixLevel}`);
  console.log(`  Tags: ${categorized.tags.join(', ')}`);

  return categorized;
}

/**
 * Example 2: Batch categorization with enrichment
 */
function example2_batchCategorization() {
  console.log('\n=== Example 2: Batch Categorization ===\n');

  const engine = new IssueCategorizationEngine({ autoEnrich: true });
  const categorized = engine.categorizeAll(sampleIssues);

  console.log(`Categorized ${categorized.length} issues:\n`);

  categorized.forEach((issue, i) => {
    console.log(`${i + 1}. ${issue.title}`);
    console.log(`   Severity: ${issue.severity} | Category: ${issue.category}`);
    console.log(`   File Type: ${issue.fileType} | Auto-Fix: ${issue.autoFixLevel}`);
    console.log(`   Tags: ${issue.tags.join(', ')}`);
    console.log('');
  });

  return categorized;
}

/**
 * Example 3: Filtering issues
 */
function example3_filtering() {
  console.log('\n=== Example 3: Filtering Issues ===\n');

  const engine = new IssueCategorizationEngine();
  const categorized = engine.categorizeAll(sampleIssues);

  // Example 3a: Filter by severity
  console.log('3a. Critical and Error issues only:');
  const filter1 = new IssueFilterEngine()
    .bySeverity('CRITICAL', 'ERROR');

  const highPriority = filter1.apply(categorized);
  console.log(`   Found ${highPriority.length} high-priority issues`);
  highPriority.forEach(i => console.log(`   - ${i.title} (${i.severity})`));

  // Example 3b: Filter by category
  console.log('\n3b. Security issues only:');
  const filter2 = new IssueFilterEngine()
    .byCategory('SECURITY');

  const securityIssues = filter2.apply(categorized);
  console.log(`   Found ${securityIssues.length} security issues`);
  securityIssues.forEach(i => console.log(`   - ${i.title}`));

  // Example 3c: Filter by file type
  console.log('\n3c. TypeScript issues only:');
  const filter3 = new IssueFilterEngine()
    .byFileType('typescript', 'angular-component', 'angular-service');

  const tsIssues = filter3.apply(categorized);
  console.log(`   Found ${tsIssues.length} TypeScript issues`);
  tsIssues.forEach(i => console.log(`   - ${i.file}`));

  // Example 3d: Filter by fixability
  console.log('\n3d. Auto-fixable issues:');
  const filter4 = new IssueFilterEngine()
    .byFixable(true);

  const fixable = filter4.apply(categorized);
  console.log(`   Found ${fixable.length} auto-fixable issues`);
  fixable.forEach(i => console.log(`   - ${i.title} (${i.autoFixLevel})`));

  // Example 3e: Combined filters
  console.log('\n3e. High-priority, fixable, security issues:');
  const filter5 = new IssueFilterEngine()
    .bySeverity('CRITICAL', 'ERROR')
    .byCategory('SECURITY')
    .byFixable(true);

  const combined = filter5.apply(categorized);
  console.log(`   Found ${combined.length} matching issues`);
  combined.forEach(i => console.log(`   - ${i.title}`));

  // Example 3f: File pattern filter
  console.log('\n3f. Issues in component files only:');
  const filter6 = new IssueFilterEngine()
    .byFilePattern(/\.component\.(ts|html|scss)$/);

  const componentIssues = filter6.apply(categorized);
  console.log(`   Found ${componentIssues.length} component issues`);
  componentIssues.forEach(i => console.log(`   - ${i.file}`));
}

/**
 * Example 4: Sorting issues
 */
function example4_sorting() {
  console.log('\n=== Example 4: Sorting Issues ===\n');

  const engine = new IssueCategorizationEngine();
  const categorized = engine.categorizeAll(sampleIssues);

  // Example 4a: Sort by priority
  console.log('4a. Sorted by priority (high to low):');
  const byPriority = IssueSortEngine.byPriority(categorized);
  byPriority.forEach((i, idx) => 
    console.log(`   ${idx + 1}. ${i.title} (Priority: ${i.priority})`)
  );

  // Example 4b: Sort by severity
  console.log('\n4b. Sorted by severity:');
  const bySeverity = IssueSortEngine.bySeverity(categorized);
  bySeverity.forEach((i, idx) => 
    console.log(`   ${idx + 1}. ${i.title} (${i.severity})`)
  );

  // Example 4c: Sort by file
  console.log('\n4c. Sorted by file:');
  const byFile = IssueSortEngine.byFile(categorized);
  byFile.forEach((i, idx) => 
    console.log(`   ${idx + 1}. ${i.file}:${i.startLine}`)
  );

  // Example 4d: Multi-level sort (severity, then file, then line)
  console.log('\n4d. Multi-level sort (severity → file → line):');
  const multiSort = IssueSortEngine.multiSort(categorized, [
    { field: 'severity', descending: false },
    { field: 'file', descending: false },
    { field: 'line', descending: false }
  ]);
  multiSort.forEach((i, idx) => 
    console.log(`   ${idx + 1}. ${i.severity} | ${i.file}:${i.startLine}`)
  );
}

/**
 * Example 5: Advanced filtering with custom logic
 */
function example5_advancedFiltering() {
  console.log('\n=== Example 5: Advanced Filtering ===\n');

  const engine = new IssueCategorizationEngine();
  const categorized = engine.categorizeAll(sampleIssues);

  // Example 5a: Custom filter - issues in src/app only
  console.log('5a. Custom filter - issues in src/app directory:');
  const appIssues = new IssueFilterEngine()
    .custom('inAppDir', issue => issue.file.startsWith('src/app'))
    .apply(categorized);

  console.log(`   Found ${appIssues.length} issues in src/app`);

  // Example 5b: Complex filter - high priority OR security
  console.log('\n5b. Complex - high priority OR security:');
  const complex = categorized.filter(issue => 
    ['CRITICAL', 'ERROR'].includes(issue.severity) || 
    issue.category === 'SECURITY'
  );
  console.log(`   Found ${complex.length} matching issues`);

  // Example 5c: Issues that need manual review
  console.log('\n5c. Issues requiring manual review:');
  const manualReview = categorized.filter(issue => 
    issue.autoFixLevel === 'MANUAL' || 
    issue.severity === 'CRITICAL'
  );
  console.log(`   Found ${manualReview.length} issues needing review`);
  manualReview.forEach(i => 
    console.log(`   - ${i.title} (${i.autoFixLevel})`)
  );
}

/**
 * Example 6: Categorization statistics
 */
function example6_statistics() {
  console.log('\n=== Example 6: Categorization Statistics ===\n');

  const engine = new IssueCategorizationEngine();
  const categorized = engine.categorizeAll(sampleIssues);

  // Count by severity
  const bySeverity = categorized.reduce((acc, i) => {
    acc[i.severity] = (acc[i.severity] || 0) + 1;
    return acc;
  }, {});

  console.log('By Severity:');
  Object.entries(bySeverity).forEach(([sev, count]) => 
    console.log(`   ${sev}: ${count}`)
  );

  // Count by category
  const byCategory = categorized.reduce((acc, i) => {
    acc[i.category] = (acc[i.category] || 0) + 1;
    return acc;
  }, {});

  console.log('\nBy Category:');
  Object.entries(byCategory).forEach(([cat, count]) => 
    console.log(`   ${cat}: ${count}`)
  );

  // Count by file type
  const byFileType = categorized.reduce((acc, i) => {
    acc[i.fileType] = (acc[i.fileType] || 0) + 1;
    return acc;
  }, {});

  console.log('\nBy File Type:');
  Object.entries(byFileType).forEach(([type, count]) => 
    console.log(`   ${type}: ${count}`)
  );

  // Count by auto-fix level
  const byFixLevel = categorized.reduce((acc, i) => {
    acc[i.autoFixLevel] = (acc[i.autoFixLevel] || 0) + 1;
    return acc;
  }, {});

  console.log('\nBy Auto-Fix Level:');
  Object.entries(byFixLevel).forEach(([level, count]) => 
    console.log(`   ${level}: ${count}`)
  );
}

/**
 * Example 7: Tag-based filtering
 */
function example7_tagFiltering() {
  console.log('\n=== Example 7: Tag-based Filtering ===\n');

  const engine = new IssueCategorizationEngine();
  const categorized = engine.categorizeAll(sampleIssues);

  // Show all tags
  console.log('All unique tags:');
  const allTags = new Set();
  categorized.forEach(i => i.tags.forEach(t => allTags.add(t)));
  console.log(`   ${Array.from(allTags).join(', ')}`);

  // Filter by tag
  console.log('\nIssues with "security-issue" tag:');
  const securityTagged = new IssueFilterEngine()
    .byTag('security-issue')
    .apply(categorized);

  console.log(`   Found ${securityTagged.length} issues`);

  console.log('\nIssues with "fixable" tag:');
  const fixableTagged = new IssueFilterEngine()
    .byTag('fixable')
    .apply(categorized);

  console.log(`   Found ${fixableTagged.length} fixable issues`);
}

// Command-line interface
if (require.main === module) {
  const examples = {
    '1': example1_basicCategorization,
    '2': example2_batchCategorization,
    '3': example3_filtering,
    '4': example4_sorting,
    '5': example5_advancedFiltering,
    '6': example6_statistics,
    '7': example7_tagFiltering,
    'all': () => {
      example1_basicCategorization();
      example2_batchCategorization();
      example3_filtering();
      example4_sorting();
      example5_advancedFiltering();
      example6_statistics();
      example7_tagFiltering();
    }
  };

  const exampleNum = process.argv[2] || 'all';
  const fn = examples[exampleNum];

  if (!fn) {
    console.error(`Unknown example: ${exampleNum}`);
    console.error(`Available: ${Object.keys(examples).join(', ')}`);
    process.exit(1);
  }

  fn();
}

module.exports = {
  example1_basicCategorization,
  example2_batchCategorization,
  example3_filtering,
  example4_sorting,
  example5_advancedFiltering,
  example6_statistics,
  example7_tagFiltering,
  sampleIssues
};

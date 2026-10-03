/**
 * Issue Normalizer
 * 
 * Utilities for converting various issue formats into our standardized format,
 * handling deduplication, and enriching issue metadata.
 */

const crypto = require('crypto');
const path = require('path');

/**
 * Normalized issue schema
 */
const ISSUE_SCHEMA = {
  id: 'string',              // SHA256 hash
  type: 'string',            // e.g., "SEC-001"
  title: 'string',
  message: 'string',
  file: 'string',            // Relative path
  startLine: 'number',
  endLine: 'number',
  startColumn: 'number',
  endColumn: 'number',
  severity: 'string',        // CRITICAL | ERROR | WARNING | INFO | SUGGESTION
  category: 'string',        // SECURITY | PERFORMANCE | etc.
  fileType: 'string',        // javascript | typescript | css | etc.
  autoFixLevel: 'string',    // AUTO | RULE | AI | MANUAL
  priority: 'number',        // 0-1000
  priorityClass: 'string',   // P0 | P1 | P2 | P3 | P4
  source: 'string',          // eslint | internal-analyzer | etc.
  rule: 'string',            // Original rule ID
  context: 'object',
  metadata: 'object',
  timestamp: 'string',       // ISO 8601
  status: 'string'           // open | fixed | ignored | false-positive
};

/**
 * Severity levels
 */
const SEVERITY_LEVELS = ['CRITICAL', 'ERROR', 'WARNING', 'INFO', 'SUGGESTION'];

/**
 * Categories
 */
const CATEGORIES = [
  'SECURITY',
  'PERFORMANCE',
  'ACCESSIBILITY',
  'BUG',
  'RELIABILITY',
  'MAINTAINABILITY',
  'STYLE',
  'DOCUMENTATION',
  'ARCHITECTURE',
  'BEST_PRACTICE'
];

/**
 * Auto-fix levels
 */
const AUTO_FIX_LEVELS = ['AUTO', 'RULE', 'AI', 'MANUAL'];

/**
 * Generate unique ID for an issue
 */
function generateIssueId(file, line, type, rule) {
  const str = `${file}:${line}:${type}:${rule}`;
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Calculate priority score
 * Priority = (Severity × 10) + (FixLevel × 5) + (Frequency × 3)
 */
function calculatePriority(severity, autoFixLevel, frequency = 1) {
  const severityScore = {
    'CRITICAL': 10,
    'ERROR': 8,
    'WARNING': 5,
    'INFO': 3,
    'SUGGESTION': 1
  }[severity] || 1;

  const fixLevelScore = {
    'AUTO': 10,
    'RULE': 8,
    'AI': 5,
    'MANUAL': 1
  }[autoFixLevel] || 1;

  return (severityScore * 10) + (fixLevelScore * 5) + (frequency * 3);
}

/**
 * Get priority class from score
 */
function getPriorityClass(score) {
  if (score >= 150) return 'P0';
  if (score >= 100) return 'P1';
  if (score >= 50) return 'P2';
  if (score >= 25) return 'P3';
  return 'P4';
}

/**
 * Validate issue object
 */
function validateIssue(issue) {
  const required = [
    'type', 'title', 'message', 'file', 'startLine',
    'severity', 'category', 'fileType', 'autoFixLevel', 'source'
  ];

  const errors = [];

  required.forEach(field => {
    if (!issue[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  });

  if (issue.severity && !SEVERITY_LEVELS.includes(issue.severity)) {
    errors.push(`Invalid severity: ${issue.severity}`);
  }

  if (issue.category && !CATEGORIES.includes(issue.category)) {
    errors.push(`Invalid category: ${issue.category}`);
  }

  if (issue.autoFixLevel && !AUTO_FIX_LEVELS.includes(issue.autoFixLevel)) {
    errors.push(`Invalid autoFixLevel: ${issue.autoFixLevel}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Normalize an issue to our standard format
 */
function normalizeIssue(rawIssue, projectRoot) {
  // Ensure all required fields have defaults
  const normalized = {
    id: rawIssue.id || generateIssueId(
      rawIssue.file,
      rawIssue.startLine,
      rawIssue.type,
      rawIssue.rule
    ),
    type: rawIssue.type || 'UNKNOWN',
    title: rawIssue.title || rawIssue.message || 'Unknown issue',
    message: rawIssue.message || rawIssue.title || 'No description',
    file: rawIssue.file,
    startLine: rawIssue.startLine || 1,
    endLine: rawIssue.endLine || rawIssue.startLine || 1,
    startColumn: rawIssue.startColumn || 1,
    endColumn: rawIssue.endColumn || rawIssue.startColumn || 1,
    severity: rawIssue.severity || 'INFO',
    category: rawIssue.category || 'STYLE',
    fileType: rawIssue.fileType || detectFileType(rawIssue.file),
    autoFixLevel: rawIssue.autoFixLevel || 'MANUAL',
    priority: rawIssue.priority || 0, // Will be calculated
    priorityClass: rawIssue.priorityClass || 'P4', // Will be calculated
    source: rawIssue.source || 'unknown',
    rule: rawIssue.rule || null,
    context: {
      code: rawIssue.context?.code || '',
      originalCode: rawIssue.context?.originalCode || '',
      suggestion: rawIssue.context?.suggestion || '',
      fixedCode: rawIssue.context?.fixedCode || null
    },
    metadata: {
      cwe: rawIssue.metadata?.cwe || null,
      owasp: rawIssue.metadata?.owasp || null,
      documentation: rawIssue.metadata?.documentation || null,
      effort: rawIssue.metadata?.effort || null,
      debt: rawIssue.metadata?.debt || null,
      ...(rawIssue.metadata || {})
    },
    timestamp: rawIssue.timestamp || new Date().toISOString(),
    status: rawIssue.status || 'open'
  };

  // Calculate priority if not provided
  if (!rawIssue.priority) {
    normalized.priority = calculatePriority(
      normalized.severity,
      normalized.autoFixLevel,
      1
    );
    normalized.priorityClass = getPriorityClass(normalized.priority);
  }

  // Validate
  const validation = validateIssue(normalized);
  if (!validation.valid) {
    console.warn(`Issue validation warnings for ${normalized.file}:${normalized.startLine}:`, validation.errors);
  }

  return normalized;
}

/**
 * Detect file type from path
 */
function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const typeMap = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'scss',
    '.less': 'less',
    '.html': 'html',
    '.vue': 'vue',
    '.json': 'json',
    '.md': 'markdown',
    '.cs': 'csharp'
  };
  return typeMap[ext] || 'unknown';
}

/**
 * Deduplicate issues
 * Issues are considered duplicates if they have the same file, line, and type
 */
function deduplicateIssues(issues) {
  const seen = new Map();
  const unique = [];
  const duplicates = [];

  issues.forEach(issue => {
    const key = `${issue.file}:${issue.startLine}:${issue.type}`;

    if (seen.has(key)) {
      // Keep the one with higher priority or more information
      const existing = seen.get(key);
      if (issue.priority > existing.priority || 
          (issue.context?.code?.length || 0) > (existing.context?.code?.length || 0)) {
        // Replace with better issue
        const index = unique.indexOf(existing);
        unique[index] = issue;
        seen.set(key, issue);
        duplicates.push(existing);
      } else {
        duplicates.push(issue);
      }
    } else {
      seen.set(key, issue);
      unique.push(issue);
    }
  });

  return {
    unique,
    duplicates,
    removedCount: duplicates.length
  };
}

/**
 * Merge issues from multiple sources
 */
function mergeIssues(...issueLists) {
  const allIssues = issueLists.flat();
  const { unique } = deduplicateIssues(allIssues);

  // Sort by priority (descending)
  unique.sort((a, b) => b.priority - a.priority);

  return unique;
}

/**
 * Group issues by various criteria
 */
function groupIssues(issues, groupBy = 'file') {
  const grouped = {};

  issues.forEach(issue => {
    let key;

    switch (groupBy) {
      case 'file':
        key = issue.file;
        break;
      case 'severity':
        key = issue.severity;
        break;
      case 'category':
        key = issue.category;
        break;
      case 'fileType':
        key = issue.fileType;
        break;
      case 'source':
        key = issue.source;
        break;
      case 'priorityClass':
        key = issue.priorityClass;
        break;
      default:
        key = 'other';
    }

    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(issue);
  });

  return grouped;
}

/**
 * Filter issues by criteria
 */
function filterIssues(issues, criteria = {}) {
  return issues.filter(issue => {
    // Filter by severity
    if (criteria.severity && !criteria.severity.includes(issue.severity)) {
      return false;
    }

    // Filter by category
    if (criteria.category && !criteria.category.includes(issue.category)) {
      return false;
    }

    // Filter by file pattern
    if (criteria.filePattern) {
      const regex = new RegExp(criteria.filePattern);
      if (!regex.test(issue.file)) {
        return false;
      }
    }

    // Filter by fixable
    if (criteria.fixable === true) {
      if (issue.autoFixLevel !== 'AUTO' && issue.autoFixLevel !== 'RULE') {
        return false;
      }
    }

    // Filter by priority class
    if (criteria.priorityClass && !criteria.priorityClass.includes(issue.priorityClass)) {
      return false;
    }

    // Filter by source
    if (criteria.source && !criteria.source.includes(issue.source)) {
      return false;
    }

    return true;
  });
}

/**
 * Get statistics from issues
 */
function getIssueStats(issues) {
  const stats = {
    total: issues.length,
    bySeverity: {},
    byCategory: {},
    byFileType: {},
    byPriorityClass: {},
    bySource: {},
    fixable: 0,
    critical: 0
  };

  SEVERITY_LEVELS.forEach(level => stats.bySeverity[level] = 0);
  CATEGORIES.forEach(cat => stats.byCategory[cat] = 0);

  issues.forEach(issue => {
    // Count by severity
    stats.bySeverity[issue.severity]++;

    // Count by category
    stats.byCategory[issue.category]++;

    // Count by file type
    stats.byFileType[issue.fileType] = (stats.byFileType[issue.fileType] || 0) + 1;

    // Count by priority class
    stats.byPriorityClass[issue.priorityClass] = (stats.byPriorityClass[issue.priorityClass] || 0) + 1;

    // Count by source
    stats.bySource[issue.source] = (stats.bySource[issue.source] || 0) + 1;

    // Count fixable
    if (issue.autoFixLevel === 'AUTO' || issue.autoFixLevel === 'RULE') {
      stats.fixable++;
    }

    // Count critical
    if (issue.severity === 'CRITICAL') {
      stats.critical++;
    }
  });

  return stats;
}

/**
 * Convert issues to various output formats
 */
function exportIssues(issues, format = 'json') {
  switch (format.toLowerCase()) {
    case 'json':
      return JSON.stringify(issues, null, 2);

    case 'csv':
      const headers = ['File', 'Line', 'Severity', 'Category', 'Type', 'Message'];
      const rows = issues.map(i => [
        i.file,
        i.startLine,
        i.severity,
        i.category,
        i.type,
        i.message.replace(/"/g, '""')
      ]);
      return [
        headers.join(','),
        ...rows.map(r => r.map(c => `"${c}"`).join(','))
      ].join('\n');

    case 'markdown':
      let md = '# Code Quality Issues\n\n';
      md += `**Total Issues:** ${issues.length}\n\n`;

      const grouped = groupIssues(issues, 'file');
      for (const [file, fileIssues] of Object.entries(grouped)) {
        md += `## ${file}\n\n`;
        fileIssues.forEach(issue => {
          md += `- **Line ${issue.startLine}** (${issue.severity}): ${issue.message}\n`;
        });
        md += '\n';
      }
      return md;

    case 'html':
      return generateHTMLReport(issues);

    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

/**
 * Generate HTML report
 */
function generateHTMLReport(issues) {
  const stats = getIssueStats(issues);
  const grouped = groupIssues(issues, 'file');

  return `<!DOCTYPE html>
<html>
<head>
  <title>Code Quality Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .stats { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .file { margin-bottom: 30px; }
    .issue { padding: 10px; margin: 5px 0; border-left: 4px solid #ccc; }
    .CRITICAL { border-color: #d32f2f; background: #ffebee; }
    .ERROR { border-color: #f57c00; background: #fff3e0; }
    .WARNING { border-color: #fbc02d; background: #fffde7; }
    .INFO { border-color: #1976d2; background: #e3f2fd; }
  </style>
</head>
<body>
  <h1>Code Quality Report</h1>
  <div class="stats">
    <h2>Summary</h2>
    <p><strong>Total Issues:</strong> ${stats.total}</p>
    <p><strong>Critical:</strong> ${stats.bySeverity.CRITICAL} | <strong>Errors:</strong> ${stats.bySeverity.ERROR} | <strong>Warnings:</strong> ${stats.bySeverity.WARNING}</p>
    <p><strong>Auto-fixable:</strong> ${stats.fixable}</p>
  </div>
  ${Object.entries(grouped).map(([file, fileIssues]) => `
    <div class="file">
      <h2>${file}</h2>
      ${fileIssues.map(issue => `
        <div class="issue ${issue.severity}">
          <strong>Line ${issue.startLine}</strong> (${issue.severity}) - ${issue.message}
          <br><small>${issue.type} | ${issue.category}</small>
        </div>
      `).join('')}
    </div>
  `).join('')}
</body>
</html>`;
}

module.exports = {
  normalizeIssue,
  generateIssueId,
  calculatePriority,
  getPriorityClass,
  validateIssue,
  deduplicateIssues,
  mergeIssues,
  groupIssues,
  filterIssues,
  getIssueStats,
  exportIssues,
  detectFileType,
  ISSUE_SCHEMA,
  SEVERITY_LEVELS,
  CATEGORIES,
  AUTO_FIX_LEVELS
};

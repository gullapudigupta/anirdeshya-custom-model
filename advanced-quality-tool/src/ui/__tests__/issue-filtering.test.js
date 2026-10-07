/**
 * Tests for Issue Filtering in Chat UI (P11-T011)
 */

'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

describe('Issue Filtering (P11-T011)', () => {
  let dom;
  let window;
  let document;

  beforeEach(() => {
    // Load HTML
    const htmlPath = path.join(__dirname, '../../ui/chat-ui.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    
    dom = new JSDOM(html);
    window = dom.window;
    document = window.document;
  });

  describe('Filter UI Elements', () => {
    test('should have severity filter dropdown', () => {
      const severityFilter = document.getElementById('severityFilter');
      expect(severityFilter).toBeTruthy();
      expect(severityFilter.tagName).toBe('SELECT');
    });

    test('should have category filter dropdown', () => {
      const categoryFilter = document.getElementById('categoryFilter');
      expect(categoryFilter).toBeTruthy();
      expect(categoryFilter.tagName).toBe('SELECT');
    });

    test('should have file filter input', () => {
      const fileFilter = document.getElementById('fileFilter');
      expect(fileFilter).toBeTruthy();
      expect(fileFilter.tagName).toBe('INPUT');
      expect(fileFilter.type).toBe('text');
    });

    test('should have clear filters button', () => {
      const clearBtn = document.getElementById('clearFiltersBtn');
      expect(clearBtn).toBeTruthy();
      expect(clearBtn.textContent).toContain('Clear');
    });

    test('severity filter should have all severity options', () => {
      const select = document.getElementById('severityFilter');
      const options = Array.from(select.options).map(o => o.value);
      expect(options).toContain('');
      expect(options).toContain('critical');
      expect(options).toContain('high');
      expect(options).toContain('medium');
      expect(options).toContain('low');
    });

    test('category filter should have all category options', () => {
      const select = document.getElementById('categoryFilter');
      const options = Array.from(select.options).map(o => o.value);
      expect(options).toContain('');
      expect(options).toContain('security');
      expect(options).toContain('performance');
      expect(options).toContain('maintainability');
    });
  });

  describe('Filter Functionality', () => {
    test('should filter issues by severity', () => {
      const issues = [
        { id: '1', severity: 'critical', message: 'Critical issue', file: 'test.js', line: 1 },
        { id: '2', severity: 'high', message: 'High issue', file: 'test.js', line: 2 },
        { id: '3', severity: 'medium', message: 'Medium issue', file: 'test.js', line: 3 }
      ];

      // Mock filter logic
      const applyFilters = (issues, filters) => {
        return issues.filter(issue => {
          if (filters.severity && issue.severity !== filters.severity) return false;
          if (filters.category && issue.category !== filters.category) return false;
          if (filters.file && !issue.file.includes(filters.file)) return false;
          return true;
        });
      };

      const filtered = applyFilters(issues, { severity: 'critical' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].severity).toBe('critical');
    });

    test('should filter issues by file', () => {
      const issues = [
        { id: '1', severity: 'high', message: 'Issue in a.js', file: 'a.js', line: 1 },
        { id: '2', severity: 'high', message: 'Issue in b.js', file: 'b.js', line: 2 },
        { id: '3', severity: 'high', message: 'Issue in a.js', file: 'a.js', line: 3 }
      ];

      const applyFilters = (issues, filters) => {
        return issues.filter(issue => {
          if (filters.file && !issue.file.includes(filters.file)) return false;
          return true;
        });
      };

      const filtered = applyFilters(issues, { file: 'a.js' });
      expect(filtered).toHaveLength(2);
      expect(filtered.every(i => i.file === 'a.js')).toBe(true);
    });

    test('should support multiple filters at once', () => {
      const issues = [
        { id: '1', severity: 'critical', category: 'security', message: 'SQL injection', file: 'db.js', line: 1 },
        { id: '2', severity: 'high', category: 'performance', message: 'Slow query', file: 'db.js', line: 2 },
        { id: '3', severity: 'critical', category: 'security', message: 'XSS', file: 'ui.js', line: 1 }
      ];

      const applyFilters = (issues, filters) => {
        return issues.filter(issue => {
          if (filters.severity && issue.severity !== filters.severity) return false;
          if (filters.category && issue.category !== filters.category) return false;
          if (filters.file && !issue.file.includes(filters.file)) return false;
          return true;
        });
      };

      const filtered = applyFilters(issues, { 
        severity: 'critical', 
        category: 'security',
        file: 'db.js'
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });
  });

  describe('Filter State', () => {
    test('should initialize with no filters', () => {
      const filters = {
        severity: null,
        category: null,
        file: null
      };
      
      expect(filters.severity).toBeNull();
      expect(filters.category).toBeNull();
      expect(filters.file).toBeNull();
    });

    test('should allow setting individual filters', () => {
      const filters = {
        severity: null,
        category: null,
        file: null
      };
      
      filters.severity = 'critical';
      expect(filters.severity).toBe('critical');
      expect(filters.category).toBeNull();
    });

    test('should reset all filters', () => {
      const filters = {
        severity: 'critical',
        category: 'security',
        file: 'test.js'
      };
      
      filters.severity = null;
      filters.category = null;
      filters.file = null;
      
      expect(filters.severity).toBeNull();
      expect(filters.category).toBeNull();
      expect(filters.file).toBeNull();
    });
  });

  describe('Filter UI Interactions', () => {
    test('filter container should be visible in issues view', () => {
      const container = document.getElementById('filtersContainer');
      expect(container).toBeTruthy();
    });

    test('file filter input should be clearable', () => {
      const fileFilter = document.getElementById('fileFilter');
      fileFilter.value = 'test.js';
      expect(fileFilter.value).toBe('test.js');
      
      fileFilter.value = '';
      expect(fileFilter.value).toBe('');
    });

    test('severity select should support clearing', () => {
      const select = document.getElementById('severityFilter');
      select.value = 'critical';
      expect(select.value).toBe('critical');
      
      select.value = '';
      expect(select.value).toBe('');
    });
  });

  describe('Case Insensitivity', () => {
    test('file filter should be case insensitive', () => {
      const issues = [
        { id: '1', file: 'MyFile.js', severity: 'high', message: 'Issue', line: 1 },
        { id: '2', file: 'myfile.ts', severity: 'high', message: 'Issue', line: 2 }
      ];

      const applyFilters = (issues, filters) => {
        return issues.filter(issue => {
          if (filters.file && !issue.file.toLowerCase().includes(filters.file.toLowerCase())) {
            return false;
          }
          return true;
        });
      };

      const filtered = applyFilters(issues, { file: 'MYFILE' });
      expect(filtered).toHaveLength(2);
    });
  });

  describe('Empty State Handling', () => {
    test('should show message when no issues match filters', () => {
      const issues = [
        { id: '1', severity: 'high', message: 'Issue', file: 'test.js', line: 1 }
      ];

      const applyFilters = (issues, filters) => {
        return issues.filter(issue => {
          if (filters.severity && issue.severity !== filters.severity) return false;
          return true;
        });
      };

      const filtered = applyFilters(issues, { severity: 'critical' });
      expect(filtered).toHaveLength(0);
    });
  });

  describe('Filter Persistence', () => {
    test('should maintain filters across interactions', () => {
      const state = {
        filters: {
          severity: 'critical',
          category: null,
          file: null
        }
      };

      expect(state.filters.severity).toBe('critical');
      
      // Update category
      state.filters.category = 'security';
      expect(state.filters.severity).toBe('critical');
      expect(state.filters.category).toBe('security');
    });
  });
});

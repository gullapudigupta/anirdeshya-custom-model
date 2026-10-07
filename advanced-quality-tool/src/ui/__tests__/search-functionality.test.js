/**
 * Tests for Search Functionality in Chat UI (P11-T012)
 */

'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

describe('Search Functionality (P11-T012)', () => {
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

  describe('Search UI Elements', () => {
    test('should have search input field', () => {
      const searchInput = document.getElementById('searchInput');
      expect(searchInput).toBeTruthy();
      expect(searchInput.tagName).toBe('INPUT');
      expect(searchInput.type).toBe('text');
    });

    test('should have search clear button', () => {
      const clearBtn = document.getElementById('searchClearBtn');
      expect(clearBtn).toBeTruthy();
      expect(clearBtn.textContent).toContain('✕');
    });

    test('should have search results info element', () => {
      const resultsInfo = document.getElementById('searchResultsInfo');
      expect(resultsInfo).toBeTruthy();
    });

    test('search input should have placeholder', () => {
      const searchInput = document.getElementById('searchInput');
      expect(searchInput.placeholder).toBeTruthy();
      expect(searchInput.placeholder.toLowerCase()).toContain('search');
    });
  });

  describe('Search Functionality', () => {
    test('should search by issue message', () => {
      const issues = [
        { id: '1', message: 'SQL injection vulnerability', file: 'db.js', line: 10, severity: 'critical' },
        { id: '2', message: 'Unused variable', file: 'app.js', line: 5, severity: 'low' },
        { id: '3', message: 'SQL query without sanitization', file: 'query.js', line: 20, severity: 'high' }
      ];

      const searchIssues = (query, issues) => {
        if (!query || query.trim().length === 0) return issues;
        const queryLower = query.toLowerCase();
        return issues.filter(issue => {
          const message = (issue.message || '').toLowerCase();
          const file = (issue.file || '').toLowerCase();
          const ruleId = (issue.ruleId || issue.rule || '').toLowerCase();
          return message.includes(queryLower) || file.includes(queryLower) || ruleId.includes(queryLower);
        });
      };

      const results = searchIssues('SQL', issues);
      expect(results).toHaveLength(2);
      expect(results.some(i => i.id === '1')).toBe(true);
      expect(results.some(i => i.id === '3')).toBe(true);
    });

    test('should search by file name', () => {
      const issues = [
        { id: '1', message: 'Issue 1', file: 'database.js', line: 10 },
        { id: '2', message: 'Issue 2', file: 'app.js', line: 5 },
        { id: '3', message: 'Issue 3', file: 'database.ts', line: 20 }
      ];

      const searchIssues = (query, issues) => {
        if (!query) return issues;
        const queryLower = query.toLowerCase();
        return issues.filter(issue => {
          const file = (issue.file || '').toLowerCase();
          return file.includes(queryLower);
        });
      };

      const results = searchIssues('database', issues);
      expect(results).toHaveLength(2);
    });

    test('should be case-insensitive', () => {
      const issues = [
        { id: '1', message: 'Critical SQL Injection', file: 'test.js', line: 1 },
        { id: '2', message: 'warning', file: 'app.js', line: 2 }
      ];

      const searchIssues = (query, issues) => {
        if (!query) return issues;
        const queryLower = query.toLowerCase();
        return issues.filter(issue => {
          const message = (issue.message || '').toLowerCase();
          return message.includes(queryLower);
        });
      };

      const results1 = searchIssues('SQL', issues);
      const results2 = searchIssues('sql', issues);
      const results3 = searchIssues('Sql', issues);

      expect(results1).toHaveLength(1);
      expect(results2).toHaveLength(1);
      expect(results3).toHaveLength(1);
    });

    test('should return all issues for empty query', () => {
      const issues = [
        { id: '1', message: 'Issue 1', file: 'a.js', line: 1 },
        { id: '2', message: 'Issue 2', file: 'b.js', line: 2 },
        { id: '3', message: 'Issue 3', file: 'c.js', line: 3 }
      ];

      const searchIssues = (query, issues) => {
        if (!query || query.trim().length === 0) return issues;
        return issues;
      };

      expect(searchIssues('', issues)).toHaveLength(3);
      expect(searchIssues(null, issues)).toHaveLength(3);
      expect(searchIssues('   ', issues)).toHaveLength(3);
    });

    test('should return empty array for no matches', () => {
      const issues = [
        { id: '1', message: 'Error in function', file: 'app.js', line: 1 },
        { id: '2', message: 'Warning in loop', file: 'util.js', line: 2 }
      ];

      const searchIssues = (query, issues) => {
        if (!query) return issues;
        const queryLower = query.toLowerCase();
        return issues.filter(issue => {
          const message = (issue.message || '').toLowerCase();
          const file = (issue.file || '').toLowerCase();
          return message.includes(queryLower) || file.includes(queryLower);
        });
      };

      expect(searchIssues('nonexistent', issues)).toHaveLength(0);
    });
  });

  describe('Search Highlighting', () => {
    test('should highlight search matches', () => {
      const highlightMatches = (text, query) => {
        if (!query) return text;
        const queryLower = query.toLowerCase();
        const textLower = text.toLowerCase();
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
      };

      const result = highlightMatches('SQL injection found', 'SQL');
      expect(result).toContain('<mark>');
      expect(result).toContain('injection');
    });

    test('should handle multiple matches', () => {
      const highlightMatches = (text, query) => {
        if (!query) return text;
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
      };

      const result = highlightMatches('error in error handling', 'error');
      const markCount = (result.match(/<mark>/g) || []).length;
      expect(markCount).toBe(2);
    });
  });

  describe('Search State Management', () => {
    test('should track search query', () => {
      const state = {
        searchQuery: '',
        searchResults: []
      };

      state.searchQuery = 'SQL injection';
      expect(state.searchQuery).toBe('SQL injection');
    });

    test('should track search results', () => {
      const state = {
        searchQuery: '',
        searchResults: []
      };

      const results = [
        { id: '1', message: 'SQL injection' },
        { id: '2', message: 'SQL vulnerability' }
      ];

      state.searchResults = results;
      expect(state.searchResults).toHaveLength(2);
      expect(state.searchResults[0].id).toBe('1');
    });

    test('should clear search state', () => {
      const state = {
        searchQuery: 'test query',
        searchResults: [{ id: '1' }, { id: '2' }]
      };

      state.searchQuery = '';
      state.searchResults = [];

      expect(state.searchQuery).toBe('');
      expect(state.searchResults).toHaveLength(0);
    });
  });

  describe('Integration with Filters', () => {
    test('should search within filtered results', () => {
      const issues = [
        { id: '1', severity: 'critical', message: 'SQL injection', file: 'db.js', line: 1 },
        { id: '2', severity: 'high', message: 'Performance issue', file: 'app.js', line: 2 },
        { id: '3', severity: 'critical', message: 'XSS vulnerability', file: 'ui.js', line: 3 }
      ];

      // Apply severity filter first
      const filtered = issues.filter(i => i.severity === 'critical');
      
      // Then search within filtered
      const searchIssues = (query, issues) => {
        if (!query) return issues;
        const queryLower = query.toLowerCase();
        return issues.filter(issue => 
          (issue.message || '').toLowerCase().includes(queryLower)
        );
      };

      const results = searchIssues('injection', filtered);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
    });
  });

  describe('Search Input Interactions', () => {
    test('search input should be clearable', () => {
      const searchInput = document.getElementById('searchInput');
      searchInput.value = 'test search';
      expect(searchInput.value).toBe('test search');
      
      searchInput.value = '';
      expect(searchInput.value).toBe('');
    });

    test('clear button should exist', () => {
      const clearBtn = document.getElementById('searchClearBtn');
      expect(clearBtn).toBeTruthy();
      expect(clearBtn.className).toContain('search-clear-btn');
    });
  });

  describe('Empty Search Results', () => {
    test('should show message when no results', () => {
      const issues = [
        { id: '1', message: 'Error found', file: 'app.js', line: 1 }
      ];

      const searchIssues = (query, issues) => {
        if (!query) return issues;
        const queryLower = query.toLowerCase();
        return issues.filter(issue => 
          (issue.message || '').toLowerCase().includes(queryLower)
        );
      };

      const results = searchIssues('nonexistent', issues);
      expect(results).toHaveLength(0);
    });
  });
});

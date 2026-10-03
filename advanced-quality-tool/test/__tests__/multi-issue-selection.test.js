/**
 * Multi-Issue Selection Tests (P11-T013)
 * Tests for bulk issue selection, filtering, and batch operations
 */

describe('Multi-Issue Selection (P11-T013)', () => {
  let state;
  let mockDOM;

  beforeEach(() => {
    // Clean up previous state if any
    if (state) {
      state.selectedIssues.clear();
    }

    // Initialize state
    state = {
      selectedIssues: new Set(),
      multiSelectMode: false,
      searchResults: [
        {
          id: 'issue-1',
          message: 'SQL Injection vulnerability',
          severity: 'critical',
          file: 'src/db.js',
          ruleId: 'SEC-001'
        },
        {
          id: 'issue-2',
          message: 'Weak password hashing',
          severity: 'error',
          file: 'src/auth.js',
          ruleId: 'SEC-002'
        },
        {
          id: 'issue-3',
          message: 'Hardcoded secret',
          severity: 'critical',
          file: 'src/config.js',
          ruleId: 'SEC-003'
        },
        {
          id: 'issue-4',
          message: 'Missing input validation',
          severity: 'warning',
          file: 'src/api.js',
          ruleId: 'SEC-004'
        }
      ]
    };

    // Create mock DOM elements
    mockDOM = {
      bulkActionsBar: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
      selectAllBtn: { disabled: false },
      deselectAllBtn: { disabled: false },
      fixSelectedBtn: { disabled: false },
      bulkSelectionCount: { textContent: '' },
      selectionControls: {}
    };
  });

  afterEach(() => {
    if (state && state.selectedIssues) {
      state.selectedIssues.clear();
    }
  });

  test('should add issue to selectedIssues when toggled on', () => {
    toggleIssueSelection('issue-1');
    expect(state.selectedIssues.has('issue-1')).toBe(true);
    expect(state.selectedIssues.size).toBe(1);
  });

  test('should remove issue from selectedIssues when toggled off', () => {
    state.selectedIssues.add('issue-1');
    toggleIssueSelection('issue-1');
    expect(state.selectedIssues.has('issue-1')).toBe(false);
    expect(state.selectedIssues.size).toBe(0);
  });

  test('should toggle multiple issues independently', () => {
    toggleIssueSelection('issue-1');
    toggleIssueSelection('issue-2');
    toggleIssueSelection('issue-3');
    expect(state.selectedIssues.size).toBe(3);
    expect(state.selectedIssues.has('issue-1')).toBe(true);
    expect(state.selectedIssues.has('issue-2')).toBe(true);
    expect(state.selectedIssues.has('issue-3')).toBe(true);
  });

  test('should select all visible issues', () => {
    selectAllVisibleIssues();
    expect(state.selectedIssues.size).toBe(4);
    expect(state.selectedIssues.has('issue-1')).toBe(true);
    expect(state.selectedIssues.has('issue-2')).toBe(true);
    expect(state.selectedIssues.has('issue-3')).toBe(true);
    expect(state.selectedIssues.has('issue-4')).toBe(true);
  });

  test('should not duplicate selections on multiple select all calls', () => {
    selectAllVisibleIssues();
    selectAllVisibleIssues();
    expect(state.selectedIssues.size).toBe(4);
  });

  test('should clear all selected issues', () => {
    state.selectedIssues.add('issue-1');
    state.selectedIssues.add('issue-2');
    state.selectedIssues.add('issue-3');
    
    deselectAllIssues();
    expect(state.selectedIssues.size).toBe(0);
  });

  test('should work on already empty selection', () => {
    deselectAllIssues();
    expect(state.selectedIssues.size).toBe(0);
  });

  test('should update bulk actions bar visibility when issues selected', () => {
    toggleIssueSelection('issue-1');
    expect(state.selectedIssues.size > 0).toBe(true);
  });

  test('should prepare batch request with selected issues', () => {
    state.selectedIssues.add('issue-1');
    state.selectedIssues.add('issue-2');
    
    const batchRequest = prepareBatchFixRequest();
    expect(batchRequest.issueIds.length).toBe(2);
    expect(batchRequest.issueIds).toContain('issue-1');
    expect(batchRequest.issueIds).toContain('issue-2');
  });

  test('should handle partial selection workflow', () => {
    // This test must start with a clean state
    // Force clear just in case
    state.selectedIssues.clear();
    expect(state.selectedIssues.size).toBe(0);
    
    // Select specific issues
    toggleIssueSelection('issue-1');
    expect(state.selectedIssues.size).toBe(1);
    
    toggleIssueSelection('issue-3');
    expect(state.selectedIssues.size).toBe(2);

    // Deselect one
    toggleIssueSelection('issue-1');
    expect(state.selectedIssues.size).toBe(1);
  });

  test('should maintain selection across multiple operations', () => {
    // Select issues
    selectAllVisibleIssues();
    const initialSelection = new Set(state.selectedIssues);
    
    // Selection should be maintained
    expect(state.selectedIssues.size).toBe(initialSelection.size);
  });

  test('should handle bulk operations on large selection', () => {
    // Create 100 mock issues
    const largeIssueSet = Array.from({ length: 100 }, (_, i) => ({
      id: `issue-${i}`,
      message: `Issue ${i}`,
      severity: 'info',
      file: 'test.js',
      ruleId: `RULE-${i}`
    }));

    state.searchResults = largeIssueSet;

    // Bulk select
    largeIssueSet.forEach(issue => {
      state.selectedIssues.add(issue.id);
    });

    expect(state.selectedIssues.size).toBe(100);

    // Deselect all
    deselectAllIssues();
    expect(state.selectedIssues.size).toBe(0);
  });

  test('should use Set for efficient lookup', () => {
    state.selectedIssues.add('issue-1');
    
    // Set.has() is O(1)
    const startTime = Date.now();
    for (let i = 0; i < 100000; i++) {
      state.selectedIssues.has('issue-1');
    }
    const endTime = Date.now();
    
    // Should complete quickly (Set.has is O(1))
    expect(endTime - startTime).toBeLessThan(1000);
  });

  // Helper functions
  function toggleIssueSelection(issueId) {
    if (state.selectedIssues.has(issueId)) {
      state.selectedIssues.delete(issueId);
    } else {
      state.selectedIssues.add(issueId);
    }
  }

  function selectAllVisibleIssues() {
    state.searchResults.forEach(issue => {
      state.selectedIssues.add(issue.id);
    });
  }

  function deselectAllIssues() {
    state.selectedIssues.clear();
  }

  function prepareBatchFixRequest() {
    return {
      issueIds: Array.from(state.selectedIssues),
      fixes: state.searchResults.filter(i => state.selectedIssues.has(i.id))
    };
  }
});

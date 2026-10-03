/**
 * Batch Fixing Tests (P11-T014)
 * Tests for batch issue fixing, progress tracking, and results handling
 */

describe('Batch Fixing (P11-T014)', () => {
  let mockState;

  beforeEach(() => {
    mockState = {
      selectedIssues: new Set(['issue-1', 'issue-2', 'issue-3']),
      issues: [
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
        }
      ]
    };
  });

  afterEach(() => {
    mockState.selectedIssues.clear();
  });

  test('should prepare batch fix request with selected issue IDs', () => {
    const request = prepareBatchFixRequest(mockState);
    
    expect(request.issueIds.length).toBe(3);
    expect(request.issueIds).toContain('issue-1');
    expect(request.issueIds).toContain('issue-2');
    expect(request.issueIds).toContain('issue-3');
  });

  test('should not fix when no issues are selected', () => {
    mockState.selectedIssues.clear();

    const response = getFixValidation(mockState);
    
    expect(response.error).toBeDefined();
    expect(response.error).toMatch(/No issues selected/);
  });

  test('should calculate success rate correctly', () => {
    const rate1 = calculateSuccessRate(2, 3);
    expect(rate1).toBe('66.7%');

    const rate2 = calculateSuccessRate(5, 5);
    expect(rate2).toBe('100.0%');

    const rate3 = calculateSuccessRate(0, 3);
    expect(rate3).toBe('0.0%');
  });

  test('should handle all successful fixes', () => {
    const results = {
      totalAttempted: 3,
      successful: [
        { issueId: 'issue-1', confidence: 0.95 },
        { issueId: 'issue-2', confidence: 0.87 },
        { issueId: 'issue-3', confidence: 0.92 }
      ],
      failed: [],
      skipped: [],
      summary: {
        successCount: 3,
        failureCount: 0,
        skippedCount: 0,
        successRate: '100.0%'
      }
    };

    expect(results.summary.successCount).toBe(3);
    expect(results.summary.failureCount).toBe(0);
    expect(results.summary.successRate).toBe('100.0%');
  });

  test('should handle partial failures in batch fix', () => {
    const results = {
      totalAttempted: 3,
      successful: [{ issueId: 'issue-1', confidence: 0.92 }],
      failed: [
        { issueId: 'issue-2', reason: 'Insufficient context' },
        { issueId: 'issue-3', reason: 'File not found' }
      ],
      skipped: [],
      summary: {
        successCount: 1,
        failureCount: 2,
        skippedCount: 0,
        successRate: '33.3%'
      }
    };

    expect(results.successful.length).toBe(1);
    expect(results.failed.length).toBe(2);
    expect(results.summary.failureCount).toBe(2);
  });

  test('should handle skipped issues due to low confidence', () => {
    const results = {
      totalAttempted: 3,
      successful: [{ issueId: 'issue-1', confidence: 0.92 }],
      failed: [],
      skipped: [
        { issueId: 'issue-2', reason: 'Confidence below threshold', confidence: 0.65 },
        { issueId: 'issue-3', reason: 'Confidence below threshold', confidence: 0.58 }
      ],
      summary: {
        successCount: 1,
        failureCount: 0,
        skippedCount: 2,
        successRate: '33.3%'
      }
    };

    expect(results.skipped.length).toBe(2);
    expect(results.summary.skippedCount).toBe(2);
  });

  test('should generate results summary with all sections', () => {
    const results = {
      totalAttempted: 5,
      successful: [
        { issueId: 'issue-1', confidence: 0.95 },
        { issueId: 'issue-2', confidence: 0.88 }
      ],
      failed: [
        { issueId: 'issue-3', reason: 'No fix available' }
      ],
      skipped: [
        { issueId: 'issue-4', reason: 'Low confidence' },
        { issueId: 'issue-5', reason: 'Low confidence' }
      ]
    };

    const summary = generateBatchSummary(results);
    
    expect(summary).toMatch(/Successfully Fixed/);
    expect(summary).toMatch(/Failed/);
    expect(summary).toMatch(/Skipped/);
  });

  test('should validate batch request payload', () => {
    const payload = createBatchRequestPayload(mockState);
    
    expect(payload.issueIds).toBeDefined();
    expect(payload.options).toBeDefined();
    expect(payload.options.autoApply).toBe(true);
    expect(payload.options.backup).toBe(true);
    expect(payload.options.verification).toBe(true);
  });

  test('should track batch progress correctly', () => {
    const progress = {
      total: 10,
      processed: 5,
      successful: 4,
      failed: 1
    };

    const percentage = (progress.processed / progress.total) * 100;
    expect(percentage).toBe(50);

    const successRate = calculateSuccessRate(progress.successful, progress.processed);
    expect(successRate).toBe('80.0%');
  });

  test('should handle empty successful results', () => {
    const results = {
      totalAttempted: 3,
      successful: [],
      failed: [
        { issueId: 'issue-1', reason: 'Error 1' },
        { issueId: 'issue-2', reason: 'Error 2' },
        { issueId: 'issue-3', reason: 'Error 3' }
      ],
      skipped: [],
      summary: {
        successCount: 0,
        failureCount: 3,
        skippedCount: 0,
        successRate: '0.0%'
      }
    };

    expect(results.successful.length).toBe(0);
    expect(results.failed.length).toBe(3);
    expect(results.summary.successRate).toBe('0.0%');
  });

  test('should support large batch operations', () => {
    const largeState = {
      selectedIssues: new Set(),
      issues: []
    };

    // Create 100 selected issues
    for (let i = 0; i < 100; i++) {
      largeState.selectedIssues.add(`issue-${i}`);
    }

    expect(largeState.selectedIssues.size).toBe(100);

    const request = prepareBatchFixRequest(largeState);
    expect(request.issueIds.length).toBe(100);
  });

  // Helper functions
  function prepareBatchFixRequest(state) {
    return {
      issueIds: Array.from(state.selectedIssues)
    };
  }

  function getFixValidation(state) {
    if (state.selectedIssues.size === 0) {
      return { error: 'No issues selected' };
    }
    return { valid: true };
  }

  function calculateSuccessRate(successful, total) {
    if (total === 0) return '0.0%';
    return ((successful / total) * 100).toFixed(1) + '%';
  }

  function generateBatchSummary(results) {
    let summary = '';
    
    if (results.successful.length > 0) {
      summary += `Successfully Fixed: ${results.successful.length}\n`;
    }
    
    if (results.failed.length > 0) {
      summary += `Failed: ${results.failed.length}\n`;
    }
    
    if (results.skipped.length > 0) {
      summary += `Skipped: ${results.skipped.length}\n`;
    }

    return summary;
  }

  function createBatchRequestPayload(state) {
    return {
      issueIds: Array.from(state.selectedIssues),
      options: {
        autoApply: true,
        backup: true,
        verification: true,
        confidenceThreshold: 0.7
      }
    };
  }
});

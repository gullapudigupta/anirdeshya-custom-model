/**
 * Tests for Build Monitor
 */

const { BuildMonitor } = require('../../src/monitor/build-monitor');

describe('BuildMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new BuildMonitor({
      verbose: false,
      maxCritical: 0,
      maxErrors: 10,
      maxWarnings: 50,
      minSuccessRate: 80
    });
  });

  describe('CI Environment Detection', () => {
    test('should detect GitHub Actions', () => {
      const originalEnv = process.env.GITHUB_ACTIONS;
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_RUN_ID = '12345';
      process.env.GITHUB_RUN_NUMBER = '42';
      process.env.GITHUB_REF_NAME = 'main';

      const testMonitor = new BuildMonitor({ verbose: false });

      expect(testMonitor.ciEnvironment.name).toBe('GitHub Actions');
      expect(testMonitor.ciEnvironment.buildId).toBe('12345');
      expect(testMonitor.ciEnvironment.buildNumber).toBe('42');

      process.env.GITHUB_ACTIONS = originalEnv;
      delete process.env.GITHUB_RUN_ID;
      delete process.env.GITHUB_RUN_NUMBER;
      delete process.env.GITHUB_REF_NAME;
    });

    test('should detect GitLab CI', () => {
      const originalEnv = process.env.GITLAB_CI;
      process.env.GITLAB_CI = 'true';
      process.env.CI_PIPELINE_ID = '67890';

      const testMonitor = new BuildMonitor({ verbose: false });

      expect(testMonitor.ciEnvironment.name).toBe('GitLab CI');
      expect(testMonitor.ciEnvironment.buildId).toBe('67890');

      process.env.GITLAB_CI = originalEnv;
      delete process.env.CI_PIPELINE_ID;
    });

    test('should default to Local environment', () => {
      expect(monitor.ciEnvironment.name).toBe('Local');
      expect(monitor.ciEnvironment.buildId).toBeDefined();
    });
  });

  describe('Metrics Calculation', () => {
    test('should calculate metrics correctly', () => {
      const analysisResults = {
        issues: [
          { severity: 'CRITICAL', fixable: true },
          { severity: 'ERROR', fixable: false },
          { severity: 'WARNING', fixable: true },
          { severity: 'INFO', fixable: false }
        ],
        files: ['file1.js', 'file2.js'],
        fixed: 5
      };

      const metrics = monitor.calculateMetrics(analysisResults);

      expect(metrics.totalFiles).toBe(2);
      expect(metrics.totalIssues).toBe(4);
      expect(metrics.critical).toBe(1);
      expect(metrics.errors).toBe(1);
      expect(metrics.warnings).toBe(1);
      expect(metrics.info).toBe(1);
      expect(metrics.fixable).toBe(2);
      expect(metrics.fixed).toBe(5);
    });

    test('should calculate success rate correctly', () => {
      const analysisResults = {
        issues: [
          { severity: 'CRITICAL' },
          { severity: 'ERROR' },
          { severity: 'WARNING' },
          { severity: 'INFO' }
        ],
        files: []
      };

      const metrics = monitor.calculateMetrics(analysisResults);

      expect(metrics.successRate).toBe(50); // 2/4 non-critical-or-error
    });

    test('should handle zero issues', () => {
      const analysisResults = {
        issues: [],
        files: []
      };

      const metrics = monitor.calculateMetrics(analysisResults);

      expect(metrics.totalIssues).toBe(0);
      expect(metrics.successRate).toBe(100);
    });

    test('should extract complexity from issues', () => {
      const analysisResults = {
        issues: [
          { ruleId: 'complexity', message: 'Complexity of 15' },
          { ruleId: 'complexity', message: 'Complexity of 25' }
        ],
        files: []
      };

      const metrics = monitor.calculateMetrics(analysisResults);

      expect(metrics.complexity.max).toBe(25);
    });
  });

  describe('Quality Gates', () => {
    test('should pass all gates with good metrics', () => {
      const metrics = {
        critical: 0,
        errors: 5,
        warnings: 30,
        successRate: 90,
        complexity: { max: 15 },
        duplication: { percentage: 3 }
      };

      const gateResults = monitor.checkQualityGates(metrics);

      expect(gateResults.passed).toBe(true);
      expect(gateResults.gates).toHaveLength(6);
      expect(gateResults.gates.every(g => g.passed)).toBe(true);
    });

    test('should fail on critical issues', () => {
      const metrics = {
        critical: 1,
        errors: 0,
        warnings: 0,
        successRate: 100,
        complexity: { max: 10 },
        duplication: { percentage: 2 }
      };

      const gateResults = monitor.checkQualityGates(metrics);

      expect(gateResults.passed).toBe(false);
      const criticalGate = gateResults.gates.find(g => g.name === 'Critical Issues');
      expect(criticalGate.passed).toBe(false);
    });

    test('should fail on too many errors', () => {
      const metrics = {
        critical: 0,
        errors: 15,
        warnings: 0,
        successRate: 80,
        complexity: { max: 10 },
        duplication: { percentage: 2 }
      };

      const gateResults = monitor.checkQualityGates(metrics);

      expect(gateResults.passed).toBe(false);
      const errorGate = gateResults.gates.find(g => g.name === 'Errors');
      expect(errorGate.passed).toBe(false);
    });

    test('should fail on low success rate', () => {
      const metrics = {
        critical: 0,
        errors: 5,
        warnings: 10,
        successRate: 70,
        complexity: { max: 10 },
        duplication: { percentage: 2 }
      };

      const gateResults = monitor.checkQualityGates(metrics);

      expect(gateResults.passed).toBe(false);
      const successGate = gateResults.gates.find(g => g.name === 'Success Rate');
      expect(successGate.passed).toBe(false);
    });

    test('should fail on high complexity', () => {
      const metrics = {
        critical: 0,
        errors: 0,
        warnings: 0,
        successRate: 100,
        complexity: { max: 25 },
        duplication: { percentage: 2 }
      };

      const gateResults = monitor.checkQualityGates(metrics);

      expect(gateResults.passed).toBe(false);
      const complexityGate = gateResults.gates.find(g => g.name === 'Max Complexity');
      expect(complexityGate.passed).toBe(false);
    });
  });

  describe('Regression Detection', () => {
    test('should detect no regressions on first build', () => {
      const metrics = {
        critical: 1,
        errors: 5,
        complexity: { max: 15 }
      };

      const regressions = monitor.detectRegressions(metrics);

      expect(regressions).toHaveLength(0);
    });

    test('should detect critical increase', () => {
      monitor.history.push({
        metrics: {
          critical: 0,
          errors: 5,
          complexity: { max: 15 }
        }
      });

      const metrics = {
        critical: 2,
        errors: 5,
        complexity: { max: 15 }
      };

      const regressions = monitor.detectRegressions(metrics);

      expect(regressions.length).toBeGreaterThan(0);
      const criticalRegression = regressions.find(r => r.type === 'critical');
      expect(criticalRegression).toBeDefined();
      expect(criticalRegression.delta).toBe(2);
    });

    test('should detect error increase', () => {
      monitor.history.push({
        metrics: {
          critical: 0,
          errors: 5,
          complexity: { max: 15 }
        }
      });

      const metrics = {
        critical: 0,
        errors: 10,
        complexity: { max: 15 }
      };

      const regressions = monitor.detectRegressions(metrics);

      const errorRegression = regressions.find(r => r.type === 'errors');
      expect(errorRegression).toBeDefined();
      expect(errorRegression.delta).toBe(5);
    });

    test('should detect complexity increase', () => {
      monitor.history.push({
        metrics: {
          critical: 0,
          errors: 5,
          complexity: { max: 15 }
        }
      });

      const metrics = {
        critical: 0,
        errors: 5,
        complexity: { max: 25 }
      };

      const regressions = monitor.detectRegressions(metrics);

      const complexityRegression = regressions.find(r => r.type === 'complexity');
      expect(complexityRegression).toBeDefined();
      expect(complexityRegression.delta).toBe(10);
    });
  });

  describe('Build ID Generation', () => {
    test('should generate unique build IDs', () => {
      const id1 = monitor.generateBuildId();
      const id2 = monitor.generateBuildId();

      expect(id1).toMatch(/^build-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('Exit Code', () => {
    test('should return 0 for passed build', () => {
      monitor.results = { passed: true };

      expect(monitor.getExitCode()).toBe(0);
    });

    test('should return 1 for failed build', () => {
      monitor.results = { passed: false };

      expect(monitor.getExitCode()).toBe(1);
    });
  });

  describe('HTML Report Generation', () => {
    test('should generate valid HTML report', () => {
      monitor.results = {
        passed: true,
        buildId: 'test-123',
        timestamp: new Date().toISOString(),
        metrics: {
          totalIssues: 10,
          critical: 0,
          errors: 2,
          warnings: 5,
          successRate: 90,
          fixed: 3
        },
        gates: {
          gates: [
            { name: 'Test Gate', passed: true, value: 5, operator: '<=', threshold: 10 }
          ]
        },
        regressions: []
      };

      const html = monitor.buildHTMLReport();

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Code Quality Report');
      expect(html).toContain('PASSED');
      expect(html).toContain('10');
    });
  });

  describe('JUnit XML Generation', () => {
    test('should generate valid JUnit XML', () => {
      monitor.results = {
        duration: 5000,
        gates: {
          gates: [
            { name: 'Test Gate', passed: true, value: 5, operator: '<=', threshold: 10 }
          ]
        }
      };

      const xml = monitor.buildJUnitXML();

      expect(xml).toContain('<?xml version="1.0"');
      expect(xml).toContain('<testsuites');
      expect(xml).toContain('Test Gate');
      expect(xml).not.toContain('<failure');
    });

    test('should include failures in JUnit XML', () => {
      monitor.results = {
        duration: 5000,
        gates: {
          gates: [
            { name: 'Failed Gate', passed: false, value: 15, operator: '<=', threshold: 10 }
          ]
        }
      };

      const xml = monitor.buildJUnitXML();

      expect(xml).toContain('<failure');
      expect(xml).toContain('Failed Gate');
    });
  });
});

describe('Integration Tests', () => {
  test('should process full build lifecycle', async () => {
    const monitor = new BuildMonitor({
      verbose: false,
      maxCritical: 0,
      maxErrors: 10
    });

    monitor.start();

    const analysisResults = {
      issues: [
        { severity: 'ERROR' },
        { severity: 'WARNING' }
      ],
      files: ['test.js'],
      fixed: 1
    };

    const results = await monitor.processResults(analysisResults);

    expect(results.passed).toBeDefined();
    expect(results.metrics).toBeDefined();
    expect(results.gates).toBeDefined();
  });

  test('should handle custom quality gates', () => {
    const monitor = new BuildMonitor({
      verbose: false,
      maxCritical: 5,
      maxErrors: 20,
      maxWarnings: 100,
      minSuccessRate: 70
    });

    expect(monitor.gates.maxCritical).toBe(5);
    expect(monitor.gates.maxErrors).toBe(20);
    expect(monitor.gates.maxWarnings).toBe(100);
    expect(monitor.gates.minSuccessRate).toBe(70);
  });
});

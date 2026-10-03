/**
 * Quality Gate — Pass/Fail thresholds for code quality
 * 
 * Inspired by SonarQube Quality Gates:
 * - Configurable thresholds
 * - Multiple condition support
 * - Rating-based conditions (A-E)
 * - Metric-based conditions (numeric)
 */

// ─── Default Quality Gate Configuration ──────────────────────────────────────

const DEFAULT_GATE = {
  name: 'Parikrama Default',
  conditions: [
    // Reliability
    { metric: 'bugs', operator: 'GT', threshold: 0, severity: 'critical' },
    { metric: 'reliability_rating', operator: 'WORSE_THAN', threshold: 'A', severity: 'critical' },
    
    // Security
    { metric: 'vulnerabilities', operator: 'GT', threshold: 0, severity: 'critical' },
    { metric: 'security_rating', operator: 'WORSE_THAN', threshold: 'A', severity: 'critical' },
    { metric: 'security_hotspots', operator: 'GT', threshold: 5, severity: 'major' },
    
    // Maintainability
    { metric: 'code_smells', operator: 'GT', threshold: 50, severity: 'major' },
    { metric: 'maintainability_rating', operator: 'WORSE_THAN', threshold: 'B', severity: 'major' },
    { metric: 'technical_debt_minutes', operator: 'GT', threshold: 480, severity: 'major' }, // 8 hours
    
    // Complexity
    { metric: 'max_cyclomatic_complexity', operator: 'GT', threshold: 30, severity: 'major' },
    { metric: 'max_cognitive_complexity', operator: 'GT', threshold: 25, severity: 'major' },
    
    // Size
    { metric: 'max_file_lines', operator: 'GT', threshold: 500, severity: 'minor' },
    
    // Duplications
    { metric: 'duplicate_blocks', operator: 'GT', threshold: 10, severity: 'minor' },
  ],
};

// Relaxed gate for initial adoption
const RELAXED_GATE = {
  name: 'Parikrama Relaxed (Initial Adoption)',
  conditions: [
    { metric: 'vulnerabilities', operator: 'GT', threshold: 5, severity: 'critical' },
    { metric: 'security_rating', operator: 'WORSE_THAN', threshold: 'C', severity: 'critical' },
    { metric: 'code_smells', operator: 'GT', threshold: 200, severity: 'major' },
    { metric: 'max_cyclomatic_complexity', operator: 'GT', threshold: 50, severity: 'major' },
    { metric: 'technical_debt_minutes', operator: 'GT', threshold: 2400, severity: 'major' }, // 5 days
  ],
};

// ─── Rating Conversion ───────────────────────────────────────────────────────

const RATING_ORDER = { 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5 };

function isRatingWorseThan(actual, threshold) {
  return (RATING_ORDER[actual] || 5) > (RATING_ORDER[threshold] || 1);
}

// ─── Quality Gate Engine ─────────────────────────────────────────────────────

class QualityGate {
  constructor(config = DEFAULT_GATE) {
    this.config = config;
  }

  /**
   * Evaluate metrics against the quality gate
   * @param {Object} metrics - The computed metrics
   * @returns {Object} Gate result with pass/fail status and details
   */
  evaluate(metrics) {
    const results = [];
    let passed = true;
    
    for (const condition of this.config.conditions) {
      const actualValue = metrics[condition.metric];
      
      if (actualValue === undefined || actualValue === null) {
        results.push({
          ...condition,
          status: 'SKIPPED',
          actualValue: 'N/A',
          message: `Metric "${condition.metric}" not available`,
        });
        continue;
      }
      
      let conditionPassed;
      
      switch (condition.operator) {
        case 'GT': // Greater Than (fail if actual > threshold)
          conditionPassed = actualValue <= condition.threshold;
          break;
        case 'LT': // Less Than (fail if actual < threshold)
          conditionPassed = actualValue >= condition.threshold;
          break;
        case 'GTE':
          conditionPassed = actualValue < condition.threshold;
          break;
        case 'LTE':
          conditionPassed = actualValue > condition.threshold;
          break;
        case 'EQ':
          conditionPassed = actualValue !== condition.threshold;
          break;
        case 'WORSE_THAN': // Rating comparison
          conditionPassed = !isRatingWorseThan(actualValue, condition.threshold);
          break;
        default:
          conditionPassed = true;
      }
      
      if (!conditionPassed) passed = false;
      
      results.push({
        metric: condition.metric,
        operator: condition.operator,
        threshold: condition.threshold,
        actualValue,
        status: conditionPassed ? 'PASSED' : 'FAILED',
        severity: condition.severity,
        message: conditionPassed 
          ? `✓ ${condition.metric}: ${actualValue} (threshold: ${condition.operator} ${condition.threshold})`
          : `✗ ${condition.metric}: ${actualValue} exceeds threshold (${condition.operator} ${condition.threshold})`,
      });
    }
    
    return {
      gateName: this.config.name,
      status: passed ? 'PASSED' : 'FAILED',
      timestamp: new Date().toISOString(),
      conditions: results,
      failedConditions: results.filter(r => r.status === 'FAILED'),
      passedConditions: results.filter(r => r.status === 'PASSED'),
      skippedConditions: results.filter(r => r.status === 'SKIPPED'),
      summary: {
        total: results.length,
        passed: results.filter(r => r.status === 'PASSED').length,
        failed: results.filter(r => r.status === 'FAILED').length,
        skipped: results.filter(r => r.status === 'SKIPPED').length,
      },
    };
  }
}

module.exports = { QualityGate, DEFAULT_GATE, RELAXED_GATE };

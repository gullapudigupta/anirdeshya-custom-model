/**
 * CI Build Monitoring and Quality Gate Pipeline
 * Task: P9-T031
 * 
 * Instruments BuildMonitor from CI detection through metrics, gates, regressions, 
 * history, reports, and exit status.
 */

const { Pipeline } = require('../core/pipeline');

/**
 * CI Quality Gate Pipeline Stages
 */
const STAGES = [
  { name: 'detect-ci', description: 'Detect CI environment' },
  { name: 'start-build', description: 'Initialize build record' },
  { name: 'collect-analysis', description: 'Run quality analysis' },
  { name: 'calculate-metrics', description: 'Calculate quality metrics' },
  { name: 'check-gates', description: 'Evaluate quality gates' },
  { name: 'detect-regressions', description: 'Check for regressions' },
  { name: 'save-results', description: 'Save build results' },
  { name: 'generate-reports', description: 'Generate reports' },
  { name: 'set-exit-status', description: 'Set exit status' }
];

/**
 * CI providers
 */
const CIProviders = {
  GITHUB_ACTIONS: 'github-actions',
  JENKINS: 'jenkins',
  CIRCLECI: 'circleci',
  TRAVIS: 'travis',
  GITLAB_CI: 'gitlab-ci',
  AZURE_PIPELINES: 'azure-pipelines',
  LOCAL: 'local'
};

/**
 * Gate results
 */
const GateResults = {
  PASS: 'pass',
  FAIL: 'fail',
  WARN: 'warn',
  SKIP: 'skip'
};

/**
 * CI Quality Gate Pipeline Implementation
 */
class CIQualityGatePipeline extends Pipeline {
  constructor(options = {}) {
    super('ci-quality-gate', STAGES, options);
    
    this.qualityAnalyzer = options.qualityAnalyzer;
    this.historyStore = options.historyStore;
    this.reportGenerator = options.reportGenerator;
    
    this.gates = options.gates || this.getDefaultGates();
    this.failOnRegression = options.failOnRegression !== false;
  }

  /**
   * Stage: detect-ci
   */
  async detectCI(context) {
    const ci = this.detectCIEnvironment();
    
    return {
      ci,
      isCI: ci.provider !== CIProviders.LOCAL,
      buildInfo: this.extractBuildInfo(ci)
    };
  }

  /**
   * Detect CI environment
   */
  detectCIEnvironment() {
    const env = process.env;
    
    if (env.GITHUB_ACTIONS === 'true') {
      return {
        provider: CIProviders.GITHUB_ACTIONS,
        buildId: env.GITHUB_RUN_ID,
        buildNumber: env.GITHUB_RUN_NUMBER,
        branch: env.GITHUB_REF_NAME,
        commit: env.GITHUB_SHA,
        workspace: env.GITHUB_WORKSPACE
      };
    }
    
    if (env.JENKINS_URL) {
      return {
        provider: CIProviders.JENKINS,
        buildId: env.BUILD_ID,
        buildNumber: env.BUILD_NUMBER,
        branch: env.GIT_BRANCH,
        commit: env.GIT_COMMIT,
        workspace: env.WORKSPACE
      };
    }
    
    if (env.CIRCLECI === 'true') {
      return {
        provider: CIProviders.CIRCLECI,
        buildId: env.CIRCLE_BUILD_NUM,
        buildNumber: env.CIRCLE_BUILD_NUM,
        branch: env.CIRCLE_BRANCH,
        commit: env.CIRCLE_SHA1,
        workspace: env.CIRCLE_WORKING_DIRECTORY
      };
    }
    
    if (env.TRAVIS === 'true') {
      return {
        provider: CIProviders.TRAVIS,
        buildId: env.TRAVIS_BUILD_ID,
        buildNumber: env.TRAVIS_BUILD_NUMBER,
        branch: env.TRAVIS_BRANCH,
        commit: env.TRAVIS_COMMIT,
        workspace: env.TRAVIS_BUILD_DIR
      };
    }
    
    if (env.GITLAB_CI === 'true') {
      return {
        provider: CIProviders.GITLAB_CI,
        buildId: env.CI_PIPELINE_ID,
        buildNumber: env.CI_JOB_ID,
        branch: env.CI_COMMIT_REF_NAME,
        commit: env.CI_COMMIT_SHA,
        workspace: env.CI_PROJECT_DIR
      };
    }
    
    if (env.AZURE_PIPELINES === 'True') {
      return {
        provider: CIProviders.AZURE_PIPELINES,
        buildId: env.BUILD_BUILDID,
        buildNumber: env.BUILD_BUILDNUMBER,
        branch: env.BUILD_SOURCEBRANCHNAME,
        commit: env.BUILD_SOURCEVERSION,
        workspace: env.AGENT_WORKFOLDER
      };
    }
    
    return {
      provider: CIProviders.LOCAL,
      buildId: null,
      buildNumber: null,
      branch: this.getLocalBranch(),
      commit: this.getLocalCommit(),
      workspace: process.cwd()
    };
  }

  /**
   * Extract build info
   */
  extractBuildInfo(ci) {
    return {
      id: ci.buildId || `local-${Date.now()}`,
      number: ci.buildNumber,
      branch: ci.branch,
      commit: ci.commit,
      provider: ci.provider
    };
  }

  /**
   * Get local git branch
   */
  getLocalBranch() {
    try {
      const { execSync } = require('child_process');
      return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get local git commit
   */
  getLocalCommit() {
    try {
      const { execSync } = require('child_process');
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Stage: start-build
   */
  async startBuild(context) {
    const { ci, buildInfo } = context.previousResult;
    
    const build = {
      id: buildInfo.id,
      startTime: Date.now(),
      status: 'running',
      ...buildInfo
    };
    
    return { build };
  }

  /**
   * Stage: collect-analysis
   */
  async collectAnalysis(context) {
    const { build } = context.previousResult;
    const workspace = context.workspace || build.workspace || process.cwd();
    
    let analysis;
    
    if (this.qualityAnalyzer) {
      analysis = await this.qualityAnalyzer.analyze(workspace);
    } else {
      analysis = await this.defaultAnalysis(workspace);
    }
    
    return { analysis };
  }

  /**
   * Default analysis fallback
   */
  async defaultAnalysis(workspace) {
    return {
      issues: [],
      metrics: {},
      duration: 0
    };
  }

  /**
   * Stage: calculate-metrics
   */
  async calculateMetrics(context) {
    const { analysis } = context.previousResult;
    
    const metrics = {
      totalIssues: analysis.issues?.length || 0,
      errors: analysis.issues?.filter(i => i.severity === 'error').length || 0,
      warnings: analysis.issues?.filter(i => i.severity === 'warning').length || 0,
      ...analysis.metrics
    };
    
    return { metrics };
  }

  /**
   * Stage: check-gates
   */
  async checkGates(context) {
    const { metrics } = context.previousResult;
    
    const results = [];
    let overall = GateResults.PASS;
    
    for (const gate of this.gates) {
      const result = this.evaluateGate(gate, metrics);
      results.push(result);
      
      if (result.status === GateResults.FAIL) {
        overall = GateResults.FAIL;
      } else if (result.status === GateResults.WARN && overall !== GateResults.FAIL) {
        overall = GateResults.WARN;
      }
    }
    
    return {
      gates: results,
      gateStatus: overall
    };
  }

  /**
   * Evaluate a single gate
   */
  evaluateGate(gate, metrics) {
    const value = metrics[gate.metric];
    
    if (value === undefined) {
      return {
        name: gate.name,
        metric: gate.metric,
        status: GateResults.SKIP,
        reason: 'Metric not available'
      };
    }
    
    let status;
    
    if (gate.max !== undefined && value > gate.max) {
      status = gate.warnThreshold !== undefined && value <= gate.warnThreshold ?
        GateResults.WARN : GateResults.FAIL;
    } else if (gate.min !== undefined && value < gate.min) {
      status = gate.warnThreshold !== undefined && value >= gate.warnThreshold ?
        GateResults.WARN : GateResults.FAIL;
    } else {
      status = GateResults.PASS;
    }
    
    return {
      name: gate.name,
      metric: gate.metric,
      value,
      threshold: gate.max !== undefined ? gate.max : gate.min,
      operator: gate.max !== undefined ? '<=' : '>=',
      status,
      reason: status === GateResults.PASS ? 
        'Within threshold' : 
        `Value ${value} exceeds threshold`
    };
  }

  /**
   * Stage: detect-regressions
   */
  async detectRegressions(context) {
    const { metrics, build } = context.stages['calculate-metrics'];
    const history = await this.getHistory(build.branch);
    
    const regressions = [];
    
    if (history.length > 0) {
      const previous = history[0];
      
      for (const [key, value] of Object.entries(metrics)) {
        const previousValue = previous.metrics?.[key];
        
        if (previousValue !== undefined && value > previousValue) {
          regressions.push({
            metric: key,
            previous: previousValue,
            current: value,
            change: value - previousValue,
            percentChange: ((value - previousValue) / previousValue) * 100
          });
        }
      }
    }
    
    return {
      regressions,
      hasRegressions: regressions.length > 0,
      previousBuild: history[0] || null
    };
  }

  /**
   * Get history for branch
   */
  async getHistory(branch) {
    if (this.historyStore) {
      return await this.historyStore.getHistory(branch, 10);
    }
    return [];
  }

  /**
   * Stage: save-results
   */
  async saveResults(context) {
    const { build, analysis, metrics, gates, gateStatus, regressions } = 
      Object.assign({}, ...Object.values(context.stages));
    
    const result = {
      ...build,
      endTime: Date.now(),
      duration: Date.now() - build.startTime,
      status: gateStatus === GateResults.FAIL ? 'failed' : 'passed',
      metrics,
      gates,
      regressions,
      analysis: {
        totalIssues: analysis.issues?.length || 0,
        duration: analysis.duration
      }
    };
    
    if (this.historyStore) {
      await this.historyStore.save(result);
    }
    
    return { result };
  }

  /**
   * Stage: generate-reports
   */
  async generateReports(context) {
    const { result } = context.previousResult;
    
    const reports = [];
    
    if (this.reportGenerator) {
      const report = await this.reportGenerator.generate(result);
      reports.push(report);
    }
    
    return { reports };
  }

  /**
   * Stage: set-exit-status
   */
  async setExitStatus(context) {
    const { result, regressions, gateStatus } = 
      Object.assign({}, ...Object.values(context.stages));
    
    let exitCode = 0;
    const reasons = [];
    
    if (gateStatus === GateResults.FAIL) {
      exitCode = 1;
      reasons.push('Quality gate failed');
    }
    
    if (this.failOnRegression && regressions.hasRegressions) {
      exitCode = 1;
      reasons.push('Regression detected');
    }
    
    return {
      exitCode,
      reasons,
      success: exitCode === 0,
      result
    };
  }

  /**
   * Default gates configuration
   */
  getDefaultGates() {
    return [
      {
        name: 'No Errors',
        metric: 'errors',
        max: 0,
        description: 'Zero errors required'
      },
      {
        name: 'Warning Limit',
        metric: 'warnings',
        max: 50,
        warnThreshold: 40,
        description: 'Warnings under limit'
      },
      {
        name: 'Code Coverage',
        metric: 'coverage',
        min: 70,
        warnThreshold: 80,
        description: 'Minimum test coverage'
      }
    ];
  }
}

module.exports = {
  CIQualityGatePipeline,
  STAGES,
  CIProviders,
  GateResults
};

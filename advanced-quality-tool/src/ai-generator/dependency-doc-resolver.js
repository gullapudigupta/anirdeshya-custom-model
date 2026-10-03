/**
 * Dependency-Aware Official Documentation Context Builder (P6-T016)
 *
 * Discovers the project's real dependencies/frameworks (from package.json and
 * other project references) and resolves them to their OFFICIAL documentation
 * sources via a configurable pattern map. It then uses DocSearcher (P6-T003) to
 * retrieve docs and returns them as context fragments the ContextAggregator
 * (P6-T006) can fold into fix context.
 *
 * Network-free by default (DocSearcher degrades to offline hints without a
 * transport). Resolved doc sets are cached via SearchCache (AQ-SF-002).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { DocSearcher } = require('./doc-searcher');

/**
 * Configurable dependency -> official-docs pattern map.
 * `test` matches a dependency name; `docsUrl` builds an official reference URL;
 * `topics` seed extra doc queries. Override/extend via options.patterns.
 */
const DEFAULT_PATTERNS = [
  { name: 'eslint',     test: /^eslint(-|$)/,          docsUrl: 'https://eslint.org/docs/latest/', topics: ['rules', 'configuration'] },
  { name: 'typescript', test: /^typescript$/,          docsUrl: 'https://www.typescriptlang.org/docs/', topics: ['handbook'] },
  { name: 'angular',    test: /^@angular\//,           docsUrl: 'https://angular.dev/', topics: ['components', 'guide'] },
  { name: 'react',      test: /^react(-dom)?$/,         docsUrl: 'https://react.dev/reference/react', topics: ['hooks'] },
  { name: 'express',    test: /^express$/,             docsUrl: 'https://expressjs.com/en/4x/api.html', topics: ['routing', 'middleware'] },
  { name: 'jest',       test: /^jest$/,                docsUrl: 'https://jestjs.io/docs/getting-started', topics: ['matchers'] },
  { name: 'vue',        test: /^vue$/,                 docsUrl: 'https://vuejs.org/guide/', topics: ['reactivity'] },
  { name: 'next',       test: /^next$/,                docsUrl: 'https://nextjs.org/docs', topics: ['routing'] }
];

const DEFAULT_OPTIONS = {
  rootDir: process.cwd(),
  patterns: DEFAULT_PATTERNS,
  maxDependencies: 8,          // cap docs pulled so context stays lean
  docSearcher: null,           // inject a configured DocSearcher (transport/cache)
  extraReferences: []          // additional dep names discovered outside package.json
};

class DependencyDocResolver {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.patterns = this.options.patterns || DEFAULT_PATTERNS;
    this.docSearcher = this.options.docSearcher ||
      new DocSearcher({ rootDir: this.options.rootDir });
  }

  /**
   * Read dependency names from package.json (deps + devDeps) plus any
   * caller-supplied extra references.
   */
  detectDependencies() {
    const names = new Set(this.options.extraReferences || []);
    const pkgPath = path.join(this.options.rootDir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const dep of Object.keys(pkg[section] || {})) names.add(dep);
      }
    } catch { /* no package.json — rely on extraReferences */ }
    return Array.from(names);
  }

  /**
   * Map detected dependencies to matching official-docs patterns.
   * @returns {Array<{name, dependency, docsUrl, topics}>}
   */
  resolveDocSources(dependencies = this.detectDependencies()) {
    const resolved = [];
    const seen = new Set();
    for (const dep of dependencies) {
      const pattern = this.patterns.find((p) => {
        try { return p.test.test(dep); } catch { return false; }
      });
      if (pattern && !seen.has(pattern.name)) {
        seen.add(pattern.name);
        resolved.push({ name: pattern.name, dependency: dep, docsUrl: pattern.docsUrl, topics: pattern.topics || [] });
      }
      if (resolved.length >= this.options.maxDependencies) break;
    }
    return resolved;
  }

  /**
   * Build documentation context fragments for the resolved sources.
   * @param {object} [issue] Optional issue/classification to focus doc queries.
   * @returns {Promise<{fragments:Array, sources:Array}>}
   */
  async buildDocContext(issue = null) {
    const sources = this.resolveDocSources();
    const fragments = [];

    for (const src of sources) {
      const query = issue
        ? this.docSearcher.buildQuery({ rule: src.name, message: (issue.message || issue.summary || '') })
        : `${src.name} ${src.topics.join(' ')}`.trim();

      const result = await this.docSearcher.search({ rule: src.name, message: query, category: 'DOCS' });
      if (result.fragments && result.fragments.length) {
        for (const f of result.fragments) {
          fragments.push({ ...f, source: 'docs', dependency: src.dependency, reference: src.docsUrl });
        }
      } else {
        // Offline reference fragment so context still names the official docs.
        fragments.push({
          source: 'docs',
          title: `${src.name} official documentation`,
          text: `Project depends on "${src.dependency}". Official documentation: ${src.docsUrl}.`,
          url: src.docsUrl,
          dependency: src.dependency,
          reference: src.docsUrl,
          score: 0.35,
          offline: true
        });
      }
    }

    return { fragments, sources };
  }
}

module.exports = { DependencyDocResolver, DEFAULT_DOC_PATTERNS: DEFAULT_PATTERNS };

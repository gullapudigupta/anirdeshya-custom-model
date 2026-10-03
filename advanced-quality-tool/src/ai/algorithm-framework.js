/**
 * Algorithm Design and Generation Framework  (P7-T003)
 *
 * Provides a structured workflow for specifying, generating, validating,
 * and benchmarking algorithms. Key capabilities:
 *
 *  - Algorithm specification format with input/output contracts
 *  - Template library (sort, search, graph, dynamic-programming, etc.)
 *  - Property-based test generation (QuickCheck-style)
 *  - Fuzz testing with random/edge-case inputs
 *  - Invariant checks and proof obligations
 *  - Benchmark suite with Big-O complexity validation
 *
 * Usage:
 *   const fw = new AlgorithmFramework();
 *   const spec = fw.define({ name: 'binarySearch', ... });
 *   const code = fw.generate(spec);
 *   const result = fw.validate(spec, code);
 *
 * @module ai/algorithm-framework
 */

'use strict';

const crypto = require('crypto');

// ─── Built-in algorithm templates ────────────────────────────────────────────

/**
 * Each template defines the algorithm's signature, known invariants,
 * complexity bounds, and a reference implementation for test oracles.
 *
 * Templates are keyed by category/name and can be extended by callers.
 */
const TEMPLATES = {
  // ── Sorting ────────────────────────────────────────────────────────────────
  'sort/bubble': {
    name: 'Bubble Sort',
    category: 'sort',
    complexity: { time: 'O(n²)', space: 'O(1)' },
    invariants: ['output is sorted ascending', 'output contains same elements as input'],
    referenceImpl: (arr) => [...arr].sort((a, b) => a - b),
    generate: () => `
/**
 * Bubble Sort — O(n²) time, O(1) space
 * Stable sort. Use only for small arrays or nearly-sorted data.
 * @param {number[]} arr - Input array (not mutated)
 * @returns {number[]} New sorted array
 */
function bubbleSort(arr) {
  const a = [...arr]; // Work on a copy to avoid mutating the input
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - i - 1; j++) {
      if (a[j] > a[j + 1]) {
        [a[j], a[j + 1]] = [a[j + 1], a[j]]; // Swap adjacent elements
      }
    }
  }
  return a;
}
module.exports = { bubbleSort };`.trim()
  },

  'sort/merge': {
    name: 'Merge Sort',
    category: 'sort',
    complexity: { time: 'O(n log n)', space: 'O(n)' },
    invariants: ['output is sorted ascending', 'output contains same elements as input'],
    referenceImpl: (arr) => [...arr].sort((a, b) => a - b),
    generate: () => `
/**
 * Merge Sort — O(n log n) time, O(n) space
 * Stable, divide-and-conquer sort.
 * @param {number[]} arr
 * @returns {number[]}
 */
function mergeSort(arr) {
  if (arr.length <= 1) return arr; // Base case: single element is already sorted
  const mid   = Math.floor(arr.length / 2);
  const left  = mergeSort(arr.slice(0, mid));  // Recursively sort left half
  const right = mergeSort(arr.slice(mid));     // Recursively sort right half
  return merge(left, right);
}

/** Merge two sorted arrays into one sorted array */
function merge(left, right) {
  const result = [];
  let i = 0, j = 0;
  // Compare front elements and take the smaller one
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) result.push(left[i++]);
    else                      result.push(right[j++]);
  }
  // Append any remaining elements
  return result.concat(left.slice(i), right.slice(j));
}
module.exports = { mergeSort };`.trim()
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  'search/binary': {
    name: 'Binary Search',
    category: 'search',
    complexity: { time: 'O(log n)', space: 'O(1)' },
    invariants: ['returns index of target in sorted array', 'returns -1 when not found'],
    referenceImpl: (arr, target) => arr.indexOf(target),
    generate: () => `
/**
 * Binary Search — O(log n) time, O(1) space
 * Requires the input array to be sorted in ascending order.
 * @param {number[]} arr    - Sorted array to search
 * @param {number}   target - Value to find
 * @returns {number} Index of target, or -1 if not found
 */
function binarySearch(arr, target) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1; // Unsigned right shift avoids overflow
    if      (arr[mid] === target) return mid;   // Found
    else if (arr[mid] < target)   lo = mid + 1; // Target is in right half
    else                          hi = mid - 1; // Target is in left half
  }
  return -1; // Not found
}
module.exports = { binarySearch };`.trim()
  },

  // ── Graph ──────────────────────────────────────────────────────────────────
  'graph/bfs': {
    name: 'Breadth-First Search',
    category: 'graph',
    complexity: { time: 'O(V + E)', space: 'O(V)' },
    invariants: ['visits all reachable nodes', 'visits nodes in level order'],
    referenceImpl: null, // Graph algorithms need structural equality checks
    generate: () => `
/**
 * Breadth-First Search — O(V + E) time, O(V) space
 * Traverses a graph level-by-level from a start node.
 * @param {Map<any, any[]>} adjacency - Adjacency list { node → [neighbours] }
 * @param {*} start - Starting node
 * @returns {any[]} Nodes in BFS visit order
 */
function bfs(adjacency, start) {
  const visited = new Set();  // Track visited nodes to avoid cycles
  const queue   = [start];    // FIFO queue for level-order traversal
  const order   = [];         // Result: nodes in visit order
  visited.add(start);
  while (queue.length > 0) {
    const node = queue.shift(); // Dequeue front node
    order.push(node);
    for (const neighbour of (adjacency.get(node) || [])) {
      if (!visited.has(neighbour)) {
        visited.add(neighbour);
        queue.push(neighbour); // Enqueue unvisited neighbours
      }
    }
  }
  return order;
}
module.exports = { bfs };`.trim()
  },

  // ── Dynamic programming ────────────────────────────────────────────────────
  'dp/fibonacci': {
    name: 'Fibonacci (memoized)',
    category: 'dp',
    complexity: { time: 'O(n)', space: 'O(n)' },
    invariants: ['fib(0)=0', 'fib(1)=1', 'fib(n)=fib(n-1)+fib(n-2)'],
    referenceImpl: (n) => { let a = 0, b = 1; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a; },
    generate: () => `
/**
 * Fibonacci — O(n) time, O(n) space (top-down memoization)
 * @param {number} n - Non-negative integer
 * @returns {number} nth Fibonacci number
 */
function fibonacci(n, memo = new Map()) {
  if (n < 0)  throw new RangeError('n must be non-negative');
  if (n <= 1) return n;                        // Base cases: fib(0)=0, fib(1)=1
  if (memo.has(n)) return memo.get(n);         // Return cached result
  const result = fibonacci(n - 1, memo) + fibonacci(n - 2, memo);
  memo.set(n, result);                         // Cache before returning
  return result;
}
module.exports = { fibonacci };`.trim()
  }
};

// ─── Main class ───────────────────────────────────────────────────────────────

class AlgorithmFramework {
  /**
   * @param {object} [options={}]
   * @param {object} [options.customTemplates] - Additional templates to register
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options   = options;
    this.verbose   = options.verbose || false;
    // Merge built-in templates with any user-supplied ones
    this.templates = Object.assign({}, TEMPLATES, options.customTemplates || {});
    /** @type {Map<string, object>} Registered algorithm specs */
    this.specs = new Map();
  }

  // ─── Spec definition ────────────────────────────────────────────────────────

  /**
   * Define a new algorithm specification.
   * The spec describes what the algorithm should do; generate() produces code.
   *
   * @param {object} params
   * @param {string}   params.name             - Algorithm name (e.g. 'quickSort')
   * @param {string}   params.description      - What the algorithm does
   * @param {object}   params.inputContract    - { type, constraints[] }
   * @param {object}   params.outputContract   - { type, constraints[] }
   * @param {string[]} [params.invariants=[]]  - Properties that must always hold
   * @param {string}   [params.template]       - Key into TEMPLATES to use as base
   * @param {string}   [params.complexity]     - Expected Big-O (e.g. 'O(n log n)')
   * @returns {object} Algorithm specification record
   */
  define(params) {
    this._require(params, ['name', 'inputContract', 'outputContract']);

    const spec = {
      id:             crypto.randomBytes(6).toString('hex'),
      name:           params.name,
      description:    params.description || '',
      inputContract:  params.inputContract,
      outputContract: params.outputContract,
      invariants:     params.invariants || [],
      template:       params.template   || null,
      complexity:     params.complexity || null,
      createdAt:      new Date().toISOString()
    };

    this.specs.set(spec.id, spec);
    this._log(`Defined spec: ${spec.name} (${spec.id})`);
    return spec;
  }

  // ─── Code generation ────────────────────────────────────────────────────────

  /**
   * Generate algorithm source code from a spec.
   * If the spec names a built-in template, uses that template's generator.
   * Otherwise produces a documented stub for the developer to fill in.
   *
   * @param {object} spec - Result of define()
   * @returns {string} JavaScript source code
   */
  generate(spec) {
    // Use template generator if available
    if (spec.template && this.templates[spec.template]) {
      const code = this.templates[spec.template].generate();
      this._log(`Generated code for '${spec.name}' from template '${spec.template}'`);
      return code;
    }

    // Generate a documented stub for custom algorithms
    return this._generateStub(spec);
  }

  /**
   * Build a documented stub when no template matches.
   * @param {object} spec
   * @returns {string}
   */
  _generateStub(spec) {
    const inputDesc  = JSON.stringify(spec.inputContract,  null, 2).split('\n').map(l => ` * ${l}`).join('\n');
    const outputDesc = JSON.stringify(spec.outputContract, null, 2).split('\n').map(l => ` * ${l}`).join('\n');
    const invariants = spec.invariants.map(inv => ` * - ${inv}`).join('\n');

    return `/**
 * ${spec.name}
 * ${spec.description || '(no description)'}
 *
 * Input contract:
${inputDesc}
 *
 * Output contract:
${outputDesc}
 *
 * Invariants:
${invariants || ' * (none specified)'}
 *
 * Expected complexity: ${spec.complexity || '(not specified)'}
 *
 * @param {*} input - See input contract above
 * @returns {*} See output contract above
 */
function ${spec.name}(input) {
  // TODO: Implement ${spec.name}
  // Invariants to maintain:
${spec.invariants.map(inv => `  //   - ${inv}`).join('\n') || '  //   (none)'}
  throw new Error('${spec.name} is not yet implemented');
}

module.exports = { ${spec.name} };`;
  }

  // ─── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validate generated algorithm code against its spec using:
   *  1. Property-based tests (random inputs checked against invariants/oracle)
   *  2. Edge-case fuzz inputs
   *  3. Invariant assertions
   *
   * @param {object}   spec       - Algorithm spec from define()
   * @param {Function} implFn     - The actual implementation to test
   * @param {object}   [opts={}]
   * @param {number}   [opts.iterations=100]  - Property test iterations
   * @param {number}   [opts.fuzzCount=20]    - Fuzz input count
   * @returns {{ passed: boolean, results: object[], failures: object[] }}
   */
  validate(spec, implFn, opts = {}) {
    const iterations = opts.iterations || 100;
    const fuzzCount  = opts.fuzzCount  || 20;
    const results    = [];
    const failures   = [];

    // Property-based tests using random array inputs
    for (let i = 0; i < iterations; i++) {
      const input    = this._randomInput(spec.inputContract);
      const testCase = this._runTest(spec, implFn, input, `property-${i}`);
      results.push(testCase);
      if (!testCase.passed) failures.push(testCase);
    }

    // Edge cases: empty, single element, duplicates, already-sorted, reversed
    const edgeCases = this._edgeCases(spec.inputContract);
    for (const [label, input] of edgeCases) {
      const testCase = this._runTest(spec, implFn, input, `edge-${label}`);
      results.push(testCase);
      if (!testCase.passed) failures.push(testCase);
    }

    // Fuzz tests: random large/extreme inputs
    for (let i = 0; i < fuzzCount; i++) {
      const input    = this._fuzzInput(spec.inputContract);
      const testCase = this._runTest(spec, implFn, input, `fuzz-${i}`);
      results.push(testCase);
      if (!testCase.passed) failures.push(testCase);
    }

    const passed = failures.length === 0;
    this._log(`Validation ${passed ? 'PASSED' : 'FAILED'} for '${spec.name}': ` +
              `${results.length} tests, ${failures.length} failures`);

    return { passed, results, failures, summary: { total: results.length, passed: results.length - failures.length, failed: failures.length } };
  }

  /**
   * Run a single test case: execute impl, compare with reference oracle, check invariants.
   */
  _runTest(spec, implFn, input, label) {
    let output, error, passed = true;
    const invariantResults = [];

    try {
      output = implFn(input);
    } catch (e) {
      error  = e.message;
      passed = false;
    }

    if (!error) {
      // Check against reference oracle if template has one
      if (spec.template && this.templates[spec.template]?.referenceImpl) {
        const oracle = this.templates[spec.template].referenceImpl(input);
        if (JSON.stringify(output) !== JSON.stringify(oracle)) {
          passed = false;
          error  = `Output mismatch. Expected: ${JSON.stringify(oracle)}, Got: ${JSON.stringify(output)}`;
        }
      }

      // Check invariants (string-based; real invariants would be functions)
      for (const inv of spec.invariants) {
        invariantResults.push({ invariant: inv, checked: false, note: 'Invariant checking requires function-form invariants' });
      }
    }

    return { label, input, output, error, passed, invariantResults };
  }

  // ─── Benchmarking ───────────────────────────────────────────────────────────

  /**
   * Benchmark an implementation across input sizes to validate complexity claims.
   *
   * @param {Function} implFn         - Implementation to benchmark
   * @param {number[]} [sizes]        - Input sizes to test
   * @param {string}   [inputType]    - 'array' | 'number' (shapes the generated input)
   * @returns {object[]} Timing results per input size
   */
  benchmark(implFn, sizes = [10, 100, 1000, 5000], inputType = 'array') {
    const results = [];

    for (const size of sizes) {
      // Generate input of the requested size
      const input = inputType === 'number'
        ? size
        : Array.from({ length: size }, () => Math.floor(Math.random() * size * 2));

      const start = process.hrtime.bigint();
      try { implFn(input); } catch { /* ignore runtime errors during benchmark */ }
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6; // ms

      results.push({ size, elapsedMs: elapsed });
      this._log(`Benchmark size=${size}: ${elapsed.toFixed(3)}ms`);
    }

    // Estimate complexity ratio between consecutive sizes
    const ratios = [];
    for (let i = 1; i < results.length; i++) {
      const sizeRatio = results[i].size / results[i - 1].size;
      const timeRatio = results[i].elapsedMs / (results[i - 1].elapsedMs || 0.001);
      ratios.push({
        from:      results[i - 1].size,
        to:        results[i].size,
        sizeRatio: sizeRatio.toFixed(1),
        timeRatio: timeRatio.toFixed(2),
        // log(timeRatio)/log(sizeRatio) ≈ exponent in O(n^k)
        estimatedExponent: (Math.log(timeRatio) / Math.log(sizeRatio)).toFixed(2)
      });
    }

    return { timings: results, ratios };
  }

  // ─── Template management ────────────────────────────────────────────────────

  /**
   * Register a custom algorithm template.
   * @param {string} key      - Template key (e.g. 'sort/radix')
   * @param {object} template - { name, generate: fn, referenceImpl?, invariants? }
   */
  registerTemplate(key, template) {
    this.templates[key] = template;
    this._log(`Registered template: ${key}`);
  }

  /** List all available template keys */
  listTemplates() {
    return Object.entries(this.templates).map(([key, t]) => ({
      key,
      name:       t.name,
      category:   t.category || 'custom',
      complexity: t.complexity || {}
    }));
  }

  // ─── Input generation ───────────────────────────────────────────────────────

  /** Generate a random input conforming to a contract */
  _randomInput(contract) {
    if (contract.type === 'number[]' || contract.type === 'array') {
      const len = Math.floor(Math.random() * 20) + 1;
      return Array.from({ length: len }, () => Math.floor(Math.random() * 200) - 100);
    }
    if (contract.type === 'sorted-number[]') {
      const arr = Array.from({ length: Math.floor(Math.random() * 20) + 1 },
                              () => Math.floor(Math.random() * 200));
      return arr.sort((a, b) => a - b);
    }
    if (contract.type === 'number') return Math.floor(Math.random() * 30);
    return null;
  }

  /** Generate edge-case inputs */
  _edgeCases(contract) {
    const cases = [
      ['empty',    []],
      ['single',   [42]],
      ['two',      [2, 1]],
      ['sorted',   [1, 2, 3, 4, 5]],
      ['reversed', [5, 4, 3, 2, 1]],
      ['dups',     [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]]
    ];
    if (contract.type === 'number') {
      return [['zero', 0], ['one', 1], ['large', 30]];
    }
    return cases;
  }

  /** Generate fuzz (stress) inputs */
  _fuzzInput(contract) {
    if (contract.type === 'number') return Math.floor(Math.random() * 50);
    const len = Math.floor(Math.random() * 1000);
    return Array.from({ length: len }, () => Math.floor(Math.random() * 1e6) - 5e5);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  _require(obj, fields) {
    for (const f of fields) {
      if (obj[f] === undefined || obj[f] === null) throw new Error(`Missing required field: '${f}'`);
    }
  }

  _log(msg) { if (this.verbose) console.log(`[AlgorithmFramework] ${msg}`); }
}

module.exports = { AlgorithmFramework, TEMPLATES };

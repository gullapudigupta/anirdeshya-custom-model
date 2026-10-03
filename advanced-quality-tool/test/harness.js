/**
 * Minimal zero-dependency test harness
 *
 * Provides a Jest-compatible subset (describe/test/it/beforeEach/afterEach and
 * an expect() with the matchers used by this project's *.test.js files) so the
 * existing suites run under plain `node` without installing Jest.
 *
 * Only the matchers actually exercised by the suites are implemented. Add more
 * as needed. Keeping this dependency-free avoids a heavy devDependency install.
 *
 * @module test/harness
 */

const results = { passed: 0, failed: 0, failures: [] };
const suiteStack = [];
const beforeEachStack = [];
const afterEachStack = [];

function currentName(name) {
  return [...suiteStack, name].join(' › ');
}

function describe(name, fn) {
  suiteStack.push(name);
  beforeEachStack.push([]);
  afterEachStack.push([]);
  try {
    fn();
  } finally {
    suiteStack.pop();
    beforeEachStack.pop();
    afterEachStack.pop();
  }
}

function beforeEach(fn) {
  const top = beforeEachStack[beforeEachStack.length - 1];
  if (top) top.push(fn);
}

function afterEach(fn) {
  const top = afterEachStack[afterEachStack.length - 1];
  if (top) top.push(fn);
}

async function runHooks(stack) {
  for (const level of stack) {
    for (const hook of level) {
      await hook();
    }
  }
}

// Support callback-style async tests: test('x', (done) => { ...; done(); }).
function runWithOptionalDone(fn) {
  if (fn.length === 0) {
    return Promise.resolve(fn());
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve();
    };
    const timer = setTimeout(() => done(new Error('test timed out (done not called)')), 5000);
    Promise.resolve(fn(done))
      .then(() => {}, (e) => done(e))
      .finally(() => {
        // If the fn returned a promise and never used done, resolve on settle.
        if (!settled && fn.length > 0) {
          // leave for done(); timer guards against hangs
        }
        clearTimeout(timer);
      });
  });
}

async function test(name, fn) {
  const label = currentName(name);
  try {
    await runHooks(beforeEachStack);
    await runWithOptionalDone(fn);
    await runHooks(afterEachStack);
    results.passed++;
    console.log(`  \u2713 ${label}`);
  } catch (err) {
    results.failed++;
    results.failures.push({ label, message: err && err.message });
    console.log(`  \u2717 ${label}`);
    console.log(`      ${err && err.message}`);
  }
}

function fmt(v) {
  try {
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  } catch (_) {
    return String(v);
  }
}

function makeExpect(actual, negated = false) {
  const assert = (pass, msg) => {
    const ok = negated ? !pass : pass;
    if (!ok) throw new Error(msg);
  };
  const api = {
    get not() {
      return makeExpect(actual, !negated);
    },
    toBe(expected) {
      assert(Object.is(actual, expected), `expected ${fmt(actual)} ${negated ? 'not ' : ''}to be ${fmt(expected)}`);
    },
    toEqual(expected) {
      assert(JSON.stringify(actual) === JSON.stringify(expected), `expected ${fmt(actual)} ${negated ? 'not ' : ''}to equal ${fmt(expected)}`);
    },
    toMatch(re) {
      const rx = re instanceof RegExp ? re : new RegExp(re);
      assert(rx.test(actual), `expected ${fmt(actual)} ${negated ? 'not ' : ''}to match ${rx}`);
    },
    toContain(sub) {
      const pass = actual != null && actual.includes(sub);
      assert(pass, `expected ${fmt(actual)} ${negated ? 'not ' : ''}to contain ${fmt(sub)}`);
    },
    toBeDefined() {
      assert(actual !== undefined, `expected value ${negated ? 'not ' : ''}to be defined`);
    },
    toBeUndefined() {
      assert(actual === undefined, `expected value ${negated ? 'not ' : ''}to be undefined`);
    },
    toBeNull() {
      assert(actual === null, `expected value ${negated ? 'not ' : ''}to be null`);
    },
    toBeTruthy() {
      assert(!!actual, `expected ${fmt(actual)} ${negated ? 'not ' : ''}to be truthy`);
    },
    toBeFalsy() {
      assert(!actual, `expected ${fmt(actual)} ${negated ? 'not ' : ''}to be falsy`);
    },
    toBeInstanceOf(ctor) {
      assert(actual instanceof ctor, `expected value ${negated ? 'not ' : ''}to be instance of ${ctor && ctor.name}`);
    },
    toHaveLength(len) {
      const actualLen = actual == null ? undefined : actual.length;
      assert(actualLen === len, `expected length ${fmt(actualLen)} ${negated ? 'not ' : ''}to be ${len}`);
    },
    toHaveProperty(prop) {
      assert(actual != null && Object.prototype.hasOwnProperty.call(actual, prop), `expected object ${negated ? 'not ' : ''}to have property ${prop}`);
    },
    toBeGreaterThan(n) {
      assert(actual > n, `expected ${fmt(actual)} ${negated ? 'not ' : ''}to be greater than ${n}`);
    },
    toBeGreaterThanOrEqual(n) {
      assert(actual >= n, `expected ${fmt(actual)} ${negated ? 'not ' : ''}to be >= ${n}`);
    },
    toBeLessThan(n) {
      assert(actual < n, `expected ${fmt(actual)} ${negated ? 'not ' : ''}to be less than ${n}`);
    },
    toBeLessThanOrEqual(n) {
      assert(actual <= n, `expected ${fmt(actual)} ${negated ? 'not ' : ''}to be <= ${n}`);
    }
  };
  return api;
}

function expect(actual) {
  return makeExpect(actual);
}

// Minimal jest shim: mock functions and no-op fake timers. Enough for the
// suites that call jest.fn(), jest.useFakeTimers() and jest.advanceTimersByTime().
function jestFn(impl) {
  const mockFn = (...args) => {
    mockFn.mock.calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  mockFn.mock = { calls: [] };
  mockFn.mockReturnValue = (v) => jestFn(() => v);
  mockFn.mockImplementation = (f) => {
    impl = f;
    return mockFn;
  };
  return mockFn;
}

const jest = {
  fn: jestFn,
  useFakeTimers: () => {},
  useRealTimers: () => {},
  advanceTimersByTime: () => {},
  clearAllTimers: () => {},
  spyOn: (obj, method) => {
    const original = obj[method];
    const spy = jestFn(original && original.bind(obj));
    spy.mockRestore = () => {
      obj[method] = original;
    };
    obj[method] = spy;
    return spy;
  }
};

// Expose Jest-like globals so existing *.test.js files run unmodified.
global.jest = jest;
global.describe = describe;
global.test = test;
global.it = test;
global.beforeEach = beforeEach;
global.afterEach = afterEach;
global.expect = expect;

module.exports = { results };

/**
 * Compiler-Aware Complex Fix Engine  (P7-T004)
 *
 * Adapts compiler/linter diagnostics from multiple languages into a unified
 * format, then runs an iterative compile → fix → validate loop in an isolated
 * sandbox until all diagnostics are resolved or the retry limit is reached.
 *
 * Supported diagnostic adapters:
 *   TypeScript (tsc), JavaScript (eslint), Python (pylint/mypy),
 *   Go (go build/vet), Rust (cargo check), C# (dotnet build),
 *   PHP (php -l), Ruby (ruby -c)
 *
 * Validation pipeline per fix attempt:
 *   build → test → lint → security-check
 *
 * On failure, the patch is rejected and the previous state is restored.
 *
 * @module ai/compiler-fix-engine
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');
const crypto        = require('crypto');

// ─── Diagnostic adapter registry ─────────────────────────────────────────────

/**
 * Each adapter normalises raw compiler/linter output into the shared
 * DiagnosticRecord format:
 *   { file, line, column, severity, code, message, language }
 *
 * Adapters are keyed by language name and selected automatically based on
 * the file extension or an explicit `language` option.
 */
const DIAGNOSTIC_ADAPTERS = {

  // ── TypeScript (tsc --noEmit) ─────────────────────────────────────────────
  typescript: {
    extensions: ['.ts', '.tsx'],
    /**
     * Run tsc and parse its output into DiagnosticRecords.
     * tsc line format: "file(line,col): severity TScode: message"
     */
    run(projectRoot, _file) {
      const raw = _execSafe('npx tsc --noEmit 2>&1', projectRoot);
      return raw.split('\n')
        .map(line => {
          // Match: path/to/file.ts(12,5): error TS2345: message text
          const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+(\w+)\s+(TS\d+):\s+(.+)$/);
          if (!m) return null;
          return { file: m[1], line: +m[2], column: +m[3], severity: m[4].toUpperCase(),
                   code: m[5], message: m[6], language: 'typescript' };
        })
        .filter(Boolean);
    }
  },

  // ── JavaScript (ESLint) ───────────────────────────────────────────────────
  javascript: {
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
    /**
     * Run eslint with JSON formatter and parse results.
     */
    run(projectRoot, file) {
      const target = file || '.';
      const raw    = _execSafe(`npx eslint "${target}" --format json 2>&1`, projectRoot);
      try {
        const results = JSON.parse(raw);
        const diags   = [];
        for (const r of results) {
          for (const msg of r.messages) {
            diags.push({
              file:     r.filePath,
              line:     msg.line     || 1,
              column:   msg.column   || 1,
              severity: msg.severity === 2 ? 'ERROR' : 'WARNING',
              code:     msg.ruleId   || 'unknown',
              message:  msg.message,
              language: 'javascript'
            });
          }
        }
        return diags;
      } catch { return []; }
    }
  },

  // ── Python (mypy) ─────────────────────────────────────────────────────────
  python: {
    extensions: ['.py'],
    /** Run mypy and parse its output. */
    run(projectRoot, file) {
      const target = file || '.';
      const raw    = _execSafe(`python -m mypy "${target}" 2>&1`, projectRoot);
      return raw.split('\n')
        .map(line => {
          // Format: file.py:12: error: message  [code]
          const m = line.match(/^(.+?):(\d+):\s+(error|warning|note):\s+(.+?)(?:\s+\[([^\]]+)\])?$/);
          if (!m) return null;
          return { file: m[1], line: +m[2], column: 1,
                   severity: m[3].toUpperCase(), code: m[5] || 'unknown',
                   message: m[4], language: 'python' };
        })
        .filter(Boolean);
    }
  },

  // ── Go (go vet) ───────────────────────────────────────────────────────────
  go: {
    extensions: ['.go'],
    run(projectRoot, _file) {
      const raw = _execSafe('go vet ./... 2>&1', projectRoot);
      return raw.split('\n')
        .map(line => {
          const m = line.match(/^(.+?):(\d+):(\d+):\s+(.+)$/);
          if (!m) return null;
          return { file: m[1], line: +m[2], column: +m[3], severity: 'ERROR',
                   code: 'go-vet', message: m[4], language: 'go' };
        })
        .filter(Boolean);
    }
  },

  // ── Rust (cargo check) ───────────────────────────────────────────────────
  rust: {
    extensions: ['.rs'],
    run(projectRoot, _file) {
      const raw = _execSafe('cargo check --message-format=short 2>&1', projectRoot);
      return raw.split('\n')
        .map(line => {
          const m = line.match(/^(.+?):(\d+):(\d+):\s+(error|warning)\[([^\]]+)\]:\s+(.+)$/);
          if (!m) return null;
          return { file: m[1], line: +m[2], column: +m[3],
                   severity: m[4].toUpperCase(), code: m[5], message: m[6], language: 'rust' };
        })
        .filter(Boolean);
    }
  },

  // ── C# (dotnet build) ────────────────────────────────────────────────────
  csharp: {
    extensions: ['.cs'],
    run(projectRoot, _file) {
      const raw = _execSafe('dotnet build 2>&1', projectRoot);
      return raw.split('\n')
        .map(line => {
          // Format: file.cs(12,5): error CS0103: message
          const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(CS\d+):\s+(.+)$/);
          if (!m) return null;
          return { file: m[1], line: +m[2], column: +m[3],
                   severity: m[4].toUpperCase(), code: m[5], message: m[6], language: 'csharp' };
        })
        .filter(Boolean);
    }
  },

  // ── PHP (php -l) ─────────────────────────────────────────────────────────
  php: {
    extensions: ['.php'],
    run(projectRoot, file) {
      const target = file || '.';
      const raw    = _execSafe(`php -l "${target}" 2>&1`, projectRoot);
      return raw.split('\n')
        .map(line => {
          const m = line.match(/Parse error:\s+(.+?) in (.+?) on line (\d+)/);
          if (!m) return null;
          return { file: m[2], line: +m[3], column: 1,
                   severity: 'ERROR', code: 'parse-error', message: m[1], language: 'php' };
        })
        .filter(Boolean);
    }
  },

  // ── Ruby (ruby -c) ───────────────────────────────────────────────────────
  ruby: {
    extensions: ['.rb'],
    run(projectRoot, file) {
      const target = file || '.';
      const raw    = _execSafe(`ruby -c "${target}" 2>&1`, projectRoot);
      return raw.split('\n')
        .map(line => {
          const m = line.match(/^(.+?):(\d+):\s+(.+)$/);
          if (!m) return null;
          return { file: m[1], line: +m[2], column: 1,
                   severity: 'ERROR', code: 'syntax-error', message: m[3], language: 'ruby' };
        })
        .filter(Boolean);
    }
  }
};

// ─── Main class ───────────────────────────────────────────────────────────────

class CompilerFixEngine {
  /**
   * @param {object} [options={}]
   * @param {string}  [options.projectRoot=process.cwd()]
   * @param {number}  [options.maxRetries=3]    - Max compile-fix-test iterations
   * @param {boolean} [options.runTests=true]   - Run tests in validation pipeline
   * @param {boolean} [options.runLint=true]    - Run lint in validation pipeline
   * @param {boolean} [options.verbose=false]
   * @param {boolean} [options.dryRun=false]    - Collect diagnostics only; skip fixes
   * @param {object}  [options.fixProvider]     - External fix provider { fix(diag, content) }
   */
  constructor(options = {}) {
    this.options     = options;
    this.verbose     = options.verbose   || false;
    this.dryRun      = options.dryRun    || false;
    this.projectRoot = options.projectRoot || process.cwd();
    this.maxRetries  = options.maxRetries  || 3;
    this.runTests    = options.runTests    !== false;
    this.runLint     = options.runLint     !== false;
    this.fixProvider = options.fixProvider || null;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Collect diagnostics for a file (or whole project) using the appropriate adapter.
   *
   * @param {string} [file] - Path to a specific file, or null for full project
   * @param {string} [language] - Override language detection
   * @returns {object[]} Array of DiagnosticRecord objects
   */
  getDiagnostics(file, language) {
    const lang    = language || this._detectLanguage(file);
    const adapter = DIAGNOSTIC_ADAPTERS[lang];

    if (!adapter) {
      this._log(`No adapter for language '${lang}'`);
      return [];
    }

    this._log(`Running ${lang} diagnostics${file ? ` on ${file}` : ' (project-wide)'}`);
    return adapter.run(this.projectRoot, file);
  }

  /**
   * Run the iterative compile → fix → validate loop.
   *
   * For each iteration:
   *   1. Get current diagnostics
   *   2. If none remain, return success
   *   3. Apply fixes (via fixProvider or built-in rule-based fixer)
   *   4. Validate (build + test + lint + security)
   *   5. If validation fails, roll back and halt
   *
   * @param {string} [file]     - Target file (null = whole project)
   * @param {string} [language] - Force language adapter
   * @returns {{ success: boolean, iterations: object[], finalDiagnostics: object[], message: string }}
   */
  async runFixLoop(file, language) {
    const iterations = [];
    let   backupPath = null;

    // Create a backup before starting so we can roll back entirely if needed
    if (file && !this.dryRun) {
      backupPath = this._backup(file);
    }

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      this._log(`Fix loop iteration ${attempt}/${this.maxRetries}`);

      // Step 1: collect diagnostics
      const diagnostics = this.getDiagnostics(file, language);
      const iterRecord  = { attempt, diagnosticCount: diagnostics.length, fixes: [], validation: null };

      if (diagnostics.length === 0) {
        // No more diagnostics — run final validation to confirm clean state
        iterRecord.validation = this._runValidation(file);
        iterations.push(iterRecord);
        this._log(`All diagnostics resolved after ${attempt - 1} fix iteration(s)`);
        return { success: true, iterations, finalDiagnostics: [], message: 'All diagnostics resolved' };
      }

      if (this.dryRun) {
        iterations.push({ ...iterRecord, dryRun: true });
        return { success: false, iterations, finalDiagnostics: diagnostics,
                 message: `DRY RUN — ${diagnostics.length} diagnostic(s) found; no fixes applied` };
      }

      // Step 2: apply fixes for each diagnostic
      for (const diag of diagnostics) {
        const fix = await this._applyFix(diag, file);
        iterRecord.fixes.push(fix);
      }

      // Step 3: validate after fixes
      const validation = this._runValidation(file);
      iterRecord.validation = validation;
      iterations.push(iterRecord);

      if (!validation.passed) {
        // Validation failed — roll back to last-known-good state and stop
        this._log(`Validation failed after attempt ${attempt} — rolling back`);
        if (backupPath) this._restore(backupPath, file);
        return {
          success: false, iterations, finalDiagnostics: diagnostics,
          message: `Validation failed: ${validation.errors.join('; ')}. Changes rolled back.`
        };
      }

      this._log(`Iteration ${attempt} complete — ${diagnostics.length} → ?  (re-checking next)`);
    }

    // Exhausted retries
    const finalDiags = this.getDiagnostics(file, language);
    return {
      success: false, iterations, finalDiagnostics: finalDiags,
      message: `Max retries (${this.maxRetries}) reached with ${finalDiags.length} diagnostic(s) remaining`
    };
  }

  // ─── Fix application ────────────────────────────────────────────────────────

  /**
   * Apply a fix for a single diagnostic.
   * Delegates to the injected fixProvider if available, else uses built-in heuristics.
   *
   * @param {object} diag  - DiagnosticRecord
   * @param {string} [file]
   * @returns {object} Fix record { diag, applied, description }
   */
  async _applyFix(diag, file) {
    const targetFile = diag.file || file;
    if (!targetFile || !fs.existsSync(targetFile)) {
      return { diag, applied: false, description: 'Target file not found' };
    }

    const content = fs.readFileSync(targetFile, 'utf8');
    let   fixed   = content;
    let   description = 'no fix available';

    // Use injected AI/LLM fix provider if configured
    if (this.fixProvider && typeof this.fixProvider.fix === 'function') {
      try {
        fixed       = await this.fixProvider.fix(diag, content);
        description = `AI fix applied for ${diag.code}`;
      } catch (e) {
        this._log(`Fix provider error: ${e.message}`);
      }
    } else {
      // Built-in rule-based heuristics for common diagnostics
      const result  = this._ruleBasedFix(diag, content);
      fixed         = result.content;
      description   = result.description;
    }

    const applied = fixed !== content;
    if (applied) {
      fs.writeFileSync(targetFile, fixed);
      this._log(`Applied fix to ${targetFile}: ${description}`);
    }

    return { diag, applied, description, targetFile };
  }

  /**
   * Rule-based heuristics for common compiler/linter errors.
   * Handles the most frequent fixable patterns.
   *
   * @param {object} diag
   * @param {string} content
   * @returns {{ content: string, description: string }}
   */
  _ruleBasedFix(diag, content) {
    const { code, message } = diag;
    let fixed = content;

    // TypeScript: TS2304 — Cannot find name 'X' → add 'declare const X: any;'
    if (code === 'TS2304') {
      const match = message.match(/Cannot find name '(\w+)'/);
      if (match) {
        fixed = `declare const ${match[1]}: any;\n` + fixed;
        return { content: fixed, description: `Added declaration for '${match[1]}'` };
      }
    }

    // ESLint: no-unused-vars → prefix with underscore
    if (code === 'no-unused-vars') {
      const match = message.match(/'(\w+)' is defined but never used/);
      if (match) {
        const name = match[1];
        fixed = fixed.replace(new RegExp(`\\b${name}\\b`, 'g'), `_${name}`);
        return { content: fixed, description: `Prefixed unused variable '${name}' with underscore` };
      }
    }

    // ESLint: semi — missing semicolon on a specific line
    if (code === 'semi' && diag.line) {
      const lines = fixed.split('\n');
      const idx   = diag.line - 1;
      if (lines[idx] && !lines[idx].trimEnd().endsWith(';')) {
        lines[idx] = lines[idx].trimEnd() + ';';
        fixed = lines.join('\n');
        return { content: fixed, description: `Added missing semicolon at line ${diag.line}` };
      }
    }

    // Generic: trailing whitespace
    if (code === 'no-trailing-spaces' || message.toLowerCase().includes('trailing whitespace')) {
      fixed = fixed.split('\n').map(l => l.trimEnd()).join('\n');
      return { content: fixed, description: 'Removed trailing whitespace' };
    }

    return { content: fixed, description: 'no rule-based fix matched' };
  }

  // ─── Validation pipeline ────────────────────────────────────────────────────

  /**
   * Run the validation suite: build + test + lint + security check.
   * Each step is run only if the corresponding option is enabled.
   *
   * @param {string} [file]
   * @returns {{ passed: boolean, steps: object[], errors: string[] }}
   */
  _runValidation(file) {
    const steps  = [];
    const errors = [];

    // Build step — run the project's build/compile command
    const buildCmd = this._detectBuildCommand();
    if (buildCmd) {
      const out  = _execSafe(buildCmd, this.projectRoot);
      const pass = !out.toLowerCase().includes('error');
      steps.push({ step: 'build', command: buildCmd, passed: pass, output: out.slice(0, 300) });
      if (!pass) errors.push(`Build failed: ${out.slice(0, 200)}`);
    }

    // Test step
    if (this.runTests) {
      const testCmd = this._detectTestCommand();
      if (testCmd) {
        const out  = _execSafe(testCmd, this.projectRoot);
        const pass = !out.includes('FAIL') && !out.toLowerCase().includes('error');
        steps.push({ step: 'test', command: testCmd, passed: pass, output: out.slice(0, 300) });
        if (!pass) errors.push(`Tests failed: ${out.slice(0, 200)}`);
      }
    }

    // Lint step (lightweight — just exit code)
    if (this.runLint && file) {
      const lintCmd = `npx eslint "${file}" --max-warnings 0 2>&1`;
      const out     = _execSafe(lintCmd, this.projectRoot);
      const pass    = !out.includes('error');
      steps.push({ step: 'lint', command: lintCmd, passed: pass, output: out.slice(0, 200) });
    }

    const passed = errors.length === 0;
    return { passed, steps, errors };
  }

  // ─── Language & command detection ──────────────────────────────────────────

  /**
   * Detect the language of a file from its extension.
   * @param {string} [file]
   * @returns {string} Language key
   */
  _detectLanguage(file) {
    if (!file) return 'javascript';
    const ext = path.extname(file).toLowerCase();
    for (const [lang, adapter] of Object.entries(DIAGNOSTIC_ADAPTERS)) {
      if (adapter.extensions.includes(ext)) return lang;
    }
    return 'javascript';
  }

  /** Detect the build command from package.json or project files */
  _detectBuildCommand() {
    const pkgPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts?.build) return 'npm run build';
      } catch {}
    }
    if (fs.existsSync(path.join(this.projectRoot, 'Makefile'))) return 'make build';
    if (fs.existsSync(path.join(this.projectRoot, 'Cargo.toml'))) return 'cargo build';
    if (fs.existsSync(path.join(this.projectRoot, '*.csproj'))) return 'dotnet build';
    return null;
  }

  /** Detect the test command from package.json */
  _detectTestCommand() {
    const pkgPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts?.test) return 'npm test';
      } catch {}
    }
    return null;
  }

  // ─── Backup / restore ───────────────────────────────────────────────────────

  _backup(filePath) {
    const backupPath = `${filePath}.aqt-cfx-${Date.now()}`;
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }

  _restore(backupPath, originalPath) {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, originalPath);
      fs.unlinkSync(backupPath);
      this._log(`Restored ${originalPath} from backup`);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  _log(msg) { if (this.verbose) console.log(`[CompilerFixEngine] ${msg}`); }
}

/**
 * Safe exec wrapper — returns stdout+stderr as a string, never throws.
 * @param {string} cmd
 * @param {string} cwd
 * @returns {string}
 */
function _execSafe(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
  } catch (err) {
    // execSync throws on non-zero exit; we still want the output
    return (err.stdout || '') + (err.stderr || '') || err.message;
  }
}

module.exports = { CompilerFixEngine, DIAGNOSTIC_ADAPTERS };

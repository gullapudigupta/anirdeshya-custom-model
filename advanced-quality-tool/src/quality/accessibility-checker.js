/**
 * Accessibility Checker
 *
 * Checks HTML files for WCAG 2.1 Level AA compliance issues:
 * - Missing alt attributes on images
 * - Missing form labels
 * - Missing ARIA roles/attributes
 * - Poor color contrast hints (structural)
 * - Missing language attribute
 * - Missing document title
 * - Skipped heading levels
 * - Interactive elements without accessible names
 *
 * @module quality/accessibility-checker
 */

'use strict';

const WCAG_LEVELS = { A: 1, AA: 2, AAA: 3 };

class AccessibilityChecker {
  /**
   * @param {object} [options={}]
   * @param {string} [options.wcagLevel='AA'] - Minimum WCAG level to enforce
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.wcagLevel = options.wcagLevel || 'AA';
    this.stats = { filesAnalyzed: 0, issuesFound: 0, byRule: {} };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Analyze an HTML file for accessibility issues.
   * @param {string} filePath
   * @param {string} content - HTML content
   * @returns {{ filePath, issues: object[], summary: object }}
   */
  analyze(filePath, content) {
    this.stats.filesAnalyzed++;
    const issues = [];

    // Only run on HTML-like files
    if (!filePath.match(/\.(html|htm|jsx|tsx|vue|svelte)$/i) &&
        !content.includes('<html') && !content.includes('<body')) {
      return { filePath, issues: [], summary: { total: 0 } };
    }

    issues.push(...this._checkDocumentLang(filePath, content));
    issues.push(...this._checkDocumentTitle(filePath, content));
    issues.push(...this._checkImageAlt(filePath, content));
    issues.push(...this._checkFormLabels(filePath, content));
    issues.push(...this._checkHeadingOrder(filePath, content));
    issues.push(...this._checkLinkText(filePath, content));
    issues.push(...this._checkButtonText(filePath, content));
    issues.push(...this._checkAriaAttributes(filePath, content));
    issues.push(...this._checkTabIndex(filePath, content));
    issues.push(...this._checkSkipNavigation(filePath, content));
    issues.push(...this._checkInputTypes(filePath, content));

    this.stats.issuesFound += issues.length;
    issues.forEach(i => {
      this.stats.byRule[i.rule] = (this.stats.byRule[i.rule] || 0) + 1;
    });

    return {
      filePath,
      issues,
      summary: {
        total: issues.length,
        bySeverity: this._group(issues, 'severity'),
        byRule: this._group(issues, 'rule'),
        wcagLevel: this.wcagLevel
      }
    };
  }

  getStats() { return { ...this.stats }; }

  // ─── Checkers ──────────────────────────────────────────────────────────────

  _checkDocumentLang(filePath, content) {
    const issues = [];
    if (/<html\b/.test(content) && !/<html[^>]+lang\s*=/.test(content)) {
      issues.push(this._make({
        rule: 'html-has-lang', wcag: '3.1.1', level: 'A', filePath, line: 1,
        severity: 'HIGH',
        message: '<html> element is missing a lang attribute.',
        suggestion: 'Add lang="en" (or the appropriate language code) to the <html> element.'
      }));
    }
    return issues;
  }

  _checkDocumentTitle(filePath, content) {
    const issues = [];
    if (/<head\b/.test(content) && !/<title\b/.test(content)) {
      issues.push(this._make({
        rule: 'document-title', wcag: '2.4.2', level: 'A', filePath, line: 1,
        severity: 'HIGH',
        message: 'Page is missing a <title> element.',
        suggestion: 'Add a descriptive <title> inside <head>.'
      }));
    }
    return issues;
  }

  _checkImageAlt(filePath, content) {
    const issues = [];
    const lines = content.split('\n');
    const imgRx = /<img\b([^>]*)>/gi;
    let match;

    for (let i = 0; i < lines.length; i++) {
      while ((match = imgRx.exec(lines[i])) !== null) {
        const attrs = match[1];
        if (!/\balt\s*=/.test(attrs)) {
          issues.push(this._make({
            rule: 'img-alt', wcag: '1.1.1', level: 'A', filePath, line: i + 1,
            severity: 'HIGH',
            message: `<img> element is missing alt attribute: ${match[0].slice(0, 60)}`,
            suggestion: 'Add alt="" for decorative images or a descriptive alt text for informative images.'
          }));
        } else if (/\balt\s*=\s*["']\s*["']/.test(attrs) === false &&
                   /\balt\s*=\s*["'][^"']*(?:image|photo|pic|img)\b/i.test(attrs)) {
          issues.push(this._make({
            rule: 'img-redundant-alt', wcag: '1.1.1', level: 'A', filePath, line: i + 1,
            severity: 'LOW',
            message: 'Alt text contains redundant word like "image" or "photo".',
            suggestion: 'Describe the content of the image, not that it is an image.'
          }));
        }
      }
      imgRx.lastIndex = 0;
    }
    return issues;
  }

  _checkFormLabels(filePath, content) {
    const issues = [];
    const lines = content.split('\n');
    const inputRx = /<input\b([^>]*)>/gi;

    for (let i = 0; i < lines.length; i++) {
      let match;
      while ((match = inputRx.exec(lines[i])) !== null) {
        const attrs = match[1];
        const typeM = attrs.match(/type\s*=\s*["'](\w+)["']/i);
        const inputType = typeM ? typeM[1].toLowerCase() : 'text';

        // hidden, submit, button, image, reset don't need labels
        if (['hidden', 'submit', 'button', 'image', 'reset'].includes(inputType)) continue;

        const hasLabel = /\bid\s*=/.test(attrs) ||
                         /\baria-label\s*=/.test(attrs) ||
                         /\baria-labelledby\s*=/.test(attrs);

        if (!hasLabel) {
          issues.push(this._make({
            rule: 'label-for-input', wcag: '1.3.1', level: 'A', filePath, line: i + 1,
            severity: 'HIGH',
            message: `<input type="${inputType}"> is missing a label (id, aria-label, or aria-labelledby).`,
            suggestion: 'Associate a <label for="inputId"> or add aria-label to the input.'
          }));
        }
      }
      inputRx.lastIndex = 0;
    }
    return issues;
  }

  _checkHeadingOrder(filePath, content) {
    const issues = [];
    const headingRx = /<h([1-6])\b/gi;
    const lines = content.split('\n');
    let prevLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      let match;
      while ((match = headingRx.exec(lines[i])) !== null) {
        const level = parseInt(match[1]);
        if (prevLevel > 0 && level > prevLevel + 1) {
          issues.push(this._make({
            rule: 'heading-order', wcag: '1.3.1', level: 'A', filePath, line: i + 1,
            severity: 'MEDIUM',
            message: `Heading level skipped: h${prevLevel} → h${level}.`,
            suggestion: `Use h${prevLevel + 1} instead of h${level} to maintain heading hierarchy.`
          }));
        }
        prevLevel = level;
      }
      headingRx.lastIndex = 0;
    }
    return issues;
  }

  _checkLinkText(filePath, content) {
    const issues = [];
    const lines = content.split('\n');
    const linkRx = /<a\b[^>]*>([^<]*)<\/a>/gi;

    for (let i = 0; i < lines.length; i++) {
      let match;
      while ((match = linkRx.exec(lines[i])) !== null) {
        const text = match[1].trim().toLowerCase();
        const attrs = match[0];
        const hasAriaLabel = /aria-label\s*=/.test(attrs);
        if (!hasAriaLabel && (!text || ['click here', 'here', 'read more', 'more', 'link'].includes(text))) {
          issues.push(this._make({
            rule: 'link-name', wcag: '2.4.4', level: 'A', filePath, line: i + 1,
            severity: 'HIGH',
            message: `Link has non-descriptive text: "${text || '(empty)'}".`,
            suggestion: 'Use descriptive link text that makes sense out of context.'
          }));
        }
      }
      linkRx.lastIndex = 0;
    }
    return issues;
  }

  _checkButtonText(filePath, content) {
    const issues = [];
    const lines = content.split('\n');
    const btnRx = /<button\b([^>]*)>(.*?)<\/button>/gi;

    for (let i = 0; i < lines.length; i++) {
      let match;
      while ((match = btnRx.exec(lines[i])) !== null) {
        const attrs = match[1];
        const innerText = match[2].replace(/<[^>]+>/g, '').trim();
        const hasAriaLabel = /aria-label\s*=/.test(attrs);
        if (!hasAriaLabel && !innerText) {
          issues.push(this._make({
            rule: 'button-name', wcag: '4.1.2', level: 'A', filePath, line: i + 1,
            severity: 'HIGH',
            message: '<button> element has no accessible name.',
            suggestion: 'Add text content or an aria-label to the button.'
          }));
        }
      }
      btnRx.lastIndex = 0;
    }
    return issues;
  }

  _checkAriaAttributes(filePath, content) {
    const issues = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // aria-hidden="true" on focusable elements
      if (/aria-hidden\s*=\s*["']true["']/.test(line) &&
          /<(?:a|button|input|select|textarea)\b/.test(line)) {
        issues.push(this._make({
          rule: 'aria-hidden-focus', wcag: '4.1.2', level: 'A', filePath, line: i + 1,
          severity: 'HIGH',
          message: 'Focusable element has aria-hidden="true".',
          suggestion: 'Remove aria-hidden from focusable elements or add tabindex="-1".'
        }));
      }
      // role without required owned elements
      if (/\brole\s*=\s*["'](list|grid|tree|table)["']/.test(line)) {
        const role = line.match(/\brole\s*=\s*["'](\w+)["']/)[1];
        // Basic check — just flag that required children need attention
        issues.push(this._make({
          rule: 'required-children', wcag: '1.3.1', level: 'A', filePath, line: i + 1,
          severity: 'LOW',
          message: `role="${role}" may require specific owned elements (children).`,
          suggestion: `Verify that all required owned elements for role="${role}" are present.`
        }));
      }
    }
    return issues;
  }

  _checkTabIndex(filePath, content) {
    const issues = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/tabindex\s*=\s*["'](\d+)["']/);
      if (m && parseInt(m[1]) > 0) {
        issues.push(this._make({
          rule: 'tabindex-positive', wcag: '2.4.3', level: 'A', filePath, line: i + 1,
          severity: 'MEDIUM',
          message: `Positive tabindex="${m[1]}" disrupts natural tab order.`,
          suggestion: 'Use tabindex="0" to include elements in natural tab order, or tabindex="-1" to exclude them.'
        }));
      }
    }
    return issues;
  }

  _checkSkipNavigation(filePath, content) {
    const issues = [];
    if (/<nav\b/.test(content) && !/<a\b[^>]*href\s*=\s*["']#/.test(content)) {
      issues.push(this._make({
        rule: 'skip-link', wcag: '2.4.1', level: 'A', filePath, line: 1,
        severity: 'MEDIUM',
        message: 'Page has navigation but no skip-to-main-content link.',
        suggestion: 'Add a "Skip to main content" link as the first focusable element on the page.'
      }));
    }
    return issues;
  }

  _checkInputTypes(filePath, content) {
    const issues = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      // input without explicit type defaults to text — flag to ensure it's intentional
      if (/<input\b(?![^>]*\btype\s*=)[^>]*>/.test(lines[i])) {
        issues.push(this._make({
          rule: 'input-type-explicit', wcag: '1.3.5', level: 'AA', filePath, line: i + 1,
          severity: 'LOW',
          message: '<input> element is missing an explicit type attribute.',
          suggestion: 'Specify type="text", type="email", etc. to improve semantic clarity and mobile UX.'
        }));
      }
    }
    return issues;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _make({ rule, wcag, level, filePath, line, severity, message, suggestion }) {
    return {
      type: 'accessibility',
      rule,
      wcag,
      wcagLevel: level,
      severity,
      filePath,
      line,
      message,
      suggestion,
      detectedAt: new Date().toISOString()
    };
  }

  _group(arr, key) {
    return arr.reduce((acc, item) => {
      acc[item[key]] = (acc[item[key]] || 0) + 1;
      return acc;
    }, {});
  }

  _log(msg) { if (this.verbose) console.log(`[AccessibilityChecker] ${msg}`); }
}

module.exports = { AccessibilityChecker };

/**
 * Self-Explanatory Prompt Builder (P6-T007)
 *
 * Assembles a prompt that clearly explains the issue and the expected fix, embeds
 * the minimal code context from the CodeContextAnalyzer, and asks the model to
 * respond with line-level edits (not a full-file rewrite).
 *
 * Responsibilities:
 *   - Self-explanatory prompt template (what / why / how framing)
 *   - Line-edit request formatter with a strict, parseable output contract
 *   - Token budget manager (trims context before the model call)
 *   - Output format specification the downstream applicator can rely on
 *
 * Pure string assembly — no model calls happen here.
 */

'use strict';

const { estimateTokens } = require('./issue-classifier');

const DEFAULT_OPTIONS = {
  tokenBudget: 2000,   // total prompt budget (system + user)
  maxContextTokens: 300,
  template: null
};

/**
 * The output contract we require from the model. Kept strict so line-editor
 * (P6-T010) can parse it deterministically.
 */
const OUTPUT_CONTRACT = [
  'Respond ONLY with a JSON object matching this shape:',
  '{',
  '  "edits": [',
  '    { "startLine": <number>, "endLine": <number>, "replacement": "<new code for those lines>" }',
  '  ],',
  '  "explanation": "<one sentence describing the fix>"',
  '}',
  'Rules:',
  '- Use the SAME line numbers shown in the CODE CONTEXT block.',
  '- Only include lines that actually change. Do not rewrite the whole file.',
  '- Preserve surrounding indentation and style.',
  '- If you cannot fix it safely, return {"edits": [], "explanation": "<why>"}.'
].join('\n');

const SYSTEM_PROMPT =
  'You are a precise code-fixing assistant. You make the smallest correct change ' +
  'that resolves the reported issue and never introduce unrelated edits.';

class PromptBuilder {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Build a full prompt from a classification (P6-T001) and a context bundle (P6-T002).
   * @param {object} classification Result of IssueClassifier.classify()
   * @param {object} context Result of CodeContextAnalyzer.analyze()
   * @returns {object} { system, user, tokens, withinBudget }
   */
  build(classification, context) {
    const contextBlock = this._buildContextBlock(context);
    const user = this.options.template
      ? this._renderTemplate(classification, contextBlock)
      : this._assembleUser(classification, contextBlock);

    let prompt = { system: SYSTEM_PROMPT, user };
    let tokens = estimateTokens(prompt.system) + estimateTokens(prompt.user);

    if (tokens > this.options.tokenBudget) {
      // Rebuild with a trimmed context block.
      const trimmed = this._trimContextBlock(contextBlock);
      prompt.user = this.options.template
        ? this._renderTemplate(classification, trimmed)
        : this._assembleUser(classification, trimmed);
      tokens = estimateTokens(prompt.system) + estimateTokens(prompt.user);
    }

    return {
      ...prompt,
      tokens,
      withinBudget: tokens <= this.options.tokenBudget
    };
  }

  _renderTemplate(classification, contextBlock) {
    const { explanation = {}, summary = '', severity = 'unknown', category = 'unknown' } = classification || {};
    const values = {
      severity,
      category,
      summary,
      what: explanation.what || 'A code quality issue was detected.',
      why: explanation.why || 'It deviates from project standards.',
      how: explanation.how || 'Adjust the flagged code to satisfy the rule.',
      context: contextBlock,
      outputContract: OUTPUT_CONTRACT
    };
    return this.options.template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g, (token, field) => {
      if (!Object.prototype.hasOwnProperty.call(values, field)) {
        throw new Error(`Unknown AI template placeholder: ${field}`);
      }
      return String(values[field]);
    });
  }

  // ─── Assembly ────────────────────────────────────────────────────────────────

  _assembleUser(classification, contextBlock) {
    const { explanation = {}, summary, severity, category } = classification;
    const parts = [
      '## ISSUE',
      `Severity: ${severity}  |  Category: ${category}`,
      summary ? `Summary: ${summary}` : null,
      '',
      '### What',
      explanation.what || 'A code quality issue was detected.',
      '### Why it matters',
      explanation.why || 'It deviates from project standards.',
      '### How to fix',
      explanation.how || 'Adjust the flagged code to satisfy the rule.',
      '',
      '## CODE CONTEXT',
      contextBlock,
      '',
      '## OUTPUT FORMAT',
      OUTPUT_CONTRACT
    ].filter((p) => p !== null);

    return parts.join('\n');
  }

  /**
   * Format the context bundle with 1-based, line-numbered source so the model
   * can reference exact lines in its edits.
   */
  _buildContextBlock(context) {
    if (!context || !context.snippet) return 'No source context available.';

    const { snippet, enclosingSymbol, relatedSymbols, imports } = context;
    const numbered = this._numberLines(snippet.text, snippet.startLine);

    const lines = [`File: ${context.file}`];
    if (enclosingSymbol) {
      lines.push(`Enclosing symbol: ${enclosingSymbol.type} ${enclosingSymbol.name} (line ${enclosingSymbol.line})`);
    }
    if (imports && imports.length) {
      lines.push('Imports:');
      lines.push(...imports.map((i) => `  ${i}`));
    }
    lines.push('```');
    lines.push(numbered);
    lines.push('```');
    if (relatedSymbols && relatedSymbols.length) {
      const names = relatedSymbols
        .map((s) => (s.file ? `${s.name} (${s.type} @ ${s.file}:${s.line ?? '?'})` : `${s.name} (${s.type})`))
        .join(', ');
      lines.push(`Related symbols: ${names}`);
    }
    return lines.join('\n');
  }

  _numberLines(text, startLine) {
    if (!text) return '';
    return text.split('\n')
      .map((line, i) => `${startLine + i}| ${line}`)
      .join('\n');
  }

  /**
   * Aggressively trim the context block when the whole prompt exceeds budget.
   * Keeps the numbered code fence (the most important part) and drops the rest.
   */
  _trimContextBlock(block) {
    const fenceStart = block.indexOf('```');
    const fenceEnd = block.lastIndexOf('```');
    if (fenceStart === -1 || fenceEnd === fenceStart) return block;

    const header = block.slice(0, fenceStart).split('\n')[0]; // keep the "File:" line
    const codeFence = block.slice(fenceStart, fenceEnd + 3);
    return [header, codeFence].join('\n');
  }
}

module.exports = { PromptBuilder, OUTPUT_CONTRACT, SYSTEM_PROMPT };

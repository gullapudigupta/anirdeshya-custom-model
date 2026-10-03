/**
 * Custom Rule Creation UI
 *
 * Server-side handler that serves and processes the custom rule creation
 * interface. Allows users to define, test, and save custom quality rules
 * via a browser UI backed by the CustomRuleEngine.
 *
 * Inspired by: ESLint custom rules
 *
 * @module ui/custom-rule-ui
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { CustomRuleEngine } = require('../rules/custom-rule-engine');

/**
 * CustomRuleUI — serves HTML UI and handles rule CRUD via simple HTTP handlers.
 * Designed to plug into the existing websocket/HTTP server in websocket-server.js.
 */
class CustomRuleUI {
  /**
   * @param {object} [options={}]
   * @param {string} [options.rulesDir] - Directory where user rules are persisted
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.rulesDir = options.rulesDir ||
      path.join(process.cwd(), '.quality-tool', 'rules');

    this.engine = new CustomRuleEngine({ rulesDir: this.rulesDir, verbose: this.verbose });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Return the HTML page for the custom rule creation UI.
   * @returns {string} HTML
   */
  getPage() {
    return this._buildHTML();
  }

  /**
   * Handle an API request (called from the HTTP/WS router).
   * @param {string} method  - GET | POST | PUT | DELETE
   * @param {string} urlPath - e.g. '/api/rules', '/api/rules/my-rule'
   * @param {object} body    - Parsed JSON body (for POST/PUT)
   * @returns {{ status: number, body: object }}
   */
  handleRequest(method, urlPath, body = {}) {
    const parts = urlPath.replace(/^\/api\/rules\/?/, '').split('/').filter(Boolean);
    const ruleId = parts[0] || null;

    switch (`${method} ${ruleId ? 'ONE' : 'ALL'}`) {
      case 'GET ALL':    return this._listRules();
      case 'GET ONE':    return this._getRule(ruleId);
      case 'POST ALL':   return this._createRule(body);
      case 'PUT ONE':    return this._updateRule(ruleId, body);
      case 'DELETE ONE': return this._deleteRule(ruleId);
      default:
        return { status: 405, body: { error: 'Method not allowed' } };
    }
  }

  /**
   * Test a rule definition against a code snippet without saving.
   * @param {object} ruleDefinition
   * @param {string} code - Code snippet to test against
   * @returns {{ valid: boolean, issues: object[], error?: string }}
   */
  testRule(ruleDefinition, code) {
    const tempEngine = new CustomRuleEngine({ verbose: false });
    if (!tempEngine.validateRule(ruleDefinition)) {
      return { valid: false, issues: [], error: 'Invalid rule definition — missing id, name, severity, or template/check.' };
    }
    tempEngine.addRule(ruleDefinition);
    try {
      const result = tempEngine.runRulesSync('preview.js', code);
      return { valid: true, issues: result.issues };
    } catch (err) {
      return { valid: false, issues: [], error: err.message };
    }
  }

  /**
   * Get available rule templates for the UI dropdown.
   * @returns {object[]}
   */
  getTemplates() {
    return this.engine.getTemplates();
  }

  // ─── CRUD handlers ─────────────────────────────────────────────────────────

  _listRules() {
    try {
      this.engine.loadRulesSync();
      return { status: 200, body: { rules: this.engine.listRules() } };
    } catch (err) {
      return { status: 500, body: { error: err.message } };
    }
  }

  _getRule(ruleId) {
    this.engine.loadRulesSync();
    const rule = this.engine.getRule(ruleId);
    if (!rule) return { status: 404, body: { error: `Rule '${ruleId}' not found` } };
    return { status: 200, body: { rule } };
  }

  _createRule(body) {
    const { rule } = body;
    if (!rule) return { status: 400, body: { error: 'Request body must contain a "rule" object' } };
    if (!this.engine.validateRule(rule)) {
      return { status: 422, body: { error: 'Invalid rule — must have id, name, severity, and template or check' } };
    }
    try {
      this._saveRuleFile(rule);
      this.engine.addRule(rule);
      return { status: 201, body: { rule: this.engine.listRules().find(r => r.id === rule.id) } };
    } catch (err) {
      return { status: 500, body: { error: err.message } };
    }
  }

  _updateRule(ruleId, body) {
    const { rule } = body;
    if (!rule) return { status: 400, body: { error: 'Request body must contain a "rule" object' } };
    rule.id = ruleId;
    if (!this.engine.validateRule(rule)) {
      return { status: 422, body: { error: 'Invalid rule definition' } };
    }
    try {
      this._saveRuleFile(rule);
      this.engine.rules.set(ruleId, rule);
      return { status: 200, body: { rule } };
    } catch (err) {
      return { status: 500, body: { error: err.message } };
    }
  }

  _deleteRule(ruleId) {
    const ruleFile = path.join(this.rulesDir, `${ruleId}.json`);
    if (this.engine.rules.has(ruleId)) this.engine.rules.delete(ruleId);
    if (fs.existsSync(ruleFile)) {
      fs.unlinkSync(ruleFile);
      return { status: 200, body: { message: `Rule '${ruleId}' deleted` } };
    }
    return { status: 404, body: { error: `Rule '${ruleId}' not found` } };
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  _saveRuleFile(rule) {
    if (!fs.existsSync(this.rulesDir)) {
      fs.mkdirSync(this.rulesDir, { recursive: true });
    }
    const filePath = path.join(this.rulesDir, `${rule.id}.json`);
    // Omit function-type check fields before serialising (they can't round-trip as JSON)
    const serialisable = Object.assign({}, rule);
    if (typeof serialisable.check === 'function') delete serialisable.check;
    fs.writeFileSync(filePath, JSON.stringify(serialisable, null, 2) + '\n');
  }

  // ─── HTML builder ──────────────────────────────────────────────────────────

  _buildHTML() {
    const templates = this.engine.getTemplates()
      .map(t => `<option value="${t.id}">${t.name}</option>`)
      .join('\n            ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Custom Rule Editor — Advanced Quality Tool</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#1e1e2e;color:#cdd6f4;min-height:100vh}
    header{background:#181825;padding:1rem 2rem;border-bottom:1px solid #313244;display:flex;align-items:center;gap:1rem}
    header h1{font-size:1.2rem;font-weight:600}
    .badge{background:#89b4fa;color:#1e1e2e;padding:.2rem .6rem;border-radius:9999px;font-size:.75rem;font-weight:700}
    main{display:grid;grid-template-columns:300px 1fr;gap:0;height:calc(100vh - 56px)}
    .sidebar{background:#181825;border-right:1px solid #313244;overflow-y:auto;padding:1rem}
    .sidebar h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:#6c7086;margin-bottom:.75rem}
    .rule-item{padding:.6rem .75rem;border-radius:6px;cursor:pointer;margin-bottom:.25rem;font-size:.9rem;display:flex;justify-content:space-between;align-items:center}
    .rule-item:hover,.rule-item.active{background:#313244}
    .rule-item .del{color:#f38ba8;font-size:.75rem;cursor:pointer;padding:.1rem .3rem;border-radius:4px}
    .rule-item .del:hover{background:#f38ba822}
    .btn-new{width:100%;padding:.5rem;background:#89b4fa;color:#1e1e2e;border:none;border-radius:6px;font-weight:600;cursor:pointer;margin-bottom:1rem;font-size:.875rem}
    .btn-new:hover{background:#74c7ec}
    .editor{padding:1.5rem;overflow-y:auto}
    .editor h2{font-size:1rem;font-weight:600;margin-bottom:1rem;color:#89b4fa}
    .form-group{margin-bottom:1rem}
    label{display:block;font-size:.8rem;color:#a6adc8;margin-bottom:.3rem;font-weight:500}
    input,select,textarea{width:100%;background:#313244;border:1px solid #45475a;color:#cdd6f4;padding:.5rem .75rem;border-radius:6px;font-size:.875rem;font-family:inherit}
    input:focus,select:focus,textarea:focus{outline:none;border-color:#89b4fa}
    textarea{resize:vertical;min-height:80px;font-family:monospace}
    .form-row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
    .actions{display:flex;gap:.75rem;margin-top:1.5rem}
    .btn{padding:.5rem 1rem;border-radius:6px;border:none;cursor:pointer;font-weight:600;font-size:.875rem}
    .btn-primary{background:#a6e3a1;color:#1e1e2e}
    .btn-primary:hover{background:#94e2d5}
    .btn-secondary{background:#45475a;color:#cdd6f4}
    .btn-secondary:hover{background:#585b70}
    .btn-danger{background:#f38ba8;color:#1e1e2e}
    .divider{border:none;border-top:1px solid #313244;margin:1.5rem 0}
    .test-area{margin-top:1rem}
    .test-area h3{font-size:.875rem;font-weight:600;color:#fab387;margin-bottom:.5rem}
    #testOutput{margin-top:.75rem;padding:.75rem;background:#11111b;border-radius:6px;font-family:monospace;font-size:.8rem;min-height:60px;white-space:pre-wrap;color:#a6e3a1}
    #testOutput.has-issues{color:#f38ba8}
    .empty-state{text-align:center;padding:3rem 1rem;color:#6c7086}
    .severity-HIGH{color:#f38ba8} .severity-MEDIUM{color:#fab387} .severity-LOW{color:#f9e2af}
  </style>
</head>
<body>
<header>
  <h1>Custom Rule Editor</h1>
  <span class="badge">Advanced Quality Tool</span>
</header>
<main>
  <nav class="sidebar">
    <button class="btn-new" onclick="newRule()">+ New Rule</button>
    <h2>Your Rules</h2>
    <div id="ruleList"><p class="empty-state" style="font-size:.8rem">No rules yet</p></div>
  </nav>
  <section class="editor">
    <div id="editorContent">
      <div class="empty-state">
        <p style="font-size:2rem;margin-bottom:.5rem">📋</p>
        <p>Select a rule to edit, or create a new one.</p>
      </div>
    </div>
  </section>
</main>

<script>
  let rules = [];
  let currentId = null;

  async function loadRules() {
    try {
      const res = await fetch('/api/rules');
      const data = await res.json();
      rules = data.rules || [];
      renderList();
    } catch(e) { console.error('Failed to load rules', e); }
  }

  function renderList() {
    const el = document.getElementById('ruleList');
    if (!rules.length) { el.innerHTML = '<p style="font-size:.8rem;color:#6c7086">No rules yet</p>'; return; }
    el.innerHTML = rules.map(r => \`
      <div class="rule-item \${r.id === currentId ? 'active' : ''}" onclick="editRule('\${r.id}')">
        <span>\${r.name}</span>
        <span class="del severity-\${r.severity}" onclick="deleteRule(event,'\${r.id}')">\${r.severity}</span>
      </div>\`).join('');
  }

  function newRule() {
    currentId = null;
    renderForm({ id:'', name:'', description:'', severity:'MEDIUM', template:'pattern', pattern:'', message:'' });
  }

  async function editRule(id) {
    currentId = id;
    const rule = rules.find(r => r.id === id);
    if (rule) renderForm(rule);
    renderList();
  }

  function renderForm(rule) {
    document.getElementById('editorContent').innerHTML = \`
      <h2>\${rule.id ? 'Edit Rule' : 'New Rule'}</h2>
      <div class="form-row">
        <div class="form-group">
          <label for="rId">Rule ID</label>
          <input id="rId" value="\${rule.id||''}" placeholder="no-console-log" \${rule.id ? 'readonly' : ''}/>
        </div>
        <div class="form-group">
          <label for="rSeverity">Severity</label>
          <select id="rSeverity">
            \${['CRITICAL','HIGH','MEDIUM','LOW','INFO'].map(s=>\`<option \${rule.severity===s?'selected':''}>\${s}</option>\`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label for="rName">Name</label>
        <input id="rName" value="\${rule.name||''}" placeholder="No console.log statements"/>
      </div>
      <div class="form-group">
        <label for="rDesc">Description</label>
        <input id="rDesc" value="\${rule.description||''}" placeholder="Detects console.log left in production"/>
      </div>
      <div class="form-group">
        <label for="rTemplate">Template</label>
        <select id="rTemplate" onchange="onTemplateChange()">
          ${templates}
        </select>
      </div>
      <div id="templateFields"></div>
      <hr class="divider"/>
      <div class="test-area">
        <h3>🧪 Test Rule</h3>
        <div class="form-group">
          <label>Code snippet to test against</label>
          <textarea id="testCode" rows="5" placeholder="Paste some code here to test your rule..."></textarea>
        </div>
        <div class="actions">
          <button class="btn btn-secondary" onclick="testRule()">Run Test</button>
          <button class="btn btn-primary" onclick="saveRule()">Save Rule</button>
        </div>
        <div id="testOutput">Test output will appear here.</div>
      </div>\`;
    // Populate template fields
    document.getElementById('rTemplate').value = rule.template || 'pattern';
    onTemplateChange(rule);
  }

  function onTemplateChange(rule) {
    const tpl = document.getElementById('rTemplate').value;
    const el = document.getElementById('templateFields');
    const val = (k) => rule && rule[k] !== undefined ? rule[k] : '';
    if (tpl === 'pattern') {
      el.innerHTML = \`
        <div class="form-group"><label>Regex Pattern</label>
          <input id="rPattern" value="\${val('pattern')}" placeholder="console\\.log"/></div>
        <div class="form-group"><label>Message</label>
          <input id="rMessage" value="\${val('message')}" placeholder="Avoid console.log in production"/></div>\`;
    } else if (tpl === 'functionComplexity') {
      el.innerHTML = \`
        <div class="form-group"><label>Max Complexity</label>
          <input id="rMaxComplexity" type="number" value="\${val('maxComplexity')||10}"/></div>
        <div class="form-group"><label>Message</label>
          <input id="rMessage" value="\${val('message')}" placeholder="Function is too complex"/></div>\`;
    } else if (tpl === 'naming') {
      el.innerHTML = \`
        <div class="form-row">
          <div class="form-group"><label>Target</label>
            <select id="rTarget">
              \${['variable','function','class'].map(t=>\`<option \${val('target')===t?'selected':''}>\${t}</option>\`).join('')}
            </select></div>
          <div class="form-group"><label>Pattern (Regex)</label>
            <input id="rPattern" value="\${val('pattern')}" placeholder="^[a-z][a-zA-Z0-9]*$"/></div>
        </div>
        <div class="form-group"><label>Message</label>
          <input id="rMessage" value="\${val('message')}" placeholder="Name violates convention"/></div>\`;
    } else {
      el.innerHTML = \`<div class="form-group"><label>Message</label>
        <input id="rMessage" value="\${val('message')}" placeholder="Rule message"/></div>\`;
    }
  }

  function gatherRule() {
    const tpl = document.getElementById('rTemplate').value;
    const rule = {
      id: document.getElementById('rId').value.trim(),
      name: document.getElementById('rName').value.trim(),
      description: document.getElementById('rDesc').value.trim(),
      severity: document.getElementById('rSeverity').value,
      template: tpl
    };
    const msg = document.getElementById('rMessage');
    if (msg) rule.message = msg.value.trim();
    const pat = document.getElementById('rPattern');
    if (pat) rule.pattern = pat.value.trim();
    const mx = document.getElementById('rMaxComplexity');
    if (mx) rule.maxComplexity = parseInt(mx.value) || 10;
    const tgt = document.getElementById('rTarget');
    if (tgt) rule.target = tgt.value;
    return rule;
  }

  async function saveRule() {
    const rule = gatherRule();
    if (!rule.id || !rule.name) { alert('Rule ID and Name are required.'); return; }
    const method = currentId ? 'PUT' : 'POST';
    const url = currentId ? \`/api/rules/\${currentId}\` : '/api/rules';
    const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify({ rule }) });
    const data = await res.json();
    if (res.ok) { await loadRules(); currentId = rule.id; renderList(); alert('Rule saved!'); }
    else alert('Error: ' + (data.error || 'Unknown error'));
  }

  async function deleteRule(e, id) {
    e.stopPropagation();
    if (!confirm(\`Delete rule "\${id}"?\`)) return;
    await fetch(\`/api/rules/\${id}\`, { method: 'DELETE' });
    currentId = null;
    await loadRules();
    document.getElementById('editorContent').innerHTML = '<div class="empty-state"><p>Rule deleted.</p></div>';
  }

  async function testRule() {
    const rule = gatherRule();
    const code = document.getElementById('testCode').value;
    const out = document.getElementById('testOutput');
    out.textContent = 'Testing…';
    out.className = '';
    try {
      const res = await fetch('/api/rules/test', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rule, code })
      });
      const data = await res.json();
      if (!data.valid) { out.textContent = 'Invalid rule: ' + data.error; out.className = 'has-issues'; return; }
      if (!data.issues.length) { out.textContent = '✅ No issues found — rule did not match.'; }
      else {
        out.className = 'has-issues';
        out.textContent = data.issues.map(i => \`Line \${i.line||'?'}: \${i.description||i.message}\`).join('\\n');
      }
    } catch(e) { out.textContent = 'Error: ' + e.message; out.className = 'has-issues'; }
  }

  loadRules();
</script>
</body>
</html>`;
  }

  _log(msg) { if (this.verbose) console.log(`[CustomRuleUI] ${msg}`); }
}

module.exports = { CustomRuleUI };

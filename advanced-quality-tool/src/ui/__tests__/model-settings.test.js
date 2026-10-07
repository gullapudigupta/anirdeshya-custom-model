'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

test('AI settings restore and save provider model selections', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'chat-ui.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'chat-ui.js'), 'utf8');
  const calls = [];
  const dom = new JSDOM(html, { url: 'http://localhost', runScripts: 'outside-only' });
  dom.window.WebSocket = class {
    static OPEN = 1;
    constructor() { this.readyState = 1; }
    close() { this.readyState = 3; }
    send() {}
  };
  dom.window.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      statusText: 'OK',
      json: async () => ({
        success: true,
        data: {
          provider: 'ollama',
          model: 'offline-custom-1',
          maxCost: 1,
          monthlyBudget: 100,
          requestsPerMinute: 20,
          credentialsConfigured: true
        }
      })
    };
  };
  try {
    const ready = new Promise(resolve => {
      dom.window.document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
    dom.window.eval(script);
    await ready;

    const document = dom.window.document;
    document.getElementById('settingsBtn').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const provider = document.getElementById('aiSettingsProvider');
    const model = document.getElementById('aiSettingsModel');
    const customModel = document.getElementById('aiSettingsCustomModel');
    const customModelGroup = document.getElementById('aiSettingsCustomModelGroup');
    assert.strictEqual(model.value, '__custom__');
    assert.strictEqual(customModel.value, 'offline-custom-1');
    assert.strictEqual(customModelGroup.hidden, false);

    provider.value = 'ollama';
    provider.dispatchEvent(new dom.window.Event('change'));
    assert([...model.options].some(option => option.value === 'codellama:7b'));
    model.value = 'mistral';
    model.dispatchEvent(new dom.window.Event('change'));
    assert.strictEqual(customModelGroup.hidden, true);
    document.getElementById('settingsForm').dispatchEvent(
      new dom.window.Event('submit', { cancelable: true })
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    const save = calls.find(call => call.url.endsWith('/api/ai/configure'));
    assert(save);
    assert.strictEqual(JSON.parse(save.options.body).model, 'mistral');
  } finally {
    dom.window.close();
  }
});

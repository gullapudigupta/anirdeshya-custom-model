# Plugin Development

A project plugin is a directory containing `plugin.json` and `index.js`.
Place plugins in the configured project plugin directory (normally `plugins/`).
The loader checks `id`, `name`, `version`, and `apiVersion`; the plugin API major
version must match the host's supported major version.

```json
{
  "id": "sample-rule",
  "name": "Sample rule",
  "version": "1.0.0",
  "apiVersion": "1.0.0"
}
```

The entry point runs in the plugin manager's VM context and exports a class:

```javascript
module.exports = class SampleRulePlugin {
  constructor(api) {
    this.api = api;
  }

  async onLoad() {
    this.api.registerRule({
      id: 'no-todo-marker',
      name: 'Avoid TODO markers',
      severity: 'low',
      check: (source) => source.includes('TODO')
    });
  }
};
```

The plugin API includes `registerRule`, `registerHook`, `log`, a read-only
`fs.readFile`, and restricted path helpers. Only `path` and `crypto` are
available through `require`. Do not treat VM isolation as a security boundary:
only install reviewed plugins. Lifecycle can be managed using `aqt plugin list`,
`aqt plugin disable <id>`, and `aqt plugin enable <id>`.

Runnable examples are in [`examples/plugins/`](../examples/plugins/).

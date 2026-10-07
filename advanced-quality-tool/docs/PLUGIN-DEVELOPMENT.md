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
      // Rules receive (filePath, ast, context).
      check: (filePath, ast, context = {}) => {
        const source = typeof context.source === 'string' ? context.source : this.api.fs.readFile(filePath);
        return source.includes('TODO')
          ? { file: filePath, severity: 'low', message: 'TODO marker found' }
          : null;
      }
    });
  }
};
```

A plugin can also be a single `.js` file whose manifest is a `/* @plugin { ... } */`
comment at the top; see the single-file examples below.

The plugin API includes `registerRule`, `registerHook`, `log`, a read-only
`fs.readFile`, and restricted path helpers. Only `path` and `crypto` are
available through `require`. Do not treat VM isolation as a security boundary:
only install reviewed plugins. Lifecycle can be managed using `aqt plugin list`,
`aqt plugin disable <id>`, and `aqt plugin enable <id>`.

Runnable examples are in [`examples/plugins/`](../examples/plugins/); see its
[README](../examples/plugins/README.md) for what each example demonstrates and
how its hooks are invoked.

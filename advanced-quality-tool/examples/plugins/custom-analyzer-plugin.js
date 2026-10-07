/* @plugin
{
  "id": "custom-analyzer",
  "name": "Custom analyzer example",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "description": "Registers a custom rule that reports lines longer than 120 characters."
}
*/
'use strict';

const MAX_LINE_LENGTH = 120;

module.exports = class CustomAnalyzerPlugin {
  constructor(api) {
    this.api = api;
  }

  async onLoad() {
    this.api.registerRule({
      id: 'max-line-length',
      name: `Lines should not exceed ${MAX_LINE_LENGTH} characters`,
      severity: 'low',
      // Rules receive (filePath, ast, context); pass context.source to avoid a file read.
      check: (filePath, ast, context = {}) => {
        const source = typeof context.source === 'string'
          ? context.source
          : this.api.fs.readFile(filePath);

        return source.split(/\r?\n/).flatMap((line, index) => line.length > MAX_LINE_LENGTH
          ? [{
            file: filePath,
            line: index + 1,
            column: MAX_LINE_LENGTH + 1,
            severity: 'low',
            message: `Line is ${line.length} characters long (limit ${MAX_LINE_LENGTH})`
          }]
          : []);
      }
    });
  }
};

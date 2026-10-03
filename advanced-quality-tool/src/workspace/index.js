/**
 * Workspace and Package-Driven Configuration (P9-T007, P9-T012)
 *
 * Workspace resolution, package.json analysis, linter configuration,
 * and context assembly that never hard-codes paths and always uses
 * the selected project's config.
 *
 * @module workspace
 */

'use strict';

const { WorkspaceResolver } = require('./workspace-resolver');
const { PackageConfigReader } = require('./package-config-reader');
const { LinterConfigManager } = require('./linter-config-manager');
const { ContextAssembler, ContextSourceType } = require('./context-assembler');

module.exports = {
  WorkspaceResolver,
  PackageConfigReader,
  LinterConfigManager,
  ContextAssembler,
  ContextSourceType
};

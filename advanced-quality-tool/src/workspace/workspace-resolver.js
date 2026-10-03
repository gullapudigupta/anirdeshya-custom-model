/**
 * Workspace Resolver (P9-T007)
 *
 * Resolves the active project root from opened workspace or explicit selection.
 * Never hard-codes developer-specific absolute paths.
 *
 * @module workspace/workspace-resolver
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Workspace Resolver
 */
class WorkspaceResolver {
  constructor(options = {}) {
    this.defaultRoot = options.defaultRoot || process.cwd();
    this.workspaceConfig = options.workspaceConfig || null;
  }

  /**
   * Resolve workspace root
   * @param {Object} [options]
   * @param {string} [options.explicitPath] - Explicitly provided workspace path
   * @param {string} [options.contextHint] - Context hint (e.g., from file path)
   * @returns {Object} { root: string, source: string, isMultiRoot: boolean }
   */
  resolve(options = {}) {
    const { explicitPath = null, contextHint = null } = options;

    // Priority 1: Explicit path provided
    if (explicitPath) {
      const normalized = path.resolve(explicitPath);
      if (this._isValidWorkspace(normalized)) {
        return {
          root: normalized,
          source: 'explicit',
          isMultiRoot: false
        };
      }
    }

    // Priority 2: Context hint (e.g., from active file)
    if (contextHint) {
      const workspaceFromContext = this._findWorkspaceFromPath(contextHint);
      if (workspaceFromContext) {
        return {
          root: workspaceFromContext,
          source: 'context',
          isMultiRoot: false
        };
      }
    }

    // Priority 3: Workspace configuration
    if (this.workspaceConfig && this.workspaceConfig.folders) {
      const folders = this.workspaceConfig.folders;
      if (folders.length === 1) {
        return {
          root: path.resolve(folders[0].path),
          source: 'workspace-single',
          isMultiRoot: false
        };
      } else if (folders.length > 1) {
        return {
          root: path.resolve(folders[0].path), // Default to first
          source: 'workspace-multi',
          isMultiRoot: true,
          allRoots: folders.map(f => path.resolve(f.path))
        };
      }
    }

    // Priority 4: Default (current working directory)
    return {
      root: this.defaultRoot,
      source: 'default',
      isMultiRoot: false
    };
  }

  /**
   * Find workspace root from a file path by walking up directories
   * @param {string} filePath
   * @returns {string|null}
   */
  _findWorkspaceFromPath(filePath) {
    let current = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    
    // Walk up until we find workspace markers
    while (current !== path.dirname(current)) {
      if (this._hasWorkspaceMarkers(current)) {
        return current;
      }
      current = path.dirname(current);
    }
    
    return null;
  }

  /**
   * Check if directory has workspace markers
   * @param {string} dir
   * @returns {boolean}
   */
  _hasWorkspaceMarkers(dir) {
    const markers = [
      'package.json',
      '.git',
      'pom.xml',
      'build.gradle',
      'Cargo.toml',
      'go.mod',
      '.aqt-config.json'
    ];

    for (const marker of markers) {
      if (fs.existsSync(path.join(dir, marker))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate workspace path
   * @param {string} workspacePath
   * @returns {boolean}
   */
  _isValidWorkspace(workspacePath) {
    try {
      const stats = fs.statSync(workspacePath);
      return stats.isDirectory() && this._hasWorkspaceMarkers(workspacePath);
    } catch {
      return false;
    }
  }

  /**
   * Get all workspace roots (for multi-root workspaces)
   * @returns {Array<string>}
   */
  getAllRoots() {
    const resolution = this.resolve();
    if (resolution.isMultiRoot && resolution.allRoots) {
      return resolution.allRoots;
    }
    return [resolution.root];
  }
}

module.exports = {
  WorkspaceResolver
};

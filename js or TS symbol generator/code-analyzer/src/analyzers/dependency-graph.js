/**
 * Dependency Graph Builder
 * 
 * Builds and analyzes:
 * - Module dependency graph
 * - Circular dependency detection
 * - Component coupling analysis
 * - Import fan-in / fan-out metrics
 * - Layer violation detection
 * - Orphan detection (unused components/services)
 */

const path = require('path');
const { readFileSafe, getSourceFiles, getLineNumber } = require('../ast-utils');

// ─── Dependency Graph ────────────────────────────────────────────────────────

class DependencyGraph {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.nodes = new Map(); // filePath -> { imports: [], exports: [], type }
    this.edges = [];       // { from, to, type }
    this.issues = [];
  }

  /**
   * Build the dependency graph from source files
   */
  build(files) {
    // First pass: extract imports/exports for each file
    for (const file of files) {
      this._analyzeFile(file);
    }
    
    // Second pass: resolve relative imports to actual files
    this._resolveEdges();
    
    // Third pass: detect issues
    this._detectCircularDependencies();
    this._detectCouplingIssues();
    this._detectLayerViolations();
    this._detectOrphans();
    
    return this;
  }

  /**
   * Analyze a single file for its dependencies
   */
  _analyzeFile(filePath) {
    const content = readFileSafe(filePath);
    if (!content) return;
    
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const imports = [];
    const exports = [];
    
    // Extract imports
    const importRegex = /import\s+(?:type\s+)?(?:\{[^}]+\}|[\w*]+(?:\s*,\s*\{[^}]+\})?)\s+from\s+['"](.*?)['"]/g;
    let match;
    
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      imports.push({
        path: importPath,
        isRelative: importPath.startsWith('.'),
        isThirdParty: !importPath.startsWith('.') && !importPath.startsWith('@angular') && !importPath.startsWith('@capacitor'),
        isAngular: importPath.startsWith('@angular'),
        line: getLineNumber(content, match.index),
      });
    }
    
    // Extract exports
    const exportRegex = /export\s+(?:default\s+)?(?:class|interface|function|const|let|type|enum|abstract)\s+(\w+)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }
    
    // Determine file type
    let fileType = 'other';
    if (content.includes('@Component')) fileType = 'component';
    else if (content.includes('@Injectable')) fileType = 'service';
    else if (content.includes('@Pipe')) fileType = 'pipe';
    else if (content.includes('@Directive')) fileType = 'directive';
    else if (content.includes('@NgModule')) fileType = 'module';
    else if (relativePath.includes('.guard.')) fileType = 'guard';
    else if (relativePath.includes('.interceptor.')) fileType = 'interceptor';
    else if (relativePath.includes('.model') || relativePath.includes('.interface')) fileType = 'model';
    else if (relativePath.includes('.spec.')) fileType = 'test';
    
    this.nodes.set(relativePath, {
      imports,
      exports,
      type: fileType,
      importCount: imports.filter(i => i.isRelative).length,
      thirdPartyImports: imports.filter(i => i.isThirdParty).map(i => i.path),
    });
  }

  /**
   * Resolve relative imports to actual file paths and create edges
   */
  _resolveEdges() {
    const allPaths = Array.from(this.nodes.keys());
    
    for (const [filePath, node] of this.nodes) {
      for (const imp of node.imports) {
        if (!imp.isRelative) continue;
        
        // Resolve relative path
        const dir = path.dirname(filePath);
        let resolvedPath = path.posix.normalize(path.posix.join(dir, imp.path));
        
        // Try to find the actual file (with extensions)
        const extensions = ['.ts', '.js', '/index.ts', '/index.js'];
        let found = false;
        
        for (const ext of extensions) {
          const candidate = resolvedPath + ext;
          if (allPaths.includes(candidate)) {
            this.edges.push({ from: filePath, to: candidate, line: imp.line });
            found = true;
            break;
          }
        }
        
        // Try without extension (might already have one)
        if (!found && allPaths.includes(resolvedPath)) {
          this.edges.push({ from: filePath, to: resolvedPath, line: imp.line });
        }
      }
    }
  }

  /**
   * Detect circular dependencies using DFS
   */
  _detectCircularDependencies() {
    const adjacency = new Map();
    
    for (const edge of this.edges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from).push(edge.to);
    }
    
    const visited = new Set();
    const recursionStack = new Set();
    const cycles = [];
    
    const dfs = (node, pathSoFar) => {
      visited.add(node);
      recursionStack.add(node);
      
      const neighbors = adjacency.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, [...pathSoFar, node]);
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle
          const cycleStart = pathSoFar.indexOf(neighbor);
          if (cycleStart >= 0) {
            cycles.push([...pathSoFar.slice(cycleStart), node, neighbor]);
          } else {
            cycles.push([...pathSoFar.slice(-3), node, neighbor]);
          }
        }
      }
      
      recursionStack.delete(node);
    };
    
    for (const node of this.nodes.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }
    
    // Deduplicate cycles
    const uniqueCycles = new Set();
    for (const cycle of cycles) {
      const key = cycle.sort().join(' → ');
      if (!uniqueCycles.has(key)) {
        uniqueCycles.add(key);
        this.issues.push({
          id: 'dep:circular-dependency',
          severity: 'critical',
          category: 'design',
          title: 'Circular dependency detected',
          description: cycle.join(' → '),
          files: cycle,
        });
      }
    }
  }

  /**
   * Detect coupling issues (high fan-in/fan-out)
   */
  _detectCouplingIssues() {
    // Calculate fan-in (how many files import this file)
    const fanIn = new Map();
    // Calculate fan-out (how many files this file imports)
    const fanOut = new Map();
    
    for (const edge of this.edges) {
      fanIn.set(edge.to, (fanIn.get(edge.to) || 0) + 1);
      fanOut.set(edge.from, (fanOut.get(edge.from) || 0) + 1);
    }
    
    // High fan-out (depends on too many things)
    for (const [file, count] of fanOut) {
      if (count > 15) {
        this.issues.push({
          id: 'dep:high-fan-out',
          severity: 'major',
          category: 'coupling',
          title: `High fan-out: ${file} imports ${count} modules`,
          description: 'This file depends on too many modules. Consider using a facade or splitting.',
          file,
        });
      }
    }
    
    // High fan-in (too many things depend on it)
    for (const [file, count] of fanIn) {
      if (count > 20) {
        this.issues.push({
          id: 'dep:high-fan-in',
          severity: 'info',
          category: 'coupling',
          title: `High fan-in: ${file} is imported by ${count} files`,
          description: 'This is a highly coupled module. Changes here affect many files.',
          file,
        });
      }
    }
  }

  /**
   * Detect layer violations (e.g., UI importing data layer directly)
   */
  _detectLayerViolations() {
    // Define layer hierarchy for Angular apps
    const layers = {
      'component': 1,  // Presentation layer
      'service': 2,    // Business logic
      'model': 3,      // Data models
      'guard': 2,
      'interceptor': 2,
      'pipe': 1,
    };
    
    for (const edge of this.edges) {
      const fromNode = this.nodes.get(edge.from);
      const toNode = this.nodes.get(edge.to);
      
      if (!fromNode || !toNode) continue;
      
      // Components should not import other components (cross-feature coupling)
      if (fromNode.type === 'component' && toNode.type === 'component') {
        // Check if they're in different feature directories
        const fromDir = path.dirname(edge.from).split('/')[2]; // src/app/[feature]
        const toDir = path.dirname(edge.to).split('/')[2];
        
        if (fromDir && toDir && fromDir !== toDir && fromDir !== 'shared' && toDir !== 'shared') {
          this.issues.push({
            id: 'dep:cross-feature-import',
            severity: 'minor',
            category: 'architecture',
            title: `Cross-feature component import: ${path.basename(edge.from)} → ${path.basename(edge.to)}`,
            description: 'Components from different features should communicate via services or shared modules',
            file: edge.from,
          });
        }
      }
    }
  }

  /**
   * Detect orphaned files (not imported by anyone)
   */
  _detectOrphans() {
    const imported = new Set(this.edges.map(e => e.to));
    
    for (const [file, node] of this.nodes) {
      // Skip test files, main.ts, app.module.ts, index files
      if (file.includes('.spec.') || file.includes('main.ts') || 
          file.includes('app.module') || file.includes('index.ts') ||
          file.includes('app.routes') || file.includes('app.config') ||
          file.includes('environment') || file.includes('polyfills')) continue;
      
      if (!imported.has(file) && node.exports.length > 0) {
        this.issues.push({
          id: 'dep:orphan-file',
          severity: 'info',
          category: 'dead-code',
          title: `Potentially orphaned: ${file}`,
          description: 'This file exports symbols but is not imported by any other file',
          file,
        });
      }
    }
  }

  /**
   * Get graph statistics
   */
  getStats() {
    const nodeTypes = {};
    for (const [, node] of this.nodes) {
      nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
    }
    
    return {
      totalFiles: this.nodes.size,
      totalEdges: this.edges.length,
      fileTypes: nodeTypes,
      averageImports: this.edges.length / Math.max(this.nodes.size, 1),
    };
  }

  /**
   * Get all issues
   */
  getIssues() {
    return this.issues;
  }

  /**
   * Get adjacency list representation
   */
  getAdjacencyList() {
    const adj = {};
    for (const edge of this.edges) {
      if (!adj[edge.from]) adj[edge.from] = [];
      adj[edge.from].push(edge.to);
    }
    return adj;
  }

  /**
   * Get most-coupled files
   */
  getMostCoupled(limit = 10) {
    const coupling = new Map();
    
    for (const edge of this.edges) {
      coupling.set(edge.from, (coupling.get(edge.from) || 0) + 1);
      coupling.set(edge.to, (coupling.get(edge.to) || 0) + 1);
    }
    
    return Array.from(coupling.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([file, count]) => ({ file, connections: count }));
  }

  getSummary() {
    const bySeverity = {};
    for (const issue of this.issues) {
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }
    
    return {
      total: this.issues.length,
      bySeverity,
      stats: this.getStats(),
      mostCoupled: this.getMostCoupled(5),
    };
  }
}

module.exports = { DependencyGraph };

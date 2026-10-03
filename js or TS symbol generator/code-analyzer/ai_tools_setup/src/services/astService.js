// src/services/astService.js
// Tree-sitter C# parsing for cross-project AST extraction
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config/config');
const { CacheManager } = require('../utils/cache');

let _parser = null;

async function getParser() {
  if (_parser) return _parser;

  const Parser = (await import('tree-sitter')).default;
  const CSharp = (await import('tree-sitter-c-sharp')).default;

  const parser = new Parser();
  parser.setLanguage(CSharp);
  _parser = parser;
  return parser;
}

class ASTService {
  static async parse(file) {
    const cacheKey = CacheManager.generateKey('ast', file);
    const cached = CacheManager.get(cacheKey);
    if (cached) return cached;

    try {
      const fullPath = path.join(config.repoRoot, file);
      if (!fs.existsSync(fullPath)) {
        logger.warn('File not found for AST parsing', { file: fullPath });
        return null;
      }

      const parser = await getParser();
      const content = fs.readFileSync(fullPath, 'utf-8');
      const tree = parser.parse(content);

      const result = {
        file,
        rootNode: this.nodeToJSON(tree.rootNode),
        size: tree.rootNode.childCount
      };

      CacheManager.set(cacheKey, result);
      return result;
    } catch (error) {
      logger.error('AST parsing error', { error: error.message, file });
      throw error;
    }
  }

  static nodeToJSON(node, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return null;

    const result = {
      type: node.type,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      childCount: node.childCount
    };

    if (node.childCount > 0 && depth < maxDepth) {
      result.children = [];
      for (let i = 0; i < Math.min(node.childCount, 10); i++) {
        const child = node.child(i);
        result.children.push(this.nodeToJSON(child, depth + 1, maxDepth));
      }
    }

    if (node.text && node.text.length < 200) {
      result.text = node.text;
    }

    return result;
  }

  static async findNodesOfType(file, nodeType) {
    const cacheKey = CacheManager.generateKey('ast-nodes', file, nodeType);
    const cached = CacheManager.get(cacheKey);
    if (cached) return cached;

    try {
      const fullPath = path.join(config.repoRoot, file);
      if (!fs.existsSync(fullPath)) return [];

      const parser = await getParser();
      const content = fs.readFileSync(fullPath, 'utf-8');
      const tree = parser.parse(content);
      const nodes = [];

      const traverse = (node) => {
        if (node.type === nodeType) {
          nodes.push({
            type: node.type,
            text: node.text,
            startLine: node.startPosition.row,
            endLine: node.endPosition.row,
            startPosition: node.startPosition,
            endPosition: node.endPosition
          });
        }
        for (let i = 0; i < node.childCount; i++) {
          traverse(node.child(i));
        }
      };

      traverse(tree.rootNode);
      CacheManager.set(cacheKey, nodes);
      return nodes;
    } catch (error) {
      logger.error('AST node finding error', { error: error.message, file, nodeType });
      throw error;
    }
  }

  static async extractMethodNodes(file) {
    const methods = await this.findNodesOfType(file, 'method_declaration');
    return methods.map(m => ({ ...m, shortText: m.text.substring(0, 100) }));
  }

  static async extractClassNodes(file) {
    const classes = await this.findNodesOfType(file, 'class_declaration');
    return classes.map(c => ({ ...c, shortText: c.text.substring(0, 100) }));
  }
}

module.exports = { ASTService };

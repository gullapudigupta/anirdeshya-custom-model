const path = require('path');

const ANALYZER_ROOT_NAMES = Object.freeze(['src', 'functions', 'projects', 'scripts']);

function getAnalyzerRoots(rootDir) {
  return ANALYZER_ROOT_NAMES.map((rootName) => path.join(rootDir, rootName));
}

module.exports = { ANALYZER_ROOT_NAMES, getAnalyzerRoots };

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEvidenceCitations = buildEvidenceCitations;
const secret_redactor_1 = require("./secret-redactor");
function buildEvidenceCitations(graph) {
    const citations = [];
    for (const node of graph.nodes) {
        for (const evidence of node.evidence)
            citations.push({ id: node.id, file: evidence.file, startLine: evidence.startLine, endLine: evidence.endLine, text: (0, secret_redactor_1.redactSecrets)(evidence.text), status: node.status });
    }
    for (const edge of graph.edges) {
        for (const evidence of edge.evidence)
            citations.push({ id: edge.id, file: evidence.file, startLine: evidence.startLine, endLine: evidence.endLine, text: (0, secret_redactor_1.redactSecrets)(evidence.text), status: edge.status });
    }
    const unique = new Map();
    for (const citation of citations)
        unique.set(`${citation.id}:${citation.file}:${citation.startLine}:${citation.endLine}`, citation);
    return [...unique.values()].sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine || a.id.localeCompare(b.id));
}

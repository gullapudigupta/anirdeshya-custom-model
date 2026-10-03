"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFrameworkRelationships = resolveFrameworkRelationships;
const evidence_graph_1 = require("./evidence-graph");
const angular_resolver_1 = require("./angular-resolver");
const node_resolver_1 = require("./node-resolver");
function resolveFrameworkRelationships(regions, graph = new evidence_graph_1.EvidenceGraph()) {
    (0, angular_resolver_1.resolveAngularRelationships)(regions, graph);
    (0, node_resolver_1.resolveNodeRelationships)(regions, graph);
    return graph;
}

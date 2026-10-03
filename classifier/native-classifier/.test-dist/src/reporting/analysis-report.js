"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analysisReportSchema = void 0;
exports.buildAnalysisReport = buildAnalysisReport;
exports.assertReportEvidence = assertReportEvidence;
const zod_1 = require("zod");
const evidence_citations_1 = require("./evidence-citations");
const secret_redactor_1 = require("./secret-redactor");
const claimSchema = zod_1.z.object({ text: zod_1.z.string().min(1), evidenceIds: zod_1.z.array(zod_1.z.string().min(1)).min(1), status: zod_1.z.enum(["verified", "inferred"]) }).strict();
exports.analysisReportSchema = zod_1.z.object({
    requestId: zod_1.z.string(),
    mode: zod_1.z.string(),
    status: zod_1.z.enum(["completed", "incomplete", "needs_clarification", "cancelled"]),
    summary: zod_1.z.string(),
    claims: zod_1.z.array(claimSchema),
    orderedFlow: zod_1.z.array(claimSchema),
    transformations: zod_1.z.array(claimSchema),
    relevantFiles: zod_1.z.array(zod_1.z.string()),
    uncertainty: zod_1.z.array(zod_1.z.string()),
    unresolvedGaps: zod_1.z.array(zod_1.z.object({ target: zod_1.z.string(), reason: zod_1.z.string(), query: zod_1.z.string(), tool: zod_1.z.string() }).strict()),
    citations: zod_1.z.array(zod_1.z.object({ id: zod_1.z.string(), file: zod_1.z.string(), startLine: zod_1.z.number(), endLine: zod_1.z.number(), text: zod_1.z.string(), status: zod_1.z.enum(["verified", "inferred"]) }).strict()),
}).strict();
function buildAnalysisReport(request, completion, graph) {
    const citations = (0, evidence_citations_1.buildEvidenceCitations)(graph);
    const ids = new Set([...graph.nodes.map((node) => node.id), ...graph.edges.map((edge) => edge.id), ...graph.unresolved.map((link) => link.id)]);
    const claims = [];
    const orderedFlow = [];
    const transformations = [];
    for (const edge of graph.edges) {
        const from = graph.nodes.find((node) => node.id === edge.from)?.label ?? edge.from;
        const to = graph.nodes.find((node) => node.id === edge.to)?.label ?? edge.to;
        const status = edge.status;
        const text = (0, secret_redactor_1.redactSecrets)(`${from} ${edge.kind.replace(/_/g, " ")} ${to}`);
        const claim = { text, evidenceIds: [edge.id], status };
        claims.push(claim);
        orderedFlow.push(claim);
    }
    for (const node of graph.nodes) {
        const summary = `${node.kind.replace(/_/g, " ")}: ${node.label}`;
        claims.push({ text: (0, secret_redactor_1.redactSecrets)(summary), evidenceIds: [node.id], status: node.status });
    }
    for (const unresolved of graph.unresolved) {
        claims.push({ text: (0, secret_redactor_1.redactSecrets)(`Unresolved ${unresolved.relation} relationship to ${unresolved.targetHint}`), evidenceIds: [unresolved.id], status: "inferred" });
    }
    const summaryEvidenceIds = claims.length ? claims.slice(0, Math.min(3, claims.length)).flatMap((claim) => claim.evidenceIds) : [];
    if (summaryEvidenceIds.length)
        claims.unshift({ text: (0, secret_redactor_1.redactSecrets)(completion.reason), evidenceIds: summaryEvidenceIds, status: "verified" });
    const uncertainty = [completion.reason, ...graph.unresolved.map((link) => `${link.targetHint}: ${link.reason}`)].map(secret_redactor_1.redactSecrets);
    const report = exports.analysisReportSchema.parse({
        requestId: request.requestId,
        mode: request.mode,
        status: completion.status,
        summary: (0, secret_redactor_1.redactSecrets)(completion.reason),
        claims,
        orderedFlow,
        transformations,
        relevantFiles: [...new Set(citations.map((citation) => citation.file))].sort(),
        uncertainty,
        unresolvedGaps: graph.unresolved.map((link) => ({ target: (0, secret_redactor_1.redactSecrets)(link.targetHint), reason: (0, secret_redactor_1.redactSecrets)(link.reason), query: (0, secret_redactor_1.redactSecrets)(link.query), tool: link.suggestedTool })),
        citations,
    });
    assertReportEvidence(report, ids);
    return report;
}
function assertReportEvidence(report, evidenceIds) {
    const factualClaims = [...report.claims, ...report.orderedFlow, ...report.transformations];
    for (const claim of factualClaims) {
        if (claim.evidenceIds.length === 0 || claim.evidenceIds.some((id) => !evidenceIds.has(id)))
            throw new Error(`Report claim lacks graph evidence: ${claim.text}`);
    }
}

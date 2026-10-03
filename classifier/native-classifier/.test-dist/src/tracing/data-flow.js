"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataFlowStepSchema = void 0;
exports.traceDataFlow = traceDataFlow;
const typescript_1 = __importDefault(require("typescript"));
const zod_1 = require("zod");
exports.dataFlowStepSchema = zod_1.z.object({
    kind: zod_1.z.enum(["mapping", "validation", "default", "generated_field", "serialization", "dropped_field", "side_effect", "error"]),
    expression: zod_1.z.string().min(1),
    source: zod_1.z.string().optional(),
    target: zod_1.z.string().optional(),
    evidence: zod_1.z.object({ file: zod_1.z.string(), startLine: zod_1.z.number(), endLine: zod_1.z.number(), text: zod_1.z.string() }).strict(),
    status: zod_1.z.enum(["verified", "inferred"]),
}).strict();
function traceDataFlow(regions, maxSteps = 500) {
    const steps = [];
    for (const region of regions) {
        const source = typescript_1.default.createSourceFile(region.file, region.text, typescript_1.default.ScriptTarget.Latest, true);
        const push = (kind, node, expression, from, to) => {
            const line = region.startLine + source.getLineAndCharacterOfPosition(node.getStart(source)).line;
            steps.push({ kind, expression: expression.slice(0, 1_000), ...(from ? { source: from } : {}), ...(to ? { target: to } : {}), status: "verified", evidence: { file: region.file, startLine: line, endLine: line, text: node.getText(source).slice(0, 1_000) } });
        };
        const visit = (node) => {
            if (steps.length >= maxSteps)
                return;
            if (typescript_1.default.isBinaryExpression(node) && node.operatorToken.kind === typescript_1.default.SyntaxKind.EqualsToken) {
                push("mapping", node, node.getText(source), node.right.getText(source), node.left.getText(source));
            }
            else if (typescript_1.default.isCallExpression(node)) {
                const name = node.expression.getText(source).split(".").at(-1)?.toLowerCase() ?? "";
                const kind = /valid|parse|schema|assert/.test(name) ? "validation"
                    : /serializ|stringify|encode|json/.test(name) ? "serialization"
                        : /save|write|insert|update|delete|commit|dispatch|emit/.test(name) ? "side_effect" : undefined;
                if (kind)
                    push(kind, node, node.getText(source));
            }
            else if (typescript_1.default.isThrowStatement(node) || typescript_1.default.isCatchClause(node)) {
                push("error", node, node.getText(source));
            }
            else if (typescript_1.default.isPropertyAssignment(node) && typescript_1.default.isIdentifier(node.name) && /^(id|createdAt|updatedAt|timestamp)$/i.test(node.name.text)) {
                push("generated_field", node, node.getText(source), undefined, node.name.text);
            }
            else if (typescript_1.default.isPropertyAssignment(node) && typescript_1.default.isBinaryExpression(node.initializer) && node.initializer.operatorToken.kind === typescript_1.default.SyntaxKind.BarBarToken) {
                push("default", node, node.getText(source), node.initializer.left.getText(source), node.name.getText(source));
            }
            typescript_1.default.forEachChild(node, visit);
        };
        visit(source);
        if (steps.length >= maxSteps)
            break;
    }
    return steps;
}

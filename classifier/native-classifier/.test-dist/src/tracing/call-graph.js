"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultTraceBudget = exports.traceStepSchema = exports.traceBudgetSchema = void 0;
exports.traceCalls = traceCalls;
const typescript_1 = __importDefault(require("typescript"));
const zod_1 = require("zod");
exports.traceBudgetSchema = zod_1.z.object({ maxDepth: zod_1.z.number().int().min(0).max(20), maxNodes: zod_1.z.number().int().min(1).max(5_000), maxFiles: zod_1.z.number().int().min(1).max(2_000), maxLines: zod_1.z.number().int().min(1).max(20_000) }).strict();
exports.traceStepSchema = zod_1.z.object({
    from: zod_1.z.string(), to: zod_1.z.string(), arguments: zod_1.z.array(zod_1.z.string()), asynchronous: zod_1.z.boolean(),
    status: zod_1.z.enum(["verified", "inferred", "unresolved"]), evidence: zod_1.z.object({ file: zod_1.z.string(), startLine: zod_1.z.number(), endLine: zod_1.z.number(), text: zod_1.z.string() }).strict(),
}).strict();
exports.defaultTraceBudget = { maxDepth: 5, maxNodes: 200, maxFiles: 50, maxLines: 2_000 };
function traceCalls(regions, knownSymbols, budget = exports.defaultTraceBudget) {
    const steps = [];
    let visitedLines = 0;
    for (const region of regions.slice(0, budget.maxFiles)) {
        const source = typescript_1.default.createSourceFile(region.file, region.text, typescript_1.default.ScriptTarget.Latest, true);
        const containingName = region.text.match(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/)?.[1] ?? region.file;
        const visit = (node) => {
            if (steps.length >= budget.maxNodes || visitedLines >= budget.maxLines)
                return;
            visitedLines += Math.max(1, source.getLineAndCharacterOfPosition(node.getEnd()).line - source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
            if (typescript_1.default.isCallExpression(node)) {
                const to = node.expression.getText(source);
                const lineOffset = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
                const line = region.startLine + lineOffset;
                const awaitCall = typescript_1.default.isAwaitExpression(node.parent);
                const target = to.split(".").at(-1) ?? to;
                steps.push(exports.traceStepSchema.parse({
                    from: containingName, to, arguments: node.arguments.map((argument) => argument.getText(source)), asynchronous: awaitCall,
                    status: knownSymbols.has(target) ? "verified" : (to.includes(".") ? "inferred" : "unresolved"),
                    evidence: { file: region.file, startLine: line, endLine: line, text: node.getText(source).slice(0, 1_000) },
                }));
            }
            typescript_1.default.forEachChild(node, visit);
        };
        visit(source);
        if (steps.length >= budget.maxNodes || visitedLines >= budget.maxLines)
            break;
    }
    return steps;
}

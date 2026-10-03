"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureFocusedEvidence = captureFocusedEvidence;
exports.analyzeReadRegion = analyzeReadRegion;
const typescript_1 = __importDefault(require("typescript"));
const read_file_1 = require("../repository/read-file");
async function captureFocusedEvidence(root, file, startLine, endLine, symbolName) {
    const read = await (0, read_file_1.readWorkspaceFile)(root, file, { startLine, endLine, maxLines: 300 });
    return analyzeReadRegion(read, symbolName);
}
function analyzeReadRegion(read, symbolName) {
    const source = typescript_1.default.createSourceFile(read.file, read.text, typescript_1.default.ScriptTarget.Latest, true);
    let focused = source;
    if (symbolName) {
        const declarations = [];
        const visit = (node) => {
            if ((typescript_1.default.isFunctionDeclaration(node) || typescript_1.default.isMethodDeclaration(node) || typescript_1.default.isClassDeclaration(node))
                && node.name?.getText(source) === symbolName)
                declarations.push(node);
            typescript_1.default.forEachChild(node, visit);
        };
        visit(source);
        if (declarations.length)
            focused = declarations[0];
    }
    const start = focused === source ? 0 : focused.getStart(source);
    const end = focused === source ? read.text.length : focused.getEnd();
    const text = read.text.slice(start, end);
    const inputs = new Set();
    const outputs = new Set();
    const dependencies = new Set();
    const sideEffects = new Set();
    const errors = new Set();
    let asynchronous = false;
    const visit = (node) => {
        if (typescript_1.default.isParameter(node) && typescript_1.default.isIdentifier(node.name))
            inputs.add(node.name.text);
        if (typescript_1.default.isReturnStatement(node))
            outputs.add(node.expression?.getText(source) ?? "return");
        if (typescript_1.default.isCallExpression(node)) {
            const callee = node.expression.getText(source);
            dependencies.add(callee);
            if (/^(save|write|insert|update|delete|remove|emit|publish|send|dispatch|commit)/i.test(callee.split(".").at(-1) ?? ""))
                sideEffects.add(callee);
        }
        if (typescript_1.default.isAwaitExpression(node))
            asynchronous = true;
        if (typescript_1.default.isThrowStatement(node) || typescript_1.default.isCatchClause(node))
            errors.add(node.getText(source));
        typescript_1.default.forEachChild(node, visit);
    };
    visit(focused);
    const startLine = read.startLine + source.getLineAndCharacterOfPosition(start).line;
    const endLine = read.startLine + source.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line;
    return {
        file: read.file,
        startLine,
        endLine,
        text,
        ...(symbolName && focused !== source ? { symbol: symbolName } : {}),
        inputs: [...inputs].sort(),
        outputs: [...outputs].sort(),
        dependencies: [...dependencies].sort(),
        sideEffects: [...sideEffects].sort(),
        asynchronous,
        errors: [...errors].sort(),
    };
}

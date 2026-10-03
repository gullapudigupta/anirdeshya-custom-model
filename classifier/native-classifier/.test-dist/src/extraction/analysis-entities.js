"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analysisEntitySchema = exports.analysisEntityTypes = void 0;
const zod_1 = require("zod");
exports.analysisEntityTypes = [
    "feature",
    "symbol",
    "file",
    "directory",
    "framework",
    "endpoint",
    "event",
    "database_entity",
];
exports.analysisEntitySchema = zod_1.z.object({
    type: zod_1.z.enum(exports.analysisEntityTypes),
    value: zod_1.z.string().trim().min(1).max(240),
    normalizedValue: zod_1.z.string().trim().min(1).max(240),
    confidence: zod_1.z.number().min(0).max(1),
}).strict();

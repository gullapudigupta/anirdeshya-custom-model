"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.save = save;
async function save(input, repository) {
    if (!input.name.trim())
        throw new Error("name is required");
    return repository.save({ ...input, name: input.name.trim() });
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactSecrets = redactSecrets;
const secretPatterns = [
    [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]"],
    [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
    [/\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g, "[REDACTED_TOKEN]"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_ACCESS_KEY]"],
    [/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]"],
    [/\b(api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?key)\b(\s*[=:]\s*)(["']?)[^\s"'`,;]{8,}\3/gi, "$1$2[REDACTED]"],
    [/\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^:\s/@]+:[^@\s/]+@[^\s"'`]+/gi, "[REDACTED_CONNECTION_STRING]"],
    [/([?&](?:access_token|token|api_key|key|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]"],
];
function redactSecrets(value) {
    return secretPatterns.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), value);
}

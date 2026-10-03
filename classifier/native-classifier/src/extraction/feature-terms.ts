import { analysisEntitySchema, type AnalysisEntity } from "./analysis-entities";

type Span = { value: string; start: number; end: number; confidence: number };

function normalizeFeature(value: string): string {
  return value
    .trim()
    .replace(/^[\s"'`]+|[\s"'`.,!?;:]+$/g, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/\s+(?:functionality|feature|flow|path|system)$/i, "")
    .trim();
}

function addMatches(text: string, expression: RegExp, group: number, confidence: number, spans: Span[]): void {
  const flags = expression.flags.includes("g") ? expression.flags : `${expression.flags}g`;
  for (const match of text.matchAll(new RegExp(expression.source, flags))) {
    const value = match[group];
    const offset = match.index ?? 0;
    const start = offset + match[0].indexOf(value);
    if (value.trim()) spans.push({ value: value.trim(), start, end: start + value.length, confidence });
  }
}

export function extractAnalysisEntities(question: string): AnalysisEntity[] {
  const spans: Span[] = [];
  addMatches(question, /(["'])([^"'`\r\n]{1,120})\1/g, 2, 0.99, spans);
  addMatches(question, /`([^`\r\n]{1,120})`/g, 1, 0.99, spans);

  const patterns = [
    /\bhow\s+(?:does\s+)?(.+?)\s+(?:work|works)\b/i,
    /\bwhere\s+(?:is|are)\s+(.+?)\s+implemented\b/i,
    /\btrace\s+(.+?)(?:\s+(?:flow|path))?(?=[?.!,;:]|$)/i,
    /\bshow\s+the\s+flow\s+for\s+(.+?)(?=[?.!,;:]|$)/i,
    /\bwhat\s+happens\s+when\s+(.+?)(?=[?.!,;:]|$)/i,
    /\bfind\s+how\s+(.+?)\s+works\b/i,
  ];
  for (const pattern of patterns) addMatches(question, pattern, 1, 0.88, spans);

  const whoCalls = /\bwho\s+calls\s+(.+?)(?=[?.!,;:]|$)/i.exec(question);
  if (whoCalls?.[1] && spans.length === 0) {
    const value = whoCalls[1].trim().replace(/["'`]/g, "");
    const start = (whoCalls.index ?? 0) + whoCalls[0].indexOf(whoCalls[1]);
    spans.push({ value, start, end: start + whoCalls[1].length, confidence: 0.75 });
  }

  const quotedRanges = spans.filter((span) => span.confidence > 0.95);
  const entities: AnalysisEntity[] = quotedRanges.map((span) => ({
    type: "symbol",
    value: span.value,
    normalizedValue: span.value,
    confidence: span.confidence,
  }));

  for (const span of spans.filter((item) => item.confidence <= 0.95)) {
    if (quotedRanges.some((quoted) => span.start < quoted.end && span.end > quoted.start)) continue;
    const value = normalizeFeature(span.value);
    if (!value) continue;
    entities.push({ type: "feature", value: span.value, normalizedValue: value.toLowerCase(), confidence: span.confidence });
  }

  const unique = new Map<string, AnalysisEntity>();
  for (const entity of entities) {
    const key = `${entity.type}:${entity.normalizedValue.toLowerCase()}`;
    const current = unique.get(key);
    if (!current || entity.confidence > current.confidence) unique.set(key, entity);
  }
  return [...unique.values()].map((entity) => analysisEntitySchema.parse(entity));
}
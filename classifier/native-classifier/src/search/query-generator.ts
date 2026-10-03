import { z } from "zod";
import type { AnalysisEntity } from "../extraction/analysis-entities";
import type { RepositoryInventory } from "../repository/repository-inventory";

export const queryFamilySchema = z.object({
  family: z.enum(["direct", "related_action", "ui_trigger", "api", "persistence", "framework", "symbol"]),
  query: z.string().min(1).max(240),
  exact: z.boolean(),
}).strict();
export type SearchQuery = z.infer<typeof queryFamilySchema>;

export interface QueryGenerationOptions { maxQueries?: number }

export function generateSearchQueries(entities: readonly AnalysisEntity[], inventory: RepositoryInventory, options: QueryGenerationOptions = {}): SearchQuery[] {
  const queries: SearchQuery[] = [];
  const add = (family: SearchQuery["family"], query: string, exact = false): void => {
    const normalized = query.trim();
    if (normalized) queries.push({ family, query: normalized, exact });
  };
  const angular = inventory.frameworks.some((framework) => framework.name === "Angular");
  const node = inventory.frameworks.some((framework) => ["Express", "Fastify", "NestJS"].includes(framework.name));
  for (const entity of entities) {
    if (entity.type === "symbol") { add("symbol", entity.value, true); continue; }
    if (entity.type !== "feature") continue;
    add("direct", entity.normalizedValue);
    for (const related of ["submit", "persist", "create", "update", "upsert", "commit", "write", "store"]) add("related_action", related);
    if (angular) for (const related of ["template", "form", "service", "observable", "signal", "NgRx"]) add("framework", related);
    if (node) for (const related of ["route", "controller", "middleware", "service", "repository", "ORM"]) add("api", related);
    for (const related of ["POST", "PUT", "PATCH", "endpoint"]) add("api", related);
    for (const related of ["database", "repository", "transaction", "save", "write"]) add("persistence", related);
  }
  const unique = new Map<string, SearchQuery>();
  for (const query of queries) {
    const key = `${query.family}:${query.exact ? "exact:" : ""}${query.query.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, query);
  }
  return [...unique.values()].slice(0, options.maxQueries ?? 40);
}
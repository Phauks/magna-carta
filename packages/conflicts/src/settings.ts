import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { SOURCE_CLASSES, type SourceClass, type Strictness } from "./types.ts";

// The firm's mandatory minimum. A per-run selection may only ADD sources above this floor, never
// subtract below it — otherwise narrowing the scope manufactures a clean check, and the log would
// faithfully record a clean result for a search that never ran. The party class is always in the
// floor: conflicts impute across the whole firm, so the party corpus is not optional.
export interface ConflictsPolicy {
  readonly floorSources: readonly SourceClass[];
  readonly floorStrictness: Strictness;
  readonly defaultDepth: number;
}

export interface ScopeRequest {
  readonly sources: readonly SourceClass[];
  readonly strictness: Strictness;
  readonly depth: number;
}

export interface ResolvedScope {
  readonly sources: readonly SourceClass[];
  readonly strictness: Strictness;
  readonly depth: number;
  // True when the request fell below the floor and was raised. Recorded on the check row so an
  // auditor sees that a narrower scope was asked for and refused.
  readonly floorRaised: boolean;
}

export const DEFAULT_CONFLICTS_POLICY: ConflictsPolicy = {
  floorSources: ["party"],
  floorStrictness: "balanced",
  defaultDepth: 1,
};

const SETTING_KEY = "conflicts.policy";

// over_inclusive is a strict superset of balanced, so it is the higher floor.
const STRICTNESS_RANK: Record<Strictness, number> = { balanced: 0, over_inclusive: 1 };

// Sort by the catalog order so an identical scope always serializes identically into the log.
function orderSources(sources: Iterable<SourceClass>): SourceClass[] {
  const present = new Set(sources);
  return SOURCE_CLASSES.filter((sourceClass) => present.has(sourceClass));
}

export function resolveScope(policy: ConflictsPolicy, request: ScopeRequest): ResolvedScope {
  const requested = new Set(request.sources);
  let floorRaised = false;

  for (const required of policy.floorSources) {
    if (!requested.has(required)) {
      requested.add(required);
      floorRaised = true;
    }
  }

  let strictness = request.strictness;
  if (STRICTNESS_RANK[strictness] < STRICTNESS_RANK[policy.floorStrictness]) {
    strictness = policy.floorStrictness;
    floorRaised = true;
  }

  return {
    sources: orderSources(requested),
    strictness,
    depth: Math.max(0, request.depth),
    floorRaised,
  };
}

// Reads the firm's policy from the flat firm-level setting table, falling back to the in-code default
// when the firm has never configured one.
export async function readConflictsPolicy(database: SqlDatabase): Promise<ConflictsPolicy> {
  const { results } = await database
    .prepare(`SELECT value FROM setting WHERE key = ?1`)
    .bind(SETTING_KEY)
    .all<{ value: string }>();

  const row = results[0];
  if (row === undefined) return DEFAULT_CONFLICTS_POLICY;

  const parsed = JSON.parse(row.value) as Partial<ConflictsPolicy>;
  return {
    floorSources: orderSources(parsed.floorSources ?? DEFAULT_CONFLICTS_POLICY.floorSources),
    floorStrictness: parsed.floorStrictness ?? DEFAULT_CONFLICTS_POLICY.floorStrictness,
    defaultDepth: parsed.defaultDepth ?? DEFAULT_CONFLICTS_POLICY.defaultDepth,
  };
}

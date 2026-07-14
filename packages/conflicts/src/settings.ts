import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { SOURCE_CLASSES, STRICTNESS_LEVELS, type SourceClass, type Strictness } from "./types.ts";

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
  // Traversal depth for the graph source. Omitted means "use the firm's configured default"
  // (`ConflictsPolicy.defaultDepth`); an explicit value (including 0) is honored as given. Unlike
  // sources and strictness, depth is a default, not a floor — a caller may deliberately search
  // shallower than the default, and the recorded `depth` on the check row keeps that transparent.
  readonly depth?: number;
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

  // Depth defaults to the firm's configured value when the caller omits it; an explicit value (0
  // included) is honored. Defaulting is not a floor-raise — the caller asked for nothing narrower —
  // so it never sets floorRaised.
  const depth =
    request.depth === undefined
      ? Math.max(0, policy.defaultDepth)
      : Math.max(0, request.depth);

  return {
    sources: orderSources(requested),
    strictness,
    depth,
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

  let parsed: Partial<ConflictsPolicy>;
  try {
    parsed = JSON.parse(row.value) as Partial<ConflictsPolicy>;
  } catch {
    // A corrupt row must not crash every conflicts check — fall back to the default posture.
    return DEFAULT_CONFLICTS_POLICY;
  }

  // A missing, non-array, or emptied-out floorSources is treated as "use the default"; `??` alone
  // does not catch an empty array. Then — regardless of what was stored — party is unioned back in:
  // it is the firm-wide floor, not a firm-configurable choice, so no stored value (corrupted,
  // hand-edited, or produced by a future settings UI that lets an admin deselect everything) may
  // ever drop it.
  const storedFloorSources = parsed.floorSources;
  const baseFloorSources =
    Array.isArray(storedFloorSources) && storedFloorSources.length > 0
      ? storedFloorSources
      : DEFAULT_CONFLICTS_POLICY.floorSources;
  const floorSources = orderSources(new Set([...baseFloorSources, "party"]));

  const floorStrictness = STRICTNESS_LEVELS.includes(parsed.floorStrictness as Strictness)
    ? (parsed.floorStrictness as Strictness)
    : DEFAULT_CONFLICTS_POLICY.floorStrictness;

  return {
    floorSources,
    floorStrictness,
    defaultDepth:
      typeof parsed.defaultDepth === "number"
        ? parsed.defaultDepth
        : DEFAULT_CONFLICTS_POLICY.defaultDepth,
  };
}

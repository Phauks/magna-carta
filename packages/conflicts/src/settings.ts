import { MAX_BATCH_STATEMENTS } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { BUDGETED_EDGE_CLASSES, type BudgetedEdgeClass } from "./edge-classes.ts";
import { SOURCE_CLASSES, STRICTNESS_LEVELS, type SourceClass, type Strictness } from "./types.ts";

// A hop budget per budgeted edge class. Corporate family carries no entry: it is traversed
// transitively at zero cost and bounded only by `closureCap`, because a rename or merger chain of any
// length is the same legal person continuing.
export type EdgeClassBudgets = Readonly<Record<BudgetedEdgeClass, number>>;

// The default hop budget for every budgeted class, and the default per-run closure cap. Both are
// numbers that decide what gets searched rather than how the search is coded, so both are firm
// settings and neither is hard-coded at a call site: the values here are the shipped default the firm
// starts from, and the value in force is recorded on every check row.
export const DEFAULT_EDGE_CLASS_BUDGETS: EdgeClassBudgets = Object.freeze({
  control: 1,
  family: 1,
  representation: 1,
});

// The most entities one run may expand to. A bound has to exist — an unbounded traversal over a real
// corporate group is an availability problem, and a Directory holding a clearing bank can put
// thousands of entities in one closure. What must never happen is the bound being applied silently,
// so reaching it is recorded and reported rather than quietly shortening the answer.
export const DEFAULT_CLOSURE_CAP = 500;

// THE SECOND BOUND, AND WHY ONE BOUND WAS NOT ENOUGH.
//
// `closureCap` bounds how many entities the walk reaches. It does not bound the work, because hits do
// not scale with the closure — they scale with the closure TIMES the corpus. The load profile's corpus
// sweep (`conflictsCandidateBounds` in
// packages/fixtures/src/load-profile/conflicts-measurements.ts) pins the closure and grows the
// directory: candidates per reached entity rise linearly with the corpus, at roughly six tenths of the
// organization corpus for an organization subject and roughly a tenth of the person corpus for a
// person. Around ninety-nine per cent of that volume is the trigram channel with no other signal
// beside it, because a trigram-OR match asks only whether two names share ONE three-character window
// and multi-word names nearly always do.
//
// So the uneven consequence is worth stating plainly: a firm with a deep corporate group is fine, and
// a firm with a large Directory is not — and the second is the ordinary case. A cap on the walk cannot
// see that, so the run carries a second cap on what it WRITES.
//
// This is a capacity refusal, not a threshold. A threshold removes a candidate because of what its
// evidence is, at any volume, and this package has none and never will. This removes candidates only
// when one run exceeds a stated capacity, records exactly how many and at which evidence tiers, and
// says in words that the search is incomplete — the same contract the closure cap already carries.
export const DEFAULT_CANDIDATE_CAP = 5_000;

// Statements a check's batch carries beside its BOUNDED hits: the idempotency record, the check row,
// the audit row, the notification, and the imputation hits — which are bounded by the matter's own
// party list rather than by the candidate cap, since an identity join finding a firm member who
// genuinely IS a party is the strongest thing this engine produces and is never refused. Sized well
// past the route's cap on subject parties so even a matter staffed entirely by the firm's own members
// leaves room; its only job is to keep the two bounds from colliding.
const CHECK_BATCH_OVERHEAD_STATEMENTS = 500;

// A candidate cap raised past what one atomic batch may carry would turn a truncation the platform can
// report into a check that fails outright, which is strictly worse: a bounded answer on the record
// beats no answer at all. The two bounds therefore compose mechanically rather than by convention —
// nothing a firm can store in its settings row can put them in conflict.
export const MAX_CANDIDATE_CAP = MAX_BATCH_STATEMENTS - CHECK_BATCH_OVERHEAD_STATEMENTS;

// The firm's mandatory minimum. A per-run selection may only ADD sources above this floor, never
// subtract below it — otherwise narrowing the scope manufactures a clean check, and the log would
// faithfully record a clean result for a search that never ran. The party class is always in the
// floor: conflicts impute across the whole firm, so the party corpus is not optional.
export interface ConflictsPolicy {
  readonly floorSources: readonly SourceClass[];
  readonly floorStrictness: Strictness;
  readonly defaultDepth: number;
  readonly edgeClassBudgets: EdgeClassBudgets;
  readonly closureCap: number;
  readonly candidateCap: number;
}

export interface ScopeRequest {
  readonly sources: readonly SourceClass[];
  readonly strictness: Strictness;
  // Traversal depth for the graph source. Omitted means "use the firm's configured default"
  // (`ConflictsPolicy.defaultDepth`); an explicit value (including 0) is honored as given. Unlike
  // sources and strictness, depth is a default, not a floor — a caller may deliberately search
  // shallower than the default, and the recorded `depth` on the check row keeps that transparent.
  //
  // It is also the uniform budget: supplying it sets every budgeted edge class to that number, which
  // is exactly what it has always meant. `edgeClassBudgets` overrides it per class.
  readonly depth?: number;
  // Per-class overrides. A class the caller omits falls back to `depth`, then to the firm's setting.
  readonly edgeClassBudgets?: Partial<Record<BudgetedEdgeClass, number>>;
  // A per-run closure cap. Omitted means the firm's setting. Like depth, this is a default rather
  // than a floor: a caller may run with a smaller cap, and the cap in force is recorded either way.
  readonly closureCap?: number;
  // A per-run candidate cap. Same posture as `closureCap`: omitted means the firm's setting, a caller
  // may run under a smaller one, and whichever is in force is recorded on the check row.
  readonly candidateCap?: number;
}

export interface ResolvedScope {
  readonly sources: readonly SourceClass[];
  readonly strictness: Strictness;
  // The single hop number the shipped `conflicts_check.depth` column carries. It is the WIDEST of the
  // resolved per-class budgets, so a reader of the column alone is never told the traversal was
  // shallower than it was; the per-class detail is recorded beside it.
  readonly depth: number;
  readonly edgeClassBudgets: EdgeClassBudgets;
  readonly closureCap: number;
  readonly candidateCap: number;
  // True when the request fell below the floor and was raised. Recorded on the check row so an
  // auditor sees that a narrower scope was asked for and refused.
  readonly floorRaised: boolean;
}

export const DEFAULT_CONFLICTS_POLICY: ConflictsPolicy = {
  floorSources: ["party"],
  floorStrictness: "balanced",
  defaultDepth: 1,
  edgeClassBudgets: DEFAULT_EDGE_CLASS_BUDGETS,
  closureCap: DEFAULT_CLOSURE_CAP,
  candidateCap: DEFAULT_CANDIDATE_CAP,
};

const SETTING_KEY = "conflicts.policy";

// A cap value, from a setting or from a request, normalized the one way. Clamped at both ends: never
// negative, and never past what one atomic batch can carry.
function resolveCandidateCap(value: number): number {
  return Math.min(MAX_CANDIDATE_CAP, Math.max(0, Math.trunc(value)));
}

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
  const requestedDepth =
    request.depth === undefined ? undefined : Math.max(0, Math.trunc(request.depth));

  // Per class, in order of specificity: an explicit per-class override, then the caller's uniform
  // depth, then the firm's per-class setting. The middle rung is what keeps every caller written
  // against the shipped single `depth` field meaning exactly what it always meant.
  const edgeClassBudgets = Object.fromEntries(
    BUDGETED_EDGE_CLASSES.map((edgeClass) => {
      const override = request.edgeClassBudgets?.[edgeClass];
      if (override !== undefined) return [edgeClass, Math.max(0, Math.trunc(override))];
      if (requestedDepth !== undefined) return [edgeClass, requestedDepth];
      return [edgeClass, Math.max(0, Math.trunc(policy.edgeClassBudgets[edgeClass]))];
    }),
  ) as unknown as EdgeClassBudgets;

  const closureCap =
    request.closureCap === undefined
      ? Math.max(0, Math.trunc(policy.closureCap))
      : Math.max(0, Math.trunc(request.closureCap));

  const candidateCap = resolveCandidateCap(
    request.candidateCap === undefined ? policy.candidateCap : request.candidateCap,
  );

  return {
    sources: orderSources(requested),
    strictness,
    // The widest budget in force, so the one-number column never understates the traversal.
    depth: Math.max(...BUDGETED_EDGE_CLASSES.map((edgeClass) => edgeClassBudgets[edgeClass])),
    edgeClassBudgets,
    closureCap,
    candidateCap,
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

  const defaultDepth =
    typeof parsed.defaultDepth === "number" && Number.isFinite(parsed.defaultDepth)
      ? Math.max(0, Math.trunc(parsed.defaultDepth))
      : DEFAULT_CONFLICTS_POLICY.defaultDepth;

  return {
    floorSources,
    floorStrictness,
    defaultDepth,
    edgeClassBudgets: parseEdgeClassBudgets(parsed.edgeClassBudgets, defaultDepth),
    closureCap:
      typeof parsed.closureCap === "number" && Number.isFinite(parsed.closureCap)
        ? Math.max(0, Math.trunc(parsed.closureCap))
        : DEFAULT_CONFLICTS_POLICY.closureCap,
    // A firm that configured a policy before the candidate cap existed gets the shipped default rather
    // than an absent bound: an unbounded run is the state this cap exists to end, so "the row does not
    // say" resolves to the bound, never to none.
    candidateCap:
      typeof parsed.candidateCap === "number" && Number.isFinite(parsed.candidateCap)
        ? resolveCandidateCap(parsed.candidateCap)
        : DEFAULT_CONFLICTS_POLICY.candidateCap,
  };
}

// A firm that configured `defaultDepth` before the typed budgets existed still means that number for
// every class, so a stored row with no `edgeClassBudgets` resolves to the depth it does carry — never
// to the shipped default. Falling back to the shipped default here would silently NARROW the search
// for exactly the firms that took the trouble to widen it, which is the one direction this subsystem
// may never move without saying so.
function parseEdgeClassBudgets(stored: unknown, defaultDepth: number): EdgeClassBudgets {
  const record =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    BUDGETED_EDGE_CLASSES.map((edgeClass) => {
      const value = record[edgeClass];
      if (typeof value === "number" && Number.isFinite(value)) {
        return [edgeClass, Math.max(0, Math.trunc(value))];
      }
      return [edgeClass, defaultDepth];
    }),
  ) as unknown as EdgeClassBudgets;
}

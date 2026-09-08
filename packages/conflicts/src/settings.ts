import { MAX_BATCH_STATEMENTS, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { conflictsAuditStatement, type ConflictsWriteOptions } from "./audit.ts";
import { BUDGETED_EDGE_CLASSES, type BudgetedEdgeClass } from "./edge-classes.ts";
import { runConflictsEffect } from "./run-conflicts-effect.ts";
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

// WHICH NAME ROWS THE BALANCED BAND SEARCHES — a firm setting, not a constant.
//
// A Directory keeps a person's former, maiden, alias and trading names as rows of their own, all in
// the conflicts corpus. Which of them a check compares against used to be an implicit consequence of
// one word: `balanced` meant current names only, `over_inclusive` meant every row. The consequence of
// the narrow reading is specific — a party who married and changed surname is invisible at the
// default band, and a changed surname is the miss the practitioner literature cites most often.
//
// So the roles are named explicitly, recorded verbatim on every check row, and configurable. The
// value below is the shipped default; a firm that wants the narrower reading changes a setting rather
// than waiting for a release, and a reader of a years-old check row can see which set was in force
// that day instead of having to know what the word meant then.
//
// `aka` and `dba` are deliberately NOT in the default set even though they are also non-current name
// rows: the reading this default encodes is "the same person under a name they previously held",
// which former, maiden and alias are and which a trading style is not. Adding either is one edit to a
// firm's setting.
export const DEFAULT_BALANCED_NAME_ROLES: readonly string[] = Object.freeze([
  "current",
  "former",
  "maiden",
  "alias",
]);

// over_inclusive searches EVERY name row and is not configurable, and that is what keeps the superset
// invariant true by construction rather than by care: whatever set a firm configures for balanced, it
// is a subset of "all of them", so raising strictness can only ever add candidates.
export const OVER_INCLUSIVE_NAME_ROLES = null;

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
  // The name roles the BALANCED band compares against. over_inclusive always searches every role, so
  // this is the only band the firm configures and the superset relationship holds whatever it is set
  // to. Never empty: an emptied set would search no name rows at all, which is a check that runs and
  // finds nothing for a reason nothing on the row explains.
  readonly balancedNameRoles: readonly string[];
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
  // The name roles this run compared against, resolved from the strictness preset and the firm's
  // setting, recorded verbatim on the check row. `null` means every role — the over-inclusive band —
  // and is a distinct statement from a list that happens to name them all, because a firm that later
  // adds a name role to its catalogue is covered by the first and not by the second.
  readonly nameRoles: readonly string[] | null;
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
  balancedNameRoles: DEFAULT_BALANCED_NAME_ROLES,
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
    nameRoles: strictness === "balanced" ? policy.balancedNameRoles : OVER_INCLUSIVE_NAME_ROLES,
    floorRaised,
  };
}

// EVERY GUARD THIS SUBSYSTEM PLACES ON A POLICY, IN ONE FUNCTION — and why it is not inlined in the
// read.
//
// The read has always repaired what it loads: party unioned back into the floor, `current` unioned
// into the name roles, caps clamped, a corrupt number replaced by the shipped default. That is the
// right posture for a value the platform did not write. But it means a STORED policy and the policy
// that actually runs are two different objects whenever the stored one is unsound, and a settings
// screen makes that gap visible and dangerous: an administrator who deselects every source would
// save `[]`, see `[]` when the screen reloads, and be shown a floor the platform would never run.
// The screen would be lying, and it would be lying by faithfully echoing what was stored.
//
// So the write normalizes through this same function and stores the RESULT. What is in the row is
// what runs, the screen can read the row back and believe it, and the read's repairs become a
// backstop against corruption and hand edits rather than a routine correction of the platform's own
// writes. Read and write cannot drift, because there is one implementation and both call it.
export function normalizeConflictsPolicy(parsed: Partial<ConflictsPolicy>): ConflictsPolicy {
  // A missing, non-array, or emptied-out floorSources is treated as "use the default"; `??` alone
  // does not catch an empty array. Then — regardless of what was stored — party is unioned back in:
  // it is the firm-wide floor, not a firm-configurable choice, so no stored value (corrupted,
  // hand-edited, or sent by a settings screen that let an administrator deselect everything) may
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
    balancedNameRoles: parseBalancedNameRoles(parsed.balancedNameRoles),
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

  return normalizeConflictsPolicy(parsed);
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

// A stored name-role set is honoured as given, with two guards. A non-array or an EMPTY array falls
// back to the shipped default rather than to nothing: an empty set searches no name rows at all, so a
// corrupt row, a hand edit, or a future settings surface that lets an administrator deselect
// everything would otherwise turn every check into one that runs and can find nothing. And `current`
// is unioned back in unconditionally — a firm may widen or narrow which historical names are compared,
// but a check that did not compare the name the party goes by today is not a conflicts check.
function parseBalancedNameRoles(stored: unknown): readonly string[] {
  const base =
    Array.isArray(stored) && stored.length > 0
      ? stored.filter((role): role is string => typeof role === "string" && role.trim().length > 0)
      : [];
  const roles = base.length > 0 ? base : DEFAULT_CONFLICTS_POLICY.balancedNameRoles;
  return [...new Set(["current", ...roles])].toSorted();
}

// WRITING THE FIRM'S FLOOR.
//
// This is the one path by which a firm changes what its checks must search. It is a governance act
// rather than an ordinary edit: raising the floor widens every future check and makes a shortfall
// appear on every matter whose last check no longer covers it, and lowering it narrows what the firm
// will look at from here on. So it is audited like any other conflicts write, under its own
// permission, and the row it writes is the row every later check reads.
//
// WHAT IS STORED IS WHAT RUNS. The value is normalized through `normalizeConflictsPolicy` — the same
// function the read repairs with — and the NORMALIZED result is what goes in the row and what comes
// back to the caller. A screen therefore never has to model the platform's repairs to predict its own
// behaviour: it sends what an administrator chose, and it is told what took effect. Where the two
// differ (a floor with every source deselected, a candidate cap above what one atomic batch can
// carry) the difference is visible in the response rather than discovered on the next check.
//
// It deliberately does NOT refuse an unsound policy. The guards here are invariants a firm cannot opt
// out of rather than mistakes it might have meant — `party` is in the floor because conflicts impute
// across the whole firm, and `current` is in the name roles because a check that did not compare the
// name a party goes by today is not a conflicts check. Refusing the save would leave the firm with
// its old policy and an error; unioning the guard back in and saying so leaves it with a sound policy
// and the truth about it.
export async function writeConflictsPolicy(
  database: BatchDatabase,
  input: Partial<ConflictsPolicy>,
  options: ConflictsWriteOptions,
): Promise<ConflictsPolicy> {
  const policy = normalizeConflictsPolicy(input);
  const now = options.clock.now();
  const value = JSON.stringify(policy);

  return runConflictsEffect(database, options.idempotency, options.clock, () => ({
    statements: [
      database
        .prepare(
          `INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(SETTING_KEY, value, now),
      // The subject is the setting key rather than a minted handle: there is exactly one conflicts
      // policy per firm and it has no identity of its own, so the key is what a reader of the audit
      // log would search for. Successive changes are successive rows on the same subject, which is
      // what makes "when did this firm widen its floor" answerable.
      conflictsAuditStatement(database, options, "conflicts.policy.changed", SETTING_KEY),
    ],
    outboxMessages: [],
    responseCode: 200,
    responseBody: policy,
    value: policy,
    fromBody: (body) => body as ConflictsPolicy,
  }));
}

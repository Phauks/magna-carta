import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readPlacesRequest, type PlacesRequest } from "./content-search.ts";
import { conflictsAuditStatement, type ConflictsWriteOptions } from "./audit.ts";
import { runConflictsEffect } from "./run-conflicts-effect.ts";
import { SOURCE_CLASSES, STRICTNESS_LEVELS, type SourceClass, type Strictness } from "./types.ts";

// WHAT A FIRM DECIDES ABOUT A CHECK, AND WHAT IT NO LONGER DECIDES.
//
// A firm sets a FLOOR — the sources every check must search and the name-matching band it must
// reach — and which name rows the narrower band compares. Those decide what a check looks for, and
// a firm is entitled to decide that.
//
// A firm does not set how far a check follows relationships, and it does not set where a search
// stops. Both used to be settings here (a hop budget per edge class, a closure cap, a candidate
// cap) and the owner removed them on 2026-09-11 (docs/conventions/conflicts-rulings.md, E1 and E2):
// a limit on the walk is a conflict the firm does not find, and that is the failure that matters.
// The engine now follows every recorded relationship to closure. The one ceiling that survives is
// not a setting — it is the platform's own bound on what one run may do, named in expansion.ts with
// its reasoning, and a run that reaches it records that it did and the report says so.

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
  // The name roles the BALANCED band compares against. over_inclusive always searches every role, so
  // this is the only band the firm configures and the superset relationship holds whatever it is set
  // to. Never empty: an emptied set would search no name rows at all, which is a check that runs and
  // finds nothing for a reason nothing on the row explains.
  readonly balancedNameRoles: readonly string[];
}

// What a caller asks a check to search: the sources, and the band. Nothing about how far or how
// much — a check follows relationships all the way through, and the ceiling on a run is the
// platform's, not the caller's.
export interface ScopeRequest {
  readonly sources: readonly SourceClass[];
  readonly strictness: Strictness;
  // Whether the balanced band also finds names by trigram overlap (any shared three-letter piece).
  // Absent means yes, which is what every caller that predates the choice meant. The over-inclusive
  // band always runs it, so turning it off can never make that band narrower than balanced.
  readonly trigramMatching?: boolean;
  // The firm's own records to search beyond the Directory: calls, texts, email, tasks, Magnus and
  // files. Absent means none, which is what every caller that predates them means; so does an absent
  // `files` inside it.
  readonly places?: Omit<PlacesRequest, "files"> & {
    readonly files?: PlacesRequest["files"] | undefined;
  };
}

export interface ResolvedScope {
  readonly sources: readonly SourceClass[];
  readonly strictness: Strictness;
  // The name roles this run compared against, resolved from the strictness preset and the firm's
  // setting, recorded verbatim on the check row. `null` means every role — the over-inclusive band —
  // and is a distinct statement from a list that happens to name them all, because a firm that later
  // adds a name role to its catalogue is covered by the first and not by the second.
  readonly nameRoles: readonly string[] | null;
  // Whether the trigram channel ran. Always true at over_inclusive; at balanced, as asked.
  readonly trigramMatching: boolean;
  // The places beyond the Directory, exactly as asked: the floor says nothing about them.
  readonly places: PlacesRequest;
  // True when the request fell below the floor and was raised. Recorded on the check row so an
  // auditor sees that a narrower scope was asked for and refused.
  readonly floorRaised: boolean;
}

export const DEFAULT_CONFLICTS_POLICY: ConflictsPolicy = {
  floorSources: ["party"],
  floorStrictness: "balanced",
  balancedNameRoles: DEFAULT_BALANCED_NAME_ROLES,
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
    nameRoles: strictness === "balanced" ? policy.balancedNameRoles : OVER_INCLUSIVE_NAME_ROLES,
    trigramMatching: strictness === "balanced" ? request.trigramMatching !== false : true,
    places: readPlacesRequest(request.places),
    floorRaised,
  };
}

// EVERY GUARD THIS SUBSYSTEM PLACES ON A POLICY, IN ONE FUNCTION — and why it is not inlined in the
// read.
//
// The read has always repaired what it loads: party unioned back into the floor, `current` unioned
// into the name roles, a corrupt value replaced by the shipped default. That is the right posture for
// a value the platform did not write. But it means a STORED policy and the policy that actually runs
// are two different objects whenever the stored one is unsound, and a settings screen makes that gap
// visible and dangerous: an administrator who deselects every source would save `[]`, see `[]` when
// the screen reloads, and be shown a floor the platform would never run. The screen would be lying,
// and it would be lying by faithfully echoing what was stored.
//
// So the write normalizes through this same function and stores the RESULT. What is in the row is
// what runs, the screen can read the row back and believe it, and the read's repairs become a
// backstop against corruption and hand edits rather than a routine correction of the platform's own
// writes. Read and write cannot drift, because there is one implementation and both call it.
//
// A stored row written before the bounds were removed still carries them (`defaultDepth`,
// `edgeClassBudgets`, `closureCap`, `candidateCap`). They are read past, never honoured: the policy
// that runs is the three fields below, and the next save stores exactly those.
export function normalizeConflictsPolicy(parsed: Partial<ConflictsPolicy>): ConflictsPolicy {
  // A missing, non-array, or emptied-out floorSources is treated as "use the default"; `??` alone
  // does not catch an empty array. Then — regardless of what was stored — party is unioned back in:
  // it is the firm-wide floor, not a firm-configurable choice, so no stored value (corrupted,
  // hand-edited, or sent by a settings screen that let an administrator deselect everything) may
  // ever drop it.
  const storedFloorSources = parsed.floorSources;
  const baseFloorSources =
    Array.isArray(storedFloorSources) && storedFloorSources.length > 0
      ? storedFloorSources.filter((source): source is SourceClass =>
          SOURCE_CLASSES.includes(source as SourceClass),
        )
      : DEFAULT_CONFLICTS_POLICY.floorSources;
  const floorSources = orderSources(new Set([...baseFloorSources, "party"]));

  const floorStrictness = STRICTNESS_LEVELS.includes(parsed.floorStrictness as Strictness)
    ? (parsed.floorStrictness as Strictness)
    : DEFAULT_CONFLICTS_POLICY.floorStrictness;

  return {
    floorSources,
    floorStrictness,
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
// differ (a floor with every source deselected) the difference is visible in the response rather
// than discovered on the next check.
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

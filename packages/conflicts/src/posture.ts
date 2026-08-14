import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readHitDispositionStates } from "./disposition.ts";
import { readConflictsRecheckSettings, readConflictsRescanState } from "./recheck-settings.ts";
import { readPendingRecheckRequests } from "./recheck-statements.ts";
import type { ReportedSource } from "./report-text.ts";
import { readConflictsPolicy } from "./settings.ts";
import { unavailabilityReason } from "./sources.ts";
import { CONFLICTS_CHECK_TABLE } from "./statements.ts";
import {
  SOURCE_CLASSES,
  STRICTNESS_LEVELS,
  type DispositionKind,
  type EvidenceTier,
  type SourceAvailability,
  type SourceClass,
  type Strictness,
} from "./types.ts";

// WHERE A MATTER STANDS ON CONFLICTS — the one sanctioned way to ask, and deliberately not an answer
// to "is this matter clear".
//
// The platform reports what it searched, what it could not search, and what no reviewer has answered.
// It never asserts that a matter is conflict-free (conflicts-vocabulary:allow — states the rule this
// module exists to hold), because it is not in a position to: a firm served with a disqualification
// motion has to defend the sentence its system produced, and a procedure is defensible where a
// conclusion is not. So there is no aggregate here, no verdict, and no field whose name a caller could
// render as a green tick. A caller that wants a single word has to write that word itself, and own it.
//
// Everything below is COMPUTED FROM ROWS AT READ TIME and nothing is stored. That is the same posture
// packages/calendar/src/overdue.ts holds for an overdue deadline: a stored judgement needs a sweep to
// maintain, can be stale by up to the sweep interval, and puts an assertion on a firm's record that
// the platform made rather than a person. A comparison cannot be stale, and this module writes
// nothing — reading a matter's posture never touches a conflicts table.

// The scope a check actually ran under, read back verbatim off its row. A reader must never have to
// know what the code did with the strictness word on the day the check ran.
export interface ScopeInForce {
  // Every registered source with the availability the check recorded for it. A source that could not
  // run is present and marked `unavailable`; it is never omitted, and never conflated with searched.
  readonly sources: Readonly<Record<string, SourceAvailability>>;
  readonly strictness: string;
  readonly depth: number;
  // True when the requested scope fell below the firm's floor and was raised to it.
  readonly floorRaised: boolean;
}

export interface LatestCheckRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly trigger: string;
  // Null when no acting member is on the row.
  readonly actorUserId: string | null;
  readonly scope: ScopeInForce;
  readonly subjectEntityCount: number;
  readonly expandedEntityCount: number;
  readonly skippedIdentifierTypes: readonly string[];
  readonly hitCount: number;
}

// What the firm's CURRENT policy requires that the latest check did not run. Derived by comparing the
// stored row against the live policy on every read, so raising the firm floor makes the shortfall
// appear immediately on every matter it affects, without a sweep and without writing to any conflicts
// table. An empty shortfall means the latest check ran at or above the policy in force right now — it
// does not mean anything about the matter.
export interface ScopeShortfall {
  // Floor sources the check's recorded scope does not mention at all: the check never considered them.
  // A source the check DID consider and recorded `unavailable` is reported by `unavailableSources`
  // instead, because those are two different facts and flattening them would hide one.
  readonly sources: readonly SourceClass[];
  // Present when the firm's floor strictness now outranks the strictness the check ran under.
  readonly strictness: { readonly firmFloor: Strictness; readonly ranUnder: string } | null;
  // Present when the check traversed shallower than the firm's current default depth. Depth is a
  // DEFAULT rather than a floor — a caller may deliberately search shallower and that is honoured —
  // so this reports a difference, not a refusal.
  readonly depth: { readonly firmDefault: number; readonly ranAt: number } | null;
}

// A source in the latest check's scope that recorded `unavailable`, with why. Never conflated with
// searched-and-nothing-surfaced: an auditor has to be able to tell the two apart.
export interface UnavailableSourceRecord {
  readonly source: string;
  readonly reason: string;
}

// A count of the latest check's hits at one evidence tier that no reviewer has disposed of. All four
// tiers are always present, zero included: an absent tier would read as "nothing to say", and the
// point of this field is that an unanswered question is stated out loud.
export interface UndisposedTierCount {
  readonly tier: EvidenceTier;
  readonly count: number;
}

// Dispositions of the latest check's hits, grouped by kind, each naming the reviewers who recorded
// them. Only kinds that actually occur appear: a kind nobody used is genuinely absent, where an
// unanswered tier is a fact worth stating.
export interface DispositionKindCount {
  readonly kind: DispositionKind;
  readonly count: number;
  readonly reviewerUserIds: readonly string[];
}

// A re-check the platform knows is owed and has not yet run, naming the corpus change that caused it
// and when that change happened. Read from the re-check ledger at read time, like everything else
// here: a matter whose corpus moved says so from the moment the change commits, not from whenever a
// consumer gets round to it, so the platform never sits on a known-stale answer silently.
export interface PendingRecheckRecord {
  readonly causeTopic: string;
  readonly causeReference: string;
  readonly causeOccurredAt: string;
  readonly requestedAt: string;
}

// The clock-driven backstop's standing: whether it runs at all, how often, and when it last did.
// Reported because a backstop a firm has switched off is a fact about that firm's procedure, and one
// that is invisible unless the report says it out loud. `enabled: false` is not a failure — it is a
// choice the firm made, and this is where it becomes legible.
export interface PeriodicRescanRecord {
  readonly enabled: boolean;
  readonly intervalDays: number;
  // Null when no scheduled pass has enqueued a re-scan for this firm yet.
  readonly lastRunAt: string | null;
}

export interface MatterConflictsPosture {
  readonly matterId: string;
  // True when this matter has never been named by a check at all. A DISTINCT state from a check that
  // searched and surfaced nothing, and distinct again from a check whose sources were all
  // unavailable — three different facts a single boolean would destroy.
  readonly neverChecked: boolean;
  readonly latestCheck: LatestCheckRecord | null;
  readonly scopeShortfall: ScopeShortfall;
  readonly pendingRecheck: readonly PendingRecheckRecord[];
  readonly periodicRescan: PeriodicRescanRecord;
  // Scoped to the LATEST check's hits. An earlier check's hits stay on the record and are read through
  // that check; this field answers "what did the most recent search leave unanswered".
  readonly undisposedByTier: readonly UndisposedTierCount[];
  readonly dispositionsByKind: readonly DispositionKindCount[];
  readonly unavailableSources: readonly UnavailableSourceRecord[];
}

interface CheckRow {
  readonly id: string;
  readonly trigger: string;
  readonly scope_json: string;
  readonly strictness: string;
  readonly depth: number;
  readonly inputs_json: string;
  readonly floor_raised: number;
  readonly actor_user_id: string | null;
  readonly created_at: string;
}

// The most recent check naming this matter. `created_at DESC` walks the
// (subject_matter_id, created_at, id) index; `rowid DESC` breaks a same-millisecond tie the way the
// disposition read does, and for the same reason — identifiers are random tokens with no time order,
// so a lexical tie-break could name the older row as the latest and report the wrong scope.
async function readLatestCheckRow(
  database: SqlDatabase,
  matterId: string,
): Promise<CheckRow | null> {
  const { results } = await database
    .prepare(
      `SELECT id, trigger, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at
         FROM ${CONFLICTS_CHECK_TABLE}
        WHERE subject_matter_id = ?1
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1`,
    )
    .bind(matterId)
    .all<CheckRow>();
  return results[0] ?? null;
}

// A stored JSON blob is read defensively throughout: the log is append-only and years old rows outlive
// the code that wrote them, so a shape that no longer parses must degrade to "nothing recorded" rather
// than crash the read of a matter's whole conflicts posture.
//
// Exported because the check read and the posture read are two views of the SAME stored row, and a
// second copy of this parsing is how the two would come to disagree about what a check searched.
export function parseCheckScope(scopeJson: string): Record<string, SourceAvailability> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(scopeJson);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const scope: Record<string, SourceAvailability> = {};
  for (const [source, availability] of Object.entries(parsed as Record<string, unknown>)) {
    if (availability === "searched" || availability === "unavailable") scope[source] = availability;
  }
  return scope;
}

export interface CheckInputs {
  readonly subjectEntityIds: readonly string[];
  readonly expandedEntityIds: readonly string[];
  readonly skippedIdentifierTypes: readonly string[];
}

export function parseCheckInputs(inputsJson: string): CheckInputs {
  const empty: CheckInputs = {
    subjectEntityIds: [],
    expandedEntityIds: [],
    skippedIdentifierTypes: [],
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputsJson);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null) return empty;
  const record = parsed as Record<string, unknown>;
  const stringArray = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    subjectEntityIds: stringArray(record["subjectEntityIds"]),
    expandedEntityIds: stringArray(record["expandedEntityIds"]),
    skippedIdentifierTypes: stringArray(record["skippedIdentifierTypes"]),
  };
}

// The scope a check recorded, shaped for the report sentence: every registered source, whether it ran,
// and — when it did not — why. One home for the availability-to-reason join, so the posture read and
// the check read can never explain the same stored row differently.
export function reportedSourcesFor(
  scope: Readonly<Record<string, SourceAvailability>>,
  context: { readonly hasSubjectMatter: boolean },
): ReportedSource[] {
  return Object.entries(scope)
    .map(([source, availability]) => ({
      source,
      availability,
      reason: availability === "unavailable" ? unavailabilityReason(source, context) : null,
    }))
    .toSorted((left, right) => left.source.localeCompare(right.source));
}

const STRICTNESS_RANK: Record<Strictness, number> = { balanced: 0, over_inclusive: 1 };

function rankOfStoredStrictness(stored: string): number {
  return STRICTNESS_LEVELS.includes(stored as Strictness)
    ? STRICTNESS_RANK[stored as Strictness]
    : // A strictness word this build does not know cannot be ranked against the floor. Treating it as
      // the lowest rank reports a shortfall rather than silently passing an unreadable scope.
      -1;
}

const NO_SHORTFALL: ScopeShortfall = { sources: [], strictness: null, depth: null };

const ZERO_UNDISPOSED_BY_TIER: readonly UndisposedTierCount[] = [
  { tier: 1, count: 0 },
  { tier: 2, count: 0 },
  { tier: 3, count: 0 },
  { tier: 4, count: 0 },
];

// How many pending re-checks one posture read reports. `pendingRecheck` states that something is
// owed and names the causes; it is not a work queue, so a bounded list keeps a matter with a large
// backlog readable. The count of what is owed is never the point — that a re-check is owed at all is.
const PENDING_RECHECK_PAGE = 50;

// The ledger row, narrowed to what a reader of a matter's posture needs: what changed, which handle
// it was about, when it happened, and when the platform noticed. The ledger's own row id is
// deliberately not carried — a pending re-check is a statement about the matter, not a job handle.
function toPendingRecheckRecord(request: {
  readonly causeTopic: string;
  readonly causeReference: string;
  readonly causeOccurredAt: string;
  readonly requestedAt: string;
}): PendingRecheckRecord {
  return {
    causeTopic: request.causeTopic,
    causeReference: request.causeReference,
    causeOccurredAt: request.causeOccurredAt,
    requestedAt: request.requestedAt,
  };
}

// The backstop's standing, read from the firm's settings on every posture read like everything else
// here. Two rows, and no write: whether the firm has the scheduled re-scan on, and when it last ran.
async function readPeriodicRescan(database: SqlDatabase): Promise<PeriodicRescanRecord> {
  const settings = await readConflictsRecheckSettings(database);
  const state = await readConflictsRescanState(database);
  return {
    enabled: settings.periodicRescanEnabled,
    intervalDays: settings.periodicRescanIntervalDays,
    lastRunAt: state.lastRunAt,
  };
}

export async function readMatterConflictsPosture(
  database: SqlDatabase,
  matterId: string,
): Promise<MatterConflictsPosture> {
  const checkRow = await readLatestCheckRow(database, matterId);
  // Read for BOTH arms below. A matter nobody has ever checked can still be owed a re-check — a
  // party was added to a matter that predates the engine — and reporting it as having nothing
  // pending because it has no check would hide exactly the case that most needs saying.
  const pendingRecheck = await readPendingRecheckRequests(database, matterId, PENDING_RECHECK_PAGE);
  const periodicRescan = await readPeriodicRescan(database);

  if (checkRow === null) {
    // Never checked. Reported as its own state, with an empty shortfall rather than a shortfall
    // against every floor source: there is no check to compare the policy against, and inventing one
    // would describe a search that never happened.
    return {
      matterId,
      neverChecked: true,
      latestCheck: null,
      scopeShortfall: NO_SHORTFALL,
      pendingRecheck: pendingRecheck.map(toPendingRecheckRecord),
      periodicRescan,
      undisposedByTier: ZERO_UNDISPOSED_BY_TIER,
      dispositionsByKind: [],
      unavailableSources: [],
    };
  }

  const policy = await readConflictsPolicy(database);
  const scope = parseCheckScope(checkRow.scope_json);
  const inputs = parseCheckInputs(checkRow.inputs_json);
  const hitStates = await readHitDispositionStates(database, checkRow.id);

  const undisposedCounts = new Map<EvidenceTier, number>([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ]);
  const dispositionsByKind = new Map<DispositionKind, { count: number; reviewers: Set<string> }>();
  for (const state of hitStates) {
    if (state.disposition === null) {
      undisposedCounts.set(state.evidenceTier, (undisposedCounts.get(state.evidenceTier) ?? 0) + 1);
      continue;
    }
    const group = dispositionsByKind.get(state.disposition.kind) ?? {
      count: 0,
      reviewers: new Set<string>(),
    };
    group.count += 1;
    group.reviewers.add(state.disposition.reviewerUserId);
    dispositionsByKind.set(state.disposition.kind, group);
  }

  // This read is always matter-scoped, so the check under it always had a matter to join firm members
  // against; the imputation-without-a-matter reason cannot apply here.
  const unavailableSources: UnavailableSourceRecord[] = reportedSourcesFor(scope, {
    hasSubjectMatter: true,
  })
    .filter((entry) => entry.availability === "unavailable")
    .map((entry) => ({
      source: entry.source,
      // reportedSourcesFor always derives a reason for an unavailable source, so the fallback is
      // unreachable — and where it is not, it calls the same table rather than inventing a sentence.
      reason: entry.reason ?? unavailabilityReason(entry.source, { hasSubjectMatter: true }),
    }));

  // The firm's floor is expressed in source CLASSES, so `prior_firm_history` — a registered source
  // with no class of its own — can never be floored and never appears here. It is reported through
  // `unavailableSources`, where it belongs.
  const shortfallSources = new Set(
    policy.floorSources.filter((source) => !Object.hasOwn(scope, source)),
  );
  const storedStrictnessRank = rankOfStoredStrictness(checkRow.strictness);
  const scopeShortfall: ScopeShortfall = {
    sources: SOURCE_CLASSES.filter((source) => shortfallSources.has(source)),
    strictness:
      storedStrictnessRank < STRICTNESS_RANK[policy.floorStrictness]
        ? { firmFloor: policy.floorStrictness, ranUnder: checkRow.strictness }
        : null,
    depth:
      checkRow.depth < policy.defaultDepth
        ? { firmDefault: policy.defaultDepth, ranAt: checkRow.depth }
        : null,
  };

  return {
    matterId,
    neverChecked: false,
    latestCheck: {
      id: checkRow.id,
      createdAt: checkRow.created_at,
      trigger: checkRow.trigger,
      actorUserId: checkRow.actor_user_id,
      scope: {
        sources: scope,
        strictness: checkRow.strictness,
        depth: checkRow.depth,
        floorRaised: checkRow.floor_raised === 1,
      },
      subjectEntityCount: inputs.subjectEntityIds.length,
      expandedEntityCount: inputs.expandedEntityIds.length,
      skippedIdentifierTypes: inputs.skippedIdentifierTypes,
      hitCount: hitStates.length,
    },
    scopeShortfall,
    pendingRecheck: pendingRecheck.map(toPendingRecheckRecord),
    periodicRescan,
    undisposedByTier: [...undisposedCounts]
      .toSorted(([left], [right]) => left - right)
      .map(([tier, count]) => ({ tier, count })),
    dispositionsByKind: [...dispositionsByKind]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([kind, group]) => ({
        kind,
        count: group.count,
        reviewerUserIds: [...group.reviewers].toSorted((left, right) => left.localeCompare(right)),
      })),
    unavailableSources,
  };
}

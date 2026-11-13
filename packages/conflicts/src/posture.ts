import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { RefusedTierCount } from "./candidate-bound.ts";
import { readHitDispositionStates } from "./disposition.ts";
import { readConflictsRecheckSettings, readConflictsRescanState } from "./recheck-settings.ts";
import { readPendingRecheckRequests } from "./recheck-statements.ts";
import type { ReportedPlaces, ReportedSource } from "./report-text.ts";
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
import { waiverIsIncomplete } from "./waiver.ts";

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
  // What the name comparison compared: the key columns, the phonetic encoders, and the name roles.
  // Null on a check written before the matching record existed — "the row does not say", never "it
  // compared what today's code compares".
  readonly matching: MatchingRecord | null;
  // How far the graph walk was allowed to go and whether it got there. Null on a check written before
  // the traversal record existed — "the row does not say", never "the walk completed".
  readonly traversal: TraversalRecord | null;
  // How many candidates the run was allowed to write and whether it had to refuse any. Null on a check
  // written before the candidate record existed, which reads the same way `traversal: null` does.
  readonly candidates: CandidateRecord | null;
}

export interface LatestCheckRecord {
  readonly id: string;
  // The number of the check this record is a run of, or null on a record no numbered check names.
  readonly checkNumber: string | null;
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
  /**
   * How many of those the platform could not produce the record for — today, waivers whose informed
   * consent is not confirmed in writing or whose confirmation is not filed. Zero on every other kind.
   *
   * It is counted rather than left to the hit list because this is the number a reader takes away: a
   * matter reported as carrying three waivers, two of which the firm cannot evidence, is not the
   * matter "three waivers" describes. Like everything else here it is derived on every read, so
   * filing the confirmation later (a second disposition row — the table is append-only) changes it
   * with no sweep and no write.
   */
  readonly incompleteCount: number;
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
  readonly check_number: string | null;
}

const CHECK_ROW_COLUMNS =
  "record.id, record.trigger, record.scope_json, record.strictness, record.depth, record.inputs_json, record.floor_raised, record.actor_user_id, record.created_at, numbered.check_number";

// The most recent search record for this matter — the newer of two indexed reads, because a matter's
// record arrives two ways. A search that RAN against the matter carries it on the record row, and
// the (subject_matter_id, created_at, id) index serves that. A check FILED on the matter after it
// ran (docs/conventions/conflicts-rulings.md, R3) carries the matter on the numbered check, and the
// numbered check's own matter index serves that; its runs' records are the matter's history from
// the moment it is filed. Two reads rather than one OR, so each walks its index instead of scanning.
//
// `rowid DESC` breaks a same-millisecond tie the way the disposition read does, and for the same
// reason — identifiers are random tokens with no time order, so a lexical tie-break could name the
// older row as the latest and report the wrong scope.
async function readLatestCheckRow(
  database: SqlDatabase,
  matterId: string,
): Promise<CheckRow | null> {
  const ranAgainst = await database
    .prepare(
      `SELECT ${CHECK_ROW_COLUMNS}
         FROM ${CONFLICTS_CHECK_TABLE} AS record
         LEFT JOIN conflicts_check_run AS run ON run.id = record.id
         LEFT JOIN conflicts_numbered_check AS numbered ON numbered.id = run.numbered_check_id
        WHERE record.subject_matter_id = ?1
        ORDER BY record.created_at DESC, record.rowid DESC
        LIMIT 1`,
    )
    .bind(matterId)
    .all<CheckRow>();
  const filedOn = await database
    .prepare(
      `SELECT ${CHECK_ROW_COLUMNS}
         FROM conflicts_numbered_check AS numbered
         JOIN conflicts_check_run AS run ON run.numbered_check_id = numbered.id
         JOIN ${CONFLICTS_CHECK_TABLE} AS record ON record.id = run.id
        WHERE numbered.subject_matter_id = ?1
        ORDER BY record.created_at DESC, record.rowid DESC
        LIMIT 1`,
    )
    .bind(matterId)
    .all<CheckRow>();
  const candidates = [ranAgainst.results[0], filedOn.results[0]].filter(
    (row): row is CheckRow => row !== undefined,
  );
  const newest = candidates.toSorted((left, right) =>
    right.created_at.localeCompare(left.created_at),
  )[0];
  return newest ?? null;
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

// HOW FAR THE WALK WENT, AND WHERE IT STOPPED — read back off the check row verbatim.
//
// `truncated` is the load-bearing field and it is never inferred: the walk itself decides whether the
// closure cap stopped it, and the row says so. A truncated expansion reported as a completed one is
// the depth version of reporting an unsearchable source as searched and clean, and both are the same
// failure — the platform telling a firm it looked somewhere it did not look.
export interface TraversalRecord {
  // True on a run that followed every relationship to closure — every row written since the hop
  // budgets were removed. False on an older row, whose `edgeClassBudgets` say how far it went.
  readonly followedToClosure: boolean;
  // The longest chain of relationships the walk followed. Null on a row that did not record it.
  readonly longestPathLength: number | null;
  // The hop budget per budgeted edge class, as resolved for an OLDER run. Empty on a check that
  // followed relationships to closure, and on one written before the traversal record existed.
  readonly edgeClassBudgets: Readonly<Record<string, number>>;
  // The most entities the walk was allowed to reach: the platform's ceiling on a run that followed
  // relationships to closure, the firm's cap on an older one. Null when the row does not say.
  readonly closureCap: number | null;
  readonly truncated: boolean;
  // Present only on a truncated walk.
  readonly entitiesReached: number | null;
  // Distinct entities the cap refused to admit. These were never matched.
  readonly unexploredFrontierSize: number | null;
  // Entities that ARE in the closure and WERE matched, but whose own edges were never read.
  readonly unexpandedReachedCount: number | null;
}

// HOW MANY CANDIDATES THE RUN WROTE, AND HOW MANY IT REFUSED — read back off the check row verbatim.
//
// The closure cap bounds the walk; this bounds what the walk's matching produced, which is the walk
// times the corpus and therefore the quantity that actually grows. `truncated` is the load-bearing
// field and it is never inferred: the run itself decides whether the cap bit, and the row says so.
export interface CandidateRecord {
  readonly candidateCap: number | null;
  readonly truncated: boolean;
  // Present only on a truncated run.
  readonly candidatesSurfaced: number | null;
  readonly candidatesWritten: number | null;
  readonly candidatesRefused: number | null;
  // Which evidence tiers lost candidates. All tier 4 is the ordinary shape of an over-broad trigram
  // channel; anything stronger in here means the run was far enough over the bound to lose real
  // evidence, and a reader has to be able to see that at a glance.
  readonly refusedByTier: readonly RefusedTierCount[];
}

// What the name comparison actually did. `strictness` is on the row as the human-facing preset name,
// but a preset is a word whose meaning moves as channels are added — a check from March compared fewer
// things than a check from September under the same word — so the row names the channels too, and this
// is how a reader gets at them.
export interface MatchingRecord {
  // The `directory_name` key columns compared for equality.
  readonly nameKeys: readonly string[];
  // The phonetic encoders that ran.
  readonly phoneticSchemes: readonly string[];
  // The name roles compared. `null` means EVERY role the corpus holds — a distinct statement from a
  // list that happens to name them all, because a firm that adds a role later is covered by the first
  // and not by the second.
  readonly nameRoles: readonly string[] | null;
  // Whether names were also compared by trigram overlap. A row written before the choice existed
  // ran it, so an absent key reads true.
  readonly trigramMatching: boolean;
}

export interface CheckInputs {
  readonly subjectEntityIds: readonly string[];
  readonly expandedEntityIds: readonly string[];
  readonly skippedIdentifierTypes: readonly string[];
  // Null on a row written before the matching record existed. "The row does not say" — never "the
  // check compared what today's code would compare", which is the reading the record exists to end.
  readonly matching: MatchingRecord | null;
  // Null on a row written before the traversal record existed. Null is "the row does not say", which
  // is a different fact from "the walk completed" and is reported as its own thing.
  readonly traversal: TraversalRecord | null;
  // Null on a row written before the candidate record existed, and read the same way.
  readonly candidates: CandidateRecord | null;
  // Null when the run searched none of the firm's own records (or predates searching them).
  readonly places: ReportedPlaces | null;
}

function parsePlacesRecord(value: unknown): ReportedPlaces | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const strings = (entry: unknown): readonly string[] =>
    Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string") : [];
  const count = (entry: unknown): number | null =>
    typeof entry === "number" && Number.isFinite(entry) ? entry : null;
  return {
    messaging: strings(record["messaging"]),
    tasks: strings(record["tasks"]),
    magnus: record["magnus"] === true,
    files: strings(record["files"]),
    filesSearched: typeof record["filesSearched"] === "boolean" ? record["filesSearched"] : null,
    fileMattersInReach: count(record["fileMattersInReach"]),
    fileMattersSearched: count(record["fileMattersSearched"]),
    fileMattersNotSearched: count(record["fileMattersNotSearched"]),
    fileMattersFailed: count(record["fileMattersFailed"]),
    nameFloor: count(record["nameFloor"]),
    namesAtCeiling: count(record["namesAtCeiling"]),
    nameResultCeiling: count(record["nameResultCeiling"]),
    resultsFound: count(record["resultsFound"]),
    resultsRefused: count(record["resultsRefused"]),
  };
}

const NO_TRAVERSAL_RECORD = null;
const NO_CANDIDATE_RECORD = null;
const NO_MATCHING_RECORD = null;

function parseMatchingRecord(value: unknown): MatchingRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return NO_MATCHING_RECORD;
  }
  const record = value as Record<string, unknown>;
  const stringArray = (candidate: unknown): readonly string[] =>
    Array.isArray(candidate)
      ? candidate.filter((entry): entry is string => typeof entry === "string")
      : [];
  const storedRoles = record["nameRoles"];
  return {
    nameKeys: stringArray(record["nameKeys"]),
    phoneticSchemes: stringArray(record["phoneticSchemes"]),
    // An absent key and a stored null both mean every role, which is what an over-inclusive run
    // records. Only an actual array narrows.
    nameRoles: Array.isArray(storedRoles) ? stringArray(storedRoles) : null,
    trigramMatching: record["trigramMatching"] !== false,
  };
}

function parseTraversalRecord(value: unknown): TraversalRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return NO_TRAVERSAL_RECORD;
  }
  const record = value as Record<string, unknown>;
  const finiteNumber = (candidate: unknown): number | null =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
  const budgets: Record<string, number> = {};
  const storedBudgets = record["edgeClassBudgets"];
  if (
    typeof storedBudgets === "object" &&
    storedBudgets !== null &&
    !Array.isArray(storedBudgets)
  ) {
    for (const [edgeClass, budget] of Object.entries(storedBudgets as Record<string, unknown>)) {
      const parsedBudget = finiteNumber(budget);
      if (parsedBudget !== null) budgets[edgeClass] = parsedBudget;
    }
  }
  return {
    followedToClosure: record["followedToClosure"] === true,
    longestPathLength: finiteNumber(record["longestPathLength"]),
    edgeClassBudgets: budgets,
    closureCap: finiteNumber(record["closureCap"]),
    truncated: record["truncated"] === true,
    entitiesReached: finiteNumber(record["entitiesReached"]),
    unexploredFrontierSize: finiteNumber(record["unexploredFrontierSize"]),
    unexpandedReachedCount: finiteNumber(record["unexpandedReachedCount"]),
  };
}

function parseCandidateRecord(value: unknown): CandidateRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return NO_CANDIDATE_RECORD;
  }
  const record = value as Record<string, unknown>;
  const finiteNumber = (candidate: unknown): number | null =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
  const refusedByTier: RefusedTierCount[] = [];
  const storedRefused = record["refusedByTier"];
  if (Array.isArray(storedRefused)) {
    for (const entry of storedRefused) {
      if (typeof entry !== "object" || entry === null) continue;
      const tier = finiteNumber((entry as Record<string, unknown>)["tier"]);
      const count = finiteNumber((entry as Record<string, unknown>)["count"]);
      if (tier === null || count === null) continue;
      if (tier !== 1 && tier !== 2 && tier !== 3 && tier !== 4) continue;
      refusedByTier.push({ tier, count });
    }
  }
  return {
    candidateCap: finiteNumber(record["candidateCap"]),
    truncated: record["truncated"] === true,
    candidatesSurfaced: finiteNumber(record["candidatesSurfaced"]),
    candidatesWritten: finiteNumber(record["candidatesWritten"]),
    candidatesRefused: finiteNumber(record["candidatesRefused"]),
    refusedByTier,
  };
}

export function parseCheckInputs(inputsJson: string): CheckInputs {
  const empty: CheckInputs = {
    subjectEntityIds: [],
    expandedEntityIds: [],
    skippedIdentifierTypes: [],
    matching: NO_MATCHING_RECORD,
    traversal: NO_TRAVERSAL_RECORD,
    candidates: NO_CANDIDATE_RECORD,
    places: null,
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
    matching: parseMatchingRecord(record["matching"]),
    traversal: parseTraversalRecord(record["traversal"]),
    candidates: parseCandidateRecord(record["candidates"]),
    places: parsePlacesRecord(record["places"]),
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

const NO_SHORTFALL: ScopeShortfall = { sources: [], strictness: null };

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
  const dispositionsByKind = new Map<
    DispositionKind,
    { count: number; incomplete: number; reviewers: Set<string> }
  >();
  for (const state of hitStates) {
    if (state.disposition === null) {
      undisposedCounts.set(state.evidenceTier, (undisposedCounts.get(state.evidenceTier) ?? 0) + 1);
      continue;
    }
    const group = dispositionsByKind.get(state.disposition.kind) ?? {
      count: 0,
      incomplete: 0,
      reviewers: new Set<string>(),
    };
    group.count += 1;
    if (waiverIsIncomplete(state.disposition.kind, state.disposition.waiver)) {
      group.incomplete += 1;
    }
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
  };

  return {
    matterId,
    neverChecked: false,
    latestCheck: {
      id: checkRow.id,
      checkNumber: checkRow.check_number,
      createdAt: checkRow.created_at,
      trigger: checkRow.trigger,
      actorUserId: checkRow.actor_user_id,
      scope: {
        sources: scope,
        strictness: checkRow.strictness,
        depth: checkRow.depth,
        floorRaised: checkRow.floor_raised === 1,
        matching: inputs.matching,
        traversal: inputs.traversal,
        candidates: inputs.candidates,
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
        incompleteCount: group.incomplete,
      })),
    unavailableSources,
  };
}

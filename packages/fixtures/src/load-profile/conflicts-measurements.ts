import { directoryIdentifierValue } from "@magna-carta/data-access/protected-field-registry";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import type { ConflictsWriteOptions } from "@magna-carta/conflicts/audit";
import { runConflictsCheck } from "@magna-carta/conflicts/run-check";
import { findImputationHits } from "@magna-carta/conflicts/imputation";
import { expandGraph } from "@magna-carta/conflicts/expansion";
import { matchPartyBatch } from "@magna-carta/conflicts/matching";
import { readSubjectFactsBatch } from "@magna-carta/conflicts/subject-facts";
import type { Strictness } from "@magna-carta/conflicts/types";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { createProfileFirmKeyProvider, PROTECTED_FIRM_KEY_VERSION } from "./protected-generate.ts";
import { selectConflictsChecksStatement } from "@magna-carta/conflicts/statements";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The conflicts volume-shaped measured set. The engine reads the directory corpus the directory
// generator laid down (persons, name history, edges, blind-indexed identifiers, matter parties), so
// its hot paths ride that same production-faithful shape:
//   - `conflicts.run-check` runs a REAL firm-wide check against the busiest directory node: scope
//     resolution, breadth-first graph expansion (`expandGraph`) under the firm's typed per-edge-class
//     budgets and closure cap, then the BATCHED matcher over the whole reached set (one subject-facts
//     read per node table, then each blocking channel once — candidate generation, the exact-name
//     probe, and the blind-index self-join), and the atomic batch write of the check row plus every
//     surfaced hit. It self-generates its log rows, so it needs no pre-seeded conflicts corpus. This is
//     the flagship — its cost scales with the graph and the corpus.
//   - `conflicts.run-check-deep-graph` and `conflicts.run-check-truncating` run the same check over the
//     deep corporate group: one complete walk of a group that fits under its cap, and one that does
//     not, so the cost of stopping honestly is measured rather than assumed.
//   - `conflicts.imputation` runs the identity join (`matter_party -> directory_person -> member`) over
//     a page of the firm's matters — the cost is the join over the matter-party volume.
// The plan probes hold the new conflicts SQL (the imputation join, the blind-index self-join, the
// exact-name probe, and the two log reads) scan-free at volume.

// The read/write context every conflicts check needs to walk the directory corpus. Mirrors
// directoryMeasurementHandle: the seed-derived firm key (never minted randomly, so it matches the key
// that sealed the cached identifier ciphertexts), viewSensitiveIdentifiers permission, the per-firm
// database, and a measurement-only clock/random stream disjoint from the seeded data.
export interface ConflictsMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  readonly context: FixtureContext;
  readonly identifierContext: DirectoryIdentifierContext;
  readonly writeOptions: ConflictsWriteOptions;
  // The busiest directory node — the check subject whose graph expansion + matching is the hot case.
  readonly subjectEntityId: string;
  // A matter the subject is a party to (or null), so a check exercises the matter-party seed read too.
  readonly subjectMatterId: string | null;
  // A page of matter ids the imputation join runs over.
  readonly matterIdPage: readonly string[];
  // The deterministic co-party pair (two identically-named persons). A check seeded with both surfaces
  // each as the other's hit, flagged co_party — the measured expression of the co-party surfacing path.
  readonly coPartyEntityIds: readonly [string, string];
  // The head of the deep corporate group — a long successor lineage with a wide subsidiary fan.
  // Corporate-family edges cost no hops, so a check seeded here expands the whole group in one
  // closure: the deep-graph case, and the case the closure cap and its truncation record exist for.
  readonly corporateGroupHeadId: string;
  readonly corporateGroupSize: number;
  // The subjects the match-key channels are measured against: one firm's name spelled two ways plus
  // the same name under a different legal form. Measuring a new channel against subjects that cannot
  // exercise it would report a real channel finding nothing as if that were its cost.
  readonly matchKeySubjectIds: readonly string[];
}

// How many matters the imputation join reads per iteration.
const IMPUTATION_MATTER_PAGE = 50;

export async function conflictsMeasurementHandle(
  snapshot: LoadedSnapshot,
  seed: string,
): Promise<ConflictsMeasurementHandle> {
  const context = fixtureContext(`${seed}:conflicts-measure`);
  const { directoryProbes } = snapshot.manifest;
  const firmKeyProvider = await createProfileFirmKeyProvider(snapshot.manifest.seed);
  const identifierContext: DirectoryIdentifierContext = {
    firmId: directoryProbes.firmId,
    firmKeyVersion: PROTECTED_FIRM_KEY_VERSION,
    firmKeyProvider,
    database: snapshot.database,
    effectivePermissions: new Set([directoryIdentifierValue.permission]),
    actorUserId: null,
    clock: context.clock,
    randomSource: context.randomSource,
  };
  const writeOptions: ConflictsWriteOptions = {
    clock: context.clock,
    actorUserId: null,
    randomSource: context.randomSource,
  };

  // The matter the subject is a party to (null on a directory-only smaller scale with no links).
  const { results: subjectMatter } = await snapshot.database
    .prepare(
      "SELECT matter_id FROM matter_party WHERE entity_id = ?1 AND deleted_at IS NULL ORDER BY matter_id LIMIT 1",
    )
    .bind(directoryProbes.probePersonId)
    .all<{ matter_id: string }>();

  const { results: matterRows } = await snapshot.database
    .prepare("SELECT id FROM matter ORDER BY id LIMIT ?1")
    .bind(IMPUTATION_MATTER_PAGE)
    .all<{ id: string }>();

  return {
    snapshot,
    context,
    identifierContext,
    writeOptions,
    subjectEntityId: directoryProbes.probePersonId,
    subjectMatterId: subjectMatter[0]?.matter_id ?? null,
    matterIdPage: matterRows.map((row) => row.id),
    coPartyEntityIds: [directoryProbes.coPartyEntityIdA, directoryProbes.coPartyEntityIdB],
    corporateGroupHeadId: directoryProbes.corporateGroupHeadId,
    corporateGroupSize: directoryProbes.corporateGroupSize,
    matchKeySubjectIds: [
      directoryProbes.matchKeyOrganizationIdA,
      directoryProbes.matchKeyOrganizationIdB,
      directoryProbes.matchKeyOrganizationIdBareForm,
    ],
  };
}

// WHY THESE CAPS ARE SMALL, AND WHAT THE HARNESS FOUND.
//
// Hits do not scale with the closure. They scale with the closure TIMES the corpus, because the
// trigram blocking channel is close to all-pairs on multi-word organization names: every name shares
// three-character windows like " an", "and", "nd " with almost every other, so each reached entity
// returns most of the organization corpus as candidates. Nothing is suppressed by design — a
// threshold is how a missed conflict becomes an invisible one — so every candidate becomes a written
// hit row.
//
// At this profile's shape (a ~600-entity corporate group over a ~700-organization corpus) a walk at
// the shipped default closure cap composes several hundred thousand INSERTs into one batch. Both
// halves of that were findings when this module first recorded them, and both are now fixed at the
// seams that own them: `composeEffectBatch` in packages/data-access/src/effect-batch.ts no longer
// spreads its statement list (an argument-count ceiling in the middle of a data path) and refuses an
// unbounded batch at a stated ceiling instead; and the conflicts run carries a SECOND bound, on
// candidates, beside the one on the closure — see packages/conflicts/src/candidate-bound.ts.
// `conflictsCandidateBounds` below is the measurement that decided the shape of that fix and is what
// re-measures it.
//
// So the caps here are sized to exercise the traversal and the truncation record without composing a
// batch whose size is a statement about the corpus rather than about the walk. They are deliberately
// not the shipped defaults, and the gap between them is the finding.
const DEEP_GRAPH_CLOSURE_CAP = 40;

// Below the group's size, so this walk always meets its bound and the cost of stopping honestly —
// and of recording what was not reached — is measured rather than assumed.
const TRUNCATING_CLOSURE_CAP = 15;

export const conflictsMeasurements: readonly Measurement<ConflictsMeasurementHandle, unknown>[] = [
  {
    name: "conflicts.run-check",
    operation: async (handle) => {
      // A full firm-wide check against the busiest node: expansion + the batched matcher over the
      // reached set + the atomic write of the check and every hit. Writes its own log rows
      // (append-only, discarded with the working copy).
      await runConflictsCheck(
        handle.identifierContext,
        {
          trigger: "comprehensive",
          matterId: handle.subjectMatterId ?? undefined,
          subjectEntityIds: [handle.subjectEntityId],
          scope: { sources: ["party", "graph"], strictness: "balanced" },
        },
        handle.writeOptions,
      );
    },
  },
  {
    name: "conflicts.imputation",
    operation: async (handle) => {
      // The identity join over a page of the firm's matters — matter_party -> directory_person ->
      // member — never a similarity matcher.
      await findImputationHits(handle.snapshot.database, handle.matterIdPage);
    },
  },
  {
    name: "conflicts.co-party-check",
    operation: async (handle) => {
      // A check seeded with BOTH members of the identically-named co-party pair. Matching either one
      // surfaces the other — a match on a DIFFERENT subject party — which run-check records flagged
      // co_party rather than dropping (only a self-match is dropped). over_inclusive so the surfacing
      // is guaranteed at any scale. Writes its own append-only log rows, discarded with the working copy.
      await runConflictsCheck(
        handle.identifierContext,
        {
          trigger: "comprehensive",
          subjectEntityIds: [...handle.coPartyEntityIds],
          scope: { sources: ["party", "graph"], strictness: "over_inclusive" },
        },
        handle.writeOptions,
      );
    },
  },
  {
    name: "conflicts.run-check-deep-graph",
    operation: async (handle) => {
      // A check seeded at the head of the deep corporate group. Corporate-family edges are free, so
      // the lineage plus part of its subsidiary fan lands in ONE closure, all of it matched. This is
      // the flagship for the batched matcher: on the per-entity path it is four queries per entity,
      // and the whole point of the batch is that it is not.
      await runConflictsCheck(
        handle.identifierContext,
        {
          trigger: "comprehensive",
          subjectEntityIds: [handle.corporateGroupHeadId],
          scope: { sources: ["party", "graph"], strictness: "balanced" },
        },
        handle.writeOptions,
      );
    },
  },
  {
    name: "conflicts.run-check-matching-depth",
    operation: async (handle) => {
      // The same deep-graph walk at OVER-INCLUSIVE strictness, which is the band that runs every
      // matching channel: both Double Metaphone schemes, both match keys, and every name role.
      // Measured beside the balanced run above so the cost of the depth is a number on the record
      // rather than an argument, and so a later channel that quietly changes the slope shows.
      await runConflictsCheck(
        handle.identifierContext,
        {
          trigger: "comprehensive",
          subjectEntityIds: [handle.corporateGroupHeadId],
          scope: { sources: ["party", "graph"], strictness: "over_inclusive" },
        },
        handle.writeOptions,
      );
    },
  },
  {
    name: "conflicts.run-check-truncating",
    operation: async (handle) => {
      // The same group under a ceiling it cannot fit in. The walk stops and records the frontier it
      // did not reach. A check itself takes no ceiling — the platform's is the only one — so the walk
      // is measured on its own, with the ceiling the walker takes for exactly this measurement.
      // Measured because stopping honestly is a code path like any other, and one that runs on
      // exactly the corpora where the engine is under the most pressure.
      await expandGraph(handle.identifierContext.database, [handle.corporateGroupHeadId], {
        ceiling: TRUNCATING_CLOSURE_CAP,
        asOf: handle.identifierContext.clock.now(),
      });
    },
  },
];

// The batched matcher's query count over the deep corporate group, counted rather than timed: a
// timing shows an N+1 only once the corpus is large enough for the difference to clear the noise,
// while a count shows it the moment somebody puts a read back inside the loop. Reported beside the
// timings, like the calendar's timeline bounds.
export interface ConflictsMatcherBound {
  readonly label: string;
  readonly subjectCount: number;
  readonly statementCount: number;
}

export async function conflictsMatcherBounds(
  handle: ConflictsMeasurementHandle,
): Promise<ConflictsMatcherBound[]> {
  const expansion = await expandGraph(
    handle.identifierContext.database,
    [handle.corporateGroupHeadId],
    { ceiling: DEEP_GRAPH_CLOSURE_CAP, asOf: handle.identifierContext.clock.now() },
  );
  const entityIds = expansion.entities.map((entity) => entity.entityId);
  const facts = await readSubjectFactsBatch(handle.identifierContext, entityIds);
  const subjects = entityIds
    .map((entityId) => facts.get(entityId))
    .filter((subject) => subject !== undefined);

  const database = handle.identifierContext.database as unknown as {
    prepare: (sql: string) => unknown;
  };
  const realPrepare = database.prepare.bind(database);
  const countFor = async (strictness: Strictness): Promise<number> => {
    let statementCount = 0;
    database.prepare = (sql: string) => {
      statementCount += 1;
      return realPrepare(sql);
    };
    await matchPartyBatch(handle.identifierContext, subjects, strictness);
    database.prepare = realPrepare;
    return statementCount;
  };

  // Both bands, because they do not run the same channels: the two match keys run at both, while the
  // secondary Double Metaphone scheme and every non-current name role are over-inclusive only.
  // Counting one band would leave the wider one's cost unmeasured, and the wider one is the band a
  // firm reaches for when it most needs recall.
  return [
    {
      label: "conflicts.matcher-batch-deep-graph",
      subjectCount: subjects.length,
      statementCount: await countFor("balanced"),
    },
    {
      label: "conflicts.matcher-batch-deep-graph-over-inclusive",
      subjectCount: subjects.length,
      statementCount: await countFor("over_inclusive"),
    },
  ];
}

// WHERE THE CANDIDATES ACTUALLY COME FROM — the axis a timing cannot show and a plan cannot see.
//
// The closure cap bounds the walk. This counts what the walk COSTS, which is a different quantity: the
// candidates one subject produces are proportional to the CORPUS, so the run's total is the closure
// times the corpus and the cap bounds one factor of a product. Counted rather than timed for the same
// reason the matcher bound above is: at any one corpus a timing says nothing about the slope, and the
// slope is the whole finding.
//
// The corpus axis is swept by running the harness at several profile multipliers — that is what
// `scaleProfile` is for, and two baselines at different scales ARE the sweep. Reading them together
// shows candidates rising linearly in the corpus with the closure pinned, at very different rates per
// subject kind: multi-word organization names share a three-character window with nearly every other
// organization, and two-token person names share one far less often. `trigramOnlyCandidates` is the
// number that matters — a candidate whose ONLY signal is a shared trigram is the volume, and the
// phonetic and identifier channels stay corpus-independent beside it.
export interface ConflictsCandidateBound {
  readonly label: string;
  readonly subjectCount: number;
  // The whole live corpus of the subject's own kind, which is what the name channels search.
  readonly corpusOfKind: number;
  readonly candidateCount: number;
  readonly trigramOnlyCandidates: number;
  readonly phoneticCandidates: number;
  readonly exactNameCandidates: number;
  readonly identifierCandidates: number;
  // The two match-key channels, counted separately from the ones above: a new channel that finds
  // nothing is worse than no channel, because it reads as coverage. These numbers are what say
  // whether it is finding anything against a real corpus at volume.
  readonly matchKeyCandidates: number;
  readonly bareMatchKeyCandidates: number;
}

async function countLiveEntities(
  handle: ConflictsMeasurementHandle,
  table: string,
): Promise<number> {
  const { results } = await handle.identifierContext.database
    .prepare(`SELECT COUNT(*) AS live FROM ${table} WHERE deleted_at IS NULL`)
    .all<{ live: number }>();
  return results[0]?.live ?? 0;
}

async function candidateBoundFor(
  handle: ConflictsMeasurementHandle,
  label: string,
  entityIds: readonly string[],
  corpusOfKind: number,
  strictness: Strictness,
): Promise<ConflictsCandidateBound> {
  const facts = await readSubjectFactsBatch(handle.identifierContext, entityIds);
  const subjects = entityIds
    .map((entityId) => facts.get(entityId))
    .filter((subject) => subject !== undefined);
  const matches = await matchPartyBatch(handle.identifierContext, subjects, strictness);

  let candidateCount = 0;
  let trigramOnlyCandidates = 0;
  let phoneticCandidates = 0;
  let exactNameCandidates = 0;
  let identifierCandidates = 0;
  let matchKeyCandidates = 0;
  let bareMatchKeyCandidates = 0;
  for (const candidates of matches.values()) {
    for (const { evidence } of candidates) {
      candidateCount += 1;
      if (evidence.matchKeyName === true) matchKeyCandidates += 1;
      if (evidence.bareMatchKeyName === true) bareMatchKeyCandidates += 1;
      if (evidence.phoneticMatch) phoneticCandidates += 1;
      if (evidence.exactNormalizedName) exactNameCandidates += 1;
      if (evidence.identifierTypes.length > 0) identifierCandidates += 1;
      if (
        evidence.trigramMatch &&
        !evidence.phoneticMatch &&
        !evidence.exactNormalizedName &&
        evidence.identifierTypes.length === 0
      ) {
        trigramOnlyCandidates += 1;
      }
    }
  }

  return {
    label,
    subjectCount: subjects.length,
    corpusOfKind,
    candidateCount,
    trigramOnlyCandidates,
    phoneticCandidates,
    exactNameCandidates,
    identifierCandidates,
    matchKeyCandidates,
    bareMatchKeyCandidates,
  };
}

// The busiest N entities of each kind, read deterministically. Both kinds are measured because the
// name channels filter on entity kind, so a corpus that grew only in one of them moves only one of
// these numbers — and collapsing them into one figure would hide which.
const CANDIDATE_BOUND_SUBJECTS = 10;

export async function conflictsCandidateBounds(
  handle: ConflictsMeasurementHandle,
): Promise<ConflictsCandidateBound[]> {
  const bounds: ConflictsCandidateBound[] = [];
  for (const [kind, table] of [
    ["person", "directory_person"],
    ["organization", "directory_organization"],
  ] as const) {
    const { results } = await handle.identifierContext.database
      .prepare(`SELECT id FROM ${table} WHERE deleted_at IS NULL ORDER BY id LIMIT ?1`)
      .bind(CANDIDATE_BOUND_SUBJECTS)
      .all<{ id: string }>();
    const entityIds = results.map((row) => row.id);
    const corpusOfKind = await countLiveEntities(handle, table);
    bounds.push(
      await candidateBoundFor(
        handle,
        `conflicts.candidates-per-${kind}-subject`,
        entityIds,
        corpusOfKind,
        "balanced",
      ),
    );
    // The same subjects at over-inclusive, which searches every name role and blends both Double
    // Metaphone schemes. Measured rather than reasoned about, because the whole claim behind widening
    // a band is that it finds something the narrower one does not.
    bounds.push(
      await candidateBoundFor(
        handle,
        `conflicts.candidates-per-${kind}-subject-over-inclusive`,
        entityIds,
        corpusOfKind,
        "over_inclusive",
      ),
    );
  }

  // The matching-depth subjects, measured on their own rather than folded into the busiest-ten above:
  // a channel's contribution is invisible inside a count dominated by trigram overlap, and these are
  // the subjects that say whether the channel found anything at all against the real corpus at volume.
  bounds.push(
    await candidateBoundFor(
      handle,
      "conflicts.candidates-match-key-subjects",
      handle.matchKeySubjectIds,
      await countLiveEntities(handle, "directory_organization"),
      "balanced",
    ),
  );
  return bounds;
}

// Nothing is allowlisted: every EXPLAIN'd conflicts hot path must walk an index.
export const CONFLICTS_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

// Recover the node:sqlite statement shape (SQL text + bindings) the EXPLAIN probe needs — the D1-shaped
// return type omits them. Keeps the probes on the REAL SQL rather than a drifting literal copy.
function captured(statement: { bind(...values: unknown[]): unknown }): NodeSqlStatement {
  return statement as unknown as NodeSqlStatement;
}

// The imputation identity join (imputation.ts): matter_party -> directory_person -> member, filtered to
// the queried matters. matter_party.matter_id walks its index; the two joins seek the primary keys.
function imputationJoinPlanStatement(snapshot: LoadedSnapshot, matterId: string): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        `SELECT m.user_id, dp.id, mp.matter_id, mp.role
         FROM matter_party AS mp
         JOIN directory_person AS dp ON dp.id = mp.entity_id
         JOIN member AS m ON m.user_id = dp.member_id
         WHERE mp.matter_id IN (?1) AND mp.deleted_at IS NULL AND dp.deleted_at IS NULL
         ORDER BY m.user_id ASC, mp.matter_id ASC, mp.role ASC`,
      )
      .bind(matterId),
  );
}

// The conflicts blind-index self-join (identifiers.ts findEntitiesSharingIdentifiers): the subject's
// sealed identifiers matched against every other entity's by indexed equality. The subject side walks
// the entity_id index; the other side seeks the (identifier_type, value_blind_index) index.
function blindIndexSelfJoinPlanStatement(
  snapshot: LoadedSnapshot,
  subjectEntityId: string,
): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        `SELECT DISTINCT other.entity_id, other.identifier_type
         FROM directory_identifier AS subject
         JOIN directory_identifier AS other
           ON other.identifier_type = subject.identifier_type
          AND other.value_blind_index = subject.value_blind_index
         WHERE subject.entity_id = ?1
           AND other.entity_id <> ?1
           AND subject.value_blind_index IS NOT NULL
           AND subject.deleted_at IS NULL
           AND other.deleted_at IS NULL`,
      )
      .bind(subjectEntityId),
  );
}

// The tier-2 exact-name probe (matching.ts exactNameMatches): normalized_display equality, scoped to a
// name role. It walks the directory_name normalized_display index.
function exactNamePlanStatement(snapshot: LoadedSnapshot): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        `SELECT DISTINCT COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id
         FROM directory_name AS dn
         LEFT JOIN directory_person AS dp ON dn.entity_kind = 'person' AND dp.id = dn.entity_id
         LEFT JOIN directory_organization AS do ON dn.entity_kind = 'organization' AND do.id = dn.entity_id
         WHERE dn.normalized_display = ?1
           AND dn.deleted_at IS NULL
           AND dn.name_role IN (?2)
           AND (
             (dn.entity_kind = 'person' AND dp.deleted_at IS NULL)
             OR (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
           )`,
      )
      .bind("john public", "current"),
  );
}

// The two match-key probes (matching.ts nameKeyMatches): the same query as the exact-name probe with
// a different key column. Each walks its own directory_name index.
function matchKeyPlanStatement(
  snapshot: LoadedSnapshot,
  column: "normalized_match_key" | "normalized_match_key_bare",
): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        `SELECT DISTINCT dn.${column} AS match_key,
                COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id
         FROM directory_name AS dn
         LEFT JOIN directory_person AS dp ON dn.entity_kind = 'person' AND dp.id = dn.entity_id
         LEFT JOIN directory_organization AS do ON dn.entity_kind = 'organization' AND do.id = dn.entity_id
         WHERE dn.${column} IN (?1)
           AND dn.deleted_at IS NULL
           AND dn.name_role IN (?2)
           AND (
             (dn.entity_kind = 'person' AND dp.deleted_at IS NULL)
             OR (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
           )`,
      )
      .bind("john public", "current"),
  );
}

// The GET-path hit read (routes/directory/conflicts.ts readHitRows): a check's hits by check_id. Walks the
// conflicts_hit check_id index.
function hitsByCheckPlanStatement(snapshot: LoadedSnapshot): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        `SELECT id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, co_party, created_at
         FROM conflicts_hit WHERE check_id = ?1 ORDER BY created_at ASC, id ASC`,
      )
      .bind("conflictsCheck_probe"),
  );
}

// The current-disposition read (disposition.ts readCurrentDisposition): the latest disposition for a
// hit. The (hit_id, created_at) index serves both the filter and the ordering.
function dispositionCurrentPlanStatement(snapshot: LoadedSnapshot): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        `SELECT id, hit_id, kind, rationale, reviewer_user_id, created_at
         FROM conflicts_disposition WHERE hit_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .bind("conflictsHit_probe"),
  );
}

// The posture read's first query (posture.ts readLatestCheckRow): a matter's most recent check. Walks
// the conflicts_check (subject_matter_id, created_at, id) index — without it this scans every check the
// firm has ever run to answer a single matter's page.
function latestCheckForMatterPlanStatement(
  snapshot: LoadedSnapshot,
  matterId: string,
): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        `SELECT id, trigger, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at
         FROM conflicts_check WHERE subject_matter_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .bind(matterId),
  );
}

// The posture read's second query (disposition.ts readHitDispositionStates): every hit of one check
// with its latest disposition, in one read rather than one read per hit. The hit side walks the
// check_id index; the correlated latest-disposition subquery walks (hit_id, created_at).
function hitDispositionStatesPlanStatement(snapshot: LoadedSnapshot): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        `SELECT hit.id AS hit_id, hit.evidence_tier, hit.source_class, hit.co_party,
                latest.id AS disposition_id, latest.kind, latest.rationale, latest.reviewer_user_id,
                latest.created_at AS disposition_created_at
           FROM conflicts_hit AS hit
           LEFT JOIN conflicts_disposition AS latest
             ON latest.rowid = (
               SELECT candidate.rowid FROM conflicts_disposition AS candidate
                WHERE candidate.hit_id = hit.id
                ORDER BY candidate.created_at DESC, candidate.rowid DESC
                LIMIT 1
             )
          WHERE hit.check_id = ?1
          ORDER BY hit.created_at ASC, hit.id ASC`,
      )
      .bind("conflictsCheck_probe"),
  );
}

/*
 * The firm's check history, both ways it is asked for.
 *
 * These two plan DIFFERENTLY and the pair is the point. Filtered by matter, the
 * (subject_matter_id, created_at, id) index serves the narrowing and the order together — which is
 * what that index was added for. UNFILTERED, nothing leads with created_at, so the firm-wide listing
 * reads what matches and sorts it. Neither may become a full table SCAN of conflicts_check: a firm's
 * check log only grows, and a listing that scanned it would get slower every week the firm operates.
 *
 * Uses the REAL statement builder rather than a copy of its SQL, so a change to the read is measured
 * rather than a change to a literal in this file.
 */
function checkHistoryPlanStatement(
  snapshot: LoadedSnapshot,
  options: { readonly matterId?: string },
): NodeSqlStatement {
  return captured(
    selectConflictsChecksStatement(snapshot.database as never, {
      matterId: options.matterId,
      cursor: { createdAt: "2026-09-02T00:00:00.000Z", id: "conflictsCheck_probe" },
      limit: 51,
    }) as never,
  );
}

/*
 * "What has this firm already said about this party?" — asked of every hit of a check at once, to
 * show a reviewer an earlier answer as context.
 *
 * It matches conflicts_hit on entity_id across every check but the one in hand, and conflicts_hit
 * carried only (check_id) until 20260903T020000 — so this read scanned an append-only table that
 * only grows. conflicts_hit_entity_created_index is what this probe holds in place.
 */
function priorConclusionsPlanStatement(snapshot: LoadedSnapshot): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        `SELECT hit.entity_id, hit.check_id, answer.kind, answer.reviewer_user_id, answer.created_at
           FROM conflicts_hit AS hit
           JOIN conflicts_disposition AS answer ON answer.hit_id = hit.id
          WHERE hit.check_id != ?1 AND hit.entity_id IN (?2, ?3)
          ORDER BY answer.created_at ASC, answer.rowid ASC`,
      )
      .bind("conflictsCheck_probe", "directoryPerson_probe", "directoryOrganization_probe"),
  );
}

export function conflictsHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { directoryProbes } = snapshot.manifest;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "conflicts.imputation-join",
      statement: imputationJoinPlanStatement(snapshot, "matter_probe"),
    },
    {
      label: "conflicts.blind-index-self-join",
      statement: blindIndexSelfJoinPlanStatement(snapshot, directoryProbes.probePersonId),
    },
    { label: "conflicts.exact-name-probe", statement: exactNamePlanStatement(snapshot) },
    {
      label: "conflicts.match-key-probe",
      statement: matchKeyPlanStatement(snapshot, "normalized_match_key"),
    },
    {
      label: "conflicts.bare-match-key-probe",
      statement: matchKeyPlanStatement(snapshot, "normalized_match_key_bare"),
    },
    { label: "conflicts.hits-by-check", statement: hitsByCheckPlanStatement(snapshot) },
    {
      label: "conflicts.disposition-current",
      statement: dispositionCurrentPlanStatement(snapshot),
    },
    {
      label: "conflicts.latest-check-for-matter",
      statement: latestCheckForMatterPlanStatement(snapshot, "matter_probe"),
    },
    {
      label: "conflicts.hit-disposition-states",
      statement: hitDispositionStatesPlanStatement(snapshot),
    },
    {
      label: "conflicts.check-history-for-matter",
      statement: checkHistoryPlanStatement(snapshot, { matterId: "matter_probe" }),
    },
    {
      label: "conflicts.check-history-firm-wide",
      statement: checkHistoryPlanStatement(snapshot, {}),
    },
    { label: "conflicts.prior-conclusions", statement: priorConclusionsPlanStatement(snapshot) },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}

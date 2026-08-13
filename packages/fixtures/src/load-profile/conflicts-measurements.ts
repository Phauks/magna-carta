import { directoryIdentifierValue } from "@magna-carta/data-access/protected-field-registry";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import type { ConflictsWriteOptions } from "@magna-carta/conflicts/audit";
import { runConflictsCheck } from "@magna-carta/conflicts/run-check";
import { findImputationHits } from "@magna-carta/conflicts/imputation";
import type { FirmId } from "@magna-carta/identifiers/types";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { createProfileFirmKeyProvider, PROTECTED_FIRM_KEY_VERSION } from "./protected-generate.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The conflicts volume-shaped measured set. The engine reads the directory corpus the directory
// generator laid down (persons, name history, edges, blind-indexed identifiers, matter parties), so
// its hot paths ride that same production-faithful shape:
//   - `conflicts.run-check` runs a REAL firm-wide check against the busiest directory node: scope
//     resolution, breadth-first graph expansion (`expandGraph`), a `matchParty` per reached entity
//     (candidate generation + the exact-name probe + the blind-index self-join), and the atomic batch
//     write of the check row plus every surfaced hit. It self-generates its log rows, so it needs no
//     pre-seeded conflicts corpus. This is the flagship — its cost scales with the graph and the corpus.
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
  };
}

export const conflictsMeasurements: readonly Measurement<ConflictsMeasurementHandle, unknown>[] = [
  {
    name: "conflicts.run-check",
    operation: async (handle) => {
      // A full firm-wide check against the busiest node: expansion + matchParty per reached entity +
      // the atomic write of the check and every hit. Writes its own log rows (append-only, discarded
      // with the working copy).
      await runConflictsCheck(
        handle.identifierContext,
        {
          trigger: "comprehensive",
          matterId: handle.subjectMatterId ?? undefined,
          subjectEntityIds: [handle.subjectEntityId],
          scope: { sources: ["party", "graph"], strictness: "balanced", depth: 1 },
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
          scope: { sources: ["party", "graph"], strictness: "over_inclusive", depth: 1 },
        },
        handle.writeOptions,
      );
    },
  },
];

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

// The GET-path hit read (routes/conflicts.ts readHitRows): a check's hits by check_id. Walks the
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
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}

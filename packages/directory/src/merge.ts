import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { EntityMergeId } from "@magna-carta/identifiers/types";
import type { DirectoryWriteOptions } from "./audit.js";
import { entityKindFromId } from "./entity-kind.js";
import type { DirectoryIdentifierContext } from "./identifiers.js";
import type { EntityKind } from "./types.js";

// Merge is the directory's most intricate write: it folds a duplicate (the subordinate) into the
// surviving record (the master) NON-DESTRUCTIVELY. The subordinate row is archived, never deleted —
// its names, identifiers, and contact rows stay alive in place so a merged-away alias still matches
// in the conflicts corpus (resolving to the master). Only the real indexed INBOUND references
// (matter parties, edge endpoints, category links) are repointed to the master, and every repoint is
// recorded in the entity_merge event so the merge is fully reversible from recorded data.

// Thrown when master and subordinate are the same entity — a no-op that almost certainly signals a
// caller bug, so it fails loudly rather than silently doing nothing.
export class MergeSameEntityError extends Error {
  readonly code = "merge-same-entity";
  constructor(entityId: string) {
    super(`directory: cannot merge an entity into itself: ${entityId} (merge-same-entity)`);
    this.name = "MergeSameEntityError";
  }
}

// Thrown when either the master or the subordinate row does not exist (or has been soft-deleted).
export class MergeEntityNotFoundError extends Error {
  readonly code = "merge-entity-not-found";
  constructor(entityId: string) {
    super(`directory: merge endpoint not found: ${entityId} (merge-entity-not-found)`);
    this.name = "MergeEntityNotFoundError";
  }
}

// Thrown when master and subordinate are different kinds — a person and an organization are never the
// same real-world entity, so a cross-kind merge is always an error.
export class MergeKindMismatchError extends Error {
  readonly code = "merge-kind-mismatch";
  constructor(masterKind: EntityKind, subordinateKind: EntityKind) {
    super(
      `directory: cannot merge a ${subordinateKind} into a ${masterKind} (merge-kind-mismatch)`,
    );
    this.name = "MergeKindMismatchError";
  }
}

// Thrown when either endpoint has already been merged away (status='merged_into'). Merging a master
// that is itself a subordinate, or re-merging an already-merged subordinate, would corrupt the merge
// chain; both are refused.
export class MergeAlreadyMergedError extends Error {
  readonly code = "merge-already-merged";
  constructor(entityId: string) {
    super(`directory: entity is already merged away: ${entityId} (merge-already-merged)`);
    this.name = "MergeAlreadyMergedError";
  }
}

// The survivorship choice per conflicting standard field: "subordinate" means the master takes the
// subordinate's value for that column; any field absent from the map leaves the master's own value
// untouched. An empty map keeps every master field (a no-op survivorship). Keys are the node-table
// column names of the kind being merged (see SURVIVABLE_COLUMNS).
export type SurvivorshipChoice = "subordinate";
export type SurvivorshipInput = Readonly<Record<string, SurvivorshipChoice>>;

export interface MergeEntitiesInput {
  readonly masterId: string;
  readonly subordinateId: string;
  readonly survivorship: SurvivorshipInput;
}

// One recorded repoint: a reference that moved from the subordinate to the master. table/row locate
// the exact row that changed; from/to are the old and new entity ids. The full list is stored in the
// entity_merge event as the reversible record of what the merge touched.
interface RepointRecord {
  readonly table: string;
  readonly row: string;
  readonly from: string;
  readonly to: string;
}

// The standard, single-valued fields a merge may survivorship per kind. Multi-valued child rows
// (names, identifiers, edges, categories) are NOT here — they are unioned/repointed, never chosen
// (design: survivorship is field-level on the node row only). The node-table column name is the
// survivorship map key the caller uses.
const SURVIVABLE_COLUMNS: Readonly<Record<EntityKind, readonly string[]>> = {
  person: [
    "name_prefix",
    "name_given",
    "name_middle",
    "name_family",
    "name_suffix",
    "display_name",
  ],
  organization: ["legal_name", "display_name"],
};

const NODE_TABLE: Readonly<Record<EntityKind, string>> = {
  person: "directory_person",
  organization: "directory_organization",
};

// The inbound real-indexed reference columns a merge repoints from the subordinate to the master.
// Kept in lockstep with fitness.ts INBOUND_REFERENCE_PROBES: this list is what moves, that list is
// what must be empty afterward. The rowColumn names the row's identity (directory_entity_category has
// a composite key with no id, so its category_id is the discriminator).
const REPOINT_TARGETS: ReadonlyArray<{ table: string; column: string; rowColumn: string }> = [
  { table: "matter_party", column: "entity_id", rowColumn: "id" },
  { table: "directory_edge", column: "from_entity_id", rowColumn: "id" },
  { table: "directory_edge", column: "to_entity_id", rowColumn: "id" },
  { table: "directory_entity_category", column: "entity_id", rowColumn: "category_id" },
];

interface NodeRow {
  readonly id: string;
  readonly status: string;
  readonly [column: string]: string | null;
}

// Read the full node row for an entity, scoped to live (non-soft-deleted) rows. Returns null when the
// entity is missing or archived. The column list is the survivable columns plus the lifecycle fields,
// so the caller can both guard and read prior survivorship values from one fetch.
async function readNodeRow(
  database: BatchDatabase,
  entityId: string,
  kind: EntityKind,
): Promise<NodeRow | null> {
  const columns = ["id", "status", ...SURVIVABLE_COLUMNS[kind]];
  const { results } = await database
    .prepare(
      `SELECT ${columns.join(", ")} FROM ${NODE_TABLE[kind]} WHERE id = ?1 AND deleted_at IS NULL`,
    )
    .bind(entityId)
    .all<NodeRow>();
  return results[0] ?? null;
}

// mergeEntities folds the subordinate into the master in ONE atomic batch:
//   1. Archive the subordinate node row (status='merged_into', merged_into_id=master) — never deleted.
//   2. Repoint every inbound real-indexed reference (matter parties, both edge endpoints, category
//      links) from the subordinate to the master, recording each repoint exactly.
//   3. Apply field-level survivorship to the master, recording the master's PRIOR value per field.
//   4. Write the append-only entity_merge event (survivorship + the exact repoint list) AND a
//      directory.entity.merged audit row.
// The subordinate's own child rows (names, phonetic codes, identifiers, contact rows) are LEFT ALIVE
// in place — they stay in the search/conflicts corpus and resolve to the master via merged_into_id.
//
// Guards (all fail before any write): master != subordinate, both exist and are live, same kind, and
// neither is already merged away.
export async function mergeEntities(
  context: DirectoryIdentifierContext,
  input: MergeEntitiesInput,
): Promise<EntityMergeId> {
  const { masterId, subordinateId, survivorship } = input;

  if (masterId === subordinateId) {
    throw new MergeSameEntityError(masterId);
  }

  const masterKind = entityKindFromId(masterId);
  const subordinateKind = entityKindFromId(subordinateId);
  if (masterKind !== subordinateKind) {
    throw new MergeKindMismatchError(masterKind, subordinateKind);
  }
  const kind = masterKind;

  const database = context.database;
  const masterRow = await readNodeRow(database, masterId, kind);
  if (masterRow === null) throw new MergeEntityNotFoundError(masterId);
  const subordinateRow = await readNodeRow(database, subordinateId, kind);
  if (subordinateRow === null) throw new MergeEntityNotFoundError(subordinateId);

  if (masterRow.status === "merged_into") throw new MergeAlreadyMergedError(masterId);
  if (subordinateRow.status === "merged_into") throw new MergeAlreadyMergedError(subordinateId);

  const now = context.clock.now();
  const options: DirectoryWriteOptions = {
    clock: context.clock,
    actorUserId: context.actorUserId,
    randomSource: context.randomSource,
  };

  const statements: SqlStatement[] = [];
  const repointed: RepointRecord[] = [];

  // 2. Repoint every inbound reference. Read the affected rows first (by their row-identity column) so
  // the recorded repoint list names the exact rows, then issue a row-scoped UPDATE per match. A
  // row-scoped UPDATE (not a blanket WHERE column = subordinate) keeps the recorded list and the
  // actual writes provably identical.
  for (const target of REPOINT_TARGETS) {
    const { results } = await database
      .prepare(`SELECT ${target.rowColumn} AS row FROM ${target.table} WHERE ${target.column} = ?1`)
      .bind(subordinateId)
      .all<{ row: string }>();
    for (const { row } of results) {
      statements.push(
        database
          .prepare(
            `UPDATE ${target.table} SET ${target.column} = ?2 WHERE ${target.rowColumn} = ?1 AND ${target.column} = ?3`,
          )
          .bind(row, masterId, subordinateId),
      );
      repointed.push({ table: target.table, row, from: subordinateId, to: masterId });
    }
  }

  // 3. Field-level survivorship: the master takes the subordinate's value for each chosen column;
  // record the master's prior value so an unmerge could restore it. Unknown/non-survivable columns
  // are rejected — a typo'd key must not silently no-op.
  const priorMasterValues: Record<string, string | null> = {};
  const survivorshipColumns = Object.keys(survivorship);
  if (survivorshipColumns.length > 0) {
    const allowed = new Set(SURVIVABLE_COLUMNS[kind]);
    const setClauses: string[] = [];
    const setValues: (string | null)[] = [];
    let parameterIndex = 2; // ?1 is the id in the WHERE clause.
    for (const column of survivorshipColumns) {
      if (!allowed.has(column)) {
        throw new Error(
          `directory: ${column} is not a survivable field for a ${kind} (merge-unknown-field)`,
        );
      }
      priorMasterValues[column] = masterRow[column] ?? null;
      setClauses.push(`${column} = ?${parameterIndex}`);
      setValues.push(subordinateRow[column] ?? null);
      parameterIndex += 1;
    }
    statements.push(
      database
        .prepare(
          `UPDATE ${NODE_TABLE[kind]} SET ${setClauses.join(", ")}, updated_at = ?${parameterIndex} WHERE id = ?1`,
        )
        .bind(masterId, ...setValues, now),
    );
  }

  // 1. Archive the subordinate — status flip + merge pointer, touch updated_at, NEVER soft-delete.
  statements.push(
    database
      .prepare(
        `UPDATE ${NODE_TABLE[kind]} SET status = 'merged_into', merged_into_id = ?2, updated_at = ?3 WHERE id = ?1`,
      )
      .bind(subordinateId, masterId, now),
  );

  // 4. The append-only entity_merge event — load-bearing reversible data, not just audit. survivorship
  // records the master's PRIOR values; repointed is the exact list of moved references.
  const mergeId: EntityMergeId = newIdentifier("entityMerge", context.randomSource);
  statements.push(
    database
      .prepare(
        `INSERT INTO entity_merge (id, master_id, subordinate_id, survivorship, repointed, merged_at, merged_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        mergeId,
        masterId,
        subordinateId,
        JSON.stringify(priorMasterValues),
        JSON.stringify(repointed),
        now,
        context.actorUserId,
      ),
  );

  // The parallel audit row — subject is the subordinate (the entity that was archived away).
  statements.push(
    domainAuditStatement(database, {
      event: "directory.entity.merged",
      subjectId: subordinateId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
    }),
  );

  await commitEffectBatch(database, { statements, outboxMessages: [] }, { now: () => now });

  return mergeId;
}

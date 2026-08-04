import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { EntityMergeId } from "@magna-carta/identifiers/types";
import type { DirectoryWriteOptions } from "./audit.ts";
import { entityKindFromId, NODE_TABLE } from "./entity-kind.ts";
import type { DirectoryIdentifierContext } from "./identifiers.ts";
import { runDirectoryEffect } from "./run-directory-effect.ts";
import type { EntityKind } from "./types.ts";

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

// Thrown when a survivorship map names a column that is not a survivable field for the entity kind —
// a typo'd or unknown key must fail loudly (422) rather than silently no-op.
export class MergeUnknownFieldError extends Error {
  readonly code = "merge-unknown-field";
  constructor(column: string, kind: EntityKind) {
    super(`directory: ${column} is not a survivable field for a ${kind} (merge-unknown-field)`);
    this.name = "MergeUnknownFieldError";
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
// entity_merge event as the reversible record of what the merge touched. `absorbed` marks a row that
// could NOT be repointed as a LIVE reference because the master already carried the same one (a
// duplicate that would collide on a unique key) or because repointing would create a self-loop — that
// row still moves to the master but lands archived (soft-deleted, or flipped out of currency), and is
// recorded here so the merge stays reversible.
interface RepointRecord {
  readonly table: string;
  readonly row: string;
  readonly from: string;
  readonly to: string;
  readonly absorbed?: boolean;
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

// The inbound real-indexed reference columns a merge repoints from the subordinate to the master.
// Kept in lockstep with fitness.ts INBOUND_REFERENCE_PROBES: this list is what moves, that list is
// what must be empty afterward. The rowColumn names the row's identity (directory_entity_category has
// a composite key with no id, so its category_id is the discriminator). extraColumns are read alongside
// the identity so `collides` can decide whether repointing this row would clash with a reference the
// master already holds (a unique-key duplicate) or would create a self-loop — when it would, the row is
// ABSORBED instead of repointed live, so the merge never aborts on a constraint and never leaves a
// meaningless duplicate or self-relationship behind. Absorption still MOVES the row to the master; what
// it changes is that the row lands archived rather than live, because a merge never destroys the record
// that the subordinate once held that relationship.
interface RepointTarget {
  readonly table: string;
  readonly column: string;
  readonly rowColumn: string;
  readonly extraColumns: readonly string[];
  // How a colliding row is absorbed — one of three archival shapes, chosen by what the table can carry:
  //   "soft-delete"        the row moves to the master and is soft-deleted there (deleted_at = now,
  //                        valid_to closed) — the whole row survives and stays queryable, which is the
  //                        only way a matter-party link or an edge keeps its role/type/notes/dates.
  //   "archive-to-history" the row moves to the master and flips out of currency (is_current = 0,
  //                        valid_to = now) — used where the table models history rather than deletion
  //                        (a custom-field value), so the loser becomes a prior value under the master.
  //   "record-only"        the row is removed and the entity_merge event is the sole surviving record.
  //                        Reserved for a pure composite-key join row whose ENTIRE content is the pair
  //                        (entity, other) already written into that event: nothing is lost that the
  //                        event does not carry, and the composite primary key leaves no room to keep a
  //                        second row under the master.
  readonly onCollision: "soft-delete" | "archive-to-history" | "record-only";
  readonly collides: (
    database: BatchDatabase,
    masterId: string,
    row: Readonly<Record<string, string | null>>,
  ) => Promise<boolean>;
}

const REPOINT_TARGETS: readonly RepointTarget[] = [
  {
    // A master already linked to the same matter in the same role makes a repoint a live duplicate.
    table: "matter_party",
    column: "entity_id",
    rowColumn: "id",
    extraColumns: ["matter_id", "role", "deleted_at"],
    onCollision: "soft-delete",
    collides: async (database, masterId, row) => {
      if (row.deleted_at !== null) return false; // a soft-deleted link cannot become a live duplicate
      const { results } = await database
        .prepare(
          `SELECT 1 FROM matter_party WHERE entity_id = ?1 AND matter_id = ?2 AND role = ?3 AND deleted_at IS NULL LIMIT 1`,
        )
        .bind(masterId, row.matter_id, row.role)
        .all();
      return results.length > 0;
    },
  },
  {
    // Repointing the from-endpoint to the master when the to-endpoint is already the master is a self-loop.
    table: "directory_edge",
    column: "from_entity_id",
    rowColumn: "id",
    extraColumns: ["to_entity_id"],
    onCollision: "soft-delete",
    collides: async (_database, masterId, row) => row.to_entity_id === masterId,
  },
  {
    // Symmetric: repointing the to-endpoint to the master when the from-endpoint is already the master.
    table: "directory_edge",
    column: "to_entity_id",
    rowColumn: "id",
    extraColumns: ["from_entity_id"],
    onCollision: "soft-delete",
    collides: async (_database, masterId, row) => row.from_entity_id === masterId,
  },
  {
    // The composite primary key (entity_id, category_id): if the master already holds the category, a
    // repoint to (master, category_id) collides on the PK, and the table has no soft-delete column to
    // park the loser in. Nothing is lost by removing it: the row IS the pair, and the pair is written
    // verbatim into the entity_merge event (table + category_id + the subordinate it came from), so the
    // link is fully reconstructible from recorded data.
    table: "directory_entity_category",
    column: "entity_id",
    rowColumn: "category_id",
    extraColumns: [],
    onCollision: "record-only",
    collides: async (database, masterId, row) => {
      const { results } = await database
        .prepare(
          `SELECT 1 FROM directory_entity_category WHERE entity_id = ?1 AND category_id = ?2 LIMIT 1`,
        )
        .bind(masterId, row.row)
        .all();
      return results.length > 0;
    },
  },
  {
    // A custom-field value that POINTS AT the merged entity (a contact-reference value's
    // value_reference_id). The value's own row stays put — its target_row_id (the matter or entity the
    // value belongs to) does not move — so only the reference is repointed; nothing can collide.
    table: "custom_field_value",
    column: "value_reference_id",
    rowColumn: "id",
    extraColumns: [],
    onCollision: "record-only", // unreachable: collides() is always false for this target.
    collides: async () => false,
  },
  {
    // Custom-field values OWNED BY the merged entity (the value's target_row_id is the entity). Moving
    // target_row_id to the master can collide with the master's own current value of the same field on
    // the partial unique index (target_row_id, field_id) WHERE is_current = 1. On collision the
    // subordinate's value is content the user entered, so it is archived to history under the master
    // (field-level survivorship: master keeps its current value, the loser becomes a prior value)
    // rather than deleted.
    table: "custom_field_value",
    column: "target_row_id",
    rowColumn: "id",
    extraColumns: ["field_id", "is_current"],
    onCollision: "archive-to-history",
    collides: async (database, masterId, row) => {
      if (String(row.is_current) !== "1") return false; // only a live value can clash on the partial unique
      const { results } = await database
        .prepare(
          `SELECT 1 FROM custom_field_value WHERE target_row_id = ?1 AND field_id = ?2 AND is_current = 1 LIMIT 1`,
        )
        .bind(masterId, row.field_id)
        .all();
      return results.length > 0;
    },
  },
];

// The (table, column) inbound-reference pairs the merge repoints — exported so the PII/erasure
// registry can be pinned as a superset (a new entity reference here must also be attributed for
// erasure). Derived from REPOINT_TARGETS so the two never drift.
export const REPOINT_REFERENCE_COLUMNS: readonly {
  readonly table: string;
  readonly column: string;
}[] = REPOINT_TARGETS.map((target) => ({
  table: target.table,
  column: target.column,
}));

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
//      links) from the subordinate to the master, recording each repoint exactly — including the merge
//      pointers of entities previously merged INTO the subordinate, so a chain never forms and every
//      historical entity resolves to the final master in one hop.
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

  // 2. Repoint every inbound reference. Read the affected rows first (by their row-identity column,
  // plus any columns the collision check needs) so the recorded list names the exact rows, then issue a
  // row-scoped UPDATE per match. A row-scoped UPDATE (not a blanket WHERE column = subordinate) keeps the
  // recorded list and the actual writes provably identical. When repointing a row would collide with a
  // reference the master already holds (a unique-key duplicate) or would create a self-loop, the row is
  // ABSORBED instead — moved to the master in an archived form and recorded as absorbed — so a merge of
  // two real duplicates that share a category, a matter role, or a mutual edge never aborts on a
  // constraint and never destroys the record that the subordinate held that relationship.
  for (const target of REPOINT_TARGETS) {
    const selectColumns = [`${target.rowColumn} AS row`, ...target.extraColumns].join(", ");
    const { results } = await database
      .prepare(`SELECT ${selectColumns} FROM ${target.table} WHERE ${target.column} = ?1`)
      .bind(subordinateId)
      .all<Record<string, string | null>>();
    for (const row of results) {
      const rowId = row.row as string;
      if (await target.collides(database, masterId, row)) {
        if (target.onCollision === "archive-to-history") {
          // Move the losing row onto the master and flip it to history, preserving its content — the
          // master's current value wins, the subordinate's becomes a prior value under the master.
          statements.push(
            database
              .prepare(
                `UPDATE ${target.table} SET ${target.column} = ?2, is_current = 0, valid_to = ?3 WHERE ${target.rowColumn} = ?1`,
              )
              .bind(rowId, masterId, now),
          );
        } else if (target.onCollision === "soft-delete") {
          // Move the losing row onto the master and soft-delete it there. The row keeps everything it
          // carried — the matter and role it played, the edge type, role, note, and dates — so the fact
          // that the subordinate once held that relationship stays queryable instead of being destroyed;
          // the reads that matter (readEdges, readMatterParties) filter deleted_at, so an archived row is
          // invisible to ordinary use while remaining available to an audit or an unmerge. COALESCE keeps
          // an already-archived row's original timestamps rather than restamping them with the merge time.
          statements.push(
            database
              .prepare(
                `UPDATE ${target.table} SET ${target.column} = ?2, deleted_at = COALESCE(deleted_at, ?3), valid_to = COALESCE(valid_to, ?3), updated_at = ?3 WHERE ${target.rowColumn} = ?1 AND ${target.column} = ?4`,
              )
              .bind(rowId, masterId, now, subordinateId),
          );
        } else {
          // "record-only": the entity_merge event below carries the row's entire content, so removing it
          // loses nothing (see the target's own note for why it cannot be parked under the master).
          statements.push(
            database
              .prepare(
                `DELETE FROM ${target.table} WHERE ${target.rowColumn} = ?1 AND ${target.column} = ?2`,
              )
              .bind(rowId, subordinateId),
          );
        }
        repointed.push({
          table: target.table,
          row: rowId,
          from: subordinateId,
          to: masterId,
          absorbed: true,
        });
      } else {
        statements.push(
          database
            .prepare(
              `UPDATE ${target.table} SET ${target.column} = ?2 WHERE ${target.rowColumn} = ?1 AND ${target.column} = ?3`,
            )
            .bind(rowId, masterId, subordinateId),
        );
        repointed.push({
          table: target.table,
          row: rowId,
          from: subordinateId,
          to: masterId,
        });
      }
    }
  }

  // 2b. Follow the merge chain: every entity ALREADY merged into the subordinate is repointed to the new
  // master in the same batch. Without this, a second merge leaves a two-hop chain (C -> B -> A) and every
  // consumer that follows a single hop lands on B, an entity that has itself been merged away.
  //
  // Repointing here rather than resolving transitively at read time is the cheaper half of the trade by a
  // wide margin: the resolution paths are one-hop by construction — the name and identifier channels
  // resolve in SQL with COALESCE(merged_into_id, id) inside their join (search.ts), and the in-code twins
  // (search.ts resolveMergedId, contact-email.ts resolveLiveEntity, conflicts matching) read one node row
  // — so making resolution transitive would mean a recursive CTE plus a cycle guard in every one of those
  // read paths, on every read. Flattening the chain at merge time costs one extra UPDATE per chained
  // entity, once, and leaves every existing one-hop read correct. It also makes a cycle unrepresentable
  // rather than merely survivable: merged_into_id always points at a live entity, so there is no chain to
  // walk and nothing to guard against. Each repoint is recorded in the entity_merge event like any other.
  //
  // Only the kind's own node table is scanned: a cross-kind merge is refused above, so a subordinate's
  // prior subordinates are always of the same kind.
  const { results: chainedSubordinates } = await database
    .prepare(`SELECT id FROM ${NODE_TABLE[kind]} WHERE merged_into_id = ?1`)
    .bind(subordinateId)
    .all<{ id: string }>();
  for (const chained of chainedSubordinates) {
    statements.push(
      database
        .prepare(
          `UPDATE ${NODE_TABLE[kind]} SET merged_into_id = ?2, updated_at = ?3 WHERE id = ?1 AND merged_into_id = ?4`,
        )
        .bind(chained.id, masterId, now, subordinateId),
    );
    repointed.push({
      table: NODE_TABLE[kind],
      row: chained.id,
      from: subordinateId,
      to: masterId,
    });
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
        throw new MergeUnknownFieldError(column, kind);
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
  // The `status = 'active'` predicate re-checks at write time what the guard above checked at read time:
  // D1 has no interactive transaction, so two merges of the same subordinate into different masters can
  // both pass the read-time guard. The predicate makes the loser's flip a no-op instead of pointing the
  // subordinate at a master that received none of its references. (Serializing merges per entity through
  // the firm database Durable Object is the complete answer and is not built yet.)
  statements.push(
    database
      .prepare(
        `UPDATE ${NODE_TABLE[kind]} SET status = 'merged_into', merged_into_id = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'active'`,
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

  // The merge — the archive, every repoint, the survivorship, the entity_merge event, and the audit
  // row — commits in ONE atomic batch with the idempotency record (when a key is present), so a
  // retried merge under the same key never double-repoints nor writes a second entity_merge event.
  return runDirectoryEffect(database, context.idempotency, context.clock, () => ({
    statements,
    outboxMessages: [],
    responseCode: 201,
    responseBody: { mergeId },
    value: mergeId,
    fromBody: (body) => (body as { mergeId: EntityMergeId }).mergeId,
  }));
}

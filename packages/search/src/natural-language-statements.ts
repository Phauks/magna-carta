import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FileId, MatterId, UserId } from "@magna-carta/identifiers/types";

// SQL statement builders for the three per-firm natural-language search tables, plus the matter
// exclusion flag. Table names are tracked against @magna-carta/database's per-firm schema by the
// schema-name-sync fitness test beside this file.
//
// This module composes statements and runs bounded reads. It holds no binding and crosses no firm —
// the caller supplies the firm-scoped database handle, which is the whole of how firm scoping works
// here and why nothing in this package can reach two firms at once.

export const AI_SEARCH_FEED_OBJECT_TABLE = "ai_search_feed_object";
export const AI_SEARCH_USAGE_METER_TABLE = "ai_search_usage_meter";
export const AI_SEARCH_DISCLOSURE_ACKNOWLEDGEMENT_TABLE = "ai_search_disclosure_acknowledgement";
export const MATTER_TABLE = "matter";

// The one row the acknowledgement table holds. The per-firm database IS the firm, so the row needs
// no firm column — this literal is what makes the write a plain upsert with no read first.
export const DISCLOSURE_ACKNOWLEDGEMENT_SCOPE = "firm";

// ── The feed catalog ────────────────────────────────────────────────────────

export interface FeedObjectRow {
  readonly fileId: FileId;
  readonly version: number;
  readonly matterId: MatterId;
  readonly objectKey: string;
  readonly byteCount: number;
  readonly fedAt: string;
  readonly removedAt: string | null;
}

interface FeedObjectDatabaseRow {
  file_id: string;
  version: number;
  matter_id: string;
  object_key: string;
  byte_count: number;
  fed_at: string;
  removed_at: string | null;
}

function toFeedObjectRow(row: FeedObjectDatabaseRow): FeedObjectRow {
  return {
    fileId: row.file_id as FileId,
    version: row.version,
    matterId: row.matter_id as MatterId,
    objectKey: row.object_key,
    byteCount: row.byte_count,
    fedAt: row.fed_at,
    removedAt: row.removed_at,
  };
}

// Record that an object was fed. An upsert on (file, version), so a retried feed write converges on
// one row rather than leaving a second — and `removed_at` is cleared, because re-feeding a version
// whose object was previously deleted is a live object again and a stale removal timestamp would
// make the freshness count and the deletion plan both wrong.
export function recordFeedObjectStatement(
  database: SqlDatabase,
  row: Omit<FeedObjectRow, "removedAt">,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${AI_SEARCH_FEED_OBJECT_TABLE} (file_id, version, matter_id, object_key, byte_count, fed_at, removed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL) ON CONFLICT (file_id, version) DO UPDATE SET matter_id = excluded.matter_id, object_key = excluded.object_key, byte_count = excluded.byte_count, fed_at = excluded.fed_at, removed_at = NULL`,
    )
    .bind(row.fileId, row.version, row.matterId, row.objectKey, row.byteCount, row.fedAt);
}

// Mark one fed object removed. A timestamp rather than a delete: "this text was copied out and has
// since been deleted" is exactly the question a firm asks on opt-out, and a deleted row answers it
// with silence.
export function markFeedObjectRemovedStatement(
  database: SqlDatabase,
  fileId: FileId,
  version: number,
  removedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${AI_SEARCH_FEED_OBJECT_TABLE} SET removed_at = ?3 WHERE file_id = ?1 AND version = ?2 AND removed_at IS NULL`,
    )
    .bind(fileId, version, removedAt);
}

// The scopes a deletion can be asked for. One document version, one matter, or the whole firm —
// nothing else, because a free-form predicate is how a deletion job comes to delete a set nobody
// can describe afterwards.
export type FeedDeletionScope =
  | { readonly kind: "document-version"; readonly fileId: FileId; readonly version: number }
  | { readonly kind: "matter"; readonly matterId: MatterId }
  | { readonly kind: "firm" };

// THE DELETION PLAN IS READ FROM THE CATALOG, never from a bucket prefix listing. That is the whole
// reason the catalog exists: a listing-driven delete cannot tell an object it has never heard of
// from one it wrote, so an object that reached the feed prefix some other way would be swept along
// silently. Driven from the catalog, the same object is a reconciliation mismatch — a fact somebody
// can act on.
//
// Bounded, because a firm-scope teardown is however many documents the firm has: the caller pages
// with `after` and stops when a page comes back short.
export async function readFeedObjectsForDeletion(
  database: SqlDatabase,
  scope: FeedDeletionScope,
  limit: number,
): Promise<readonly FeedObjectRow[]> {
  const selection = `SELECT file_id, version, matter_id, object_key, byte_count, fed_at, removed_at FROM ${AI_SEARCH_FEED_OBJECT_TABLE} WHERE removed_at IS NULL`;
  const ordering = `ORDER BY file_id, version LIMIT ?`;
  const statement =
    scope.kind === "document-version"
      ? database
          .prepare(`${selection} AND file_id = ?1 AND version = ?2 ${ordering}`)
          .bind(scope.fileId, scope.version, limit)
      : scope.kind === "matter"
        ? database
            .prepare(`${selection} AND matter_id = ?1 ${ordering}`)
            .bind(scope.matterId, limit)
        : database.prepare(`${selection} ${ordering}`).bind(limit);
  const { results } = await statement.all<FeedObjectDatabaseRow>();
  return results.map(toFeedObjectRow);
}

// The enumeration that PROVES the state: every catalog row for a scope, removed or not, with its
// removal timestamp. This is the half of deletion the platform can demonstrate — it is what an
// opt-out confirmation is built from, and what reconciliation compares a bucket listing against.
export async function enumerateFeedObjects(
  database: SqlDatabase,
  scope: FeedDeletionScope,
  limit: number,
): Promise<readonly FeedObjectRow[]> {
  const selection = `SELECT file_id, version, matter_id, object_key, byte_count, fed_at, removed_at FROM ${AI_SEARCH_FEED_OBJECT_TABLE}`;
  const ordering = `ORDER BY file_id, version LIMIT ?`;
  const statement =
    scope.kind === "document-version"
      ? database
          .prepare(`${selection} WHERE file_id = ?1 AND version = ?2 ${ordering}`)
          .bind(scope.fileId, scope.version, limit)
      : scope.kind === "matter"
        ? database
            .prepare(`${selection} WHERE matter_id = ?1 ${ordering}`)
            .bind(scope.matterId, limit)
        : database.prepare(`${selection} ${ordering}`).bind(limit);
  const { results } = await statement.all<FeedObjectDatabaseRow>();
  return results.map(toFeedObjectRow);
}

// Feed objects written since an instant and not yet removed — the `pendingDocumentCount` on every
// answer's freshness envelope. Computed from the platform's own catalog, so it is exact and cheap,
// and it is more than the managed service reports about itself. A null instant means no sync has
// completed, in which case everything live is pending.
export async function countFeedObjectsPendingSince(
  database: SqlDatabase,
  indexedThrough: string | null,
): Promise<number> {
  const statement =
    indexedThrough === null
      ? database.prepare(
          `SELECT COUNT(*) AS pending FROM ${AI_SEARCH_FEED_OBJECT_TABLE} WHERE removed_at IS NULL`,
        )
      : database
          .prepare(
            `SELECT COUNT(*) AS pending FROM ${AI_SEARCH_FEED_OBJECT_TABLE} WHERE removed_at IS NULL AND fed_at > ?1`,
          )
          .bind(indexedThrough);
  const { results } = await statement.all<{ pending: number }>();
  return results[0]?.pending ?? 0;
}

// ── The usage meter ─────────────────────────────────────────────────────────

// The delta upsert, on the same shape as the token meter beside it: composed into the SAME effect
// batch as the operation it counts, so a queue redelivery rolls the meter write back with everything
// else rather than double-counting.
//
// The estimated ingestion figure and the ratio it was computed at travel together. The ratio is
// stored rather than assumed so a later correction can be applied to historical rows instead of
// guessing what they assumed; on a repeat write for the same day it is overwritten rather than
// summed, because it is a rate and not a quantity.
export interface UsageMeterDelta {
  readonly day: string;
  readonly semanticQueryCount?: number;
  readonly fullTextQueryCount?: number;
  readonly fedBytes?: number;
  readonly estimatedIngestionTokens?: number;
  readonly estimatedIngestionBytesPerToken?: number;
}

export function usageMeterCommitStatements(
  database: SqlDatabase,
  delta: UsageMeterDelta,
): SqlStatement[] {
  return [
    database
      .prepare(
        `INSERT INTO ${AI_SEARCH_USAGE_METER_TABLE} (day, semantic_query_count, full_text_query_count, fed_bytes, estimated_ingestion_tokens, estimated_ingestion_bytes_per_token) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (day) DO UPDATE SET semantic_query_count = semantic_query_count + excluded.semantic_query_count, full_text_query_count = full_text_query_count + excluded.full_text_query_count, fed_bytes = fed_bytes + excluded.fed_bytes, estimated_ingestion_tokens = estimated_ingestion_tokens + excluded.estimated_ingestion_tokens, estimated_ingestion_bytes_per_token = MAX(${AI_SEARCH_USAGE_METER_TABLE}.estimated_ingestion_bytes_per_token, excluded.estimated_ingestion_bytes_per_token)`,
      )
      .bind(
        delta.day,
        delta.semanticQueryCount ?? 0,
        delta.fullTextQueryCount ?? 0,
        delta.fedBytes ?? 0,
        delta.estimatedIngestionTokens ?? 0,
        delta.estimatedIngestionBytesPerToken ?? 0,
      ),
  ];
}

// What the firm-usage feed reads.
//
// THE AUTHORITATIVE AND ESTIMATED FIGURES ARE IN SEPARATE OBJECTS, and that is the point of this
// shape rather than a tidiness preference. A renderer handed one flat bag of numbers has to remember
// which of them is a measurement and which is a derivation, and the day it forgets, an estimate is
// presented as a meter — which is a future billing dispute rather than a display bug. Split like
// this, a renderer cannot show them the same way without deliberately reaching into both.
//
// `notMetered` is a list of NAMED GAPS rather than an absence. Managed storage is not attributable
// per firm, so there is no figure and no guess in place of one — and the feed states that rather
// than leaving a reader to assume the number is zero.
export interface UsageMeterTotals {
  readonly authoritative: {
    /** Every one of these calls was made by this platform, and counted as it was made. */
    readonly semanticQueryCount: number;
    /** Including the weekly keep-alive, which is a real query a real invoice will charge for. */
    readonly fullTextQueryCount: number;
    /** The bytes the feed writer actually wrote. */
    readonly fedBytes: number;
  };
  readonly estimated: {
    /** Derived from fed bytes at a recorded ratio. The service returns no ingestion count. */
    readonly ingestionTokens: number;
  };
  /** Things this feature costs money for and this platform cannot measure per firm. */
  readonly notMetered: readonly string[];
}

// The one gap, named. Cloudflare publishes no per-instance storage figure, so nothing here can
// attribute managed storage to a firm; the feed says so instead of showing a zero.
export const UNMETERED_NATURAL_LANGUAGE_COSTS: readonly string[] = Object.freeze([
  "managed index storage",
]);

export async function readUsageMeterTotals(database: SqlDatabase): Promise<UsageMeterTotals> {
  const { results } = await database
    .prepare(
      `SELECT COALESCE(SUM(semantic_query_count), 0) AS semantic_query_count, COALESCE(SUM(full_text_query_count), 0) AS full_text_query_count, COALESCE(SUM(fed_bytes), 0) AS fed_bytes, COALESCE(SUM(estimated_ingestion_tokens), 0) AS estimated_ingestion_tokens FROM ${AI_SEARCH_USAGE_METER_TABLE}`,
    )
    .all<{
      semantic_query_count: number;
      full_text_query_count: number;
      fed_bytes: number;
      estimated_ingestion_tokens: number;
    }>();
  const row = results[0];
  return {
    authoritative: {
      semanticQueryCount: row?.semantic_query_count ?? 0,
      fullTextQueryCount: row?.full_text_query_count ?? 0,
      fedBytes: row?.fed_bytes ?? 0,
    },
    estimated: { ingestionTokens: row?.estimated_ingestion_tokens ?? 0 },
    notMetered: UNMETERED_NATURAL_LANGUAGE_COSTS,
  };
}

// ── The disclosure acknowledgement ──────────────────────────────────────────

export interface DisclosureAcknowledgementRow {
  readonly disclosureVersion: number;
  readonly acknowledgedBy: UserId;
  readonly acknowledgedAt: string;
}

export function recordDisclosureAcknowledgementStatement(
  database: SqlDatabase,
  input: {
    readonly disclosureVersion: number;
    readonly acknowledgedBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${AI_SEARCH_DISCLOSURE_ACKNOWLEDGEMENT_TABLE} (scope, disclosure_version, acknowledged_by, acknowledged_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (scope) DO UPDATE SET disclosure_version = excluded.disclosure_version, acknowledged_by = excluded.acknowledged_by, acknowledged_at = excluded.acknowledged_at`,
    )
    .bind(
      DISCLOSURE_ACKNOWLEDGEMENT_SCOPE,
      input.disclosureVersion,
      input.acknowledgedBy,
      input.now,
    );
}

export async function readDisclosureAcknowledgement(
  database: SqlDatabase,
): Promise<DisclosureAcknowledgementRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT disclosure_version, acknowledged_by, acknowledged_at FROM ${AI_SEARCH_DISCLOSURE_ACKNOWLEDGEMENT_TABLE} WHERE scope = ?1 LIMIT 1`,
    )
    .bind(DISCLOSURE_ACKNOWLEDGEMENT_SCOPE)
    .all<{ disclosure_version: number; acknowledged_by: string; acknowledged_at: string }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    disclosureVersion: row.disclosure_version,
    acknowledgedBy: row.acknowledged_by as UserId,
    acknowledgedAt: row.acknowledged_at,
  };
}

// ── The matter exclusion flag ───────────────────────────────────────────────

export function setMatterNaturalLanguageExclusionStatement(
  database: SqlDatabase,
  matterId: MatterId,
  excluded: boolean,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET natural_language_index_excluded = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(matterId, excluded ? 1 : 0, now);
}

// Total: a matter that does not exist reads as excluded rather than included. The feed writer calls
// this before writing anything, and the safe answer for a matter it cannot find is to write nothing.
export async function readMatterNaturalLanguageExcluded(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT natural_language_index_excluded FROM ${MATTER_TABLE} WHERE id = ?1 LIMIT 1`)
    .bind(matterId)
    .all<{ natural_language_index_excluded: number }>();
  const row = results[0];
  if (row === undefined) return true;
  return row.natural_language_index_excluded !== 0;
}

// Every matter currently excluded. The teardown enqueued by setting the flag needs the one matter it
// was set on; this read exists for the reconciliation pass, which has to be able to say that no
// excluded matter still has live feed rows.
export async function readExcludedMatterIds(
  database: SqlDatabase,
  limit: number,
): Promise<readonly MatterId[]> {
  const { results } = await database
    .prepare(
      `SELECT id FROM ${MATTER_TABLE} WHERE natural_language_index_excluded <> 0 ORDER BY id LIMIT ?1`,
    )
    .bind(limit)
    .all<{ id: string }>();
  return results.map((row) => row.id as MatterId);
}

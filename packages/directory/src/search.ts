import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { normalizeName } from "./normalize-name.js";
import type { EntityKind } from "./types.js";

// The minimum normalized query length for a useful trigram search. Trigrams are three-character
// substrings; any query shorter than three characters produces no trigrams and therefore matches
// nothing — we short-circuit rather than running a query that always yields an empty result set.
const TRIGRAM_MINIMUM_LENGTH = 3;

// A single search hit returned by searchNames. entityId and entityKind identify the directory
// entity; displayName is the human-readable label for the hit; relevance is the raw FTS5 bm25()
// rank (negative; closer to zero = better match — callers should sort ascending to put best
// hits first).
export interface NameSearchHit {
  readonly entityId: string;
  readonly entityKind: EntityKind;
  readonly displayName: string;
  readonly relevance: number;
}

// Extract every three-character window from a normalized string as an array of trigrams.
// normalizeName output contains only lowercase letters, digits, and single spaces — no FTS5
// operator characters — but lowercase words like "and", "not", "or" are FTS5 boolean operators,
// so each trigram must be wrapped as a phrase literal (double-quoted) before use in a MATCH
// expression. See buildTrigramOrExpression.
function extractTrigrams(value: string): string[] {
  const trigrams: string[] = [];
  for (let index = 0; index <= value.length - 3; index++) {
    trigrams.push(value.slice(index, index + 3));
  }
  return trigrams;
}

// Build the FTS5 MATCH value for a trigram-OR fuzzy search.
//
// FTS5 with the trigram tokenizer stores every three-character window of each indexed string as
// a token. A phrase-literal query (double-quoted) requires every trigram of the query to appear
// consecutively in the document, which makes it a strict substring match and breaks for typos
// (e.g. "cathrine" vs "catherine" — the 'thr' trigram is not in "catherine").
//
// Instead we build an OR expression from all trigrams of the query. This is the standard
// technique for FTS5 trigram fuzzy matching: documents that share the most trigrams with the
// query score highest under bm25(), and documents that share at least one trigram appear in the
// result set at all. A one-character insertion or deletion between query and target typically
// preserves enough common trigrams to rank the real match above noise.
//
// Each trigram is wrapped in double-quotes to make it an FTS5 phrase literal. Without quoting,
// FTS5 treats AND/OR/NOT case-insensitively as boolean operators; trigrams like "and" and "not"
// appear in many real names (e.g. "Anderson", "Nottingham") and would produce a syntax error or
// wrong semantics if left bare in the MATCH expression.
function buildTrigramOrExpression(normalizedQuery: string): string {
  const trigrams = extractTrigrams(normalizedQuery);
  // Deduplicate: the same trigram appearing twice (e.g. "aaa" → ["aaa","aaa"]) should appear
  // once in the MATCH expression. FTS5 does not error on duplicates, but deduplicating keeps
  // the query short and the bm25() scores predictable.
  const unique = [...new Set(trigrams)];
  return unique.map((trigram) => `"${trigram}"`).join(" OR ");
}

// searchNames performs a trigram FTS5 MATCH across all non-deleted, non-merged directory
// name rows and returns typed hits ordered by relevance (best match first).
//
// Fuzzy matching mechanism:
//   The query is normalized with normalizeName(), then decomposed into overlapping three-character
//   windows. These trigrams are joined with OR into the FTS5 MATCH argument. Documents that
//   share the most trigrams with the query rank highest. A single-character typo ("cathrine"
//   vs "catherine") typically preserves 4 of 6 trigrams, enough to surface the correct match
//   at the top of the result list.
//
// Exclusion rules applied here:
//   - directory_name.deleted_at IS NULL — soft-deleted name rows are invisible.
//   - entity deleted_at IS NULL — soft-deleted entities are invisible.
//   - entity status != 'merged_into' — merged-away entities do not appear in ordinary search
//     results. Task 13 (packages/directory/src/merge.ts) adds candidate-generation logic that
//     resolves a merged subordinate to its surviving master; until then this filter keeps merged
//     rows out of the result set entirely.
export async function searchNames(
  database: SqlDatabase,
  query: string,
): Promise<NameSearchHit[]> {
  const normalizedQuery = normalizeName(query);

  // The trigram tokenizer requires at least three characters to form a single trigram.
  // Return early rather than running a MATCH that can produce no results.
  if (normalizedQuery.length < TRIGRAM_MINIMUM_LENGTH) {
    return [];
  }

  // Build the OR expression from the query's trigrams. normalizeName() guarantees the output
  // contains no FTS5 operator characters, so concatenation here is safe.
  const ftsMatchExpression = buildTrigramOrExpression(normalizedQuery);

  // The FTS5 content table join:
  //   directory_name_fts.rowid = directory_name.rowid (the FTS5 content_rowid column)
  //   directory_name.entity_id drives the join to the entity table.
  //
  // Two LEFT JOINs cover both entity kinds in a single pass. COALESCE picks whichever
  // entity's display_name is non-null; exactly one will be non-null because entity_kind
  // is constrained to 'person' | 'organization'.
  //
  // bm25(directory_name_fts) returns the relevance rank. Ordering ascending puts the
  // best match (closest to zero) first.
  const sql = `
    SELECT
      dn.entity_id        AS entity_id,
      dn.entity_kind      AS entity_kind,
      COALESCE(
        dp.display_name,
        do.display_name
      )                   AS display_name,
      bm25(directory_name_fts) AS relevance
    FROM directory_name_fts
    JOIN directory_name AS dn
      ON directory_name_fts.rowid = dn.rowid
    LEFT JOIN directory_person AS dp
      ON dn.entity_kind = 'person'
      AND dp.id = dn.entity_id
    LEFT JOIN directory_organization AS do
      ON dn.entity_kind = 'organization'
      AND do.id = dn.entity_id
    WHERE directory_name_fts MATCH ?1
      AND dn.deleted_at IS NULL
      AND (
        (dn.entity_kind = 'person'       AND dp.deleted_at IS NULL AND dp.status != 'merged_into')
        OR
        (dn.entity_kind = 'organization' AND do.deleted_at IS NULL AND do.status != 'merged_into')
      )
    ORDER BY relevance
  `;

  const { results } = await database.prepare(sql).bind(ftsMatchExpression).all<{
    entity_id: string;
    entity_kind: string;
    display_name: string | null;
    relevance: number;
  }>();

  return results.map((row) => ({
    entityId: row.entity_id,
    entityKind: row.entity_kind as EntityKind,
    displayName: row.display_name ?? "",
    relevance: row.relevance,
  }));
}

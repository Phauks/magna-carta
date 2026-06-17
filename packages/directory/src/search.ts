import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  findByIdentifier,
  IdentifierNotIndexableError,
  type DirectoryIdentifierContext,
} from "./identifiers.ts";
import { normalizeName } from "./normalize-name.ts";
import { phoneticCodes } from "./phonetics.ts";
import type { EntityKind, IdentifierType } from "./types.ts";

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
//     results. This is the deliberate divergence from findDuplicateCandidates: ordinary search
//     hides merged entities outright, while duplicate detection (the conflicts corpus) keeps them
//     and resolves a subordinate to its surviving master. See the merge-resolution note below.
export async function searchNames(database: SqlDatabase, query: string): Promise<NameSearchHit[]> {
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

// ── Duplicate-candidate generation ────────────────────────────────────────────
//
// findDuplicateCandidates runs three independent blocking channels in parallel and unions their
// results into a single ranked list. The three channels are:
//
//   1. Phonetic block — computes Double Metaphone codes on the family/legal name and probes
//      directory_name_phonetic_code for any entity whose stored code matches. Sound-alikes
//      (Smith/Smyth, Cathrine/Catherine) surface here without requiring an exact token.
//
//   2. Trigram FTS5 — normalizes the incoming full display name and runs the same OR-trigram
//      MATCH used by searchNames. This catches substring/typo variants that the phonetic block
//      might miss (e.g. multi-word legal names where one word is shared).
//
//   3. Blind-index identifiers — for each supplied identifier whose type carries a standalone
//      blind index (SSN, EIN, drivers_license, account), calls findByIdentifier to probe
//      value_blind_index equality. Non-indexable types (dob, ssn_last_four) are silently
//      skipped; they are too low-entropy for a standalone equality probe and are resolved by
//      decrypt-and-compare over a candidate set, not here.
//
// The three result sets are unioned by entity id. Each entity accumulates a signalCount: the
// number of distinct channels that returned it. The list is sorted descending by signalCount
// so entities that hit more channels appear first (they are stronger duplicate candidates).
//
// Merge-resolution: duplicate detection is the conflicts corpus, so a merged-away entity's still-alive
// name/identifier rows must keep matching — but resolve to the surviving master, never the archived
// subordinate. Each channel therefore INCLUDES merged_into entities and, where a hit lands on a
// subordinate, returns its merged_into_id (the master id) in place of the subordinate's own id (see
// resolveMergedId). A hit on the subordinate's old name thus surfaces the master; the subordinate id
// itself never appears as a candidate. This is the deliberate divergence from searchNames, which is
// ordinary search and still excludes merged entities outright. The blind-index identifier channel
// resolves the same way via resolveEntityIds.

// The caller-supplied name and identifier facts to match against. Either given+family (for persons)
// or legalName (for organizations) drives the name channels; identifiers drives the blind-index
// channel. All fields are optional — a caller may supply any subset.
export interface FindDuplicateCandidatesInput {
  readonly kind: EntityKind;
  // Person name fields.
  readonly given?: string;
  readonly family?: string;
  // Organization name field.
  readonly legalName?: string;
  // Typed identifiers to probe via blind-index equality.
  readonly identifiers?: ReadonlyArray<{ type: IdentifierType; value: string }>;
  // When editing an existing entity, supply its id here so it does not appear in its own
  // candidate list. The exclusion is applied after the union so it is consistent across all
  // three channels.
  readonly excludeEntityId?: string;
}

// A single entry in the ranked duplicate-candidate list. entityId is the directory entity;
// signalCount is the number of distinct channels (phonetic, trigram, identifier) that returned
// this entity — higher is a stronger candidate.
export interface DuplicateCandidate {
  readonly entityId: string;
  readonly signalCount: number;
}

// Derive the primary display name string from the input, for use in the trigram channel.
// For persons: "[given] [family]" (trimmed, joined by space); for organizations: legalName.
function displayNameFromInput(input: FindDuplicateCandidatesInput): string {
  if (input.kind === "organization") {
    return (input.legalName ?? "").trim();
  }
  return [input.given ?? "", input.family ?? ""]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(" ");
}

// Derive the phonetic blocking token from the input. For persons the family name is the primary
// conflicts-blocking token (same choice made in person.ts); falls back to given if family is
// absent. For organizations the full legal name is used (same as organization.ts).
function phoneticTokenFromInput(input: FindDuplicateCandidatesInput): string {
  if (input.kind === "organization") {
    return normalizeName((input.legalName ?? "").trim());
  }
  const family = (input.family ?? "").trim();
  const given = (input.given ?? "").trim();
  return normalizeName(family.length > 0 ? family : given);
}

// Channel 1: Phonetic block. Returns entity ids whose stored phonetic codes (any scheme)
// match any of the codes computed from the input's blocking token. Excludes deleted and
// merged entities, consistent with searchNames.
async function phoneticChannel(
  database: SqlDatabase,
  input: FindDuplicateCandidatesInput,
): Promise<Set<string>> {
  const token = phoneticTokenFromInput(input);
  if (token.length === 0) return new Set();

  const codes = phoneticCodes(token);
  if (codes.length === 0) return new Set();

  // Build a parameterized IN list for the code values. Each code is bound as a separate parameter
  // because D1/SQLite prepared-statement binding does not accept array values natively.
  const placeholders = codes.map((_, i) => `?${i + 2}`).join(", ");

  // The JOIN path: phonetic_code → name → entity. Deleted entities are excluded, but merged-away
  // entities are KEPT and resolved to their master (merged_into_id) — see the merge-resolution note
  // above. COALESCE(merged_into_id, id) is the resolved candidate id: the master for a subordinate,
  // the entity itself otherwise.
  const sql = `
    SELECT DISTINCT COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id
    FROM directory_name_phonetic_code AS pc
    JOIN directory_name AS dn ON pc.name_id = dn.id
    LEFT JOIN directory_person AS dp
      ON dn.entity_kind = 'person'
      AND dp.id = dn.entity_id
    LEFT JOIN directory_organization AS do
      ON dn.entity_kind = 'organization'
      AND do.id = dn.entity_id
    WHERE dn.entity_kind = ?1
      AND pc.code IN (${placeholders})
      AND dn.deleted_at IS NULL
      AND (
        (dn.entity_kind = 'person'       AND dp.deleted_at IS NULL)
        OR
        (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
      )
  `;

  const { results } = await database
    .prepare(sql)
    .bind(input.kind, ...codes.map((c) => c.code))
    .all<{ entity_id: string }>();

  return new Set(results.map((row) => row.entity_id));
}

// Channel 2: Trigram FTS5. Reuses the same buildTrigramOrExpression / normalizeName pipeline as
// searchNames. Returns entity ids matching the trigram-OR expression built from the input's display
// name. Short-circuits when the normalized name is shorter than TRIGRAM_MINIMUM_LENGTH.
async function trigramChannel(
  database: SqlDatabase,
  input: FindDuplicateCandidatesInput,
): Promise<Set<string>> {
  const displayName = displayNameFromInput(input);
  const normalizedQuery = normalizeName(displayName);
  if (normalizedQuery.length < TRIGRAM_MINIMUM_LENGTH) return new Set();

  const ftsMatchExpression = buildTrigramOrExpression(normalizedQuery);

  // Deleted entities are excluded; merged-away entities are kept and resolved to their master via
  // COALESCE(merged_into_id, id) — see the merge-resolution note above.
  const sql = `
    SELECT DISTINCT COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id
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
      AND dn.entity_kind = ?2
      AND dn.deleted_at IS NULL
      AND (
        (dn.entity_kind = 'person'       AND dp.deleted_at IS NULL)
        OR
        (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
      )
  `;

  const { results } = await database
    .prepare(sql)
    .bind(ftsMatchExpression, input.kind)
    .all<{ entity_id: string }>();

  return new Set(results.map((row) => row.entity_id));
}

// Channel 3: Blind-index identifiers. For each supplied identifier whose type is standalone-
// indexable, delegates to findByIdentifier to probe value_blind_index equality. Non-indexable
// types (dob, ssn_last_four) are caught via IdentifierNotIndexableError and silently skipped —
// those types are resolved by decrypt-and-compare over the full candidate set, not here.
async function identifierChannel(
  context: DirectoryIdentifierContext,
  input: FindDuplicateCandidatesInput,
): Promise<Set<string>> {
  const identifiers = input.identifiers ?? [];
  if (identifiers.length === 0) return new Set();

  const entityIdSets = await Promise.all(
    identifiers.map(async (identifier) => {
      try {
        const entityIds = await findByIdentifier(context, {
          type: identifier.type,
          value: identifier.value,
        });
        return new Set(entityIds);
      } catch (error) {
        if (error instanceof IdentifierNotIndexableError) {
          // Non-indexable type (dob, ssn_last_four): silently skip — see function doc above.
          return new Set<string>();
        }
        throw error;
      }
    }),
  );

  // Union all identifier matches into one set, then resolve any merged-away subordinate to its
  // master. Identifier rows stay alive on the subordinate after a merge (the conflicts-corpus rule),
  // so an exact-identifier hit can land on a subordinate; it must surface the surviving master, like
  // the name channels do in SQL.
  const union = new Set<string>();
  for (const set of entityIdSets) {
    for (const entityId of set) {
      union.add(entityId);
    }
  }
  return resolveMergedIds(context.database, union);
}

// Resolve a set of entity ids through merged_into_id and apply the same deleted_at exclusion
// the name channels apply in SQL. For each id:
//   - If the node row has merged_into_id set, the id is a subordinate; resolve to the master.
//   - If the resolved (or original) node row has deleted_at set, the entity is soft-deleted;
//     drop it from the result — mirroring the `dp.deleted_at IS NULL` predicate in the name channels.
//   - Otherwise pass the id through unchanged.
// The name channels resolve in SQL (COALESCE + deleted_at predicate on the joined node row); this
// is the in-code equivalent for ids that did not arrive through a node-table join.
async function resolveMergedIds(
  database: SqlDatabase,
  entityIds: Set<string>,
): Promise<Set<string>> {
  if (entityIds.size === 0) return entityIds;
  const resolved = new Set<string>();
  for (const entityId of entityIds) {
    const table = entityId.startsWith("directoryOrganization_")
      ? "directory_organization"
      : "directory_person";
    const { results } = await database
      .prepare(`SELECT merged_into_id, deleted_at FROM ${table} WHERE id = ?1`)
      .bind(entityId)
      .all<{ merged_into_id: string | null; deleted_at: string | null }>();
    const row = results[0];
    if (row === undefined) continue; // entity not found — skip

    if (row.merged_into_id !== null) {
      // Subordinate: resolve to the master and check the master's deleted_at.
      const masterId = row.merged_into_id;
      const masterTable = masterId.startsWith("directoryOrganization_")
        ? "directory_organization"
        : "directory_person";
      const { results: masterResults } = await database
        .prepare(`SELECT deleted_at FROM ${masterTable} WHERE id = ?1`)
        .bind(masterId)
        .all<{ deleted_at: string | null }>();
      const masterRow = masterResults[0];
      if (masterRow !== undefined && masterRow.deleted_at === null) {
        resolved.add(masterId);
      }
      // If master is soft-deleted or not found, drop the candidate entirely.
    } else if (row.deleted_at === null) {
      // Non-merged, non-deleted: pass through.
      resolved.add(entityId);
    }
    // If deleted_at is set, drop the candidate — mirrors the name channel predicate.
  }
  return resolved;
}

export async function findDuplicateCandidates(
  context: DirectoryIdentifierContext,
  input: FindDuplicateCandidatesInput,
): Promise<DuplicateCandidate[]> {
  // Short-circuit when there is nothing to match on: no name and no identifiers.
  const displayName = displayNameFromInput(input);
  const hasName =
    normalizeName(displayName).length >= TRIGRAM_MINIMUM_LENGTH ||
    phoneticTokenFromInput(input).length > 0;
  const hasIdentifiers = (input.identifiers ?? []).length > 0;
  if (!hasName && !hasIdentifiers) return [];

  // Run all three channels in parallel.
  const [phoneticSet, trigramSet, identifierSet] = await Promise.all([
    phoneticChannel(context.database, input),
    trigramChannel(context.database, input),
    identifierChannel(context, input),
  ]);

  // Union the three sets and count how many channels contributed each entity id.
  const signalCounts = new Map<string, number>();

  function tally(set: Set<string>): void {
    for (const entityId of set) {
      signalCounts.set(entityId, (signalCounts.get(entityId) ?? 0) + 1);
    }
  }

  tally(phoneticSet);
  tally(trigramSet);
  tally(identifierSet);

  // Apply excludeEntityId after union — consistent exclusion across all channels.
  if (input.excludeEntityId !== undefined) {
    signalCounts.delete(input.excludeEntityId);
  }

  // Sort descending by signal count (most channels first = strongest candidate first).
  const candidates: DuplicateCandidate[] = [...signalCounts.entries()]
    .map(([entityId, signalCount]) => ({ entityId, signalCount }))
    .sort((a, b) => b.signalCount - a.signalCount);

  return candidates;
}

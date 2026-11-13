import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  findByIdentifier,
  findEntitiesSharingIdentifiers,
  findEntitiesSharingIdentifiersBatch,
  IdentifierNotIndexableError,
  type DirectoryIdentifierContext,
} from "./identifiers.ts";
import { nodeTableForEntityId } from "./entity-kind.ts";
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
//
// matchedName and matchedNameRole say WHICH of the entity's names the query landed on, and they are
// what makes the corpus worth keeping. The whole point of storing every name an entity has held is
// that a search for a maiden name finds the woman who now goes by another one — and a hit that
// reports only the current name looks identical to a hit on the current name, so the person reading
// the result cannot tell that the file they want is filed under a name they did not type.
export interface NameSearchHit {
  readonly entityId: string;
  readonly entityKind: EntityKind;
  readonly displayName: string;
  /**
   * The name row the query matched, as it was recorded. An organization's name row stores only the
   * case-folded form, so an organization's matched alias reads lowercase — the recorded casing is not
   * kept on `directory_name`.
   */
  readonly matchedName: string;
  /** What that name is to the entity: its current name, a former one, a maiden name, a trading name. */
  readonly matchedNameRole: string;
  /** True when the query landed on the name the entity answers to today. */
  readonly matchedNameIsCurrent: boolean;
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
/**
 * The most relevant matches, and whether the firm has more that did not fit.
 *
 * CAPPED rather than cursor-paged, and that is the shape a relevance-ranked search wants. The
 * ordering key is bm25, a score recomputed per query rather than a stored column, so a keyset over
 * it would be paging by a value the row does not carry. The top matches ARE the answer a name box is
 * asking for; a person who does not see what they wanted types more, they do not walk to page nine.
 *
 * What is NOT acceptable is cutting the answer silently, so the cap reports itself: `capped` says the
 * firm holds more matches than were returned, which is a caller's cue to narrow rather than a
 * suggestion that the directory is small.
 */
export interface NameSearchResult {
  readonly hits: NameSearchHit[];
  readonly capped: boolean;
}

/** How many matches a single search answers with, when the caller names no smaller number. */
export const NAME_SEARCH_LIMIT = 50;

export async function searchNames(
  database: SqlDatabase,
  query: string,
  limit: number = NAME_SEARCH_LIMIT,
): Promise<NameSearchResult> {
  const normalizedQuery = normalizeName(query);

  // The trigram tokenizer requires at least three characters to form a single trigram.
  // Return early rather than running a MATCH that can produce no results.
  if (normalizedQuery.length < TRIGRAM_MINIMUM_LENGTH) {
    return { hits: [], capped: false };
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
      dn.name_role        AS name_role,
      dn.is_current       AS is_current,
      dn.name_prefix      AS name_prefix,
      dn.name_given       AS name_given,
      dn.name_middle      AS name_middle,
      dn.name_family      AS name_family,
      dn.name_suffix      AS name_suffix,
      dn.normalized_display AS normalized_display,
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
    LIMIT ?2
  `;

  const { results } = await database
    .prepare(sql)
    .bind(ftsMatchExpression, limit + 1)
    .all<{
      entity_id: string;
      entity_kind: string;
      display_name: string | null;
      name_role: string;
      is_current: number;
      name_prefix: string | null;
      name_given: string | null;
      name_middle: string | null;
      name_family: string | null;
      name_suffix: string | null;
      normalized_display: string;
      relevance: number;
    }>();

  // One row over the limit was asked for as the has-more probe; it is never returned.
  const capped = results.length > limit;
  return {
    capped,
    hits: (capped ? results.slice(0, limit) : results).map((row) => ({
      entityId: row.entity_id,
      entityKind: row.entity_kind as EntityKind,
      displayName: row.display_name ?? "",
      // A person's name row keeps its parts, so the matched name reads as it was written. An
      // organization's does not, so the case-folded form is the honest answer rather than a
      // capitalization nothing recorded.
      matchedName: matchedNameFromRow(row),
      matchedNameRole: row.name_role,
      matchedNameIsCurrent: row.is_current === 1,
      relevance: row.relevance,
    })),
  };
}

// The matched name as recorded: a person's parts joined, or — where the row carries none, which is
// every organization name row — the case-folded display the corpus indexed.
function matchedNameFromRow(row: {
  name_prefix: string | null;
  name_given: string | null;
  name_middle: string | null;
  name_family: string | null;
  name_suffix: string | null;
  normalized_display: string;
}): string {
  const assembled = [
    row.name_prefix,
    row.name_given,
    row.name_middle,
    row.name_family,
    row.name_suffix,
  ]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  return assembled === "" ? row.normalized_display : assembled;
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
// The three result sets are unioned by entity id. Each entity accumulates a signalCount (the number
// of distinct channels that returned it), the set of channels that fired, and — for the identifier
// channel — the identifier types that matched. The list is sorted descending by signalCount so
// entities that hit more channels appear first (they are stronger duplicate candidates).
//
// Merge-resolution: duplicate detection is the conflicts corpus, so a merged-away entity's still-alive
// name/identifier rows must keep matching — but resolve to the surviving master, never the archived
// subordinate. Each channel therefore INCLUDES merged_into entities and, where a hit lands on a
// subordinate, returns its merged_into_id (the master id) in place of the subordinate's own id (see
// resolveMergedId). A hit on the subordinate's old name thus surfaces the master; the subordinate id
// itself never appears as a candidate. This is the deliberate divergence from searchNames, which is
// ordinary search and still excludes merged entities outright. The blind-index identifier channel
// resolves the same way via resolveMergedId.

// Which blocking channel surfaced a candidate. Consumers rank a candidate by what kind of thing
// matched — an exact identifier is categorically stronger evidence than trigram overlap — so the
// channel that fired travels with the result rather than being collapsed into a count.
export type MatchChannel = "phonetic" | "trigram" | "identifier";

// Narrows the name channels. Omitted means "every scheme, every name role", which is the behaviour
// this function has always had: all phonetic schemes are blended and alias/former names are always
// searched. Supplying these restricts recall — it can only remove candidates, never add them.
export interface MatchOptions {
  readonly schemes?: readonly string[];
  readonly nameRoles?: readonly string[];
  // False skips the trigram channel. A conflicts check run without it is one a person chose to run
  // that way and recorded on the check; entry-time duplicate detection never passes it.
  readonly trigram?: boolean;
}

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
  // Conflicts case: the id of an already-persisted subject entity whose own sealed identifiers should
  // drive the blind-index channel. Duplicate detection at entry time supplies plaintext `identifiers`;
  // a conflicts check has no plaintext in hand, so the channel self-joins the subject's stored blind
  // indexes instead. Both paths union into the same identifier channel. Omitted for the entry-time path.
  readonly subjectEntityId?: string;
  // Narrows the phonetic scheme set and/or the name roles the name channels search. Omitted
  // preserves today's behaviour exactly: every scheme, every name role.
  readonly matchOptions?: MatchOptions;
}

// A single entry in the ranked duplicate-candidate list. entityId is the directory entity;
// signalCount is the number of distinct channels (phonetic, trigram, identifier) that returned
// this entity — higher is a stronger candidate. channels names which of those channels fired;
// identifierTypes lists which identifier types matched (empty unless the identifier channel fired).
export interface DuplicateCandidate {
  readonly entityId: string;
  readonly signalCount: number;
  readonly channels: readonly MatchChannel[];
  readonly identifierTypes: readonly string[];
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

  // Build parameterized IN lists positionally. Each value is bound as a separate parameter because
  // D1/SQLite prepared-statement binding does not accept array values natively; bindings accumulates
  // in bind order so the optional filters below can append without disturbing earlier placeholders.
  const bindings: unknown[] = [input.kind];
  const codePlaceholders = codes.map((code) => {
    bindings.push(code.code);
    return `?${bindings.length}`;
  });

  // matchOptions.schemes narrows which Double Metaphone scheme(s) count as a match — omitted means
  // every scheme (today's behaviour: primary and secondary are always blended).
  let schemeFilter = "";
  const schemes = input.matchOptions?.schemes;
  if (schemes !== undefined && schemes.length > 0) {
    const schemePlaceholders = schemes.map((scheme) => {
      bindings.push(scheme);
      return `?${bindings.length}`;
    });
    schemeFilter = `AND pc.scheme IN (${schemePlaceholders.join(", ")})`;
  }

  // matchOptions.nameRoles narrows which name rows are searched (e.g. 'current' only) — omitted
  // means every role (today's behaviour: alias/former names are always searched).
  let nameRoleFilter = "";
  const nameRoles = input.matchOptions?.nameRoles;
  if (nameRoles !== undefined && nameRoles.length > 0) {
    const nameRolePlaceholders = nameRoles.map((role) => {
      bindings.push(role);
      return `?${bindings.length}`;
    });
    nameRoleFilter = `AND dn.name_role IN (${nameRolePlaceholders.join(", ")})`;
  }

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
      AND pc.code IN (${codePlaceholders.join(", ")})
      AND dn.deleted_at IS NULL
      ${schemeFilter}
      ${nameRoleFilter}
      AND (
        (dn.entity_kind = 'person'       AND dp.deleted_at IS NULL)
        OR
        (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
      )
  `;

  const { results } = await database
    .prepare(sql)
    .bind(...bindings)
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

  const bindings: unknown[] = [ftsMatchExpression, input.kind];

  // matchOptions.nameRoles narrows which name rows are searched (e.g. 'current' only) — omitted
  // means every role (today's behaviour: alias/former names are always searched).
  let nameRoleFilter = "";
  const nameRoles = input.matchOptions?.nameRoles;
  if (nameRoles !== undefined && nameRoles.length > 0) {
    const nameRolePlaceholders = nameRoles.map((role) => {
      bindings.push(role);
      return `?${bindings.length}`;
    });
    nameRoleFilter = `AND dn.name_role IN (${nameRolePlaceholders.join(", ")})`;
  }

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
      ${nameRoleFilter}
      AND (
        (dn.entity_kind = 'person'       AND dp.deleted_at IS NULL)
        OR
        (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
      )
  `;

  const { results } = await database
    .prepare(sql)
    .bind(...bindings)
    .all<{ entity_id: string }>();

  return new Set(results.map((row) => row.entity_id));
}

// Channel 3: Blind-index identifiers. For each supplied identifier whose type is standalone-
// indexable, delegates to findByIdentifier to probe value_blind_index equality. Non-indexable
// types (dob, ssn_last_four) are caught via IdentifierNotIndexableError and silently skipped —
// those types are resolved by decrypt-and-compare over the full candidate set, not here.
// Returns a map from resolved entity id to the identifier types that matched it, so the type
// survives merge-resolution and travels to the DuplicateCandidate.identifierTypes field.
async function identifierChannel(
  context: DirectoryIdentifierContext,
  input: FindDuplicateCandidatesInput,
): Promise<Map<string, string[]>> {
  const identifiers = input.identifiers ?? [];
  if (identifiers.length === 0 && input.subjectEntityId === undefined) return new Map();

  // Collect raw (pre-merge-resolution) hits: for each identifier type, which entity ids matched.
  // Keyed by the raw entity id, not yet resolved to a master, so a type hitting the same raw id
  // twice (unlikely but possible with multiple identifiers) is deduplicated before resolution.
  const rawHits = new Map<string, Set<string>>();
  function recordRawHit(entityId: string, identifierType: string): void {
    const types = rawHits.get(entityId) ?? new Set<string>();
    types.add(identifierType);
    rawHits.set(entityId, types);
  }

  // Plaintext-probe path (entry-time duplicate detection): hash each supplied value and match equality.
  await Promise.all(
    identifiers.map(async (identifier) => {
      try {
        const entityIds = await findByIdentifier(context, {
          type: identifier.type,
          value: identifier.value,
        });
        for (const entityId of entityIds) recordRawHit(entityId, identifier.type);
      } catch (error) {
        if (error instanceof IdentifierNotIndexableError) {
          // Non-indexable type (dob, ssn_last_four): silently skip — see function doc above.
          return;
        }
        throw error;
      }
    }),
  );

  // Subject-self-join path (conflicts): the subject's own sealed identifiers matched by blind-index
  // equality against every other entity — the plaintext is not in hand, so equality is done in SQL.
  if (input.subjectEntityId !== undefined) {
    for (const { entityId, identifierType } of await findEntitiesSharingIdentifiers(
      context.database,
      input.subjectEntityId,
    )) {
      recordRawHit(entityId, identifierType);
    }
  }

  // Resolve every raw hit to its merge-surviving master (or drop it if soft-deleted / not found),
  // then union the matched identifier types onto the resolved id — a subordinate and its master
  // never appear as separate candidates, so their matched types combine under the one surfaced id.
  // Identifier rows stay alive on the subordinate after a merge (the conflicts-corpus rule), so an
  // exact-identifier hit can land on a subordinate; it must surface the surviving master, like the
  // name channels do in SQL.
  const resolvedHits = new Map<string, Set<string>>();
  await Promise.all(
    [...rawHits.entries()].map(async ([entityId, types]) => {
      const resolvedId = await resolveMergedId(context.database, entityId);
      if (resolvedId === null) return;
      const existing = resolvedHits.get(resolvedId) ?? new Set<string>();
      for (const type of types) existing.add(type);
      resolvedHits.set(resolvedId, existing);
    }),
  );

  const result = new Map<string, string[]>();
  for (const [entityId, types] of resolvedHits) {
    result.set(entityId, [...types]);
  }
  return result;
}

// Resolve a single entity id through merged_into_id and apply the same deleted_at exclusion the
// name channels apply in SQL:
//   - If the node row has merged_into_id set, the id is a subordinate; resolve to the master and
//     check the master's deleted_at.
//   - If the resolved (or original) node row has deleted_at set, the entity is soft-deleted; return
//     null — mirroring the `dp.deleted_at IS NULL` predicate in the name channels.
//   - Otherwise return the id unchanged.
// The name channels resolve in SQL (COALESCE + deleted_at predicate on the joined node row); this
// is the in-code equivalent for ids that did not arrive through a node-table join.
async function resolveMergedId(database: SqlDatabase, entityId: string): Promise<string | null> {
  const table = nodeTableForEntityId(entityId);
  const { results } = await database
    .prepare(`SELECT merged_into_id, deleted_at FROM ${table} WHERE id = ?1`)
    .bind(entityId)
    .all<{ merged_into_id: string | null; deleted_at: string | null }>();
  const row = results[0];
  if (row === undefined) return null; // entity not found

  if (row.merged_into_id !== null) {
    // Subordinate: resolve to the master and check the master's deleted_at.
    const masterId = row.merged_into_id;
    const masterTable = nodeTableForEntityId(masterId);
    const { results: masterResults } = await database
      .prepare(`SELECT deleted_at FROM ${masterTable} WHERE id = ?1`)
      .bind(masterId)
      .all<{ deleted_at: string | null }>();
    const masterRow = masterResults[0];
    if (masterRow !== undefined && masterRow.deleted_at === null) {
      return masterId;
    }
    return null; // master soft-deleted or not found — drop the candidate entirely.
  }

  if (row.deleted_at === null) return entityId; // non-merged, non-deleted: pass through.
  return null; // soft-deleted — drop the candidate, mirrors the name channel predicate.
}

// ── Set-valued duplicate-candidate generation ─────────────────────────────────
//
// findDuplicateCandidatesBatch answers the same question as findDuplicateCandidates for a WHOLE SET
// of subjects, running each blocking channel ONCE over the set instead of once per subject. The
// conflicts graph traversal reaches hundreds of entities and asks this question of every one of them;
// at one call each that is a query count proportional to entities times channels, which no request
// budget survives.
//
// It is additive in the strict sense: findDuplicateCandidates keeps its exact signature, its exact
// SQL, and its exact behaviour, and the entry-time duplicate-detection and merge callers are
// untouched. The batch path reproduces the per-subject answer rather than approximating it, and
// packages/conflicts/test/matcher-equivalence.test.ts proves the two return the same hit set over a
// real corpus.
//
// Attribution — how a candidate found by one set-wide query is assigned back to the subject it
// belongs to — is exact for each channel, and how is the whole trick:
//   phonetic   — the matching CODE comes back with the row, and a code names its subjects.
//   trigram    — the union of the per-subject trigram-OR expressions is one trigram-OR expression
//                over the union of the trigrams, because a document matches an OR of trigrams exactly
//                when it shares at least one of them. The candidate's own normalized_display comes
//                back with the row, so the per-subject share test is re-run in TypeScript over a
//                bounded set rather than guessed at.
//   identifier — the SUBJECT side of the blind-index self-join is projected, so each hit names the
//                subject whose sealed identifier matched it.

// D1 caps bound parameters at 100 per query, so every set-valued read below chunks. The query count
// is therefore O(channels x ceil(subjects / 100)) rather than O(subjects x channels): still
// proportional to the channel count, with a small fan for the platform's bind cap.
const MAX_SEARCH_BOUND_PARAMETERS = 100;

function chunked<T>(values: readonly T[], size = MAX_SEARCH_BOUND_PARAMETERS): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }
  return chunks;
}

// One subject in a batch: the same name and identifier facts findDuplicateCandidates takes, plus the
// key the caller wants its candidates returned under.
export interface BatchSubject {
  readonly key: string;
  readonly kind: EntityKind;
  readonly given?: string;
  readonly family?: string;
  readonly legalName?: string;
  readonly subjectEntityId?: string;
  readonly excludeEntityId?: string;
}

// Channel 1, set-valued. Returns, per matching phonetic code, the resolved entity ids carrying it.
async function phoneticChannelBatch(
  database: SqlDatabase,
  kind: EntityKind,
  codes: readonly string[],
  matchOptions: MatchOptions,
): Promise<Map<string, Set<string>>> {
  const byCode = new Map<string, Set<string>>();
  for (const chunk of chunked(codes)) {
    const bindings: unknown[] = [kind];
    const codePlaceholders = chunk.map((code) => {
      bindings.push(code);
      return `?${bindings.length}`;
    });
    let schemeFilter = "";
    const schemes = matchOptions.schemes;
    if (schemes !== undefined && schemes.length > 0) {
      schemeFilter = `AND pc.scheme IN (${schemes
        .map((scheme) => {
          bindings.push(scheme);
          return `?${bindings.length}`;
        })
        .join(", ")})`;
    }
    let nameRoleFilter = "";
    const nameRoles = matchOptions.nameRoles;
    if (nameRoles !== undefined && nameRoles.length > 0) {
      nameRoleFilter = `AND dn.name_role IN (${nameRoles
        .map((role) => {
          bindings.push(role);
          return `?${bindings.length}`;
        })
        .join(", ")})`;
    }

    // Identical to phoneticChannel's SQL but for projecting pc.code, so the row can be attributed.
    const { results } = await database
      .prepare(
        `SELECT DISTINCT pc.code AS code, COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id
         FROM directory_name_phonetic_code AS pc
         JOIN directory_name AS dn ON pc.name_id = dn.id
         LEFT JOIN directory_person AS dp ON dn.entity_kind = 'person' AND dp.id = dn.entity_id
         LEFT JOIN directory_organization AS do ON dn.entity_kind = 'organization' AND do.id = dn.entity_id
         WHERE dn.entity_kind = ?1
           AND pc.code IN (${codePlaceholders.join(", ")})
           AND dn.deleted_at IS NULL
           ${schemeFilter}
           ${nameRoleFilter}
           AND (
             (dn.entity_kind = 'person' AND dp.deleted_at IS NULL)
             OR (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
           )`,
      )
      .bind(...bindings)
      .all<{ code: string; entity_id: string }>();

    for (const row of results) {
      const entities = byCode.get(row.code) ?? new Set<string>();
      entities.add(row.entity_id);
      byCode.set(row.code, entities);
    }
  }
  return byCode;
}

// Channel 2, set-valued. One MATCH over the union of every subject's trigrams; the candidate's own
// normalized_display comes back so the per-subject share test is exact.
async function trigramChannelBatch(
  database: SqlDatabase,
  kind: EntityKind,
  trigrams: readonly string[],
  matchOptions: MatchOptions,
): Promise<Array<{ entityId: string; normalizedDisplay: string }>> {
  if (trigrams.length === 0) return [];
  const matched: Array<{ entityId: string; normalizedDisplay: string }> = [];
  // FTS5 caps the size of one MATCH expression in practice, and the union of a large subject set's
  // trigrams is the one term list here that grows with the set, so it is chunked like the bindings.
  for (const chunk of chunked(trigrams, 200)) {
    const expression = chunk.map((trigram) => `"${trigram}"`).join(" OR ");
    const bindings: unknown[] = [expression, kind];
    let nameRoleFilter = "";
    const nameRoles = matchOptions.nameRoles;
    if (nameRoles !== undefined && nameRoles.length > 0) {
      nameRoleFilter = `AND dn.name_role IN (${nameRoles
        .map((role) => {
          bindings.push(role);
          return `?${bindings.length}`;
        })
        .join(", ")})`;
    }
    const { results } = await database
      .prepare(
        `SELECT DISTINCT COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id,
                dn.normalized_display AS normalized_display
         FROM directory_name_fts
         JOIN directory_name AS dn ON directory_name_fts.rowid = dn.rowid
         LEFT JOIN directory_person AS dp ON dn.entity_kind = 'person' AND dp.id = dn.entity_id
         LEFT JOIN directory_organization AS do ON dn.entity_kind = 'organization' AND do.id = dn.entity_id
         WHERE directory_name_fts MATCH ?1
           AND dn.entity_kind = ?2
           AND dn.deleted_at IS NULL
           ${nameRoleFilter}
           AND (
             (dn.entity_kind = 'person' AND dp.deleted_at IS NULL)
             OR (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
           )`,
      )
      .bind(...bindings)
      .all<{ entity_id: string; normalized_display: string }>();
    for (const row of results) {
      matched.push({ entityId: row.entity_id, normalizedDisplay: row.normalized_display });
    }
  }
  return matched;
}

// Channel 3, set-valued. Delegates to the identifier chokepoint exactly as the per-subject channel
// does — `value_blind_index` is named in identifiers.ts and nowhere else, which the package's
// no-plaintext-escape probe enforces.
async function identifierChannelBatch(
  database: SqlDatabase,
  subjectEntityIds: readonly string[],
): Promise<Map<string, Map<string, Set<string>>>> {
  const rawBySubject = new Map<string, Map<string, Set<string>>>();
  for (const [subjectEntityId, hits] of await findEntitiesSharingIdentifiersBatch(
    database,
    subjectEntityIds,
  )) {
    const perSubject = new Map<string, Set<string>>();
    for (const { entityId, identifierType } of hits) {
      const types = perSubject.get(entityId) ?? new Set<string>();
      types.add(identifierType);
      perSubject.set(entityId, types);
    }
    rawBySubject.set(subjectEntityId, perSubject);
  }
  return rawBySubject;
}

// resolveMergedId, set-valued: one read per node table over every raw id, rather than two reads per
// id. Returns the resolved master for each id, or null where the entity (or its master) is
// soft-deleted or absent — the same three outcomes, in the same order of precedence.
async function resolveMergedIdBatch(
  database: SqlDatabase,
  entityIds: readonly string[],
): Promise<Map<string, string | null>> {
  const rows = new Map<string, { mergedIntoId: string | null; deletedAt: string | null }>();
  const readInto = async (ids: readonly string[]): Promise<void> => {
    const byTable = new Map<string, string[]>();
    for (const id of ids) {
      if (rows.has(id)) continue;
      const table = nodeTableForEntityId(id);
      byTable.set(table, [...(byTable.get(table) ?? []), id]);
    }
    for (const [table, tableIds] of byTable) {
      for (const chunk of chunked(tableIds)) {
        const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
        const { results } = await database
          .prepare(
            `SELECT id, merged_into_id, deleted_at FROM ${table} WHERE id IN (${placeholders})`,
          )
          .bind(...chunk)
          .all<{ id: string; merged_into_id: string | null; deleted_at: string | null }>();
        for (const row of results) {
          rows.set(row.id, { mergedIntoId: row.merged_into_id, deletedAt: row.deleted_at });
        }
      }
    }
  };

  await readInto(entityIds);
  // One further pass for the masters a subordinate points at — merge chains are flattened at write
  // time (merged_into_id always names a live entity), so one pass is the whole chain.
  const masterIds = [...new Set(entityIds.map((id) => rows.get(id)?.mergedIntoId ?? null))].filter(
    (id): id is string => id !== null,
  );
  await readInto(masterIds);

  const resolved = new Map<string, string | null>();
  for (const entityId of entityIds) {
    const row = rows.get(entityId);
    if (row === undefined) {
      resolved.set(entityId, null);
      continue;
    }
    if (row.mergedIntoId !== null) {
      const master = rows.get(row.mergedIntoId);
      resolved.set(
        entityId,
        master !== undefined && master.deletedAt === null ? row.mergedIntoId : null,
      );
      continue;
    }
    resolved.set(entityId, row.deletedAt === null ? entityId : null);
  }
  return resolved;
}

export async function findDuplicateCandidatesBatch(
  context: DirectoryIdentifierContext,
  subjects: readonly BatchSubject[],
  matchOptions: MatchOptions = {},
): Promise<Map<string, DuplicateCandidate[]>> {
  const results = new Map<string, DuplicateCandidate[]>();
  for (const subject of subjects) results.set(subject.key, []);
  if (subjects.length === 0) return results;

  // Per subject, the facts the three channels need, computed exactly as the per-subject path does.
  const prepared = subjects.map((subject) => {
    const input: FindDuplicateCandidatesInput = {
      kind: subject.kind,
      given: subject.given,
      family: subject.family,
      legalName: subject.legalName,
      subjectEntityId: subject.subjectEntityId,
      excludeEntityId: subject.excludeEntityId,
      matchOptions,
    };
    const normalizedDisplay = normalizeName(displayNameFromInput(input));
    const phoneticToken = phoneticTokenFromInput(input);
    const codes = phoneticToken.length === 0 ? [] : phoneticCodes(phoneticToken).map((c) => c.code);
    const queryTrigrams =
      normalizedDisplay.length < TRIGRAM_MINIMUM_LENGTH
        ? []
        : [...new Set(extractTrigrams(normalizedDisplay))];
    return {
      subject,
      // The same short-circuit findDuplicateCandidates applies: no usable name and no identifiers
      // means no candidates at all, not an empty-query scan.
      searchable:
        normalizedDisplay.length >= TRIGRAM_MINIMUM_LENGTH ||
        phoneticToken.length > 0 ||
        subject.subjectEntityId !== undefined,
      codes,
      queryTrigrams,
    };
  });

  const active = prepared.filter((entry) => entry.searchable);
  const kinds = [...new Set(active.map((entry) => entry.subject.kind))].sort();

  // Channel 1 and 2 run once per entity KIND, because both filter on dn.entity_kind exactly as the
  // per-subject channels do. Two kinds is the maximum the Directory has.
  const phoneticByKind = new Map<EntityKind, Map<string, Set<string>>>();
  // Per kind, an INVERTED index from trigram to the entities whose name carries it — built once from
  // the rows the union query returned. Attribution is then a union over each subject's own trigrams,
  // the same shape the phonetic channel already has. Re-extracting each candidate's trigrams inside
  // the per-subject loop instead is quadratic in (subjects x candidates), and on a several-hundred
  // entity closure that arithmetic costs more than the queries the batching saved.
  const trigramIndexByKind = new Map<EntityKind, Map<string, Set<string>>>();
  for (const kind of kinds) {
    const ofKind = active.filter((entry) => entry.subject.kind === kind);
    const codes = [...new Set(ofKind.flatMap((entry) => entry.codes))].sort();
    const trigrams =
      matchOptions.trigram === false
        ? []
        : [...new Set(ofKind.flatMap((entry) => entry.queryTrigrams))].sort();
    phoneticByKind.set(
      kind,
      codes.length === 0
        ? new Map()
        : await phoneticChannelBatch(context.database, kind, codes, matchOptions),
    );
    const wanted = new Set(trigrams);
    const index = new Map<string, Set<string>>();
    for (const row of await trigramChannelBatch(context.database, kind, trigrams, matchOptions)) {
      // Only the trigrams some subject actually asked for can attribute anything, so the index holds
      // those and nothing else.
      for (const trigram of new Set(extractTrigrams(row.normalizedDisplay))) {
        if (!wanted.has(trigram)) continue;
        const entities = index.get(trigram) ?? new Set<string>();
        entities.add(row.entityId);
        index.set(trigram, entities);
      }
    }
    trigramIndexByKind.set(kind, index);
  }

  // Channel 3 runs once over every subject that has a persisted entity to self-join from.
  const subjectEntityIds = [
    ...new Set(
      active
        .map((entry) => entry.subject.subjectEntityId)
        .filter((id): id is string => id !== undefined),
    ),
  ].sort();
  const rawIdentifierHits = await identifierChannelBatch(context.database, subjectEntityIds);
  const rawHitIds = [
    ...new Set([...rawIdentifierHits.values()].flatMap((perSubject) => [...perSubject.keys()])),
  ].sort();
  const resolvedIds = await resolveMergedIdBatch(context.database, rawHitIds);

  for (const entry of prepared) {
    if (!entry.searchable) continue;
    const signals = new Map<
      string,
      { channels: Set<MatchChannel>; identifierTypes: Set<string> }
    >();
    const signalFor = (entityId: string) => {
      let signal = signals.get(entityId);
      if (signal === undefined) {
        signal = { channels: new Set<MatchChannel>(), identifierTypes: new Set<string>() };
        signals.set(entityId, signal);
      }
      return signal;
    };

    for (const code of entry.codes) {
      for (const entityId of phoneticByKind.get(entry.subject.kind)?.get(code) ?? []) {
        signalFor(entityId).channels.add("phonetic");
      }
    }

    // The share test the per-subject MATCH performs, answered from the inverted index: a candidate
    // matches this subject exactly when it carries at least one of the subject's trigrams. FTS5
    // indexes normalized_display verbatim with the trigram tokenizer, so the windows the index was
    // built from are the tokens FTS5 holds — this is the same predicate, not an approximation of it.
    const trigramIndex = trigramIndexByKind.get(entry.subject.kind);
    if (trigramIndex !== undefined) {
      for (const trigram of entry.queryTrigrams) {
        for (const entityId of trigramIndex.get(trigram) ?? []) {
          signalFor(entityId).channels.add("trigram");
        }
      }
    }

    const subjectEntityId = entry.subject.subjectEntityId;
    if (subjectEntityId !== undefined) {
      // Resolve first, then union the types onto the surviving master, so a subordinate and its
      // master never appear as two candidates — the per-subject path's rule, unchanged.
      const perSubject = rawIdentifierHits.get(subjectEntityId) ?? new Map<string, Set<string>>();
      for (const [rawId, types] of perSubject) {
        const resolvedId = resolvedIds.get(rawId) ?? null;
        if (resolvedId === null) continue;
        const signal = signalFor(resolvedId);
        signal.channels.add("identifier");
        for (const type of types) signal.identifierTypes.add(type);
      }
    }

    if (entry.subject.excludeEntityId !== undefined) signals.delete(entry.subject.excludeEntityId);

    results.set(
      entry.subject.key,
      [...signals.entries()]
        .map(([entityId, signal]) => ({
          entityId,
          signalCount: signal.channels.size,
          channels: [...signal.channels].sort(),
          identifierTypes: [...signal.identifierTypes].sort(),
        }))
        .sort((a, b) => b.signalCount - a.signalCount || a.entityId.localeCompare(b.entityId)),
    );
  }

  return results;
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
  const hasIdentifiers =
    (input.identifiers ?? []).length > 0 || input.subjectEntityId !== undefined;
  if (!hasName && !hasIdentifiers) return [];

  // Run all three channels in parallel.
  const [phoneticSet, trigramSet, identifierMap] = await Promise.all([
    phoneticChannel(context.database, input),
    input.matchOptions?.trigram === false
      ? Promise.resolve(new Set<string>())
      : trigramChannel(context.database, input),
    identifierChannel(context, input),
  ]);

  // Union the three channels' results, tracking per entity id which channels fired and (for the
  // identifier channel) which identifier types matched.
  const signals = new Map<string, { channels: Set<MatchChannel>; identifierTypes: Set<string> }>();

  function signalFor(entityId: string): {
    channels: Set<MatchChannel>;
    identifierTypes: Set<string>;
  } {
    let signal = signals.get(entityId);
    if (signal === undefined) {
      signal = { channels: new Set<MatchChannel>(), identifierTypes: new Set<string>() };
      signals.set(entityId, signal);
    }
    return signal;
  }

  for (const entityId of phoneticSet) signalFor(entityId).channels.add("phonetic");
  for (const entityId of trigramSet) signalFor(entityId).channels.add("trigram");
  for (const [entityId, types] of identifierMap) {
    const signal = signalFor(entityId);
    signal.channels.add("identifier");
    for (const type of types) signal.identifierTypes.add(type);
  }

  // Apply excludeEntityId after union — consistent exclusion across all channels.
  if (input.excludeEntityId !== undefined) {
    signals.delete(input.excludeEntityId);
  }

  // Sort descending by signal count (most channels first = strongest candidate first), with a
  // stable secondary sort on the entity id so equal-signal candidates have a deterministic order
  // regardless of channel completion order (otherwise the ordering varies with DB result order).
  const candidates: DuplicateCandidate[] = [...signals.entries()]
    .map(([entityId, signal]) => ({
      entityId,
      signalCount: signal.channels.size,
      channels: [...signal.channels].sort(),
      identifierTypes: [...signal.identifierTypes].sort(),
    }))
    .sort((a, b) => b.signalCount - a.signalCount || a.entityId.localeCompare(b.entityId));

  return candidates;
}

import {
  findDuplicateCandidates,
  findDuplicateCandidatesBatch,
  type BatchSubject,
  type MatchOptions,
} from "@magna-carta/directory/search";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { normalizeName } from "@magna-carta/directory/normalize-name";
import type { MatchEvidence, Strictness } from "./types.ts";

export interface MatchPartyInput {
  readonly kind: "person" | "organization";
  readonly given?: string;
  readonly family?: string;
  readonly legalName?: string;
  // The entity's full rendered display name (prefix + given + middle + family + suffix for a person,
  // the legal/display name for an organization). The exact-normalized-name probe must compare against
  // the corpus's stored normalized_display, which is derived from this full name — matching on
  // given + family alone silently mis-tiers any party carrying a middle name, prefix, or suffix.
  readonly displayName?: string;
  readonly identifiers?: ReadonlyArray<{ type: string; value: string }>;
  readonly excludeEntityId?: string;
  // The subject's own directory id, when it is an already-persisted entity. Drives the exact-identifier
  // (tier 1) channel: the subject's sealed SSN/EIN/DL/account are matched by blind-index equality against
  // every other entity, with no plaintext and no decrypt. Without it, tier 1 can never fire for a party —
  // a subject entered under a different name but the same SSN would be silently missed.
  readonly entityId?: string;
}

export interface CandidateMatch {
  readonly entityId: string;
  readonly evidence: MatchEvidence;
}

// Strictness selects which channels run and which name rows they see. It NEVER filters results by
// score — there is no score. over_inclusive restricts nothing, so its candidate set is a strict
// superset of balanced's by construction. That is the structural guarantee that raising strictness
// can only add hits, never hide one.
export function matchOptionsFor(strictness: Strictness): MatchOptions {
  if (strictness === "balanced") {
    return { schemes: ["double_metaphone_primary"], nameRoles: ["current"] };
  }
  return {};
}

function displayNameOf(input: MatchPartyInput): string {
  // Prefer the full rendered display name when the caller supplies it (the run-check path reads it off
  // the entity), so the exact-name probe compares against the same string the corpus normalized. The
  // given + family / legalName fallback is for callers that pass only name parts — corpus rows created
  // from those same parts normalize identically, so the fallback stays exact for that shape.
  if (input.displayName !== undefined && input.displayName.trim().length > 0) {
    return input.displayName.trim();
  }
  if (input.kind === "organization") return (input.legalName ?? "").trim();
  return [input.given ?? "", input.family ?? ""]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

// Tier 2 (exact normalized name) has no blocking channel of its own: the directory's channels are
// phonetic, trigram, and blind-index. Probe normalized_display directly for an exact match rather
// than adding a fourth channel to the shared corpus reader. Mirrors the same merge-resolution
// COALESCE and deleted-entity exclusion the directory channels apply in SQL — and the same name-role
// scoping: balanced passes nameRoles:["current"] so a former/alias exact match stays invisible at
// balanced strictness, exactly as the fuzzy channels do, keeping over_inclusive a clean superset.
async function exactNameMatches(
  context: DirectoryIdentifierContext,
  normalizedQuery: string,
  options: { readonly nameRoles?: readonly string[]; readonly excludeEntityId?: string },
): Promise<Set<string>> {
  if (normalizedQuery.length === 0) return new Set();
  const bindings: string[] = [normalizedQuery];
  let nameRoleFilter = "";
  const nameRoles = options.nameRoles;
  if (nameRoles !== undefined && nameRoles.length > 0) {
    const placeholders = nameRoles.map((role) => {
      bindings.push(role);
      return `?${bindings.length}`;
    });
    nameRoleFilter = `AND dn.name_role IN (${placeholders.join(", ")})`;
  }
  const { results } = await context.database
    .prepare(
      `SELECT DISTINCT COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id
       FROM directory_name AS dn
       LEFT JOIN directory_person AS dp ON dn.entity_kind = 'person' AND dp.id = dn.entity_id
       LEFT JOIN directory_organization AS do ON dn.entity_kind = 'organization' AND do.id = dn.entity_id
       WHERE dn.normalized_display = ?1
         AND dn.deleted_at IS NULL
         ${nameRoleFilter}
         AND (
           (dn.entity_kind = 'person' AND dp.deleted_at IS NULL)
           OR (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
         )`,
    )
    .bind(...bindings)
    .all<{ entity_id: string }>();
  const matches = new Set<string>();
  for (const row of results) {
    if (row.entity_id === options.excludeEntityId) continue;
    matches.add(row.entity_id);
  }
  return matches;
}

export async function matchParty(
  context: DirectoryIdentifierContext,
  input: MatchPartyInput,
  strictness: Strictness,
): Promise<CandidateMatch[]> {
  const normalizedQuery = normalizeName(displayNameOf(input));
  const matchOptions = matchOptionsFor(strictness);

  const [candidates, exactNames] = await Promise.all([
    findDuplicateCandidates(context, {
      kind: input.kind,
      given: input.given,
      family: input.family,
      legalName: input.legalName,
      identifiers: input.identifiers as never,
      excludeEntityId: input.excludeEntityId,
      subjectEntityId: input.entityId,
      matchOptions,
    }),
    exactNameMatches(context, normalizedQuery, {
      nameRoles: matchOptions.nameRoles,
      excludeEntityId: input.excludeEntityId,
    }),
  ]);

  const byEntityId = new Map<string, CandidateMatch>();
  for (const candidate of candidates) {
    byEntityId.set(candidate.entityId, {
      entityId: candidate.entityId,
      evidence: {
        identifierTypes: candidate.identifierTypes,
        exactNormalizedName: exactNames.has(candidate.entityId),
        phoneticMatch: candidate.channels.includes("phonetic"),
        trigramMatch: candidate.channels.includes("trigram"),
      },
    });
  }

  // Additive, never annotate-only: an exact normalized-name match must surface as a candidate even
  // when no blocking channel independently returned it. The only way the fuzzy channels miss an exact
  // match is the degenerate case of a sub-trigram-length name whose phonetic code is empty; dropping a
  // tier-2 signal there because it was not also fuzzy would suppress a real hit — the failure this
  // engine exists to prevent. Scoping already happened in exactNameMatches, so this stays a superset.
  for (const entityId of exactNames) {
    if (byEntityId.has(entityId)) continue;
    byEntityId.set(entityId, {
      entityId,
      evidence: {
        identifierTypes: [],
        exactNormalizedName: true,
        phoneticMatch: false,
        trigramMatch: false,
      },
    });
  }

  return [...byEntityId.values()];
}

// ── The set-valued matcher ────────────────────────────────────────────────────
//
// matchPartyBatch answers matchParty's question for a whole expanded set, running each blocking
// channel ONCE over the set instead of once per entity. At the shipped default — a handful of parties
// at one hop — the difference is a few dozen queries either way. At a five-hundred-entity closure the
// per-entity path is four queries times five hundred entities in one invocation, and no budget
// survives that; the query count here follows the number of CHANNELS instead, with a small fan for
// the platform's hundred-parameter bind cap.
//
// It must return exactly what the per-entity path returns, and that is not a stylistic preference: a
// performance change to a conflicts engine that alters which hits come back is not a refactor, it is
// a missed conflict, which is the one failure the whole subsystem exists to prevent. The equivalence
// is proved against a real corpus in test/matcher-equivalence.test.ts, not asserted here.

// D1 caps bound parameters at 100 per query, so the exact-name probe chunks its IN list. Mirrors
// MAX_BOUND_PARAMETERS in packages/ledger/src/statements.ts.
const MAX_MATCH_BOUND_PARAMETERS = 100;

// The tier-2 exact-name probe, set-valued: one query per chunk over every distinct normalized query
// in the set, projecting the matched normalized_display so each hit is attributed to the exact
// subjects that asked for it. Same merge-resolution COALESCE, same deleted-entity exclusion, same
// name-role scoping as the single-subject probe above — it is the same predicate with an IN in place
// of an equality.
async function exactNameMatchesBatch(
  context: DirectoryIdentifierContext,
  normalizedQueries: readonly string[],
  options: { readonly nameRoles?: readonly string[] },
): Promise<Map<string, Set<string>>> {
  const byQuery = new Map<string, Set<string>>();
  const queries = [...new Set(normalizedQueries)].filter((query) => query.length > 0).toSorted();
  for (let start = 0; start < queries.length; start += MAX_MATCH_BOUND_PARAMETERS) {
    const chunk = queries.slice(start, start + MAX_MATCH_BOUND_PARAMETERS);
    const bindings: string[] = [...chunk];
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    let nameRoleFilter = "";
    const nameRoles = options.nameRoles;
    if (nameRoles !== undefined && nameRoles.length > 0) {
      nameRoleFilter = `AND dn.name_role IN (${nameRoles
        .map((role) => {
          bindings.push(role);
          return `?${bindings.length}`;
        })
        .join(", ")})`;
    }
    const { results } = await context.database
      .prepare(
        `SELECT DISTINCT dn.normalized_display AS normalized_display,
                COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id
         FROM directory_name AS dn
         LEFT JOIN directory_person AS dp ON dn.entity_kind = 'person' AND dp.id = dn.entity_id
         LEFT JOIN directory_organization AS do ON dn.entity_kind = 'organization' AND do.id = dn.entity_id
         WHERE dn.normalized_display IN (${placeholders})
           AND dn.deleted_at IS NULL
           ${nameRoleFilter}
           AND (
             (dn.entity_kind = 'person' AND dp.deleted_at IS NULL)
             OR (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
           )`,
      )
      .bind(...bindings)
      .all<{ normalized_display: string; entity_id: string }>();
    for (const row of results) {
      const entities = byQuery.get(row.normalized_display) ?? new Set<string>();
      entities.add(row.entity_id);
      byQuery.set(row.normalized_display, entities);
    }
  }
  return byQuery;
}

// The candidates for every input, keyed by the input's own `entityId`. The batch path is for already
// persisted subjects — the expanded set is entity ids by construction — so an input with no
// `entityId` has no key to be returned under and is refused rather than silently dropped.
export async function matchPartyBatch(
  context: DirectoryIdentifierContext,
  inputs: readonly MatchPartyInput[],
  strictness: Strictness,
): Promise<Map<string, CandidateMatch[]>> {
  const matchOptions = matchOptionsFor(strictness);
  const results = new Map<string, CandidateMatch[]>();

  const prepared = inputs.map((input) => {
    const entityId = input.entityId;
    if (entityId === undefined) {
      throw new Error("matchPartyBatch: every input must carry its own entityId");
    }
    if (input.identifiers !== undefined && input.identifiers.length > 0) {
      // The batch drives the identifier channel from each subject's PERSISTED sealed identifiers,
      // which is the only shape a conflicts check ever has. Accepting plaintext identifiers here and
      // quietly not probing them would drop the strongest evidence the engine can produce, so it is
      // refused loudly instead.
      throw new Error(
        "matchPartyBatch: plaintext identifiers are not probed here — use matchParty for an unpersisted subject",
      );
    }
    return { input, entityId, normalizedQuery: normalizeName(displayNameOf(input)) };
  });
  for (const entry of prepared) results.set(entry.entityId, []);
  if (prepared.length === 0) return results;

  const subjects: BatchSubject[] = prepared.map((entry) => ({
    key: entry.entityId,
    kind: entry.input.kind,
    given: entry.input.given,
    family: entry.input.family,
    legalName: entry.input.legalName,
    subjectEntityId: entry.input.entityId,
    excludeEntityId: entry.input.excludeEntityId,
  }));

  const [candidatesBySubject, exactNamesByQuery] = await Promise.all([
    findDuplicateCandidatesBatch(context, subjects, matchOptions),
    exactNameMatchesBatch(
      context,
      prepared.map((entry) => entry.normalizedQuery),
      { nameRoles: matchOptions.nameRoles },
    ),
  ]);

  for (const entry of prepared) {
    const exactNames = new Set(exactNamesByQuery.get(entry.normalizedQuery) ?? []);
    // The single-subject probe applies excludeEntityId inside the query's result loop; the batch
    // shares one query across subjects, so the same exclusion is applied per subject here.
    const excluded = entry.input.excludeEntityId;
    if (excluded !== undefined) exactNames.delete(excluded);

    const byEntityId = new Map<string, CandidateMatch>();
    for (const candidate of candidatesBySubject.get(entry.entityId) ?? []) {
      byEntityId.set(candidate.entityId, {
        entityId: candidate.entityId,
        evidence: {
          identifierTypes: candidate.identifierTypes,
          exactNormalizedName: exactNames.has(candidate.entityId),
          phoneticMatch: candidate.channels.includes("phonetic"),
          trigramMatch: candidate.channels.includes("trigram"),
        },
      });
    }
    for (const entityId of exactNames) {
      if (byEntityId.has(entityId)) continue;
      byEntityId.set(entityId, {
        entityId,
        evidence: {
          identifierTypes: [],
          exactNormalizedName: true,
          phoneticMatch: false,
          trigramMatch: false,
        },
      });
    }
    results.set(entry.entityId, [...byEntityId.values()]);
  }

  return results;
}

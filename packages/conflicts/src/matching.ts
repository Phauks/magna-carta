import { findDuplicateCandidates, type MatchOptions } from "@magna-carta/directory/search";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { normalizeName } from "@magna-carta/directory/normalize-name";
import type { MatchEvidence, Strictness } from "./types.ts";

export interface MatchPartyInput {
  readonly kind: "person" | "organization";
  readonly given?: string;
  readonly family?: string;
  readonly legalName?: string;
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
  if (input.kind === "organization") return (input.legalName ?? "").trim();
  return [input.given ?? "", input.family ?? ""]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

// Tier 2 (exact normalized name) has no blocking channel of its own: the directory's channels are
// phonetic, trigram, and blind-index. Probe normalized_display directly for an exact match rather
// than adding a fourth channel to the shared corpus reader. Mirrors the same merge-resolution
// COALESCE and deleted-entity exclusion the directory channels apply in SQL.
async function exactNameMatches(
  context: DirectoryIdentifierContext,
  normalizedQuery: string,
): Promise<Set<string>> {
  if (normalizedQuery.length === 0) return new Set();
  const { results } = await context.database
    .prepare(
      `SELECT DISTINCT COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id
       FROM directory_name AS dn
       LEFT JOIN directory_person AS dp ON dn.entity_kind = 'person' AND dp.id = dn.entity_id
       LEFT JOIN directory_organization AS do ON dn.entity_kind = 'organization' AND do.id = dn.entity_id
       WHERE dn.normalized_display = ?1
         AND dn.deleted_at IS NULL
         AND (
           (dn.entity_kind = 'person' AND dp.deleted_at IS NULL)
           OR (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
         )`,
    )
    .bind(normalizedQuery)
    .all<{ entity_id: string }>();
  return new Set(results.map((row) => row.entity_id));
}

export async function matchParty(
  context: DirectoryIdentifierContext,
  input: MatchPartyInput,
  strictness: Strictness,
): Promise<CandidateMatch[]> {
  const normalizedQuery = normalizeName(displayNameOf(input));

  const [candidates, exactNames] = await Promise.all([
    findDuplicateCandidates(context, {
      kind: input.kind,
      given: input.given,
      family: input.family,
      legalName: input.legalName,
      identifiers: input.identifiers as never,
      excludeEntityId: input.excludeEntityId,
      subjectEntityId: input.entityId,
      matchOptions: matchOptionsFor(strictness),
    }),
    exactNameMatches(context, normalizedQuery),
  ]);

  return candidates.map((candidate) => ({
    entityId: candidate.entityId,
    evidence: {
      identifierTypes: candidate.identifierTypes,
      exactNormalizedName: exactNames.has(candidate.entityId),
      phoneticMatch: candidate.channels.includes("phonetic"),
      trigramMatch: candidate.channels.includes("trigram"),
    },
  }));
}

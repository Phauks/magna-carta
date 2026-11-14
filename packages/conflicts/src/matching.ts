import {
  findDuplicateCandidates,
  findDuplicateCandidatesBatch,
  type BatchSubject,
  type MatchOptions,
} from "@magna-carta/directory/search";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { normalizedMatchKey, normalizedMatchKeyBare } from "@magna-carta/directory/match-key";
import { normalizeName } from "@magna-carta/directory/normalize-name";
import { DEFAULT_BALANCED_NAME_ROLES } from "./settings.ts";
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

// The parts of a run's resolved scope the matcher needs. Passed rather than read here, because the
// name-role set is a firm SETTING recorded verbatim on the check row: a matcher that reached for the
// policy itself could compare against a set the row does not name.
export interface MatchDepth {
  // The name roles the balanced band compares against. Omitted means the shipped default, which is
  // what a caller with no resolved scope in hand (a test, an entry-time probe) should get. `null`
  // means every role and is what the over-inclusive band always resolves to.
  readonly nameRoles?: readonly string[] | null;
  // False skips the trigram channel at the balanced band, as a person chose for the check. Omitted
  // means it runs. The over-inclusive band ignores it and always runs every channel.
  readonly trigramMatching?: boolean;
}

// Strictness selects which channels run and which name rows they see. It NEVER filters results by
// score — there is no score. over_inclusive restricts nothing, so its candidate set is a strict
// superset of balanced's by construction. That is the structural guarantee that raising strictness
// can only add hits, never hide one — and it survives the name roles becoming configurable, because
// over_inclusive is the one band a firm cannot narrow: whatever set is configured for balanced, it is
// a subset of every role.
export function matchOptionsFor(strictness: Strictness, depth: MatchDepth = {}): MatchOptions {
  if (strictness === "balanced") {
    const nameRoles = depth.nameRoles === undefined ? DEFAULT_BALANCED_NAME_ROLES : depth.nameRoles;
    return {
      schemes: ["double_metaphone_primary"],
      ...(nameRoles === null ? {} : { nameRoles }),
      ...(depth.trigramMatching === false ? { trigram: false } : {}),
    };
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

// ── The name-key probes ───────────────────────────────────────────────────────
//
// Three of this engine's comparisons have no blocking channel of their own, because the directory's
// shared corpus reader offers exactly three — phonetic, trigram, blind-index — and widening it would
// change what entry-time duplicate detection and merge see. They are probed here instead, against
// `directory_name` directly, and they are all the same query with a different key column:
//
//   normalized_display        exact name, tier 2   — the shipped probe
//   normalized_match_key      same name spelled two ways, tier 2
//   normalized_match_key_bare same name, different legal form, tier 3
//
// One implementation rather than three, so the merge-resolution COALESCE, the deleted-entity
// exclusion, and the name-role scoping cannot come to differ between them — and so the single-subject
// and set-valued matchers below run the SAME predicate rather than two that are meant to agree.
type NameKeyColumn = "normalized_display" | "normalized_match_key" | "normalized_match_key_bare";

// D1 caps bound parameters at 100 per query, so the key probes chunk their IN list. Mirrors
// MAX_BOUND_PARAMETERS in packages/ledger/src/statements.ts.
const MAX_MATCH_BOUND_PARAMETERS = 100;

function chunked<T>(values: readonly T[], size = MAX_MATCH_BOUND_PARAMETERS): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }
  return chunks;
}

// The matched key comes back with each row, so a query shared across many subjects still attributes
// every hit to exactly the subjects that asked for it — the same trick the phonetic channel uses with
// its code. Returns key -> resolved entity ids.
async function nameKeyMatches(
  context: DirectoryIdentifierContext,
  column: NameKeyColumn,
  keys: readonly string[],
  options: { readonly nameRoles?: readonly string[] },
): Promise<Map<string, Set<string>>> {
  const byKey = new Map<string, Set<string>>();
  const wanted = [...new Set(keys)].filter((key) => key.length > 0).toSorted();
  for (const chunk of chunked(wanted)) {
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
        `SELECT DISTINCT dn.${column} AS match_key,
                COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id
         FROM directory_name AS dn
         LEFT JOIN directory_person AS dp ON dn.entity_kind = 'person' AND dp.id = dn.entity_id
         LEFT JOIN directory_organization AS do ON dn.entity_kind = 'organization' AND do.id = dn.entity_id
         WHERE dn.${column} IN (${placeholders})
           AND dn.deleted_at IS NULL
           ${nameRoleFilter}
           AND (
             (dn.entity_kind = 'person' AND dp.deleted_at IS NULL)
             OR (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
           )`,
      )
      .bind(...bindings)
      .all<{ match_key: string; entity_id: string }>();
    for (const row of results) {
      const entities = byKey.get(row.match_key) ?? new Set<string>();
      entities.add(row.entity_id);
      byKey.set(row.match_key, entities);
    }
  }
  return byKey;
}

// Everything one subject asks the name-key probes for. Computed the same way on both matcher paths,
// from one function, so a subject cannot be asked a different question depending on which matcher
// happened to run.
interface SubjectKeys {
  readonly normalizedDisplay: string;
  readonly matchKey: string;
  readonly bareMatchKey: string;
}

function subjectKeysOf(input: MatchPartyInput): SubjectKeys {
  const displayName = displayNameOf(input);
  return {
    normalizedDisplay: normalizeName(displayName),
    matchKey: normalizedMatchKey(displayName),
    bareMatchKey: normalizedMatchKeyBare(displayName),
  };
}

// Fold one subject's probe answers into the evidence map, additively. Every one of these channels is
// ADDITIVE rather than annotate-only: a match key equality must surface a candidate even when no
// fuzzy channel independently returned it, because the fuzzy channels can miss an exact agreement —
// a sub-trigram-length name has no trigrams, and a name whose phonetic code is empty blocks on
// nothing — and dropping a tier-2 signal because it was not ALSO fuzzy would suppress a real hit,
// which is the failure this engine exists to prevent.
function foldKeyEvidence(
  into: Map<string, MutableEvidence>,
  entityIds: Iterable<string>,
  apply: (evidence: MutableEvidence) => void,
  excludeEntityId: string | undefined,
): void {
  for (const entityId of entityIds) {
    if (entityId === excludeEntityId) continue;
    let evidence = into.get(entityId);
    if (evidence === undefined) {
      evidence = {
        identifierTypes: [],
        exactNormalizedName: false,
        matchKeyName: false,
        bareMatchKeyName: false,
        phoneticMatch: false,
        trigramMatch: false,
      };
      into.set(entityId, evidence);
    }
    apply(evidence);
  }
}

interface MutableEvidence {
  identifierTypes: readonly string[];
  exactNormalizedName: boolean;
  matchKeyName: boolean;
  bareMatchKeyName: boolean;
  phoneticMatch: boolean;
  trigramMatch: boolean;
}

export async function matchParty(
  context: DirectoryIdentifierContext,
  input: MatchPartyInput,
  strictness: Strictness,
  depth: MatchDepth = {},
): Promise<CandidateMatch[]> {
  const matchOptions = matchOptionsFor(strictness, depth);
  const keys = subjectKeysOf(input);
  const keyOptions = { nameRoles: matchOptions.nameRoles };

  const [candidates, exactNames, matchKeys, bareMatchKeys] = await Promise.all([
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
    nameKeyMatches(context, "normalized_display", [keys.normalizedDisplay], keyOptions),
    nameKeyMatches(context, "normalized_match_key", [keys.matchKey], keyOptions),
    nameKeyMatches(context, "normalized_match_key_bare", [keys.bareMatchKey], keyOptions),
  ]);

  const byEntityId = new Map<string, MutableEvidence>();
  for (const candidate of candidates) {
    byEntityId.set(candidate.entityId, {
      identifierTypes: candidate.identifierTypes,
      exactNormalizedName: false,
      matchKeyName: false,
      bareMatchKeyName: false,
      phoneticMatch: candidate.channels.includes("phonetic"),
      trigramMatch: candidate.channels.includes("trigram"),
    });
  }

  const exclude = input.excludeEntityId;
  foldKeyEvidence(
    byEntityId,
    exactNames.get(keys.normalizedDisplay) ?? [],
    (evidence) => (evidence.exactNormalizedName = true),
    exclude,
  );
  foldKeyEvidence(
    byEntityId,
    matchKeys.get(keys.matchKey) ?? [],
    (evidence) => (evidence.matchKeyName = true),
    exclude,
  );
  foldKeyEvidence(
    byEntityId,
    bareMatchKeys.get(keys.bareMatchKey) ?? [],
    (evidence) => (evidence.bareMatchKeyName = true),
    exclude,
  );
  return [...byEntityId.entries()].map(([entityId, evidence]) => ({
    entityId,
    evidence: evidence satisfies MatchEvidence,
  }));
}

// ── The set-valued matcher ────────────────────────────────────────────────────
//
// matchPartyBatch answers matchParty's question for a whole expanded set, running each blocking
// channel ONCE over the set instead of once per entity. At the shipped default — a handful of parties
// at one hop — the difference is a few dozen queries either way. At a five-hundred-entity closure the
// per-entity path is a query per channel times five hundred entities in one invocation, and no budget
// survives that; the query count here follows the number of CHANNELS instead, with a small fan for
// the platform's hundred-parameter bind cap.
//
// It must return exactly what the per-entity path returns, and that is not a stylistic preference: a
// performance change to a conflicts engine that alters which hits come back is not a refactor, it is
// a missed conflict, which is the one failure the whole subsystem exists to prevent. The two share
// their probe implementations above for that reason — the equivalence is structural first and proved
// against a real corpus in test/matcher-equivalence.test.ts second.

export async function matchPartyBatch(
  context: DirectoryIdentifierContext,
  inputs: readonly MatchPartyInput[],
  strictness: Strictness,
  depth: MatchDepth = {},
): Promise<Map<string, CandidateMatch[]>> {
  const matchOptions = matchOptionsFor(strictness, depth);
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
    return { input, entityId, keys: subjectKeysOf(input) };
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
  const keyOptions = { nameRoles: matchOptions.nameRoles };

  const [candidatesBySubject, exactNames, matchKeys, bareMatchKeys] = await Promise.all([
    findDuplicateCandidatesBatch(context, subjects, matchOptions),
    nameKeyMatches(
      context,
      "normalized_display",
      prepared.map((entry) => entry.keys.normalizedDisplay),
      keyOptions,
    ),
    nameKeyMatches(
      context,
      "normalized_match_key",
      prepared.map((entry) => entry.keys.matchKey),
      keyOptions,
    ),
    nameKeyMatches(
      context,
      "normalized_match_key_bare",
      prepared.map((entry) => entry.keys.bareMatchKey),
      keyOptions,
    ),
  ]);

  for (const entry of prepared) {
    const byEntityId = new Map<string, MutableEvidence>();
    for (const candidate of candidatesBySubject.get(entry.entityId) ?? []) {
      byEntityId.set(candidate.entityId, {
        identifierTypes: candidate.identifierTypes,
        exactNormalizedName: false,
        matchKeyName: false,
        bareMatchKeyName: false,
        phoneticMatch: candidate.channels.includes("phonetic"),
        trigramMatch: candidate.channels.includes("trigram"),
      });
    }

    // The single-subject probe applies excludeEntityId inside the query's result loop; the batch
    // shares one query across subjects, so the same exclusion is applied per subject here.
    const exclude = entry.input.excludeEntityId;
    foldKeyEvidence(
      byEntityId,
      exactNames.get(entry.keys.normalizedDisplay) ?? [],
      (evidence) => (evidence.exactNormalizedName = true),
      exclude,
    );
    foldKeyEvidence(
      byEntityId,
      matchKeys.get(entry.keys.matchKey) ?? [],
      (evidence) => (evidence.matchKeyName = true),
      exclude,
    );
    foldKeyEvidence(
      byEntityId,
      bareMatchKeys.get(entry.keys.bareMatchKey) ?? [],
      (evidence) => (evidence.bareMatchKeyName = true),
      exclude,
    );
    results.set(
      entry.entityId,
      [...byEntityId.entries()].map(([entityId, evidence]) => ({
        entityId,
        evidence: evidence satisfies MatchEvidence,
      })),
    );
  }

  return results;
}

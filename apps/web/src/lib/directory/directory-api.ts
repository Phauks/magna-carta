/*
 * The directory's response shapes and calls — the firm's book of people and organizations.
 *
 * Mirrors the directory operations in apps/api-worker/openapi/openapi.json; the transport envelope
 * itself lives in $lib/api/request.ts, and every call resolves rather than throws.
 *
 * WHAT THE CONTRACT ANSWERS, AND WHAT IT DOES NOT. Four of this surface's sections are written
 * against reads that do not exist yet, and a screen that guessed at them would be inventing the
 * firm's record. Stated here so a caller never goes looking:
 *
 *   - There is no listing. `searchDirectory` is the only way to reach an entity, and it needs at
 *     least three characters of a name. The directory is searched, never browsed.
 *   - A name history can be APPENDED and cannot be READ. `directory_name` holds every name an
 *     entity has ever held; the contract exposes only the current one, denormalized onto the
 *     entity row.
 *   - Relationship edges, categories, category assignments and an entity's own matter roles are
 *     all write-only in the same way. `listMatterParties` answers for one MATTER, never for one
 *     entity.
 *   - An entity's identifiers cannot be enumerated. A value is asked for one type at a time, and
 *     asking is a decrypt: permission-gated and written to the firm's audit log before any
 *     plaintext exists. That is why nothing here reads them eagerly.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** The two node kinds in the directory graph. A handle's prefix is what tells them apart. */
export type DirectoryEntityKind = "person" | "organization";

/** The permission every directory write names. A member without it is refused server-side. */
export const DIRECTORY_EDIT_PERMISSION = "directory:edit";

/** The permission a sensitive identifier's decrypt names. The read is also audited. */
export const VIEW_SENSITIVE_IDENTIFIERS_PERMISSION = "directory:viewSensitiveIdentifiers";

/**
 * Which side of the directory a handle names, read from its own prefix. Returns null for anything
 * else, so a hand-typed address lands on an honest refusal rather than a request that cannot mean
 * anything.
 */
export function entityKindFromIdentifier(identifier: string): DirectoryEntityKind | null {
  if (identifier.startsWith("directoryPerson_")) return "person";
  if (identifier.startsWith("directoryOrganization_")) return "organization";
  return null;
}

/** Which verb form a pronoun set takes. Recorded, never worked out from the forms themselves. */
export type PronounVerbNumber = "singular" | "plural";

/**
 * The complete set of pronouns a person stated, or null where they stated none.
 *
 * Whole or not at all: the contract refuses a partly supplied set, because a document rendering one
 * set's pronoun in one clause and another's in the next is wrong in a way nobody catches by reading
 * it. Nothing anywhere derives these from a name, a courtesy title, or any other field.
 */
export interface PronounSet {
  subject: string;
  object: string;
  possessiveDeterminer: string;
  possessivePronoun: string;
  reflexive: string;
  verbNumber: PronounVerbNumber;
}

/** One person as the directory holds them, with the CURRENT name's parts on the row. */
export interface DirectoryPersonDetail {
  id: string;
  prefix: string | null;
  given: string | null;
  middle: string | null;
  family: string | null;
  suffix: string | null;
  displayName: string | null;
  status: string;
  /** The surviving record this one was folded into, or null while it stands on its own. */
  mergedIntoId: string | null;
  pronouns: PronounSet | null;
}

/** One organization as the directory holds it. */
export interface DirectoryOrganizationDetail {
  id: string;
  legalName: string | null;
  displayName: string | null;
  status: string;
  mergedIntoId: string | null;
}

/** Either node kind, discriminated so a screen can carry one value through its sections. */
export type DirectoryEntityDetail =
  | { kind: "person"; person: DirectoryPersonDetail }
  | { kind: "organization"; organization: DirectoryOrganizationDetail };

/** One hit from the firm's own ranked search. */
export interface DirectorySearchHit {
  entityId: string;
  entityKind: string;
  displayName: string;
  /** The raw ranking score. Ordering is the server's; nothing on screen prints this number. */
  relevance: number;
}

export interface DirectorySearchResult {
  data: DirectorySearchHit[];
  /** True when the firm holds more matches than were returned — a short answer, not a complete one. */
  capped: boolean;
}

/** The role a name row plays for an entity. The current one is one of these, and so is every alias. */
export type DirectoryNameRole = "current" | "former" | "alias" | "aka" | "maiden" | "dba";

/** The kind of a sealed identifier the firm holds for an entity. */
export type DirectoryIdentifierType =
  | "ssn"
  | "ein"
  | "dob"
  | "account"
  | "drivers_license"
  | "ssn_last_four"
  | "bar_number";

/** The typed relationship an edge records between two entities. */
export type DirectoryEdgeType =
  | "affiliation"
  | "relationship"
  | "corporate_parent"
  | "corporate_subsidiary"
  | "corporate_successor"
  | "representation"
  | "role_assignment";

/** One entity the firm may already hold under another spelling. */
export interface DuplicateCandidate {
  entityId: string;
  /** How many of the three blocking channels matched. Recall, never a score. */
  signalCount: number;
}

// ---- reads -----------------------------------------------------------------------------------

/**
 * The firm's ranked name search — the only way into the directory.
 *
 * Trigram matching over every name row the firm holds, current and former alike, tolerant of a
 * typo. Merged-away records are excluded from the hits and still resolve through their survivor.
 */
export function searchDirectory(
  fetchImpl: typeof fetch,
  query: string,
): Promise<ApiOutcome<DirectorySearchResult>> {
  const search = new URLSearchParams({ q: query });
  return requestJson(fetchImpl, `/api/v1/directory/search?${search.toString()}`);
}

export function readDirectoryPerson(
  fetchImpl: typeof fetch,
  entityId: string,
): Promise<ApiOutcome<DirectoryPersonDetail>> {
  return requestJson(fetchImpl, `/api/v1/directory/persons/${encodeURIComponent(entityId)}`);
}

export function readDirectoryOrganization(
  fetchImpl: typeof fetch,
  entityId: string,
): Promise<ApiOutcome<DirectoryOrganizationDetail>> {
  return requestJson(fetchImpl, `/api/v1/directory/organizations/${encodeURIComponent(entityId)}`);
}

/** Either kind, resolved from the handle's own prefix so one call serves both sections. */
export async function readDirectoryEntity(
  fetchImpl: typeof fetch,
  entityId: string,
): Promise<ApiOutcome<DirectoryEntityDetail>> {
  const kind = entityKindFromIdentifier(entityId);
  if (kind === "person") {
    const outcome = await readDirectoryPerson(fetchImpl, entityId);
    return outcome.kind === "ok"
      ? { kind: "ok", value: { kind: "person", person: outcome.value } }
      : outcome;
  }
  const outcome = await readDirectoryOrganization(fetchImpl, entityId);
  return outcome.kind === "ok"
    ? { kind: "ok", value: { kind: "organization", organization: outcome.value } }
    : outcome;
}

/**
 * One sealed identifier, decrypted.
 *
 * This is the product's single decrypt path and it is not free: the firm's audit log records who
 * asked, for which entity, and when, before any plaintext exists. A null value means the entity
 * holds none of that type — asking for one it does not hold reveals nothing and records nothing.
 */
export function readDirectoryIdentifier(
  fetchImpl: typeof fetch,
  entityId: string,
  type: DirectoryIdentifierType,
): Promise<ApiOutcome<{ value: string | null }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/identifiers/${encodeURIComponent(type)}`,
  );
}

/**
 * The entities the firm may already hold under another spelling.
 *
 * Three blocking channels unioned — how the name sounds, how it is spelled, and exact equality on a
 * sealed identifier's blind index — ranked by how many of them matched. It answers identifiers and
 * nothing else, so a caller resolves each one to a name of its own.
 */
export function findDuplicateCandidates(
  fetchImpl: typeof fetch,
  request: {
    kind: DirectoryEntityKind;
    given?: string;
    family?: string;
    legalName?: string;
    excludeEntityId?: string;
  },
): Promise<ApiOutcome<{ data: DuplicateCandidate[] }>> {
  return requestJson(fetchImpl, "/api/v1/directory/duplicate-candidates", {
    method: "POST",
    body: request,
  });
}

// ---- writes ----------------------------------------------------------------------------------

export function createDirectoryPerson(
  fetchImpl: typeof fetch,
  request: {
    given: string;
    family: string;
    prefix?: string | null;
    middle?: string | null;
    suffix?: string | null;
  },
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/directory/persons", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export function createDirectoryOrganization(
  fetchImpl: typeof fetch,
  request: { legalName: string; displayName?: string | null },
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/directory/organizations", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/**
 * Records the pronouns a person stated, or clears the set on file by sending null.
 *
 * Every form travels together. The screen never sends a half-filled set, and the contract would
 * refuse one if it did.
 */
export function setDirectoryPersonPronouns(
  fetchImpl: typeof fetch,
  entityId: string,
  pronouns: PronounSet | null,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: boolean }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/persons/${encodeURIComponent(entityId)}/pronouns`,
    { method: "PUT", body: { pronouns }, idempotencyKey },
  );
}

/**
 * Appends a name an entity also goes by, without touching the name it currently carries.
 *
 * A name change is not this call: the current name is replaced through the entity's own edit path,
 * which flips the old row to former. This one records the maiden name on a decades-old file, the
 * trading name an organization also answers to, the spelling a court used.
 */
export function addDirectoryName(
  fetchImpl: typeof fetch,
  entityId: string,
  request: {
    nameRole: DirectoryNameRole;
    given?: string;
    family?: string;
    prefix?: string | null;
    middle?: string | null;
    suffix?: string | null;
    legalName?: string;
    displayName?: string | null;
  },
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: boolean }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/names`,
    {
      method: "POST",
      body: request,
      idempotencyKey,
    },
  );
}

/** Seals a typed identifier under the firm key. Only the ciphertext and its index are ever stored. */
export function addDirectoryIdentifier(
  fetchImpl: typeof fetch,
  entityId: string,
  request: { type: DirectoryIdentifierType; value: string },
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: boolean }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/identifiers`,
    { method: "POST", body: request, idempotencyKey },
  );
}

/**
 * Folds a duplicate into the surviving record.
 *
 * Non-destructive in the record's sense: the folded record is archived rather than removed, its
 * names stay in the search and conflicts corpus and resolve to the survivor, and every inbound
 * reference is repointed. It is irreversible in the SCREEN's sense — nothing in the product undoes
 * it — which is the sentence the confirmation has to carry.
 *
 * `survivorship` names the node columns the survivor should take from the folded record. A column
 * left out keeps the survivor's own value.
 */
export function mergeDirectoryEntities(
  fetchImpl: typeof fetch,
  request: {
    masterId: string;
    subordinateId: string;
    survivorship: Record<string, "subordinate">;
  },
  idempotencyKey: string,
): Promise<ApiOutcome<{ mergeId: string }>> {
  return requestJson(fetchImpl, "/api/v1/directory/merges", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

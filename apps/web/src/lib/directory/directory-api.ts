/*
 * The directory's response shapes and calls — the firm's book of people and organizations.
 *
 * Mirrors the directory operations in apps/api-worker/openapi/openapi.json; the transport envelope
 * itself lives in $lib/api/request.ts, and every call resolves rather than throws.
 *
 * WHAT THE CONTRACT ANSWERS, AND WHAT IT DOES NOT. Stated here so a caller never goes looking:
 *
 *   - There is no listing. `searchDirectory` is the only way to reach an entity, and it needs at
 *     least three characters of a name. The directory is searched, never browsed.
 *   - Reading an identifier's VALUE is a decrypt: permission-gated and written to the firm's audit
 *     log before any plaintext exists. That is why nothing here reads one eagerly, and why
 *     `readDirectoryIdentifierRecords` — which says what the firm holds without saying what any of
 *     it is — is the read a screen draws its headings from.
 *   - An organization's former names survive only in the case-folded form the corpus indexes, so a
 *     name history entry for one carries a null `displayName` and the caller falls back to
 *     `normalizedDisplay`. That is an honest lowercase former name rather than an invented
 *     capitalization.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

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
  /**
   * WHICH of the entity's names the query landed on — the whole reason the firm keeps every name an
   * entity has held. A hit that reported only the current name looked identical whether it matched
   * a maiden name or the name typed, so a reader could not tell that the file they wanted is filed
   * under a name they did not know.
   */
  matchedName: string;
  /** What that matched name is to the entity — current, former, maiden, dba. */
  matchedNameRole: string;
  matchedNameIsCurrent: boolean;
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
  /** Which side of the directory it is. "unknown" where the node tables no longer hold it. */
  entityKind: DirectoryEntityKind | "unknown";
  /** What to call it, or null where the directory holds no name — the screen shows the gap. */
  displayName: string | null;
}

/** One name an entity has held — the shape the history rail reads. */
export interface DirectoryNameEntry {
  id: string;
  nameRole: string;
  /** True for the one name the entity answers to today. */
  isCurrent: boolean;
  prefix: string | null;
  given: string | null;
  middle: string | null;
  family: string | null;
  suffix: string | null;
  /** The name as recorded. Null for an organization — fall back to `normalizedDisplay`. */
  displayName: string | null;
  /** The case-folded form the search and conflicts corpus matches on. Always present. */
  normalizedDisplay: string;
  validFrom: string | null;
  /** When the name stopped being used, or null while it still is. */
  validTo: string | null;
  /** When the firm wrote the row down — which is not when the name came into use. */
  recordedAt: string;
}

/** The display identity of one entity: who it is on a row, and nothing about what it holds. */
export interface DirectoryEntityName {
  entityId: string;
  entityKind: DirectoryEntityKind;
  displayName: string | null;
  mergedIntoId: string | null;
}

/** One relationship touching an entity, read from that entity's end. */
export interface DirectoryEdgeEntry {
  id: string;
  edgeType: string;
  /** Which end this entity is on. "parent of" and "subsidiary of" are one row read two ways. */
  direction: "outbound" | "inbound";
  farEntityId: string;
  farEntityKind: DirectoryEntityKind | "unknown";
  farDisplayName: string | null;
  role: string | null;
  note: string | null;
  validFrom: string | null;
  validTo: string | null;
}

/** One matter an entity is a party to, and what it is on it. */
export interface DirectoryEntityMatterParty {
  id: string;
  matterId: string;
  role: string;
  capacity: string | null;
  matterTitle: string | null;
  matterNumber: string | null;
  matterStatus: string | null;
  linkedAt: string;
}

/** One label the firm files entities under. */
export interface DirectoryCategory {
  id: string;
  name: string;
  appliesTo: DirectoryEntityKind | "both";
  position: number;
  /** True for a label the firm has retired. Still returned — an entity carrying one must show it. */
  archived: boolean;
}

/**
 * One sealed identifier the firm holds, DESCRIBED and never disclosed.
 *
 * There is no value on this shape and none belongs on it: reading a value is the separate,
 * permission-gated, audited call. A record that decrypted merely to draw its list of headings would
 * put a plaintext social security number into the firm's audit log every time a page rendered.
 */
export interface DirectoryIdentifierRecord {
  id: string;
  type: DirectoryIdentifierType;
  validFrom: string | null;
  validTo: string | null;
  recordedAt: string;
}

/** How many entities one naming call may ask about. Beyond it the read refuses rather than truncates. */
export const MAX_ENTITY_NAME_LOOKUP = 100;

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

/**
 * Names many entities in one request — the read a page of rows needs.
 *
 * Display identity only: the id, which side of the directory it is, what to call it, and whether it
 * has been folded into another record. Nothing here touches an identifier, so it cannot decrypt, and
 * nothing joins a contact row, so a list of names cannot become a mailing list. That is what makes
 * it cheap enough to call for every row on screen.
 *
 * At most `MAX_ENTITY_NAME_LOOKUP` handles per call — beyond it the read REFUSES rather than
 * truncating, because a short answer to a long question would blank the wrong rows.
 */
export function readDirectoryEntityNames(
  fetchImpl: typeof fetch,
  entityIds: readonly string[],
): Promise<ApiOutcome<{ data: DirectoryEntityName[] }>> {
  const search = new URLSearchParams({ ids: entityIds.join(",") });
  return requestJson(fetchImpl, `/api/v1/directory/entity-names?${search.toString()}`);
}

/**
 * Every name an entity has held, newest recorded first.
 *
 * The current name heads the page, and the rest read backwards through the marriages, the deed polls
 * and the trading names. Ordered by when the firm wrote each row rather than by when the name came
 * into use, so a maiden name recorded onto a decades-old file does not sort to the bottom.
 */
export function readDirectoryNames(
  fetchImpl: typeof fetch,
  entityId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<DirectoryNameEntry>>> {
  const search = new URLSearchParams(cursor === undefined ? {} : { cursor });
  const query = search.toString();
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/names${query === "" ? "" : `?${query}`}`,
  );
}

/** The relationships touching an entity, both directions, each naming the far end. */
export function readDirectoryEdges(
  fetchImpl: typeof fetch,
  entityId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<DirectoryEdgeEntry>>> {
  const search = new URLSearchParams(cursor === undefined ? {} : { cursor });
  const query = search.toString();
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/edges${query === "" ? "" : `?${query}`}`,
  );
}

/** The matters this entity is a party to — the mirror of the read that answers for one matter. */
export function readDirectoryEntityMatterParties(
  fetchImpl: typeof fetch,
  entityId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<DirectoryEntityMatterParty>>> {
  const search = new URLSearchParams(cursor === undefined ? {} : { cursor });
  const query = search.toString();
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/matter-parties${query === "" ? "" : `?${query}`}`,
  );
}

/** The firm's whole category vocabulary, retired labels included and flagged. */
export function readDirectoryCategories(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: DirectoryCategory[] }>> {
  return requestJson(fetchImpl, "/api/v1/directory/categories");
}

/** The categories one entity carries. */
export function readDirectoryEntityCategories(
  fetchImpl: typeof fetch,
  entityId: string,
): Promise<ApiOutcome<{ data: DirectoryCategory[] }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/categories`,
  );
}

/**
 * WHICH sealed identifiers the firm holds for an entity — never what any of them is.
 *
 * No decrypt, no permission beyond the session, no audit row. It is what lets a record show that a
 * social security number is on file without anybody reading it, which is the distinction the whole
 * identifier surface turns on.
 */
export function readDirectoryIdentifierRecords(
  fetchImpl: typeof fetch,
  entityId: string,
): Promise<ApiOutcome<{ data: DirectoryIdentifierRecord[] }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/identifiers`,
  );
}

// ---- writes ----------------------------------------------------------------------------------

/**
 * Changes the name an entity currently answers to — a marriage, a deed poll, an organization's
 * rename.
 *
 * The name on file is not overwritten. It is retained as a former name, kept in the search and
 * conflicts corpus with its phonetic codes intact and stamped with the date it stopped being used,
 * which is what keeps a twenty-year-old file tied to the living person it names. Appending a name
 * the entity ALSO answers to, without displacing the current one, is `addDirectoryName`.
 */
export function changeDirectoryName(
  fetchImpl: typeof fetch,
  entityId: string,
  request: {
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
  return requestJson(fetchImpl, `/api/v1/directory/entities/${encodeURIComponent(entityId)}/name`, {
    method: "PUT",
    body: request,
    idempotencyKey,
  });
}

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
 * A name change is not this call — `changeDirectoryName` is, and it flips the old row to former.
 * This one records the maiden name on a decades-old file, the trading name an organization also
 * answers to, the spelling a court used.
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

/**
 * Files a record under one of the firm's own categories.
 *
 * The category's applies-to is enforced server-side, so a person-only label on an organization is a
 * refusal rather than a row — the picker offering only what fits is a courtesy, not the guard.
 */
export function assignDirectoryCategory(
  fetchImpl: typeof fetch,
  request: { entityId: string; categoryId: string },
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: boolean }>> {
  return requestJson(fetchImpl, "/api/v1/directory/category-assignments", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
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

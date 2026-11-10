/*
 * The directory's response shapes and calls — the firm's book of people and organizations.
 *
 * Mirrors the directory operations in apps/api-worker/openapi/openapi.json; the transport envelope
 * itself lives in $lib/api/request.ts, and every call resolves rather than throws.
 *
 * WHAT THE CONTRACT ANSWERS, AND WHAT IT DOES NOT. Stated here so a caller never goes looking:
 *
 *   - AN INDEX AND A RANKED ANSWER ARE DIFFERENT OBJECTS, AND THE ROW SHAPE IS NOT WHAT SEPARATES
 *     THEM. `listDirectoryEntities` is the index — every record, in name order, cursor-paged, with
 *     the size of the whole record beside the page — and, given a `search`, the firm's ranked
 *     answer to a name IN THOSE SAME ROWS, because the screen that lists the directory is the
 *     screen that searches it. What must never blur is the envelope: a ranked answer is capped and
 *     says so, and a caller must not present a capped best-of as the firm's record.
 *   - `searchDirectory` is the same ranked search returning HITS rather than rows — which of an
 *     entity's names the query landed on, and nothing about what the record holds. That is what a
 *     picker wants and what a list of columns does not.
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
  /**
   * Plain calendar dates, held in the clear because every question a firm asks of a date of birth is
   * a range — is this client a minor, has a limitation period tolled, whose birthday falls this
   * month — and a range query over ciphertext is not a query. They used to be sealed identifiers,
   * which is why the platform could not usefully record one.
   */
  dateOfBirth: string | null;
  dateOfDeath: string | null;
  /** Separate from the date: known dead with the date unknown is a state the record can hold. */
  deceased: boolean;
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

/** One row of the directory's index — display identity, and nothing about what the record holds. */
export interface DirectoryEntityListing {
  entityId: string;
  entityKind: DirectoryEntityKind;
  /** What to call the record, or null where the directory holds no name for it. Show the gap. */
  displayName: string | null;
  /** An organization's legal name where it differs from what the firm calls it; null otherwise. */
  legalName: string | null;
  /** A person's first name; null for an organization. */
  givenName: string | null;
  middleName: string | null;
  /** A person's last name; null for an organization, and null for a person who has one name. */
  familyName: string | null;
  /** The record's DEFAULT email address, not every one it holds. Null where the firm holds none. */
  emailAddress: string | null;
  /** The record's default number, as entered. */
  phoneNumber: string | null;
  /** Where the record's default address is: the locality, the administrative area, the country. */
  city: string | null;
  region: string | null;
  country: string | null;
  recordedAt: string;
  /** When the record itself last changed. */
  changedAt: string;
}

/** A page of the index, carrying the size of the whole record rather than of the page. */
export interface DirectoryEntityListingPage {
  data: DirectoryEntityListing[];
  nextCursor: string | null;
  /**
   * How many records the firm holds under these filters, across every page of the walk — or, under
   * a search, how many answered, because a ranked answer's size is the answer's and not the book's.
   */
  total: number;
  /**
   * True only where a ranked answer was cut short: the firm holds more matches than came back. The
   * plain index is walkable to its end, so it is never capped.
   */
  capped: boolean;
}

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
  | "role_assignment"
  | "officer_of"
  | "director_of"
  | "partner_of"
  | "trustee_of"
  | "personal_representative_of"
  | "agent_of"
  | "employment"
  | "member_of"
  | "shareholder_of"
  | "beneficiary_of"
  | "guardian_of"
  | "point_of_contact_for";

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
  /** The plaintext part: the issuing region, the jurisdiction, who an account is held with. */
  label: string | null;
  validFrom: string | null;
  validTo: string | null;
  recordedAt: string;
}

// ---- contact points ----------------------------------------------------------------------------
//
// THE THREE CHANNELS ARE THREE READS OF ONE FACT: how to reach this record. Until these existed,
// `directory_email`, `directory_phone` and `directory_address` were tables nothing could reach and a
// firm could not record a client's telephone number.

/** What technology answers a telephone number. A fax is a fax by this, never by a word in a label. */
export type DirectoryContactSystem = "voice" | "fax" | "sms" | "pager";

/** What context a number or address is used in. Orthogonal to the technology behind it. */
export type DirectoryContactUse = "work" | "home" | "mobile" | "other" | "former" | "temporary";

export type DirectoryAddressUse =
  | "residential"
  | "business"
  | "postal"
  | "registered"
  | "service"
  | "former"
  | "temporary";

/** Whether the place physically exists. A post office box cannot be personally served. */
export type DirectoryAddressType = "physical" | "postal" | "both";

/** What the firm found the last time it tried to confirm a contact point. */
export type DirectoryVerificationStatus = "unverified" | "verified" | "failed";

/**
 * What the person said about this contact point, and what the firm found.
 *
 * `permitted` and `preferred` are two different facts and a screen must not merge them: a person can
 * be reachable at a number they would rather the firm did not ring, and can ask to be reached by
 * post while still holding an email address the firm may use. `preferred` is one answer across all
 * three channels — promoting one demotes whichever held it, in any table.
 *
 * A `failed` verification never blocks anything. It is a record and a warning: returned mail, a
 * bounced message, a disconnected line.
 */
export interface DirectoryContactPointState {
  permitted: boolean;
  preferred: boolean;
  note: string | null;
  verificationStatus: DirectoryVerificationStatus;
  verifiedAt: string | null;
  verificationDetail: string | null;
}

export interface DirectoryEmailEntry {
  id: string;
  address: string;
  contactUse: DirectoryContactUse | null;
  /** This channel's default row — where a message goes when no address was named. */
  isPrimary: boolean;
  state: DirectoryContactPointState;
}

export interface DirectoryPhoneEntry {
  id: string;
  /** Exactly as it was entered. Never rewritten, and what the screen shows. */
  number: string;
  contactSystem: DirectoryContactSystem;
  contactUse: DirectoryContactUse | null;
  /** Null where the number carried no country. Show the gap rather than inventing one. */
  countryCallingCode: string | null;
  nationalNumber: string | null;
  extension: string | null;
  countryRegionCode: string | null;
  isPrimary: boolean;
  state: DirectoryContactPointState;
}

export interface DirectoryAddressEntry {
  id: string;
  recipient: string | null;
  organizationName: string | null;
  street: string | null;
  streetTwo: string | null;
  dependentLocality: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  sortingCode: string | null;
  country: string | null;
  addressUse: DirectoryAddressUse | null;
  addressType: DirectoryAddressType;
  isPrimary: boolean;
  state: DirectoryContactPointState;
}

export interface DirectoryContactPoints {
  emails: DirectoryEmailEntry[];
  phones: DirectoryPhoneEntry[];
  addresses: DirectoryAddressEntry[];
}

/** What a screen may say about a contact point's permission and preference when recording one. */
export interface DirectoryContactPreference {
  permitted?: boolean;
  preferred?: boolean;
  note?: string | null;
}

export interface DirectoryContactVerification {
  status?: DirectoryVerificationStatus;
  detail?: string | null;
}

/** How many entities one naming call may ask about. Beyond it the read refuses rather than truncates. */
export const MAX_ENTITY_NAME_LOOKUP = 100;

// ---- reads -----------------------------------------------------------------------------------

/**
 * The firm's directory as an INDEX: everyone it holds, in name order, one page at a time — or, given
 * a `search`, the firm's ranked answer to a name in exactly those rows.
 *
 * People and organizations arrive in one sequence, because the directory is one book and a reader
 * looking for a name does not know in advance which side of it the firm filed. `kind` narrows that
 * sequence rather than splitting it into two screens.
 *
 * Deleted records are out, and so are records folded into another by a merge: a folded record still
 * answers a search and still resolves to its survivor, but listing it beside that survivor would
 * show one client as two.
 *
 * ONE ROW SHAPE, TWO QUESTIONS, AND THE ENVELOPE CARRIES THE DIFFERENCE. The screen showing the
 * answer is the screen showing the index, so a searched answer has to be listing rows — anything
 * else is a second table for a reader to learn. What the two do not share is on the page: the index
 * is sorted, walkable (`nextCursor`) and counted over the whole record; the answer is ranked, one
 * page, and `capped` when the firm holds more than fitted.
 */
export function listDirectoryEntities(
  fetchImpl: typeof fetch,
  options: { kind?: DirectoryEntityKind; cursor?: string; search?: string } = {},
): Promise<ApiOutcome<DirectoryEntityListingPage>> {
  const parameters = new URLSearchParams();
  if (options.kind !== undefined) parameters.set("kind", options.kind);
  if (options.cursor !== undefined) parameters.set("cursor", options.cursor);
  const search = options.search?.trim() ?? "";
  if (search !== "") parameters.set("search", search);
  const query = parameters.toString();
  return requestJson(fetchImpl, `/api/v1/directory/entities${query === "" ? "" : `?${query}`}`);
}

/**
 * The firm's ranked name search — the way to reach a record whose spelling nobody is sure of.
 *
 * Trigram matching over every name row the firm holds, current and former alike, tolerant of a
 * typo. Merged-away records are excluded from the hits and still resolve through their survivor.
 * The answer is CAPPED and in relevance order, which is why it is never presented as the index:
 * `listDirectoryEntities` is that.
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
export interface DirectoryIdentifierValue {
  /** The decrypted value — for an account, its number. */
  value: string | null;
  username?: string | null;
  secret?: string | null;
}

export function readDirectoryIdentifier(
  fetchImpl: typeof fetch,
  entityId: string,
  type: DirectoryIdentifierType,
): Promise<ApiOutcome<DirectoryIdentifierValue>> {
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
/** What a new edge records: the two ends, the type, and the facts about the link itself. */
export interface CreateDirectoryEdgeRequest {
  from: string;
  to: string;
  edgeType: DirectoryEdgeType;
  role?: string | null;
  note?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

/**
 * Records a relationship between two entities. The direction is the type's: an officer is an
 * officer OF an organization, so `from` is the person and `to` the organization whichever record
 * the edge was recorded from. The idempotency key is the caller's, so a retried press records once.
 */
export function createDirectoryEdge(
  fetchImpl: typeof fetch,
  request: CreateDirectoryEdgeRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/directory/edges", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** What a new category takes: its name and which side of the directory it files. */
export interface CreateDirectoryCategoryRequest {
  name: string;
  appliesTo: DirectoryEntityKind | "both";
}

/** Creates one of the firm's own categories. The idempotency key is the caller's. */
export function createDirectoryCategory(
  fetchImpl: typeof fetch,
  request: CreateDirectoryCategoryRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/directory/categories", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

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

/** One further name a person has held, recorded with the person. */
export interface DirectoryOtherNameRequest {
  given: string;
  family: string;
  nameRole: DirectoryNameRole;
  prefix?: string | null;
  middle?: string | null;
  suffix?: string | null;
}

/** One organization the person belongs to, and which end of the edge the person is. */
export interface DirectoryPersonOrganizationRequest {
  organizationId: string;
  edgeType: DirectoryEdgeType;
  personIs: "from" | "to";
  role?: string | null;
  note?: string | null;
}

/**
 * The whole person, recorded in one request and one batch: nothing lands unless all of it does.
 * Every nested shape is the one its own route takes, so the panes and the create agree.
 */
export interface CreateDirectoryPersonRequest {
  given: string;
  /** Absent for a person who has one name; the contract requires the given name and nothing else. */
  family?: string;
  prefix?: string | null;
  middle?: string | null;
  suffix?: string | null;
  otherNames?: DirectoryOtherNameRequest[];
  pronouns?: PronounSet | null;
  dateOfBirth?: string | null;
  dateOfDeath?: string | null;
  emails?: {
    address: string;
    contactUse?: DirectoryContactUse | null;
    isPrimary?: boolean;
    preference?: DirectoryContactPreference;
  }[];
  phones?: {
    number: string;
    contactSystem?: DirectoryContactSystem;
    contactUse?: DirectoryContactUse | null;
    extension?: string | null;
    countryRegionCode?: string | null;
    isPrimary?: boolean;
    preference?: DirectoryContactPreference;
  }[];
  addresses?: {
    recipient?: string | null;
    organizationName?: string | null;
    street?: string | null;
    streetTwo?: string | null;
    dependentLocality?: string | null;
    city?: string | null;
    region?: string | null;
    postal?: string | null;
    sortingCode?: string | null;
    country?: string | null;
    addressUse?: DirectoryAddressUse | null;
    addressType?: DirectoryAddressType;
    isPrimary?: boolean;
    preference?: DirectoryContactPreference;
  }[];
  identifiers?: DirectoryIdentifierRequest[];
  organizations?: DirectoryPersonOrganizationRequest[];
}

export function createDirectoryPerson(
  fetchImpl: typeof fetch,
  request: CreateDirectoryPersonRequest,
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
/** What a person typed for one identifier; the type decides which parts the API reads. */
export interface DirectoryIdentifierRequest {
  type: DirectoryIdentifierType;
  label?: string | null;
  number: string;
  username?: string | null;
  secret?: string | null;
}

export function addDirectoryIdentifier(
  fetchImpl: typeof fetch,
  entityId: string,
  request: DirectoryIdentifierRequest,
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

// ---- contact points ----------------------------------------------------------------------------

/**
 * Every way the firm knows to reach one record, in one read.
 *
 * Three channels, one round trip: a record screen asks the question once, so the pane never renders
 * two thirds of an answer while the third is still in flight. A record folded into another by a
 * merge still answers, so an old link lands on something.
 */
export function readDirectoryContactPoints(
  fetchImpl: typeof fetch,
  entityId: string,
): Promise<ApiOutcome<DirectoryContactPoints>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/contact-points`,
  );
}

/** Records an email address. More than one is ordinary, and one of them is the channel's default. */
export function addDirectoryEmail(
  fetchImpl: typeof fetch,
  entityId: string,
  request: {
    address: string;
    contactUse?: DirectoryContactUse | null;
    isPrimary?: boolean;
    preference?: DirectoryContactPreference;
    verification?: DirectoryContactVerification;
  },
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/emails`,
    { method: "POST", body: request, idempotencyKey },
  );
}

/**
 * Records a telephone or fax number.
 *
 * The number is sent as it was written and is stored that way: the split into country calling code,
 * national number and extension sits beside it, and goes null where the number could not be split
 * rather than being guessed at. What answers the number and what context it is used in are two
 * fields, so a work fax is expressible.
 */
export function addDirectoryPhone(
  fetchImpl: typeof fetch,
  entityId: string,
  request: {
    number: string;
    contactSystem?: DirectoryContactSystem;
    contactUse?: DirectoryContactUse | null;
    extension?: string | null;
    isPrimary?: boolean;
    preference?: DirectoryContactPreference;
    verification?: DirectoryContactVerification;
  },
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/phones`,
    { method: "POST", body: request, idempotencyKey },
  );
}

/**
 * Records a postal address.
 *
 * No field is required and none is assumed: which fields a country's addresses use, what a reader
 * there calls them and what order they read in are properties of the country, so nothing here is a
 * state and a five-digit postal code. An address the firm holds only half of is still the address it
 * holds.
 */
export function addDirectoryAddress(
  fetchImpl: typeof fetch,
  entityId: string,
  request: {
    recipient?: string | null;
    organizationName?: string | null;
    street?: string | null;
    streetTwo?: string | null;
    dependentLocality?: string | null;
    city?: string | null;
    region?: string | null;
    postal?: string | null;
    sortingCode?: string | null;
    country?: string | null;
    addressUse?: DirectoryAddressUse | null;
    addressType?: DirectoryAddressType;
    isPrimary?: boolean;
    preference?: DirectoryContactPreference;
    verification?: DirectoryContactVerification;
  },
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/addresses`,
    { method: "POST", body: request, idempotencyKey },
  );
}

/**
 * Changes what the firm holds about one contact point — INCLUDING the value itself.
 *
 * An omitted field keeps its stored value, which is what makes it safe to send only the preference:
 * withdrawing a permission does not touch the number, and editing a number does not read back later
 * as a confirmation the firm never made.
 *
 * The value fields are here because the route has taken them from the beginning and nothing on
 * screen asked for one, so a mistyped digit could only be fixed by deleting the row and entering it
 * again — which is not a correction: the removal is its own fact on the record, and the permission,
 * the preference and the confirmation attached to the value go with it. The three channels take
 * different fields, so the request is the union of them and a caller sends the ones its channel has
 * (contact-draft.ts builds it).
 */
export function updateDirectoryContactPoint(
  fetchImpl: typeof fetch,
  channel: "emails" | "phones" | "addresses",
  contactPointId: string,
  request: {
    preference?: DirectoryContactPreference;
    verification?: DirectoryContactVerification;
    isPrimary?: boolean;
    contactUse?: DirectoryContactUse | null;
    /** An email's own value. */
    address?: string;
    /** A number's, as it was written; the record never rewrites it. */
    number?: string;
    contactSystem?: DirectoryContactSystem;
    extension?: string | null;
    countryRegionCode?: string | null;
    /** An address's lines — the international field set, every one of them optional. */
    recipient?: string | null;
    organizationName?: string | null;
    street?: string | null;
    streetTwo?: string | null;
    dependentLocality?: string | null;
    city?: string | null;
    region?: string | null;
    postal?: string | null;
    sortingCode?: string | null;
    country?: string | null;
    addressUse?: DirectoryAddressUse | null;
    addressType?: DirectoryAddressType;
  },
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/${channel}/${encodeURIComponent(contactPointId)}`,
    { method: "PUT", body: request, idempotencyKey },
  );
}

/**
 * Removes a contact point from a record.
 *
 * The row is retained and marked removed, never deleted, so a document assembled from it stays
 * reproducible. Where the reason is that the person asked the firm not to use it, withdraw the
 * permission instead: that keeps the instruction attached to the value, and removal does not.
 */
export function removeDirectoryContactPoint(
  fetchImpl: typeof fetch,
  channel: "emails" | "phones" | "addresses",
  contactPointId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/${channel}/${encodeURIComponent(contactPointId)}`,
    { method: "DELETE", idempotencyKey },
  );
}

/**
 * Records a person's date of birth, date of death, and whether they are known to have died.
 *
 * An omitted field keeps its stored value; an explicit null clears it. A recorded date of death
 * implies the deceased flag.
 */
export function setDirectoryPersonLifeDates(
  fetchImpl: typeof fetch,
  entityId: string,
  request: { dateOfBirth?: string | null; dateOfDeath?: string | null; deceased?: boolean },
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: boolean }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/persons/${encodeURIComponent(entityId)}/life-dates`,
    { method: "PUT", body: request, idempotencyKey },
  );
}

/** A record's picture, as facts about it. The bytes are a separate read, at `entityPhotoHref`. */
export interface DirectoryEntityPhoto {
  /** The SHA-256 of the bytes. Also what the content address is cache-busted by. */
  sha256: string;
  contentType: string;
  sizeBytes: number;
  widthPixels: number;
  heightPixels: number;
  updatedAt: string;
}

export interface DirectoryEntityPhotoState {
  /** Null where the record holds no picture. */
  photo: DirectoryEntityPhoto | null;
}

/** The record's picture, or null where it holds none. */
export function readDirectoryEntityPhoto(
  fetchImpl: typeof fetch,
  entityId: string,
): Promise<ApiOutcome<DirectoryEntityPhotoState>> {
  return requestJson(fetchImpl, `/api/v1/directory/entities/${encodeURIComponent(entityId)}/photo`);
}

/** Sets the record's picture from a PNG or JPEG, replacing whatever it held. */
export function setDirectoryEntityPhoto(
  fetchImpl: typeof fetch,
  entityId: string,
  imageBase64: string,
  idempotencyKey: string,
): Promise<ApiOutcome<DirectoryEntityPhotoState>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/photo`,
    {
      method: "PUT",
      body: { imageBase64 },
      idempotencyKey,
    },
  );
}

/** Removes the record's picture. A record that holds none is answered the same way. */
export function removeDirectoryEntityPhoto(
  fetchImpl: typeof fetch,
  entityId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<DirectoryEntityPhotoState>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/photo`,
    {
      method: "DELETE",
      idempotencyKey,
    },
  );
}

/** Where the picture's bytes are read from; the hash makes a replaced picture a new address. */
export function entityPhotoHref(entityId: string, photo: DirectoryEntityPhoto): string {
  return `/api/v1/directory/entities/${encodeURIComponent(entityId)}/photo/content?v=${encodeURIComponent(photo.sha256)}`;
}

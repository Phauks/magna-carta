import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { loadEffectivePermissions } from "../session-context.ts";
import {
  readPerson,
  setPersonLifeDates,
  setPersonPronouns,
  InvalidPersonLifeDatesError,
} from "@magna-carta/directory/person";
import {
  addEmail,
  removeEmail,
  updateEmail,
  DirectoryEmailNotFoundError,
  InvalidEmailAddressError,
  InvalidEmailUseError,
} from "@magna-carta/directory/contact-email";
import {
  addPhone,
  removePhone,
  updatePhone,
  DirectoryPhoneNotFoundError,
  InvalidPhoneClassificationError,
  InvalidPhoneNumberError,
} from "@magna-carta/directory/contact-phone";
import {
  addAddress,
  removeAddress,
  updateAddress,
  DirectoryAddressNotFoundError,
  EmptyPostalAddressError,
  InvalidAddressClassificationError,
} from "@magna-carta/directory/contact-address";
import { readContactPoints } from "@magna-carta/directory/contact-points";
import { InvalidContactVerificationStatusError } from "@magna-carta/directory/contact-preference";
import { IncompletePronounSetError, PRONOUN_VERB_NUMBERS } from "@magna-carta/directory/pronouns";
import { createOrganization, readOrganization } from "@magna-carta/directory/organization";
import { addName, changeName, readNames } from "@magna-carta/directory/name-history";
import {
  addIdentifier,
  listIdentifierRecords,
  readIdentifier,
  IdentifierNotIndexableError,
  type DirectoryIdentifierContext,
  type AddIdentifierInput,
} from "@magna-carta/directory/identifiers";
import { checkIdentifier, parseAccountValue } from "@magna-carta/directory/identifier-shape";
import { createPersonRecord } from "@magna-carta/directory/person-record";
import {
  createEdge,
  readEdgesPage,
  InvalidEdgeTypeError,
  UnknownEntityError,
} from "@magna-carta/directory/edges";
import { MergedEntityError } from "@magna-carta/directory/entity-kind";
import {
  MAX_ENTITY_DISPLAY_NAME_LOOKUP,
  readEntityDisplayNames,
} from "@magna-carta/directory/entity-display";
import { readEntityListing } from "@magna-carta/directory/entity-listing";
import {
  assignCategory,
  createCategory,
  listCategories,
  readCategories,
  CategoryAppliesToMismatchError,
  CategoryNotFoundError,
  EntityNotFoundError,
} from "@magna-carta/directory/categories";
import { findDuplicateCandidates, searchNames } from "@magna-carta/directory/search";
import {
  mergeEntities,
  MergeAlreadyMergedError,
  MergeEntityNotFoundError,
  MergeKindMismatchError,
  MergeSameEntityError,
  MergeUnknownFieldError,
} from "@magna-carta/directory/merge";
import {
  linkMatterParty,
  readMatterParties,
  readMatterPartiesForEntity,
  unlinkMatterParty,
} from "@magna-carta/directory/party";
import { ProtectedReadForbiddenError } from "@magna-carta/data-access/protected-fields";
import {
  ADDRESS_TYPES,
  ADDRESS_USES,
  CONTACT_SYSTEMS,
  CONTACT_USES,
  CONTACT_VERIFICATION_STATUSES,
  EDGE_TYPES,
  ENTITY_KINDS,
  IDENTIFIER_TYPES,
  NAME_ROLES,
} from "@magna-carta/directory/types";
import type { DirectoryWriteOptions } from "@magna-carta/directory/audit";
import {
  DirectoryIdempotencyConflictError,
  type DirectoryIdempotencyContext,
} from "@magna-carta/directory/run-directory-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import { identifierField, idempotencyKeyHeader } from "../contracts/common.ts";
import { cursorQuery, paginated } from "../contracts/pagination.ts";
import type {
  DirectoryOrganizationId,
  DirectoryPersonId,
  MatterPartyId,
} from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { firmKeyProviderForEnv } from "../firm-key-provider-wiring.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The directory HTTP surface over the @magna-carta/directory domain package: persons and
// organizations, their name history, sensitive typed identifiers, relationship edges, categories,
// fuzzy/duplicate search, non-destructive merge, and the matter-party link. Every mutation rides the
// chokepoint's idempotency gate (an Idempotency-Key is required); every handler hands the domain
// service the firm-scoped per-firm database, the real clock, a crypto random source, and the
// authenticated actor — none of which is ever client input. Reads of a sensitive identifier are the
// one decrypt path: gated by directory:viewSensitiveIdentifiers and audited inside the protected-field
// chokepoint. Plain name search reveals nothing it was not given (blind-index equality, FTS), so it
// carries no decrypt and names no permission beyond an authenticated session. Duplicate-candidate
// generation is the one exception among the read-shaped surfaces: it gates on directory:edit because it
// is the entry-time duplicate-prevention step of the create/edit workflow (and the framework requires a
// named capability on any authenticated POST).

// ---- shared service handles ----

// The clock + random source every directory write reads (the service trusts no ambient clock and no
// ambient identity — both are passed). The random source is the production Web Crypto source; tests
// drive determinism at the domain layer, not through the route. The idempotency context (the
// chokepoint's firm-scoped derived key + request fingerprint) rides the committed batch so a retried
// mutation dedups instead of duplicating.
function writeOptions(
  actorUserId: AppVariables["chokepointUserId"],
  idempotency: DirectoryIdempotencyContext,
): DirectoryWriteOptions {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId,
    randomSource: cryptoRandomSource,
    idempotency,
  };
}

// The category row as the contract states it. The stored archived flag is 0/1 in SQLite and a
// boolean on the wire — the projection lives here so the two category reads cannot disagree.
function toCategoryEntry(row: {
  id: string;
  name: string;
  appliesTo: string;
  position: number;
  archived: number;
}): z.infer<typeof DirectoryCategory> {
  return {
    id: row.id,
    name: row.name,
    appliesTo: row.appliesTo as "person" | "organization" | "both",
    position: row.position,
    archived: row.archived === 1,
  };
}

// The protected-field read/write context for the sensitive-identifier path: the firm key handle from
// the env-scoped provider, the per-firm database, the caller's effective permissions (so the
// protected-field chokepoint can gate + audit a decrypt), the acting user, and the clock. The
// effective-permission set is the same one the chokepoint loaded to gate the route — re-derived here
// because the chokepoint does not stash it as a context variable. firmKeyVersion 1 (the only version
// minted today).
async function identifierContext(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  idempotency?: DirectoryIdempotencyContext,
): Promise<DirectoryIdentifierContext> {
  const firm = requireChokepointFirmContext(c);
  const firmId = requireChokepointFirmId(c);
  const actorUserId = requireChokepointUserId(c);
  const effectivePermissions = await loadEffectivePermissions(firm.firmDatabase, actorUserId);
  return {
    firmId,
    firmKeyVersion: 1,
    firmKeyProvider: firmKeyProviderForEnv(c.env),
    database: firm.firmDatabase,
    effectivePermissions,
    actorUserId,
    clock: { now: () => new Date().toISOString() },
    randomSource: cryptoRandomSource,
    idempotency,
  };
}

// A directory-entity id path param: a person OR an organization handle (the name/identifier/category
// paths are entity-generic — the domain resolves the kind from the id prefix). Validated as a
// non-empty string with the directoryPerson_/directoryOrganization_ prefix; the brand is compile-time
// only, so this emits as a plain pattern-checked string.
const directoryEntityIdPattern = /^(directoryPerson|directoryOrganization)_[A-Za-z0-9_-]+$/;
const entityParam = z.object({
  id: z
    .string()
    .regex(directoryEntityIdPattern)
    .openapi({ param: { name: "id", in: "path" } }),
});
type EntityId = DirectoryPersonId | DirectoryOrganizationId;

// A PERSON handle only. Pronouns are a fact about a person, and the generic entity param would let an
// organisation handle through to a write that can only ever match a person row.
const personParam = z.object({
  id: z
    .string()
    .regex(/^directoryPerson_[A-Za-z0-9_-]+$/)
    .openapi({ param: { name: "id", in: "path" } }),
});

// ---- request/response contracts ----

const CreatedEntityResponse = z
  .object({ id: z.string() })
  .openapi("CreatedDirectoryEntityResponse");

// A person's pronouns, as the person states them. WHOLE OR NOT AT ALL: every form is required
// together, because a half-recorded set is what puts one set's "she" and another's "them" in the
// same sentence of a document that gets filed. Nothing here is derived from the name parts, and no
// request may ask the platform to work a set out — it is stated or it is absent.
//
// ONE registered component, already nullable, used verbatim by both the read and the write. Applying
// `.nullable()` or a second `.openapi()` at a use site re-registers the name under a different shape
// — the contract conformance check rejects that, and the emitted component would be right for
// neither caller.
const PronounSetSchema = z
  .object({
    subject: z.string().min(1).openapi({ description: "As in: she signed." }),
    object: z.string().min(1).openapi({ description: "As in: we served her." }),
    possessiveDeterminer: z.string().min(1).openapi({ description: "As in: her signature." }),
    possessivePronoun: z.string().min(1).openapi({ description: "As in: the signature is hers." }),
    reflexive: z.string().min(1).openapi({ description: "As in: she represented herself." }),
    verbNumber: z.enum(PRONOUN_VERB_NUMBERS).openapi({
      description:
        'Which verb form the set takes: "singular" for she is / he is, "plural" for they are. Recorded rather than worked out — nothing about the forms themselves says which.',
    }),
  })
  .nullable()
  .openapi("DirectoryPronounSet", {
    description:
      "The complete set of pronouns a person stated, or null where they stated none — which is the ordinary case and not a gap to fill in. Recorded whole: a partly supplied set is refused, because a document rendering one set's pronoun in one clause and another's in the next is wrong in a way nobody catches by reading it.",
  });

const PersonDetail = z
  .object({
    id: z.string(),
    prefix: z.string().nullable(),
    given: z.string().nullable(),
    middle: z.string().nullable(),
    family: z.string().nullable(),
    suffix: z.string().nullable(),
    displayName: z.string().nullable(),
    status: z.string(),
    mergedIntoId: z.string().nullable(),
    pronouns: PronounSetSchema,
  })
  .openapi("DirectoryPersonDetail");

const SetPronounsRequest = z
  .object({
    pronouns: PronounSetSchema,
  })
  .openapi("SetDirectoryPersonPronounsRequest");

const CreateOrganizationRequest = z
  .object({
    legalName: z.string().min(1),
    displayName: z.string().nullable().optional(),
  })
  .openapi("CreateDirectoryOrganizationRequest");

const OrganizationDetail = z
  .object({
    id: z.string(),
    legalName: z.string().nullable(),
    displayName: z.string().nullable(),
    status: z.string(),
    mergedIntoId: z.string().nullable(),
  })
  .openapi("DirectoryOrganizationDetail");

const AddNameRequest = z
  .object({
    nameRole: z.enum(NAME_ROLES),
    // Person fields.
    given: z.string().optional(),
    family: z.string().optional(),
    prefix: z.string().nullable().optional(),
    middle: z.string().nullable().optional(),
    suffix: z.string().nullable().optional(),
    // Organization field.
    legalName: z.string().optional(),
    displayName: z.string().nullable().optional(),
  })
  .openapi("AddDirectoryNameRequest");

const AckResponse = z.object({ ok: z.boolean() }).openapi("DirectoryAckResponse");

// A NAME CHANGE, which is a different act from appending an alias and the only one that can record
// a marriage. Supply the person fields or the organization field, matching the entity the id names —
// the kind is resolved from the handle, and a body shaped for the other kind is refused rather than
// half-applied.
const ChangeNameRequest = z
  .object({
    // Person fields. `family` is omitted for a person who has one name, on the same reasoning the
    // create route carries: a mononym is an ordinary name, and the domain indexes it from the given
    // name. An empty string is still refused — that is a value that cannot be a name.
    given: z.string().min(1).optional(),
    family: z.string().min(1).optional(),
    prefix: z.string().nullable().optional(),
    middle: z.string().nullable().optional(),
    suffix: z.string().nullable().optional(),
    // Organization fields.
    legalName: z.string().min(1).optional(),
    displayName: z.string().nullable().optional(),
  })
  .openapi("ChangeDirectoryNameRequest");

// One name an entity has held — the shape a history rail reads.
const DirectoryNameEntry = z
  .object({
    id: z.string(),
    nameRole: z.string().openapi({
      description:
        "What this name is to the entity: its current name, a former one, a maiden name, a " +
        "trading name. An open catalog, not a closed enum.",
    }),
    isCurrent: z.boolean().openapi({
      description: "True for the one name the entity answers to today.",
    }),
    prefix: z.string().nullable(),
    given: z.string().nullable(),
    middle: z.string().nullable(),
    family: z.string().nullable(),
    suffix: z.string().nullable(),
    displayName: z
      .string()
      .nullable()
      .openapi({
        description:
          "The name as it was recorded. Null for an organization: an organization's name row " +
          "keeps only the case-folded form, so a caller falls back to normalizedDisplay and shows " +
          "an honest lowercase former name rather than an invented capitalization.",
      }),
    normalizedDisplay: z.string().openapi({
      description:
        "The case-folded, punctuation-stripped form the search and conflicts corpus matches on. " +
        "Always present, for every name row of either kind.",
    }),
    validFrom: z.string().nullable(),
    validTo: z
      .string()
      .nullable()
      .openapi({ description: "When the name stopped being used, or null while it still is." }),
    recordedAt: z.string().openapi({
      description:
        "When the firm wrote the row down — which is not when the name came into use. A maiden " +
        "name recorded onto a twenty-year-old file was recorded today and valid decades ago.",
    }),
  })
  .openapi("DirectoryNameEntry");

const DirectoryNamePage = paginated(DirectoryNameEntry).openapi("DirectoryNamePage");

// The type decides the fields, and the shape is checked before anything is sealed
// (packages/directory/src/identifier-shape.ts): a social security number is nine digits, a licence
// needs the region that issued it, a bar number its jurisdiction, and an account is who it is held
// with plus the number, with the username and secret that belong to it. A value that does not fit
// is refused with the sentence the screen shows beside the field.
const AddIdentifierRequest = z
  .object({
    type: z.enum(IDENTIFIER_TYPES),
    label: z
      .string()
      .max(120)
      .nullish()
      .openapi({
        description:
          "The plaintext part a list shows without a reveal: the state or country that issued a " +
          "licence, the jurisdiction behind a bar number, who an account is held with. Required " +
          "where the type has one; never any part of the value.",
      }),
    number: z.string().min(1).max(128),
    username: z.string().max(128).nullish().openapi({ description: "An account's username." }),
    secret: z
      .string()
      .max(256)
      .nullish()
      .openapi({ description: "An account's secret, sealed beside its number and never indexed." }),
    validFrom: z.string().nullable().optional(),
    validTo: z.string().nullable().optional(),
  })
  .openapi("AddDirectoryIdentifierRequest");

const identifierTypeParam = z.object({
  id: z
    .string()
    .regex(directoryEntityIdPattern)
    .openapi({ param: { name: "id", in: "path" } }),
  type: z.enum(IDENTIFIER_TYPES).openapi({ param: { name: "type", in: "path" } }),
});

const IdentifierValueResponse = z
  .object({
    value: z.string().nullable().openapi({
      description:
        "The decrypted value — for an account, its number; the username and secret ride beside it.",
    }),
    username: z.string().nullable().optional(),
    secret: z.string().nullable().optional(),
  })
  .openapi("DirectoryIdentifierValueResponse");

const CreateEdgeRequest = z
  .object({
    from: z.string().regex(directoryEntityIdPattern),
    to: z.string().regex(directoryEntityIdPattern),
    edgeType: z.enum(EDGE_TYPES),
    role: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    validFrom: z.string().nullable().optional(),
    validTo: z.string().nullable().optional(),
  })
  .openapi("CreateDirectoryEdgeRequest");

const CreateCategoryRequest = z
  .object({
    name: z.string().min(1),
    appliesTo: z.enum(["person", "organization", "both"]),
    position: z.number().int().optional(),
  })
  .openapi("CreateDirectoryCategoryRequest");

const AssignCategoryRequest = z
  .object({
    entityId: z.string().regex(directoryEntityIdPattern),
    categoryId: identifierField("directoryCategory"),
  })
  .openapi("AssignDirectoryCategoryRequest");

const SearchHit = z
  .object({
    entityId: z.string(),
    entityKind: z.string(),
    displayName: z.string(),
    matchedName: z.string().openapi({
      description:
        "WHICH of the entity's names the query landed on. A search that reported only the " +
        "current name made a hit on a maiden name indistinguishable from a hit on the name " +
        "typed, which defeats the point of keeping every name an entity has held.",
    }),
    matchedNameRole: z.string().openapi({
      description: "What that matched name is to the entity — current, former, maiden, dba.",
    }),
    matchedNameIsCurrent: z.boolean(),
    relevance: z.number(),
  })
  .openapi("DirectorySearchHit");

const SearchResponse = z
  .object({
    data: z.array(SearchHit),
    // True when the firm holds more matches than were returned. A relevance-ranked search answers
    // with its best matches rather than all of them, and a caller must be able to tell a short
    // answer from a complete one — otherwise "no more results" and "we stopped counting" look alike.
    capped: z.boolean(),
  })
  .openapi("DirectorySearchResponse");

const DuplicateCandidatesRequest = z
  .object({
    kind: z.enum(ENTITY_KINDS),
    given: z.string().optional(),
    family: z.string().optional(),
    legalName: z.string().optional(),
    identifiers: z
      .array(z.object({ type: z.enum(IDENTIFIER_TYPES), value: z.string() }))
      .optional(),
    excludeEntityId: z.string().optional(),
  })
  .openapi("DirectoryDuplicateCandidatesRequest");

const DuplicateCandidate = z
  .object({
    entityId: z.string(),
    signalCount: z.number(),
    // The candidate's display identity travels WITH the candidate. It is the same naming read
    // /directory/entity-names performs, run once over the whole answer here: a caller that resolved
    // each candidate itself made one request per candidate, and a duplicate check is a list.
    entityKind: z.enum(["person", "organization", "unknown"]).openapi({
      description:
        "Which side of the directory the candidate resolves to. 'unknown' means the blocking " +
        "channels surfaced an entity the node tables no longer hold — a fact worth showing.",
    }),
    displayName: z
      .string()
      .nullable()
      .openapi({
        description:
          "What to call the candidate, or null where the directory holds no name for it. A caller " +
          "shows the gap rather than printing the handle.",
      }),
  })
  .openapi("DirectoryDuplicateCandidate");

const DuplicateCandidatesResponse = z
  .object({ data: z.array(DuplicateCandidate) })
  .openapi("DirectoryDuplicateCandidatesResponse");

const MergeRequest = z
  .object({
    masterId: z.string().regex(directoryEntityIdPattern),
    subordinateId: z.string().regex(directoryEntityIdPattern),
    // The survivorship choice per conflicting node column: "subordinate" means the master takes the
    // subordinate's value. An absent column keeps the master's own value.
    survivorship: z.record(z.string(), z.literal("subordinate")).optional(),
  })
  .openapi("DirectoryMergeRequest");

const MergeResponse = z.object({ mergeId: z.string() }).openapi("DirectoryMergeResponse");

const LinkMatterPartyRequest = z
  .object({
    matterId: identifierField("matter"),
    entityId: z.string().regex(directoryEntityIdPattern),
    role: z.string().min(1),
    capacity: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .openapi({
        description:
          "The capacity the entity acts in on this matter — Administrator, Trustee, " +
          "Attorney-in-fact. Recorded by the firm, never inferred; documents that name a capacity " +
          "read this value and show an honest gap where none was recorded.",
      }),
  })
  .openapi("LinkMatterPartyRequest");

const MatterPartyResponse = z.object({ id: z.string() }).openapi("MatterPartyResponse");

const MatterPartyEntry = z
  .object({
    id: z.string(),
    matterId: z.string(),
    entityId: z.string(),
    role: z.string(),
    capacity: z
      .string()
      .nullable()
      .openapi({
        description:
          "The capacity recorded on this link, or null where the firm recorded none. A null is an " +
          "honest absence and never a default — nothing infers a capacity from the role.",
      }),
    entityKind: z.enum(["person", "organization", "unknown"]).openapi({
      description:
        "Which side of the directory the entity resolves to. 'unknown' means the link points at " +
        "an entity that is no longer there, which is a fact worth showing rather than hiding.",
    }),
    displayName: z
      .string()
      .nullable()
      .openapi({
        description:
          "What to call this party, or null when the directory holds no name for the entity. A " +
          "caller shows the identifier itself rather than inventing a placeholder.",
      }),
  })
  .openapi("MatterPartyEntry");

const MatterPartyListResponse = z
  .object({ parties: z.array(MatterPartyEntry) })
  .openapi("MatterPartyListResponse");

const UnlinkMatterPartyResponse = z
  .object({ unlinked: z.boolean() })
  .openapi("UnlinkMatterPartyResponse");

// ---- the naming read ----
//
// The one read that answers about MANY entities at once, and it answers display identity only. Three
// surfaces were crippled without it and each was crippled the same way: the custody register says
// what it holds for owners it can name only by handle, a conflicts hit names the party it matched by
// handle, and a duplicate-candidate list is a column of handles. Every one of those is a page of
// rows, so resolving them one entity per request is the N+1 this platform's listings are written to
// avoid — which is why the surfaces render an honest gap instead.
//
// It carries no identifier, no contact detail and no decrypt, which is what makes it cheap enough to
// call for a page and safe enough to name no capability beyond an authenticated session.

const EntityDisplayName = z
  .object({
    entityId: z.string(),
    entityKind: z.enum(["person", "organization"]),
    displayName: z
      .string()
      .nullable()
      .openapi({
        description:
          "What to call this entity, or null where the directory holds no name for it at all. A " +
          "caller renders the gap and never falls back to printing the handle.",
      }),
    mergedIntoId: z
      .string()
      .nullable()
      .openapi({
        description:
          "The surviving record this one was folded into, or null while it stands on its own. A " +
          "list row naming a folded record has to say so.",
      }),
  })
  .openapi("DirectoryEntityDisplayName");

const EntityDisplayNamesResponse = z
  .object({ data: z.array(EntityDisplayName) })
  .openapi("DirectoryEntityDisplayNamesResponse");

// ---- the index: the whole directory, in name order ----

// One row of the firm's directory as an index reads it.
//
// NO IDENTIFIER, EVER. Reading a sealed identifier is a decrypt: permission-gated, and audited
// before any plaintext exists. A page of fifty rows cannot ask that, so nothing here touches one.
//
// The DEFAULT way to reach the record is a different question, and the index answers it. Each row
// carries at most one email, one number and the locality of one address — the row a message goes to
// when the sender named none — because "who is in Reno", "does the firm hold a number for her" and
// "sort this book by family name" are what a reader asks of a directory and had to open records one
// at a time to answer. It grants no reach a member did not already have: the same member can read
// every contact point on any record through the contact-points route with the same session and no
// further permission. The bulk NAMING read above still joins no contact row, and that distinction
// is deliberate — it is called for every row of every screen that mentions a person, where this is
// the directory itself being read as a directory.
const DirectoryEntityListing = z
  .object({
    entityId: z.string(),
    entityKind: z.enum(ENTITY_KINDS),
    displayName: z
      .string()
      .nullable()
      .openapi({
        description:
          "What to call the record, or null where the directory holds no name for it at all. A " +
          "caller shows the gap rather than printing the handle.",
      }),
    legalName: z
      .string()
      .nullable()
      .openapi({
        description:
          "An organization's legal name where it differs from what the firm calls it; null for a " +
          "person, and null where the two are the same word.",
      }),
    givenName: z
      .string()
      .nullable()
      .openapi({ description: "A person's first name. Null for an organization." }),
    middleName: z
      .string()
      .nullable()
      .openapi({ description: "A person's middle name, where the firm recorded one." }),
    familyName: z
      .string()
      .nullable()
      .openapi({
        description:
          "A person's last name. Null for an organization, and null for a person who has one " +
          "name — a record with no family name is one the firm keeps, not one it refuses.",
      }),
    emailAddress: z
      .string()
      .nullable()
      .openapi({
        description:
          "The record's default email address — the primary row where one is marked, else the " +
          "oldest. Null where the firm holds none. Not a contact register: the record's own " +
          "contact-points read is where every channel lives.",
      }),
    phoneNumber: z.string().nullable().openapi({
      description: "The record's default number, exactly as it was entered and never rewritten.",
    }),
    city: z
      .string()
      .nullable()
      .openapi({ description: "The locality of the record's default address." }),
    region: z
      .string()
      .nullable()
      .openapi({
        description:
          "The administrative area of the default address — state, province, prefecture — where " +
          "the country has one.",
      }),
    country: z
      .string()
      .nullable()
      .openapi({ description: "The default address's country, ISO 3166-1 alpha-2." }),
    recordedAt: z.string().openapi({ description: "When the firm wrote the record down." }),
    changedAt: z.string().openapi({
      description:
        "When the record itself last changed. A change to something hanging off it — a name " +
        "appended, an address added — does not move this.",
    }),
  })
  .openapi("DirectoryEntityListing");

// The page envelope plus the size of the whole record. `total` is what separates a listing from a
// capped answer: a page of fifty out of two thousand and a page of fifty that IS the directory are
// indistinguishable without it, and a firm that has entered twenty clients expects to be told it
// holds twenty.
const DirectoryEntityListingPage = paginated(DirectoryEntityListing)
  .extend({
    total: z
      .number()
      .int()
      .openapi({
        description:
          "How many records the firm holds under these filters — every page of the walk when the " +
          "directory is being listed, and the number of records answering when it is being " +
          "searched, because a ranked answer's size is the answer's and not the book's.",
      }),
    capped: z.boolean().openapi({
      description:
        "True only where a ranked answer (`search`) was cut short: the firm holds more matches " +
        "than were returned, so narrowing the query reaches the rest. False on every page of " +
        "the plain index, which is walkable to its end by cursor and never cut.",
    }),
  })
  .openapi("DirectoryEntityListingPage");

// ---- an entity's edges, matters, categories, and the identifiers it holds ----

const DirectoryEdgeEntry = z
  .object({
    id: z.string(),
    edgeType: z.string(),
    // Direction is kept rather than normalized away: "parent of" and "subsidiary of" are the same
    // row read from opposite ends, and a caller that lost which end it was on would render one as
    // the other.
    direction: z.enum(["outbound", "inbound"]).openapi({
      description:
        "Whether the entity asked about is the FROM end of this edge (outbound) or the TO end " +
        "(inbound). The relationship reads in the opposite sense from each end.",
    }),
    farEntityId: z.string().openapi({ description: "The entity at the other end of the edge." }),
    farEntityKind: z.enum(["person", "organization", "unknown"]),
    farDisplayName: z
      .string()
      .nullable()
      .openapi({
        description:
          "What to call the far end, resolved through the same naming read the bulk endpoint " +
          "performs — one lookup for the whole page, never one per row.",
      }),
    role: z.string().nullable(),
    note: z.string().nullable(),
    validFrom: z.string().nullable(),
    validTo: z.string().nullable(),
  })
  .openapi("DirectoryEdgeEntry");

const DirectoryEdgePage = paginated(DirectoryEdgeEntry).openapi("DirectoryEdgePage");

const EntityMatterPartyEntry = z
  .object({
    id: z.string(),
    matterId: z.string(),
    role: z.string(),
    capacity: z.string().nullable(),
    matterTitle: z
      .string()
      .nullable()
      .openapi({ description: "Null when the link points at a matter the firm no longer holds." }),
    matterNumber: z
      .string()
      .nullable()
      .openapi({ description: "Null while the matter is still consultation and undrawn." }),
    matterStatus: z.string().nullable(),
    linkedAt: z.string(),
  })
  .openapi("DirectoryEntityMatterPartyEntry");

const EntityMatterPartyPage = paginated(EntityMatterPartyEntry).openapi(
  "DirectoryEntityMatterPartyPage",
);

const DirectoryCategory = z
  .object({
    id: z.string(),
    name: z.string(),
    appliesTo: z.enum(["person", "organization", "both"]),
    position: z.number(),
    archived: z.boolean().openapi({
      description:
        "True for a label the firm has retired. Retired labels are still returned: an entity " +
        "carrying one must still be able to show what it says.",
    }),
  })
  .openapi("DirectoryCategory");

const DirectoryCategoriesResponse = z
  .object({ data: z.array(DirectoryCategory) })
  .openapi("DirectoryCategoriesResponse");

// What the firm holds for an entity, WITHOUT reading any of it. No value field is on this shape and
// none belongs on it: the decrypt is the privileged, audited act, and a record that performed one to
// draw a list of headings would write a plaintext social security number into the audit log every
// time a page rendered.
const DirectoryIdentifierRecord = z
  .object({
    id: z.string(),
    type: z.enum(IDENTIFIER_TYPES),
    label: z.string().nullable().openapi({
      description:
        "The plaintext part: the issuing region, the jurisdiction, who an account is held with.",
    }),
    validFrom: z.string().nullable(),
    validTo: z.string().nullable(),
    recordedAt: z.string(),
  })
  .openapi("DirectoryIdentifierRecord");

const DirectoryIdentifierRecordsResponse = z
  .object({ data: z.array(DirectoryIdentifierRecord) })
  .openapi("DirectoryIdentifierRecordsResponse");

// ---- shared error responses ----

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the entity is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress, or a merge conflict",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// Maps a directory domain refusal to its RFC 9457 problem. Codes — never messages — drive it; an
// unrecognized throw propagates to the standard error pipeline (a 500).
function directoryErrorResponse(
  c: Context,
  caught: unknown,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (caught instanceof DirectoryIdempotencyConflictError) {
    return problemResponseForIdempotencyConflict(c, caught);
  }
  if (
    caught instanceof MergeEntityNotFoundError ||
    caught instanceof EntityNotFoundError ||
    caught instanceof CategoryNotFoundError ||
    caught instanceof UnknownEntityError
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: caught.message,
    });
  }
  // A write aimed at a merged-away entity is a conflict, not a 404: the entity is still readable and
  // still carries its merge pointer, so the caller is told the write cannot land there and which
  // surviving master to address instead — the detail names it.
  // A contact point that is gone — removed, or never there — is one answer, not two: the caller
  // cannot act differently on the difference.
  if (
    caught instanceof DirectoryEmailNotFoundError ||
    caught instanceof DirectoryPhoneNotFoundError ||
    caught instanceof DirectoryAddressNotFoundError
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: caught.message,
    });
  }
  if (
    caught instanceof MergeAlreadyMergedError ||
    caught instanceof MergeSameEntityError ||
    caught instanceof MergedEntityError
  ) {
    return problemJson(c, {
      type: "conflict",
      title: "Merge conflict",
      status: 409,
      detail: caught.message,
    });
  }
  if (
    caught instanceof MergeKindMismatchError ||
    caught instanceof MergeUnknownFieldError ||
    caught instanceof InvalidEdgeTypeError ||
    caught instanceof CategoryAppliesToMismatchError ||
    caught instanceof IdentifierNotIndexableError ||
    caught instanceof InvalidEmailAddressError ||
    caught instanceof InvalidEmailUseError ||
    caught instanceof InvalidPhoneNumberError ||
    caught instanceof InvalidPhoneClassificationError ||
    caught instanceof InvalidAddressClassificationError ||
    caught instanceof EmptyPostalAddressError ||
    caught instanceof InvalidContactVerificationStatusError ||
    caught instanceof InvalidPersonLifeDatesError
  ) {
    return problemJson(c, {
      type: "validation",
      title: "Directory request invalid",
      status: 422,
      detail: caught.message,
    });
  }
  throw caught;
}

// ---- route metas ----

function mutationMeta(action: string, permission: RouteMeta["permission"]): RouteMeta {
  return {
    operationId: `directory.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "directoryEntity",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

function readMeta(action: string, permission: RouteMeta["permission"]): RouteMeta {
  return {
    operationId: `directory.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "directoryEntity",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

// Every directory write (create/edit an entity, name, identifier, edge, category, merge, matter-party
// link) requires directory:edit. The sensitive-identifier READ is the one route that instead names
// directory:viewSensitiveIdentifiers — its decrypt is the privileged, audited action.
const WRITE_PERMISSION = "directory:edit" as const;

const getPersonRoute = defineOpenAPIRoute(readMeta("getPerson", null), {
  method: "get",
  path: "/api/v1/directory/persons/{id}",
  description: "Returns one directory person's detail.",
  request: { params: entityParam },
  responses: {
    200: { description: "The person", content: { "application/json": { schema: PersonDetail } } },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const setPersonPronounsRoute = defineOpenAPIRoute(
  mutationMeta("setPersonPronouns", WRITE_PERMISSION),
  {
    method: "put",
    path: "/api/v1/directory/persons/{id}/pronouns",
    description:
      "Records the pronouns a person stated, or removes the set on file. Every form is supplied together: " +
      "a partly recorded set is refused, because a document that renders one set's pronoun in one clause " +
      "and another's in the next is wrong in a way nobody catches by reading it. Pronouns are never " +
      "worked out from a name, a courtesy title, or any other field.",
    request: {
      headers: idempotencyKeyHeader,
      params: personParam,
      body: { content: { "application/json": { schema: SetPronounsRequest } }, required: true },
    },
    responses: {
      200: { description: "Recorded", content: { "application/json": { schema: AckResponse } } },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const createOrganizationRoute = defineOpenAPIRoute(
  mutationMeta("createOrganization", WRITE_PERMISSION),
  {
    method: "post",
    path: "/api/v1/directory/organizations",
    description:
      "Creates a directory organization from its legal name, seeding the current-name history row and " +
      "its phonetic blocking codes.",
    request: {
      headers: idempotencyKeyHeader,
      body: {
        content: { "application/json": { schema: CreateOrganizationRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The created organization",
        content: { "application/json": { schema: CreatedEntityResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const getOrganizationRoute = defineOpenAPIRoute(readMeta("getOrganization", null), {
  method: "get",
  path: "/api/v1/directory/organizations/{id}",
  description: "Returns one directory organization's detail.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The organization",
      content: { "application/json": { schema: OrganizationDetail } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const addNameRoute = defineOpenAPIRoute(mutationMeta("addName", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/entities/{id}/names",
  description:
    "Appends a non-current alias (alias/aka/maiden/dba/former) to an entity without touching its " +
    "current name. The entity kind is resolved from the id; supply the person OR organization name " +
    "fields accordingly.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: AddNameRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The alias was added",
      content: { "application/json": { schema: AckResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const changeNameRoute = defineOpenAPIRoute(mutationMeta("changeName", WRITE_PERMISSION), {
  method: "put",
  path: "/api/v1/directory/entities/{id}/name",
  description:
    "Changes the name an entity currently answers to. This is what records a marriage, a deed poll, " +
    "or an organization's rename: the name on file is not overwritten — it is retained as a former " +
    "name, kept in the search and conflicts corpus with its phonetic codes intact, and stamped with " +
    "the date it stopped being used, while the new name is written as the current one and " +
    "denormalized onto the entity. Appending a name the entity ALSO answers to, without displacing " +
    "the current one, is the entities/{id}/names route instead. The entity kind is resolved from the " +
    "id; supply the person fields or the organization field accordingly.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: ChangeNameRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The name was changed and the prior one retained as history",
      content: { "application/json": { schema: AckResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listNamesRoute = defineOpenAPIRoute(readMeta("listNames", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/names",
  description:
    "Returns every name an entity has held — the current one, the former ones, the aliases and the " +
    "trading names — newest-recorded first and cursor-paged. Ordered by when the firm WROTE each " +
    "row rather than by when the name came into use, so the current name heads the list and a " +
    "maiden name recorded onto a decades-old file does not sort to the bottom. Soft-deleted rows " +
    "are excluded, as they are from search.",
  request: { params: entityParam, query: cursorQuery },
  responses: {
    200: {
      description: "A page of the entity's names",
      content: { "application/json": { schema: DirectoryNamePage } },
    },
    401: authErrors[401],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

// The index. It names no permission beyond an authenticated session, on the same reasoning the name
// search carries: what it discloses — display identity, and the one default way to reach a record —
// is what any member already meets on every matter they can open and can already read a record at a
// time through the contact-points route with this same session.
const listEntitiesRoute = defineOpenAPIRoute(readMeta("listEntities", null), {
  method: "get",
  path: "/api/v1/directory/entities",
  description:
    "Lists the firm's directory — every person and organization it holds, in name order and " +
    "cursor-paged, with `total` giving the size of the whole record. People and organizations are " +
    "ONE sequence: the directory is one book, and `kind` narrows it rather than splitting it. " +
    "Deleted records and records folded into another by a merge are excluded — a folded record " +
    "still answers a search and still resolves to its survivor, but listing it beside that " +
    "survivor would show one client as two. Given `search`, the same read answers a NAME instead: " +
    "the firm's ranked trigram search chooses the records and they come back as the same listing " +
    "rows, in the firm's own relevance order. That answer is capped rather than walkable, so " +
    "`nextCursor` is null, `total` is the size of the answer, and `capped` says whether the firm " +
    "holds more matches than fitted.",
  request: {
    query: cursorQuery.extend({
      kind: z
        .enum(ENTITY_KINDS)
        .optional()
        .openapi({
          param: { name: "kind", in: "query" },
          description: "Narrows to one side of the directory. Omitted, both are listed together.",
        }),
      search: z
        .string()
        .optional()
        .openapi({
          param: { name: "search", in: "query" },
          description:
            "A name to rank the directory against — every name the firm has recorded is matched, " +
            "former names included, and a misspelling still finds the record. The corpus matches " +
            "three-character windows, so a shorter query answers with nothing rather than with " +
            "the whole book. Omitted, the directory is listed in name order.",
        }),
    }),
  },
  responses: {
    200: {
      description:
        "A page of the directory in name order, with the size of the whole record — or, under " +
        "`search`, the ranked matches as the same rows",
      content: { "application/json": { schema: DirectoryEntityListingPage } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const entityNamesRoute = defineOpenAPIRoute(readMeta("entityNames", null), {
  method: "get",
  path: "/api/v1/directory/entity-names",
  description:
    "Names many directory entities in one request: the id, which side of the directory it is, what " +
    "to call it, and whether it has been folded into another record. DISPLAY IDENTITY ONLY — no " +
    "identifier is touched, so nothing here can decrypt, and no contact row is joined, so a list of " +
    "names cannot become a mailing list. That is what makes it cheap enough to call for every row " +
    "on a page and safe enough to need no capability beyond an authenticated session. At most 100 " +
    `ids per call (the platform's bound-parameter cap); an id beyond that is refused rather than ` +
    "silently dropped. An id the firm holds no live row for is ABSENT from the answer — a caller " +
    "renders the gap rather than printing the handle.",
  request: {
    query: z.object({
      ids: z
        .string()
        .min(1)
        .max(6000)
        .openapi({
          param: { name: "ids", in: "query" },
          description: "Comma-separated directory entity handles. At most 100.",
        }),
    }),
  },
  responses: {
    200: {
      description:
        "The display identity of each id the firm holds a live record for, in the order asked",
      content: { "application/json": { schema: EntityDisplayNamesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listEdgesRoute = defineOpenAPIRoute(readMeta("listEdges", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/edges",
  description:
    "Returns the relationships touching one entity — both directions, each carrying which end this " +
    "entity is on and the display name of the far end. Newest first and cursor-paged. Edges whose " +
    "validity has expired are excluded by default; includeExpired returns them too, which is what " +
    "a conflicts review wants because the professional-conduct rules are about FORMER relationships.",
  request: {
    params: entityParam,
    query: cursorQuery.extend({ includeExpired: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    200: {
      description: "A page of the entity's relationships",
      content: { "application/json": { schema: DirectoryEdgePage } },
    },
    401: authErrors[401],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listEntityMatterPartiesRoute = defineOpenAPIRoute(readMeta("listEntityMatterParties", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/matter-parties",
  description:
    "Returns the matters this entity is a party to, and the role and capacity it holds on each — " +
    "the mirror of the matter-parties read, which answers for one MATTER. Newest link first and " +
    "cursor-paged. Severed links are excluded; the row is retained so a conflicts report that " +
    "named this party stays reproducible.",
  request: { params: entityParam, query: cursorQuery },
  responses: {
    200: {
      description: "A page of the matters this entity is a party to",
      content: { "application/json": { schema: EntityMatterPartyPage } },
    },
    401: authErrors[401],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listCategoriesRoute = defineOpenAPIRoute(readMeta("listCategories", null), {
  method: "get",
  path: "/api/v1/directory/categories",
  description:
    "The firm's whole category vocabulary in display order, retired labels included and flagged. " +
    "One list serves both the picker and the record, so the two cannot disagree about what a label " +
    "means.",
  responses: {
    200: {
      description: "The firm's categories",
      content: { "application/json": { schema: DirectoryCategoriesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listEntityCategoriesRoute = defineOpenAPIRoute(readMeta("listEntityCategories", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/categories",
  description: "The categories assigned to one entity, in the firm's own display order.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The entity's categories",
      content: { "application/json": { schema: DirectoryCategoriesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listIdentifiersRoute = defineOpenAPIRoute(readMeta("listIdentifiers", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/identifiers",
  description:
    "Says WHICH sealed identifiers an entity holds — the type, the validity period, and when each " +
    "was recorded — and never what any of them is. No ciphertext is read, so this performs no " +
    "decrypt, names no permission beyond the session, and writes no audit row: a record that had " +
    "to decrypt merely to draw its list of headings would put a plaintext social security number " +
    "into the firm's audit log every time a page rendered. Reading a value is the separate, " +
    "permission-gated, audited route on the same path plus a type.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "What the firm holds for this entity, described but not disclosed",
      content: { "application/json": { schema: DirectoryIdentifierRecordsResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const addIdentifierRoute = defineOpenAPIRoute(mutationMeta("addIdentifier", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/entities/{id}/identifiers",
  description:
    "Seals a typed sensitive identifier (SSN/EIN/DL/account/DOB/SSN-last-four) for an entity under the " +
    "firm key — only the ciphertext (and, where the type is standalone-indexable, the exact-match blind " +
    "index) is stored, never the plaintext. Adding a value needs no decrypt permission; reading it back " +
    "does.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: AddIdentifierRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The identifier was sealed and added",
      content: { "application/json": { schema: AckResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const readIdentifierRoute = defineOpenAPIRoute(
  readMeta("readIdentifier", "directory:viewSensitiveIdentifiers"),
  {
    method: "get",
    path: "/api/v1/directory/entities/{id}/identifiers/{type}",
    description:
      "Decrypts and returns an entity's sensitive identifier of the given type. The decrypt is gated by " +
      "directory:viewSensitiveIdentifiers and audited (an audit_log row is written before any plaintext " +
      "is produced); a caller without the permission is refused at the chokepoint, before any decrypt.",
    request: { params: identifierTypeParam },
    responses: {
      200: {
        description:
          "The decrypted identifier value (null when the entity holds none of this type)",
        content: { "application/json": { schema: IdentifierValueResponse } },
      },
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      429: authErrors[429],
    },
  },
);

const createEdgeRoute = defineOpenAPIRoute(mutationMeta("createEdge", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/edges",
  description:
    "Creates a directed relationship edge between two directory entities (affiliation, corporate " +
    "parent/subsidiary/successor, representation, role assignment). Both endpoints must exist.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateEdgeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The created edge",
      content: { "application/json": { schema: CreatedEntityResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const createCategoryRoute = defineOpenAPIRoute(mutationMeta("createCategory", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/categories",
  description:
    "Creates a directory category (label) constrained to person, organization, or both entity kinds.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateCategoryRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The created category",
      content: { "application/json": { schema: CreatedEntityResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const assignCategoryRoute = defineOpenAPIRoute(mutationMeta("assignCategory", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/category-assignments",
  description:
    "Links a directory entity to a category, enforcing the category's applies-to constraint against " +
    "the entity kind.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: AssignCategoryRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The category was assigned",
      content: { "application/json": { schema: AckResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const searchRoute = defineOpenAPIRoute(readMeta("search", null), {
  method: "get",
  path: "/api/v1/directory/search",
  description:
    "Fuzzy name search over the directory: a trigram FTS match, tolerant of typos, ordered by " +
    "relevance. Merged-away entities are excluded. CAPPED at the most relevant matches, and " +
    "`capped` says when the firm holds more than were returned — this read had no bound at all, so " +
    "a broad query against a large directory returned every match in one response.",
  request: { query: z.object({ q: z.string() }) },
  responses: {
    200: {
      description: "The ranked hits",
      content: { "application/json": { schema: SearchResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const duplicateCandidatesRoute = defineOpenAPIRoute(
  readMeta("duplicateCandidates", WRITE_PERMISSION),
  {
    method: "post",
    path: "/api/v1/directory/duplicate-candidates",
    description:
      "Returns duplicate candidates for a prospective or existing entity by unioning three blocking " +
      "channels (phonetic, trigram, and blind-index identifier equality), ranked by how many channels " +
      "matched. A read-shaped POST (the match facts ride the body) — no write, no decrypt — but it gates " +
      "on directory:edit because it is the entry-time duplicate-prevention step of the create/edit " +
      "workflow, not a general directory read.",
    request: {
      body: {
        content: { "application/json": { schema: DuplicateCandidatesRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The ranked candidates",
        content: { "application/json": { schema: DuplicateCandidatesResponse } },
      },
      401: authErrors[401],
      404: authErrors[404],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const mergeRoute = defineOpenAPIRoute(mutationMeta("merge", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/merges",
  description:
    "Folds a duplicate (the subordinate) into the surviving record (the master) non-destructively: " +
    "archives the subordinate, repoints its inbound references, applies field-level survivorship, and " +
    "records the reversible merge event. merged_by is the authenticated actor.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: MergeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded merge",
      content: { "application/json": { schema: MergeResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const linkMatterPartyRoute = defineOpenAPIRoute(mutationMeta("linkMatterParty", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/matter-parties",
  description:
    "Links a directory entity to a matter in a role (client, opposing party, guardian, …). One entity " +
    "may wear several roles on the same matter — there is no uniqueness on (matter, entity).",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: LinkMatterPartyRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The matter-party link",
      content: { "application/json": { schema: MatterPartyResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listMatterPartiesRoute = defineOpenAPIRoute(readMeta("listMatterParties", null), {
  method: "get",
  path: "/api/v1/directory/matter-parties",
  description:
    "Returns the live parties on one matter — the link id, the directory entity, the role, and the " +
    "capacity recorded on the link. One entity appears once per role it wears. Severed links are " +
    "excluded.",
  request: { query: z.object({ matterId: identifierField("matter") }) },
  responses: {
    200: {
      description:
        "The matter's parties. A matter that holds none answers with an empty list rather than a " +
        "404 — the read is already scoped to the session firm's own database, so an empty answer " +
        "is the truthful one and distinguishing 'no parties' from 'no such matter' would cost a " +
        "second query to tell a caller something it cannot act on differently.",
      content: { "application/json": { schema: MatterPartyListResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const unlinkMatterPartyRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("unlinkMatterParty", WRITE_PERMISSION),
    reversal: { kind: "inverse", by: "directory.linkMatterParty" },
  },
  {
    method: "delete",
    path: "/api/v1/directory/matter-parties/{id}",
    description:
      "Severs one party link. The row is retained and marked severed, never removed, so a conflicts " +
      "report that named this party stays reproducible. Severing a link that is already severed " +
      "reports 404.",
    request: {
      headers: idempotencyKeyHeader,
      params: z.object({ id: identifierField("matterParty") }),
    },
    responses: {
      200: {
        description: "The link was severed",
        content: { "application/json": { schema: UnlinkMatterPartyResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

// ---- contact points ----------------------------------------------------------------------------
//
// Three tables, one vocabulary. `directory_email`, `directory_phone` and `directory_address` have
// been in the schema since the baseline migration with nothing able to write to them, so until these
// routes existed a firm could not record a client's telephone number.

// Whether the firm MAY use a contact point and whether it SHOULD. Two facts, not one: a person can
// be reachable at a number they would rather the firm did not ring, and can ask to be reached by
// post while still holding an email address the firm may use. `isPrimary` is a third and different
// thing — the channel's default row — and stays on the contact point itself.
const ContactPreference = z
  .object({
    permitted: z
      .boolean()
      .optional()
      .openapi({
        description:
          "May the firm use this contact point. Defaults to true. A contact point the person asked " +
          "the firm not to use is recorded with the permission withdrawn and a note saying so, never " +
          "deleted: deleting it loses the instruction along with the value.",
      }),
    preferred: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Is this the one route the person asked to be reached by. At most one per entity across " +
          "email, phone and address together, because that preference is a single answer about every " +
          "channel; promoting one demotes whichever was preferred before, in any of the three.",
      }),
    note: z.string().max(1000).nullish().openapi({
      description: "Why the contact point may not be used, or how it should be.",
    }),
  })
  .openapi("DirectoryContactPreference");

const ContactVerification = z
  .object({
    status: z
      .enum(CONTACT_VERIFICATION_STATUSES)
      .optional()
      .openapi({
        description:
          "What the firm found when it last tried to confirm this contact point. A failed status " +
          "records returned mail, a bounced message or a disconnected line. It never blocks a send: " +
          "it is surfaced to whoever is about to send, and the send proceeds.",
      }),
    detail: z.string().max(1000).nullish().openapi({
      description: "What the failure said, in the words it said it.",
    }),
  })
  .openapi("DirectoryContactVerification");

const ContactPointState = z
  .object({
    permitted: z.boolean(),
    preferred: z.boolean(),
    note: z.string().nullable(),
    verificationStatus: z.enum(CONTACT_VERIFICATION_STATUSES),
    verifiedAt: z.string().nullable(),
    verificationDetail: z.string().nullable(),
  })
  .openapi("DirectoryContactPointState");

const DirectoryEmailEntry = z
  .object({
    id: z.string(),
    address: z.string(),
    contactUse: z.enum(CONTACT_USES).nullable(),
    isPrimary: z.boolean().openapi({
      description: "This channel's default row — where a message goes when no address was named.",
    }),
    state: ContactPointState,
  })
  .openapi("DirectoryEmailEntry");

const DirectoryPhoneEntry = z
  .object({
    id: z.string(),
    number: z.string().openapi({
      description:
        "The number exactly as it was entered. Never rewritten; this is what a screen shows.",
    }),
    contactSystem: z.enum(CONTACT_SYSTEMS).openapi({
      description:
        "What technology answers the number. A fax line is a fax by its system, not by a word in a " +
        "label, so a delivery path can ask the question and get an answer.",
    }),
    contactUse: z.enum(CONTACT_USES).nullable(),
    countryCallingCode: z
      .string()
      .nullable()
      .openapi({
        description:
          "Null where the number carried no country — a national-form number says nothing about " +
          "which country it belongs to, and the record says so rather than inventing one.",
      }),
    nationalNumber: z.string().nullable(),
    extension: z.string().nullable(),
    countryRegionCode: z.string().nullable(),
    isPrimary: z.boolean(),
    state: ContactPointState,
  })
  .openapi("DirectoryPhoneEntry");

const DirectoryAddressEntry = z
  .object({
    id: z.string(),
    recipient: z.string().nullable(),
    organizationName: z.string().nullable(),
    street: z.string().nullable(),
    streetTwo: z.string().nullable(),
    dependentLocality: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    postal: z.string().nullable(),
    sortingCode: z.string().nullable(),
    country: z.string().nullable(),
    addressUse: z.enum(ADDRESS_USES).nullable(),
    addressType: z.enum(ADDRESS_TYPES).openapi({
      description:
        "Whether the place physically exists. Personal service turns on this: a post office box is " +
        "postal and cannot be served, a registered office is physical and can.",
    }),
    isPrimary: z.boolean(),
    state: ContactPointState,
  })
  .openapi("DirectoryAddressEntry");

const DirectoryEmailsResponse = z
  .object({ data: z.array(DirectoryEmailEntry) })
  .openapi("DirectoryEmailsResponse");
const DirectoryPhonesResponse = z
  .object({ data: z.array(DirectoryPhoneEntry) })
  .openapi("DirectoryPhonesResponse");
const DirectoryAddressesResponse = z
  .object({ data: z.array(DirectoryAddressEntry) })
  .openapi("DirectoryAddressesResponse");

const DirectoryContactPointsResponse = z
  .object({
    emails: z.array(DirectoryEmailEntry),
    phones: z.array(DirectoryPhoneEntry),
    addresses: z.array(DirectoryAddressEntry),
  })
  .openapi("DirectoryContactPointsResponse");

const AddEmailRequest = z
  .object({
    address: z.string().min(3).max(320),
    contactUse: z.enum(CONTACT_USES).nullish(),
    isPrimary: z.boolean().optional(),
    preference: ContactPreference.optional(),
    verification: ContactVerification.optional(),
  })
  .openapi("AddDirectoryEmailRequest");

const UpdateEmailRequest = z
  .object({
    address: z.string().min(3).max(320).optional(),
    contactUse: z.enum(CONTACT_USES).nullish(),
    isPrimary: z.boolean().optional(),
    preference: ContactPreference.optional(),
    verification: ContactVerification.optional(),
  })
  .openapi("UpdateDirectoryEmailRequest");

const AddPhoneRequest = z
  .object({
    number: z
      .string()
      .min(1)
      .max(64)
      .openapi({
        description:
          "The number as it was written. Stored verbatim and never rewritten; the structured columns " +
          "beside it go null when it cannot be split, so an unparseable number is still recorded.",
      }),
    contactSystem: z.enum(CONTACT_SYSTEMS).optional(),
    contactUse: z.enum(CONTACT_USES).nullish(),
    extension: z.string().max(16).nullish(),
    countryRegionCode: z.string().length(2).nullish(),
    isPrimary: z.boolean().optional(),
    preference: ContactPreference.optional(),
    verification: ContactVerification.optional(),
  })
  .openapi("AddDirectoryPhoneRequest");

const UpdatePhoneRequest = z
  .object({
    number: z.string().min(1).max(64).optional(),
    contactSystem: z.enum(CONTACT_SYSTEMS).optional(),
    contactUse: z.enum(CONTACT_USES).nullish(),
    extension: z.string().max(16).nullish(),
    countryRegionCode: z.string().length(2).nullish(),
    isPrimary: z.boolean().optional(),
    preference: ContactPreference.optional(),
    verification: ContactVerification.optional(),
  })
  .openapi("UpdateDirectoryPhoneRequest");

// Every field optional and none of them assumed. Which fields a country's addresses use, what a
// reader there calls them and what order they read in are properties of the country, so nothing here
// requires a state or a numeric postal code — and an address a firm holds only half of is still the
// address it holds.
const addressFields = {
  recipient: z.string().max(200).nullish(),
  organizationName: z.string().max(200).nullish(),
  street: z.string().max(200).nullish(),
  streetTwo: z.string().max(200).nullish(),
  dependentLocality: z.string().max(200).nullish(),
  city: z.string().max(200).nullish(),
  region: z.string().max(200).nullish(),
  postal: z.string().max(32).nullish(),
  sortingCode: z.string().max(32).nullish(),
  country: z.string().length(2).nullish(),
  addressUse: z.enum(ADDRESS_USES).nullish(),
  addressType: z.enum(ADDRESS_TYPES).optional(),
  isPrimary: z.boolean().optional(),
  preference: ContactPreference.optional(),
  verification: ContactVerification.optional(),
};

const AddAddressRequest = z.object(addressFields).openapi("AddDirectoryAddressRequest");
const UpdateAddressRequest = z.object(addressFields).openapi("UpdateDirectoryAddressRequest");

const SetPersonLifeDatesRequest = z
  .object({
    dateOfBirth: z
      .string()
      .regex(CIVIL_DATE_PATTERN)
      .nullish()
      .openapi({
        description:
          "A plain calendar date. Held in the clear because every question a firm asks of a date of " +
          "birth is a range — is this client a minor, has a limitation period tolled — and a range " +
          "query over ciphertext is not a query.",
      }),
    dateOfDeath: z.string().regex(CIVIL_DATE_PATTERN).nullish(),
    deceased: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Separate from the date, because known dead with the date unknown is a state probate work " +
          "meets constantly. A recorded date of death implies this flag.",
      }),
  })
  .openapi("SetDirectoryPersonLifeDatesRequest");

// ---- creating a whole person in one request --------------------------------------------------
//
// The New Person screen reaches every section of the record at creation, and the record is written
// in ONE batch: either all of it lands or none of it does, so a person is never half-recorded and a
// retry never makes a second one. Every nested shape is the same shape its own route takes, so what
// the create accepts is exactly what the record's panes accept one at a time afterwards.

const PersonOtherNameRequest = z
  .object({
    given: z.string().min(1),
    family: z.string().min(1),
    nameRole: z.enum(NAME_ROLES),
    prefix: z.string().nullable().optional(),
    middle: z.string().nullable().optional(),
    suffix: z.string().nullable().optional(),
  })
  .openapi("CreateDirectoryPersonOtherName");

const PersonOrganizationRequest = z
  .object({
    organizationId: z.string().regex(directoryEntityIdPattern),
    edgeType: z.enum(EDGE_TYPES),
    personIs: z.enum(["from", "to"]).openapi({
      description:
        "Which end of the edge the person is. The type says which way a membership reads " +
        "(employment runs person to organization); the screen decides and the record keeps it.",
    }),
    role: z.string().max(120).nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
  })
  .openapi("CreateDirectoryPersonOrganization");

// A PERSON NEEDS A NAME, NOT TWO NAMES. A family name is optional here because plenty of people
// do not have one — a mononym is the ordinary form of a name in much of the world, and a firm that
// cannot file its client under the name that client actually has files them under a wrong one. The
// domain already carries this: `createPerson` computes the phonetic blocking codes from the family
// name where there is one and from the given name where there is not, so a mononym is indexed, is
// searchable and is checked for conflicts exactly like anybody else. A GIVEN name is still required
// — a person row with no name at all is a record nobody can find or refer to.
const CreatePersonRequest = z
  .object({
    given: z.string().min(1),
    family: z.string().optional(),
    prefix: z.string().nullable().optional(),
    middle: z.string().nullable().optional(),
    suffix: z.string().nullable().optional(),
    otherNames: z.array(PersonOtherNameRequest).max(20).optional(),
    pronouns: PronounSetSchema.nullable().optional(),
    dateOfBirth: z.string().nullable().optional(),
    dateOfDeath: z.string().nullable().optional(),
    emails: z.array(AddEmailRequest).max(20).optional(),
    phones: z.array(AddPhoneRequest).max(20).optional(),
    addresses: z.array(AddAddressRequest).max(20).optional(),
    identifiers: z.array(AddIdentifierRequest).max(20).optional(),
    organizations: z.array(PersonOrganizationRequest).max(50).optional(),
  })
  .openapi("CreateDirectoryPersonRequest");

const createPersonRoute = defineOpenAPIRoute(mutationMeta("createPerson", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/persons",
  description:
    "Creates a directory person from its structured name parts, seeding the current-name history row " +
    "and its phonetic blocking codes.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreatePersonRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The created person",
      content: { "application/json": { schema: CreatedEntityResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const contactPointIdParam = (prefix: string) =>
  z.object({
    id: z
      .string()
      .min(1)
      .regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`))
      .openapi({ param: { name: "id", in: "path" } }),
  });

const emailIdParam = contactPointIdParam("directoryEmail");
const phoneIdParam = contactPointIdParam("directoryPhone");
const addressIdParam = contactPointIdParam("directoryAddress");

// ---- contact-point routes ----------------------------------------------------------------------
const contactPointsRoute = defineOpenAPIRoute(readMeta("contactPoints", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/contact-points",
  description:
    "Every way the firm knows to reach one entity — email addresses, telephone and fax numbers, and " +
    "postal addresses — in one read, so a record screen makes one round trip rather than three for " +
    "one question a person asked once. Each carries whether the firm may use it, whether it is the " +
    "one route the person asked to be reached by, and what the firm found the last time it tried to " +
    "confirm it. The answer is bounded by the RECORD, not by a page: these are the ways one person or organization asked to be reached, entered by hand, one at a time, through a permission-gated route. No ingest path and no queue consumer writes these tables. " +
    "A record folded into another by a merge still answers, so an old link lands on something.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "Every contact point on this entity, by channel",
      content: { "application/json": { schema: DirectoryContactPointsResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listEmailsRoute = defineOpenAPIRoute(readMeta("listEmails", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/emails",
  description:
    "The email addresses the firm holds for one entity, the primary one first. The answer is bounded by the RECORD, not by a page: these are the ways one person or organization asked to be reached, entered by hand, one at a time, through a permission-gated route. No ingest path and no queue consumer writes these tables. " +
    "A caller wanting every channel at once reads contact-points instead of asking three times.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The entity's email addresses",
      content: { "application/json": { schema: DirectoryEmailsResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const addEmailRoute = defineOpenAPIRoute(mutationMeta("addEmail", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/entities/{id}/emails",
  description:
    "Records a email address for an entity. More than one is ordinary; isPrimary names this channel's " +
    "default row and demotes whichever held it. Setting the preference `preferred` demotes the " +
    "entity's preferred contact point across email, phone and address alike, because that " +
    "preference is one answer about every channel at once.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: AddEmailRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The email address was recorded",
      content: { "application/json": { schema: CreatedEntityResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const updateEmailRoute = defineOpenAPIRoute(mutationMeta("updateEmail", WRITE_PERMISSION), {
  method: "put",
  path: "/api/v1/directory/emails/{id}",
  description:
    "Changes a email address the firm already holds. An omitted field keeps its stored value, so an " +
    "edit to one field never silently withdraws a permission or reads back as a confirmation the " +
    "firm never made: the verification instant and the member who recorded it move only when the " +
    "verification status itself moves.",
  request: {
    headers: idempotencyKeyHeader,
    params: emailIdParam,
    body: { content: { "application/json": { schema: UpdateEmailRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The email address was updated",
      content: { "application/json": { schema: CreatedEntityResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const removeEmailRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("removeEmail", WRITE_PERMISSION),
    reversal: { kind: "inverse", by: "directory.addEmail" },
  },
  {
    method: "delete",
    path: "/api/v1/directory/emails/{id}",
    description:
      "Removes a email address from an entity. The row is retained and marked removed, never deleted, " +
      "so a document assembled from it and a conflicts report that named it stay reproducible. " +
      "Removing one that is already removed reports 404. Where the reason is that the person asked " +
      "the firm not to use it, withdraw the permission instead: that keeps the instruction attached " +
      "to the value, and removal does not.",
    request: { headers: idempotencyKeyHeader, params: emailIdParam },
    responses: {
      200: {
        description: "The email address was removed",
        content: { "application/json": { schema: CreatedEntityResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const listPhonesRoute = defineOpenAPIRoute(readMeta("listPhones", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/phones",
  description:
    "The telephone and fax numbers the firm holds for one entity, the primary one first. The answer is bounded by the RECORD, not by a page: these are the ways one person or organization asked to be reached, entered by hand, one at a time, through a permission-gated route. No ingest path and no queue consumer writes these tables. " +
    "A caller wanting every channel at once reads contact-points instead of asking three times.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The entity's telephone and fax numbers",
      content: { "application/json": { schema: DirectoryPhonesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const addPhoneRoute = defineOpenAPIRoute(mutationMeta("addPhone", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/entities/{id}/phones",
  description:
    "Records a telephone or fax number for an entity. More than one is ordinary; isPrimary names this channel's " +
    "default row and demotes whichever held it. Setting the preference `preferred` demotes the " +
    "entity's preferred contact point across email, phone and address alike, because that " +
    "preference is one answer about every channel at once.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: AddPhoneRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The telephone or fax number was recorded",
      content: { "application/json": { schema: CreatedEntityResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const updatePhoneRoute = defineOpenAPIRoute(mutationMeta("updatePhone", WRITE_PERMISSION), {
  method: "put",
  path: "/api/v1/directory/phones/{id}",
  description:
    "Changes a telephone or fax number the firm already holds. An omitted field keeps its stored value, so an " +
    "edit to one field never silently withdraws a permission or reads back as a confirmation the " +
    "firm never made: the verification instant and the member who recorded it move only when the " +
    "verification status itself moves.",
  request: {
    headers: idempotencyKeyHeader,
    params: phoneIdParam,
    body: { content: { "application/json": { schema: UpdatePhoneRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The telephone or fax number was updated",
      content: { "application/json": { schema: CreatedEntityResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const removePhoneRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("removePhone", WRITE_PERMISSION),
    reversal: { kind: "inverse", by: "directory.addPhone" },
  },
  {
    method: "delete",
    path: "/api/v1/directory/phones/{id}",
    description:
      "Removes a telephone or fax number from an entity. The row is retained and marked removed, never deleted, " +
      "so a document assembled from it and a conflicts report that named it stay reproducible. " +
      "Removing one that is already removed reports 404. Where the reason is that the person asked " +
      "the firm not to use it, withdraw the permission instead: that keeps the instruction attached " +
      "to the value, and removal does not.",
    request: { headers: idempotencyKeyHeader, params: phoneIdParam },
    responses: {
      200: {
        description: "The telephone or fax number was removed",
        content: { "application/json": { schema: CreatedEntityResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const listAddressesRoute = defineOpenAPIRoute(readMeta("listAddresses", null), {
  method: "get",
  path: "/api/v1/directory/entities/{id}/addresses",
  description:
    "The postal addresses the firm holds for one entity, the primary one first. The answer is bounded by the RECORD, not by a page: these are the ways one person or organization asked to be reached, entered by hand, one at a time, through a permission-gated route. No ingest path and no queue consumer writes these tables. " +
    "A caller wanting every channel at once reads contact-points instead of asking three times.",
  request: { params: entityParam },
  responses: {
    200: {
      description: "The entity's postal addresses",
      content: { "application/json": { schema: DirectoryAddressesResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const addAddressRoute = defineOpenAPIRoute(mutationMeta("addAddress", WRITE_PERMISSION), {
  method: "post",
  path: "/api/v1/directory/entities/{id}/addresses",
  description:
    "Records a postal address for an entity. More than one is ordinary; isPrimary names this channel's " +
    "default row and demotes whichever held it. Setting the preference `preferred` demotes the " +
    "entity's preferred contact point across email, phone and address alike, because that " +
    "preference is one answer about every channel at once.",
  request: {
    headers: idempotencyKeyHeader,
    params: entityParam,
    body: { content: { "application/json": { schema: AddAddressRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The postal address was recorded",
      content: { "application/json": { schema: CreatedEntityResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const updateAddressRoute = defineOpenAPIRoute(mutationMeta("updateAddress", WRITE_PERMISSION), {
  method: "put",
  path: "/api/v1/directory/addresses/{id}",
  description:
    "Changes a postal address the firm already holds. An omitted field keeps its stored value, so an " +
    "edit to one field never silently withdraws a permission or reads back as a confirmation the " +
    "firm never made: the verification instant and the member who recorded it move only when the " +
    "verification status itself moves.",
  request: {
    headers: idempotencyKeyHeader,
    params: addressIdParam,
    body: { content: { "application/json": { schema: UpdateAddressRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The postal address was updated",
      content: { "application/json": { schema: CreatedEntityResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const removeAddressRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("removeAddress", WRITE_PERMISSION),
    reversal: { kind: "inverse", by: "directory.addAddress" },
  },
  {
    method: "delete",
    path: "/api/v1/directory/addresses/{id}",
    description:
      "Removes a postal address from an entity. The row is retained and marked removed, never deleted, " +
      "so a document assembled from it and a conflicts report that named it stay reproducible. " +
      "Removing one that is already removed reports 404. Where the reason is that the person asked " +
      "the firm not to use it, withdraw the permission instead: that keeps the instruction attached " +
      "to the value, and removal does not.",
    request: { headers: idempotencyKeyHeader, params: addressIdParam },
    responses: {
      200: {
        description: "The postal address was removed",
        content: { "application/json": { schema: CreatedEntityResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const setPersonLifeDatesRoute = defineOpenAPIRoute(
  mutationMeta("setPersonLifeDates", WRITE_PERMISSION),
  {
    method: "put",
    path: "/api/v1/directory/persons/{id}/life-dates",
    description:
      "Records a person's date of birth, date of death, and whether they are known to have died. " +
      "These are attributes of a person rather than identifiers of one: nobody issued them, they " +
      "identify nobody uniquely, and every question a firm asks of them is a range — is this client " +
      "a minor, has a limitation period tolled, whose birthday falls this month. An omitted field " +
      "keeps its stored value; an explicit null clears it. A recorded date of death implies the " +
      "deceased flag, and known dead with the date unknown is a state the record can hold.",
    request: {
      headers: idempotencyKeyHeader,
      params: personParam,
      body: {
        content: { "application/json": { schema: SetPersonLifeDatesRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The dates were recorded",
        content: { "application/json": { schema: AckResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

type DirectoryApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerDirectoryRoutes(app: DirectoryApp, chokepoint: Chokepoint): void {
  // POST /api/v1/directory/persons
  app.openapi(
    { ...createPersonRoute, middleware: chokepointMiddleware(chokepoint, createPersonRoute) },
    async (c) => {
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      // Every identifier is checked for its shape before anything is composed, so a draft with a
      // short social security number is refused with the sentence the screen shows, not sealed.
      const identifiers: AddIdentifierInput[] = [];
      for (const identifier of request.identifiers ?? []) {
        const checked = checkIdentifier(identifier.type, {
          label: identifier.label ?? null,
          number: identifier.number,
          username: identifier.username ?? null,
          secret: identifier.secret ?? null,
        });
        if (!checked.ok) {
          return problemJson(c, {
            type: "validation",
            title: "Directory request invalid",
            status: 422,
            detail: checked.reason,
          });
        }
        identifiers.push({
          type: identifier.type,
          value: checked.value,
          label: checked.label,
          validFrom: identifier.validFrom ?? null,
          validTo: identifier.validTo ?? null,
        });
      }
      const context = await identifierContext(c, idempotency);
      try {
        const id = await createPersonRecord(context, {
          name: {
            given: request.given,
            family: request.family ?? "",
            prefix: request.prefix ?? null,
            middle: request.middle ?? null,
            suffix: request.suffix ?? null,
          },
          otherNames: (request.otherNames ?? []).map((name) => ({
            given: name.given,
            family: name.family,
            nameRole: name.nameRole,
            prefix: name.prefix ?? null,
            middle: name.middle ?? null,
            suffix: name.suffix ?? null,
          })),
          pronouns: request.pronouns ?? null,
          dateOfBirth: request.dateOfBirth ?? null,
          dateOfDeath: request.dateOfDeath ?? null,
          emails: (request.emails ?? []).map((email) => ({
            address: email.address,
            contactUse: email.contactUse ?? null,
            isPrimary: email.isPrimary,
            preference: email.preference,
            verification: email.verification,
          })),
          phones: (request.phones ?? []).map((phone) => ({
            number: phone.number,
            contactSystem: phone.contactSystem,
            contactUse: phone.contactUse ?? null,
            extension: phone.extension ?? null,
            countryRegionCode: phone.countryRegionCode ?? null,
            isPrimary: phone.isPrimary,
            preference: phone.preference,
            verification: phone.verification,
          })),
          addresses: (request.addresses ?? []).map((address) => ({
            recipient: address.recipient ?? null,
            organizationName: address.organizationName ?? null,
            street: address.street ?? null,
            streetTwo: address.streetTwo ?? null,
            dependentLocality: address.dependentLocality ?? null,
            city: address.city ?? null,
            region: address.region ?? null,
            postal: address.postal ?? null,
            sortingCode: address.sortingCode ?? null,
            country: address.country ?? null,
            addressUse: address.addressUse ?? null,
            addressType: address.addressType,
            isPrimary: address.isPrimary,
            preference: address.preference,
            verification: address.verification,
          })),
          identifiers,
          organizations: (request.organizations ?? []).map((organization) => ({
            organizationId: organization.organizationId,
            edgeType: organization.edgeType,
            personIs: organization.personIs,
            role: organization.role ?? null,
            note: organization.note ?? null,
          })),
        });
        return c.json({ id } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/persons/{id}
  app.openapi(
    { ...getPersonRoute, middleware: chokepointMiddleware(chokepoint, getPersonRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const person = await readPerson(firm.firmDatabase, id as DirectoryPersonId);
        return c.json(person as unknown as z.infer<typeof PersonDetail>, 200);
      } catch {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory person in this firm.",
        });
      }
    },
  );

  // PUT /api/v1/directory/persons/{id}/pronouns
  app.openapi(
    {
      ...setPersonPronounsRoute,
      middleware: chokepointMiddleware(chokepoint, setPersonPronounsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        await setPersonPronouns(
          firm.firmDatabase,
          id as DirectoryPersonId,
          request.pronouns,
          writeOptions(userId, idempotency),
        );
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 200);
      } catch (caught) {
        if (caught instanceof IncompletePronounSetError) {
          return problemJson(c, {
            type: "validation",
            title: "Directory request invalid",
            status: 422,
            detail: caught.message,
          });
        }
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // POST /api/v1/directory/organizations
  app.openapi(
    {
      ...createOrganizationRoute,
      middleware: chokepointMiddleware(chokepoint, createOrganizationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        const id = await createOrganization(
          firm.firmDatabase,
          { legalName: request.legalName, displayName: request.displayName ?? null },
          writeOptions(userId, idempotency),
        );
        return c.json({ id } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/organizations/{id}
  app.openapi(
    { ...getOrganizationRoute, middleware: chokepointMiddleware(chokepoint, getOrganizationRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const organization = await readOrganization(
          firm.firmDatabase,
          id as DirectoryOrganizationId,
        );
        return c.json(organization as unknown as z.infer<typeof OrganizationDetail>, 200);
      } catch {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory organization in this firm.",
        });
      }
    },
  );

  // POST /api/v1/directory/entities/{id}/names
  app.openapi(
    { ...addNameRoute, middleware: chokepointMiddleware(chokepoint, addNameRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const input =
          request.legalName !== undefined
            ? {
                nameRole: request.nameRole,
                legalName: request.legalName,
                displayName: request.displayName ?? null,
              }
            : {
                nameRole: request.nameRole,
                given: request.given ?? "",
                family: request.family ?? "",
                prefix: request.prefix ?? null,
                middle: request.middle ?? null,
                suffix: request.suffix ?? null,
              };
        await addName(firm.firmDatabase, id as EntityId, input, writeOptions(userId, idempotency));
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // PUT /api/v1/directory/entities/{id}/name — the name CHANGE, which retains the prior name
  app.openapi(
    { ...changeNameRoute, middleware: chokepointMiddleware(chokepoint, changeNameRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      // The kind comes from the handle, and the body must match it. The domain throws a bare Error
      // on a mismatched shape — a 500 for what is a caller mistake — so the shape is settled here,
      // where the caller gets a 422 naming the fields the entity it addressed actually takes.
      const isPerson = id.startsWith("directoryPerson_");
      if (isPerson && (request.given === undefined || request.family === undefined)) {
        return problemJson(c, {
          type: "validation",
          title: "Directory request invalid",
          status: 422,
          detail: "A person's name change supplies both given and family.",
        });
      }
      if (!isPerson && request.legalName === undefined) {
        return problemJson(c, {
          type: "validation",
          title: "Directory request invalid",
          status: 422,
          detail: "An organization's name change supplies legalName.",
        });
      }
      try {
        await changeName(
          firm.firmDatabase,
          id as EntityId,
          isPerson
            ? {
                given: request.given ?? "",
                family: request.family ?? "",
                prefix: request.prefix ?? null,
                middle: request.middle ?? null,
                suffix: request.suffix ?? null,
              }
            : {
                legalName: request.legalName ?? "",
                displayName: request.displayName ?? null,
              },
          writeOptions(userId, idempotency),
        );
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/names
  app.openapi(
    { ...listNamesRoute, middleware: chokepointMiddleware(chokepoint, listNamesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await readNames(firm.firmDatabase, id as EntityId, { cursor });
      return c.json(page as unknown as z.infer<typeof DirectoryNamePage>, 200);
    },
  );

  // GET /api/v1/directory/entities — the index, both kinds in one sequence
  app.openapi(
    { ...listEntitiesRoute, middleware: chokepointMiddleware(chokepoint, listEntitiesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { cursor, kind, search } = c.req.valid("query");
      const page = await readEntityListing(firm.firmDatabase, {
        cursor,
        kind: kind ?? "all",
        search,
      });
      return c.json(page as unknown as z.infer<typeof DirectoryEntityListingPage>, 200);
    },
  );

  // GET /api/v1/directory/entity-names?ids= — the naming read, many entities in one request
  app.openapi(
    { ...entityNamesRoute, middleware: chokepointMiddleware(chokepoint, entityNamesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { ids } = c.req.valid("query");
      const requested = ids
        .split(",")
        .map((entityId) => entityId.trim())
        .filter((entityId) => entityId !== "");
      // Refused, not truncated. A caller handed a short answer to a long question would believe the
      // missing entities are ones the firm does not hold, and blank the wrong rows.
      if (requested.length > MAX_ENTITY_DISPLAY_NAME_LOOKUP) {
        return problemJson(c, {
          type: "validation",
          title: "Directory request invalid",
          status: 422,
          detail: `At most ${String(MAX_ENTITY_DISPLAY_NAME_LOOKUP)} ids per call; ${String(requested.length)} were supplied.`,
        });
      }
      const data = await readEntityDisplayNames(firm.firmDatabase, requested);
      return c.json({ data } as z.infer<typeof EntityDisplayNamesResponse>, 200);
    },
  );

  // GET /api/v1/directory/entities/{id}/edges
  app.openapi(
    { ...listEdgesRoute, middleware: chokepointMiddleware(chokepoint, listEdgesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { cursor, includeExpired } = c.req.valid("query");
      const page = await readEdgesPage(firm.firmDatabase, id as EntityId, {
        cursor,
        includeExpired: includeExpired === "true",
      });
      // ONE naming read for the whole page. Resolving each far end on its own is the per-row request
      // this endpoint's sibling exists to prevent, and doing it here would be that same mistake
      // moved server-side.
      const names = new Map(
        (
          await readEntityDisplayNames(
            firm.firmDatabase,
            page.data.map((edge) =>
              edge.fromEntityId === id ? edge.toEntityId : edge.fromEntityId,
            ),
          )
        ).map((entry) => [entry.entityId, entry]),
      );
      const body: z.infer<typeof DirectoryEdgePage> = {
        data: page.data.map((edge) => {
          const outbound = edge.fromEntityId === id;
          const farEntityId = outbound ? edge.toEntityId : edge.fromEntityId;
          const far = names.get(farEntityId);
          return {
            id: edge.id,
            edgeType: edge.edgeType,
            direction: outbound ? "outbound" : "inbound",
            farEntityId,
            farEntityKind: far?.entityKind ?? "unknown",
            farDisplayName: far?.displayName ?? null,
            role: edge.role,
            note: edge.note,
            validFrom: edge.validFrom,
            validTo: edge.validTo,
          };
        }),
        nextCursor: page.nextCursor,
      };
      return c.json(body, 200);
    },
  );

  // GET /api/v1/directory/entities/{id}/matter-parties
  app.openapi(
    {
      ...listEntityMatterPartiesRoute,
      middleware: chokepointMiddleware(chokepoint, listEntityMatterPartiesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await readMatterPartiesForEntity(firm.firmDatabase, id, { cursor });
      return c.json(page as unknown as z.infer<typeof EntityMatterPartyPage>, 200);
    },
  );

  // GET /api/v1/directory/categories
  app.openapi(
    { ...listCategoriesRoute, middleware: chokepointMiddleware(chokepoint, listCategoriesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const categories = await listCategories(firm.firmDatabase);
      return c.json(
        { data: categories.map(toCategoryEntry) } as z.infer<typeof DirectoryCategoriesResponse>,
        200,
      );
    },
  );

  // GET /api/v1/directory/entities/{id}/categories
  app.openapi(
    {
      ...listEntityCategoriesRoute,
      middleware: chokepointMiddleware(chokepoint, listEntityCategoriesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const categories = await readCategories(firm.firmDatabase, id);
      return c.json(
        { data: categories.map(toCategoryEntry) } as z.infer<typeof DirectoryCategoriesResponse>,
        200,
      );
    },
  );

  // GET /api/v1/directory/entities/{id}/identifiers — describes what is held, decrypts nothing
  app.openapi(
    { ...listIdentifiersRoute, middleware: chokepointMiddleware(chokepoint, listIdentifiersRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const data = await listIdentifierRecords(firm.firmDatabase, id);
      return c.json({ data } as unknown as z.infer<typeof DirectoryIdentifierRecordsResponse>, 200);
    },
  );

  // POST /api/v1/directory/entities/{id}/identifiers
  app.openapi(
    { ...addIdentifierRoute, middleware: chokepointMiddleware(chokepoint, addIdentifierRoute) },
    async (c) => {
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      const checked = checkIdentifier(request.type, {
        label: request.label ?? null,
        number: request.number,
        username: request.username ?? null,
        secret: request.secret ?? null,
      });
      if (!checked.ok) {
        return problemJson(c, {
          type: "validation",
          title: "Directory request invalid",
          status: 422,
          detail: checked.reason,
        });
      }
      const context = await identifierContext(c, idempotency);
      try {
        await addIdentifier(context, id, {
          type: request.type,
          value: checked.value,
          label: checked.label,
          validFrom: request.validFrom ?? null,
          validTo: request.validTo ?? null,
        });
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/identifiers/{type} — the audited decrypt path
  app.openapi(
    { ...readIdentifierRoute, middleware: chokepointMiddleware(chokepoint, readIdentifierRoute) },
    async (c) => {
      const { id, type } = c.req.valid("param");
      const context = await identifierContext(c);
      try {
        const sealed = await readIdentifier(context, id, type);
        // An account was sealed as its three parts together; the reveal hands them back apart.
        const body: z.infer<typeof IdentifierValueResponse> =
          sealed !== null && type === "account"
            ? (() => {
                const account = parseAccountValue(sealed);
                return {
                  value: account.number,
                  username: account.username,
                  secret: account.secret,
                };
              })()
            : { value: sealed };
        return c.json(body, 200);
      } catch (caught) {
        // The chokepoint already gates directory:viewSensitiveIdentifiers before this handler, so a
        // forbidden read is normally unreachable — but if the protected-field gate ever refuses, surface
        // a structured 403 (never a 500, never the plaintext) instead of an unhandled throw.
        if (caught instanceof ProtectedReadForbiddenError) {
          return problemJson(c, {
            type: "permission-denied",
            title: "Forbidden",
            status: 403,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );

  // POST /api/v1/directory/edges
  app.openapi(
    { ...createEdgeRoute, middleware: chokepointMiddleware(chokepoint, createEdgeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        const id = await createEdge(
          firm.firmDatabase,
          {
            from: request.from as EntityId,
            to: request.to as EntityId,
            edgeType: request.edgeType,
            role: request.role ?? null,
            note: request.note ?? null,
            validFrom: request.validFrom ?? null,
            validTo: request.validTo ?? null,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // POST /api/v1/directory/categories
  app.openapi(
    { ...createCategoryRoute, middleware: chokepointMiddleware(chokepoint, createCategoryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        const { id } = await createCategory(
          firm.firmDatabase,
          { name: request.name, appliesTo: request.appliesTo, position: request.position },
          writeOptions(userId, idempotency),
        );
        return c.json({ id } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // POST /api/v1/directory/category-assignments
  app.openapi(
    { ...assignCategoryRoute, middleware: chokepointMiddleware(chokepoint, assignCategoryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        await assignCategory(
          firm.firmDatabase,
          { entityId: request.entityId, categoryId: request.categoryId },
          writeOptions(userId, idempotency),
        );
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/search?q=
  app.openapi(
    { ...searchRoute, middleware: chokepointMiddleware(chokepoint, searchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { q } = c.req.valid("query");
      const { hits, capped } = await searchNames(firm.firmDatabase, q);
      return c.json({ data: hits, capped } as unknown as z.infer<typeof SearchResponse>, 200);
    },
  );

  // POST /api/v1/directory/duplicate-candidates — read-shaped POST
  app.openapi(
    {
      ...duplicateCandidatesRoute,
      middleware: chokepointMiddleware(chokepoint, duplicateCandidatesRoute),
    },
    async (c) => {
      const request = c.req.valid("json");
      const context = await identifierContext(c);
      const candidates = await findDuplicateCandidates(context, {
        kind: request.kind,
        given: request.given,
        family: request.family,
        legalName: request.legalName,
        identifiers: request.identifiers,
        excludeEntityId: request.excludeEntityId,
      });
      // Project to the declared contract: channels/identifierTypes are internal evidence-tiering
      // detail for the conflicts engine's direct package consumer, not part of the HTTP response.
      //
      // The display identity rides along, resolved in ONE naming read over the whole answer. A
      // candidate list is a list, and a caller that resolved each candidate itself made one request
      // per candidate — which is exactly the shape the naming read exists to end.
      const names = new Map(
        (
          await readEntityDisplayNames(
            context.database,
            candidates.map((candidate) => candidate.entityId),
          )
        ).map((entry) => [entry.entityId, entry]),
      );
      const data = candidates.map(({ entityId, signalCount }) => {
        const named = names.get(entityId);
        return {
          entityId,
          signalCount,
          entityKind: named?.entityKind ?? ("unknown" as const),
          displayName: named?.displayName ?? null,
        };
      });
      const body: z.infer<typeof DuplicateCandidatesResponse> = { data };
      return c.json(body, 200);
    },
  );

  // POST /api/v1/directory/merges — merged_by is the authenticated actor
  app.openapi(
    { ...mergeRoute, middleware: chokepointMiddleware(chokepoint, mergeRoute) },
    async (c) => {
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const context = await identifierContext(c, idempotency);
      try {
        const mergeId = await mergeEntities(context, {
          masterId: request.masterId,
          subordinateId: request.subordinateId,
          survivorship: request.survivorship ?? {},
        });
        return c.json({ mergeId } as z.infer<typeof MergeResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // POST /api/v1/directory/matter-parties
  app.openapi(
    { ...linkMatterPartyRoute, middleware: chokepointMiddleware(chokepoint, linkMatterPartyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        const id = await linkMatterParty(
          firm.firmDatabase,
          {
            matterId: request.matterId,
            entityId: request.entityId,
            role: request.role,
            capacity: request.capacity ?? null,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id } as z.infer<typeof MatterPartyResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/matter-parties
  app.openapi(
    {
      ...listMatterPartiesRoute,
      middleware: chokepointMiddleware(chokepoint, listMatterPartiesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("query");
      const parties = await readMatterParties(firm.firmDatabase, matterId);
      return c.json({ parties } as z.infer<typeof MatterPartyListResponse>, 200);
    },
  );

  // DELETE /api/v1/directory/matter-parties/{id}
  app.openapi(
    {
      ...unlinkMatterPartyRoute,
      middleware: chokepointMiddleware(chokepoint, unlinkMatterPartyRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const unlinked = await unlinkMatterParty(
          firm.firmDatabase,
          id as MatterPartyId,
          writeOptions(userId, idempotency),
        );
        // A link that was already severed, or never existed, is indistinguishable from here and
        // both are "there is no live link at this id" — one 404 for both, rather than inventing a
        // distinction the caller cannot act on differently.
        if (!unlinked) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No live party link carries this id.",
          });
        }
        return c.json({ unlinked } as z.infer<typeof UnlinkMatterPartyResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );
  // GET /api/v1/directory/entities/{id}/contact-points
  app.openapi(
    { ...contactPointsRoute, middleware: chokepointMiddleware(chokepoint, contactPointsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const points = await readContactPoints(firm.firmDatabase, id);
        return c.json(points as unknown as z.infer<typeof DirectoryContactPointsResponse>, 200);
      } catch {
        // The only thing this read can fail on is an entity the firm does not hold; every other
        // outcome is an empty channel, which is an answer.
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory record in this firm.",
        });
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/emails
  app.openapi(
    { ...listEmailsRoute, middleware: chokepointMiddleware(chokepoint, listEmailsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const { emails } = await readContactPoints(firm.firmDatabase, id);
        return c.json({ data: emails } as unknown as z.infer<typeof DirectoryEmailsResponse>, 200);
      } catch {
        // The only thing this read can fail on is an entity the firm does not hold; every other
        // outcome is an empty channel, which is an answer.
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory record in this firm.",
        });
      }
    },
  );

  // POST /api/v1/directory/entities/{id}/emails
  app.openapi(
    { ...addEmailRoute, middleware: chokepointMiddleware(chokepoint, addEmailRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const emailId = await addEmail(
          firm.firmDatabase,
          {
            entityId: id,
            address: request.address,
            contactUse: request.contactUse ?? null,
            isPrimary: request.isPrimary,
            preference: request.preference,
            verification: request.verification,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: emailId } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // PUT /api/v1/directory/emails/{id}
  app.openapi(
    { ...updateEmailRoute, middleware: chokepointMiddleware(chokepoint, updateEmailRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const emailId = await updateEmail(
          firm.firmDatabase,
          {
            emailId: id,
            address: request.address,
            contactUse: request.contactUse,
            isPrimary: request.isPrimary,
            preference: request.preference,
            verification: request.verification,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: emailId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // DELETE /api/v1/directory/emails/{id}
  app.openapi(
    { ...removeEmailRoute, middleware: chokepointMiddleware(chokepoint, removeEmailRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const emailId = await removeEmail(firm.firmDatabase, id, writeOptions(userId, idempotency));
        return c.json({ id: emailId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/phones
  app.openapi(
    { ...listPhonesRoute, middleware: chokepointMiddleware(chokepoint, listPhonesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const { phones } = await readContactPoints(firm.firmDatabase, id);
        return c.json({ data: phones } as unknown as z.infer<typeof DirectoryPhonesResponse>, 200);
      } catch {
        // The only thing this read can fail on is an entity the firm does not hold; every other
        // outcome is an empty channel, which is an answer.
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory record in this firm.",
        });
      }
    },
  );

  // POST /api/v1/directory/entities/{id}/phones
  app.openapi(
    { ...addPhoneRoute, middleware: chokepointMiddleware(chokepoint, addPhoneRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const phoneId = await addPhone(
          firm.firmDatabase,
          {
            entityId: id,
            number: request.number,
            contactSystem: request.contactSystem,
            contactUse: request.contactUse ?? null,
            extension: request.extension,
            countryRegionCode: request.countryRegionCode,
            isPrimary: request.isPrimary,
            preference: request.preference,
            verification: request.verification,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: phoneId } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // PUT /api/v1/directory/phones/{id}
  app.openapi(
    { ...updatePhoneRoute, middleware: chokepointMiddleware(chokepoint, updatePhoneRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const phoneId = await updatePhone(
          firm.firmDatabase,
          {
            phoneId: id,
            number: request.number,
            contactSystem: request.contactSystem,
            contactUse: request.contactUse,
            extension: request.extension,
            countryRegionCode: request.countryRegionCode,
            isPrimary: request.isPrimary,
            preference: request.preference,
            verification: request.verification,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: phoneId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // DELETE /api/v1/directory/phones/{id}
  app.openapi(
    { ...removePhoneRoute, middleware: chokepointMiddleware(chokepoint, removePhoneRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const phoneId = await removePhone(firm.firmDatabase, id, writeOptions(userId, idempotency));
        return c.json({ id: phoneId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/directory/entities/{id}/addresses
  app.openapi(
    { ...listAddressesRoute, middleware: chokepointMiddleware(chokepoint, listAddressesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      try {
        const { addresses } = await readContactPoints(firm.firmDatabase, id);
        return c.json(
          { data: addresses } as unknown as z.infer<typeof DirectoryAddressesResponse>,
          200,
        );
      } catch {
        // The only thing this read can fail on is an entity the firm does not hold; every other
        // outcome is an empty channel, which is an answer.
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such directory record in this firm.",
        });
      }
    },
  );

  // POST /api/v1/directory/entities/{id}/addresses
  app.openapi(
    { ...addAddressRoute, middleware: chokepointMiddleware(chokepoint, addAddressRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const addressId = await addAddress(
          firm.firmDatabase,
          { ...request, entityId: id },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: addressId } as z.infer<typeof CreatedEntityResponse>, 201);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // PUT /api/v1/directory/addresses/{id}
  app.openapi(
    { ...updateAddressRoute, middleware: chokepointMiddleware(chokepoint, updateAddressRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const addressId = await updateAddress(
          firm.firmDatabase,
          { ...request, addressId: id },
          writeOptions(userId, idempotency),
        );
        return c.json({ id: addressId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // DELETE /api/v1/directory/addresses/{id}
  app.openapi(
    { ...removeAddressRoute, middleware: chokepointMiddleware(chokepoint, removeAddressRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const addressId = await removeAddress(
          firm.firmDatabase,
          id,
          writeOptions(userId, idempotency),
        );
        return c.json({ id: addressId } as z.infer<typeof CreatedEntityResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );

  // PUT /api/v1/directory/persons/{id}/life-dates
  app.openapi(
    {
      ...setPersonLifeDatesRoute,
      middleware: chokepointMiddleware(chokepoint, setPersonLifeDatesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        await setPersonLifeDates(
          firm.firmDatabase,
          id as DirectoryPersonId,
          {
            dateOfBirth: request.dateOfBirth,
            dateOfDeath: request.dateOfDeath,
            deceased: request.deceased,
          },
          writeOptions(userId, idempotency),
        );
        return c.json({ ok: true } as z.infer<typeof AckResponse>, 200);
      } catch (caught) {
        return directoryErrorResponse(c, caught);
      }
    },
  );
}

import { z } from "zod";
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { paginated } from "@magna-carta/data-access/pagination-contract";
import { identifierField } from "@magna-carta/identifiers/field";
import { PRONOUN_VERB_NUMBERS } from "./pronouns.ts";
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
} from "./types.ts";

// The directory's contract: what its API accepts in a request body and returns in a response, as
// plain zod. Each component is named with zod's own metadata (`.meta({ id })`), which the contract
// emitter reads as the component's name, so a shape and its name live together here and the route
// module in apps/api-worker declares routes over these without restating a field. Path and query
// parameters stay with the routes: they are addressing, not domain shape. The rule and its reasoning
// are in docs/conventions/api.md (_Where a contract shape lives_).

// A directory-entity handle: a person OR an organization, told apart by its prefix. A shape that
// names an entity takes either kind, and the service resolves which from the prefix.
export const directoryEntityIdPattern = /^(directoryPerson|directoryOrganization)_[A-Za-z0-9_-]+$/;

export const CreatedEntityResponse = z
  .object({ id: z.string() })
  .meta({ id: "CreatedDirectoryEntityResponse" });

// A person's pronouns, as the person states them. WHOLE OR NOT AT ALL: every form is required
// together, because a half-recorded set is what puts one set's "she" and another's "them" in the
// same sentence of a document that gets filed. Nothing here is derived from the name parts, and no
// request may ask the platform to work a set out — it is stated or it is absent.
//
// ONE registered component, already nullable, used verbatim by both the read and the write. Applying
// `.nullable()` or a second `.meta({ id })` at a use site re-registers the name under a different shape
// — the contract conformance check rejects that, and the emitted component would be right for
// neither caller.
export const PronounSetSchema = z
  .object({
    subject: z.string().min(1).meta({ description: "As in: she signed." }),
    object: z.string().min(1).meta({ description: "As in: we served her." }),
    possessiveDeterminer: z.string().min(1).meta({ description: "As in: her signature." }),
    possessivePronoun: z.string().min(1).meta({ description: "As in: the signature is hers." }),
    reflexive: z.string().min(1).meta({ description: "As in: she represented herself." }),
    verbNumber: z.enum(PRONOUN_VERB_NUMBERS).meta({
      description:
        'Which verb form the set takes: "singular" for she is / he is, "plural" for they are. Recorded rather than worked out — nothing about the forms themselves says which.',
    }),
  })
  .nullable()
  .meta({
    id: "DirectoryPronounSet",
    description:
      "The complete set of pronouns a person stated, or null where they stated none — which is the ordinary case and not a gap to fill in. Recorded whole: a partly supplied set is refused, because a document rendering one set's pronoun in one clause and another's in the next is wrong in a way nobody catches by reading it.",
  });

export const PersonDetail = z
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
  .meta({ id: "DirectoryPersonDetail" });

export const SetPronounsRequest = z
  .object({
    pronouns: PronounSetSchema,
  })
  .meta({ id: "SetDirectoryPersonPronounsRequest" });

export const CreateOrganizationRequest = z
  .object({
    legalName: z.string().min(1),
    displayName: z.string().nullable().optional(),
  })
  .meta({ id: "CreateDirectoryOrganizationRequest" });

export const OrganizationDetail = z
  .object({
    id: z.string(),
    legalName: z.string().nullable(),
    displayName: z.string().nullable(),
    status: z.string(),
    mergedIntoId: z.string().nullable(),
  })
  .meta({ id: "DirectoryOrganizationDetail" });

export const AddNameRequest = z
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
  .meta({ id: "AddDirectoryNameRequest" });

export const AckResponse = z.object({ ok: z.boolean() }).meta({ id: "DirectoryAckResponse" });

// A NAME CHANGE, which is a different act from appending an alias and the only one that can record
// a marriage. Supply the person fields or the organization field, matching the entity the id names —
// the kind is resolved from the handle, and a body shaped for the other kind is refused rather than
// half-applied.
export const ChangeNameRequest = z
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
  .meta({ id: "ChangeDirectoryNameRequest" });

// One name an entity has held — the shape a history rail reads.
export const DirectoryNameEntry = z
  .object({
    id: z.string(),
    nameRole: z.string().meta({
      description:
        "What this name is to the entity: its current name, a former one, a maiden name, a " +
        "trading name. An open catalog, not a closed enum.",
    }),
    isCurrent: z.boolean().meta({
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
      .meta({
        description:
          "The name as it was recorded. Null for an organization: an organization's name row " +
          "keeps only the case-folded form, so a caller falls back to normalizedDisplay and shows " +
          "an honest lowercase former name rather than an invented capitalization.",
      }),
    normalizedDisplay: z.string().meta({
      description:
        "The case-folded, punctuation-stripped form the search and conflicts corpus matches on. " +
        "Always present, for every name row of either kind.",
    }),
    validFrom: z.string().nullable(),
    validTo: z
      .string()
      .nullable()
      .meta({ description: "When the name stopped being used, or null while it still is." }),
    recordedAt: z.string().meta({
      description:
        "When the firm wrote the row down — which is not when the name came into use. A maiden " +
        "name recorded onto a twenty-year-old file was recorded today and valid decades ago.",
    }),
  })
  .meta({ id: "DirectoryNameEntry" });

export const DirectoryNamePage = paginated(DirectoryNameEntry).meta({ id: "DirectoryNamePage" });

// The type decides the fields, and the shape is checked before anything is sealed
// (packages/directory/src/identifier-shape.ts): a social security number is nine digits, a licence
// needs the region that issued it, a bar number its jurisdiction, and an account is who it is held
// with plus the number, with the username and secret that belong to it. A value that does not fit
// is refused with the sentence the screen shows beside the field.
export const AddIdentifierRequest = z
  .object({
    type: z.enum(IDENTIFIER_TYPES),
    label: z
      .string()
      .max(120)
      .nullish()
      .meta({
        description:
          "The plaintext part a list shows without a reveal: the state or country that issued a " +
          "licence, the jurisdiction behind a bar number, who an account is held with. Required " +
          "where the type has one; never any part of the value.",
      }),
    number: z.string().min(1).max(128),
    username: z.string().max(128).nullish().meta({ description: "An account's username." }),
    secret: z
      .string()
      .max(256)
      .nullish()
      .meta({ description: "An account's secret, sealed beside its number and never indexed." }),
    validFrom: z.string().nullable().optional(),
    validTo: z.string().nullable().optional(),
  })
  .meta({ id: "AddDirectoryIdentifierRequest" });

export const IdentifierValueResponse = z
  .object({
    value: z.string().nullable().meta({
      description:
        "The decrypted value — for an account, its number; the username and secret ride beside it.",
    }),
    username: z.string().nullable().optional(),
    secret: z.string().nullable().optional(),
  })
  .meta({ id: "DirectoryIdentifierValueResponse" });

export const CreateEdgeRequest = z
  .object({
    from: z.string().regex(directoryEntityIdPattern),
    to: z.string().regex(directoryEntityIdPattern),
    edgeType: z.enum(EDGE_TYPES),
    role: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    validFrom: z.string().nullable().optional(),
    validTo: z.string().nullable().optional(),
  })
  .meta({ id: "CreateDirectoryEdgeRequest" });

export const CreateCategoryRequest = z
  .object({
    name: z.string().min(1),
    appliesTo: z.enum(["person", "organization", "both"]),
    position: z.number().int().optional(),
  })
  .meta({ id: "CreateDirectoryCategoryRequest" });

export const AssignCategoryRequest = z
  .object({
    entityId: z.string().regex(directoryEntityIdPattern),
    categoryId: identifierField("directoryCategory"),
  })
  .meta({ id: "AssignDirectoryCategoryRequest" });

export const SearchHit = z
  .object({
    entityId: z.string(),
    entityKind: z.string(),
    displayName: z.string(),
    matchedName: z.string().meta({
      description:
        "WHICH of the entity's names the query landed on. A search that reported only the " +
        "current name made a hit on a maiden name indistinguishable from a hit on the name " +
        "typed, which defeats the point of keeping every name an entity has held.",
    }),
    matchedNameRole: z.string().meta({
      description: "What that matched name is to the entity — current, former, maiden, dba.",
    }),
    matchedNameIsCurrent: z.boolean(),
    relevance: z.number(),
  })
  .meta({ id: "DirectorySearchHit" });

export const SearchResponse = z
  .object({
    data: z.array(SearchHit),
    // True when the firm holds more matches than were returned. A relevance-ranked search answers
    // with its best matches rather than all of them, and a caller must be able to tell a short
    // answer from a complete one — otherwise "no more results" and "we stopped counting" look alike.
    capped: z.boolean(),
  })
  .meta({ id: "DirectorySearchResponse" });

export const DuplicateCandidatesRequest = z
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
  .meta({ id: "DirectoryDuplicateCandidatesRequest" });

export const DuplicateCandidate = z
  .object({
    entityId: z.string(),
    signalCount: z.number(),
    // The candidate's display identity travels WITH the candidate. It is the same naming read
    // /directory/entity-names performs, run once over the whole answer here: a caller that resolved
    // each candidate itself made one request per candidate, and a duplicate check is a list.
    entityKind: z.enum(["person", "organization", "unknown"]).meta({
      description:
        "Which side of the directory the candidate resolves to. 'unknown' means the blocking " +
        "channels surfaced an entity the node tables no longer hold — a fact worth showing.",
    }),
    displayName: z
      .string()
      .nullable()
      .meta({
        description:
          "What to call the candidate, or null where the directory holds no name for it. A caller " +
          "shows the gap rather than printing the handle.",
      }),
  })
  .meta({ id: "DirectoryDuplicateCandidate" });

export const DuplicateCandidatesResponse = z
  .object({ data: z.array(DuplicateCandidate) })
  .meta({ id: "DirectoryDuplicateCandidatesResponse" });

export const MergeRequest = z
  .object({
    masterId: z.string().regex(directoryEntityIdPattern),
    subordinateId: z.string().regex(directoryEntityIdPattern),
    // The survivorship choice per conflicting node column: "subordinate" means the master takes the
    // subordinate's value. An absent column keeps the master's own value.
    survivorship: z.record(z.string(), z.literal("subordinate")).optional(),
  })
  .meta({ id: "DirectoryMergeRequest" });

export const MergeResponse = z
  .object({ mergeId: z.string() })
  .meta({ id: "DirectoryMergeResponse" });

export const LinkMatterPartyRequest = z
  .object({
    matterId: identifierField("matter"),
    entityId: z.string().regex(directoryEntityIdPattern),
    role: z.string().min(1),
    capacity: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .meta({
        description:
          "The capacity the entity acts in on this matter — Administrator, Trustee, " +
          "Attorney-in-fact. Recorded by the firm, never inferred; documents that name a capacity " +
          "read this value and show an honest gap where none was recorded.",
      }),
  })
  .meta({ id: "LinkMatterPartyRequest" });

export const MatterPartyResponse = z.object({ id: z.string() }).meta({ id: "MatterPartyResponse" });

export const MatterPartyEntry = z
  .object({
    id: z.string(),
    matterId: z.string(),
    entityId: z.string(),
    role: z.string(),
    capacity: z
      .string()
      .nullable()
      .meta({
        description:
          "The capacity recorded on this link, or null where the firm recorded none. A null is an " +
          "honest absence and never a default — nothing infers a capacity from the role.",
      }),
    entityKind: z.enum(["person", "organization", "unknown"]).meta({
      description:
        "Which side of the directory the entity resolves to. 'unknown' means the link points at " +
        "an entity that is no longer there, which is a fact worth showing rather than hiding.",
    }),
    displayName: z
      .string()
      .nullable()
      .meta({
        description:
          "What to call this party, or null when the directory holds no name for the entity. A " +
          "caller shows the identifier itself rather than inventing a placeholder.",
      }),
  })
  .meta({ id: "MatterPartyEntry" });

export const MatterPartyListResponse = z
  .object({ parties: z.array(MatterPartyEntry) })
  .meta({ id: "MatterPartyListResponse" });

export const UnlinkMatterPartyResponse = z
  .object({ unlinked: z.boolean() })
  .meta({ id: "UnlinkMatterPartyResponse" });

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

export const EntityDisplayName = z
  .object({
    entityId: z.string(),
    entityKind: z.enum(["person", "organization"]),
    displayName: z
      .string()
      .nullable()
      .meta({
        description:
          "What to call this entity, or null where the directory holds no name for it at all. A " +
          "caller renders the gap and never falls back to printing the handle.",
      }),
    mergedIntoId: z
      .string()
      .nullable()
      .meta({
        description:
          "The surviving record this one was folded into, or null while it stands on its own. A " +
          "list row naming a folded record has to say so.",
      }),
  })
  .meta({ id: "DirectoryEntityDisplayName" });

export const EntityDisplayNamesResponse = z
  .object({ data: z.array(EntityDisplayName) })
  .meta({ id: "DirectoryEntityDisplayNamesResponse" });

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
export const DirectoryEntityListing = z
  .object({
    entityId: z.string(),
    entityKind: z.enum(ENTITY_KINDS),
    displayName: z
      .string()
      .nullable()
      .meta({
        description:
          "What to call the record, or null where the directory holds no name for it at all. A " +
          "caller shows the gap rather than printing the handle.",
      }),
    legalName: z
      .string()
      .nullable()
      .meta({
        description:
          "An organization's legal name where it differs from what the firm calls it; null for a " +
          "person, and null where the two are the same word.",
      }),
    givenName: z
      .string()
      .nullable()
      .meta({ description: "A person's first name. Null for an organization." }),
    middleName: z
      .string()
      .nullable()
      .meta({ description: "A person's middle name, where the firm recorded one." }),
    familyName: z
      .string()
      .nullable()
      .meta({
        description:
          "A person's last name. Null for an organization, and null for a person who has one " +
          "name — a record with no family name is one the firm keeps, not one it refuses.",
      }),
    emailAddress: z
      .string()
      .nullable()
      .meta({
        description:
          "The record's default email address — the primary row where one is marked, else the " +
          "oldest. Null where the firm holds none. Not a contact register: the record's own " +
          "contact-points read is where every channel lives.",
      }),
    phoneNumber: z.string().nullable().meta({
      description: "The record's default number, exactly as it was entered and never rewritten.",
    }),
    city: z
      .string()
      .nullable()
      .meta({ description: "The locality of the record's default address." }),
    region: z
      .string()
      .nullable()
      .meta({
        description:
          "The administrative area of the default address — state, province, prefecture — where " +
          "the country has one.",
      }),
    country: z
      .string()
      .nullable()
      .meta({ description: "The default address's country, ISO 3166-1 alpha-2." }),
    recordedAt: z.string().meta({ description: "When the firm wrote the record down." }),
    changedAt: z.string().meta({
      description:
        "When the record itself last changed. A change to something hanging off it — a name " +
        "appended, an address added — does not move this.",
    }),
  })
  .meta({ id: "DirectoryEntityListing" });

// The page envelope plus the size of the whole record. `total` is what separates a listing from a
// capped answer: a page of fifty out of two thousand and a page of fifty that IS the directory are
// indistinguishable without it, and a firm that has entered twenty clients expects to be told it
// holds twenty.
export const DirectoryEntityListingPage = paginated(DirectoryEntityListing)
  .extend({
    total: z
      .number()
      .int()
      .meta({
        description:
          "How many records the firm holds under these filters — every page of the walk when the " +
          "directory is being listed, and the number of records answering when it is being " +
          "searched, because a ranked answer's size is the answer's and not the book's.",
      }),
    capped: z.boolean().meta({
      description:
        "True only where a ranked answer (`search`) was cut short: the firm holds more matches " +
        "than were returned, so narrowing the query reaches the rest. False on every page of " +
        "the plain index, which is walkable to its end by cursor and never cut.",
    }),
  })
  .meta({ id: "DirectoryEntityListingPage" });

// ---- an entity's edges, matters, categories, and the identifiers it holds ----

export const DirectoryEdgeEntry = z
  .object({
    id: z.string(),
    edgeType: z.string(),
    // Direction is kept rather than normalized away: "parent of" and "subsidiary of" are the same
    // row read from opposite ends, and a caller that lost which end it was on would render one as
    // the other.
    direction: z.enum(["outbound", "inbound"]).meta({
      description:
        "Whether the entity asked about is the FROM end of this edge (outbound) or the TO end " +
        "(inbound). The relationship reads in the opposite sense from each end.",
    }),
    farEntityId: z.string().meta({ description: "The entity at the other end of the edge." }),
    farEntityKind: z.enum(["person", "organization", "unknown"]),
    farDisplayName: z
      .string()
      .nullable()
      .meta({
        description:
          "What to call the far end, resolved through the same naming read the bulk endpoint " +
          "performs — one lookup for the whole page, never one per row.",
      }),
    role: z.string().nullable(),
    note: z.string().nullable(),
    validFrom: z.string().nullable(),
    validTo: z.string().nullable(),
  })
  .meta({ id: "DirectoryEdgeEntry" });

export const DirectoryEdgePage = paginated(DirectoryEdgeEntry).meta({ id: "DirectoryEdgePage" });

export const EntityMatterPartyEntry = z
  .object({
    id: z.string(),
    matterId: z.string(),
    role: z.string(),
    capacity: z.string().nullable(),
    matterTitle: z
      .string()
      .nullable()
      .meta({ description: "Null when the link points at a matter the firm no longer holds." }),
    matterNumber: z
      .string()
      .nullable()
      .meta({ description: "Null while the matter is still consultation and undrawn." }),
    matterStatus: z.string().nullable(),
    linkedAt: z.string(),
  })
  .meta({ id: "DirectoryEntityMatterPartyEntry" });

export const EntityMatterPartyPage = paginated(EntityMatterPartyEntry).meta({
  id: "DirectoryEntityMatterPartyPage",
});

export const DirectoryCategory = z
  .object({
    id: z.string(),
    name: z.string(),
    appliesTo: z.enum(["person", "organization", "both"]),
    position: z.number(),
    archived: z.boolean().meta({
      description:
        "True for a label the firm has retired. Retired labels are still returned: an entity " +
        "carrying one must still be able to show what it says.",
    }),
  })
  .meta({ id: "DirectoryCategory" });

export const DirectoryCategoriesResponse = z
  .object({ data: z.array(DirectoryCategory) })
  .meta({ id: "DirectoryCategoriesResponse" });

// What the firm holds for an entity, WITHOUT reading any of it. No value field is on this shape and
// none belongs on it: the decrypt is the privileged, audited act, and a record that performed one to
// draw a list of headings would write a plaintext social security number into the audit log every
// time a page rendered.
export const DirectoryIdentifierRecord = z
  .object({
    id: z.string(),
    type: z.enum(IDENTIFIER_TYPES),
    label: z.string().nullable().meta({
      description:
        "The plaintext part: the issuing region, the jurisdiction, who an account is held with.",
    }),
    validFrom: z.string().nullable(),
    validTo: z.string().nullable(),
    recordedAt: z.string(),
  })
  .meta({ id: "DirectoryIdentifierRecord" });

export const DirectoryIdentifierRecordsResponse = z
  .object({ data: z.array(DirectoryIdentifierRecord) })
  .meta({ id: "DirectoryIdentifierRecordsResponse" });

// ---- contact points ----------------------------------------------------------------------------
//
// Three tables, one vocabulary. `directory_email`, `directory_phone` and `directory_address` have
// been in the schema since the baseline migration with nothing able to write to them, so until these
// routes existed a firm could not record a client's telephone number.

// Whether the firm MAY use a contact point and whether it SHOULD. Two facts, not one: a person can
// be reachable at a number they would rather the firm did not ring, and can ask to be reached by
// post while still holding an email address the firm may use. `isPrimary` is a third and different
// thing — the channel's default row — and stays on the contact point itself.
export const ContactPreference = z
  .object({
    permitted: z
      .boolean()
      .optional()
      .meta({
        description:
          "May the firm use this contact point. Defaults to true. A contact point the person asked " +
          "the firm not to use is recorded with the permission withdrawn and a note saying so, never " +
          "deleted: deleting it loses the instruction along with the value.",
      }),
    preferred: z
      .boolean()
      .optional()
      .meta({
        description:
          "Is this the one route the person asked to be reached by. At most one per entity across " +
          "email, phone and address together, because that preference is a single answer about every " +
          "channel; promoting one demotes whichever was preferred before, in any of the three.",
      }),
    note: z.string().max(1000).nullish().meta({
      description: "Why the contact point may not be used, or how it should be.",
    }),
  })
  .meta({ id: "DirectoryContactPreference" });

export const ContactVerification = z
  .object({
    status: z
      .enum(CONTACT_VERIFICATION_STATUSES)
      .optional()
      .meta({
        description:
          "What the firm found when it last tried to confirm this contact point. A failed status " +
          "records returned mail, a bounced message or a disconnected line. It never blocks a send: " +
          "it is surfaced to whoever is about to send, and the send proceeds.",
      }),
    detail: z.string().max(1000).nullish().meta({
      description: "What the failure said, in the words it said it.",
    }),
  })
  .meta({ id: "DirectoryContactVerification" });

export const ContactPointState = z
  .object({
    permitted: z.boolean(),
    preferred: z.boolean(),
    note: z.string().nullable(),
    verificationStatus: z.enum(CONTACT_VERIFICATION_STATUSES),
    verifiedAt: z.string().nullable(),
    verificationDetail: z.string().nullable(),
  })
  .meta({ id: "DirectoryContactPointState" });

export const DirectoryEmailEntry = z
  .object({
    id: z.string(),
    address: z.string(),
    contactUse: z.enum(CONTACT_USES).nullable(),
    isPrimary: z.boolean().meta({
      description: "This channel's default row — where a message goes when no address was named.",
    }),
    state: ContactPointState,
  })
  .meta({ id: "DirectoryEmailEntry" });

export const DirectoryPhoneEntry = z
  .object({
    id: z.string(),
    number: z.string().meta({
      description:
        "The number exactly as it was entered. Never rewritten; this is what a screen shows.",
    }),
    contactSystem: z.enum(CONTACT_SYSTEMS).meta({
      description:
        "What technology answers the number. A fax line is a fax by its system, not by a word in a " +
        "label, so a delivery path can ask the question and get an answer.",
    }),
    contactUse: z.enum(CONTACT_USES).nullable(),
    countryCallingCode: z
      .string()
      .nullable()
      .meta({
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
  .meta({ id: "DirectoryPhoneEntry" });

export const DirectoryAddressEntry = z
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
    addressType: z.enum(ADDRESS_TYPES).meta({
      description:
        "Whether the place physically exists. Personal service turns on this: a post office box is " +
        "postal and cannot be served, a registered office is physical and can.",
    }),
    isPrimary: z.boolean(),
    state: ContactPointState,
  })
  .meta({ id: "DirectoryAddressEntry" });

export const DirectoryEmailsResponse = z
  .object({ data: z.array(DirectoryEmailEntry) })
  .meta({ id: "DirectoryEmailsResponse" });

export const DirectoryPhonesResponse = z
  .object({ data: z.array(DirectoryPhoneEntry) })
  .meta({ id: "DirectoryPhonesResponse" });

export const DirectoryAddressesResponse = z
  .object({ data: z.array(DirectoryAddressEntry) })
  .meta({ id: "DirectoryAddressesResponse" });

export const DirectoryContactPointsResponse = z
  .object({
    emails: z.array(DirectoryEmailEntry),
    phones: z.array(DirectoryPhoneEntry),
    addresses: z.array(DirectoryAddressEntry),
  })
  .meta({ id: "DirectoryContactPointsResponse" });

export const AddEmailRequest = z
  .object({
    address: z.string().min(3).max(320),
    contactUse: z.enum(CONTACT_USES).nullish(),
    isPrimary: z.boolean().optional(),
    preference: ContactPreference.optional(),
    verification: ContactVerification.optional(),
  })
  .meta({ id: "AddDirectoryEmailRequest" });

export const UpdateEmailRequest = z
  .object({
    address: z.string().min(3).max(320).optional(),
    contactUse: z.enum(CONTACT_USES).nullish(),
    isPrimary: z.boolean().optional(),
    preference: ContactPreference.optional(),
    verification: ContactVerification.optional(),
  })
  .meta({ id: "UpdateDirectoryEmailRequest" });

export const AddPhoneRequest = z
  .object({
    number: z
      .string()
      .min(1)
      .max(64)
      .meta({
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
  .meta({ id: "AddDirectoryPhoneRequest" });

export const UpdatePhoneRequest = z
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
  .meta({ id: "UpdateDirectoryPhoneRequest" });

// Every field optional and none of them assumed. Which fields a country's addresses use, what a
// reader there calls them and what order they read in are properties of the country, so nothing here
// requires a state or a numeric postal code — and an address a firm holds only half of is still the
// address it holds.
export const addressFields = {
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

export const AddAddressRequest = z.object(addressFields).meta({ id: "AddDirectoryAddressRequest" });

export const UpdateAddressRequest = z
  .object(addressFields)
  .meta({ id: "UpdateDirectoryAddressRequest" });

export const SetPersonLifeDatesRequest = z
  .object({
    dateOfBirth: z
      .string()
      .regex(CIVIL_DATE_PATTERN)
      .nullish()
      .meta({
        description:
          "A plain calendar date. Held in the clear because every question a firm asks of a date of " +
          "birth is a range — is this client a minor, has a limitation period tolled — and a range " +
          "query over ciphertext is not a query.",
      }),
    dateOfDeath: z.string().regex(CIVIL_DATE_PATTERN).nullish(),
    deceased: z
      .boolean()
      .optional()
      .meta({
        description:
          "Separate from the date, because known dead with the date unknown is a state probate work " +
          "meets constantly. A recorded date of death implies this flag.",
      }),
  })
  .meta({ id: "SetDirectoryPersonLifeDatesRequest" });

// ---- creating a whole person in one request --------------------------------------------------

export const PersonOtherNameRequest = z
  .object({
    given: z.string().min(1),
    family: z.string().min(1),
    nameRole: z.enum(NAME_ROLES),
    prefix: z.string().nullable().optional(),
    middle: z.string().nullable().optional(),
    suffix: z.string().nullable().optional(),
  })
  .meta({ id: "CreateDirectoryPersonOtherName" });

export const PersonOrganizationRequest = z
  .object({
    organizationId: z.string().regex(directoryEntityIdPattern),
    edgeType: z.enum(EDGE_TYPES),
    personIs: z.enum(["from", "to"]).meta({
      description:
        "Which end of the edge the person is. The type says which way a membership reads " +
        "(employment runs person to organization); the screen decides and the record keeps it.",
    }),
    role: z.string().max(120).nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
  })
  .meta({ id: "CreateDirectoryPersonOrganization" });

// A PERSON NEEDS A NAME, NOT TWO NAMES. A family name is optional here because plenty of people
// do not have one — a mononym is the ordinary form of a name in much of the world, and a firm that
// cannot file its client under the name that client actually has files them under a wrong one. The
// domain already carries this: `createPerson` computes the phonetic blocking codes from the family
// name where there is one and from the given name where there is not, so a mononym is indexed, is
// searchable and is checked for conflicts exactly like anybody else. A GIVEN name is still required
// — a person row with no name at all is a record nobody can find or refer to.
export const CreatePersonRequest = z
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
  .meta({ id: "CreateDirectoryPersonRequest" });

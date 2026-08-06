// The subject registry: the things a document can talk about.
//
// A merge key is `<subject>.<facet>` — the matter, the client, the opposing counsel, this office, the
// firm. The catalogue is the CROSS PRODUCT of this registry with the facet registry beside it, which is
// what turns "adding a party role" into one row whose whole facet set follows, and "adding a facet" into
// one row every subject of that kind gains with identical absence behaviour, identical formats, and
// identical description wording.
//
// SUBJECTS ARE PLATFORM-DECLARED, NEVER FIRM-DERIVED, for the reason the role-matching rule already
// records: a firm's own vocabulary is free text that neither lexes as one merge-key atom nor gets typed
// from memory. A firm's own facts enter through the `custom.` namespace, which is the one subject whose
// facets a firm supplies.
//
// THE TOP-LEVEL NAMESPACE IS RESERVED. Every subject key below is reserved, no two may normalize alike,
// and nothing a firm can name may collide with one — asserted in test/catalog-generation.test.ts, which
// is what makes a later platform key structurally unable to shadow a firm's own.

// What decides which facets apply to a subject and which batched read answers them. The party axis and
// the firm's own people share one facet vocabulary and one resolution shape, so the kinds that arrive
// with their owning records — the firm's members, a court case, an estate, the financial surfaces — are
// rows here rather than a second mechanism.
// `assetClass` is the one kind whose subjects are COLLECTION-ONLY, and it is the one place the
// catalogue's rules produce a different answer than they do for parties. A party subject has a
// singular slot (`client.displayName`) because a matter has one client. An asset subject has no
// singular slot at all: an estate with two houses is the NORMAL case, so a scalar
// `realProperty.parcelNumber` would resolve to an absence naming the count on most real matters —
// the ambiguity rule producing a technically correct answer that is useless every time. So the
// register declares `realProperty.all`, `vehicle.all`, `assets.all` and no scalars, and the
// ambiguity rule is honoured by not creating slots it would have to refuse. Asserted in
// test/asset-subjects.test.ts.
export type SubjectKind =
  | "matter"
  | "party"
  | "office"
  | "firm"
  | "system"
  | "firmDefined"
  | "assetClass";

// Whether a subject is a fact every matter carries, or one only some matters have. This is what the
// entry's availability is DERIVED from rather than declared on three hundred rows: a matter that belongs
// to no office is not a defect, and a template naming an office field on one is showing a conditional
// absence rather than a broken binding.
export type SubjectPresence = "always" | "conditional";

export interface MergeSubject {
  // The key's first segment. Also, for a `party` subject, the stored role it matches once both are
  // stripped to their letters and digits.
  readonly key: string;
  readonly kind: SubjectKind;
  // The picker's subheading — "Opposing counsel".
  readonly label: string;
  // The same subject inside a sentence — "opposing counsel". Descriptions and absence reasons read
  // from this, so a reason stays running prose rather than a heading dropped into one.
  readonly proseLabel: string;
  // The picker's top-level heading this subject sits under. Declared here rather than on the facet
  // because grouping is about the SUBJECT: every fact about the client belongs under "The client".
  readonly group: string;
  readonly presence: SubjectPresence;
  // Search vocabulary a firm would type for the subject itself. Declared per subject rather than per
  // key, so the list stays as short as the registry.
  readonly synonyms: readonly string[];
  // Facets this subject's own kind declares but that a DIFFERENT read already answers. The one case is
  // the client's name: a matter records its client's display name on its own row, so the client party
  // costs no second read and its name resolves before the party collection is even fetched. Listing it
  // here is what keeps the party read from claiming a key it does not source — and what keeps a template
  // naming only the client's name from paying for a party read it does not need.
  readonly facetsAnsweredElsewhere?: readonly string[];
}

export const MERGE_SUBJECTS: readonly MergeSubject[] = [
  {
    key: "matter",
    kind: "matter",
    label: "Matter",
    proseLabel: "matter",
    group: "matter",
    presence: "always",
    synonyms: ["file", "case", "engagement"],
  },
  {
    key: "client",
    kind: "party",
    label: "Client",
    proseLabel: "client",
    group: "client",
    presence: "always",
    synonyms: ["customer"],
    facetsAnsweredElsewhere: ["displayName"],
  },
  {
    key: "opposingParty",
    kind: "party",
    label: "Opposing party",
    proseLabel: "opposing party",
    group: "otherParties",
    presence: "conditional",
    synonyms: ["defendant", "respondent", "adverse party", "other side"],
  },
  {
    key: "opposingCounsel",
    kind: "party",
    label: "Opposing counsel",
    proseLabel: "opposing counsel",
    group: "otherParties",
    presence: "conditional",
    synonyms: ["adverse counsel", "other attorney", "defense counsel"],
  },
  {
    key: "guardian",
    kind: "party",
    label: "Guardian",
    proseLabel: "guardian",
    group: "otherParties",
    presence: "conditional",
    synonyms: ["guardian ad litem"],
  },
  {
    key: "witness",
    kind: "party",
    label: "Witness",
    proseLabel: "witness",
    group: "otherParties",
    presence: "conditional",
    synonyms: ["deponent"],
  },
  {
    key: "location",
    kind: "office",
    label: "This office",
    proseLabel: "office",
    group: "office",
    presence: "conditional",
    synonyms: ["branch", "letterhead"],
  },
  {
    key: "firm",
    kind: "firm",
    label: "The firm",
    proseLabel: "firm",
    group: "firm",
    presence: "always",
    synonyms: ["practice"],
  },
  {
    key: "system",
    kind: "system",
    label: "The document",
    proseLabel: "document",
    group: "document",
    presence: "always",
    synonyms: ["today", "assembly"],
  },
  {
    key: "custom",
    kind: "firmDefined",
    label: "The firm's own fields",
    proseLabel: "firm's own field",
    group: "custom",
    presence: "always",
    synonyms: ["custom field"],
  },
  // The asset register's eleven subjects: one per platform class, plus the aggregate. ELEVEN
  // SUBJECTS RIDE ONE READ — a subject is a pass over rows already in memory, so adding the twelfth
  // class adds no read at all. That is the property the catalogue's whole shape exists to preserve,
  // and this is the first outside subsystem to test it.
  //
  // Every one is `conditional`: a matter with no asset register is the ordinary case for most of a
  // firm's work, and a template naming an asset field on a contract dispute is showing a conditional
  // absence rather than a broken binding. The collection resolves to an EMPTY list rather than an
  // absence, which is why a repeating block over one simply produces nothing.
  {
    key: "assets",
    kind: "assetClass",
    label: "Everything on the register",
    proseLabel: "asset",
    group: "assets",
    presence: "conditional",
    synonyms: ["asset", "inventory", "schedule", "estate", "property"],
  },
  {
    key: "realProperty",
    kind: "assetClass",
    label: "Real property",
    proseLabel: "property",
    group: "assets",
    presence: "conditional",
    synonyms: ["land", "house", "real estate", "parcel"],
  },
  {
    key: "financialAccount",
    kind: "assetClass",
    label: "Financial accounts",
    proseLabel: "account",
    group: "assets",
    presence: "conditional",
    synonyms: ["bank account", "brokerage", "checking", "savings"],
  },
  {
    key: "vehicle",
    kind: "assetClass",
    label: "Vehicles",
    proseLabel: "vehicle",
    group: "assets",
    presence: "conditional",
    synonyms: ["car", "truck", "boat", "motorcycle"],
  },
  {
    key: "firearm",
    kind: "assetClass",
    label: "Firearms",
    proseLabel: "firearm",
    group: "assets",
    presence: "conditional",
    synonyms: ["gun", "rifle", "shotgun", "handgun"],
  },
  {
    key: "businessInterest",
    kind: "assetClass",
    label: "Business interests",
    proseLabel: "business interest",
    group: "assets",
    presence: "conditional",
    synonyms: ["company", "shares", "partnership", "membership interest"],
  },
  {
    key: "insurancePolicy",
    kind: "assetClass",
    label: "Insurance policies",
    proseLabel: "policy",
    group: "assets",
    presence: "conditional",
    synonyms: ["life insurance", "annuity", "carrier"],
  },
  {
    key: "receivable",
    kind: "assetClass",
    label: "Money owed to the estate",
    proseLabel: "receivable",
    group: "assets",
    presence: "conditional",
    synonyms: ["note", "loan", "debt owed", "promissory note"],
  },
  {
    key: "digitalAsset",
    kind: "assetClass",
    label: "Digital assets",
    proseLabel: "digital asset",
    group: "assets",
    presence: "conditional",
    synonyms: ["cryptocurrency", "online account", "domain"],
  },
  {
    key: "personalProperty",
    kind: "assetClass",
    label: "Personal property",
    proseLabel: "personal property item",
    group: "assets",
    presence: "conditional",
    synonyms: ["contents", "furniture", "jewellery", "chattels"],
  },
  {
    key: "otherAssets",
    kind: "assetClass",
    label: "Other assets",
    proseLabel: "other asset",
    group: "assets",
    presence: "conditional",
    synonyms: ["miscellaneous", "unclassified"],
  },
];

// The role-matching rule, in one place. Case and punctuation are removed rather than normalized to a
// separator because the separator itself is what firms disagree about: a space, an underscore, a hyphen,
// or nothing at all. What is left is the letters and digits of the role's name, which is the only part
// two firms writing down the same role reliably agree on.
export function normalizedRoleToken(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// The stored roles a party subject matches. Derived from the key rather than listed beside it, so the
// mapping cannot fall out of step with the key a template writes. This is the one seam a firm-declared
// alias map widens: it adds tokens to a subject, and changes no key, no template, and no manifest.
export function partySubjectRoleTokens(subject: MergeSubject): readonly string[] {
  return [normalizedRoleToken(subject.key)];
}

const SUBJECT_BY_KEY: ReadonlyMap<string, MergeSubject> = new Map(
  MERGE_SUBJECTS.map((subject) => [subject.key, subject]),
);

export function mergeSubject(key: string): MergeSubject | undefined {
  return SUBJECT_BY_KEY.get(key);
}

export function mergeSubjectsOfKind(kind: SubjectKind): readonly MergeSubject[] {
  return MERGE_SUBJECTS.filter((subject) => subject.kind === kind);
}

// The subject a merge key names, or undefined for a key whose first segment is not a reserved subject.
export function subjectOfKey(key: string): MergeSubject | undefined {
  const separator = key.indexOf(".");
  return separator === -1 ? undefined : SUBJECT_BY_KEY.get(key.slice(0, separator));
}

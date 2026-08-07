import { ProtectedReadForbiddenError } from "@magna-carta/data-access/protected-fields";
import type { IdentifierType } from "@magna-carta/directory/types";
import type { DictionaryEntry } from "./catalog/entry.ts";
import { exampleRenderingsFor } from "./catalog/examples.ts";
import {
  MERGE_SUBJECTS,
  mergeSubject,
  normalizedRoleToken,
  type MergeSubject,
} from "./catalog/subjects.ts";
import type { MatterPartyMergeRow } from "./merge-statements.ts";
import type { StaffingSlot } from "./staffing-bindings.ts";
import type { MergeValue } from "./types.ts";

// The client's sealed identifiers, as merge fields.
//
// A retainer agreement names a tax identifier; an affidavit names a date of birth. Those values live in
// encrypted columns, and the ONE way to turn one back into a string is the protected-field chokepoint in
// `@magna-carta/data-access` — the permission gate, the decrypt-audit row, and the AAD-bound decrypt,
// inseparable and in that order. A merge field is not a second door to it: this module holds the KEYS
// and the ABSENCES, and the plaintext arrives only from a reader the caller wires to that chokepoint.
//
// THREE PROPERTIES ARE THE WHOLE DESIGN, and each one is stated where it is enforced:
//
// 1. NO SECOND READ PATH. Nothing here selects a ciphertext column, derives a key, or decrypts. The
//    reader seam below is the only source of a plaintext, and the refusal this module catches is the
//    chokepoint's own `ProtectedReadForbiddenError` rather than a permission test restated here — a
//    second copy of the gate is a gate that can drift out of step with the one that matters.
// 2. A REFUSAL IS AN ABSENCE, NOT AN ERROR AND NOT A BLANK. A member assembling a template that binds a
//    protected field without holding the decrypt permission gets the document, with a visible marker
//    where the value would be and a reason naming the field and the permission. Aborting the assembly
//    would make one unreadable field cost the whole document; a silent blank would file a document that
//    reads as complete and is not. Neither is a defensible answer to "you may not see this".
// 3. A REASON NAMES THE FIELD AND THE PERMISSION, NEVER THE VALUE. The same rule the ambiguous-role
//    reasons follow: what a person needs is what to ask for, and nothing about what was withheld.

// One protected merge source: the key a template writes, the sealed identifier behind it, and what a
// person calls that identifier in running prose (the reasons and descriptions read from this).
export interface ProtectedIdentifierSource {
  readonly key: string;
  readonly identifierType: IdentifierType;
  readonly label: string;
  // What a firm would type looking for it — "SSN", "tax ID". A sealed identifier is the field an author
  // is least likely to find by its spelled-out name, so it carries the abbreviations outright.
  readonly synonyms: readonly string[];
  // Invented sample text of the SHAPE the identifier takes, never a real one and never a real person's.
  // A picker row showing what the rendering looks like is what stops an author binding the wrong field.
  readonly exampleRendering: string;
}

// The key's first segment. Protected identifiers are the CLIENT'S: the client is who an engagement
// letter, a retainer, and an affidavit identify, and every other party's sealed identifiers are a wider
// disclosure surface than a document has yet been asked for. The segment matches `client.displayName`
// deliberately — an author reaching for the client's details finds them all under one name.
const PROTECTED_KEY_PREFIX = "client.";

// The party role the protected source resolves against, matched by the same punctuation-insensitive rule
// every other role match uses.
const CLIENT_ROLE_TOKEN = normalizedRoleToken("client");

// One merge key per sealed identifier type, declared as a total mapping so the platform cannot gain an
// identifier type that quietly has no merge binding and no considered decision behind it: adding a type
// to the Directory's catalogue stops this file compiling until someone says what a document calls it.
const IDENTIFIER_SOURCES: Readonly<
  Record<
    IdentifierType,
    {
      readonly segment: string;
      readonly label: string;
      readonly synonyms: readonly string[];
      readonly exampleRendering: string;
    }
  >
> = {
  ssn: {
    segment: "socialSecurityNumber",
    label: "Social Security number",
    synonyms: ["SSN", "social security", "tax identifier"],
    exampleRendering: "000-00-0000",
  },
  ein: {
    segment: "employerIdentificationNumber",
    label: "Employer Identification Number",
    synonyms: ["EIN", "federal tax identifier", "tax identifier"],
    exampleRendering: "00-0000000",
  },
  dob: {
    segment: "dateOfBirth",
    label: "date of birth",
    synonyms: ["DOB", "birthday", "born"],
    exampleRendering: "January 1, 1970",
  },
  account: {
    segment: "accountNumber",
    label: "account number",
    synonyms: ["bank account", "account"],
    exampleRendering: "0000000000",
  },
  drivers_license: {
    segment: "driversLicenseNumber",
    label: "driver's license number",
    synonyms: ["DL", "licence", "license number"],
    exampleRendering: "X0000000",
  },
  ssn_last_four: {
    segment: "socialSecurityNumberLastFour",
    label: "last four digits of the Social Security number",
    synonyms: ["SSN last four", "last four"],
    exampleRendering: "0000",
  },
  bar_number: {
    segment: "barNumber",
    label: "bar number",
    synonyms: ["bar", "state bar number", "attorney number"],
    exampleRendering: "00000",
  },
};

export const PROTECTED_IDENTIFIER_SOURCES: readonly ProtectedIdentifierSource[] = Object.entries(
  IDENTIFIER_SOURCES,
).map(([identifierType, { segment, label, synonyms, exampleRendering }]) => ({
  key: `${PROTECTED_KEY_PREFIX}${segment}`,
  identifierType: identifierType as IdentifierType,
  label,
  synonyms,
  exampleRendering,
}));

const SOURCE_BY_KEY: ReadonlyMap<string, ProtectedIdentifierSource> = new Map(
  PROTECTED_IDENTIFIER_SOURCES.map((source) => [source.key, source]),
);

// The protected sources a manifest actually names. Resolution attempts a decrypt only for these, so the
// number of decrypts an assembly can perform is fixed by the template before any value is touched.
export function protectedIdentifierSourcesIn(
  keys: Iterable<string>,
): readonly ProtectedIdentifierSource[] {
  const wanted: ProtectedIdentifierSource[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const source = SOURCE_BY_KEY.get(key);
    if (source === undefined || seen.has(source.key)) continue;
    seen.add(source.key);
    wanted.push(source);
  }
  return wanted;
}

// The shipped dictionary rows for every protected source.
//
// A sealed identifier renders as TEXT, including the date of birth. What the column holds is the string
// the firm recorded, and re-reading it as a calendar date at assembly time would let a document print a
// date the firm never typed — a decrypt is not the place to start guessing at a format.
//
// The absence behaviour is `placeholder` for the reason the whole absence model biases that way, and it
// carries a second weight here: a member who may not decrypt gets this marker, and a marker is the one
// outcome they cannot mistake for a value the firm does not hold.
//
// The subject a protected identifier hangs off is read from the registry rather than restated here, so
// the group heading and the availability derivation are the client subject's own and cannot drift.
const CLIENT_SUBJECT = mergeSubject("client");

export const PROTECTED_DICTIONARY_ENTRIES: readonly DictionaryEntry[] =
  PROTECTED_IDENTIFIER_SOURCES.map((source) => ({
    key: source.key,
    source: "protectedIdentifier" as const,
    valueType: "text" as const,
    defaultFormat: "plain",
    sensitivity: "protected" as const,
    absence: "placeholder" as const,
    description: `The client's ${source.label}, held encrypted. Filling it in decrypts it, which requires permission and is recorded.`,
    label: `Client's ${source.label}`,
    group: CLIENT_SUBJECT?.group ?? "client",
    subject: "client",
    // A sealed identifier sits behind the client subject's disclosure, so an author choosing "the
    // client's name" never trips over "the client's tax identifier".
    prominence: "secondary" as const,
    synonyms: source.synonyms,
    // Rendered through the real format table from an invented value of the right SHAPE, so a picker row
    // shows what the field looks like without any firm's data existing anywhere near this list.
    exampleRenderings: exampleRenderingsFor("text", {
      kind: "text",
      text: source.exampleRendering,
    }),
    status: "current" as const,
  }));

// ---------------------------------------------------------------------------------------------
// The firm's own people's bar numbers
// ---------------------------------------------------------------------------------------------

// One protected merge key per MEMBER subject: `responsibleAttorney.barNumber` and its four
// siblings. A pleading's signature block states the signing attorney's bar number, and it is the
// one protected fact a document asks about the firm's own people — held encrypted on the member's
// mapped Directory person, read through the same chokepoint the client's identifiers use.
export interface MemberProtectedSource {
  readonly key: string;
  // The subject whose resolved slot supplies the entity. The decrypt is attempted only for a slot
  // that RESOLVED — an ambiguous or empty slot is an absence before any decryption, so an assembly
  // cannot generate a decrypt audit trail for a member the document never names.
  readonly subjectKey: string;
  readonly label: string;
  readonly identifierType: IdentifierType;
}

export const MEMBER_PROTECTED_SOURCES: readonly MemberProtectedSource[] = MERGE_SUBJECTS.filter(
  (subject) => subject.kind === "member",
).map((subject: MergeSubject) => ({
  key: `${subject.key}.barNumber`,
  subjectKey: subject.key,
  label: subject.proseLabel,
  identifierType: "bar_number" as IdentifierType,
}));

const MEMBER_SOURCE_BY_KEY: ReadonlyMap<string, MemberProtectedSource> = new Map(
  MEMBER_PROTECTED_SOURCES.map((source) => [source.key, source]),
);

export function memberProtectedSourcesIn(keys: Iterable<string>): readonly MemberProtectedSource[] {
  const wanted: MemberProtectedSource[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const source = MEMBER_SOURCE_BY_KEY.get(key);
    if (source === undefined || seen.has(source.key)) continue;
    seen.add(source.key);
    wanted.push(source);
  }
  return wanted;
}

export const MEMBER_PROTECTED_DICTIONARY_ENTRIES: readonly DictionaryEntry[] =
  MEMBER_PROTECTED_SOURCES.map((source) => {
    const subject = mergeSubject(source.subjectKey);
    return {
      key: source.key,
      source: "protectedIdentifier" as const,
      valueType: "text" as const,
      defaultFormat: "plain",
      sensitivity: "protected" as const,
      absence: "placeholder" as const,
      description: `The ${source.label}'s bar number, held encrypted. Filling it in decrypts it, which requires permission and is recorded.`,
      label: `${subject?.label ?? source.subjectKey}'s bar number`,
      group: subject?.group ?? "ourPeople",
      subject: source.subjectKey,
      // Behind the subject's disclosure, so an author choosing an attorney's name never trips over
      // their sealed identifier.
      prominence: "secondary" as const,
      synonyms: ["bar", "bar number", "state bar number"],
      exampleRenderings: exampleRenderingsFor("text", { kind: "text", text: "00000" }),
      status: "current" as const,
    };
  });

function memberRefusalReason(source: MemberProtectedSource, permission: string): string {
  return `The ${source.label}'s bar number is a protected value. Filling it in requires the ${permission} permission, which you do not hold, so the document shows a marker where it would have gone — ask someone who holds that permission to complete it.`;
}

// Every member bar number the manifest named, resolved through the caller's chokepoint reader
// against the slot the staffing resolution produced. Three properties, in resolution order:
//
// 1. A SLOT THAT DID NOT RESOLVE IS AN ABSENCE BEFORE ANY DECRYPT. An ambiguous or empty staffing
//    slot carries its own reason, and no read — and therefore no decrypt audit row — happens for it.
// 2. A MEMBER THE DIRECTORY DOES NOT MIRROR HAS NO IDENTIFIER TO READ. The bar number lives on the
//    member's mapped Directory person; a member without one is an absence naming that, not a decrypt
//    of nothing.
// 3. A REFUSAL COSTS ONE ATTEMPT AND ANSWERS EVERY REMAINING KEY — the permission guarding one
//    sealed identifier guards them all, exactly as the client pass short-circuits.
export async function memberProtectedValues(
  sources: readonly MemberProtectedSource[],
  slots: ReadonlyMap<string, StaffingSlot>,
  read: ProtectedIdentifierReader | undefined,
): Promise<ProtectedIdentifierResolution> {
  const values = new Map<string, MergeValue>();
  const reasons = new Map<string, string>();
  if (sources.length === 0) return { values, reasons };

  if (read === undefined) {
    for (const source of sources) {
      reasons.set(
        source.key,
        `The ${source.label}'s bar number is a protected value, and this assembly ran without a way to read protected values.`,
      );
    }
    return { values, reasons };
  }

  let refusedPermission: string | undefined;
  for (const source of sources) {
    if (refusedPermission !== undefined) {
      reasons.set(source.key, memberRefusalReason(source, refusedPermission));
      continue;
    }
    const slot = slots.get(source.subjectKey);
    if (slot?.row === undefined) {
      reasons.set(
        source.key,
        slot?.reason ?? `This matter staffs no member in the ${source.label} role.`,
      );
      continue;
    }
    const entityId = slot.row.entityId;
    if (entityId === null) {
      reasons.set(
        source.key,
        `The ${source.label} has no Directory record mapped to their member account, so there is no identifier record to read a bar number from.`,
      );
      continue;
    }
    let plaintext: string | null;
    try {
      plaintext = await read(entityId, source.identifierType);
    } catch (error) {
      // The chokepoint's own refusal, caught by identity — thrown BEFORE any decrypt and before any
      // audit row, so a refused read is not a read. Anything else propagates to the caller.
      if (!(error instanceof ProtectedReadForbiddenError)) throw error;
      refusedPermission = error.permission;
      reasons.set(source.key, memberRefusalReason(source, error.permission));
      continue;
    }
    if (plaintext === null || plaintext === "") {
      reasons.set(
        source.key,
        `The Directory holds no bar number for the ${source.label}'s mapped record.`,
      );
      continue;
    }
    values.set(source.key, { kind: "text", text: plaintext });
  }

  return { values, reasons };
}

// How the caller reads one sealed identifier. Injected rather than imported, exactly as the image-asset
// reader is: the plaintext comes from the firm's protected-field chokepoint, which needs a firm key, an
// actor, and a permission set — none of which this package holds or should learn to hold. Returns null
// when the entity has no identifier of that type; THROWS the chokepoint's ProtectedReadForbiddenError
// when the acting member may not decrypt, which is the refusal this module turns into an absence.
export type ProtectedIdentifierReader = (
  entityId: string,
  identifierType: IdentifierType,
) => Promise<string | null>;

export interface ProtectedIdentifierResolution {
  readonly values: ReadonlyMap<string, MergeValue>;
  // Keyed by the merge key that could not be resolved. A key that resolved carries no reason, and a
  // reason names the FIELD and the PERMISSION only — never the value, which is the thing the gate
  // withheld.
  readonly reasons: ReadonlyMap<string, string>;
}

// The matter's client entity, from the party rows ALREADY READ — a pass over an array in memory, not a
// query. Undefined when the matter links no client party or links more than one, which are different
// facts and get different reasons.
function clientEntityIdOf(parties: readonly MatterPartyMergeRow[]): string | undefined {
  const matched = parties.filter((party) => normalizedRoleToken(party.role) === CLIENT_ROLE_TOKEN);
  return matched.length === 1 ? matched[0]?.entityId : undefined;
}

function unresolvableSubjectReason(parties: readonly MatterPartyMergeRow[]): string {
  const count = parties.filter(
    (party) => normalizedRoleToken(party.role) === CLIENT_ROLE_TOKEN,
  ).length;
  return count === 0
    ? "This matter links no client in the Directory, so there is no record to read the client's protected details from."
    : `This matter links ${count} clients, so there is no single client whose protected details a document may state.`;
}

// What a member without the decrypt permission is told. It names the field and the permission and stops
// there: "ask for this permission" is the whole actionable content, and anything about the value itself
// would be the disclosure the gate just refused.
function protectedRefusalReason(source: ProtectedIdentifierSource, permission: string): string {
  return `The client's ${source.label} is a protected value. Filling it in requires the ${permission} permission, which you do not hold, so the document shows a marker where it would have gone — ask someone who holds that permission to complete it.`;
}

// Every protected source the manifest named, resolved through the caller's chokepoint reader.
//
// THE DECRYPT COUNT IS BOUNDED BY THE TEMPLATE, AND IT IS ONE PER SOURCE AT MOST. A sealed value is
// decrypted individually by construction — each ciphertext is bound to its own row by its AAD and each
// decrypt commits its own audit record — so there is no batch form to reach for, and the honest way to
// keep the cost bounded is to fix the ceiling at the number of protected keys the manifest names
// (deduplicated above) rather than to invent a bulk read that would have to bypass the chokepoint to
// exist. A REFUSAL COSTS EXACTLY ONE ATTEMPT: the permission that guards one sealed identifier guards
// them all, so the first refusal answers every remaining key without asking again.
export async function protectedIdentifierValues(
  sources: readonly ProtectedIdentifierSource[],
  parties: readonly MatterPartyMergeRow[],
  read: ProtectedIdentifierReader | undefined,
): Promise<ProtectedIdentifierResolution> {
  const values = new Map<string, MergeValue>();
  const reasons = new Map<string, string>();
  if (sources.length === 0) return { values, reasons };

  // No reader means the caller composed an assembly with no way to reach the chokepoint. That is an
  // absence, not an error and certainly not a value: an engine that cannot decrypt still produces the
  // document, exactly as one that cannot fetch a letterhead does.
  if (read === undefined) {
    for (const source of sources) {
      reasons.set(
        source.key,
        `The client's ${source.label} is a protected value, and this assembly ran without a way to read protected values.`,
      );
    }
    return { values, reasons };
  }

  const entityId = clientEntityIdOf(parties);
  if (entityId === undefined) {
    const reason = unresolvableSubjectReason(parties);
    for (const source of sources) reasons.set(source.key, reason);
    return { values, reasons };
  }

  // Serial on purpose, not by oversight. The refusal short-circuit only works if the first answer is
  // known before the next request goes out, and the alternative — firing every decrypt at once — would
  // commit an audit row per key for a member the very first one was about to refuse.
  let refusedPermission: string | undefined;
  for (const source of sources) {
    if (refusedPermission !== undefined) {
      reasons.set(source.key, protectedRefusalReason(source, refusedPermission));
      continue;
    }
    let plaintext: string | null;
    try {
      plaintext = await read(entityId, source.identifierType);
    } catch (error) {
      // The chokepoint's own refusal, caught by identity rather than re-derived: it is thrown BEFORE any
      // decrypt and before any audit row, so a refused read is not a read and leaves no trace of one.
      // Anything else is a real failure and belongs to the caller — a decrypt that broke is not an
      // absence, and reporting it as one would file a document missing a value nobody was denied.
      if (!(error instanceof ProtectedReadForbiddenError)) throw error;
      refusedPermission = error.permission;
      reasons.set(source.key, protectedRefusalReason(source, error.permission));
      continue;
    }
    if (plaintext === null || plaintext === "") {
      reasons.set(source.key, `The Directory holds no ${source.label} for this matter's client.`);
      continue;
    }
    values.set(source.key, { kind: "text", text: plaintext });
  }

  return { values, reasons };
}

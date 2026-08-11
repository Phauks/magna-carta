import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import { assetSubjectValues, assetSubjectsIn } from "./asset-bindings.ts";
import {
  customFieldHandleOf,
  customMergeKeyFor,
  mergeValueForCustomField,
  type CustomFieldDefinitionRow,
} from "./custom-field-bindings.ts";
import {
  isArchivedCustomFieldRow,
  selectCustomFieldCatalogStatement,
  selectCustomFieldValuesStatement,
  toCustomFieldDefinitionRow,
  toCustomFieldValueRow,
  type CustomFieldDefinitionColumns,
  type CustomFieldValueColumns,
} from "./custom-field-statements.ts";
import { lookupDictionaryEntry, type DictionaryEntry } from "./dictionary.ts";
import { directoryRoleSourcesIn, directoryRoleValues } from "./directory-role-bindings.ts";
import { heightForWidth, readImageFacts } from "./ooxml/image.ts";
import {
  memberProtectedSourcesIn,
  memberProtectedValues,
  protectedIdentifierSourcesIn,
  protectedIdentifierValues,
  type ProtectedIdentifierReader,
} from "./protected-bindings.ts";
import { staffingSourcesIn, staffingValues, type StaffingSlot } from "./staffing-bindings.ts";
import {
  selectLocationForMergeStatement,
  selectMatterAssetsForMergeStatement,
  selectMatterCourtCaseForMergeStatement,
  selectMatterEstateForMergeStatement,
  selectMatterForMergeStatement,
  selectMatterPartiesForMergeStatement,
  selectMatterStaffingForMergeStatement,
  toLocationMergeRow,
  toMatterCourtCaseMergeRow,
  toMatterEstateMergeRow,
  toMatterMergeRow,
  toMatterPartyMergeRow,
  toMatterStaffingMergeRow,
  type LocationMergeColumns,
  type LocationMergeRow,
  type MatterAssetMergeRow,
  type MatterCourtCaseMergeColumns,
  type MatterEstateMergeColumns,
  type MatterEstateMergeRow,
  type MatterMergeColumns,
  type MatterMergeRow,
  type MatterPartyMergeColumns,
  type MatterStaffingMergeColumns,
} from "./merge-statements.ts";
import {
  manifestKeys,
  type FieldManifest,
  type MergeContext,
  type MergeListItem,
  type MergeSource,
  type MergeValue,
} from "./types.ts";

// THE HARD RULE OF THIS MODULE: a merge field never issues a query.
//
// Resolution reads AT MOST ONCE PER SOURCE — one matter read, one location read — regardless of how many
// placeholders a template has. A template with 140 fields costs the same number of reads as one with
// four. This is stated as a rule and asserted by test rather than left to care, because the natural
// implementation of a merge engine is a per-field resolver, and that is an N+1 generator pointed
// straight at a document with a hundred merge fields.
//
// The manifest is what makes the batching possible: normalization already recorded exactly which keys a
// template version uses, so the reads are PLANNED before any value is touched.

// The dictionary version the resolver was built against, recorded on the provenance row beside the
// engine version so a document assembled today stays explicable after the dictionary grows. Its home is
// catalog/revision.ts, beside the catalogue whose version it names.
export { DICTIONARY_VERSION, mergeFieldCatalogRevision } from "./catalog/revision.ts";

// The time zone a document's dates render in: the MATTER'S OFFICE'S zone, never the server's and
// never the acting member's, so a filing date is the date it was in the office that filed it.
//
// This is the ONE place the office's zone enters the platform, rather than a default scattered
// through the formatters. An office that carries no zone — one recorded before the column existed —
// falls back to the platform's normalized zone, which is what every office resolved to before: a
// document that rendered correctly yesterday renders identically today.
export function timeZoneForLocation(location: LocationMergeRow | undefined): string {
  const recorded = location?.timeZone;
  return recorded === null || recorded === undefined || recorded.length === 0 ? "UTC" : recorded;
}

// How the caller fetches an asset's bytes. Injected rather than imported: the bytes live in the firm's
// object store and this package holds no binding, exactly as the scrub is injected into registration.
// Returns undefined when the object is gone, which resolves as an absence — a letterhead whose logo
// object vanished produces a visible marker, never a document that silently lost its letterhead.
export type ImageAssetReader = (objectKey: string) => Promise<Uint8Array | undefined>;

export interface ResolutionInput {
  readonly matterId: MatterId;
  readonly manifest: FieldManifest;
  // The firm's own display name, resolved once by the caller from the firm record. It is not a per-firm
  // database fact, so it arrives as an input rather than as a read this module issues.
  readonly firmName: string;
  // The instant the assembly ran, supplied rather than read from the clock so an assembly is
  // reproducible and a test does not have to freeze time globally.
  readonly assembledAt: string;
  // The currency a firm's own currency-typed custom fields are amounts in. Supplied by the caller
  // because it is a firm fact rather than a per-matter one; the firm-currency setting plugs in at the
  // caller when the platform registers more than one currency.
  readonly currencyCode: string;
  // The dictionary this assembly resolves against — the firm's, including its `custom.<handle>`
  // bindings. Defaults to the platform's shipped catalogue so a caller with no custom fields needs to
  // say nothing.
  readonly dictionary?: readonly DictionaryEntry[];
  // Absent when the caller has no object store to read from, which makes every image key an absence
  // rather than an error: an engine that cannot fetch a logo still produces the document.
  readonly readImageAsset?: ImageAssetReader;
  // How a sealed value is read back — the caller's binding to the protected-field chokepoint's
  // permission-gated, audited decrypt. Injected for the same reason the image reader is: the plaintext
  // needs a firm key, an acting member, and that member's permissions, none of which this package holds.
  // Absent makes every protected key a declared absence, exactly as an absent image reader does.
  readonly readProtectedIdentifier?: ProtectedIdentifierReader;
  // The date every asset figure is resolved as of. For an estate this is the date of death, which is
  // the estate record's own fact — supplied here rather than read, because this package stores no
  // second copy of a date and the register never invents one. Absent falls back to the assembly's own
  // date, which is a schedule as of today: still explicit, and never a figure with no date at all.
  readonly assetsAsOfDate?: string;
}

// The largest number of assets one assembly walks. A repeating block over a register is bounded like
// every other repeat, and the bound is generous — an estate of forty is large — because the failure it
// guards against is a runaway document rather than a firm with a big inventory.
const MAX_ASSETS_PER_ASSEMBLY = 500;

export type ResolutionFailureReason = "matter-not-found";

export type ResolutionResult =
  | { readonly ok: true; readonly context: MergeContext; readonly reads: readonly MergeSource[] }
  | { readonly ok: false; readonly reason: ResolutionFailureReason; readonly detail: string };

// The firm's own field catalogue, read once and handed to whoever needs the dictionary the firm actually
// has: the registration pass that checks a template's placeholders, the field-list surface an author
// picks from, and the assembly that re-checks a stored template's expressions. ONE READ, never one per
// field — and it touches no matter's data, so it is the same read whichever of the three is asking.
export async function readCustomFieldCatalog(
  database: SqlDatabase,
): Promise<readonly CustomFieldDefinitionRow[]> {
  const { results } =
    await selectCustomFieldCatalogStatement(database).all<CustomFieldDefinitionColumns>();
  return results.map(toCustomFieldDefinitionRow);
}

// The sources a manifest actually needs. A template that names no location field never reads a location.
//
// The keys come from EVERY site the manifest records — plain placeholders, block conditions, and
// computed fields alike. That is what keeps the batching rule true once a condition can read anything
// the dictionary has: an expression must never be the reason a read happens late.
function sourcesFor(
  manifest: FieldManifest,
  dictionary: readonly DictionaryEntry[] | undefined,
): Set<MergeSource> {
  const sources = new Set<MergeSource>();
  for (const key of manifestKeys(manifest)) {
    const entry = lookupDictionaryEntry(key, dictionary);
    if (entry !== undefined) sources.add(entry.source);
  }
  return sources;
}

// Every firm-field handle the manifest binds, deduplicated — the ONE list the whole custom-field read is
// planned from. A handle whose key is shaped wrong never reaches the read: it is not a field this firm
// has, and it would otherwise become a bound parameter for a row that cannot exist.
function customFieldHandlesFor(manifest: FieldManifest): string[] {
  const handles = new Set<string>();
  for (const key of manifestKeys(manifest)) {
    const handle = customFieldHandleOf(key);
    if (handle !== undefined) handles.add(handle);
  }
  return [...handles].sort();
}

// The keys a manifest names, as a set built ONCE per resolution. Every "does this template ask for X"
// question below is a membership test against it — asking the manifest each time would walk every
// placeholder per question, which is the same per-field shape the batching rule forbids of reads.
function manifestKeySet(manifest: FieldManifest): ReadonlySet<string> {
  return new Set(manifestKeys(manifest));
}

function textValue(text: string | null): MergeValue | undefined {
  return text === null || text === "" ? undefined : { kind: "text", text };
}

function instantValue(isoInstant: string | null): MergeValue | undefined {
  return isoInstant === null || isoInstant === "" ? undefined : { kind: "instant", isoInstant };
}

// The matter row supplies both the `matter` source and the client half of the `party` source: a matter
// records its client's display name and code directly, so the client party costs no second read. Every
// OTHER role (`opposingParty.*`, `opposingCounsel.*`, and the rest) comes out of the one party-collection
// read below — one read for every role a manifest mentions, never one per role.
function valuesFromMatter(matter: MatterMergeRow, into: Map<string, MergeValue>): void {
  const set = (key: string, value: MergeValue | undefined): void => {
    if (value !== undefined) into.set(key, value);
  };
  set("matter.number", textValue(matter.matterNumber));
  set("matter.title", textValue(matter.title));
  set("matter.description", textValue(matter.description));
  set("matter.status", textValue(matter.status));
  set("matter.openedOn", instantValue(matter.openedAt));
  set("matter.eBilling", { kind: "boolean", value: matter.eBilling !== 0 });
  // The client's name arrives as a NAME with only its display part: the matter's own row records the
  // string, not the Directory record's separated parts and not whether the client is a person or an
  // organisation. So the default rendering is exactly what it always was, and a rendering that needs a
  // part — surname first, initials — is a declared absence naming the missing part rather than a guess
  // made from a string that happens to contain a space.
  set(
    "client.displayName",
    matter.clientDisplayName === null || matter.clientDisplayName === ""
      ? undefined
      : { kind: "name", display: matter.clientDisplayName },
  );
  set("client.code", textValue(matter.clientCode));
}

// A name value from a display string plus separately recorded parts, or undefined when even the
// display half is unrecorded. Shared by the judge and the decedent, whose parts arrive on their
// sources' own reads exactly as a party's do.
function nameValueFromParts(
  display: string | null,
  parts: {
    readonly prefix: string | null;
    readonly given: string | null;
    readonly middle: string | null;
    readonly family: string | null;
    readonly suffix: string | null;
  },
): MergeValue | undefined {
  if (display === null || display === "") return undefined;
  const part = (value: string | null): string | undefined =>
    value === null || value === "" ? undefined : value;
  return {
    kind: "name",
    display,
    isOrganisation: false,
    ...(part(parts.prefix) === undefined ? {} : { prefix: parts.prefix as string }),
    ...(part(parts.given) === undefined ? {} : { given: parts.given as string }),
    ...(part(parts.middle) === undefined ? {} : { middle: parts.middle as string }),
    ...(part(parts.family) === undefined ? {} : { family: parts.family as string }),
    ...(part(parts.suffix) === undefined ? {} : { suffix: parts.suffix as string }),
  };
}

function dateValue(isoDate: string | null): MergeValue | undefined {
  return isoDate === null || isoDate === "" ? undefined : { kind: "date", isoDate };
}

// The estate record supplies the `estate` subject. The styles are stored designations printed as
// recorded; the decedent is a name with parts, so every name format applies.
function valuesFromEstate(estate: MatterEstateMergeRow, into: Map<string, MergeValue>): void {
  const set = (key: string, value: MergeValue | undefined): void => {
    if (value !== undefined) into.set(key, value);
  };
  set("estate.style", textValue(estate.estateStyle));
  set("estate.shortStyle", textValue(estate.shortStyle));
  set("estate.dateOfDeath", dateValue(estate.dateOfDeath));
  set("estate.proceedingType", textValue(estate.proceedingType));
  set("estate.lettersIssuedOn", dateValue(estate.lettersIssuedOn));
  set(
    "estate.decedent",
    nameValueFromParts(estate.decedentDisplayName, {
      prefix: estate.decedentNamePrefix,
      given: estate.decedentNameGiven,
      middle: estate.decedentNameMiddle,
      family: estate.decedentNameFamily,
      suffix: estate.decedentNameSuffix,
    }),
  );
}

function valuesFromLocation(location: LocationMergeRow, into: Map<string, MergeValue>): void {
  const set = (key: string, value: MergeValue | undefined): void => {
    if (value !== undefined) into.set(key, value);
  };
  set("location.name", textValue(location.name));
  set("location.jurisdiction", textValue(location.jurisdiction));
  set("location.addressBlock", textValue(location.addressBlock));
  set("location.footer", textValue(location.footer));
  set("location.remitTo", textValue(location.remitTo));
}

// The office's logo, as bytes plus the box it draws in.
//
// THE ASSET DECLARES THE BOX, NOT THE TEMPLATE. A firm sets how large its mark prints once, on the
// office it belongs to, where it can see the result — rather than every template author restating it in
// English Metric Units, a unit no word processor exposes and nobody can check by eye. Only the width is
// stored: the height follows from the image's own proportions, so a document has no way to print a
// stretched logo, and replacing a wide mark with a tall one re-lays the letterhead out correctly without
// touching a single template.
//
// The bytes are re-sniffed here rather than trusted from the stored content type. What was uploaded and
// what the object store holds today are different claims, and the format policy is worth exactly as much
// as the last place it is enforced.
async function resolveLetterheadLogo(
  location: LocationMergeRow | undefined,
  readImageAsset: ImageAssetReader | undefined,
): Promise<MergeValue | undefined> {
  const objectKey = location?.letterheadLogoObjectKey;
  if (objectKey === null || objectKey === undefined || readImageAsset === undefined)
    return undefined;
  const bytes = await readImageAsset(objectKey);
  if (bytes === undefined) return undefined;
  const facts = readImageFacts(bytes);
  if (!facts.ok) return undefined;
  const widthEmu = location?.letterheadLogoWidthEmu ?? 0;
  if (!Number.isSafeInteger(widthEmu) || widthEmu <= 0) return undefined;
  return {
    kind: "image",
    bytes,
    contentType: facts.value.contentType,
    widthEmu,
    heightEmu: heightForWidth(facts.value, widthEmu),
    description: `${location?.name ?? "Office"} letterhead`,
  };
}

export async function resolveMergeContext(
  database: SqlDatabase,
  input: ResolutionInput,
): Promise<ResolutionResult> {
  const sources = sourcesFor(input.manifest, input.dictionary);
  const wantedKeys = manifestKeySet(input.manifest);
  const values = new Map<string, MergeValue>();
  const absenceReasons = new Map<string, string>();
  const reads: MergeSource[] = [];

  // The location is the matter's, so a manifest that names a location field needs the matter row too —
  // one read, shared, not one per dependent source.
  const needsMatterRow = sources.has("matter") || sources.has("party") || sources.has("location");

  let matter: MatterMergeRow | undefined;
  if (needsMatterRow) {
    reads.push("matter");
    const { results } = await selectMatterForMergeStatement(
      database,
      input.matterId,
    ).all<MatterMergeColumns>();
    const row = results[0];
    if (row === undefined) {
      return { ok: false, reason: "matter-not-found", detail: `no such matter: ${input.matterId}` };
    }
    matter = toMatterMergeRow(row);
    valuesFromMatter(matter, values);
  }

  // The matter's estate record: ONE read for the whole `estate` subject — and for the capacity
  // line, which composes over the estate's stored style. It runs BEFORE the party pass because a
  // party's capacity line is composed there, from a style this read supplies; a matter with no
  // estate record returns no row, which is the conditional absence every estate key declares.
  const wantsCapacityLine = [...wantedKeys].some((key) => key.endsWith(".capacityLine"));
  let estate: MatterEstateMergeRow | undefined;
  if (sources.has("estate") || wantsCapacityLine) {
    reads.push("estate");
    const { results } = await selectMatterEstateForMergeStatement(
      database,
      input.matterId,
    ).all<MatterEstateMergeColumns>();
    const row = results[0];
    if (row !== undefined) {
      estate = toMatterEstateMergeRow(row);
      valuesFromEstate(estate, values);
    }
  }

  // The matter's parties: ONE read for the whole collection, never one per item, and never one per role.
  //
  // Every Directory role source is answered from THIS read. `opposingParty.displayName` is a pass over
  // an array already in memory, not a query of its own, which is what keeps the cost of role sources
  // tracking the number of SOURCES rather than the number of roles a template happens to name — a
  // per-role query would be the same N+1 in a new place. Filtering by role in SQL would buy nothing: a
  // matter's party list is the collection a repeat already walks whole, and one narrowed read per role
  // is more reads, not fewer.
  const roleSources = directoryRoleSourcesIn(wantedKeys);
  // The protected sources ride the SAME party read: a sealed identifier belongs to a Directory entity,
  // and the party links are what say which entity is this matter's client. Reading the client's link is
  // therefore free here and would be a second query anywhere else.
  const protectedSources = protectedIdentifierSourcesIn(wantedKeys);
  // The member subjects' bar numbers resolve against the STAFFING read's slots, below; declared
  // here so the one `protectedIdentifier` entry in the read record covers both passes.
  const memberProtectedSources = memberProtectedSourcesIn(wantedKeys);
  let protectedRecorded = false;
  if (wantedKeys.has("matter.parties") || roleSources.length > 0 || protectedSources.length > 0) {
    reads.push("party");
    const { results } = await selectMatterPartiesForMergeStatement(
      database,
      input.matterId,
    ).all<MatterPartyMergeColumns>();
    const parties = results.map(toMatterPartyMergeRow);
    if (wantedKeys.has("matter.parties")) {
      const items: MergeListItem[] = parties.map((party) => {
        const fields = new Map<string, MergeValue>([
          ["role", { kind: "text", text: party.role }],
          ["kind", { kind: "text", text: party.kind }],
        ]);
        const displayName = textValue(party.displayName);
        if (displayName !== undefined) fields.set("displayName", displayName);
        return { fields };
      });
      values.set("matter.parties", { kind: "list", items });
    }
    const roles = directoryRoleValues(
      parties,
      roleSources,
      wantedKeys,
      estate?.estateStyle == null || estate.estateStyle === ""
        ? {}
        : { estateStyle: estate.estateStyle },
    );
    for (const [key, value] of roles.values) values.set(key, value);
    for (const [key, reason] of roles.reasons) absenceReasons.set(key, reason);

    // The client's sealed identifiers, decrypted through the caller's chokepoint reader — the permission
    // gate, the audit row, and the AAD decrypt, in that order and inseparable, all of them the
    // chokepoint's own. A member who may not decrypt lands here with an absence carrying the field and
    // the permission, so the assembly completes and the gap is legible; nothing is thrown, and no
    // plaintext exists on this path for anyone who was refused.
    if (protectedSources.length > 0) {
      reads.push("protectedIdentifier");
      protectedRecorded = true;
      const sealed = await protectedIdentifierValues(
        protectedSources,
        parties,
        input.readProtectedIdentifier,
      );
      for (const [key, value] of sealed.values) values.set(key, value);
      for (const [key, reason] of sealed.reasons) absenceReasons.set(key, reason);
    }
  }

  // The matter's staffing: ONE read for every member subject a manifest names — the responsible
  // attorney off the matter row's own column, and the rest off the current assignment rows, all
  // joined to the member table, the professional profile, and the member's mapped Directory person.
  // Five subjects are five passes over the rows this returns, exactly as the party subjects ride
  // the party read.
  const staffingSources = staffingSourcesIn(wantedKeys);
  let staffingSlots: ReadonlyMap<string, StaffingSlot> = new Map();
  if (staffingSources.length > 0 || memberProtectedSources.length > 0) {
    reads.push("staffing");
    const { results } = await selectMatterStaffingForMergeStatement(
      database,
      input.matterId,
      input.assembledAt,
    ).all<MatterStaffingMergeColumns>();
    const rows = results.map(toMatterStaffingMergeRow);
    // The protected pass needs every subject's slot even when no ordinary staffing key named it, so
    // the slot resolution runs over the union of the two source lists' subjects.
    const slotSources = new Map(staffingSources.map((source) => [source.key, source]));
    for (const protectedSource of memberProtectedSources) {
      for (const source of staffingSourcesIn([`${protectedSource.subjectKey}.displayName`])) {
        slotSources.set(source.key, source);
      }
    }
    const staffing = staffingValues(rows, [...slotSources.values()], wantedKeys);
    staffingSlots = staffing.slots;
    for (const [key, value] of staffing.values) {
      if (wantedKeys.has(key)) values.set(key, value);
    }
    for (const [key, reason] of staffing.reasons) {
      if (wantedKeys.has(key)) absenceReasons.set(key, reason);
    }

    // The firm's own people's bar numbers, through the same chokepoint reader the client's sealed
    // identifiers use — and only for a slot that RESOLVED. An ambiguous slot is an absence before
    // any decryption is attempted, so an assembly cannot generate a decrypt audit trail for a
    // member the document never names.
    if (memberProtectedSources.length > 0) {
      if (!protectedRecorded) {
        reads.push("protectedIdentifier");
        protectedRecorded = true;
      }
      const sealed = await memberProtectedValues(
        memberProtectedSources,
        staffingSlots,
        input.readProtectedIdentifier,
      );
      for (const [key, value] of sealed.values) values.set(key, value);
      for (const [key, reason] of sealed.reasons) absenceReasons.set(key, reason);
    }
  }

  // The matter's court-case record: ONE read shared by the `court` and `case` subjects, joined to
  // the court's Directory organisation and the judge's Directory person. A matter with no court
  // case returns no row — the conditional absence every court key declares, not a defect.
  if (sources.has("court")) {
    reads.push("court");
    const { results } = await selectMatterCourtCaseForMergeStatement(
      database,
      input.matterId,
    ).all<MatterCourtCaseMergeColumns>();
    const row = results[0];
    if (row !== undefined) {
      const courtCase = toMatterCourtCaseMergeRow(row);
      const set = (key: string, value: MergeValue | undefined): void => {
        if (value !== undefined) values.set(key, value);
      };
      set("court.name", textValue(courtCase.courtName));
      set(
        "court.judge",
        nameValueFromParts(courtCase.judgeDisplayName, {
          prefix: courtCase.judgeNamePrefix,
          given: courtCase.judgeNameGiven,
          middle: courtCase.judgeNameMiddle,
          family: courtCase.judgeNameFamily,
          suffix: courtCase.judgeNameSuffix,
        }),
      );
      set("case.number", textValue(courtCase.caseNumber));
      set("case.filedOn", dateValue(courtCase.filedOn));
      set("case.division", textValue(courtCase.division));
      set("case.department", textValue(courtCase.department));
      set("case.clientDesignation", textValue(courtCase.clientDesignation));
      set("case.opposingDesignation", textValue(courtCase.opposingDesignation));
    }
  }

  // The matter's asset register: ONE read for every asset subject a manifest names, never one per
  // class and never one per asset. Eleven subjects are eleven passes over the rows this returns, so a
  // template walking every class costs exactly what a template walking one costs — and adding the
  // twelfth class costs nothing at all, which is the property the catalogue's shape exists to
  // preserve.
  //
  // THE DATE. Every figure this source returns is resolved as of one date and travels with the date
  // it actually speaks to. Where that date comes from is not this subsystem's fact: for an estate it
  // is the date of death, which belongs to the estate record alone, and the caller supplies it here
  // (`assetsAsOfDate`) so the register is read and no second copy of a date is stored. Absent, the
  // assembly's own date stands in — a schedule assembled today, as of today, which is the only
  // defensible default and is still an explicit one.
  const assetSubjects = assetSubjectsIn(wantedKeys);
  if (assetSubjects.length > 0) {
    reads.push("asset");
    const asOfDate = input.assetsAsOfDate ?? input.assembledAt.slice(0, 10);
    const { results } = await selectMatterAssetsForMergeStatement(
      database,
      input.matterId,
      asOfDate,
      MAX_ASSETS_PER_ASSEMBLY,
    ).all<MatterAssetMergeRow>();
    for (const [key, value] of assetSubjectValues(results, assetSubjects)) {
      values.set(key, value);
    }
  }

  let location: LocationMergeRow | undefined;
  if (sources.has("location") && matter?.locationId != null) {
    reads.push("location");
    const { results } = await selectLocationForMergeStatement(
      database,
      matter.locationId,
    ).all<LocationMergeColumns>();
    const row = results[0];
    if (row !== undefined) {
      location = toLocationMergeRow(row);
      valuesFromLocation(location, values);
    }
  }

  // The firm's own fields: ONE read covering every handle the manifest mentions, however many that is,
  // and none at all for a template that binds none.
  if (sources.has("customField")) {
    const handles = customFieldHandlesFor(input.manifest);
    if (handles.length > 0) {
      reads.push("customField");
      const { results } = await selectCustomFieldValuesStatement(
        database,
        input.matterId,
        handles,
      ).all<CustomFieldValueColumns>();
      for (const row of results) {
        // AN ARCHIVED FIELD IS AN ABSENCE, reported as one. The firm withdrew the field; a document that
        // went on printing the value it last held would be asserting something the firm stopped standing
        // behind, and doing it invisibly.
        if (isArchivedCustomFieldRow(row)) continue;
        const value = mergeValueForCustomField(toCustomFieldValueRow(row), input.currencyCode);
        if (value !== undefined) values.set(customMergeKeyFor(row.handle), value);
      }
    }
  }

  if (sources.has("firm")) {
    const firmName = textValue(input.firmName);
    if (firmName !== undefined) values.set("firm.name", firmName);
  }

  const timeZone = timeZoneForLocation(location);

  if (sources.has("system")) {
    values.set("system.today", { kind: "instant", isoInstant: input.assembledAt });
  }

  // The letterhead logo's bytes. Fetched only when the template actually draws one, and only after the
  // location row said there is one to fetch — an object-store round trip is the most expensive thing
  // resolution can do, and a template with no logo placeholder pays for none of it.
  if (wantedKeys.has("location.letterheadLogo")) {
    const image = await resolveLetterheadLogo(location, input.readImageAsset);
    if (image !== undefined) values.set("location.letterheadLogo", image);
  }

  // Absence is computed against what the MANIFEST asked for, not against the dictionary as a whole: a
  // key a template never uses is not missing from that template's assembly.
  const absentKeys = manifestKeys(input.manifest).filter((key) => !values.has(key));
  // A reason for a key that resolved after all is not a reason for anything — drop it rather than carry
  // an explanation of an absence that did not happen.
  for (const key of absenceReasons.keys()) {
    if (values.has(key)) absenceReasons.delete(key);
  }

  return { ok: true, context: { values, absentKeys, absenceReasons, timeZone }, reads };
}

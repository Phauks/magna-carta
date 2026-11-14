/*
 * What the Columns tab holds, and how it becomes the request for a pass.
 *
 * The operator says what each column of a file holds. That statement is kept here as one assignment
 * per column, because a column is what the operator is looking at. The contract wants the opposite
 * shape: one rule per field, naming its column. `passRequestFrom` turns the first into the second,
 * and `mappingFromStated` turns a pass's stored rules back, so a file that has been run opens on the
 * mapping it ran under.
 *
 * Everything here is pure, and imports nothing from the app, so it is tested without a browser.
 */
import type {
  RecordTransferMatterRules,
  RecordTransferOrganizationRules,
  RecordTransferPassStatedResponse,
  RecordTransferPersonRules,
  RequestRecordTransferPassRequest,
} from "@magna-carta/api-client";

export type TransferRecordKind = "person" | "organization" | "matter";
export type SourceDateOrder = "year-month-day" | "day-month-year" | "month-day-year";
export type DelimiterName = "comma" | "tab" | "semicolon" | "pipe";
type DelimiterCharacter = "," | "\t" | ";" | "|";

const DELIMITER_CHARACTERS: Record<DelimiterName, DelimiterCharacter> = {
  comma: ",",
  tab: "\t",
  semicolon: ";",
  pipe: "|",
};

/** The name of the delimiter a stored pass was read with. A pass that named none read commas. */
export function delimiterNameOf(character: string | null): DelimiterName {
  const found = (Object.keys(DELIMITER_CHARACTERS) as DelimiterName[]).find(
    (name) => DELIMITER_CHARACTERS[name] === character,
  );
  return found ?? "comma";
}

/**
 * The delimiter a header row was really written with, when it was read as one column. A file read
 * with the wrong delimiter comes back as a single column whose name still contains the right one.
 */
export function delimiterHintedBy(columns: readonly string[]): DelimiterName | null {
  if (columns.length !== 1) return null;
  const header = columns[0] ?? "";
  const candidates: DelimiterName[] = ["tab", "semicolon", "pipe", "comma"];
  return candidates.find((name) => header.includes(DELIMITER_CHARACTERS[name])) ?? null;
}

/** What a file holds, as the upload asks it, with the slugs each answer stands for. */
export interface FileKindChoice {
  readonly recordKind: TransferRecordKind;
  /** What the panel and the upload call it. */
  readonly label: string;
  /** The slug the file is registered under. */
  readonly fileKind: string;
  /** The slug the file's rows are linked under, which another file's reference names. */
  readonly sourceKind: string;
}

export const FILE_KIND_CHOICES: readonly FileKindChoice[] = [
  { recordKind: "person", label: "People", fileKind: "card-list", sourceKind: "card" },
  {
    recordKind: "organization",
    label: "Organizations",
    fileKind: "organization-list",
    sourceKind: "organization",
  },
  {
    recordKind: "matter",
    label: "Matters and Parties",
    fileKind: "matter-list",
    sourceKind: "matter",
  },
];

export function fileKindChoiceFor(recordKind: TransferRecordKind): FileKindChoice {
  return FILE_KIND_CHOICES.find((choice) => choice.recordKind === recordKind) as FileKindChoice;
}

/** The record kind a file's registered slug stands for, or null for a slug this screen did not set. */
export function recordKindOfFileKind(fileKind: string): TransferRecordKind | null {
  return FILE_KIND_CHOICES.find((choice) => choice.fileKind === fileKind)?.recordKind ?? null;
}

/** A column that is left out of the transfer. The default for every column. */
export const NOT_BROUGHT_IN = "skip";
/** A column that is the key of each row and holds nothing else. */
export const KEY_ONLY = "key";

/** What the detail cell beside a field offers. */
export type HoldsDetail =
  | "none"
  | "date"
  | "closedDate"
  | "client"
  | "party"
  | "matterTypes"
  | "members";

export interface HoldsField {
  readonly value: string;
  readonly label: string;
  /** A pass is refused until some column holds this. */
  readonly required: boolean;
  /** More than one column may hold this. */
  readonly repeatable: boolean;
  readonly detail: HoldsDetail;
}

function field(
  value: string,
  label: string,
  options: { required?: boolean; repeatable?: boolean; detail?: HoldsDetail } = {},
): HoldsField {
  return {
    value,
    label,
    required: options.required ?? false,
    repeatable: options.repeatable ?? false,
    detail: options.detail ?? "none",
  };
}

const CONTACT_FIELDS: readonly HoldsField[] = [
  field("email", "Email", { repeatable: true }),
  field("phone", "Phone", { repeatable: true }),
  field("fax", "Fax", { repeatable: true }),
  field("street", "Street Address"),
  field("streetTwo", "Street Address Line 2"),
  field("dependentLocality", "Suburb or District"),
  field("city", "City"),
  field("region", "State or Region"),
  field("postal", "Postal Code"),
];

const ADDRESS_FIELDS = [
  "street",
  "streetTwo",
  "dependentLocality",
  "city",
  "region",
  "postal",
] as const;

const PERSON_FIELDS: readonly HoldsField[] = [
  field("given", "Given Name", { required: true }),
  field("family", "Family Name", { required: true }),
  field("prefix", "Name Prefix"),
  field("middle", "Middle Name"),
  field("suffix", "Name Suffix"),
  field("dateOfBirth", "Date of Birth", { detail: "date" }),
  ...CONTACT_FIELDS,
];

const ORGANIZATION_FIELDS: readonly HoldsField[] = [
  field("legalName", "Legal Name", { required: true }),
  ...CONTACT_FIELDS,
];

const MATTER_FIELDS: readonly HoldsField[] = [
  field("number", "Matter Number", { required: true }),
  field("title", "Title", { required: true }),
  field("description", "Description"),
  field("clientDisplayName", "Client Display Name"),
  field("openedDate", "Opening Date", { required: true, detail: "date" }),
  field("closedDate", "Closing Date", { detail: "closedDate" }),
  field("client", "Client", { detail: "client" }),
  field("party", "Party", { repeatable: true, detail: "party" }),
  field("matterType", "Matter Type", { detail: "matterTypes" }),
  field("responsibleMember", "Responsible Member", { detail: "members" }),
];

const KEY_FIELD = field(KEY_ONLY, "Key of Each Row");
const SKIP_FIELD = field(NOT_BROUGHT_IN, "Do Not Bring In", { repeatable: true });

/** The fields of a record kind, one for each rule the contract has for it. */
export function recordFields(recordKind: TransferRecordKind): readonly HoldsField[] {
  if (recordKind === "person") return PERSON_FIELDS;
  if (recordKind === "organization") return ORGANIZATION_FIELDS;
  return MATTER_FIELDS;
}

/** Everything the Holds field offers for a record kind: its fields, the key, and leaving it out. */
export function holdsOptions(recordKind: TransferRecordKind): readonly HoldsField[] {
  return [SKIP_FIELD, KEY_FIELD, ...recordFields(recordKind)];
}

export function holdsField(recordKind: TransferRecordKind, value: string): HoldsField {
  return holdsOptions(recordKind).find((option) => option.value === value) ?? SKIP_FIELD;
}

export interface ColumnAssignment {
  /** A field's value, `KEY_ONLY` or `NOT_BROUGHT_IN`. */
  holds: string;
  /** For a client or a party: the slug the referenced rows were linked under. */
  referenceSourceKind: string;
  /** For a party: its role on the matter. */
  role: string;
}

export interface FileMapping {
  recordKind: TransferRecordKind;
  /** The slug this file's rows are linked under. */
  sourceKind: string;
  delimiter: DelimiterName;
  /** One assignment per column the operator has touched, by the column's own name. */
  assignments: Record<string, ColumnAssignment>;
  /** The order the file's dates are written in. Empty until chosen. */
  dateOrder: SourceDateOrder | "";
  /** The zone a matter file's days are in. */
  timeZone: string;
  /** The country of the file's addresses, as two letters. Empty where not stated. */
  addressCountry: string;
  /** The source's codes for matter types, each matched to one of the firm's. */
  matterTypes: Record<string, string>;
  /** The source's codes for staff, each matched to a member. */
  members: Record<string, string>;
  /** The member who takes every row whose code is not matched. Empty where none. */
  otherwiseMember: string;
}

export interface MappingDefaults {
  /** The zone offered for a matter file's days: the reader's own. */
  readonly timeZone: string;
  /** The slug a client or party column refers to until the operator says otherwise. */
  readonly referenceSourceKind: string;
}

export function blankMapping(
  recordKind: TransferRecordKind,
  defaults: MappingDefaults,
): FileMapping {
  return {
    recordKind,
    sourceKind: fileKindChoiceFor(recordKind).sourceKind,
    delimiter: "comma",
    assignments: {},
    dateOrder: "",
    timeZone: defaults.timeZone,
    addressCountry: "",
    matterTypes: {},
    members: {},
    otherwiseMember: "",
  };
}

export function assignmentOf(
  mapping: FileMapping,
  column: string,
  defaults: MappingDefaults,
): ColumnAssignment {
  return (
    mapping.assignments[column] ?? {
      holds: NOT_BROUGHT_IN,
      referenceSourceKind: defaults.referenceSourceKind,
      role: "",
    }
  );
}

/**
 * The column that holds each row's key. A column marked as the key alone is it. A matter file with
 * no such column is keyed by its matter number, which is the usual case.
 */
export function keyColumnOf(mapping: FileMapping, columns: readonly string[]): string | null {
  const explicit = columns.find((column) => mapping.assignments[column]?.holds === KEY_ONLY);
  if (explicit !== undefined) return explicit;
  if (mapping.recordKind !== "matter") return null;
  return columns.find((column) => mapping.assignments[column]?.holds === "number") ?? null;
}

function columnsHolding(
  mapping: FileMapping,
  columns: readonly string[],
  value: string,
): readonly string[] {
  return columns.filter((column) => mapping.assignments[column]?.holds === value);
}

function columnHolding(
  mapping: FileMapping,
  columns: readonly string[],
  value: string,
): string | undefined {
  return columnsHolding(mapping, columns, value)[0];
}

/** Whether any column holds a date, which is what makes the date order a required answer. */
export function holdsAnyDate(mapping: FileMapping, columns: readonly string[]): boolean {
  return columns.some((column) => {
    const detail = holdsField(mapping.recordKind, mapping.assignments[column]?.holds ?? "").detail;
    return detail === "date" || detail === "closedDate";
  });
}

/** Whether any column holds part of an address, which is when the address country applies. */
export function holdsAnyAddress(mapping: FileMapping, columns: readonly string[]): boolean {
  return ADDRESS_FIELDS.some((part) => columnHolding(mapping, columns, part) !== undefined);
}

/** What still stands between a mapping and a pass. */
export interface MappingProblems {
  /** The labels of what no column holds yet, the key included. */
  readonly missing: readonly string[];
  /** Columns whose Holds answer another column already gave, for a field that takes one column. */
  readonly repeatedColumns: ReadonlySet<string>;
  /** Columns whose detail (a party's role, what a reference refers to) is unset. */
  readonly detailColumns: ReadonlySet<string>;
  readonly dateOrderMissing: boolean;
  readonly timeZoneMissing: boolean;
  /** A matter file with nobody to be responsible for a row: no matched code and nobody for the rest. */
  readonly responsibleMemberMissing: boolean;
  readonly ready: boolean;
}

export function mappingProblems(mapping: FileMapping, columns: readonly string[]): MappingProblems {
  const missing: string[] = [];
  if (keyColumnOf(mapping, columns) === null) missing.push(KEY_FIELD.label);
  for (const candidate of recordFields(mapping.recordKind)) {
    if (candidate.required && columnHolding(mapping, columns, candidate.value) === undefined) {
      missing.push(candidate.label);
    }
  }

  const repeatedColumns = new Set<string>();
  const detailColumns = new Set<string>();
  const keyColumns = columnsHolding(mapping, columns, KEY_ONLY);
  if (keyColumns.length > 1) for (const column of keyColumns) repeatedColumns.add(column);
  for (const candidate of recordFields(mapping.recordKind)) {
    const holders = columnsHolding(mapping, columns, candidate.value);
    if (!candidate.repeatable && holders.length > 1) {
      for (const column of holders) repeatedColumns.add(column);
    }
    if (candidate.detail === "client" || candidate.detail === "party") {
      for (const column of holders) {
        const assignment = mapping.assignments[column];
        if (assignment === undefined) continue;
        const roleMissing = candidate.detail === "party" && assignment.role.trim() === "";
        if (assignment.referenceSourceKind === "" || roleMissing) detailColumns.add(column);
      }
    }
  }

  const dateOrderMissing = holdsAnyDate(mapping, columns) && mapping.dateOrder === "";
  const isMatter = mapping.recordKind === "matter";
  const timeZoneMissing = isMatter && mapping.timeZone.trim() === "";
  const memberColumn = columnHolding(mapping, columns, "responsibleMember");
  const responsibleMemberMissing =
    isMatter &&
    mapping.otherwiseMember === "" &&
    (memberColumn === undefined || Object.keys(mapping.members).length === 0);
  if (responsibleMemberMissing && memberColumn === undefined) missing.push("Responsible Member");

  const ready =
    missing.length === 0 &&
    repeatedColumns.size === 0 &&
    detailColumns.size === 0 &&
    !dateOrderMissing &&
    !timeZoneMissing &&
    !responsibleMemberMissing;
  return {
    missing,
    repeatedColumns,
    detailColumns,
    dateOrderMissing,
    timeZoneMissing,
    responsibleMemberMissing,
    ready,
  };
}

type ContactRules = Pick<
  RecordTransferPersonRules,
  "emails" | "phones" | "address" | "addressCountry"
>;

function contactRules(mapping: FileMapping, columns: readonly string[]): ContactRules {
  const rules: ContactRules = {};
  const emails = columnsHolding(mapping, columns, "email");
  if (emails.length > 0) rules.emails = [...emails];
  const phones = columns.flatMap((column) => {
    const holds = mapping.assignments[column]?.holds;
    if (holds === "phone") return [{ column }];
    if (holds === "fax") return [{ column, fax: true }];
    return [];
  });
  if (phones.length > 0) rules.phones = phones;
  const address: NonNullable<ContactRules["address"]> = {};
  for (const part of ADDRESS_FIELDS) {
    const column = columnHolding(mapping, columns, part);
    if (column !== undefined) address[part] = column;
  }
  if (Object.keys(address).length > 0) {
    rules.address = address;
    if (mapping.addressCountry !== "") rules.addressCountry = mapping.addressCountry;
  }
  return rules;
}

function optionalColumns<Key extends string>(
  mapping: FileMapping,
  columns: readonly string[],
  keys: readonly Key[],
): Partial<Record<Key, string>> {
  const found: Partial<Record<Key, string>> = {};
  for (const key of keys) {
    const column = columnHolding(mapping, columns, key);
    if (column !== undefined) found[key] = column;
  }
  return found;
}

/**
 * The request for a pass over a file, built from what the Columns tab holds. Null while the mapping
 * is not ready, so a request is never sent that the server would only refuse.
 */
export function passRequestFrom(
  mapping: FileMapping,
  fileId: string,
  columns: readonly string[],
): RequestRecordTransferPassRequest | null {
  const keyColumn = keyColumnOf(mapping, columns);
  if (keyColumn === null || !mappingProblems(mapping, columns).ready) return null;
  const target = {
    fileId,
    sourceKind: mapping.sourceKind,
    keyColumn,
    ...(mapping.delimiter === "comma"
      ? {}
      : { delimiter: DELIMITER_CHARACTERS[mapping.delimiter] }),
  };
  const dateOrder = mapping.dateOrder === "" ? undefined : mapping.dateOrder;

  if (mapping.recordKind === "person") {
    const dateOfBirth = columnHolding(mapping, columns, "dateOfBirth");
    const rules: RecordTransferPersonRules = {
      given: columnHolding(mapping, columns, "given") as string,
      family: columnHolding(mapping, columns, "family") as string,
      ...optionalColumns(mapping, columns, ["prefix", "middle", "suffix"]),
      ...(dateOfBirth === undefined ? {} : { dateOfBirth, dateOrder }),
      ...contactRules(mapping, columns),
    };
    return { recordKind: "person", ...target, rules };
  }

  if (mapping.recordKind === "organization") {
    const rules: RecordTransferOrganizationRules = {
      legalName: columnHolding(mapping, columns, "legalName") as string,
      ...contactRules(mapping, columns),
    };
    return { recordKind: "organization", ...target, rules };
  }

  const clientColumn = columnHolding(mapping, columns, "client");
  const parties = columnsHolding(mapping, columns, "party").map((column) => ({
    column,
    sourceKind: mapping.assignments[column]?.referenceSourceKind ?? "",
    role: (mapping.assignments[column]?.role ?? "").trim(),
  }));
  const matterTypeColumn = columnHolding(mapping, columns, "matterType");
  const memberColumn = columnHolding(mapping, columns, "responsibleMember");
  const rules: RecordTransferMatterRules = {
    title: columnHolding(mapping, columns, "title") as string,
    number: columnHolding(mapping, columns, "number") as string,
    ...optionalColumns(mapping, columns, ["description", "clientDisplayName", "closedDate"]),
    openedDate: columnHolding(mapping, columns, "openedDate") as string,
    dateOrder: dateOrder as SourceDateOrder,
    timeZone: mapping.timeZone.trim(),
    ...(clientColumn === undefined
      ? {}
      : {
          client: {
            column: clientColumn,
            sourceKind: mapping.assignments[clientColumn]?.referenceSourceKind ?? "",
          },
        }),
    ...(parties.length === 0 ? {} : { parties }),
    ...(matterTypeColumn === undefined
      ? {}
      : { matterType: { column: matterTypeColumn, types: { ...mapping.matterTypes } } }),
    responsibleMember: {
      ...(memberColumn === undefined ? {} : { column: memberColumn }),
      members: memberColumn === undefined ? {} : { ...mapping.members },
      ...(mapping.otherwiseMember === "" ? {} : { otherwise: mapping.otherwiseMember }),
    },
  };
  return { recordKind: "matter", ...target, rules };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function textRecord(value: unknown): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record(value))) {
    if (typeof entry === "string") found[key] = entry;
  }
  return found;
}

/**
 * The mapping a pass ran under, read back from what it was asked with. The stored rules are read
 * defensively: a field this screen does not know is passed over, never guessed at.
 */
export function mappingFromStated(
  stated: RecordTransferPassStatedResponse,
  defaults: MappingDefaults,
): FileMapping {
  const mapping = blankMapping(stated.recordKind, defaults);
  mapping.sourceKind = stated.sourceKind;
  mapping.delimiter = delimiterNameOf(stated.delimiter);
  const rules = record(stated.rules);

  const assign = (column: unknown, holds: string, extra: Partial<ColumnAssignment> = {}): void => {
    const name = text(column);
    if (name === undefined) return;
    mapping.assignments[name] = {
      holds,
      referenceSourceKind: defaults.referenceSourceKind,
      role: "",
      ...extra,
    };
  };

  // The key first, so a column that is also a field (a matter's number) ends as the field.
  assign(stated.keyColumn, KEY_ONLY);

  for (const candidate of recordFields(stated.recordKind)) {
    if (
      candidate.detail === "none" ||
      candidate.detail === "date" ||
      candidate.detail === "closedDate"
    ) {
      assign(rules[candidate.value], candidate.value);
    }
  }
  for (const email of Array.isArray(rules.emails) ? rules.emails : []) assign(email, "email");
  for (const phone of Array.isArray(rules.phones) ? rules.phones : []) {
    const entry = record(phone);
    assign(entry.column, entry.fax === true ? "fax" : "phone");
  }
  const address = record(rules.address);
  for (const part of ADDRESS_FIELDS) assign(address[part], part);
  mapping.addressCountry = text(rules.addressCountry) ?? "";

  const dateOrder = text(rules.dateOrder);
  if (
    dateOrder === "year-month-day" ||
    dateOrder === "day-month-year" ||
    dateOrder === "month-day-year"
  ) {
    mapping.dateOrder = dateOrder;
  }

  if (stated.recordKind === "matter") {
    mapping.timeZone = text(rules.timeZone) ?? defaults.timeZone;
    const client = record(rules.client);
    assign(client.column, "client", {
      referenceSourceKind: text(client.sourceKind) ?? defaults.referenceSourceKind,
    });
    for (const party of Array.isArray(rules.parties) ? rules.parties : []) {
      const entry = record(party);
      assign(entry.column, "party", {
        referenceSourceKind: text(entry.sourceKind) ?? defaults.referenceSourceKind,
        role: text(entry.role) ?? "",
      });
    }
    const matterType = record(rules.matterType);
    assign(matterType.column, "matterType");
    mapping.matterTypes = textRecord(matterType.types);
    const responsibleMember = record(rules.responsibleMember);
    assign(responsibleMember.column, "responsibleMember");
    mapping.members = textRecord(responsibleMember.members);
    mapping.otherwiseMember = text(responsibleMember.otherwise) ?? "";
  }
  return mapping;
}

import { isEmailAddress } from "@magna-carta/directory/email-address";
import type { CreateOrganizationInput } from "@magna-carta/directory/organization";
import type { CreatePersonRecordInput } from "@magna-carta/directory/person-record";
import type { PostalAddressParts } from "@magna-carta/directory/postal-address";
import { sourceFileRowFields, type SourceFileRow, type SourceFileRowFault } from "./source-file.ts";

// The mapping rules for Directory records: which column of a source file holds which part of a
// person or an organization. The rules are data, stated by whoever runs the transfer after looking
// at the file. No column name of any source system appears in this module, so the same code carries
// a report, a table of an extract, or a file from a different system.
//
// Mapping is pure. It turns one row into a draft the Directory's own write path accepts, or says why
// it cannot, and it writes nothing.

// The order a file writes a date's parts in. Stated, never guessed: `03/04/2021` is the third of
// April in one country's export and the fourth of March in another's, and a guess that is right for
// the first hundred rows is the kind that goes unnoticed.
export type SourceDateOrder = "year-month-day" | "day-month-year" | "month-day-year";

export interface AddressColumns {
  readonly street?: string;
  readonly streetTwo?: string;
  readonly dependentLocality?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postal?: string;
}

export interface ContactColumns {
  // Every column that holds an email address. The first with a usable value becomes the primary.
  readonly emails?: readonly string[];
  // Every column that holds a number, and whether a fax machine answers it.
  readonly phones?: readonly { readonly column: string; readonly fax?: boolean }[];
  readonly address?: AddressColumns;
  // ISO 3166-1 alpha-2, applied to every address in the file. A source's country column is a name
  // in the source's own spelling, so the country is stated once here and never read from a row.
  readonly addressCountry?: string;
}

export interface PersonMappingRules extends ContactColumns {
  readonly given: string;
  readonly family: string;
  readonly prefix?: string;
  readonly middle?: string;
  readonly suffix?: string;
  readonly dateOfBirth?: string;
  // Required when dateOfBirth is mapped.
  readonly dateOrder?: SourceDateOrder;
}

export interface OrganizationMappingRules extends ContactColumns {
  readonly legalName: string;
}

// Why a row produced no record. `noName` is the one a person can act on at the source: the row has
// nothing in the columns a name comes from.
export type MappingRejection = SourceFileRowFault | "noName";

// A value that was left out of an otherwise good record. The record is still made, and the value is
// reported with its column so a person can find it in the file. Dropping it silently would lose a
// fact; refusing the whole person over a malformed fax number would lose more.
export type MappingFindingKind = "emailNotAnAddress" | "phoneHasNoDigits" | "dateUnreadable";

export interface MappingFinding {
  readonly column: string;
  readonly finding: MappingFindingKind;
}

export type OrganizationDraft = CreateOrganizationInput & {
  readonly emails: NonNullable<CreatePersonRecordInput["emails"]>;
  readonly phones: NonNullable<CreatePersonRecordInput["phones"]>;
  readonly addresses: NonNullable<CreatePersonRecordInput["addresses"]>;
};

export type Mapped<Draft> =
  | { readonly ok: true; readonly draft: Draft; readonly findings: readonly MappingFinding[] }
  | { readonly ok: false; readonly rejection: MappingRejection };

export class IncompleteMappingRulesError extends Error {
  constructor() {
    super("mapping rules that map a date must also state the order the file writes dates in.");
    this.name = "IncompleteMappingRulesError";
  }
}

// Every column a set of rules reads, so the rules can be checked against a file's header once,
// before the first row, and a misspelt column is one finding and not one per row.
export function columnsNamedBy(rules: PersonMappingRules | OrganizationMappingRules): string[] {
  const columns: (string | undefined)[] = [
    ...(rules.emails ?? []),
    ...(rules.phones ?? []).map((phone) => phone.column),
    ...Object.values(rules.address ?? {}),
  ];
  if ("legalName" in rules) {
    columns.push(rules.legalName);
  } else {
    columns.push(
      rules.given,
      rules.family,
      rules.prefix,
      rules.middle,
      rules.suffix,
      rules.dateOfBirth,
    );
  }
  return [...new Set(columns.filter((column): column is string => column !== undefined))];
}

// The columns the rules name that the file does not have. Empty means the rules fit the file.
export function columnsMissingFrom(
  header: readonly string[],
  rules: PersonMappingRules | OrganizationMappingRules,
): string[] {
  const present = new Set(header);
  return columnsNamedBy(rules).filter((column) => !present.has(column));
}

export function mapPersonRow(
  rules: PersonMappingRules,
  header: readonly string[],
  row: SourceFileRow,
): Mapped<CreatePersonRecordInput> {
  if (rules.dateOfBirth !== undefined && rules.dateOrder === undefined) {
    throw new IncompleteMappingRulesError();
  }
  const laid = sourceFileRowFields(header, row);
  if (!laid.ok) return { ok: false, rejection: laid.fault };
  const read = (column: string | undefined): string | null => valueOf(laid.fields, column);

  const given = read(rules.given) ?? "";
  const family = read(rules.family) ?? "";
  if (given === "" && family === "") return { ok: false, rejection: "noName" };

  const findings: MappingFinding[] = [];
  const contact = mapContact(rules, laid.fields, findings);

  let dateOfBirth: string | null = null;
  const dateText = read(rules.dateOfBirth);
  if (dateText !== null && rules.dateOfBirth !== undefined && rules.dateOrder !== undefined) {
    dateOfBirth = calendarDateFrom(dateText, rules.dateOrder);
    if (dateOfBirth === null) {
      findings.push({ column: rules.dateOfBirth, finding: "dateUnreadable" });
    }
  }

  return {
    ok: true,
    draft: {
      name: {
        given,
        family,
        prefix: read(rules.prefix),
        middle: read(rules.middle),
        suffix: read(rules.suffix),
      },
      dateOfBirth,
      ...contact,
    },
    findings,
  };
}

export function mapOrganizationRow(
  rules: OrganizationMappingRules,
  header: readonly string[],
  row: SourceFileRow,
): Mapped<OrganizationDraft> {
  const laid = sourceFileRowFields(header, row);
  if (!laid.ok) return { ok: false, rejection: laid.fault };
  const legalName = valueOf(laid.fields, rules.legalName);
  if (legalName === null) return { ok: false, rejection: "noName" };

  const findings: MappingFinding[] = [];
  const contact = mapContact(rules, laid.fields, findings);
  return { ok: true, draft: { legalName, ...contact }, findings };
}

// A value as a record field: trimmed, and absent when there is nothing left. The reader hands on a
// value's exact characters; this is the first point at which leading and trailing space is judged
// to carry no meaning, and it is judged so only for the fields mapped here.
function valueOf(fields: ReadonlyMap<string, string>, column: string | undefined): string | null {
  if (column === undefined) return null;
  const trimmed = (fields.get(column) ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function mapContact(
  rules: ContactColumns,
  fields: ReadonlyMap<string, string>,
  findings: MappingFinding[],
): Pick<OrganizationDraft, "emails" | "phones" | "addresses"> {
  const emails: OrganizationDraft["emails"][number][] = [];
  const seenAddresses = new Set<string>();
  for (const column of rules.emails ?? []) {
    const address = valueOf(fields, column);
    if (address === null) continue;
    if (!isEmailAddress(address)) {
      findings.push({ column, finding: "emailNotAnAddress" });
      continue;
    }
    // The same address in two columns is one way to reach somebody, not two.
    const key = address.toLowerCase();
    if (seenAddresses.has(key)) continue;
    seenAddresses.add(key);
    emails.push({ address, isPrimary: emails.length === 0 });
  }

  const phones: OrganizationDraft["phones"][number][] = [];
  let voiceSeen = false;
  for (const { column, fax } of rules.phones ?? []) {
    const number = valueOf(fields, column);
    if (number === null) continue;
    if (!/[0-9]/.test(number)) {
      findings.push({ column, finding: "phoneHasNoDigits" });
      continue;
    }
    // The first number a person can be spoken to on is the primary; a fax line never is.
    const isPrimary = fax !== true && !voiceSeen;
    if (fax !== true) voiceSeen = true;
    phones.push({ number, contactSystem: fax === true ? "fax" : "voice", isPrimary });
  }

  const addresses: OrganizationDraft["addresses"][number][] = [];
  const columns = rules.address;
  if (columns !== undefined) {
    const parts: PostalAddressParts = {
      street: valueOf(fields, columns.street),
      streetTwo: valueOf(fields, columns.streetTwo),
      dependentLocality: valueOf(fields, columns.dependentLocality),
      city: valueOf(fields, columns.city),
      region: valueOf(fields, columns.region),
      postal: valueOf(fields, columns.postal),
    };
    // The stated country alone is not an address: a row with every address column empty has none.
    if (Object.values(parts).some((part) => part !== null)) {
      addresses.push({ ...parts, country: rules.addressCountry ?? null, isPrimary: true });
    }
  }

  return { emails, phones, addresses };
}

// A date in the file's stated order, as YYYY-MM-DD, or null when the text is not a date in that
// order. Accepts `/`, `-` and `.` between the parts and a trailing time, which exports often add to
// a date-only column. A two-digit year is refused: nothing in the file says which century.
export function calendarDateFrom(text: string, order: SourceDateOrder): string | null {
  const match = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[ T].*)?$/.exec(text.trim());
  if (match === null) return null;
  const [first, second, third] = [match[1] ?? "", match[2] ?? "", match[3] ?? ""];
  const [yearText, monthText, dayText] =
    order === "year-month-day"
      ? [first, second, third]
      : order === "day-month-year"
        ? [third, second, first]
        : [third, first, second];
  if (yearText.length !== 4 || monthText.length > 2 || dayText.length > 2) return null;
  const iso = `${yearText}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`;
  // A well-shaped date that names no day (the thirtieth of February) is not a date.
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(iso)) return null;
  return iso;
}

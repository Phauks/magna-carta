import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import { instantForCivilDateTime, isResolvableTimeZone } from "@magna-carta/civil-time/time-zone";
import type { MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import { calendarDateFrom, valueOf, type SourceDateOrder } from "./directory-mapping.ts";
import { sourceFileRowFields, type SourceFileRow, type SourceFileRowFault } from "./source-file.ts";

// The mapping rules for matters: which column of a source file holds which part of a matter, and
// how the source's own words for a matter type and a member of staff translate to the records here.
// Like the Directory's rules they are data stated by whoever runs the transfer, and no column name
// or code of any source system appears in this module.
//
// Mapping is pure and resolves nothing. A matter names its client and its parties by the source
// system's keys; the draft carries those keys as they are, and the loader finds the Directory
// records they became.

// A column whose value is the source system's key for another record, and the kind that record was
// transferred under. The kind is stated because a key alone does not say which file it belongs to.
export interface SourceReferenceColumn {
  readonly column: string;
  readonly sourceKind: string;
}

export interface MatterMappingRules {
  readonly title: string;
  // The number the firm already quotes for the matter. It is kept, never redrawn.
  readonly number: string;
  readonly description?: string;
  readonly clientDisplayName?: string;
  readonly openedDate: string;
  // A value here means the matter arrives closed, on that day. An empty value means it is open.
  readonly closedDate?: string;
  readonly dateOrder: SourceDateOrder;
  // The IANA zone the file's dates are days in. A matter's opening is stored as an instant, and
  // "the fourth of March" is a different instant in Sydney and in Chicago.
  readonly timeZone: string;
  readonly client?: SourceReferenceColumn;
  readonly parties?: readonly (SourceReferenceColumn & { readonly role: string })[];
  // The source's name or code for a matter type, and the matter type here that each one means. A
  // value the table does not hold leaves the matter without a type and is reported.
  readonly matterType?: {
    readonly column: string;
    readonly types: Readonly<Record<string, MatterTypeId>>;
  };
  // Who is responsible for the matter. Every matter needs somebody, so a value the table does not
  // hold either falls to `otherwise` and is reported, or, with no `otherwise`, rejects the row.
  readonly responsibleMember: {
    readonly column?: string;
    readonly members: Readonly<Record<string, UserId>>;
    readonly otherwise?: UserId;
  };
}

export type MatterMappingRejection =
  | SourceFileRowFault
  | "noTitle"
  | "noMatterNumber"
  | "noOpenedDate"
  | "openedDateUnreadable"
  | "closedDateUnreadable"
  | "closedBeforeOpened"
  | "responsibleMemberUnmapped";

export type MatterMappingFindingKind = "matterTypeUnmapped" | "responsibleMemberUnmapped";

export interface MatterMappingFinding {
  readonly column: string;
  readonly finding: MatterMappingFindingKind;
}

export interface MatterReference {
  readonly sourceKind: string;
  readonly sourceId: string;
}

export interface MatterDraft {
  readonly title: string;
  readonly description: string | null;
  readonly matterNumber: string;
  readonly matterTypeId: MatterTypeId | null;
  readonly responsibleMemberId: UserId;
  readonly clientDisplayName: string | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly client: MatterReference | null;
  readonly parties: readonly (MatterReference & { readonly role: string })[];
}

export type MappedMatter =
  | {
      readonly ok: true;
      readonly draft: MatterDraft;
      readonly findings: readonly MatterMappingFinding[];
    }
  | { readonly ok: false; readonly rejection: MatterMappingRejection };

export class InvalidMatterMappingRulesError extends Error {
  constructor(fault: "timeZone" | "partyRole") {
    super(
      fault === "timeZone"
        ? "matter mapping rules must name the IANA time zone the file's dates are days in."
        : "matter mapping rules must give every party column a role.",
    );
    this.name = "InvalidMatterMappingRulesError";
  }
}

// Rules are checked once per rules object, not once per row.
const checkedRules = new WeakSet<MatterMappingRules>();

function assertMatterMappingRules(rules: MatterMappingRules): void {
  if (checkedRules.has(rules)) return;
  if (!isResolvableTimeZone(rules.timeZone)) throw new InvalidMatterMappingRulesError("timeZone");
  for (const party of rules.parties ?? []) {
    if (party.role.trim() === "") throw new InvalidMatterMappingRulesError("partyRole");
  }
  checkedRules.add(rules);
}

// The columns the rules name that the file does not have. Empty means the rules fit the file.
export function matterColumnsMissingFrom(
  header: readonly string[],
  rules: MatterMappingRules,
): string[] {
  const named: (string | undefined)[] = [
    rules.title,
    rules.number,
    rules.description,
    rules.clientDisplayName,
    rules.openedDate,
    rules.closedDate,
    rules.client?.column,
    ...(rules.parties ?? []).map((party) => party.column),
    rules.matterType?.column,
    rules.responsibleMember.column,
  ];
  const present = new Set(header);
  return [...new Set(named.filter((column): column is string => column !== undefined))].filter(
    (column) => !present.has(column),
  );
}

export function mapMatterRow(
  rules: MatterMappingRules,
  header: readonly string[],
  row: SourceFileRow,
): MappedMatter {
  assertMatterMappingRules(rules);
  const laid = sourceFileRowFields(header, row);
  if (!laid.ok) return { ok: false, rejection: laid.fault };
  const read = (column: string | undefined): string | null => valueOf(laid.fields, column);

  const title = read(rules.title);
  if (title === null) return { ok: false, rejection: "noTitle" };
  const matterNumber = read(rules.number);
  if (matterNumber === null) return { ok: false, rejection: "noMatterNumber" };

  const openedText = read(rules.openedDate);
  if (openedText === null) return { ok: false, rejection: "noOpenedDate" };
  const openedOn = calendarDateFrom(openedText, rules.dateOrder);
  if (openedOn === null) return { ok: false, rejection: "openedDateUnreadable" };

  // A closing date that cannot be read rejects the row. Leaving it out would bring a closed matter
  // in as an open one, which is a wrong record and not a missing value.
  let closedOn: string | null = null;
  const closedText = read(rules.closedDate);
  if (closedText !== null) {
    closedOn = calendarDateFrom(closedText, rules.dateOrder);
    if (closedOn === null) return { ok: false, rejection: "closedDateUnreadable" };
    if (closedOn < openedOn) return { ok: false, rejection: "closedBeforeOpened" };
  }

  const findings: MatterMappingFinding[] = [];

  let matterTypeId: MatterTypeId | null = null;
  if (rules.matterType !== undefined) {
    const named = read(rules.matterType.column);
    if (named !== null) {
      if (Object.hasOwn(rules.matterType.types, named)) {
        matterTypeId = rules.matterType.types[named] ?? null;
      } else {
        findings.push({ column: rules.matterType.column, finding: "matterTypeUnmapped" });
      }
    }
  }

  const { column: memberColumn, members, otherwise } = rules.responsibleMember;
  const memberNamed = read(memberColumn);
  let responsibleMemberId: UserId | undefined;
  if (memberNamed !== null && Object.hasOwn(members, memberNamed)) {
    responsibleMemberId = members[memberNamed];
  }
  if (responsibleMemberId === undefined) {
    if (otherwise === undefined) return { ok: false, rejection: "responsibleMemberUnmapped" };
    responsibleMemberId = otherwise;
    // Only a value that was there and meant nobody is worth a person's attention. A file with no
    // such column, or an empty value, was always going to fall to the stated member.
    if (memberNamed !== null && memberColumn !== undefined) {
      findings.push({ column: memberColumn, finding: "responsibleMemberUnmapped" });
    }
  }

  return {
    ok: true,
    draft: {
      title,
      description: read(rules.description),
      matterNumber,
      matterTypeId,
      responsibleMemberId,
      clientDisplayName: read(rules.clientDisplayName),
      openedAt: startOfDay(openedOn, rules.timeZone),
      closedAt: closedOn === null ? null : startOfDay(closedOn, rules.timeZone),
      client: referenceIn(laid.fields, rules.client),
      parties: (rules.parties ?? []).flatMap((party) => {
        const reference = referenceIn(laid.fields, party);
        return reference === null ? [] : [{ ...reference, role: party.role.trim() }];
      }),
    },
    findings,
  };
}

// A reference is the source system's key, and a key is compared exactly as the source wrote it. So
// the value is not trimmed here: it has to equal the key the referenced record was linked under.
function referenceIn(
  fields: ReadonlyMap<string, string>,
  reference: SourceReferenceColumn | undefined,
): MatterReference | null {
  if (reference === undefined) return null;
  const sourceId = fields.get(reference.column) ?? "";
  return sourceId === "" ? null : { sourceKind: reference.sourceKind, sourceId };
}

// The file gives a day and the matter stores an instant. The instant taken is the moment that day
// began in the file's stated zone, so the day a reader in that zone sees is the day the file says.
function startOfDay(civilDate: string, timeZone: string): string {
  if (!isCivilDate(civilDate)) throw new Error("matter mapping: a mapped date is not a civil date");
  return new Date(instantForCivilDateTime(civilDate, null, timeZone)).toISOString();
}

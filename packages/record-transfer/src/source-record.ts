// The vocabulary of a record transfer: which system a record came from, what that system calls it,
// and which tables here a transferred record may land in.

// A source system is named by a lower-case slug. It is open text in the database so that the second
// system a firm arrives from needs no schema change, and it is constrained here so that `LEAP`,
// `Leap` and `leap ` can never become three systems.
const SOURCE_SYSTEM_PATTERN = /^[a-z][a-z0-9-]*$/;

export class InvalidSourceSystemError extends Error {
  constructor(value: string) {
    super(
      `"${value}" is not a source system name: use a lower-case slug such as "leap" (letters, digits and hyphens, starting with a letter).`,
    );
    this.name = "InvalidSourceSystemError";
  }
}

export function assertSourceSystem(value: string): string {
  if (!SOURCE_SYSTEM_PATTERN.test(value)) throw new InvalidSourceSystemError(value);
  return value;
}

// The per-firm tables a transferred record may be linked to, each with the column that is its key.
// A link names its table as text, with no foreign key behind it, so this list is the only thing
// standing between a typo and a link that points nowhere: a write refuses any table not listed. It
// grows by one line each time the transfer learns to carry another kind of record, and the
// schema-name-sync test fails if a line names a table or key the schema does not have.
export const LINKABLE_LOCAL_TABLES = {
  directory_person: "id",
  directory_organization: "id",
  matter: "id",
} as const;

export type LinkableLocalTable = keyof typeof LINKABLE_LOCAL_TABLES;

export class UnlinkableLocalTableError extends Error {
  constructor(value: string) {
    super(
      `"${value}" is not a table a source record can be linked to. Add it to LINKABLE_LOCAL_TABLES with its key column when the transfer carries that kind of record.`,
    );
    this.name = "UnlinkableLocalTableError";
  }
}

export function assertLinkableLocalTable(value: string): LinkableLocalTable {
  if (!Object.hasOwn(LINKABLE_LOCAL_TABLES, value)) throw new UnlinkableLocalTableError(value);
  return value as LinkableLocalTable;
}

// One record in the system a firm is leaving, named the way that system names it. `sourceId` is the
// source system's own key and is stored verbatim: it is compared, never parsed.
export interface SourceRecordKey {
  readonly sourceSystem: string;
  readonly sourceKind: string;
  readonly sourceId: string;
}

export class InvalidSourceRecordKeyError extends Error {
  constructor(part: "sourceKind" | "sourceId") {
    super(`a source record key needs a non-empty ${part}.`);
    this.name = "InvalidSourceRecordKeyError";
  }
}

export function assertSourceRecordKey(key: SourceRecordKey): SourceRecordKey {
  assertSourceSystem(key.sourceSystem);
  if (key.sourceKind.length === 0) throw new InvalidSourceRecordKeyError("sourceKind");
  if (key.sourceId.length === 0) throw new InvalidSourceRecordKeyError("sourceId");
  return key;
}

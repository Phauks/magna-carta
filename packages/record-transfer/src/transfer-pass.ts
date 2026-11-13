import type { CreatePersonRecordInput } from "@magna-carta/directory/person-record";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import type { TransferRunId } from "@magna-carta/identifiers/types";
import type { DelimitedTextEvent } from "./delimited-text-reader.ts";
import {
  columnsMissingFrom,
  mapOrganizationRow,
  mapPersonRow,
  type OrganizationDraft,
  type OrganizationMappingRules,
  type PersonMappingRules,
} from "./directory-mapping.ts";
import { transferOrganization, transferPerson, type TransferTarget } from "./directory-transfer.ts";
import {
  mapMatterRow,
  matterColumnsMissingFrom,
  type MatterDraft,
  type MatterMappingRules,
  type MatterReference,
} from "./matter-mapping.ts";
import { transferMatter, type MatterTransferContext } from "./matter-transfer.ts";
import { assertSourceSystem } from "./source-record.ts";
import { sourceFileRowFields, type SourceFileRow } from "./source-file.ts";

// One pass over one source file: every row is keyed, mapped and loaded, and what happened to each is
// counted. The pass is where the reader, the mapping rules and a loader meet, and its report is what
// a rehearsal is judged by.
//
// A pass can be run again at any time. A row whose record already arrived is counted as such and
// nothing is written for it, so the second pass over a file finishes what the first could not (a
// matter that was waiting for its client) and repeats nothing.
//
// A row's outcome is a count or a line in the report. A fault is different: an error the loader did
// not expect is thrown, and the pass stops at that row. Nothing is lost by stopping, because
// everything before it is linked and the next pass carries on from there.

// What a pass needs to know about one kind of record. `map` and `load` are the mapping rules and the
// loader for that kind; the three functions at the end of this module build a plan for each kind the
// transfer carries.
export interface TransferPassPlan<Draft> {
  readonly sourceSystem: string;
  // The kind the file's rows are linked under, which is what another file's reference names.
  readonly sourceKind: string;
  // The column holding the source system's key for a row.
  readonly keyColumn: string;
  readonly columnsMissingFrom: (header: readonly string[]) => string[];
  readonly map: (
    header: readonly string[],
    row: SourceFileRow,
  ) =>
    | {
        readonly ok: true;
        readonly draft: Draft;
        readonly findings: readonly { readonly column: string; readonly finding: string }[];
      }
    | { readonly ok: false; readonly rejection: string };
  readonly load: (target: TransferTarget, draft: Draft) => Promise<PassLoadOutcome>;
}

export type PassLoadOutcome =
  | { readonly outcome: "created" | "alreadyLinked"; readonly localId: string }
  | { readonly outcome: "referencesNotTransferred"; readonly missing: readonly MatterReference[] }
  | { readonly outcome: "refused"; readonly reason: string };

interface RowPlace {
  readonly rowNumber: number;
  readonly lineNumber: number;
}

// A row that produced no record and will not on a later pass unless the file or the rules change.
// The reason is one of a fixed vocabulary: a mapping rejection, a loader's refusal, `noSourceKey`
// (the key column is empty) or `repeatedSourceKey` (an earlier row of this file has the same key).
export interface PassRejection extends RowPlace {
  readonly reason: string;
}

// A row that produced no record yet because a record it names has not arrived.
export interface PassWaitingRow extends RowPlace {
  readonly missing: readonly MatterReference[];
}

// A value left out of a record that was made.
export interface PassFinding extends RowPlace {
  readonly column: string;
  readonly finding: string;
}

export interface PassSample extends RowPlace {
  readonly localId: string;
}

// The report holds positions, column names, fixed reasons, source keys and identifiers. It holds no
// other value from the file, so it can be stored and shown without carrying a client's details.
export interface TransferPassReport {
  // Columns the rules or the key need that the file does not have. When this is not empty no row
  // was read: a misspelt column is one line here and not a rejection on every row.
  readonly columnsMissing: readonly string[];
  // Rows in. Always equal to created + alreadyLinked + rejected.length + waiting.length.
  readonly rowsRead: number;
  readonly created: number;
  readonly alreadyLinked: number;
  readonly rejected: readonly PassRejection[];
  readonly waiting: readonly PassWaitingRow[];
  readonly findings: readonly PassFinding[];
  // The first and last few records this pass created, for a person to open and compare with the
  // source by eye. Counts agreeing says every row arrived; only reading a record says it is right.
  readonly sample: readonly PassSample[];
}

export const PASS_SAMPLE_SIZE = 5;

export async function runTransferPass<Draft>(
  events: AsyncIterable<DelimitedTextEvent>,
  transferRunId: TransferRunId,
  plan: TransferPassPlan<Draft>,
): Promise<TransferPassReport> {
  const sourceSystem = assertSourceSystem(plan.sourceSystem);
  let header: readonly string[] | null = null;
  let rowsRead = 0;
  let created = 0;
  let alreadyLinked = 0;
  const rejected: PassRejection[] = [];
  const waiting: PassWaitingRow[] = [];
  const findings: PassFinding[] = [];
  const firstCreated: PassSample[] = [];
  const lastCreated: PassSample[] = [];
  // Keys only. A file's rows are not held; the keys are, so a key written twice is caught here
  // and not mistaken for a record that arrived on an earlier pass.
  const keysSeen = new Set<string>();

  for await (const event of events) {
    if (event.kind === "header") {
      header = event.columns;
      const present = new Set(header);
      const columnsMissing = [
        ...(present.has(plan.keyColumn) ? [] : [plan.keyColumn]),
        ...plan.columnsMissingFrom(header).filter((column) => column !== plan.keyColumn),
      ];
      if (columnsMissing.length > 0) {
        return {
          columnsMissing,
          rowsRead: 0,
          created: 0,
          alreadyLinked: 0,
          rejected: [],
          waiting: [],
          findings: [],
          sample: [],
        };
      }
      continue;
    }
    if (header === null) throw new Error("a transfer pass was given a row before the header");

    const { row } = event;
    const place: RowPlace = { rowNumber: row.rowNumber, lineNumber: row.lineNumber };
    rowsRead += 1;

    // A ragged row is judged before its key is read: with a value missing or one too many, the
    // value under the key column's position may not be the key.
    const laid = sourceFileRowFields(header, row);
    if (!laid.ok) {
      rejected.push({ ...place, reason: laid.fault });
      continue;
    }
    const sourceId = laid.fields.get(plan.keyColumn) ?? "";
    if (sourceId === "") {
      rejected.push({ ...place, reason: "noSourceKey" });
      continue;
    }
    if (keysSeen.has(sourceId)) {
      rejected.push({ ...place, reason: "repeatedSourceKey" });
      continue;
    }
    keysSeen.add(sourceId);

    const mapped = plan.map(header, row);
    if (!mapped.ok) {
      rejected.push({ ...place, reason: mapped.rejection });
      continue;
    }

    const loaded = await plan.load(
      { transferRunId, source: { sourceSystem, sourceKind: plan.sourceKind, sourceId } },
      mapped.draft,
    );
    switch (loaded.outcome) {
      case "created": {
        created += 1;
        // A finding belongs to the pass that made the record. A later pass left the record alone,
        // so repeating the finding would report a value as left out of a record it did not write.
        for (const finding of mapped.findings) findings.push({ ...place, ...finding });
        const sample: PassSample = { ...place, localId: loaded.localId };
        if (firstCreated.length < PASS_SAMPLE_SIZE) firstCreated.push(sample);
        else {
          lastCreated.push(sample);
          if (lastCreated.length > PASS_SAMPLE_SIZE) lastCreated.shift();
        }
        break;
      }
      case "alreadyLinked":
        alreadyLinked += 1;
        break;
      case "referencesNotTransferred":
        waiting.push({ ...place, missing: loaded.missing });
        break;
      case "refused":
        rejected.push({ ...place, reason: loaded.reason });
        break;
    }
  }

  return {
    columnsMissing: [],
    rowsRead,
    created,
    alreadyLinked,
    rejected,
    waiting,
    findings,
    sample: [...firstCreated, ...lastCreated],
  };
}

// What every plan states about its file, beside the mapping rules.
export interface PassSource {
  readonly sourceSystem: string;
  readonly sourceKind: string;
  readonly keyColumn: string;
}

export function personPassPlan(
  context: DirectoryIdentifierContext,
  source: PassSource,
  rules: PersonMappingRules,
): TransferPassPlan<CreatePersonRecordInput> {
  return {
    ...source,
    columnsMissingFrom: (header) => columnsMissingFrom(header, rules),
    map: (header, row) => mapPersonRow(rules, header, row),
    load: (target, draft) => transferPerson(context, target, draft),
  };
}

export function organizationPassPlan(
  context: DirectoryIdentifierContext,
  source: PassSource,
  rules: OrganizationMappingRules,
): TransferPassPlan<OrganizationDraft> {
  return {
    ...source,
    columnsMissingFrom: (header) => columnsMissingFrom(header, rules),
    map: (header, row) => mapOrganizationRow(rules, header, row),
    load: (target, draft) => transferOrganization(context, target, draft),
  };
}

export function matterPassPlan(
  context: MatterTransferContext,
  source: PassSource,
  rules: MatterMappingRules,
): TransferPassPlan<MatterDraft> {
  return {
    ...source,
    columnsMissingFrom: (header) => matterColumnsMissingFrom(header, rules),
    map: (header, row) => mapMatterRow(rules, header, row),
    load: (target, draft) => transferMatter(context, target, draft),
  };
}

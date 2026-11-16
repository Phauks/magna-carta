import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { TransferPassId, UserId } from "@magna-carta/identifiers/types";
import {
  MatterMappingRulesSchema,
  OrganizationMappingRulesSchema,
  PersonMappingRulesSchema,
  type TransferPassFailureBody,
} from "./contract.ts";
import { DelimitedTextError, readDelimitedText } from "./delimited-text-reader.ts";
import type { OrganizationMappingRules, PersonMappingRules } from "./directory-mapping.ts";
import type { MatterMappingRules } from "./matter-mapping.ts";
import {
  matterPassPlan,
  organizationPassPlan,
  personPassPlan,
  runTransferPass,
  type PassSource,
  type TransferPassReport,
} from "./transfer-pass.ts";
import {
  assertTransferPassRecordKind,
  failTransferPassStatement,
  finishTransferPassStatement,
  selectTransferPassStatement,
  startTransferPassStatement,
  type TransferPassRecordKind,
  type TransferPassRow,
} from "./transfer-pass-statements.ts";
import { selectTransferRunStatement, type TransferRunRow } from "./transfer-run-statements.ts";
import {
  recordTransferSourceFileReadStatement,
  selectTransferSourceFileStatement,
  type TransferSourceFileRow,
} from "./transfer-source-file-statements.ts";

// A pass somebody asked for, run to its end: the row is taken, the file is read from where it is
// kept, every row goes through the rules and the loader for its kind, the report is stored beside
// the file, and the row is ended with the report's counts.
//
// The module holds no binding. Where a file's text comes from and where a report goes are the two
// ports below, so the same function runs on the queue and in a test.
//
// A pass is taken once. The queue may deliver a request twice, and the second delivery finds the
// row already started and does nothing. A pass whose job died is not picked up again: its row
// stays started and unended, a screen shows it as stalled, and the way on is to ask for the pass
// again, which repeats nothing the dead one wrote because every row reads its link first.

// What the operator stated when asking for a pass, stored on the row as JSON.
export interface StatedTransferPass {
  readonly keyColumn: string;
  readonly delimiter?: "," | "\t" | ";" | "|";
  readonly rules: unknown;
}

export function statedTransferPassJson(stated: StatedTransferPass): string {
  return JSON.stringify(stated);
}

export interface RequestedPassPorts {
  readonly database: BatchDatabase;
  readonly clock: { now(): string };
  // The Directory's write context for the member who asked. People and organizations are written
  // through the Directory's own compose functions, which need it.
  readonly directoryContext: (actorUserId: UserId) => DirectoryIdentifierContext;
  readonly randomSource?: RandomSource;
  // The file's text in the order it is stored, or null when no object is held under the key.
  readonly readSourceFile: (objectKey: string) => Promise<AsyncIterable<string> | null>;
  // Store the report, or the reason there is none, under the pass's own key.
  readonly writeReport: (objectKey: string, json: string) => Promise<void>;
}

export type RequestedPassOutcome =
  // No such pass: the message names a row this firm does not have.
  | { readonly outcome: "notFound" }
  // Another delivery took the pass first.
  | { readonly outcome: "alreadyTaken" }
  | { readonly outcome: "finished"; readonly report: TransferPassReport }
  // The pass ended without a report. `error` is present only for a fault nobody expected, for the
  // caller to report through the error pipeline.
  | {
      readonly outcome: "failed";
      readonly failure: TransferPassFailureBody;
      readonly error?: unknown;
    };

// The stored form of a pass's ending: one of the two is present.
export interface StoredTransferPassReport {
  readonly report: TransferPassReport | null;
  readonly failure: TransferPassFailureBody | null;
}

class PassFailure extends Error {
  readonly failure: TransferPassFailureBody;
  constructor(failure: TransferPassFailureBody) {
    super("the pass cannot run");
    this.name = "PassFailure";
    this.failure = failure;
  }
}

const failureOf = (reason: TransferPassFailureBody["reason"]): TransferPassFailureBody => ({
  reason,
  fileFault: null,
  lineNumber: null,
});

// What a pass's row holds, read back. Null when the row holds something no request stored.
export function statedTransferPassOf(rulesJson: string): StatedTransferPass | null {
  try {
    return statedFrom(rulesJson);
  } catch {
    return null;
  }
}

function statedFrom(rulesJson: string): StatedTransferPass {
  try {
    const parsed = JSON.parse(rulesJson) as Partial<StatedTransferPass> | null;
    if (parsed !== null && typeof parsed === "object" && typeof parsed.keyColumn === "string") {
      return parsed as StatedTransferPass;
    }
  } catch {
    // Falls through to the refusal below: the row holds something no request could have stored.
  }
  throw new PassFailure(failureOf("rulesNotReadable"));
}

function planFor(
  ports: RequestedPassPorts,
  recordKind: TransferPassRecordKind,
  actorUserId: UserId,
  source: PassSource,
  rules: unknown,
) {
  // The rules were checked when the pass was asked for. They are checked again here because the
  // row is read back as text, and a rule that has lost its shape must stop the pass before a row
  // is mapped with it.
  if (recordKind === "person") {
    const parsed = PersonMappingRulesSchema.safeParse(rules);
    if (!parsed.success) throw new PassFailure(failureOf("rulesNotReadable"));
    return personPassPlan(
      ports.directoryContext(actorUserId),
      source,
      parsed.data as PersonMappingRules,
    );
  }
  if (recordKind === "organization") {
    const parsed = OrganizationMappingRulesSchema.safeParse(rules);
    if (!parsed.success) throw new PassFailure(failureOf("rulesNotReadable"));
    return organizationPassPlan(
      ports.directoryContext(actorUserId),
      source,
      parsed.data as OrganizationMappingRules,
    );
  }
  const parsed = MatterMappingRulesSchema.safeParse(rules);
  if (!parsed.success) throw new PassFailure(failureOf("rulesNotReadable"));
  return matterPassPlan(
    {
      database: ports.database,
      clock: ports.clock,
      actorUserId,
      ...(ports.randomSource === undefined ? {} : { randomSource: ports.randomSource }),
    },
    source,
    parsed.data as MatterMappingRules,
  );
}

async function runTaken(
  ports: RequestedPassPorts,
  pass: TransferPassRow,
): Promise<{ report: TransferPassReport; file: TransferSourceFileRow }> {
  const run = await selectTransferRunStatement(
    ports.database,
    pass.transfer_run_id,
  ).first<TransferRunRow>();
  const file = await selectTransferSourceFileStatement(
    ports.database,
    pass.transfer_source_file_id,
  ).first<TransferSourceFileRow>();
  if (run === null || file === null || file.removed_at !== null) {
    throw new PassFailure(failureOf("sourceFileNotHeld"));
  }
  const stated = statedFrom(pass.rules_json);
  const source: PassSource = {
    sourceSystem: run.source_system,
    sourceKind: pass.source_kind,
    keyColumn: stated.keyColumn,
  };
  const recordKind = assertTransferPassRecordKind(pass.record_kind);
  const text = await ports.readSourceFile(file.object_key);
  if (text === null) throw new PassFailure(failureOf("sourceFileNotHeld"));
  const events = readDelimitedText(
    text,
    stated.delimiter === undefined ? {} : { delimiter: stated.delimiter },
  );
  // The three plans differ only in the draft they carry between map and load, which the pass
  // never looks inside.
  const plan = planFor(ports, recordKind, pass.requested_by, source, stated.rules);
  const report = await runTransferPass(events, pass.transfer_run_id, plan as never);
  return { report, file };
}

export async function runRequestedPass(
  ports: RequestedPassPorts,
  transferPassId: TransferPassId,
): Promise<RequestedPassOutcome> {
  const pass = await selectTransferPassStatement(
    ports.database,
    transferPassId,
  ).first<TransferPassRow>();
  if (pass === null) return { outcome: "notFound" };
  const taken = await startTransferPassStatement(
    ports.database,
    transferPassId,
    ports.clock.now(),
  ).run();
  if (taken.meta.changes === 0) return { outcome: "alreadyTaken" };

  try {
    const { report, file } = await runTaken(ports, pass);
    const stored: StoredTransferPassReport = { report, failure: null };
    // The report is stored before the row says the pass finished, so a finished pass always has
    // a report to show.
    await ports.writeReport(pass.report_object_key, JSON.stringify(stored));
    const now = ports.clock.now();
    await ports.database.batch([
      finishTransferPassStatement(ports.database, transferPassId, report, now),
      // A file's row count is known once a pass has read it to its end, which a pass that found
      // columns missing has not.
      ...(report.columnsMissing.length === 0
        ? [recordTransferSourceFileReadStatement(ports.database, file.id, report.rowsRead, now)]
        : []),
    ]);
    return { outcome: "finished", report };
  } catch (caught) {
    const failure =
      caught instanceof PassFailure
        ? caught.failure
        : caught instanceof DelimitedTextError
          ? {
              reason: "fileNotReadable" as const,
              fileFault: caught.fault,
              lineNumber: caught.lineNumber,
            }
          : failureOf("fault");
    const stored: StoredTransferPassReport = { report: null, failure };
    await ports.writeReport(pass.report_object_key, JSON.stringify(stored));
    await failTransferPassStatement(ports.database, transferPassId, ports.clock.now()).run();
    return failure.reason === "fault"
      ? { outcome: "failed", failure, error: caught }
      : { outcome: "failed", failure };
  }
}

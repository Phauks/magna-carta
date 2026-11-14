import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type {
  FirmId,
  TransferPassId,
  TransferRunId,
  TransferSourceFileId,
  UserId,
} from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  runRequestedPass,
  statedTransferPassJson,
  type RequestedPassPorts,
  type StoredTransferPassReport,
} from "../src/requested-pass.ts";
import {
  InvalidTransferPassRulesError,
  UnknownTransferPassRecordKindError,
  insertTransferPassStatement,
  selectTransferPassStatement,
  selectTransferPassesStatement,
  transferPassReportObjectKey,
  type TransferPassRow,
} from "../src/transfer-pass-statements.ts";
import {
  TRANSFER_PASS_REQUESTED_TOPIC,
  registerTransferSourceFileEffect,
  requestTransferPassEffect,
  startTransferRunEffect,
  transferPassStateOf,
  unknownMatterRuleReferences,
} from "../src/transfer-requests.ts";
import {
  selectTransferSourceFileStatement,
  type TransferSourceFileRow,
} from "../src/transfer-source-file-statements.ts";

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const NOW = "2026-11-14T09:00:00.000Z";
const clock = { now: () => NOW };

type Raw = ReturnType<typeof createMigratedNodeDatabase>["raw"];

interface Firm {
  readonly database: BatchDatabase;
  readonly raw: Raw;
  readonly operator: UserId;
  readonly runId: TransferRunId;
  readonly objects: Map<string, string>;
  readonly ports: RequestedPassPorts;
}

async function freshFirm(seed: string): Promise<Firm> {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const operator = newIdentifier("user") as UserId;
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Operator', 'active', ?2)",
    )
    .bind(operator, NOW)
    .run();
  const runId = newIdentifier("transferRun") as TransferRunId;
  await commitEffectBatch(
    database,
    startTransferRunEffect(
      database,
      { id: runId, sourceSystem: "leap", label: "Rehearsal" },
      { actorUserId: operator, now: NOW },
    ),
    { now: clock.now },
  );
  const rootKek = await importRootKek(ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  const firmKeyProvider = createFirmKeyProvider({
    rootKekBase64: ROOT_KEK,
    readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> =>
      firmId === FIRM ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
  });
  const randomSource = seededRandomSource(seed);
  const objects = new Map<string, string>();
  return {
    database,
    raw,
    operator,
    runId,
    objects,
    ports: {
      database,
      clock,
      randomSource,
      directoryContext: (actorUserId) => ({
        firmId: FIRM,
        firmKeyVersion: 1,
        firmKeyProvider,
        database,
        effectivePermissions: new Set() as never,
        actorUserId,
        clock,
        randomSource,
      }),
      readSourceFile: async (objectKey) => {
        const text = objects.get(objectKey);
        // Two chunks, so a value split across a chunk boundary is part of what is tested.
        return text === undefined ? null : chunksOf(text);
      },
      writeReport: async (objectKey, json) => {
        objects.set(objectKey, json);
      },
    },
  };
}

async function* chunksOf(text: string): AsyncGenerator<string> {
  yield text.slice(0, 7);
  yield text.slice(7);
}

async function giveFile(firm: Firm, text: string): Promise<TransferSourceFileId> {
  const id = newIdentifier("transferSourceFile") as TransferSourceFileId;
  await commitEffectBatch(
    firm.database,
    registerTransferSourceFileEffect(
      firm.database,
      {
        id,
        transferRunId: firm.runId,
        sourceKind: "card-list",
        format: "delimited-text",
        fileName: "Cards.csv",
        byteLength: text.length,
        contentSha256: id.length.toString(16).padStart(64, "0"),
        keyColumn: null,
      },
      { actorUserId: firm.operator, now: NOW },
    ),
    { now: clock.now },
  );
  const file = await selectTransferSourceFileStatement(
    firm.database,
    id,
  ).first<TransferSourceFileRow>();
  firm.objects.set(file!.object_key, text);
  return id;
}

async function askForPass(
  firm: Firm,
  fileId: TransferSourceFileId,
  recordKind: string,
  rules: unknown,
  keyColumn = "Id",
): Promise<TransferPassId> {
  const id = newIdentifier("transferPass") as TransferPassId;
  await commitEffectBatch(
    firm.database,
    requestTransferPassEffect(
      firm.database,
      {
        id,
        transferRunId: firm.runId,
        transferSourceFileId: fileId,
        recordKind,
        sourceKind: "card",
        rulesJson: statedTransferPassJson({ keyColumn, rules }),
      },
      { actorUserId: firm.operator, now: NOW },
    ),
    { now: clock.now },
  );
  return id;
}

function count(raw: Raw, sql: string): number {
  return Number((raw.prepare(sql).get() as { n: number }).n);
}

const CARDS = ["Id,First,Last", "c-1,Ada,Lovelace", "c-2,Byron,Lovelace", "c-3,,", ""].join("\n");
const PERSON_RULES = { given: "First", family: "Last" };

describe("a requested pass", () => {
  it("is recorded with an audit row and one message for the queue", async () => {
    const firm = await freshFirm("request");
    const fileId = await giveFile(firm, CARDS);
    const passId = await askForPass(firm, fileId, "person", PERSON_RULES);

    const pass = await selectTransferPassStatement(firm.database, passId).first<TransferPassRow>();
    expect(pass?.report_object_key).toBe(transferPassReportObjectKey(firm.runId, passId));
    expect(pass?.started_at).toBeNull();
    expect(transferPassStateOf(pass!, NOW)).toBe("requested");
    expect(
      count(
        firm.raw,
        `SELECT COUNT(*) AS n FROM outbox WHERE topic = '${TRANSFER_PASS_REQUESTED_TOPIC}'`,
      ),
    ).toBe(1);
    expect(
      count(firm.raw, "SELECT COUNT(*) AS n FROM audit_log WHERE event LIKE 'recordTransfer.%'"),
    ).toBe(3);
  });

  it("refuses a kind nothing loads and rules that are not an object", async () => {
    const firm = await freshFirm("refuse");
    const pass = {
      id: newIdentifier("transferPass") as TransferPassId,
      transferRunId: firm.runId,
      transferSourceFileId: "transferSourceFile_x" as TransferSourceFileId,
      sourceKind: "card",
      requestedBy: firm.operator,
    };
    expect(() =>
      insertTransferPassStatement(
        firm.database,
        { ...pass, recordKind: "invoice", rulesJson: "{}" },
        NOW,
      ),
    ).toThrow(UnknownTransferPassRecordKindError);
    expect(() =>
      insertTransferPassStatement(
        firm.database,
        { ...pass, recordKind: "person", rulesJson: "[]" },
        NOW,
      ),
    ).toThrow(InvalidTransferPassRulesError);
  });

  it("runs to a stored report, ends its row with the counts and counts the file's rows", async () => {
    const firm = await freshFirm("run");
    const fileId = await giveFile(firm, CARDS);
    const passId = await askForPass(firm, fileId, "person", PERSON_RULES);

    const outcome = await runRequestedPass(firm.ports, passId);
    expect(outcome.outcome).toBe("finished");

    const pass = await selectTransferPassStatement(firm.database, passId).first<TransferPassRow>();
    expect(pass).toMatchObject({
      rows_read: 3,
      created_count: 2,
      already_linked_count: 0,
      rejected_count: 1,
      waiting_count: 0,
      columns_missing_count: 0,
      finished_at: NOW,
      failed_at: null,
    });
    expect(transferPassStateOf(pass!, NOW)).toBe("finished");
    const stored = JSON.parse(
      firm.objects.get(pass!.report_object_key)!,
    ) as StoredTransferPassReport;
    expect(stored.failure).toBeNull();
    expect(stored.report?.rejected).toEqual([{ rowNumber: 3, lineNumber: 4, reason: "noName" }]);
    // The report names positions and reasons, and nothing a row held.
    expect(firm.objects.get(pass!.report_object_key)).not.toContain("Lovelace");
    const file = await selectTransferSourceFileStatement(
      firm.database,
      fileId,
    ).first<TransferSourceFileRow>();
    expect(file?.row_count).toBe(3);
  });

  it("is taken once: a second delivery does nothing", async () => {
    const firm = await freshFirm("twice");
    const fileId = await giveFile(firm, CARDS);
    const passId = await askForPass(firm, fileId, "person", PERSON_RULES);
    await runRequestedPass(firm.ports, passId);
    expect(await runRequestedPass(firm.ports, passId)).toEqual({ outcome: "alreadyTaken" });
    expect(count(firm.raw, "SELECT COUNT(*) AS n FROM source_record_link")).toBe(2);
  });

  it("asked for again over the same file, creates nothing twice", async () => {
    const firm = await freshFirm("again");
    const fileId = await giveFile(firm, CARDS);
    await runRequestedPass(firm.ports, await askForPass(firm, fileId, "person", PERSON_RULES));
    const second = await askForPass(firm, fileId, "person", PERSON_RULES);
    const outcome = await runRequestedPass(firm.ports, second);
    expect(outcome).toMatchObject({
      outcome: "finished",
      report: { created: 0, alreadyLinked: 2 },
    });
    const passes = await selectTransferPassesStatement(
      firm.database,
      firm.runId,
    ).all<TransferPassRow>();
    expect(passes.results).toHaveLength(2);
  });

  it("finishes without reading a row when the file lacks a column the rules name", async () => {
    const firm = await freshFirm("columns");
    const fileId = await giveFile(firm, CARDS);
    const passId = await askForPass(firm, fileId, "person", { given: "Given", family: "Last" });
    const outcome = await runRequestedPass(firm.ports, passId);
    expect(outcome).toMatchObject({
      outcome: "finished",
      report: { columnsMissing: ["Given"], rowsRead: 0 },
    });
    const file = await selectTransferSourceFileStatement(
      firm.database,
      fileId,
    ).first<TransferSourceFileRow>();
    expect(file?.row_count).toBeNull();
  });

  it("fails with the reader's fault when the file cannot be read as rows", async () => {
    const firm = await freshFirm("broken");
    const fileId = await giveFile(firm, 'Id,First,Last\nc-1,"Ada,Lovelace\n');
    const passId = await askForPass(firm, fileId, "person", PERSON_RULES);
    const outcome = await runRequestedPass(firm.ports, passId);
    expect(outcome).toEqual({
      outcome: "failed",
      failure: { reason: "fileNotReadable", fileFault: "unterminatedQuote", lineNumber: 2 },
    });
    const pass = await selectTransferPassStatement(firm.database, passId).first<TransferPassRow>();
    expect(pass?.failed_at).toBe(NOW);
    expect(pass?.rows_read).toBeNull();
    expect(transferPassStateOf(pass!, NOW)).toBe("failed");
  });

  it("fails when the file's bytes are not held, and when the stored rules have lost their shape", async () => {
    const firm = await freshFirm("missing");
    const fileId = await giveFile(firm, CARDS);
    const shapeless = await askForPass(firm, fileId, "person", { given: 7 });
    expect(await runRequestedPass(firm.ports, shapeless)).toMatchObject({
      outcome: "failed",
      failure: { reason: "rulesNotReadable" },
    });
    firm.objects.clear();
    const unheld = await askForPass(firm, fileId, "person", PERSON_RULES);
    expect(await runRequestedPass(firm.ports, unheld)).toMatchObject({
      outcome: "failed",
      failure: { reason: "sourceFileNotHeld" },
    });
  });

  it("answers notFound for a pass this firm does not have", async () => {
    const firm = await freshFirm("unknown");
    expect(
      await runRequestedPass(firm.ports, newIdentifier("transferPass") as TransferPassId),
    ).toEqual({ outcome: "notFound" });
  });
});

describe("a pass's state", () => {
  it("is stalled once a started pass has gone twenty minutes without an ending", () => {
    const started = { started_at: NOW, finished_at: null, failed_at: null };
    expect(transferPassStateOf(started, "2026-11-14T09:19:00.000Z")).toBe("running");
    expect(transferPassStateOf(started, "2026-11-14T09:21:00.000Z")).toBe("stalled");
  });
});

describe("the references a matter's rules name", () => {
  it("lists the members and matter types the firm does not have", async () => {
    const firm = await freshFirm("references");
    const unknown = await unknownMatterRuleReferences(firm.database, {
      title: "Title",
      number: "No",
      openedDate: "Opened",
      dateOrder: "day-month-year",
      timeZone: "Australia/Sydney",
      matterType: { column: "Type", types: { Probate: "matterType_missing" as never } },
      responsibleMember: {
        members: { AL: firm.operator, JRM: "user_missing" as UserId },
        otherwise: firm.operator,
      },
    });
    expect(unknown).toEqual({ members: ["user_missing"], matterTypes: ["matterType_missing"] });
  });
});

import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, TransferRunId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { readDelimitedText } from "../src/delimited-text-reader.ts";
import type { MatterMappingRules } from "../src/matter-mapping.ts";
import type { MatterTransferContext } from "../src/matter-transfer.ts";
import { countLinksByTransferRunStatement } from "../src/source-record-link-statements.ts";
import {
  matterPassPlan,
  personPassPlan,
  runTransferPass,
  type TransferPassPlan,
  type TransferPassReport,
} from "../src/transfer-pass.ts";
import { insertTransferRunStatement } from "../src/transfer-run-statements.ts";

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const NOW = "2026-11-13T09:00:00.000Z";
const clock = { now: () => NOW };

type Raw = ReturnType<typeof createMigratedNodeDatabase>["raw"];

interface Firm {
  readonly database: BatchDatabase;
  readonly raw: Raw;
  readonly directory: DirectoryIdentifierContext;
  readonly matters: MatterTransferContext;
  readonly runId: TransferRunId;
  readonly operator: UserId;
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
  await insertTransferRunStatement(
    database,
    { id: runId, sourceSystem: "leap", label: "Rehearsal", startedBy: operator },
    NOW,
  ).run();
  const rootKek = await importRootKek(ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  const firmKeyProvider = createFirmKeyProvider({
    rootKekBase64: ROOT_KEK,
    readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> =>
      firmId === FIRM ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
  });
  const randomSource = seededRandomSource(seed);
  return {
    database,
    raw,
    runId,
    operator,
    directory: {
      firmId: FIRM,
      firmKeyVersion: 1,
      firmKeyProvider,
      database,
      effectivePermissions: new Set() as never,
      actorUserId: operator,
      clock,
      randomSource,
    },
    matters: { database, clock, actorUserId: operator, randomSource },
  };
}

function count(raw: Raw, table: string): number {
  const row = raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return Number(row.n);
}

const CARDS = [
  "Id,First,Last,Email",
  "c-1,Ada,Lovelace,ada@example.test",
  "c-2,Byron,Lovelace,not an address",
  ",No,Key,",
  "c-4,,,",
  "c-1,Ada,Again,",
  "c-6,Short",
  "",
].join("\n");

const MATTERS = [
  "No,Title,Opened,Client,Other",
  "2021-0042,Sale of 1 Engine St,03/04/2021,c-1,c-2",
  "2021-0043,Estate of Byron,04/04/2021,c-2,c-9",
  "2021/0044,Lease,05/04/2021,c-1,",
  "2021-0045,,06/04/2021,c-1,",
  "",
].join("\n");

function cardsPlan(firm: Firm) {
  return personPassPlan(
    firm.directory,
    { sourceSystem: "leap", sourceKind: "card", keyColumn: "Id" },
    { given: "First", family: "Last", emails: ["Email"] },
  );
}

function mattersPlan(firm: Firm) {
  const rules: MatterMappingRules = {
    title: "Title",
    number: "No",
    openedDate: "Opened",
    dateOrder: "day-month-year",
    timeZone: "Australia/Sydney",
    client: { column: "Client", sourceKind: "card" },
    parties: [{ column: "Other", sourceKind: "card", role: "opposing_party" }],
    responsibleMember: { members: {}, otherwise: firm.operator },
  };
  return matterPassPlan(
    firm.matters,
    { sourceSystem: "leap", sourceKind: "matter", keyColumn: "No" },
    rules,
  );
}

function pass<Draft>(
  firm: Firm,
  text: string,
  plan: TransferPassPlan<Draft>,
): Promise<TransferPassReport> {
  return runTransferPass(readDelimitedText([text]), firm.runId, plan);
}

function accountsFor(report: TransferPassReport): boolean {
  return (
    report.rowsRead ===
    report.created + report.alreadyLinked + report.rejected.length + report.waiting.length
  );
}

describe("a pass over a file of people", () => {
  it("accounts for every row: made, rejected with its reason and place, or noted", async () => {
    const firm = await freshFirm("pass-cards");
    const report = await pass(firm, CARDS, cardsPlan(firm));

    expect(report.columnsMissing).toEqual([]);
    expect(report.rowsRead).toBe(6);
    expect(report.created).toBe(2);
    expect(report.alreadyLinked).toBe(0);
    expect(report.rejected).toEqual([
      { rowNumber: 3, lineNumber: 4, reason: "noSourceKey" },
      { rowNumber: 4, lineNumber: 5, reason: "noName" },
      { rowNumber: 5, lineNumber: 6, reason: "repeatedSourceKey" },
      { rowNumber: 6, lineNumber: 7, reason: "tooFewValues" },
    ]);
    expect(report.findings).toEqual([
      { rowNumber: 2, lineNumber: 3, column: "Email", finding: "emailNotAnAddress" },
    ]);
    expect(report.sample.map((sample) => sample.rowNumber)).toEqual([1, 2]);
    expect(accountsFor(report)).toBe(true);
    expect(count(firm.raw, "directory_person")).toBe(2);
  });

  it("holds nothing from the file but positions, column names, reasons and keys", async () => {
    const firm = await freshFirm("pass-redacted");
    const report = await pass(firm, CARDS, cardsPlan(firm));
    const written = JSON.stringify(report);
    for (const value of ["Ada", "Lovelace", "ada@example.test", "not an address"]) {
      expect(written).not.toContain(value);
    }
  });

  it("writes nothing on a second pass and repeats no finding", async () => {
    const firm = await freshFirm("pass-twice");
    await pass(firm, CARDS, cardsPlan(firm));
    const second = await pass(firm, CARDS, cardsPlan(firm));
    expect([second.created, second.alreadyLinked]).toEqual([0, 2]);
    expect(second.findings).toEqual([]);
    expect(second.sample).toEqual([]);
    expect(second.rejected).toHaveLength(4);
    expect(accountsFor(second)).toBe(true);
    expect(count(firm.raw, "directory_person")).toBe(2);
  });

  it("reads no row when the file lacks a column the rules or the key name", async () => {
    const firm = await freshFirm("pass-columns");
    const report = await pass(firm, "Key,First,Surname\nc-1,Ada,Lovelace\n", cardsPlan(firm));
    expect(report.columnsMissing).toEqual(["Id", "Email", "Last"]);
    expect(report.rowsRead).toBe(0);
    expect(count(firm.raw, "directory_person")).toBe(0);
  });
});

describe("a pass over a file of matters", () => {
  it("makes what it can, and a later pass finishes what was waiting", async () => {
    const firm = await freshFirm("pass-matters");
    await pass(firm, CARDS, cardsPlan(firm));

    const first = await pass(firm, MATTERS, mattersPlan(firm));
    expect(first.created).toBe(1);
    expect(first.waiting).toEqual([
      { rowNumber: 2, lineNumber: 3, missing: [{ sourceKind: "card", sourceId: "c-9" }] },
    ]);
    expect(first.rejected).toEqual([
      { rowNumber: 3, lineNumber: 4, reason: "matterNumberNotUsable" },
      { rowNumber: 4, lineNumber: 5, reason: "noTitle" },
    ]);
    expect(accountsFor(first)).toBe(true);

    // The missing card arrives in a later file of the same run.
    await pass(firm, "Id,First,Last,Email\nc-9,Annabella,Milbanke,\n", cardsPlan(firm));
    const second = await pass(firm, MATTERS, mattersPlan(firm));
    expect([second.created, second.alreadyLinked, second.waiting.length]).toEqual([1, 1, 0]);
    expect(accountsFor(second)).toBe(true);
    expect(count(firm.raw, "matter")).toBe(2);

    const { results } = await countLinksByTransferRunStatement(firm.database, firm.runId).all<{
      source_kind: string;
      local_table: string;
      link_count: number;
    }>();
    expect(
      results.map((row) => [row.source_kind, row.local_table, Number(row.link_count)]),
    ).toEqual([
      ["card", "directory_person", 3],
      ["matter", "matter", 2],
    ]);
  });
});

describe("the sample a person checks by eye", () => {
  it("is the first five and the last five records the pass created", async () => {
    const firm = await freshFirm("pass-sample");
    const rows = Array.from(
      { length: 14 },
      (_, index) => `c-${index + 1},Given${index + 1},Family,`,
    );
    const report = await pass(firm, ["Id,First,Last,Email", ...rows].join("\n"), cardsPlan(firm));
    expect(report.created).toBe(14);
    expect(report.sample.map((sample) => sample.rowNumber)).toEqual([
      1, 2, 3, 4, 5, 10, 11, 12, 13, 14,
    ]);
  });
});

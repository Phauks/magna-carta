import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { readMatterParties } from "@magna-carta/directory/party";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, MatterId, TransferRunId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { transferOrganization, transferPerson } from "../src/directory-transfer.ts";
import type { MatterDraft } from "../src/matter-mapping.ts";
import { transferMatter, type MatterTransferContext } from "../src/matter-transfer.ts";
import type { SourceRecordKey } from "../src/source-record.ts";
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

const key = (sourceKind: string, sourceId: string): SourceRecordKey => ({
  sourceSystem: "leap",
  sourceKind,
  sourceId,
});

async function arrivePerson(firm: Firm, sourceId: string, given: string): Promise<string> {
  const outcome = await transferPerson(
    firm.directory,
    { transferRunId: firm.runId, source: key("card", sourceId) },
    { name: { given, family: "Lovelace" } },
  );
  return outcome.localId;
}

function draft(firm: Firm, changes: Partial<MatterDraft> = {}): MatterDraft {
  return {
    title: "Sale of 1 Engine St",
    description: null,
    matterNumber: "2021-0042",
    matterTypeId: null,
    responsibleMemberId: firm.operator,
    clientDisplayName: null,
    openedAt: "2021-04-02T13:00:00.000Z",
    closedAt: null,
    client: { sourceKind: "card", sourceId: "c-1" },
    parties: [{ sourceKind: "card", sourceId: "c-2", role: "opposing_party" }],
    ...changes,
  };
}

function matterRow(raw: Raw, id: string) {
  return raw
    .prepare(
      "SELECT status, matter_number, numbered_at, opened_at, closed_at, created_at FROM matter WHERE id = ?",
    )
    .get(id) as Record<string, string | null>;
}

describe("transferring a matter", () => {
  it("creates the matter with the source's number and opening, its client, its parties and its link", async () => {
    const firm = await freshFirm("matter-created");
    const ada = await arrivePerson(firm, "c-1", "Ada");
    const other = await arrivePerson(firm, "c-2", "Byron");

    const outcome = await transferMatter(
      firm.matters,
      { transferRunId: firm.runId, source: key("matter", "m-1") },
      draft(firm),
    );
    if (outcome.outcome !== "created") throw new Error(outcome.outcome);

    expect(matterRow(firm.raw, outcome.localId)).toEqual({
      status: "open",
      matter_number: "2021-0042",
      numbered_at: "2021-04-02T13:00:00.000Z",
      opened_at: "2021-04-02T13:00:00.000Z",
      closed_at: null,
      created_at: NOW,
    });
    const parties = await readMatterParties(firm.database, outcome.localId);
    expect(parties.map((party) => [party.entityId, party.role]).toSorted()).toEqual(
      [
        [ada, "client"],
        [other, "opposing_party"],
      ].toSorted(),
    );
    const link = firm.raw
      .prepare("SELECT local_id FROM source_record_link WHERE local_table = 'matter'")
      .get() as { local_id: string };
    expect(link.local_id).toBe(outcome.localId);
  });

  it("draws no number and announces nothing", async () => {
    const firm = await freshFirm("matter-quiet");
    await arrivePerson(firm, "c-1", "Ada");
    await arrivePerson(firm, "c-2", "Byron");
    const outboxBefore = count(firm.raw, "outbox");

    const outcome = await transferMatter(
      firm.matters,
      { transferRunId: firm.runId, source: key("matter", "m-1") },
      draft(firm),
    );
    if (outcome.outcome !== "created") throw new Error(outcome.outcome);

    expect(count(firm.raw, "matter_number_allocation")).toBe(0);
    expect(count(firm.raw, "matter_number_counter")).toBe(0);
    expect(count(firm.raw, "outbox")).toBe(outboxBefore);
    const audit = firm.raw
      .prepare("SELECT event, actor_user_id FROM audit_log WHERE subject_id = ? ORDER BY event")
      .all(outcome.localId) as { event: string; actor_user_id: string }[];
    expect(audit.map((entry) => entry.event)).toEqual([
      "matter.party_transferred",
      "matter.party_transferred",
      "matter.transferred",
    ]);
    expect(audit.every((entry) => entry.actor_user_id === firm.operator)).toBe(true);
  });

  it("brings a closed matter in closed, on the source's closing instant", async () => {
    const firm = await freshFirm("matter-closed");
    const outcome = await transferMatter(
      firm.matters,
      { transferRunId: firm.runId, source: key("matter", "m-1") },
      draft(firm, { client: null, parties: [], closedAt: "2022-06-29T14:00:00.000Z" }),
    );
    if (outcome.outcome !== "created") throw new Error(outcome.outcome);
    expect(matterRow(firm.raw, outcome.localId)).toMatchObject({
      status: "closed",
      opened_at: "2021-04-02T13:00:00.000Z",
      closed_at: "2022-06-29T14:00:00.000Z",
    });
  });

  it("writes nothing on a second run, even when the file has changed since", async () => {
    const firm = await freshFirm("matter-twice");
    const target = { transferRunId: firm.runId, source: key("matter", "m-1") };
    const first = await transferMatter(
      firm.matters,
      target,
      draft(firm, { client: null, parties: [] }),
    );
    const second = await transferMatter(
      firm.matters,
      target,
      draft(firm, { client: null, parties: [], title: "Renamed at the source" }),
    );
    expect(second).toEqual({
      outcome: "alreadyLinked",
      localId: (first as { localId: MatterId }).localId,
    });
    expect(count(firm.raw, "matter")).toBe(1);
    expect(firm.raw.prepare("SELECT title FROM matter").get()).toEqual({
      title: "Sale of 1 Engine St",
    });
  });
});

describe("a matter waits for the records it names", () => {
  it("writes nothing and names what is missing when a party has not arrived", async () => {
    const firm = await freshFirm("matter-waits");
    await arrivePerson(firm, "c-1", "Ada");
    const target = { transferRunId: firm.runId, source: key("matter", "m-1") };

    expect(await transferMatter(firm.matters, target, draft(firm))).toEqual({
      outcome: "referencesNotTransferred",
      missing: [{ sourceKind: "card", sourceId: "c-2" }],
    });
    expect(count(firm.raw, "matter")).toBe(0);
    expect(count(firm.raw, "matter_party")).toBe(0);

    await arrivePerson(firm, "c-2", "Byron");
    expect((await transferMatter(firm.matters, target, draft(firm))).outcome).toBe("created");
  });

  it("links an organization as readily as a person", async () => {
    const firm = await freshFirm("matter-organization");
    const organization = await transferOrganization(
      firm.directory,
      { transferRunId: firm.runId, source: key("card", "c-1") },
      { legalName: "Analytical Engines Pty Ltd", emails: [], phones: [], addresses: [] },
    );
    const outcome = await transferMatter(
      firm.matters,
      { transferRunId: firm.runId, source: key("matter", "m-1") },
      draft(firm, { parties: [] }),
    );
    if (outcome.outcome !== "created") throw new Error(outcome.outcome);
    const parties = await readMatterParties(firm.database, outcome.localId);
    expect(parties.map((party) => party.entityId)).toEqual([organization.localId]);
  });

  it("treats a key that became both a person and an organization as unresolved", async () => {
    const firm = await freshFirm("matter-ambiguous");
    await arrivePerson(firm, "c-1", "Ada");
    await transferOrganization(
      firm.directory,
      { transferRunId: firm.runId, source: key("card", "c-1") },
      { legalName: "Ada and Co", emails: [], phones: [], addresses: [] },
    );
    expect(
      await transferMatter(
        firm.matters,
        { transferRunId: firm.runId, source: key("matter", "m-1") },
        draft(firm, { parties: [] }),
      ),
    ).toEqual({
      outcome: "referencesNotTransferred",
      missing: [{ sourceKind: "card", sourceId: "c-1" }],
    });
  });

  it("puts the party on the surviving record when the one that arrived was merged away", async () => {
    const firm = await freshFirm("matter-merged");
    const arrived = await arrivePerson(firm, "c-1", "Ada");
    const survivor = await arrivePerson(firm, "c-9", "Augusta");
    firm.raw
      .prepare(
        "UPDATE directory_person SET status = 'merged_into', merged_into_id = ? WHERE id = ?",
      )
      .run(survivor, arrived);

    const outcome = await transferMatter(
      firm.matters,
      { transferRunId: firm.runId, source: key("matter", "m-1") },
      draft(firm, { parties: [] }),
    );
    if (outcome.outcome !== "created") throw new Error(outcome.outcome);
    const parties = await readMatterParties(firm.database, outcome.localId);
    expect(parties.map((party) => party.entityId)).toEqual([survivor]);
  });
});

describe("a matter the firm's records cannot take is refused, and nothing is left behind", () => {
  it("refuses a number another matter already wears", async () => {
    const firm = await freshFirm("matter-number-taken");
    const bare = { client: null, parties: [] };
    await transferMatter(
      firm.matters,
      { transferRunId: firm.runId, source: key("matter", "m-1") },
      draft(firm, bare),
    );
    expect(
      await transferMatter(
        firm.matters,
        { transferRunId: firm.runId, source: key("matter", "m-2") },
        draft(firm, bare),
      ),
    ).toEqual({ outcome: "refused", reason: "matterNumberTaken" });
    expect(count(firm.raw, "matter")).toBe(1);
    expect(count(firm.raw, "source_record_link")).toBe(1);
  });

  it("refuses a number that could not ride in an address", async () => {
    const firm = await freshFirm("matter-number-shape");
    expect(
      await transferMatter(
        firm.matters,
        { transferRunId: firm.runId, source: key("matter", "m-1") },
        draft(firm, { client: null, parties: [], matterNumber: "2021/0042" }),
      ),
    ).toEqual({ outcome: "refused", reason: "matterNumberNotUsable" });
    expect(count(firm.raw, "matter")).toBe(0);
  });
});

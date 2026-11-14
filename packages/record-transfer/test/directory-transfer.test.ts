import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { readContactPoints } from "@magna-carta/directory/contact-points";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { readOrganization } from "@magna-carta/directory/organization";
import { readPerson } from "@magna-carta/directory/person";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, TransferRunId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { mapOrganizationRow, mapPersonRow } from "../src/directory-mapping.ts";
import { transferOrganization, transferPerson } from "../src/directory-transfer.ts";
import type { SourceRecordKey } from "../src/source-record.ts";
import {
  countLinksByTransferRunStatement,
  selectSourcesOfLocalRecordStatement,
} from "../src/source-record-link-statements.ts";
import { insertTransferRunStatement } from "../src/transfer-run-statements.ts";

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const NOW = "2026-11-13T09:00:00.000Z";
const clock = { now: () => NOW };

type Raw = ReturnType<typeof createMigratedNodeDatabase>["raw"];

async function freshFirm(seed: string): Promise<{
  database: BatchDatabase;
  raw: Raw;
  context: DirectoryIdentifierContext;
  runId: TransferRunId;
}> {
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
  return {
    database,
    raw,
    runId,
    context: {
      firmId: FIRM,
      firmKeyVersion: 1,
      firmKeyProvider,
      database,
      effectivePermissions: new Set() as never,
      actorUserId: operator,
      clock,
      randomSource: seededRandomSource(seed),
    },
  };
}

function count(raw: Raw, table: string): number {
  const row = raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return Number(row.n);
}

const card = (sourceId: string): SourceRecordKey => ({
  sourceSystem: "leap",
  sourceKind: "person",
  sourceId,
});

const PERSON_HEADER = ["Id", "First", "Last", "Email", "Phone", "Street", "City"];
const PERSON_RULES = {
  given: "First",
  family: "Last",
  emails: ["Email"],
  phones: [{ column: "Phone" }],
  address: { street: "Street", city: "City" },
  addressCountry: "AU",
} as const;

function adaDraft() {
  const mapped = mapPersonRow(PERSON_RULES, PERSON_HEADER, {
    rowNumber: 1,
    lineNumber: 2,
    values: ["c-1", "Ada", "Lovelace", "ada@example.test", "02 5550 0101", "1 Engine St", "Sydney"],
  });
  if (!mapped.ok) throw new Error(mapped.rejection);
  return mapped.draft;
}

describe("transferring a person", () => {
  it("creates the person with their contact points and the link, in one commit", async () => {
    const t = await freshFirm("person-created");
    const outcome = await transferPerson(
      t.context,
      { transferRunId: t.runId, source: card("c-1") },
      adaDraft(),
    );
    expect(outcome.outcome).toBe("created");

    const person = await readPerson(t.database, outcome.localId);
    expect([person.given, person.family]).toEqual(["Ada", "Lovelace"]);
    const contact = await readContactPoints(t.database, outcome.localId);
    expect(contact.emails.map((email) => email.address)).toEqual(["ada@example.test"]);
    expect(contact.phones.map((phone) => phone.number)).toEqual(["02 5550 0101"]);
    expect(contact.addresses.map((address) => [address.street, address.country])).toEqual([
      ["1 Engine St", "AU"],
    ]);

    const { results } = await selectSourcesOfLocalRecordStatement(
      t.database,
      "directory_person",
      outcome.localId,
    ).all<{ source_id: string; transfer_run_id: string }>();
    expect(results).toMatchObject([{ source_id: "c-1", transfer_run_id: t.runId }]);
  });

  it("is recorded as the Directory records any person: a name row, an audit row, an announcement", async () => {
    const t = await freshFirm("person-as-any");
    const outcome = await transferPerson(
      t.context,
      { transferRunId: t.runId, source: card("c-1") },
      adaDraft(),
    );
    expect(count(t.raw, "directory_name")).toBe(1);
    expect(count(t.raw, "directory_name_phonetic_code")).toBe(2);
    const audit = t.raw
      .prepare("SELECT event, actor_user_id FROM audit_log WHERE subject_id = ?")
      .all(outcome.localId) as { event: string; actor_user_id: string }[];
    expect(audit.map((entry) => entry.event)).toContain("directory.person.created");
    expect(audit.every((entry) => entry.actor_user_id === t.context.actorUserId)).toBe(true);
  });

  it("run a second time, finds the record and writes nothing", async () => {
    const t = await freshFirm("person-twice");
    const target = { transferRunId: t.runId, source: card("c-1") };
    const first = await transferPerson(t.context, target, adaDraft());
    const before = {
      people: count(t.raw, "directory_person"),
      emails: count(t.raw, "directory_email"),
      audit: count(t.raw, "audit_log"),
      links: count(t.raw, "source_record_link"),
    };

    const second = await transferPerson(t.context, target, {
      ...adaDraft(),
      name: { given: "Augusta", family: "King" },
    });
    expect(second).toEqual({ outcome: "alreadyLinked", localId: first.localId });
    expect({
      people: count(t.raw, "directory_person"),
      emails: count(t.raw, "directory_email"),
      audit: count(t.raw, "audit_log"),
      links: count(t.raw, "source_record_link"),
    }).toEqual(before);
    // The record is as the first run left it, not as the second file describes it.
    expect((await readPerson(t.database, first.localId)).given).toBe("Ada");
  });

  it("leaves no person behind when the link cannot be written", async () => {
    const t = await freshFirm("person-atomic");
    let failure: unknown = null;
    try {
      await transferPerson(
        t.context,
        { transferRunId: "transferRun_missing" as TransferRunId, source: card("c-1") },
        adaDraft(),
      );
    } catch (caught) {
      failure = caught;
    }
    expect(String(failure)).toMatch(/FOREIGN KEY/i);
    expect(count(t.raw, "directory_person")).toBe(0);
    expect(count(t.raw, "directory_email")).toBe(0);
    expect(count(t.raw, "source_record_link")).toBe(0);
  });

  it("makes two people of two source records, however alike", async () => {
    const t = await freshFirm("person-two");
    const first = await transferPerson(
      t.context,
      { transferRunId: t.runId, source: card("c-1") },
      adaDraft(),
    );
    const second = await transferPerson(
      t.context,
      { transferRunId: t.runId, source: card("c-2") },
      adaDraft(),
    );
    expect(second.outcome).toBe("created");
    expect(second.localId).not.toBe(first.localId);
    const { results } = await countLinksByTransferRunStatement(t.database, t.runId).all<{
      local_table: string;
      link_count: number;
    }>();
    expect(results).toMatchObject([{ local_table: "directory_person", link_count: 2 }]);
  });
});

describe("transferring an organization", () => {
  const source: SourceRecordKey = { sourceSystem: "leap", sourceKind: "card", sourceId: "o-1" };

  function draft() {
    const mapped = mapOrganizationRow(
      { legalName: "Name", emails: ["Email"], phones: [{ column: "Fax", fax: true }] },
      ["Id", "Name", "Email", "Fax"],
      {
        rowNumber: 1,
        lineNumber: 2,
        values: ["o-1", "Analytical Engines Pty Ltd", "office@engines.test", "02 5550 0199"],
      },
    );
    if (!mapped.ok) throw new Error(mapped.rejection);
    return mapped.draft;
  }

  it("creates the organization with its contact points and the link, once", async () => {
    const t = await freshFirm("organization");
    const target = { transferRunId: t.runId, source };
    const first = await transferOrganization(t.context, target, draft());
    expect(first.outcome).toBe("created");

    const organization = await readOrganization(t.database, first.localId);
    expect(organization.legalName).toBe("Analytical Engines Pty Ltd");
    const contact = await readContactPoints(t.database, first.localId);
    expect(contact.emails.map((email) => email.address)).toEqual(["office@engines.test"]);
    expect(contact.phones.map((phone) => [phone.number, phone.contactSystem])).toEqual([
      ["02 5550 0199", "fax"],
    ]);

    const second = await transferOrganization(t.context, target, draft());
    expect(second).toEqual({ outcome: "alreadyLinked", localId: first.localId });
    expect(count(t.raw, "directory_organization")).toBe(1);
    expect(count(t.raw, "source_record_link")).toBe(1);
  });

  it("keeps a person and an organization from the same source record apart", async () => {
    const t = await freshFirm("both-kinds");
    const shared: SourceRecordKey = { sourceSystem: "leap", sourceKind: "card", sourceId: "x-1" };
    const target = { transferRunId: t.runId, source: shared };
    const organization = await transferOrganization(t.context, target, draft());
    const person = await transferPerson(t.context, target, adaDraft());
    expect(organization.outcome).toBe("created");
    expect(person.outcome).toBe("created");
    expect(count(t.raw, "source_record_link")).toBe(2);
  });
});

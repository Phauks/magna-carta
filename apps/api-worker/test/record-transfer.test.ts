import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { TRANSFER_PASS_REQUESTED_TOPIC } from "@magna-carta/record-transfer/transfer-requests";
import {
  perFirmQueue,
  type PerFirmQueueMessage,
} from "../src/background/costs/recoverable-charge-consumer.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A record transfer over its routes and its queue, end to end: a run is started, a file is given,
// its first rows are read back, a pass is asked for, the queue's consumer runs it, and the pass's
// read and its report say what happened.

const BASE = "https://example.com/api/v1/record-transfer/runs";
const CARDS = ["Id,First,Last", "c-1,Ada,Lovelace", "c-2,Byron,Lovelace", "c-3,,", ""].join("\n");

let firmId: FirmId;
let ownerCookie: string;
let attorneyCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Record Transfer Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  const owner = await seedCredentialedUser("transfer-owner@example.com", {
    userName: "Transfer Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Transfer Owner", firmId);
  ownerCookie = await signInForSessionCookie("transfer-owner@example.com");
  const attorney = await seedCredentialedUser("transfer-attorney@example.com", {
    userName: "Transfer Attorney",
    firmId,
  });
  await mirrorMemberWithRole(attorney.userId, "Transfer Attorney", firmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("transfer-attorney@example.com");
});

const database = () => firmDatabaseFor(env.FIRM_DATABASE, firmId);

function json(cookie: string, body: unknown, key: string | null = crypto.randomUUID()) {
  return {
    method: "POST",
    headers: {
      cookie,
      origin: "https://example.com",
      "content-type": "application/json",
      ...(key === null ? {} : { "Idempotency-Key": key }),
    },
    body: JSON.stringify(body),
  };
}

async function startRun(label = "Rehearsal 1"): Promise<string> {
  const response = await SELF.fetch(BASE, json(ownerCookie, { sourceSystem: "leap", label }));
  expect(response.status).toBe(201);
  return (await response.json<{ run: { id: string } }>()).run.id;
}

function upload(runId: string, text: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`${BASE}/${runId}/files?fileName=Cards.csv&sourceKind=card-list`, {
    method: "POST",
    headers: { cookie, origin: "https://example.com", "content-type": "application/octet-stream" },
    body: text,
  });
}

async function giveFile(runId: string, text: string): Promise<string> {
  const response = await upload(runId, text);
  expect(response.status).toBe(201);
  return (await response.json<{ file: { id: string } }>()).file.id;
}

const personPass = (fileId: string, rules: unknown = { given: "First", family: "Last" }) => ({
  recordKind: "person",
  fileId,
  sourceKind: "card",
  keyColumn: "Id",
  rules,
});

async function deliver(passId: string): Promise<"acked" | "retried"> {
  let outcome: "acked" | "retried" | null = null;
  const body: PerFirmQueueMessage = {
    id: newIdentifier("outbox"),
    firmId,
    topic: TRANSFER_PASS_REQUESTED_TOPIC,
    payload: JSON.stringify({ transferPassId: passId }),
    aggregateKey: null,
    seq: null,
  };
  await perFirmQueue(
    {
      queue: "per-firm",
      messages: [
        {
          id: "message-0",
          timestamp: new Date(),
          body,
          attempts: 1,
          ack: () => {
            outcome = "acked";
          },
          retry: () => {
            outcome = "retried";
          },
        },
      ],
      ackAll: () => undefined,
      retryAll: () => undefined,
    } as unknown as MessageBatch<PerFirmQueueMessage>,
    env,
  );
  if (outcome === null) throw new Error("the consumer neither acked nor retried the message");
  return outcome;
}

interface PassBody {
  pass: {
    id: string;
    state: string;
    counts: null | { rowsRead: number; created: number; alreadyLinked: number; rejected: number };
  };
}

describe("a record transfer over its routes", () => {
  it("is refused to a member without firm:transferRecords", async () => {
    const response = await SELF.fetch(BASE, { headers: { cookie: attorneyCookie } });
    expect(response.status).toBe(403);
    const start = await SELF.fetch(
      BASE,
      json(attorneyCookie, { sourceSystem: "leap", label: "x" }),
    );
    expect(start.status).toBe(403);
  });

  it("starts a run once for one Idempotency-Key, and refuses a source system that is not a slug", async () => {
    const key = crypto.randomUUID();
    const first = await SELF.fetch(
      BASE,
      json(ownerCookie, { sourceSystem: "leap", label: "Twice" }, key),
    );
    const second = await SELF.fetch(
      BASE,
      json(ownerCookie, { sourceSystem: "leap", label: "Twice" }, key),
    );
    expect(first.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    const a = await first.json<{ run: { id: string } }>();
    const b = await second.json<{ run: { id: string } }>();
    expect(b.run.id).toBe(a.run.id);

    const refused = await SELF.fetch(BASE, json(ownerCookie, { sourceSystem: "LEAP", label: "x" }));
    expect(refused.status).toBe(422);
    const noKey = await SELF.fetch(
      BASE,
      json(ownerCookie, { sourceSystem: "leap", label: "x" }, null),
    );
    expect(noKey.status).toBe(400);
  });

  it("takes a file once, keeps its bytes unchanged and shows its first rows", async () => {
    const runId = await startRun();
    const fileId = await giveFile(runId, CARDS);
    expect((await upload(runId, CARDS)).status).toBe(409);
    expect((await upload(runId, "")).status).toBe(400);

    const row = await database()
      .prepare("SELECT object_key, byte_length FROM transfer_source_file WHERE id = ?1")
      .bind(fileId)
      .first<{ object_key: string; byte_length: number }>();
    expect(row?.object_key).toBe(`transfers/${runId}/${fileId}`);
    const stored = await env.R2.get(row!.object_key);
    expect(await stored?.text()).toBe(CARDS);

    const preview = await SELF.fetch(`${BASE}/${runId}/files/${fileId}/preview`, {
      headers: { cookie: ownerCookie },
    });
    expect(await preview.json()).toEqual({
      columns: ["Id", "First", "Last"],
      rows: [
        ["c-1", "Ada", "Lovelace"],
        ["c-2", "Byron", "Lovelace"],
        ["c-3", "", ""],
      ],
    });

    const run = await SELF.fetch(`${BASE}/${runId}`, { headers: { cookie: ownerCookie } });
    const body = await run.json<{ files: { id: string; fileName: string }[]; passes: unknown[] }>();
    expect(body.files).toEqual([expect.objectContaining({ id: fileId, fileName: "Cards.csv" })]);
    expect(JSON.stringify(body)).not.toContain("object_key");
    expect(body.passes).toEqual([]);
  });

  it("records a pass, runs it on the queue, and answers its counts and its report", async () => {
    const runId = await startRun("Rehearsal 2");
    const fileId = await giveFile(runId, `${CARDS}c-4,Grace,Hopper\n`);
    const asked = await SELF.fetch(
      `${BASE}/${runId}/passes`,
      json(ownerCookie, personPass(fileId)),
    );
    expect(asked.status).toBe(202);
    const { pass } = await asked.json<PassBody>();
    expect(pass.state).toBe("requested");
    const queued = await database()
      .prepare("SELECT payload FROM outbox WHERE topic = ?1 AND payload LIKE ?2")
      .bind(TRANSFER_PASS_REQUESTED_TOPIC, `%${pass.id}%`)
      .all();
    expect(queued.results).toHaveLength(1);

    const reportUrl = `${BASE}/${runId}/passes/${pass.id}/report`;
    const before = await SELF.fetch(reportUrl, { headers: { cookie: ownerCookie } });
    expect(await before.json()).toEqual({ report: null, failure: null });

    expect(await deliver(pass.id)).toBe("acked");
    // A second delivery of the same message finds the pass taken and does nothing.
    expect(await deliver(pass.id)).toBe("acked");

    const after = await SELF.fetch(`${BASE}/${runId}/passes/${pass.id}`, {
      headers: { cookie: ownerCookie },
    });
    expect((await after.json<PassBody>()).pass).toMatchObject({
      state: "finished",
      counts: { rowsRead: 4, created: 3, alreadyLinked: 0, rejected: 1 },
    });
    const report = await SELF.fetch(reportUrl, { headers: { cookie: ownerCookie } });
    const reportBody = await report.json<{
      report: { rejected: unknown[]; sample: unknown[] };
      failure: null;
    }>();
    expect(reportBody.failure).toBeNull();
    expect(reportBody.report.rejected).toEqual([{ rowNumber: 3, lineNumber: 4, reason: "noName" }]);
    expect(reportBody.report.sample).toHaveLength(3);
    expect(JSON.stringify(reportBody)).not.toContain("Lovelace");

    // Asked for again, the pass creates nothing.
    const again = await SELF.fetch(
      `${BASE}/${runId}/passes`,
      json(ownerCookie, personPass(fileId)),
    );
    const second = (await again.json<PassBody>()).pass;
    await deliver(second.id);
    const secondRead = await SELF.fetch(`${BASE}/${runId}/passes/${second.id}`, {
      headers: { cookie: ownerCookie },
    });
    expect((await secondRead.json<PassBody>()).pass.counts).toMatchObject({
      created: 0,
      alreadyLinked: 3,
    });
  });

  it("says why a pass failed when the file cannot be read as rows", async () => {
    const runId = await startRun("Broken");
    const fileId = await giveFile(runId, 'Id,First,Last\nc-9,"Ada,Lovelace\n');
    const asked = await SELF.fetch(
      `${BASE}/${runId}/passes`,
      json(ownerCookie, personPass(fileId)),
    );
    const { pass } = await asked.json<PassBody>();
    expect(await deliver(pass.id)).toBe("acked");
    const report = await SELF.fetch(`${BASE}/${runId}/passes/${pass.id}/report`, {
      headers: { cookie: ownerCookie },
    });
    expect(await report.json()).toEqual({
      report: null,
      failure: { reason: "fileNotReadable", fileFault: "unterminatedQuote", lineNumber: 2 },
    });
  });

  it("refuses a pass over a file of another run, rules with an unknown key, and a member the firm lacks", async () => {
    const runId = await startRun("Refusals");
    const otherRun = await startRun("Other");
    const fileId = await giveFile(otherRun, `${CARDS}c-7,Alan,Turing\n`);
    const mine = await giveFile(runId, `${CARDS}c-8,Edsger,Dijkstra\n`);

    const wrongRun = await SELF.fetch(
      `${BASE}/${runId}/passes`,
      json(ownerCookie, personPass(fileId)),
    );
    expect(wrongRun.status).toBe(404);
    const extraKey = await SELF.fetch(
      `${BASE}/${runId}/passes`,
      json(ownerCookie, personPass(mine, { given: "First", family: "Last", nickname: "Nick" })),
    );
    expect(extraKey.status).toBe(422);
    const unknownMember = await SELF.fetch(
      `${BASE}/${runId}/passes`,
      json(ownerCookie, {
        recordKind: "matter",
        fileId: mine,
        sourceKind: "matter",
        keyColumn: "Id",
        rules: {
          title: "First",
          number: "Id",
          openedDate: "Last",
          dateOrder: "day-month-year",
          timeZone: "Australia/Sydney",
          responsibleMember: { members: {}, otherwise: "user_nobody" },
        },
      }),
    );
    expect(unknownMember.status).toBe(422);
    expect(
      await database()
        .prepare("SELECT COUNT(*) AS n FROM transfer_pass WHERE transfer_run_id = ?1")
        .bind(runId)
        .first<{ n: number }>(),
    ).toEqual({ n: 0 });
  });
});

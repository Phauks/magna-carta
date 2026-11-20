import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { CONFLICTS_TRANSFER_ACCEPTED_TOPIC } from "@magna-carta/conflicts/recheck-cause";
import {
  TRANSFER_PASS_REQUESTED_TOPIC,
  TRANSFER_RUN_ACCEPTED_TOPIC,
} from "@magna-carta/record-transfer/transfer-requests";
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
let ownerUserId: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Record Transfer Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  const owner = await seedCredentialedUser("transfer-owner@example.com", {
    userName: "Transfer Owner",
    firmId,
  });
  ownerUserId = owner.userId;
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

function deliver(passId: string): Promise<"acked" | "retried"> {
  return deliverMessage(TRANSFER_PASS_REQUESTED_TOPIC, { transferPassId: passId });
}

async function deliverMessage(topic: string, payload: unknown): Promise<"acked" | "retried"> {
  let outcome: "acked" | "retried" | null = null;
  const body: PerFirmQueueMessage = {
    id: newIdentifier("outbox"),
    firmId,
    topic,
    payload: JSON.stringify(payload),
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

    const stated = await SELF.fetch(`${BASE}/${runId}/passes/${pass.id}/rules`, {
      headers: { cookie: ownerCookie },
    });
    expect(await stated.json()).toEqual({
      recordKind: "person",
      sourceKind: "card",
      keyColumn: "Id",
      delimiter: null,
      rules: { given: "First", family: "Last" },
    });

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

describe("finishing a transfer run", () => {
  const get = (url: string, cookie = ownerCookie) => SELF.fetch(url, { headers: { cookie } });
  const post = (url: string, key: string = crypto.randomUUID()) =>
    SELF.fetch(url, {
      method: "POST",
      headers: { cookie: ownerCookie, origin: "https://example.com", "Idempotency-Key": key },
    });

  const MAPPING = {
    recordKind: "matter",
    sourceKind: "matter",
    delimiter: "comma",
    assignments: { Number: { holds: "number", referenceSourceKind: "card", role: "" } },
    dateOrder: "",
    timeZone: "Australia/Sydney",
    addressCountry: "",
    matterTypes: { FAM: "" },
    members: {},
    otherwiseMember: "",
  };

  function save(runId: string, fileId: string, mapping: unknown): Promise<Response> {
    return SELF.fetch(`${BASE}/${runId}/files/${fileId}/mapping`, {
      method: "PUT",
      headers: {
        cookie: ownerCookie,
        origin: "https://example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ mapping }),
    });
  }

  it("keeps the mapping a person is working on, replaced whole on each save", async () => {
    const runId = await startRun("Mapping");
    const fileId = await giveFile(runId, `${CARDS}c-20,Mary,Shelley\n`);
    const url = `${BASE}/${runId}/files/${fileId}/mapping`;
    expect(await (await get(url)).json()).toEqual({ saved: null });

    const saved = await save(runId, fileId, MAPPING);
    expect(saved.status).toBe(200);
    expect(await (await get(url)).json()).toEqual({
      saved: { mapping: MAPPING, savedBy: ownerUserId, savedAt: expect.any(String) },
    });
    await save(runId, fileId, { ...MAPPING, dateOrder: "day-month-year" });
    const read = await (await get(url)).json<{ saved: { mapping: { dateOrder: string } } }>();
    expect(read.saved.mapping.dateOrder).toBe("day-month-year");

    // A mapping is a declared shape: anything else is refused, so a row of a file cannot ride in it.
    expect((await save(runId, fileId, { ...MAPPING, rows: [["Ada"]] })).status).toBe(422);
    expect((await get(url, attorneyCookie)).status).toBe(403);
    const stored = await env.R2.get(`transfers/${runId}/mappings/${fileId}.json`);
    expect(stored?.customMetadata?.object_class).toBe("transfer-file-mapping");
  });

  it("answers the different values of a column with the rows that use each", async () => {
    const runId = await startRun("Values");
    const fileId = await giveFile(runId, "Number,Type\nM-1,FAM\nM-2,WIL\nM-3, FAM\nM-4,\n");
    const url = `${BASE}/${runId}/files/${fileId}/column-values`;
    expect(await (await get(`${url}?column=Type`)).json()).toEqual({
      values: [
        { value: "FAM", rowCount: 2 },
        { value: "WIL", rowCount: 1 },
      ],
      rowsWithValue: 3,
      rowsRead: 4,
      truncated: false,
    });
    expect((await get(`${url}?column=Kind`)).status).toBe(422);
    expect((await get(`${url}?column=Type`, attorneyCookie)).status).toBe(403);
  });

  it("gives the rejected rows back as a file, accepts the run once and asks for the conflicts checks", async () => {
    const runId = await startRun("Cutover");
    const cards = await giveFile(runId, `${CARDS}c-30,Jane,Austen\n`);
    const asked = await SELF.fetch(`${BASE}/${runId}/passes`, json(ownerCookie, personPass(cards)));
    const { pass } = await asked.json<PassBody>();
    const rejectedUrl = `${BASE}/${runId}/passes/${pass.id}/rejected-rows`;
    expect((await get(rejectedUrl)).status).toBe(409);

    // A pass that has not run holds the run open.
    expect((await post(`${BASE}/${runId}/accept`)).status).toBe(409);
    await deliver(pass.id);

    const rejected = await get(rejectedUrl);
    expect(rejected.status).toBe(200);
    expect(rejected.headers.get("content-type")).toContain("text/csv");
    expect(rejected.headers.get("content-disposition")).toBe(
      `attachment; filename="rejected-rows-${pass.id}.csv"`,
    );
    expect(await rejected.text()).toBe("Not Brought In Because,Id,First,Last\r\nnoName,c-3,,\r\n");

    const matters = await giveFile(
      runId,
      "Number,Title,Opened,Closed\nM-100,Estate of Austen,01/02/2020,\nM-101,Old Lease,01/02/2019,03/04/2019\n",
    );
    const matterPass = await SELF.fetch(
      `${BASE}/${runId}/passes`,
      json(ownerCookie, {
        recordKind: "matter",
        fileId: matters,
        sourceKind: "matter",
        keyColumn: "Number",
        rules: {
          title: "Title",
          number: "Number",
          openedDate: "Opened",
          closedDate: "Closed",
          dateOrder: "day-month-year",
          timeZone: "Australia/Sydney",
          responsibleMember: { members: {}, otherwise: ownerUserId },
        },
      }),
    );
    expect(matterPass.status).toBe(202);
    const matterPassId = (await matterPass.json<PassBody>()).pass.id;
    await deliver(matterPassId);
    const read = await get(`${BASE}/${runId}/passes/${matterPassId}`);
    expect((await read.json<PassBody>()).pass.counts).toMatchObject({ created: 2 });
    // Nothing asked for a check while the matters were arriving.
    const requests = () =>
      database()
        .prepare(
          "SELECT matter.matter_number AS number FROM conflicts_recheck_request AS request JOIN matter ON matter.id = request.matter_id WHERE request.cause_reference = ?1",
        )
        .bind(runId)
        .all<{ number: string }>();
    expect((await requests()).results).toEqual([]);

    const key = crypto.randomUUID();
    const accepted = await post(`${BASE}/${runId}/accept`, key);
    expect(accepted.status).toBe(200);
    const body = await accepted.json<{ run: { completedAt: string | null } }>();
    expect(body.run.completedAt).not.toBeNull();
    const replayed = await post(`${BASE}/${runId}/accept`, key);
    expect(await replayed.json()).toEqual(body);
    // Asked again with a new key, the run is answered as it stands; the other ending is refused.
    expect((await post(`${BASE}/${runId}/accept`)).status).toBe(200);
    expect((await post(`${BASE}/${runId}/abandon`)).status).toBe(409);
    expect((await upload(runId, "Id\nz-1\n")).status).toBe(409);
    expect((await save(runId, cards, MAPPING)).status).toBe(409);

    const queued = await database()
      .prepare("SELECT payload FROM outbox WHERE topic = ?1 AND payload LIKE ?2")
      .bind(TRANSFER_RUN_ACCEPTED_TOPIC, `%${runId}%`)
      .all<{ payload: string }>();
    expect(queued.results).toHaveLength(1);
    expect(
      await deliverMessage(TRANSFER_RUN_ACCEPTED_TOPIC, JSON.parse(queued.results[0]!.payload)),
    ).toBe("acked");
    // The open matter is asked about; the closed one is not. A second delivery adds nothing.
    expect((await requests()).results).toEqual([{ number: "M-100" }]);
    await deliverMessage(TRANSFER_RUN_ACCEPTED_TOPIC, { transferRunId: runId });
    expect((await requests()).results).toHaveLength(1);
  });

  it("stops a run without asking for anything, and keeps what arrived", async () => {
    const runId = await startRun("Stopped");
    const stopped = await post(`${BASE}/${runId}/abandon`);
    expect(stopped.status).toBe(200);
    const body = await stopped.json<{ run: { abandonedAt: string | null; completedAt: null } }>();
    expect(body.run.abandonedAt).not.toBeNull();
    expect(body.run.completedAt).toBeNull();
    expect((await post(`${BASE}/${runId}/accept`)).status).toBe(409);
    const queued = await database()
      .prepare("SELECT payload FROM outbox WHERE topic = ?1 AND payload LIKE ?2")
      .bind(TRANSFER_RUN_ACCEPTED_TOPIC, `%${runId}%`)
      .all();
    expect(queued.results).toEqual([]);
  });

  it("spells the accepted-run topic the way the conflicts check knows it", () => {
    expect(CONFLICTS_TRANSFER_ACCEPTED_TOPIC).toBe(TRANSFER_RUN_ACCEPTED_TOPIC);
  });
});

describe("a source file given in pieces", () => {
  const headers = () => ({ cookie: ownerCookie, origin: "https://example.com" });
  // The bucket takes pieces of five mebibytes or more, the last excepted.
  const FIRST_PIECE_BYTES = 5 * 1024 * 1024;

  function table(): Uint8Array {
    const lines = ["Id,First,Last"];
    let length = lines[0]!.length + 1;
    for (let row = 1; length < FIRST_PIECE_BYTES + 2000; row += 1) {
      const line = `p-${row},Given${row},Family${row}`;
      lines.push(line);
      length += line.length + 1;
    }
    return new TextEncoder().encode(`${lines.join("\n")}\n`);
  }

  async function start(runId: string): Promise<{ fileId: string; uploadId: string }> {
    const response = await SELF.fetch(`${BASE}/${runId}/file-uploads`, {
      method: "POST",
      headers: headers(),
    });
    expect(response.status).toBe(201);
    return response.json();
  }

  async function sendPart(
    runId: string,
    upload: { fileId: string; uploadId: string },
    partNumber: number,
    bytes: Uint8Array,
  ): Promise<Response> {
    return SELF.fetch(
      `${BASE}/${runId}/file-uploads/${upload.fileId}/parts/${partNumber}?uploadId=${encodeURIComponent(upload.uploadId)}`,
      {
        method: "PUT",
        headers: { ...headers(), "content-type": "application/octet-stream" },
        body: bytes,
      },
    );
  }

  function complete(
    runId: string,
    upload: { fileId: string; uploadId: string },
    parts: unknown[],
  ): Promise<Response> {
    return SELF.fetch(`${BASE}/${runId}/file-uploads/${upload.fileId}/complete`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: upload.uploadId,
        fileName: "People.csv",
        sourceKind: "card-list",
        parts,
      }),
    });
  }

  async function give(runId: string, bytes: Uint8Array) {
    const upload = await start(runId);
    const parts = [];
    for (const [index, piece] of [
      bytes.subarray(0, FIRST_PIECE_BYTES),
      bytes.subarray(FIRST_PIECE_BYTES),
    ].entries()) {
      const sent = await sendPart(runId, upload, index + 1, piece);
      expect(sent.status).toBe(200);
      parts.push((await sent.json<{ part: unknown }>()).part);
    }
    return { upload, parts };
  }

  it("joins the pieces into one file with the digest of the whole, and takes the same bytes once", async () => {
    const runId = await startRun("Tables");
    const bytes = table();
    const { upload, parts } = await give(runId, bytes);
    // No file is in the run until the upload is completed.
    const before = await SELF.fetch(`${BASE}/${runId}`, { headers: headers() });
    expect((await before.json<{ files: unknown[] }>()).files).toEqual([]);

    const done = await complete(runId, upload, parts);
    expect(done.status).toBe(201);
    const { file } = await done.json<{
      file: { id: string; byteLength: number; contentSha256: string; fileName: string };
    }>();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const expected = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(file).toMatchObject({
      id: upload.fileId,
      byteLength: bytes.byteLength,
      contentSha256: expected,
      fileName: "People.csv",
    });
    const stored = await env.R2.get(`transfers/${runId}/${upload.fileId}`);
    expect(stored?.size).toBe(bytes.byteLength);
    expect(stored?.customMetadata?.object_class).toBe("transfer-source-file");

    // The completion delivered again answers the same file.
    const again = await complete(runId, upload, parts);
    expect(again.status).toBe(201);
    expect((await again.json<{ file: { id: string } }>()).file.id).toBe(upload.fileId);

    // The same bytes given again, in pieces, are refused and nothing is kept.
    const second = await give(runId, bytes);
    expect((await complete(runId, second.upload, second.parts)).status).toBe(409);
    expect(await env.R2.get(`transfers/${runId}/${second.upload.fileId}`)).toBeNull();

    const preview = await SELF.fetch(`${BASE}/${runId}/files/${upload.fileId}/preview`, {
      headers: headers(),
    });
    expect((await preview.json<{ columns: string[] }>()).columns).toEqual(["Id", "First", "Last"]);
  });

  it("refuses a piece for an upload it does not know, and a member without the permission", async () => {
    const runId = await startRun("Tables 2");
    const upload = await start(runId);
    const stray = await sendPart(
      runId,
      { fileId: upload.fileId, uploadId: "not-an-upload" },
      1,
      new Uint8Array([65]),
    );
    expect(stray.status).toBe(409);
    expect((await complete(runId, upload, [{ partNumber: 1, etag: "nothing" }])).status).toBe(409);
    const refused = await SELF.fetch(`${BASE}/${runId}/file-uploads`, {
      method: "POST",
      headers: { cookie: attorneyCookie, origin: "https://example.com" },
    });
    expect(refused.status).toBe(403);
  });
});

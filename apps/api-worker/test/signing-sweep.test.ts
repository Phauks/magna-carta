// @node-runtime
// The clock's half of a signing request: when one is reminded, when it is expired, and that a
// reminder mails the same link to whoever's turn it is.
import { describe, expect, it } from "vitest";
import {
  commitEffectBatch,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type {
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  SigningRequestId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  createDraft,
  readRequestDetail,
  saveDraft,
  sendRequest,
  type DraftContents,
} from "../src/signing/request-service.ts";
import { linkStatements } from "../src/signing/signer-delivery.ts";
import {
  AUTOMATIC_REMINDER_ACTOR,
  sweepDecision,
  sweepFirmSigning,
} from "../src/signing/signing-sweep.ts";
import { readRequest } from "../src/signing/statements.ts";

const ACTOR = "user_signingTester000" as UserId;
const FIRM = "firm_signingTest00000000000" as FirmId;
const SENT = "2026-11-13T12:00:00.000Z";
const KEY = "a-test-signing-key-that-is-long-enough";
const options = { now: SENT, actorUserId: ACTOR, actorName: "Trevor Goldsmith" };

function setup(): BatchDatabase {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Trevor Goldsmith', 'active', '${SENT}')`,
  );
  raw.exec("PRAGMA foreign_keys = OFF");
  return database;
}

async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => SENT });
}

const contents: DraftContents = {
  subject: "Please sign",
  message: "",
  order: "in-order",
  expiresAt: "2026-11-20T12:00:00.000Z",
  remindEveryDays: 3,
  signers: [
    { key: "a", name: "Jordan Smith", email: "jordan@example.com", attribution: "email-link" },
    { key: "b", name: "Riley Park", email: "riley@example.com", attribution: "email-link" },
  ],
  fields: [
    { signerKey: "a", kind: "signature", page: 1, rect: [72, 100, 252, 130], required: true },
    { signerKey: "b", kind: "signature", page: 1, rect: [72, 200, 252, 230], required: true },
  ],
};

async function sentRequest(database: BatchDatabase): Promise<SigningRequestId> {
  const draft = createDraft(
    database,
    {
      matterId: "matter_signingTest00000000000000" as MatterId,
      fileId: "file_signingTest000000000000000" as FileId,
      fileVersionId: "fileVersion_signingTest0000000000" as FileVersionId,
      title: "Agreement.pdf",
    },
    options,
  );
  await commit(database, draft.effect);
  await commit(database, await saveDraft(database, draft.id, contents, options));
  const sent = await sendRequest(
    database,
    draft.id,
    { sha256: "ab".repeat(32), pageCount: 1 },
    options,
  );
  const links = await linkStatements(database, KEY, FIRM, sent.notify, SENT);
  await commit(database, { ...sent.effect, statements: [...sent.effect.statements, ...links] });
  return draft.id;
}

function sweep(database: BatchDatabase, at: string, mails: { to: string; text: string }[]) {
  return sweepFirmSigning({
    database,
    firmId: FIRM,
    firmName: "Goldsmith Law",
    mailing: {
      send: (message) => {
        mails.push({ to: message.to, text: message.text });
        return Promise.resolve();
      },
      key: KEY,
      origin: "https://app.example.com",
    },
    now: new Date(at),
  });
}

describe("the signing sweep", () => {
  it("reminds every so many days from the send or the last reminder, and expires at the last moment", async () => {
    const database = setup();
    const id = await sentRequest(database);
    const request = await readRequest(database, id);
    if (request === undefined) throw new Error("request expected");
    expect(sweepDecision(request, new Date("2026-11-15T12:00:00.000Z"))).toBe("none");
    expect(sweepDecision(request, new Date("2026-11-16T12:00:00.000Z"))).toBe("remind");
    expect(sweepDecision(request, new Date("2026-11-20T12:00:00.000Z"))).toBe("expire");
    expect(
      sweepDecision({ ...request, remindEveryDays: null }, new Date("2026-11-19T00:00:00.000Z")),
    ).toBe("none");
  });

  it("mails the waiting signer the same link again, records it, and waits the interval before the next", async () => {
    const database = setup();
    const id = await sentRequest(database);
    const mails: { to: string; text: string }[] = [];

    expect(await sweep(database, "2026-11-16T12:00:00.000Z", mails)).toEqual({
      expired: 0,
      reminded: 1,
      undelivered: 0,
    });
    expect(mails.map((mail) => mail.to)).toEqual(["jordan@example.com"]);
    expect(mails[0]?.text).toContain("https://app.example.com/sign/");
    const detail = await readRequestDetail(database, id);
    expect(detail?.request.lastRemindedAt).toBe("2026-11-16T12:00:00.000Z");
    const line = detail?.events.find((one) => one.kind === "reminded");
    expect(line?.actor).toBe(AUTOMATIC_REMINDER_ACTOR);

    expect((await sweep(database, "2026-11-17T12:00:00.000Z", mails)).reminded).toBe(0);
    expect(mails).toHaveLength(1);
  });

  it("closes a request past its last moment as expired, and mails nobody", async () => {
    const database = setup();
    const id = await sentRequest(database);
    const mails: { to: string; text: string }[] = [];
    expect((await sweep(database, "2026-11-21T00:00:00.000Z", mails)).expired).toBe(1);
    expect((await readRequest(database, id))?.status).toBe("expired");
    expect(mails).toHaveLength(0);
    expect((await sweep(database, "2026-11-22T00:00:00.000Z", mails)).expired).toBe(0);
  });
});

// @node-runtime
// A colleague signing in the app against a real migrated per-firm database: an outside signer goes
// first, and finishing their part raises the colleague's notification and puts the request on the
// colleague's list; the colleague then signs without a link or a code, and the request completes.
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
import { SIGNING_MEMBER_TURN_TOPIC } from "@magna-carta/signing/request";
import {
  createDraft,
  readRequestDetail,
  remindSigners,
  saveDraft,
  sendRequest,
  type DraftContents,
} from "../src/signing/request-service.ts";
import { linkStatements } from "../src/signing/signer-delivery.ts";
import {
  adoptSignature,
  finishSigning,
  giveConsent,
  needsCode,
  openRequest,
  readSignerView,
  type Observed,
} from "../src/signing/signer-service.ts";
import { listWaitingOnMember } from "../src/signing/statements.ts";

const SENDER = "user_signingSender0000" as UserId;
const COLLEAGUE = "user_signingColleague0" as UserId;
const FIRM = "firm_signingTest00000000000" as FirmId;
const MATTER = "matter_signingTest00000000000000" as MatterId;
const FILE = "file_signingTest000000000000000" as FileId;
const VERSION = "fileVersion_signingTest0000000000" as FileVersionId;
const NOW = "2026-11-16T12:00:00.000Z";
const KEY = "a-test-signing-key-that-is-long-enough";
const options = { now: NOW, actorUserId: SENDER, actorName: "Sam Sender" };
const seen: Observed = { now: NOW, ip: "203.0.113.7", userAgent: "Test Browser" };

function setup(): BatchDatabase {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  for (const [id, name] of [
    [SENDER, "Sam Sender"],
    [COLLEAGUE, "Casey Colleague"],
  ] as const) {
    raw.exec(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${id}', '${name}', 'active', '${NOW}')`,
    );
  }
  raw.exec("PRAGMA foreign_keys = OFF");
  return database;
}

async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => NOW });
}

const contents: DraftContents = {
  subject: "Please sign",
  message: "",
  order: "in-order",
  expiresAt: "2026-12-16T12:00:00.000Z",
  remindEveryDays: null,
  signers: [
    { key: "client", name: "Jordan Smith", email: "jordan@example.com", attribution: "email-link" },
    {
      key: "firm",
      name: "Casey Colleague",
      email: "",
      attribution: "firm-authenticated",
      userId: COLLEAGUE,
    },
  ],
  fields: [
    { signerKey: "client", kind: "signature", page: 1, rect: [72, 100, 252, 130], required: true },
    { signerKey: "firm", kind: "signature", page: 1, rect: [72, 50, 252, 80], required: true },
  ],
};

async function sentRequest(database: BatchDatabase): Promise<SigningRequestId> {
  const draft = createDraft(
    database,
    { matterId: MATTER, fileId: FILE, fileVersionId: VERSION, title: "Agreement.pdf" },
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
  // The outside signer is asked first, so nobody in the firm hears anything yet.
  expect(sent.effect.outboxMessages).toEqual([]);
  const links = await linkStatements(database, KEY, FIRM, sent.notify, NOW);
  await commit(database, { ...sent.effect, statements: [...sent.effect.statements, ...links] });
  return draft.id;
}

describe("a colleague who signs in the app", () => {
  it("hears when it is their turn, finds the request on their list, and signs without a code", async () => {
    const database = setup();
    const id = await sentRequest(database);
    const detail = await readRequestDetail(database, id);
    const client = detail?.signers.find((one) => one.attributionLevel === "email-link");
    const colleague = detail?.signers.find((one) => one.userId === COLLEAGUE);
    if (client === undefined || colleague === undefined) throw new Error("two signers expected");

    // Not their turn yet: nothing is waiting on them.
    expect(await listWaitingOnMember(database, FILE, COLLEAGUE)).toEqual([]);

    let outside = await readSignerView(database, id, client.id);
    await commit(database, openRequest(database, outside, seen));
    outside = await readSignerView(database, id, client.id);
    await commit(database, giveConsent(database, outside, seen));
    outside = await readSignerView(database, id, client.id);
    await commit(
      database,
      adoptSignature(
        database,
        outside,
        { how: "typed", signatureKey: "s.png", initialsKey: null },
        seen,
      ),
    );
    outside = await readSignerView(database, id, client.id);
    const handedOn = finishSigning(database, outside, {}, seen);
    expect(handedOn.completed).toBe(false);

    // Finishing the outside part raises exactly one turn message, naming the colleague and the
    // document by identifier only.
    expect(handedOn.effect.outboxMessages).toEqual([
      {
        topic: SIGNING_MEMBER_TURN_TOPIC,
        payload: { requestId: id, fileId: FILE, matterId: MATTER, signerUserId: COLLEAGUE },
        aggregateKey: id,
      },
    ]);
    await commit(database, handedOn.effect);

    expect(await listWaitingOnMember(database, FILE, COLLEAGUE)).toEqual([id]);
    expect(await listWaitingOnMember(database, FILE, SENDER)).toEqual([]);

    // A reminder reaches the colleague through the same notification.
    const reminded = await remindSigners(database, id, options);
    expect(reminded.effect.outboxMessages.map((one) => one.topic)).toEqual([
      SIGNING_MEMBER_TURN_TOPIC,
    ]);

    let member = await readSignerView(database, id, colleague.id);
    expect(needsCode(member)).toBe(false);
    await commit(database, openRequest(database, member, seen));
    member = await readSignerView(database, id, colleague.id);
    await commit(database, giveConsent(database, member, seen));
    member = await readSignerView(database, id, colleague.id);
    await commit(
      database,
      adoptSignature(
        database,
        member,
        { how: "drawn", signatureKey: "m.png", initialsKey: null },
        seen,
      ),
    );
    member = await readSignerView(database, id, colleague.id);
    const last = finishSigning(database, member, {}, seen);
    expect(last.completed).toBe(true);
    await commit(database, last.effect);

    expect((await readRequestDetail(database, id))?.request.status).toBe("completed");
    expect(await listWaitingOnMember(database, FILE, COLLEAGUE)).toEqual([]);
  });
});

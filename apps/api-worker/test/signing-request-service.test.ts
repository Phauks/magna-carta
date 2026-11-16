// @node-runtime
// A signing request drafted, saved, sent, reminded and cancelled against a real migrated per-firm
// database, with the races the guarded writes exist to refuse.
import { describe, expect, it } from "vitest";
import {
  commitEffectBatch,
  GuardedWriteRefusedError,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { FileId, FileVersionId, MatterId, UserId } from "@magna-carta/identifiers/types";
import {
  SigningRequestRefusal,
  cancelRequest,
  createDraft,
  readRequestDetail,
  remindSigners,
  saveDraft,
  sendRequest,
  type DraftContents,
} from "../src/signing/request-service.ts";

const ACTOR = "user_signingTester000" as UserId;
const MATTER = "matter_signingTest00000000000000" as MatterId;
const FILE = "file_signingTest000000000000000" as FileId;
const VERSION = "fileVersion_signingTest0000000000" as FileVersionId;
const NOW = "2026-11-13T12:00:00.000Z";
const options = { now: NOW, actorUserId: ACTOR, actorName: "Trevor Goldsmith" };
const HASH = "9f".repeat(32);

function setup() {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Trevor Goldsmith', 'active', '${NOW}')`,
  );
  // The matter and file rows the request points at belong to other services, which are not under
  // test, so their foreign keys are not held here.
  raw.exec("PRAGMA foreign_keys = OFF");
  return { database, raw };
}

async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => NOW });
}

const contents: DraftContents = {
  subject: "Please sign: Settlement Agreement",
  message: "Final version.",
  order: "in-order",
  expiresAt: "2026-12-13T12:00:00.000Z",
  remindEveryDays: 3,
  signers: [
    { key: "client", name: "Jordan Smith", email: "jordan@example.com", attribution: "email-link" },
    {
      key: "firm",
      name: "Trevor Goldsmith",
      email: "",
      attribution: "firm-authenticated",
      userId: ACTOR,
    },
  ],
  fields: [
    {
      signerKey: "client",
      kind: "signature",
      page: 1,
      rect: [72, 100, 252, 130.5],
      required: true,
    },
    {
      signerKey: "client",
      kind: "date-signed",
      page: 1,
      rect: [300, 100, 400, 120],
      required: true,
    },
    { signerKey: "firm", kind: "signature", page: 1, rect: [72, 50, 252, 80], required: true },
  ],
};

describe("a signing request", () => {
  it("is drafted, saved, sent to the first signer, reminded and cancelled", async () => {
    const { database } = setup();
    const draft = createDraft(
      database,
      { matterId: MATTER, fileId: FILE, fileVersionId: VERSION, title: "Settlement Agreement.pdf" },
      options,
    );
    await commit(database, draft.effect);
    await commit(database, await saveDraft(database, draft.id, contents, options));

    const saved = await readRequestDetail(database, draft.id);
    expect(saved?.request.subject).toBe("Please sign: Settlement Agreement");
    expect(saved?.signers.map((signer) => [signer.position, signer.name])).toEqual([
      [1, "Jordan Smith"],
      [2, "Trevor Goldsmith"],
    ]);
    expect(saved?.fields[0]?.rect).toEqual([72, 100, 252, 130.5]);

    // Saving again replaces, rather than adds to, what the draft holds.
    await commit(database, await saveDraft(database, draft.id, contents, options));
    expect((await readRequestDetail(database, draft.id))?.fields).toHaveLength(3);

    const sent = await sendRequest(database, draft.id, { sha256: HASH, pageCount: 6 }, options);
    expect(sent.notify.map((signer) => signer.name)).toEqual(["Jordan Smith"]);
    await commit(database, sent.effect);
    const after = await readRequestDetail(database, draft.id);
    expect(after?.request.status).toBe("sent");
    expect(after?.request.documentHashSha256).toBe(HASH);
    expect(after?.signers.map((signer) => signer.status)).toEqual(["notified", "waiting"]);
    expect(after?.events.map((one) => one.kind)).toEqual(["created", "sent", "delivered"]);

    await expect(saveDraft(database, draft.id, contents, options)).rejects.toThrow(
      SigningRequestRefusal,
    );

    const reminded = await remindSigners(database, draft.id, options);
    expect(reminded.remind.map((signer) => signer.name)).toEqual(["Jordan Smith"]);
    await commit(database, reminded.effect);

    const cancelled = await cancelRequest(database, draft.id, "Sent the wrong version", options);
    await commit(database, cancelled.effect);
    const ended = await readRequestDetail(database, draft.id);
    expect(ended?.request.status).toBe("voided");
    expect(ended?.request.voidedReason).toBe("Sent the wrong version");
  });

  it("refuses to send a draft that is missing something, naming it", async () => {
    const { database } = setup();
    const draft = createDraft(
      database,
      { matterId: MATTER, fileId: FILE, fileVersionId: VERSION, title: "Brief.pdf" },
      options,
    );
    await commit(database, draft.effect);
    await expect(
      sendRequest(database, draft.id, { sha256: HASH, pageCount: 2 }, options),
    ).rejects.toThrow("Add at least one signer.");
  });

  it("refuses a second send that raced the first", async () => {
    const { database } = setup();
    const draft = createDraft(
      database,
      { matterId: MATTER, fileId: FILE, fileVersionId: VERSION, title: "Brief.pdf" },
      options,
    );
    await commit(database, draft.effect);
    await commit(database, await saveDraft(database, draft.id, contents, options));
    const first = await sendRequest(database, draft.id, { sha256: HASH, pageCount: 6 }, options);
    const second = await sendRequest(database, draft.id, { sha256: HASH, pageCount: 6 }, options);
    await commit(database, first.effect);
    await expect(commit(database, second.effect)).rejects.toThrow(GuardedWriteRefusedError);
  });
});

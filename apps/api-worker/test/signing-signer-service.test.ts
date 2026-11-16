// @node-runtime
// An outside signer's acts against a real migrated per-firm database: a request sent to two outside
// signers in order, the first proving who they are with a code, each agreeing, adopting and
// finishing, and the request completing; and a decline ending one.
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
  SigningSignerId,
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
import { hashSignerSecret, signerLinkSecret } from "../src/signing/signer-link.ts";
import { signerLinkRefusal } from "../src/signing/signer-refusals.ts";
import { readSignerLinkState } from "../src/signing/signer-statements.ts";
import {
  SignerStepRefusal,
  adoptSignature,
  checkAccessCode,
  declineSigning,
  finishSigning,
  giveConsent,
  issueAccessCode,
  openRequest,
  readSignerView,
  type Observed,
} from "../src/signing/signer-service.ts";

const ACTOR = "user_signingTester000" as UserId;
const FIRM = "firm_signingTest00000000000" as FirmId;
const MATTER = "matter_signingTest00000000000000" as MatterId;
const FILE = "file_signingTest000000000000000" as FileId;
const VERSION = "fileVersion_signingTest0000000000" as FileVersionId;
const NOW = "2026-11-13T12:00:00.000Z";
const KEY = "a-test-signing-key-that-is-long-enough";
const options = { now: NOW, actorUserId: ACTOR, actorName: "Trevor Goldsmith" };
const seen: Observed = { now: NOW, ip: "203.0.113.7", userAgent: "Test Browser" };

function setup() {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Trevor Goldsmith', 'active', '${NOW}')`,
  );
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
  expiresAt: "2026-12-13T12:00:00.000Z",
  remindEveryDays: null,
  signers: [
    { key: "a", name: "Jordan Smith", email: "jordan@example.com", attribution: "access-code" },
    { key: "b", name: "Riley Park", email: "riley@example.com", attribution: "email-link" },
  ],
  fields: [
    { signerKey: "a", kind: "signature", page: 1, rect: [72, 100, 252, 130], required: true },
    { signerKey: "a", kind: "text", page: 1, rect: [72, 200, 252, 220], required: true },
    { signerKey: "a", kind: "checkbox", page: 1, rect: [72, 240, 86, 254], required: false },
    { signerKey: "b", kind: "initials", page: 2, rect: [500, 40, 560, 70], required: true },
    { signerKey: "b", kind: "signature", page: 2, rect: [72, 100, 252, 130], required: true },
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
    { sha256: "ab".repeat(32), pageCount: 2 },
    options,
  );
  const links = await linkStatements(database, KEY, FIRM, sent.notify, NOW);
  await commit(database, { ...sent.effect, statements: [...sent.effect.statements, ...links] });
  return draft.id;
}

async function signerIds(
  database: BatchDatabase,
  id: SigningRequestId,
): Promise<SigningSignerId[]> {
  return ((await readRequestDetail(database, id))?.signers ?? []).map((signer) => signer.id);
}

describe("an outside signer", () => {
  it("is asked in turn, proves who they are, agrees, adopts and signs, and the request completes", async () => {
    const database = setup();
    const id = await sentRequest(database);
    const [first, second] = await signerIds(database, id);
    if (first === undefined || second === undefined) throw new Error("two signers expected");

    // The first signer's link is recorded as its digest, and the lane would accept it.
    const state = await readSignerLinkState(database, id, first);
    const secret = await signerLinkSecret(KEY, FIRM, first, 1);
    expect(state?.tokenSecretHash).toBe(await hashSignerSecret(secret));
    expect(
      signerLinkRefusal({
        found: true,
        secretMatches: true,
        storedVersion: state?.secretVersion ?? 0,
        presentedVersion: 1,
        requestStatus: state?.requestStatus ?? "draft",
        expiresAt: state?.expiresAt ?? NOW,
        signerStatus: state?.signerStatus ?? "waiting",
        now: NOW,
      }),
    ).toBeNull();
    // The second signer is not asked yet, and has no link recorded.
    expect((await readSignerLinkState(database, id, second))?.tokenSecretHash).toBeNull();

    let view = await readSignerView(database, id, first);
    await commit(database, openRequest(database, view, seen));
    view = await readSignerView(database, id, first);
    expect(view.signer.status).toBe("opened");

    // Nothing before the code.
    expect(() => giveConsent(database, view, seen)).toThrow(SignerStepRefusal);
    await commit(database, issueAccessCode(database, view, "code-digest", seen));
    view = await readSignerView(database, id, first);
    const wrong = checkAccessCode(database, view, false, seen);
    expect(wrong.verified).toBe(false);
    await commit(database, wrong.effect);
    view = await readSignerView(database, id, first);
    expect(view.progress.accessCodeAttempts).toBe(1);
    const right = checkAccessCode(database, view, true, seen);
    await commit(database, right.effect);
    view = await readSignerView(database, id, first);
    expect(view.progress.identityVerifiedAt).toBe(NOW);
    expect(view.progress.accessCodeHash).toBeNull();

    expect(() => finishSigning(database, view, {}, seen)).toThrow(/Agree/);
    await commit(database, giveConsent(database, view, seen));
    view = await readSignerView(database, id, first);
    expect(() => finishSigning(database, view, {}, seen)).toThrow(/Adopt/);
    await commit(
      database,
      adoptSignature(
        database,
        view,
        { how: "typed", signatureKey: "signing/a/signature.png", initialsKey: null },
        seen,
      ),
    );
    view = await readSignerView(database, id, first);
    const textField = view.detail.fields.find((field) => field.kind === "text");
    expect(() => finishSigning(database, view, {}, seen)).toThrow(/required field/);
    const done = finishSigning(database, view, { [textField?.id ?? ""]: "Acme LLC" }, seen);
    expect(done.completed).toBe(false);
    expect(done.notify.map((signer) => signer.name)).toEqual(["Riley Park"]);
    const nextLinks = await linkStatements(database, KEY, FIRM, done.notify, NOW);
    await commit(database, {
      ...done.effect,
      statements: [...done.effect.statements, ...nextLinks],
    });
    expect((await readSignerLinkState(database, id, second))?.tokenSecretHash).not.toBeNull();

    let other = await readSignerView(database, id, second);
    await commit(database, openRequest(database, other, seen));
    other = await readSignerView(database, id, second);
    await commit(database, giveConsent(database, other, seen));
    other = await readSignerView(database, id, second);
    await commit(
      database,
      adoptSignature(
        database,
        other,
        { how: "drawn", signatureKey: "s.png", initialsKey: "i.png" },
        seen,
      ),
    );
    other = await readSignerView(database, id, second);
    const last = finishSigning(database, other, {}, seen);
    expect(last.completed).toBe(true);
    await commit(database, last.effect);

    const detail = await readRequestDetail(database, id);
    expect(detail?.request.status).toBe("completed");
    expect(detail?.fields.find((field) => field.kind === "text")?.valueText).toBe("Acme LLC");
    expect(detail?.fields.find((field) => field.kind === "checkbox")?.valueText).toBe("unchecked");
    // Every act here shares one instant, so the lines are compared as a set of what happened.
    expect(detail?.events.map((one) => one.kind).toSorted()).toEqual(
      [
        "created",
        "sent",
        "delivered",
        "viewed",
        "identity-verified",
        "consented",
        "signed",
        "delivered",
        "viewed",
        "consented",
        "signed",
        "completed",
      ].toSorted(),
    );
    const signed = detail?.events.find((one) => one.kind === "signed" && one.signerId === first);
    expect(signed?.observedIp).toBe("203.0.113.7");
    expect(signed?.detail).toBe("1 signature, 0 initials");
  });

  it("who is not yet asked cannot open, and a decline ends the request for everyone", async () => {
    const database = setup();
    const id = await sentRequest(database);
    const [first, second] = await signerIds(database, id);
    if (first === undefined || second === undefined) throw new Error("two signers expected");
    const waiting = await readSignerView(database, id, second);
    expect(() => openRequest(database, waiting, seen)).toThrow(/not your turn/);

    const view = await readSignerView(database, id, first);
    await commit(database, declineSigning(database, view, "Wrong amount", seen));
    const detail = await readRequestDetail(database, id);
    expect(detail?.request.status).toBe("declined");
    expect(detail?.signers[0]?.declineReason).toBe("Wrong amount");
    const state = await readSignerLinkState(database, id, first);
    expect(
      signerLinkRefusal({
        found: true,
        secretMatches: true,
        storedVersion: 1,
        presentedVersion: 1,
        requestStatus: state?.requestStatus ?? "sent",
        expiresAt: state?.expiresAt ?? NOW,
        signerStatus: state?.signerStatus ?? "notified",
        now: NOW,
      }),
    ).toBe("declined");
  });
});

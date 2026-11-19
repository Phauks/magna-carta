// @node-runtime
// Sealing a completed request against a real migrated per-firm database, with the bucket and the
// sealing service stood in for: the marks sent are what the signers gave, each picture is sent once,
// the signed copy is filed as a new version and the certificate beside it, and a second sealing of
// the same request does nothing. A document whose bytes changed since it was sent is not sealed.
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
import type { SealPort, SealRequest } from "@magna-carta/signing/port";
import { SIGNING_COMPLETED_TOPIC } from "@magna-carta/signing/request";
import {
  createDraft,
  readRequestDetail,
  saveDraft,
  sendRequest,
  type DraftContents,
} from "../src/signing/request-service.ts";
import {
  certificateFileName,
  isWindows1252,
  sealCompletedRequest,
  signedDate,
  type SealingDependencies,
} from "../src/signing/seal-completed.ts";
import { linkStatements } from "../src/signing/signer-delivery.ts";
import {
  adoptSignature,
  finishSigning,
  giveConsent,
  openRequest,
  readSignerView,
  type Observed,
} from "../src/signing/signer-service.ts";

const SENDER = "user_signingSender0000" as UserId;
const COLLEAGUE = "user_signingColleague0" as UserId;
const FIRM = "firm_signingTest00000000000" as FirmId;
const MATTER = "matter_signingTest00000000000000" as MatterId;
const FILE = "file_signingTest000000000000000" as FileId;
const VERSION = "fileVersion_signingTest0000000000" as FileVersionId;
const SENT_KEY = `files/${FILE}/${VERSION}`;
const NOW = "2026-11-16T23:30:00.000Z";
const KEY = "a-test-signing-key-that-is-long-enough";
const DOCUMENT = new TextEncoder().encode("%PDF-1.7 the agreement as it was sent");
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
  raw.exec(
    `INSERT INTO location (id, name, status, time_zone, created_at, updated_at) VALUES ('location_office000000000000000', 'Reno', 'active', 'America/Los_Angeles', '${NOW}', '${NOW}')`,
  );
  raw.exec(
    `INSERT INTO matter (id, title, status, location_id, responsible_member_id, created_at, updated_at) VALUES ('${MATTER}', 'Smith', 'open', 'location_office000000000000000', '${SENDER}', '${NOW}', '${NOW}')`,
  );
  raw.exec(
    `INSERT INTO file (id, matter_id, folder_id, name, current_version_id, created_at, updated_at) VALUES ('${FILE}', '${MATTER}', NULL, 'Agreement.pdf', '${VERSION}', '${NOW}', '${NOW}')`,
  );
  raw.exec(
    `INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at) VALUES ('${VERSION}', '${FILE}', 1, '${SENT_KEY}', ${DOCUMENT.length}, 'application/pdf', '${DOCUMENT_HASH}', 'clean', '${SENDER}', '${NOW}', '${NOW}')`,
  );
  return database;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const DOCUMENT_HASH = await sha256Hex(DOCUMENT);

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
    { signerKey: "client", kind: "signature", page: 2, rect: [72, 100, 252, 130], required: true },
    {
      signerKey: "client",
      kind: "date-signed",
      page: 2,
      rect: [300, 100, 400, 120],
      required: true,
    },
    { signerKey: "client", kind: "checkbox", page: 2, rect: [72, 200, 86, 214], required: false },
    { signerKey: "firm", kind: "signature", page: 2, rect: [72, 50, 252, 80], required: true },
    { signerKey: "firm", kind: "full-name", page: 2, rect: [300, 50, 450, 70], required: true },
  ],
};

/** A bucket that keeps what is written to it. */
function memoryBucket(): { bucket: R2Bucket; objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async get(key: string) {
      const bytes = objects.get(key);
      return bytes === undefined
        ? null
        : { arrayBuffer: async () => bytes.slice().buffer, size: bytes.length };
    },
    async put(key: string, value: Uint8Array) {
      objects.set(key, new Uint8Array(value));
      return { size: value.length };
    },
  } as unknown as R2Bucket;
  return { bucket, objects };
}

async function completedRequest(database: BatchDatabase, bucket: Map<string, Uint8Array>) {
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
    { sha256: DOCUMENT_HASH, pageCount: 2 },
    options,
  );
  const links = await linkStatements(database, KEY, FIRM, sent.notify, NOW);
  await commit(database, { ...sent.effect, statements: [...sent.effect.statements, ...links] });

  const detail = await readRequestDetail(database, draft.id);
  let completedMessages: readonly string[] = [];
  for (const signer of detail?.signers ?? []) {
    let view = await readSignerView(database, draft.id, signer.id);
    await commit(database, openRequest(database, view, seen));
    view = await readSignerView(database, draft.id, signer.id);
    await commit(database, giveConsent(database, view, seen));
    view = await readSignerView(database, draft.id, signer.id);
    const signatureKey = `signing/${draft.id}/${signer.id}/signature.png`;
    bucket.set(signatureKey, new Uint8Array([0x89, 0x50, 0x4e, 0x47, signer.position]));
    await commit(
      database,
      adoptSignature(database, view, { how: "drawn", signatureKey, initialsKey: null }, seen),
    );
    view = await readSignerView(database, draft.id, signer.id);
    const checkbox = view.detail.fields.find(
      (field) => field.kind === "checkbox" && field.signerId === signer.id,
    );
    const done = finishSigning(
      database,
      view,
      checkbox === undefined ? {} : { [checkbox.id]: true },
      seen,
    );
    completedMessages = done.effect.outboxMessages.map((message) => message.topic);
    await commit(database, done.effect);
  }
  // The finish that completes the request asks for the seal in its own batch.
  expect(completedMessages).toContain(SIGNING_COMPLETED_TOPIC);
  return draft.id;
}

function dependencies(
  bucket: R2Bucket,
  sealPort: SealPort,
  ingested: string[],
): SealingDependencies {
  return {
    sealPort,
    bucket,
    bucketName: "firm-bucket",
    ingest: async (_name, key) => {
      ingested.push(key);
    },
    firmName: "Smith and Partners",
    now: () => "2026-11-17T00:00:00.000Z",
  };
}

function recordingSealPort(): { port: SealPort; requests: SealRequest[] } {
  const requests: SealRequest[] = [];
  return {
    requests,
    port: {
      async seal(request) {
        requests.push(request);
        return {
          sealedPdf: new TextEncoder().encode("%PDF sealed"),
          documentHashSha256: "c".repeat(64),
          certificate: {
            documentHashSha256: "c".repeat(64),
            reference: "MC-CCCC-CCCC-CCCC",
            sealedAt: request.signingTime,
            signers: request.signers,
          },
          certificateText: "CERTIFICATE OF COMPLETION",
          certificatePdf: new TextEncoder().encode("%PDF certificate"),
        };
      },
    },
  };
}

describe("sealing a completed signing request", () => {
  it("draws what each signer gave, files the signed copy and its certificate, and seals once", async () => {
    const database = setup();
    const { bucket, objects } = memoryBucket();
    objects.set(SENT_KEY, DOCUMENT);
    const id = await completedRequest(database, objects);
    const { port, requests } = recordingSealPort();
    const ingested: string[] = [];

    const outcome = await sealCompletedRequest(database, id, dependencies(bucket, port, ingested));
    expect(outcome.kind).toBe("sealed");
    const sent = requests[0];
    if (sent === undefined) throw new Error("the sealing service was asked");
    expect(sent.document).toEqual(DOCUMENT);
    // Two signers' signatures, each sent once although the client's fills two boxes.
    expect(sent.markPictures).toHaveLength(2);
    const kinds = (sent.marks ?? []).map((mark) => mark.content.kind).sort();
    expect(kinds).toEqual(["check", "picture", "picture", "picture", "text", "text"]);
    const texts = (sent.marks ?? []).flatMap((mark) =>
      mark.content.kind === "text" ? [mark.content.text] : [],
    );
    // Signed at 23:30 UTC on the 16th, which is still the 16th in the office's zone.
    expect(texts).toEqual(expect.arrayContaining(["November 16, 2026", "Casey Colleague"]));
    expect(sent.signers.map((signer) => signer.intent.name)).toEqual([
      "Jordan Smith",
      "Casey Colleague",
    ]);
    expect(sent.signers[0]?.attribution.observedIp).toBe("203.0.113.7");
    expect(sent.envelope?.contact?.name).toBe("Smith and Partners");
    expect(sent.signatureImages?.[0]?.pages).toEqual([1, 2]);

    const detail = await readRequestDetail(database, id);
    if (outcome.kind !== "sealed") throw new Error("sealed");
    expect(detail?.request.sealedAt).not.toBeNull();
    expect(detail?.request.signedFileVersionId).toBe(outcome.signedVersionId);
    expect(detail?.request.certificateFileId).toBe(outcome.certificateFileId);
    expect(detail?.events.some((one) => one.kind === "sealed")).toBe(true);
    // Both copies were written to the bucket and handed to the ingest.
    expect(ingested).toHaveLength(2);
    for (const key of ingested) expect(objects.has(key)).toBe(true);

    // A second delivery finds it sealed and does nothing.
    expect(
      (await sealCompletedRequest(database, id, dependencies(bucket, port, ingested))).kind,
    ).toBe("skipped");
    expect(requests).toHaveLength(1);
  });

  it("does not seal a document whose bytes changed since it was sent", async () => {
    const database = setup();
    const { bucket, objects } = memoryBucket();
    objects.set(SENT_KEY, DOCUMENT);
    const id = await completedRequest(database, objects);
    objects.set(SENT_KEY, new TextEncoder().encode("%PDF-1.7 something else"));
    const { port, requests } = recordingSealPort();
    const outcome = await sealCompletedRequest(database, id, dependencies(bucket, port, []));
    expect(outcome.kind).toBe("document-changed");
    expect(requests).toHaveLength(0);
    expect((await readRequestDetail(database, id))?.request.sealedAt).toBeNull();
  });

  it("names the certificate after the document, writes dates in the office's zone, and knows what the fonts draw", () => {
    expect(certificateFileName("Agreement.pdf")).toBe("Agreement - Certificate of Completion.pdf");
    expect(signedDate("2026-11-17T03:00:00.000Z", "America/Los_Angeles")).toBe("November 16, 2026");
    expect(signedDate("2026-11-17T03:00:00.000Z", "UTC")).toBe("November 17, 2026");
    expect([..."Zoë Müller – €5"].every(isWindows1252)).toBe(true);
    expect(isWindows1252("中")).toBe(false);
  });
});

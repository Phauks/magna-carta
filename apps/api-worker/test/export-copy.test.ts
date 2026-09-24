import { env, SELF } from "cloudflare:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { beforeAll, describe, expect, it } from "vitest";
import {
  EXPORT_COPY_REQUESTED_TOPIC,
  handleExportCopyRequested,
} from "../src/exports/export-copy-consumer.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The copy that leaves the platform. A `.docx` version the editor cut keeps its tracked changes in
// the stored bytes; every download is served from the version's export copy, with every change
// accepted. Driven end to end over the real bindings: the queue handler makes the copy, the
// per-file download and every bulk lane read it, and a copy not yet made is made on the spot.

let firmId: FirmId;
let matterId: MatterId;
let ownerCookie: string;
let ownerUserId: UserId;

const ISO = "2026-09-24T00:00:00.000Z";
const WORD = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const AUTHOR = 'w:id="1" w:author="Ana" w:date="2026-09-24T10:00:00Z"';

function docx(body: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${WORD}><w:body>${body}</w:body></w:document>`,
    ),
  });
}

const RECORDING_BODY =
  '<w:p><w:r><w:t xml:space="preserve">The court </w:t></w:r>' +
  `<w:ins ${AUTHOR}><w:r><w:t xml:space="preserve">hereby </w:t></w:r></w:ins>` +
  `<w:del ${AUTHOR}><w:r><w:delText xml:space="preserve">never </w:delText></w:r></w:del>` +
  "<w:r><w:t>orders.</w:t></w:r></w:p>";
const PLAIN_BODY = "<w:p><w:r><w:t>Nothing recorded.</w:t></w:r></w:p>";

function documentXmlOf(bytes: Uint8Array): string {
  const part = unzipSync(bytes)["word/document.xml"];
  if (part === undefined) throw new Error("no document part");
  return new TextDecoder().decode(part);
}

interface SeedOptions {
  /** Null seeds an upload; a kind seeds a version the editor cut, marked as owing its copy. */
  readonly saveKind: "explicit" | null;
}

async function seedVersion(
  name: string,
  bytes: Uint8Array,
  options: SeedOptions,
): Promise<{ fileId: FileId; versionId: FileVersionId; r2Key: string }> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  await firmDatabase
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
    )
    .bind(fileId, matterId, name, ISO)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, save_kind, export_copy_state) " +
        "VALUES (?1, ?2, 1, ?3, ?4, NULL, NULL, ?5, 'clean', ?6, ?7, ?7, ?8, ?9)",
    )
    .bind(
      versionId,
      fileId,
      r2Key,
      bytes.byteLength,
      `hash-${versionId}`,
      ownerUserId,
      ISO,
      options.saveKind,
      options.saveKind === null ? null : "pending",
    )
    .run();
  await firmDatabase
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(r2Key, bytes, {
    httpMetadata: {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  });
  return { fileId, versionId, r2Key };
}

async function versionRow(versionId: FileVersionId) {
  const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      "SELECT export_copy_state, export_r2_key, export_size_bytes FROM file_version WHERE id = ?1",
    )
    .bind(versionId)
    .all<{
      export_copy_state: string | null;
      export_r2_key: string | null;
      export_size_bytes: number | null;
    }>();
  return results[0];
}

async function runHandler(fileId: FileId, versionId: FileVersionId): Promise<void> {
  await handleExportCopyRequested(
    env,
    firmDatabaseFor(env.FIRM_DATABASE, firmId),
    {
      id: crypto.randomUUID(),
      firmId,
      topic: EXPORT_COPY_REQUESTED_TOPIC,
      payload: JSON.stringify({ fileId, versionId }),
      aggregateKey: null,
      seq: null,
    },
    createWorkersLogger(env.TELEMETRY),
  );
}

async function downloadAudit(versionId: FileVersionId): Promise<Record<string, unknown>> {
  const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      "SELECT metadata FROM audit_log WHERE event = 'file.downloaded' AND subject_id = ?1 ORDER BY created_at DESC",
    )
    .bind(versionId)
    .all<{ metadata: string }>();
  return JSON.parse(results[0]?.metadata ?? "{}") as Record<string, unknown>;
}

function download(fileId: FileId): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/files/${fileId}/download`, {
    headers: { cookie: ownerCookie, origin: "https://example.com" },
    redirect: "manual",
  });
}

function bulk(fileIds: readonly FileId[]): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/downloads/zip", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ matterId, fileIds }),
    redirect: "manual",
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Export Copy Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();
  const owner = await seedCredentialedUser("export-copy-owner@example.com", {
    userName: "Export Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Export Owner", firmId);
  ownerCookie = await signInForSessionCookie("export-copy-owner@example.com");
  matterId = newIdentifier("matter");
  await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Export Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, owner.userId, ISO)
    .run();
});

describe("the export copy — the queue handler", () => {
  it("makes the copy with every change accepted, stamps it, records it, and is idempotent", async () => {
    const { fileId, versionId, r2Key } = await seedVersion("brief.docx", docx(RECORDING_BODY), {
      saveKind: "explicit",
    });
    await runHandler(fileId, versionId);

    const row = await versionRow(versionId);
    expect(row?.export_copy_state).toBe("ready");
    expect(row?.export_r2_key).toBe(`${r2Key}.accepted`);
    const copy = await env.R2.get(`${r2Key}.accepted`);
    expect(copy).not.toBeNull();
    expect(copy?.customMetadata?.object_class).toBe("export-copy");
    expect(row?.export_size_bytes).toBe(copy?.size);
    const text = documentXmlOf(new Uint8Array(await (copy as R2ObjectBody).arrayBuffer()));
    expect(text).toContain("hereby ");
    expect(text).not.toContain("never ");
    expect(text).not.toMatch(/<w:(ins|del)\b/);
    // The stored version is untouched.
    const stored = await env.R2.get(r2Key);
    expect(documentXmlOf(new Uint8Array(await (stored as R2ObjectBody).arrayBuffer()))).toContain(
      "<w:del ",
    );

    // Meeting the same version again (the relay's backstop) remakes nothing.
    const uploadedAt = copy?.uploaded.toISOString();
    await runHandler(fileId, versionId);
    expect((await env.R2.get(`${r2Key}.accepted`))?.uploaded.toISOString()).toBe(uploadedAt);
  });

  it("a version that recorded nothing is ready at its own key, with no second object", async () => {
    const { fileId, versionId, r2Key } = await seedVersion("plain.docx", docx(PLAIN_BODY), {
      saveKind: "explicit",
    });
    await runHandler(fileId, versionId);
    const row = await versionRow(versionId);
    expect(row?.export_copy_state).toBe("ready");
    expect(row?.export_r2_key).toBe(r2Key);
    expect(await env.R2.get(`${r2Key}.accepted`)).toBeNull();
  });

  it("a version that needs no copy is left alone", async () => {
    const { fileId, versionId } = await seedVersion("upload.docx", docx(RECORDING_BODY), {
      saveKind: null,
    });
    await runHandler(fileId, versionId);
    const row = await versionRow(versionId);
    expect(row?.export_copy_state).toBeNull();
    expect(row?.export_r2_key).toBeNull();
  });

  it("a document the pass cannot read is recorded unavailable", async () => {
    const { fileId, versionId } = await seedVersion(
      "broken.docx",
      strToU8("not a package at all"),
      { saveKind: "explicit" },
    );
    await runHandler(fileId, versionId);
    const row = await versionRow(versionId);
    expect(row?.export_copy_state).toBe("unavailable");
    expect(row?.export_r2_key).toBeNull();
  });
});

describe("the export copy — the per-file download", () => {
  it("serves the copy once it exists, and the audit says so", async () => {
    const { fileId, versionId, r2Key } = await seedVersion("served.docx", docx(RECORDING_BODY), {
      saveKind: "explicit",
    });
    await runHandler(fileId, versionId);
    const response = await download(fileId);
    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toContain(`${r2Key}.accepted`);
    expect((await downloadAudit(versionId)).exportCopy).toBe("accepted");
  });

  it("makes a copy still pending on the spot rather than serving the marks", async () => {
    const { fileId, versionId, r2Key } = await seedVersion("fresh.docx", docx(RECORDING_BODY), {
      saveKind: "explicit",
    });
    const response = await download(fileId);
    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toContain(`${r2Key}.accepted`);
    expect((await versionRow(versionId))?.export_copy_state).toBe("ready");
    expect(await env.R2.get(`${r2Key}.accepted`)).not.toBeNull();
  });

  it("serves an upload as stored, and says nothing about a copy", async () => {
    const { fileId, versionId, r2Key } = await seedVersion("arrived.docx", docx(RECORDING_BODY), {
      saveKind: null,
    });
    const response = await download(fileId);
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain(r2Key);
    expect(location).not.toContain(".accepted");
    expect((await downloadAudit(versionId)).exportCopy).toBeUndefined();
  });

  it("serves a document no copy can be made for as stored, and the audit says so", async () => {
    const { fileId, versionId, r2Key } = await seedVersion(
      "unreadable.docx",
      strToU8("not a package at all"),
      { saveKind: "explicit" },
    );
    const response = await download(fileId);
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain(r2Key);
    expect(location).not.toContain(".accepted");
    expect((await downloadAudit(versionId)).exportCopy).toBe("unavailable");
  });
});

describe("the export copy — the bulk download", () => {
  it("redirects a single-file selection to the copy", async () => {
    const { fileId, r2Key } = await seedVersion("only.docx", docx(RECORDING_BODY), {
      saveKind: "explicit",
    });
    const response = await bulk([fileId]);
    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toContain(`${r2Key}.accepted`);
  });

  it("streams the copies into the inline archive, and counts them in the audit", async () => {
    const recording = await seedVersion("recording.docx", docx(RECORDING_BODY), {
      saveKind: "explicit",
    });
    const upload = await seedVersion("upload-two.docx", docx(RECORDING_BODY), {
      saveKind: null,
    });
    const response = await bulk([recording.fileId, upload.fileId]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const recordingEntry = archive["recording.docx"];
    const uploadEntry = archive["upload-two.docx"];
    if (recordingEntry === undefined || uploadEntry === undefined) {
      throw new Error(`archive holds ${Object.keys(archive).join(", ")}`);
    }
    expect(documentXmlOf(recordingEntry)).not.toMatch(/<w:(ins|del)\b/);
    expect(documentXmlOf(uploadEntry)).toContain("<w:del ");

    const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare(
        "SELECT metadata FROM audit_log WHERE event = 'files.bulkDownloaded' AND subject_id = ?1 ORDER BY created_at DESC",
      )
      .bind(matterId)
      .all<{ metadata: string }>();
    const metadata = JSON.parse(results[0]?.metadata ?? "{}") as Record<string, unknown>;
    expect(metadata.acceptedCopies).toBe(1);
    expect(metadata.unavailableCopies).toBe(0);
  });

  it("refuses a selection with more pending copies than one request will make", async () => {
    const seeded = await Promise.all(
      ["p1.docx", "p2.docx", "p3.docx", "p4.docx"].map((name) =>
        seedVersion(name, docx(RECORDING_BODY), { saveKind: "explicit" }),
      ),
    );
    const response = await bulk(seeded.map((version) => version.fileId));
    expect(response.status).toBe(409);
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toContain("export-copies-pending");
    // Nothing was made: the request declined before accepting any changes on the spot.
    for (const version of seeded) {
      expect((await versionRow(version.versionId))?.export_copy_state).toBe("pending");
    }
  });
});

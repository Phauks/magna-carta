import { env, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Extraction ACROSS FORMATS: the same route, the same request, over a tar, a 7z and a rar.
//
// A separate file from files-archive-extractions.test.ts on purpose. That one proves the extraction
// ceremony over a zip — the filing, the folder, the budget, the ingest gate — and it already spends
// most of the `expensive` rate-limit bucket, which the chokepoint keys per FIRM and the test pool
// keeps per test FILE. Adding these there made its last cases 429 rather than proving anything, so
// the format matrix seeds its own firm and gets its own budget.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;

const ISO = "2026-06-15T00:00:00.000Z";

function firmDatabase() {
  return firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
}

async function seedMatter(title: string): Promise<MatterId> {
  const matterId = newIdentifier("matter");
  await firmDatabase()
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)",
    )
    .bind(matterId, title, ownerUserId, ISO)
    .run();
  return matterId;
}

// A clean file whose committed bytes are supplied verbatim — the same seeding shape the sibling
// extraction and listing files use, with the sniffed type under the caller's control.
async function seedCleanFileWithBytes(
  matterId: MatterId,
  name: string,
  sniffedContentType: string | null,
  bytes: Uint8Array,
): Promise<{ fileId: FileId; versionId: FileVersionId; r2Key: string }> {
  const database = firmDatabase();
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
    )
    .bind(fileId, matterId, name, ISO)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', ?5, 'hash', 'clean', ?6, ?7, ?7)",
    )
    .bind(versionId, fileId, r2Key, bytes.byteLength, sniffedContentType, ownerUserId, ISO)
    .run();
  await database
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(r2Key, bytes);
  return { fileId, versionId, r2Key };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Archive Format Extraction Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();
  const owner = await seedCredentialedUser("format-extraction-owner@example.com", {
    userName: "Format Extraction Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Format Extraction Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("format-extraction-owner@example.com");
});

interface ExtractionBody {
  extracted: { path: string; fileId: string; versionId: string; name: string }[];
  refused: { path: string; reason: string }[];
}

interface FileRow {
  matter_id: string;
}

async function extract(fileId: string, body: { paths: string[] }): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/files/${fileId}/archive-extractions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
    },
    body: JSON.stringify(body),
  });
}

function fileRow(fileId: string): Promise<FileRow | null> {
  return firmDatabase()
    .prepare("SELECT matter_id FROM file WHERE id = ?1")
    .bind(fileId)
    .first<FileRow>();
}

// A minimal ustar tar, assembled here rather than committed: these tests are about the EXTRACTION
// route dispatching on the format it sniffed, and the tar walker itself is tested against real `tar`
// output in packages/file-manager/test/tar-listing.test.ts.
function tarOf(members: readonly { name: string; body: string }[]): Uint8Array {
  const BLOCK = 512;
  const encoder = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const member of members) {
    const body = encoder.encode(member.body);
    const header = new Uint8Array(BLOCK);
    header.set(encoder.encode(member.name), 0);
    header.set(encoder.encode("000644 \0"), 100);
    header.set(encoder.encode("000000 \0"), 108);
    header.set(encoder.encode("000000 \0"), 116);
    header.set(encoder.encode(`${body.byteLength.toString(8).padStart(11, "0")}\0`), 124);
    header.set(encoder.encode("00000000000\0"), 136);
    header.set(encoder.encode("0"), 156);
    header.set(encoder.encode("ustar\0" + "00"), 257);
    header.set(encoder.encode("        "), 148);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.set(encoder.encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(body.byteLength / BLOCK) * BLOCK);
    padded.set(body);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(BLOCK * 2));
  const total = blocks.reduce((bytes, block) => bytes + block.byteLength, 0);
  const archive = new Uint8Array(total);
  let at = 0;
  for (const block of blocks) {
    archive.set(block, at);
    at += block.byteLength;
  }
  return archive;
}

// `crates/seven-zip-core/tests/fixtures/mixed-members.7z`, inlined because the workerd pool cannot
// read the host source tree. Written by sevenz-rust2's own encoder — see that directory's README.
const MIXED_MEMBERS_SEVEN_ZIP_BASE64 =
  "N3q8ryccAAL8907l2wAAAAAAAAAvAAAAAAAAALEviJMBAARoZWxsbwABAAtjb250ZW50IG9mIGEAAQAcY29udGVudCBv" +
  "ZiBiLCB3aGljaCBpcyBsb25nZXIAAACBMweuT69tsr2bkI5avUFiFoDohHio+p5Z8gdDpTTT3TVOt3+RMj2g6ql6/7yE" +
  "R7ev9n7V+gREyTST9UZ4RF028W/J63xbu/5huuiTVWP8EnPpNJMaWfrBGwmWp29O2vSVd9TLA6MkVBdmCGj3Hi9vJ55b" +
  "2DR87lfoBYkKzRpf92sTQDKeG0SJOcBCqNJ8Afc4mHUtaa29EVTPBoWThsYXBjoBCYChCgFkGuBJAAcLAQABIwMBAQVd" +
  "AACAAAyA8woBJ4ZVUQAIDQEJCgEAAA==";

function base64Bytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

describe("POST /api/v1/files/{id}/archive-extractions, across formats", () => {
  it("takes a member out of a TAR — no decoder involved, straight onto the matter", async () => {
    const matterId = await seedMatter("Extraction Tar Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "production.tar",
      "application/x-tar",
      tarOf([
        { name: "readme.txt", body: "read me" },
        { name: "docs/brief.txt", body: "In the matter of Renee Chase" },
      ]),
    );

    const response = await extract(fileId, { paths: ["docs/brief.txt"] });
    expect(response.status).toBe(202);
    const body = (await response.json()) as ExtractionBody;
    expect(body.refused).toEqual([]);
    expect(body.extracted).toHaveLength(1);
    expect(body.extracted[0]?.name).toBe("brief.txt");

    const row = await fileRow(body.extracted[0]?.fileId ?? "");
    expect(row?.matter_id).toBe(matterId);
  });

  it("takes a member out of a 7z, decoding only the block it sits in", async () => {
    const matterId = await seedMatter("Extraction Seven Zip Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "exhibits.7z",
      "application/x-7z-compressed",
      base64Bytes(MIXED_MEMBERS_SEVEN_ZIP_BASE64),
    );

    const response = await extract(fileId, { paths: ["exhibits/a/deposition.txt"] });
    expect(response.status).toBe(202);
    const body = (await response.json()) as ExtractionBody;
    expect(body.refused).toEqual([]);
    expect(body.extracted).toHaveLength(1);
    expect(body.extracted[0]?.name).toBe("deposition.txt");
  });

  it("refuses a directory inside a 7z by name, and files nothing for it", async () => {
    const matterId = await seedMatter("Extraction Seven Zip Directory Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "exhibits.7z",
      "application/x-7z-compressed",
      base64Bytes(MIXED_MEMBERS_SEVEN_ZIP_BASE64),
    );

    const response = await extract(fileId, { paths: ["exhibits"] });
    expect(response.status).toBe(202);
    const body = (await response.json()) as ExtractionBody;
    expect(body.extracted).toEqual([]);
    expect(body.refused).toEqual([{ path: "exhibits", reason: "directory" }]);
  });

  it("refuses a RAR by naming the format rather than claiming it holds nothing", async () => {
    // Listing a rar works; unpacking one is not something this platform can do. The two are
    // different facts and the refusal says which.
    const matterId = await seedMatter("Extraction Rar Matter");
    const { fileId } = await seedCleanFileWithBytes(
      matterId,
      "bundle.rar",
      "application/vnd.rar",
      new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]),
    );

    const response = await extract(fileId, { paths: ["anything.txt"] });
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { type: string; detail: string };
    expect(problem.type).toContain("archive-unreadable");
    expect(problem.detail).toContain("rar");
  });
});

import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { FileId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { listCleanVersions, listFiles } from "../src/queries.ts";
import { freshDatabase, seedMatter } from "./support.ts";

// What the file listing and the version history report about a version's scan and its author. Both
// are projections over columns the row already held: scan_detail (open text, and on a flagged verdict
// the engine's own signature name) and uploaded_by (present since the baseline schema, selected by
// nothing until now).

const CREATED = "2026-01-01T00:00:00.000Z";

async function seedMember(
  database: BatchDatabase,
  userId: string,
  displayName: string,
): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)",
    )
    .bind(userId, displayName, CREATED)
    .run();
}

async function seedFile(
  database: BatchDatabase,
  matterId: MatterId,
  version: {
    readonly name?: string;
    readonly status?: "clean" | "pending" | "quarantined";
    readonly scanVerdict?: "unscanned" | "clean" | "flagged" | null;
    readonly scanDetail?: string | null;
    readonly uploadedBy?: string | null;
  } = {},
): Promise<{ fileId: FileId; versionId: string }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const status = version.status ?? "clean";
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) " +
        "VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
    )
    .bind(fileId, matterId, version.name ?? "a-document.pdf", CREATED)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, " +
        "content_sha256, status, scan_verdict, scan_detail, uploaded_by, created_at, committed_at, inline_playable, storage_class, " +
        "storage_encoding, artifact_role) VALUES (?1, ?2, 1, ?3, 2048, 'application/pdf', 'application/pdf', NULL, ?4, ?5, ?6, ?7, ?8, ?8, NULL, 'standard', 'full', 'original')",
    )
    .bind(
      versionId,
      fileId,
      `files/${fileId}/${versionId}`,
      status,
      version.scanVerdict ?? "clean",
      version.scanDetail ?? null,
      version.uploadedBy === undefined ? "user_a" : version.uploadedBy,
      CREATED,
    )
    .run();
  if (status === "clean") {
    await database
      .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
      .bind(fileId, versionId)
      .run();
  }
  return { fileId: fileId as FileId, versionId };
}

describe("the file listing reports a closed scan reason, never the engine's own words", () => {
  it("collapses a quarantined version's signature name to the one closed token", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    await seedFile(database, matterId, {
      status: "quarantined",
      scanVerdict: null,
      // What quarantineVersion persists for a malware quarantine: `scanDetail ?? reason`, and the
      // ingest pipeline passes the engine's signature as the detail.
      scanDetail: "Win.Trojan.Fake-1234",
    });

    const page = await listFiles(database, { matterId, includePendingAndQuarantined: true });

    const row = page.data[0];
    expect(row?.scanReason).toBe("scan-flagged");
    expect(row?.activeContent).toBe(false);
    // The superseded field still carries what the column holds, which is why it is superseded.
    expect(row?.quarantineReason).toBe("Win.Trojan.Fake-1234");
  });

  it("reports a gate refusal by its own token", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    await seedFile(database, matterId, {
      status: "quarantined",
      scanVerdict: null,
      scanDetail: "type-mismatch",
    });

    const page = await listFiles(database, { matterId, includePendingAndQuarantined: true });

    expect(page.data[0]?.scanReason).toBe("type-mismatch");
  });

  it("reports active content as a badge on a file that passed, not as a refusal", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    await seedFile(database, matterId, { scanVerdict: "clean", scanDetail: "active-content" });

    const page = await listFiles(database, { matterId });

    expect(page.data[0]?.scanReason).toBeNull();
    expect(page.data[0]?.activeContent).toBe(true);
  });

  it("says why an unscanned row was never looked at", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    await seedFile(database, matterId, { scanVerdict: "unscanned", scanDetail: "oversize" });

    const page = await listFiles(database, { matterId });

    expect(page.data[0]?.scanReason).toBe("oversize");
  });
});

describe("a version says who committed it", () => {
  it("resolves the committing member to a name in the same read", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId } = await seedFile(database, matterId, { uploadedBy: "user_a" });

    const versions = await listCleanVersions(database, fileId);
    const listing = await listFiles(database, { matterId });

    expect(versions.data[0]?.uploadedByUserId).toBe("user_a" as UserId);
    expect(versions.data[0]?.uploadedByDisplayName).toBe("A");
    expect(listing.data[0]?.uploadedByUserId).toBe("user_a" as UserId);
    expect(listing.data[0]?.uploadedByDisplayName).toBe("A");
  });

  it("keeps the identifier and drops the name when the member row is gone", async () => {
    // uploaded_by is deliberately not a foreign key, so a version committed by a member the firm has
    // since removed keeps its author reference and resolves to nobody. That is the distinction the
    // two separate nullable fields exist to preserve.
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId } = await seedFile(database, matterId, { uploadedBy: "user_departed" });

    const versions = await listCleanVersions(database, fileId);

    expect(versions.data[0]?.uploadedByUserId).toBe("user_departed" as UserId);
    expect(versions.data[0]?.uploadedByDisplayName).toBeNull();
  });

  it("reports both as absent for a version no member produced", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId } = await seedFile(database, matterId, { uploadedBy: null });

    const versions = await listCleanVersions(database, fileId);

    expect(versions.data[0]?.uploadedByUserId).toBeNull();
    expect(versions.data[0]?.uploadedByDisplayName).toBeNull();
  });

  it("does not drop a version whose author cannot be resolved", async () => {
    // The join has to be LEFT: an INNER join here would make an erased or removed member's uploads
    // vanish from the history, which is the opposite of what a custody ledger is for.
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    await seedMember(database, "user_second", "Second Member");
    const { fileId } = await seedFile(database, matterId, { uploadedBy: "user_ghost" });

    const versions = await listCleanVersions(database, fileId);
    const listing = await listFiles(database, { matterId });

    expect(versions.data).toHaveLength(1);
    expect(listing.data).toHaveLength(1);
  });
});

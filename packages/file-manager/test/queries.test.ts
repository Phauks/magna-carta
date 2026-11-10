import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  insertIndexSplitMemberStatement,
  insertIndexSplitStatement,
} from "@magna-carta/data-access/index-split-statements";
import type { FileId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import { freshDatabase, seedMatter } from "./support.ts";
import {
  getCurrentVersionForIntegrity,
  getFileSummary,
  getVersionForIntegrity,
  listCleanVersions,
  listQuotableIndexedVersions,
  listVersionScanEvents,
  listVersionsMissingFromSearchIndex,
  readSearchIndexCoverage,
} from "../src/queries.ts";

async function seedFileWithCleanVersion(
  database: BatchDatabase,
  matterId: string,
  overrides: {
    contentSha256?: string | null;
    r2Key?: string;
    sizeBytes?: number | null;
  } = {},
): Promise<{ fileId: FileId; versionId: string }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = overrides.r2Key ?? `files/${fileId}/${versionId}`;
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'f', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(fileId, matterId)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', 'application/octet-stream', ?5, 'clean', 'user_a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'standard', 'full', 'original')",
    )
    .bind(
      versionId,
      fileId,
      r2Key,
      overrides.sizeBytes !== undefined ? overrides.sizeBytes : 2048,
      overrides.contentSha256 !== undefined ? overrides.contentSha256 : null,
    )
    .run();
  await database
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  return { fileId: fileId as FileId, versionId };
}

async function seedFileWithPendingVersionOnly(
  database: BatchDatabase,
  matterId: string,
): Promise<FileId> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await database
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'f', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(fileId, matterId)
    .run();
  await database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) VALUES (?1, ?2, 1, ?3, 1024, 'application/octet-stream', 'application/octet-stream', NULL, 'pending', 'user_a', '2026-01-01T00:00:00.000Z', NULL, NULL, 'standard', 'full', 'original')",
    )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`)
    .run();
  // current_version_id remains NULL — a pending-only file has no committed version
  return fileId as FileId;
}

describe("getCurrentVersionForIntegrity", () => {
  it("returns the r2Key, sizeBytes, and contentSha256 for a committed clean version", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const sha256 = "abc123deadbeef0000000000000000000000000000000000000000000000cafe";
    const { fileId, versionId } = await seedFileWithCleanVersion(database, matterId, {
      contentSha256: sha256,
      r2Key: "files/thefile/theversion",
      sizeBytes: 4096,
    });
    const result = await getCurrentVersionForIntegrity(database, fileId);
    expect(result).toEqual({
      id: versionId,
      r2Key: "files/thefile/theversion",
      sizeBytes: 4096,
      contentSha256: sha256,
    });
  });

  it("returns undefined for a file with only a pending version", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const fileId = await seedFileWithPendingVersionOnly(database, matterId);
    expect(await getCurrentVersionForIntegrity(database, fileId)).toBeUndefined();
  });
});

describe("who uploaded a file, as the list and the history carry it", () => {
  it("names the uploader off the member row, and keeps the id when the member row is gone", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await seedFileWithCleanVersion(database, matterId);
    // The seed writes the version as user_a, a member the matter seed has already named.
    const named = await getFileSummary(database, fileId);
    expect(named).toMatchObject({ uploadedBy: "user_a", uploadedByName: "A" });
    const history = await listCleanVersions(database, fileId);
    expect(
      history.data.map((version) => [version.id, version.uploadedBy, version.uploadedByName]),
    ).toEqual([[versionId, "user_a", "A"]]);

    // An upload by somebody the firm has no member row for — a member who has since left, or an
    // id written before the roster was mirrored. The upload fact outlives the member row: the id
    // stays on the version and only the name is absent — never dropped, never a stand-in.
    await database
      .prepare("UPDATE file_version SET uploaded_by = 'user_departed' WHERE id = ?1")
      .bind(versionId)
      .run();
    const departed = await getFileSummary(database, fileId);
    expect(departed).toMatchObject({ uploadedBy: "user_departed", uploadedByName: null });
  });
});

describe("one named version's integrity baseline", () => {
  it("resolves a committed version of the file, and nothing for another file's version", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const first = await seedFileWithCleanVersion(database, matterId, { contentSha256: "abc" });
    const other = await seedFileWithCleanVersion(database, matterId, { contentSha256: "def" });
    const named = await getVersionForIntegrity(
      database,
      first.fileId,
      first.versionId as Parameters<typeof getVersionForIntegrity>[2],
    );
    expect(named).toMatchObject({ id: first.versionId, contentSha256: "abc" });
    // Scoped by BOTH ids: a version id that belongs to another file resolves nothing, so a caller
    // can never verify (or re-scan) a version through a file it does not name.
    expect(
      await getVersionForIntegrity(
        database,
        first.fileId,
        other.versionId as Parameters<typeof getVersionForIntegrity>[2],
      ),
    ).toBeUndefined();
  });
});

describe("a file's scan history", () => {
  it("reads every scan event against the file's versions, newest first, with the facts each recorded", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await seedFileWithCleanVersion(database, matterId);
    const insert = (id: string, event: string, at: string, metadata: string | null) =>
      database
        .prepare(
          "INSERT INTO audit_log (id, event, actor_user_id, subject_id, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(
          id,
          event,
          event === "file.rescan_requested" ? "user_a" : null,
          versionId,
          metadata,
          at,
        )
        .run();
    await insert(
      "a1",
      "file.version_committed",
      "2026-01-01T00:00:00.000Z",
      JSON.stringify({ scanVerdict: "clean", scanEngineVersion: "clamav/1.0", scanDetail: null }),
    );
    // The request's own metadata, as the route writes it: whether it reached the queue, and the
    // engine that stood for the firm when it was asked.
    await insert(
      "a2",
      "file.rescan_requested",
      "2026-01-02T00:00:00.000Z",
      JSON.stringify({ enqueued: false, currentEngineVersion: "clamav/1.5" }),
    );
    await insert(
      "a3",
      "file.version_rescanned",
      "2026-01-02T00:00:01.000Z",
      JSON.stringify({
        scanVerdict: "flagged",
        scanEngineVersion: "clamav/2.0",
        scanDetail: "Eicar-Test-Signature",
        requestId: "a2",
      }),
    );
    // An unrelated event against the same version is not a scan and stays out of the history.
    await insert("a4", "file.renamed", "2026-01-03T00:00:00.000Z", null);

    const history = await listVersionScanEvents(database, fileId);
    expect(
      history.map((event) => [event.id, event.event, event.scanVerdict, event.scanEngineVersion]),
    ).toEqual([
      ["a3", "file.version_rescanned", "flagged", "clamav/2.0"],
      // A request records the engine under its own key, and it reads back in the same field: the
      // engine on this line is what decided whether a check could be queued at all.
      ["a2", "file.rescan_requested", null, "clamav/1.5"],
      ["a1", "file.version_committed", "clean", "clamav/1.0"],
    ]);
    expect(history[0]).toMatchObject({ versionNumber: 1, scanDetail: "Eicar-Test-Signature" });
    // The request names who asked, resolved off the member row, and says it never reached the
    // queue — without which the line reads as a check on its way that was never going to run.
    expect(history[1]).toMatchObject({ actorUserId: "user_a", actorName: "A", queued: false });
    // A scan row records nothing about queuing, and must never be read as a failure to queue.
    expect(history[0]?.queued).toBeNull();
    expect(history[2]?.queued).toBeNull();
  });
});

// A live row of the file contents index's catalog, for one document version or for a merged split.
function split(
  database: BatchDatabase,
  row: { id: string; corpusId: string; documentId: string | null; version: number | null },
) {
  return insertIndexSplitStatement(database, {
    id: row.id as IndexSplitId,
    matterId: "matter_a" as MatterId,
    corpusKind: "matter",
    corpusId: row.corpusId,
    documentId: row.documentId as FileId | null,
    version: row.version,
    objectKey: `search/${row.id}`,
    documentCount: 1,
    sizeBytes: 1,
    schemaGeneration: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
  }).run();
}

describe("which version of a file a search result may quote", () => {
  it("answers the version the index holds, as its own split or inside a merged one", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const own = await seedFileWithCleanVersion(database, matterId);
    const merged = await seedFileWithCleanVersion(database, matterId);
    const unindexed = await seedFileWithCleanVersion(database, matterId);
    await split(database, {
      id: "split_own",
      corpusId: matterId,
      documentId: own.fileId,
      version: 1,
    });
    await split(database, {
      id: "split_merged",
      corpusId: matterId,
      documentId: null,
      version: null,
    });
    await insertIndexSplitMemberStatement(database, {
      splitId: "split_merged" as IndexSplitId,
      documentId: merged.fileId,
      version: 1,
    }).run();

    const versions = await listQuotableIndexedVersions(database, matterId, [
      own.fileId,
      merged.fileId,
      unindexed.fileId,
    ]);

    expect([...versions]).toEqual(
      expect.arrayContaining([
        [own.fileId, 1],
        [merged.fileId, 1],
      ]),
    );
    expect(versions.has(unindexed.fileId)).toBe(false);
    expect(await listQuotableIndexedVersions(database, matterId, [])).toEqual(new Map());
  });

  it("answers nothing for a deleted file, another matter's file, or a version that is not clean", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const deleted = await seedFileWithCleanVersion(database, matterId);
    const withdrawn = await seedFileWithCleanVersion(database, matterId);
    const elsewhere = await seedFileWithCleanVersion(database, matterId);
    const superseded = await seedFileWithCleanVersion(database, matterId);
    await Promise.all(
      [deleted, withdrawn, elsewhere].map((file, index) =>
        split(database, {
          id: `split_${index}`,
          corpusId: matterId,
          documentId: file.fileId,
          version: 1,
        }),
      ),
    );
    await database
      .prepare("UPDATE file SET deleted_at = '2026-02-01T00:00:00.000Z' WHERE id = ?1")
      .bind(deleted.fileId)
      .run();
    await database
      .prepare("UPDATE file_version SET status = 'quarantined' WHERE file_id = ?1")
      .bind(withdrawn.fileId)
      .run();
    // A split that a merge has replaced is not what the index holds any more.
    await split(database, {
      id: "split_old",
      corpusId: matterId,
      documentId: superseded.fileId,
      version: 1,
    });
    await database
      .prepare(
        "UPDATE index_split SET superseded_at = '2026-02-01T00:00:00.000Z' WHERE id = 'split_old'",
      )
      .run();

    const all = [deleted.fileId, withdrawn.fileId, elsewhere.fileId, superseded.fileId];
    // The index's rows are this matter's; the question names another. The file is not filed there.
    expect(await listQuotableIndexedVersions(database, "matter_b" as MatterId, all)).toEqual(
      new Map(),
    );
    expect([...(await listQuotableIndexedVersions(database, matterId, all))]).toEqual([
      [elsewhere.fileId, 1],
    ]);
  });
});

describe("how much of a firm's files the file contents index holds", () => {
  // Five files that belong in the index: one held as its own split, one held inside a merged split,
  // one never indexed, one whose only split a merge retired without carrying it, and one whose
  // membership a re-index superseded.
  async function seedCoverage() {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const own = await seedFileWithCleanVersion(database, matterId);
    const merged = await seedFileWithCleanVersion(database, matterId);
    const never = await seedFileWithCleanVersion(database, matterId);
    const retired = await seedFileWithCleanVersion(database, matterId);
    const stale = await seedFileWithCleanVersion(database, matterId);
    await split(database, {
      id: "split_own",
      corpusId: matterId,
      documentId: own.fileId,
      version: 1,
    });
    await split(database, {
      id: "split_merged",
      corpusId: matterId,
      documentId: null,
      version: null,
    });
    await split(database, {
      id: "split_retired",
      corpusId: matterId,
      documentId: retired.fileId,
      version: 1,
    });
    await database
      .prepare(
        "UPDATE index_split SET superseded_at = '2026-02-01T00:00:00.000Z' WHERE id = 'split_retired'",
      )
      .run();
    await insertIndexSplitMemberStatement(database, {
      splitId: "split_merged" as IndexSplitId,
      documentId: merged.fileId,
      version: 1,
    }).run();
    await insertIndexSplitMemberStatement(database, {
      splitId: "split_merged" as IndexSplitId,
      documentId: stale.fileId,
      version: 1,
    }).run();
    await database
      .prepare(
        "UPDATE index_split_member SET superseded_at = '2026-02-01T00:00:00.000Z' WHERE document_id = ?1",
      )
      .bind(stale.fileId)
      .run();
    return { database, matterId, own, merged, never, retired, stale };
  }

  it("counts a version held as its own split or inside a merged one, and no other", async () => {
    const { database } = await seedCoverage();
    expect(await readSearchIndexCoverage(database)).toEqual({
      belonging: 5,
      held: 2,
      lastIndexedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("leaves out what does not belong in the index at all", async () => {
    const { database, matterId, own } = await seedCoverage();
    await seedFileWithPendingVersionOnly(database, matterId);
    const quarantined = await seedFileWithCleanVersion(database, matterId);
    await database
      .prepare("UPDATE file_version SET status = 'quarantined' WHERE file_id = ?1")
      .bind(quarantined.fileId)
      .run();
    // A deleted file leaves both numbers, whatever the catalog still holds for it.
    await database
      .prepare("UPDATE file SET deleted_at = '2026-02-01T00:00:00.000Z' WHERE id = ?1")
      .bind(own.fileId)
      .run();
    expect(await readSearchIndexCoverage(database)).toMatchObject({ belonging: 4, held: 1 });
  });

  it("answers an empty firm with nothing, and no time of a last file", async () => {
    expect(await readSearchIndexCoverage(freshDatabase())).toEqual({
      belonging: 0,
      held: 0,
      lastIndexedAt: null,
    });
  });

  it("finds for indexing exactly the versions the count calls not held", async () => {
    const { database, never, retired, stale, own, merged } = await seedCoverage();
    const missing = (await listVersionsMissingFromSearchIndex(database, 50)).map(
      (candidate) => candidate.versionId,
    );
    expect(missing.toSorted()).toEqual(
      [never.versionId, retired.versionId, stale.versionId].toSorted(),
    );
    // A version a merged split holds is not sent to be indexed again.
    expect(missing).not.toContain(merged.versionId);
    expect(missing).not.toContain(own.versionId);
    const coverage = await readSearchIndexCoverage(database);
    expect(coverage.belonging - coverage.held).toBe(missing.length);
  });
});

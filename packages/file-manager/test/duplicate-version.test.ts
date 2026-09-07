import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { FileVersionId, FolderId, MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { commitVersion, duplicateVersionIntoMatter, initiateUpload } from "../src/file-service.ts";
import { findCurrentVersionsByContent, getFileSummary } from "../src/queries.ts";
import { ACTOR, freshDatabase, now, options, seedMatter } from "./support.ts";

/*
 * The upload dialog hashes a file before sending it and asks whether the firm already holds those
 * bytes. What that rests on is pinned here: the lookup answers only live files whose CURRENT version
 * is those bytes and that size, and a duplicate made from a held version is a real file on the
 * target matter with the bytes copied server-side and the gate's verdict carried across.
 */

const HASH = "a".repeat(64);

async function landClean(
  database: ReturnType<typeof freshDatabase>,
  matterId: string,
  name: string,
  hash = HASH,
  sizeBytes = 1024,
) {
  const initiated = await initiateUpload(
    database,
    {
      matterId: matterId as MatterId,
      name,
      declaredSize: sizeBytes,
      declaredContentType: "application/pdf",
      uploadedBy: ACTOR,
      mode: "put",
    },
    options,
  );
  await commitEffectBatch(database, initiated.effect, { now });
  const committed = await commitVersion(
    database,
    {
      versionId: initiated.versionId,
      sizeBytes,
      sniffedContentType: "application/pdf",
      contentSha256: hash,
      scanVerdict: "clean",
      scanEngineVersion: "engine-9",
      scanDetail: null,
      now: now(),
    },
    options,
  );
  await commitEffectBatch(database, committed.effect, { now });
  return initiated;
}

async function seedSecondMatter(database: ReturnType<typeof freshDatabase>): Promise<MatterId> {
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES ('matter_b', 'N', NULL, 'open', NULL, NULL, 'user_a', NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .run();
  return "matter_b" as MatterId;
}

describe("findCurrentVersionsByContent", () => {
  it("answers the live files whose current version is exactly these bytes, on any matter", async () => {
    const database = freshDatabase();
    const matterA = await seedMatter(database);
    const matterB = await seedSecondMatter(database);
    const onA = await landClean(database, matterA, "brief.pdf");
    const onB = await landClean(database, matterB, "brief copy.pdf");
    await landClean(database, matterA, "other.pdf", "b".repeat(64));

    const matches = await findCurrentVersionsByContent(database, HASH, 1024);
    expect(matches.map((match) => match.fileId).toSorted()).toEqual(
      [onA.fileId, onB.fileId].toSorted(),
    );
    expect(matches.find((match) => match.fileId === onB.fileId)).toMatchObject({
      matterId: matterB,
      name: "brief copy.pdf",
      versionId: onB.versionId,
    });
  });

  it("refuses a digest whose size disagrees, and a version that is no longer current", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const first = await landClean(database, matterId, "brief.pdf");
    expect(await findCurrentVersionsByContent(database, HASH, 999)).toEqual([]);

    // A second version on the same file supersedes the first: the old bytes are archived, not held.
    const second = await initiateUpload(
      database,
      {
        matterId,
        name: "brief.pdf",
        declaredSize: 2048,
        declaredContentType: "application/pdf",
        uploadedBy: ACTOR,
        mode: "put",
        fileId: first.fileId,
      },
      options,
    );
    await commitEffectBatch(database, second.effect, { now });
    const committed = await commitVersion(
      database,
      {
        versionId: second.versionId,
        sizeBytes: 2048,
        sniffedContentType: "application/pdf",
        contentSha256: "c".repeat(64),
        scanVerdict: "clean",
        scanEngineVersion: "engine-9",
        scanDetail: null,
        now: now(),
      },
      options,
    );
    await commitEffectBatch(database, committed.effect, { now });
    expect(await findCurrentVersionsByContent(database, HASH, 1024)).toEqual([]);
  });
});

describe("duplicateVersionIntoMatter", () => {
  it("makes a committed file on the target matter from the held bytes, copying the object and the verdict", async () => {
    const database = freshDatabase();
    const matterA = await seedMatter(database);
    const matterB = await seedSecondMatter(database);
    const source = await landClean(database, matterA, "brief.pdf");

    const copies: Array<[string, string, Record<string, string>]> = [];
    const made = await duplicateVersionIntoMatter(
      database,
      {
        sourceVersionId: source.versionId as FileVersionId,
        matterId: matterB,
        folderId: null,
        name: "brief.pdf",
        uploadedBy: ACTOR,
        sourceModifiedAt: "2025-03-04T09:30:00.000Z",
        createdAtBasis: "source",
      },
      options,
      async (fromKey, toKey, dimensions) => {
        copies.push([fromKey, toKey, { ...dimensions }]);
      },
    );
    await commitEffectBatch(database, made.effect, { now });

    expect(copies).toHaveLength(1);
    expect(copies[0]?.[0]).toBe(source.r2Key);
    expect(copies[0]?.[1]).toContain(made.fileId);
    // Stamped for the TARGET matter, not carried from the source.
    expect(copies[0]?.[2]).toMatchObject({ matter: matterB });

    const summary = await getFileSummary(database, made.fileId);
    expect(summary).toMatchObject({
      matterId: matterB,
      name: "brief.pdf",
      status: "clean",
      sizeBytes: 1024,
      scanVerdict: "clean",
      versionNumber: 1,
      createdAt: "2025-03-04T09:30:00.000Z",
      sourceModifiedAt: "2025-03-04T09:30:00.000Z",
    });
    // The new file now answers the same content lookup, on its own matter.
    const matches = await findCurrentVersionsByContent(database, HASH, 1024);
    expect(
      matches.some((match) => match.fileId === made.fileId && match.matterId === matterB),
    ).toBe(true);
  });

  it("refuses a version that is not committed, and a folder on another matter", async () => {
    const database = freshDatabase();
    const matterA = await seedMatter(database);
    const matterB = await seedSecondMatter(database);
    const source = await landClean(database, matterA, "brief.pdf");
    await expect(
      duplicateVersionIntoMatter(
        database,
        {
          sourceVersionId: "fileVersion_nope" as FileVersionId,
          matterId: matterB,
          name: "x.pdf",
          uploadedBy: ACTOR,
        },
        options,
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "version-not-clean" });

    await database
      .prepare(
        "INSERT INTO folder (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES ('folder_a', ?1, NULL, 'Discovery', ?2, ?2)",
      )
      .bind(matterA, now())
      .run();
    await expect(
      duplicateVersionIntoMatter(
        database,
        {
          sourceVersionId: source.versionId as FileVersionId,
          matterId: matterB,
          folderId: "folder_a" as FolderId,
          name: "x.pdf",
          uploadedBy: ACTOR,
        },
        options,
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "file-cross-matter" });
  });
});

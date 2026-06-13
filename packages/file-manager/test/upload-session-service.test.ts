import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UploadSessionId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  abortUploadSession,
  completeUploadSession,
  initiateUpload,
  loadUploadSession,
} from "../src/file-service.ts";
import { FileManagerValidationError } from "../src/validation.ts";
import { ACTOR, freshDatabase, now, options, seedMatter } from "./support.ts";

async function initiate(
  database: ReturnType<typeof freshDatabase>,
  matterId: string,
  mode: "put" | "multipart" = "put",
) {
  const result = await initiateUpload(
    database,
    {
      matterId: matterId as never,
      name: "brief.pdf",
      declaredSize: 1024,
      declaredContentType: "application/pdf",
      uploadedBy: ACTOR,
      mode,
    },
    options,
  );
  await commitEffectBatch(database, result.effect, { now });
  return result;
}

async function sessionStatus(
  database: ReturnType<typeof freshDatabase>,
  sessionId: string,
): Promise<string | undefined> {
  const { results } = await database
    .prepare("SELECT status FROM upload_session WHERE id = ?1")
    .bind(sessionId)
    .all<{ status: string }>();
  return results[0]?.status;
}

async function versionStatus(
  database: ReturnType<typeof freshDatabase>,
  versionId: string,
): Promise<string | undefined> {
  const { results } = await database
    .prepare("SELECT status FROM file_version WHERE id = ?1")
    .bind(versionId)
    .all<{ status: string }>();
  return results[0]?.status;
}

describe("loadUploadSession", () => {
  it("returns the open session joined to its version's r2 key", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { uploadSessionId, versionId, r2Key } = await initiate(database, matterId, "multipart");

    const record = await loadUploadSession(database, uploadSessionId as UploadSessionId);
    expect(record).toMatchObject({
      id: uploadSessionId,
      fileVersionId: versionId,
      mode: "multipart",
      status: "open",
      r2UploadId: null,
      r2Key,
    });
  });

  it("returns undefined for an unknown session", async () => {
    const database = freshDatabase();
    expect(await loadUploadSession(database, "upl_nope" as UploadSessionId)).toBeUndefined();
  });
});

describe("completeUploadSession", () => {
  it("flips an open session to completed, leaving the version pending for ingest", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { uploadSessionId, versionId } = await initiate(database, matterId);

    const result = await completeUploadSession(
      database,
      uploadSessionId as UploadSessionId,
      options,
    );
    await commitEffectBatch(database, result.effect, { now });

    expect(await sessionStatus(database, uploadSessionId)).toBe("completed");
    // The version stays pending: ingest (the queue consumer) commits or quarantines it.
    expect(await versionStatus(database, versionId)).toBe("pending");
  });

  it("refuses an unknown session", async () => {
    const database = freshDatabase();
    await expect(
      completeUploadSession(database, "upl_nope" as UploadSessionId, options),
    ).rejects.toThrow(FileManagerValidationError);
  });

  it("refuses a session that is not open", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { uploadSessionId } = await initiate(database, matterId);
    const first = await completeUploadSession(
      database,
      uploadSessionId as UploadSessionId,
      options,
    );
    await commitEffectBatch(database, first.effect, { now });

    await expect(
      completeUploadSession(database, uploadSessionId as UploadSessionId, options),
    ).rejects.toMatchObject({ code: "upload-session-not-open" });
  });
});

describe("abortUploadSession", () => {
  it("aborts an open session and abandons its pending version, returning the R2 coordinates", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { uploadSessionId, versionId, r2Key } = await initiate(database, matterId, "multipart");

    const result = await abortUploadSession(database, uploadSessionId as UploadSessionId, options);
    await commitEffectBatch(database, result.effect, { now });

    expect(result).toMatchObject({ mode: "multipart", r2Key, r2UploadId: null });
    expect(await sessionStatus(database, uploadSessionId)).toBe("aborted");
    expect(await versionStatus(database, versionId)).toBe("abandoned");
  });

  it("refuses a session that is not open", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { uploadSessionId } = await initiate(database, matterId);
    const aborted = await abortUploadSession(database, uploadSessionId as UploadSessionId, options);
    await commitEffectBatch(database, aborted.effect, { now });

    await expect(
      abortUploadSession(database, uploadSessionId as UploadSessionId, options),
    ).rejects.toMatchObject({ code: "upload-session-not-open" });
  });
});

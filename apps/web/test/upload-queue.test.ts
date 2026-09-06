import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { DroppedEntry } from "@magna-carta/design-system/dropzone";
import type { UploadOutcome, UploadRequest } from "$lib/file-manager/file-upload.ts";
import {
  dismissUploadBatch,
  matterUploadRevision,
  resetUploadQueueForTests,
  retryFailedUploads,
  startUploadBatch,
  uploadBatches,
  uploadsInFlight,
  type UploadBatchPlan,
  type UploadQueueDependencies,
} from "$lib/file-manager/upload-queue.svelte.ts";

/*
 * The queue is what keeps an upload alive after the dialog that started it has closed, so what it
 * promises is asserted here: a folder is made once however many files sit in it, a file lands under
 * the name the collision rules settle on, a failure names its stage, a finished batch bumps the
 * matter's revision so an open file list re-reads, and a retry sends only what failed.
 */

function entry(relativePath: string, name: string): DroppedEntry {
  return { file: new File(["bytes"], name, { lastModified: 1_700_000_000_000 }), relativePath };
}

function plan(entries: DroppedEntry[], over: Partial<UploadBatchPlan> = {}): UploadBatchPlan {
  return {
    matterId: "matter-1",
    matterTitle: "Pemberton v. Hale",
    destinationFolderId: "discovery",
    destinationLabel: "Discovery",
    entries,
    createdAtBasis: "source",
    documentTypeId: null,
    folders: [{ id: "discovery", parentFolderId: null, name: "Discovery" }],
    files: [
      {
        id: "existing",
        matterId: "matter-1",
        folderId: "discovery",
        name: "letter.pdf",
        documentTypeId: null,
        currentVersionId: "v1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        versionNumber: 1,
        sizeBytes: 10,
        sniffedContentType: "application/pdf",
        scanVerdict: "clean",
        status: "clean",
        quarantineReason: null,
        sourceModifiedAt: null,
      },
    ],
    ...over,
  };
}

interface Recorded {
  uploads: UploadRequest[];
  folders: { parentFolderId: string | null; name: string }[];
}

function dependencies(
  record: Recorded,
  outcomeFor: (request: UploadRequest) => UploadOutcome = () => ({
    kind: "committed",
    fileId: "file-new",
    versionId: "version-new",
  }),
): UploadQueueDependencies {
  let folderNumber = 0;
  return {
    fetchImpl: fetch,
    upload: async (request) => {
      record.uploads.push(request);
      request.onStage?.("uploading");
      return outcomeFor(request);
    },
    createFolder: async (input) => {
      record.folders.push({ parentFolderId: input.parentFolderId, name: input.name });
      folderNumber += 1;
      return { kind: "ok", value: { folderId: `made-${String(folderNumber)}` } };
    },
    now: () => "2026-09-06T12:00:00.000Z",
    newIdentifier: () => "key",
  };
}

async function settled(): Promise<void> {
  // The runner is a chain of awaited promises; a few turns of the microtask queue drain it.
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

afterEach(() => {
  resetUploadQueueForTests();
});

describe("startUploadBatch", () => {
  it("recreates a dropped folder once, level by level, and files each file inside it", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    const batch = startUploadBatch(
      plan([
        entry("Depositions/2024/smith.pdf", "smith.pdf"),
        entry("Depositions/2024/jones.pdf", "jones.pdf"),
        entry("Depositions/index.txt", "index.txt"),
      ]),
      dependencies(record),
    );
    await settled();
    expect(batch.running).toBe(false);
    expect(record.folders).toEqual([
      { parentFolderId: "discovery", name: "Depositions" },
      { parentFolderId: "made-1", name: "2024" },
    ]);
    const landed = new Map(record.uploads.map((request) => [request.file.name, request.folderId]));
    expect(landed.get("smith.pdf")).toBe("made-2");
    expect(landed.get("jones.pdf")).toBe("made-2");
    expect(landed.get("index.txt")).toBe("made-1");
  });

  it("lands a folder that already exists under the destination in the one that is there", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    startUploadBatch(
      plan([entry("Discovery/brief.pdf", "brief.pdf")], { destinationFolderId: null }),
      dependencies(record),
    );
    await settled();
    expect(record.folders).toEqual([]);
    expect(record.uploads[0]?.folderId).toBe("discovery");
  });

  it("files a colliding name as a copy rather than refusing it", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    startUploadBatch(plan([entry("", "letter.pdf")]), dependencies(record));
    await settled();
    expect(record.uploads[0]?.name).toBe("letter (2).pdf");
  });

  it("carries the dating and the document type the reader chose onto every reservation", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    startUploadBatch(
      plan([entry("", "a.pdf")], { createdAtBasis: "upload", documentTypeId: "type-9" }),
      dependencies(record),
    );
    await settled();
    expect(record.uploads[0]).toMatchObject({ createdAtBasis: "upload", documentTypeId: "type-9" });
  });

  it("names the stage a failure happened at, and bumps the matter's revision when it finishes", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    const before = matterUploadRevision("matter-1");
    const batch = startUploadBatch(
      plan([entry("", "a.pdf"), entry("", "b.pdf")]),
      dependencies(record, (request) =>
        request.file.name === "b.pdf"
          ? { kind: "problem", stage: "uploading", problem: { status: 403, errorId: "E-77" } }
          : { kind: "committed", fileId: "file-a", versionId: "v" },
      ),
    );
    await settled();
    flushSync();
    expect(batch.uploaded).toBe(1);
    expect(batch.failed).toBe(1);
    const failed = batch.items.find((item) => item.stage === "failed");
    expect(failed?.reason).toContain("failed while sending the bytes to storage");
    expect(failed?.reason).toContain("E-77");
    expect(matterUploadRevision("matter-1")).toBe(before + 1);
    expect(uploadsInFlight()).toBe(false);
  });

  it("a retry sends only what failed, into the same place", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    let failing = true;
    const batch = startUploadBatch(
      plan([entry("Depositions/a.pdf", "a.pdf"), entry("Depositions/b.pdf", "b.pdf")]),
      dependencies(record, (request) =>
        failing && request.file.name === "b.pdf"
          ? { kind: "transport", stage: "committing" }
          : { kind: "committed", fileId: `file-${request.file.name}`, versionId: "v" },
      ),
    );
    await settled();
    expect(batch.failed).toBe(1);
    failing = false;
    retryFailedUploads(batch);
    await settled();
    expect(batch.failed).toBe(0);
    expect(batch.uploaded).toBe(2);
    // Three sends in all: two the first time, one on the retry; one folder, made once.
    expect(record.uploads).toHaveLength(3);
    expect(record.folders).toHaveLength(1);
    expect(record.uploads[2]?.folderId).toBe("made-1");
  });

  it("lists batches newest first and lets a finished one be cleared, never a running one", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: UploadQueueDependencies = {
      ...dependencies(record),
      upload: async () => {
        await held;
        return { kind: "committed", fileId: "f", versionId: "v" };
      },
    };
    const first = startUploadBatch(plan([entry("", "a.pdf")]), dependencies(record));
    await settled();
    const second = startUploadBatch(plan([entry("", "b.pdf")]), slow);
    expect(uploadBatches().map((batch) => batch.id)).toEqual([second.id, first.id]);
    dismissUploadBatch(second);
    expect(uploadBatches()).toHaveLength(2);
    dismissUploadBatch(first);
    expect(uploadBatches().map((batch) => batch.id)).toEqual([second.id]);
    release();
    await settled();
    expect(second.running).toBe(false);
  });
});

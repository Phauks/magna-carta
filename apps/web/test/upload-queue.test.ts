import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { DroppedEntry } from "@magna-carta/design-system/dropzone";
import type { UploadOutcome, UploadRequest } from "$lib/file-manager/file-upload.ts";
import { intakeEntryKey, type NameClashChoice } from "$lib/file-manager/upload-intake.ts";
import {
  batchTallyText,
  cancelUploadBatch,
  dismissUploadBatch,
  unsentCount,
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
    documentTypeIds: new Map<string, string | null>(),
    nameClashDefault: "keep-both",
    nameClashChoices: new Map<string, NameClashChoice>(),
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
        uploadedBy: null,
        uploadedByName: null,
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
    digest: async () => null,
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
      plan([entry("", "a.pdf")], {
        createdAtBasis: "upload",
        documentTypeIds: new Map([[intakeEntryKey(entry("", "a.pdf")), "type-9"]]),
      }),
      dependencies(record),
    );
    await settled();
    expect(record.uploads[0]).toMatchObject({ createdAtBasis: "upload", documentTypeId: "type-9" });
  });

  it("carries a different document type per file, so one batch files as several kinds", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    const brief = entry("", "brief.pdf");
    const note = entry("", "note.txt");
    const untyped = entry("", "misc.bin");
    startUploadBatch(
      plan([brief, note, untyped], {
        documentTypeIds: new Map([
          [intakeEntryKey(brief), "type-pleading"],
          [intakeEntryKey(note), "type-correspondence"],
        ]),
      }),
      dependencies(record),
    );
    await settled();
    const filed = new Map(
      record.uploads.map((request) => [request.file.name, request.documentTypeId]),
    );
    expect(filed.get("brief.pdf")).toBe("type-pleading");
    expect(filed.get("note.txt")).toBe("type-correspondence");
    // A file the reader never classified carries none, which is the honest answer, not a default.
    expect(filed.get("misc.bin")).toBeNull();
  });

  it("always reads the file and hands the digest to the transfer; there is no setting that says otherwise", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    let reads = 0;
    let askedAgainst: string | undefined;
    const batch = startUploadBatch(plan([entry("", "a.pdf")]), {
      ...dependencies(record),
      digest: async (_chosen, options) => {
        reads += 1;
        askedAgainst = options.matterId;
        return "the-digest";
      },
    });
    await settled();
    expect(reads).toBe(1);
    // The firm is asked against the matter the batch is bound for.
    expect(askedAgainst).toBe("matter-1");
    expect(record.uploads[0]?.sha256).toBe("the-digest");
    expect(batch.items[0]?.stage).toBe("settled");
  });

  it("starts every file where the panel last showed it, so the press moves nothing in the Status column", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = entry("", "ready.pdf");
    const heldByFirm = entry("", "held.pdf");
    const reading = entry("", "reading.pdf");
    const chosen = entry("", "chosen.pdf");
    const batch = startUploadBatch(
      plan([ready, heldByFirm, reading, chosen], {
        readiness: new Map([
          [intakeEntryKey(ready), { stage: "ready" }],
          [intakeEntryKey(heldByFirm), { stage: "held" }],
          [intakeEntryKey(reading), { stage: "hashing", hashedBytes: 2 }],
          // A stage from an earlier batch is not readiness, and is not carried over.
          [intakeEntryKey(chosen), { stage: "failed", reason: "before" }],
        ]),
      }),
      {
        ...dependencies(record),
        // Nothing moves until released, so the starting stages can be read.
        digest: async () => {
          await held;
          return null;
        },
      },
    );
    flushSync();
    // The press has moved nothing: every item stands exactly where the panel showed it, and the
    // lanes carry on from there.
    expect(batch.items.map((item) => item.stage)).toEqual(["ready", "held", "hashing", "chosen"]);
    expect(batch.items[2]?.hashedBytes).toBe(2);
    expect(batch.inFlight).toBe(0);
    release();
    await settled();
    expect(batch.uploaded).toBe(4);
  });

  it("says what failed in one line on the item, and the whole account beside it", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    const batch = startUploadBatch(
      plan([entry("", "refused.pdf"), entry("", "silent.pdf"), entry("", "storage.pdf")]),
      dependencies(record, (request) => {
        if (request.file.name === "refused.pdf") {
          return {
            kind: "problem",
            stage: "reserving",
            problem: { status: 403, detail: "This matter is closed to uploads.", errorId: "E-1" },
          };
        }
        if (request.file.name === "silent.pdf") return { kind: "transport", stage: "committing" };
        return { kind: "transport", stage: "uploading" };
      }),
    );
    await settled();
    const byName = new Map(batch.items.map((item) => [item.name, item]));
    // The server's own detail is the line, where it gave one.
    expect(byName.get("refused.pdf")?.failure).toBe("This matter is closed to uploads.");
    expect(byName.get("refused.pdf")?.reason).toContain("E-1");
    // The class of transport fault is the line, where nothing answered.
    expect(byName.get("silent.pdf")?.failure).toBe("Couldn't connect while recording the upload");
    expect(byName.get("storage.pdf")?.failure).toBe("Couldn't reach the firm's storage");
    expect(byName.get("storage.pdf")?.reason).toContain("nothing was saved");
    // The line rides the progress the table reads.
    expect(batch.progress.get(intakeEntryKey(entry("", "refused.pdf")))?.failure).toBe(
      "This matter is closed to uploads.",
    );
  });

  it("names the storage as the thing that did not answer when the byte write gets nothing", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    const batch = startUploadBatch(
      plan([entry("", "a.pdf")]),
      dependencies(record, () => ({ kind: "transport", stage: "uploading" })),
    );
    await settled();
    const reason = batch.items[0]?.reason ?? "";
    // The bytes never go through the app, so the line has to say where the fault actually is —
    // "nothing answered" alone sent readers looking at their own connection.
    expect(reason).toContain("Couldn't reach the firm's storage");
    expect(reason).toContain("nothing was saved");
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

  it("counts bytes as they leave, and a cancel stops the rest without losing what landed", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sent = 0;
    const slow: UploadQueueDependencies = {
      ...dependencies(record),
      upload: async (request) => {
        sent += 1;
        request.onStage?.("uploading");
        request.onProgress?.(2, request.file.size);
        if (sent === 1) {
          // The first file is half-way when the reader cancels; it reports the cancel and stops.
          await held;
          return { kind: "cancelled", stage: "uploading" };
        }
        request.onProgress?.(request.file.size, request.file.size);
        return { kind: "committed", fileId: `file-${request.file.name}`, versionId: "v" };
      },
    };
    // Five files, three at a time: one holds, two land, two never start once cancelled.
    const batch = startUploadBatch(
      plan([
        entry("", "a.pdf"),
        entry("", "b.pdf"),
        entry("", "c.pdf"),
        entry("", "d.pdf"),
        entry("", "e.pdf"),
      ]),
      slow,
    );
    await settled();
    flushSync();
    expect(batch.totalBytes).toBe(25);
    // a is half-way (2 bytes), b and c have landed in full, d and e have followed b and c.
    expect(batch.sentBytes).toBeGreaterThanOrEqual(2 + 5 + 5);
    cancelUploadBatch(batch);
    release();
    await settled();
    flushSync();
    expect(batch.running).toBe(false);
    expect(batch.cancelled).toBe(true);
    expect(batch.items.find((item) => item.name === "a.pdf")?.stage).toBe("cancelled");
    expect(batch.uploaded).toBeGreaterThanOrEqual(2);
    expect(unsentCount(batch)).toBeGreaterThanOrEqual(1);
    // Sending the rest picks up exactly what did not go, and nothing that did.
    const landed = batch.uploaded;
    const before = sent;
    retryFailedUploads(batch);
    await settled();
    expect(batch.uploaded).toBe(5);
    expect(unsentCount(batch)).toBe(0);
    expect(sent - before).toBe(5 - landed);
  });

  it("hashes each file once, hands the digest to the transfer, and files a held file as its own copy", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    let hashed = 0;
    const withHash: UploadQueueDependencies = {
      ...dependencies(record, (request) =>
        request.file.name === "held.pdf"
          ? { kind: "committed", fileId: "held-copy", versionId: "v", copiedFrom: "matter" }
          : { kind: "committed", fileId: `file-${request.file.name}`, versionId: "v" },
      ),
      digest: async (chosen, options) => {
        hashed += 1;
        // The read reports as it goes, and the row reads it back as the share done.
        options.onProgress(Math.floor(chosen.file.size / 2));
        options.onProgress(chosen.file.size);
        return `${chosen.file.name}-digest`;
      },
    };
    const batch = startUploadBatch(plan([entry("", "held.pdf"), entry("", "new.pdf")]), withHash);
    await settled();
    flushSync();
    expect(hashed).toBe(2);
    expect(batch.progress.get(batch.items[0]!.key)?.hashedBytes).toBe(
      batch.items[0]!.entry.file.size,
    );
    expect(record.uploads.map((request) => request.sha256)).toEqual([
      "held.pdf-digest",
      "new.pdf-digest",
    ]);
    // Holding the bytes is a reason not to send them, never a reason not to file the chosen file:
    // the held one is a new file made server-side, counted as uploaded, and says where it came from.
    expect(batch.skipped).toBe(0);
    expect(batch.uploaded).toBe(2);
    expect(batch.items.find((item) => item.name === "held.pdf")).toMatchObject({
      stage: "settled",
      fileId: "held-copy",
      reason: "Made from a copy this matter already held. Nothing was sent.",
    });
    expect(batch.sentBytes).toBe(batch.totalBytes);
    expect(batchTallyText(batch)).toBe("2 of 2 uploaded");
  });

  it("files a taken name as a numbered copy by default, and never touches the file that has the name", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    // plan() seeds letter.pdf in the destination folder.
    const batch = startUploadBatch(plan([entry("", "letter.pdf")]), dependencies(record));
    await settled();
    expect(record.uploads.map((request) => [request.name, request.fileId])).toEqual([
      ["letter (2).pdf", undefined],
    ]);
    expect(batch.uploaded).toBe(1);
  });

  it("files a taken name as the next version of the file that has it, when the reader says so", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    const batch = startUploadBatch(
      plan([entry("", "letter.pdf")], { nameClashDefault: "new-version" }),
      { ...dependencies(record), digest: async () => "letter-digest" },
    );
    await settled();
    const request = record.uploads[0];
    expect(request?.name).toBe("letter.pdf");
    expect(request?.fileId).toBe("existing");
    // A new version is not asked about: the host's own hash check at ingest answers that.
    expect(request?.sha256).toBeNull();
    expect(batch.items[0]?.reason).toBe("Filed as a new version of letter.pdf.");
  });

  it("skips a taken name when the reader says so, reading nothing and sending nothing", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    let hashed = 0;
    const batch = startUploadBatch(
      plan([entry("", "letter.pdf"), entry("", "fresh.pdf")], { nameClashDefault: "skip" }),
      {
        ...dependencies(record),
        digest: async () => {
          hashed += 1;
          return null;
        },
      },
    );
    await settled();
    flushSync();
    expect(record.uploads.map((request) => request.name)).toEqual(["fresh.pdf"]);
    expect(hashed).toBe(1);
    expect(batch.items.find((item) => item.name === "letter.pdf")).toMatchObject({
      stage: "skipped",
      reason: "Skipped: the folder already holds letter.pdf, and you chose not to send this one.",
    });
    expect(batch.skipped).toBe(1);
    expect(batchTallyText(batch)).toBe("1 of 2 uploaded · 1 skipped");
  });

  it("lets one file answer the taken-name question differently from the batch", async () => {
    const record: Recorded = { uploads: [], folders: [] };
    const clashing = entry("", "letter.pdf");
    const batch = startUploadBatch(
      plan([clashing], {
        nameClashDefault: "skip",
        nameClashChoices: new Map([[intakeEntryKey(clashing), "keep-both"]]),
      }),
      dependencies(record),
    );
    await settled();
    expect(record.uploads.map((request) => request.name)).toEqual(["letter (2).pdf"]);
    expect(batch.skipped).toBe(0);
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

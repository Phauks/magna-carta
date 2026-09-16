/*
 * What a browser remembers about uploads that have already finished — the half of the register that
 * survives the tab.
 *
 * The rules worth pinning are all in the pure half: a finished batch becomes a record with its two
 * counts read off the WHOLE batch rather than off the capped rows; a retry of the same batch
 * replaces its record instead of filing a second one beside it; and the read-time validator drops
 * what it cannot make sense of rather than repairing it, because a repaired row is a half-truth
 * about what was uploaded and the whole worth of this register is that it can be believed.
 */
import { describe, expect, it } from "vitest";
import {
  entryFromFinished,
  normalizeUploadHistory,
  redownloadableCount,
  uploadHistoryCodec,
  withFinishedUpload,
  type FinishedUpload,
  type UploadHistoryFile,
  type UploadHistoryValue,
} from "../src/lib/transfers/upload-history.ts";
import { UPLOAD_HISTORY_FILE_LIMIT, UPLOAD_HISTORY_LIMIT } from "../src/lib/transfers/transfers.ts";

const file = (
  name: string,
  outcome: UploadHistoryFile["outcome"] = "landed",
  fileId: string | null = "file-1",
): UploadHistoryFile => ({ name, byteSize: 10, outcome, fileId });

const finished = (id: string, files: UploadHistoryFile[] = [file("a.pdf")]): FinishedUpload => ({
  id,
  matterId: "matter-1",
  matterTitle: "Rivera v. Coastline",
  destinationFolderId: "folder-1",
  destinationLabel: "Discovery",
  startedAt: "2026-09-16T09:00:00.000Z",
  finishedAt: "2026-09-16T09:04:00.000Z",
  files,
});

const empty: UploadHistoryValue = { entries: [] };

describe("a finished batch becomes a record", () => {
  it("counts over every file, not over the ones that fit under the cap", () => {
    const many = Array.from({ length: UPLOAD_HISTORY_FILE_LIMIT + 40 }, (_unused, index) =>
      file(`file-${String(index)}.pdf`),
    );
    const entry = entryFromFinished(finished("batch-1", many));
    expect(entry.files).toHaveLength(UPLOAD_HISTORY_FILE_LIMIT);
    expect(entry.total).toBe(many.length);
    expect(entry.landed).toBe(many.length);
  });

  it("keeps the file id of what landed, and none for what did not", () => {
    const entry = entryFromFinished(
      finished("batch-1", [
        file("landed.pdf", "landed", "file-9"),
        file("failed.pdf", "failed", null),
        file("skipped.pdf", "skipped", null),
        file("unsent.pdf", "not-sent", null),
      ]),
    );
    expect(entry.landed).toBe(1);
    expect(redownloadableCount(entry)).toBe(1);
    expect(entry.files.map((each) => each.outcome)).toEqual([
      "landed",
      "failed",
      "skipped",
      "not-sent",
    ]);
  });
});

describe("remembering", () => {
  it("puts the newest first and bounds what is kept", () => {
    let value = empty;
    for (let index = 0; index < UPLOAD_HISTORY_LIMIT + 5; index += 1) {
      value = withFinishedUpload(value, finished(`batch-${String(index)}`));
    }
    expect(value.entries).toHaveLength(UPLOAD_HISTORY_LIMIT);
    expect(value.entries[0]?.id).toBe(`batch-${String(UPLOAD_HISTORY_LIMIT + 4)}`);
  });

  it("replaces a batch remembered before rather than filing it twice", () => {
    // A retry finishes the SAME batch again. What a reader wants remembered is where it ended up.
    const first = withFinishedUpload(empty, finished("batch-1", [file("a.pdf", "failed", null)]));
    const second = withFinishedUpload(first, finished("batch-1", [file("a.pdf", "landed", "f-2")]));
    expect(second.entries).toHaveLength(1);
    const remembered = second.entries[0];
    expect(remembered?.landed).toBe(1);
    expect(remembered === undefined ? 0 : redownloadableCount(remembered)).toBe(1);
  });
});

describe("the read-time validator", () => {
  it("folds an absent, wrong-shaped or unparseable payload to nothing", () => {
    expect(normalizeUploadHistory(undefined).entries).toEqual([]);
    expect(normalizeUploadHistory(null).entries).toEqual([]);
    expect(normalizeUploadHistory("nonsense").entries).toEqual([]);
    expect(normalizeUploadHistory({ entries: "nonsense" }).entries).toEqual([]);
  });

  it("drops a row with no identity, matter or instant rather than inventing one", () => {
    const value = normalizeUploadHistory({
      entries: [
        { id: "", matterId: "m", finishedAt: "t" },
        { id: "a", matterId: "", finishedAt: "t" },
        { id: "b", matterId: "m", finishedAt: "" },
        { id: "c", matterId: "m", finishedAt: "2026-09-16T09:04:00.000Z" },
      ],
    });
    expect(value.entries.map((entry) => entry.id)).toEqual(["c"]);
  });

  it("drops a file with no name or an outcome it does not recognize", () => {
    const value = normalizeUploadHistory({
      entries: [
        {
          id: "a",
          matterId: "m",
          finishedAt: "2026-09-16T09:04:00.000Z",
          files: [
            { name: "", outcome: "landed" },
            { name: "b.pdf", outcome: "teleported" },
            { name: "c.pdf", outcome: "landed", byteSize: -4, fileId: "" },
          ],
        },
      ],
    });
    expect(value.entries[0]?.files).toEqual([
      { name: "c.pdf", byteSize: 0, outcome: "landed", fileId: null },
    ]);
  });

  it("never lets a stored tally undercount the rows beside it", () => {
    const value = normalizeUploadHistory({
      entries: [
        {
          id: "a",
          matterId: "m",
          finishedAt: "2026-09-16T09:04:00.000Z",
          total: 1,
          landed: 0,
          files: [
            { name: "a.pdf", outcome: "landed", fileId: "f-1" },
            { name: "b.pdf", outcome: "landed", fileId: "f-2" },
          ],
        },
      ],
    });
    expect(value.entries[0]?.landed).toBe(2);
    expect(value.entries[0]?.total).toBe(2);
  });

  it("bounds a payload somebody grew by hand", () => {
    const entries = Array.from({ length: UPLOAD_HISTORY_LIMIT + 12 }, (_unused, index) => ({
      id: `batch-${String(index)}`,
      matterId: "m",
      finishedAt: "2026-09-16T09:04:00.000Z",
    }));
    expect(normalizeUploadHistory({ entries }).entries).toHaveLength(UPLOAD_HISTORY_LIMIT);
  });

  it("round-trips through its codec, and answers an absent key with nothing", () => {
    const codec = uploadHistoryCodec();
    expect(codec.storageKey).toBe("mc-upload-history");
    expect(codec.decode(null).entries).toEqual([]);
    expect(codec.decode("{not json").entries).toEqual([]);
    const kept = withFinishedUpload(empty, finished("batch-1"));
    expect(codec.decode(codec.encode(kept))).toEqual(kept);
  });
});

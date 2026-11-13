import { describe, expect, it } from "vitest";
import {
  decidePlayableCopyRequest,
  PLAYABLE_COPY_STALE_AFTER_MILLISECONDS,
  playableCopyFileName,
  playableCopyKey,
  playableCopySourceFormat,
  type VersionForPlayableCopy,
} from "../src/playable-copy.ts";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

const base: VersionForPlayableCopy = {
  id: "fileVersion_x" as never,
  fileId: "file_x" as never,
  matterId: "matter_x" as never,
  folderId: null,
  fileName: "Interview.mov",
  r2Key: "files/file_x/fileVersion_x",
  sizeBytes: 1000,
  sniffedContentType: "video/quicktime",
  storageEncoding: "full",
  scanVerdict: "clean",
  playableCopyState: null,
  playableCopyR2Key: null,
  playableCopySizeBytes: null,
  playableCopyReason: null,
  playableCopyRequestedAt: null,
  playableCopyFileId: null,
  playableCopyFileDeleted: false,
};

describe("playable copy", () => {
  it("lives beside the version's own object, inside the prefix a purge lists", () => {
    expect(playableCopyKey("bulk/file_x/fileVersion_x")).toBe(
      "bulk/file_x/fileVersion_x.playable.mp4",
    );
  });

  it("is filed under the original's name, marked as the converted copy", () => {
    expect(playableCopyFileName("Interview.mov")).toBe("Interview (converted).mp4");
    expect(playableCopyFileName("deposition.day2.mkv")).toBe("deposition.day2 (converted).mp4");
    expect(playableCopyFileName("clip.mp4")).toBe("clip (converted).mp4");
    expect(playableCopyFileName("no-extension")).toBe("no-extension (converted).mp4");
    expect(playableCopyFileName(".mov")).toBe(".mov (converted).mp4");
    expect(playableCopyFileName("   .mov")).toBe("Recording (converted).mp4");
  });

  it("hands out a filed copy, and owes a new one once a member deletes it", () => {
    const filed = {
      ...base,
      playableCopyState: "ready" as const,
      playableCopyFileId: "file_copy" as never,
    };
    expect(decidePlayableCopyRequest(filed, NOW)).toEqual({ kind: "ready" });
    expect(decidePlayableCopyRequest({ ...filed, playableCopyFileDeleted: true }, NOW)).toEqual({
      kind: "start",
      sourceFormat: "mov",
    });
  });

  it("names the container the engine reads, and nothing for a type it does not", () => {
    expect(playableCopySourceFormat("video/mp4")).toBe("mp4");
    expect(playableCopySourceFormat("video/x-m4v")).toBe("mp4");
    expect(playableCopySourceFormat("video/quicktime")).toBe("mov");
    expect(playableCopySourceFormat("video/x-matroska")).toBe("mkv");
    expect(playableCopySourceFormat("video/webm")).toBeNull();
    expect(playableCopySourceFormat("application/pdf")).toBeNull();
    expect(playableCopySourceFormat(null)).toBeNull();
  });

  it("starts a conversion nobody has asked for", () => {
    expect(decidePlayableCopyRequest(base, NOW)).toEqual({ kind: "start", sourceFormat: "mov" });
  });

  it("does not start a second conversion while one is under way", () => {
    const pending = {
      ...base,
      playableCopyState: "pending" as const,
      playableCopyRequestedAt: new Date(NOW - 60_000).toISOString(),
    };
    expect(decidePlayableCopyRequest(pending, NOW)).toEqual({ kind: "in-progress" });
  });

  it("asks again when the last request has gone stale", () => {
    const stale = {
      ...base,
      playableCopyState: "pending" as const,
      playableCopyRequestedAt: new Date(NOW - PLAYABLE_COPY_STALE_AFTER_MILLISECONDS).toISOString(),
    };
    expect(decidePlayableCopyRequest(stale, NOW)).toEqual({ kind: "start", sourceFormat: "mov" });
  });

  it("hands out a copy already made, and keeps the engine's refusal", () => {
    expect(
      decidePlayableCopyRequest(
        { ...base, playableCopyState: "ready", playableCopyR2Key: "files/x.playable.mp4" },
        NOW,
      ),
    ).toEqual({ kind: "ready" });
    expect(
      decidePlayableCopyRequest(
        { ...base, playableCopyState: "unavailable", playableCopyReason: "malformed" },
        NOW,
      ),
    ).toEqual({ kind: "unavailable", reason: "malformed" });
  });

  it("is accepted whatever the playability verdict, since the verdict is not on the row it reads", () => {
    expect(decidePlayableCopyRequest({ ...base, sniffedContentType: "video/mp4" }, NOW).kind).toBe(
      "start",
    );
  });

  it("refuses a version the engine cannot take, and a flagged one", () => {
    expect(decidePlayableCopyRequest({ ...base, sniffedContentType: "video/webm" }, NOW)).toEqual({
      kind: "not-a-candidate",
      why: "not-a-video",
    });
    expect(decidePlayableCopyRequest({ ...base, storageEncoding: "delta" }, NOW)).toEqual({
      kind: "not-a-candidate",
      why: "encoded",
    });
    expect(
      decidePlayableCopyRequest(
        { ...base, scanVerdict: "flagged", playableCopyState: "ready", playableCopyR2Key: "k" },
        NOW,
      ),
    ).toEqual({ kind: "not-a-candidate", why: "flagged" });
  });
});

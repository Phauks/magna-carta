import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureReady,
  listSevenZipBytes,
  readSevenZipListing,
  readSevenZipMember,
  SevenZipListingError,
  type ArchiveRangeReader,
} from "../src/index.js";

const wasmBytes = readFileSync(
  fileURLToPath(new URL("../src/pkg/seven_zip_core_bg.wasm", import.meta.url)),
);

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      fileURLToPath(
        new URL(`../../../crates/seven-zip-core/tests/fixtures/${name}`, import.meta.url),
      ),
    ),
  );
}

/** A stand-in for a stored object: serves ranges and records what was asked for. */
function rangeReader(archive: Uint8Array): {
  read: ArchiveRangeReader;
  requests: { offset: number; length: number }[];
} {
  const requests: { offset: number; length: number }[] = [];
  return {
    requests,
    read: async (offset, length) => {
      requests.push({ offset, length });
      return archive.subarray(offset, offset + length);
    },
  };
}

describe("@magna-carta/seven-zip wasm wrapper", () => {
  beforeAll(async () => {
    await ensureReady(wasmBytes);
  });

  describe("listing an archive", () => {
    it("lists members, directories, and nested paths", async () => {
      const listing = await listSevenZipBytes(fixture("mixed-members.7z"), { maxEntries: 100 });

      expect(listing.truncated).toBe(false);
      expect(listing.entries.map((entry) => entry.path)).toEqual([
        "readme.txt",
        "exhibits",
        "exhibits/a/deposition.txt",
        "exhibits/b/transcript.txt",
      ]);
      expect(listing.entries[1]?.isDirectory).toBe(true);
      expect(listing.entries[2]?.isDirectory).toBe(false);
      expect(listing.entries[2]?.uncompressedSizeBytes).toBe("content of a".length);
      expect(listing.entries.every((entry) => !entry.encrypted)).toBe(true);
    });

    it("carries the modification time as an ISO string, and null where there is none", async () => {
      const listing = await listSevenZipBytes(fixture("mixed-members.7z"), { maxEntries: 100 });
      expect(listing.entries[0]?.modifiedAt).toBe("2026-09-07T12:00:00.000Z");
      expect(listing.entries[1]?.modifiedAt).toBeNull();
    });

    it("needs only two ranged reads when the file list is stored in the clear", async () => {
      // Whether the list is compressed is the encoder's call; this archive was small enough that it
      // was not, which is the shorter of the two paths.
      const archive = fixture("content-encrypted.7z");
      const { read, requests } = rangeReader(archive);

      const listing = await readSevenZipListing(archive.byteLength, read, { maxEntries: 100 });

      expect(listing.entries).toHaveLength(2);
      expect(requests).toHaveLength(2);
      expect(requests[0]).toEqual({ offset: 0, length: 32 });
      expect(requests.reduce((total, r) => total + r.length, 0)).toBeLessThan(archive.byteLength);
    });
  });

  describe("a file list the encoder compressed", () => {
    it("lists all 400 members over three ranged reads", async () => {
      const archive = fixture("many-members.7z");
      const { read, requests } = rangeReader(archive);

      const listing = await readSevenZipListing(archive.byteLength, read, { maxEntries: 1000 });

      expect(listing.entries).toHaveLength(400);
      expect(listing.truncated).toBe(false);
      expect(listing.entries[0]?.path).toBe("matters/2026/production-volume-one/exhibit-00000.txt");
      expect(listing.entries[399]?.path).toBe(
        "matters/2026/production-volume-one/exhibit-00399.txt",
      );
      expect(requests).toHaveLength(3);
      expect(requests[0]).toEqual({ offset: 0, length: 32 });
    });

    it("stops at the entry cap and says the listing is short", async () => {
      const listing = await listSevenZipBytes(fixture("many-members.7z"), {
        maxEntries: 25,
      });
      expect(listing.entries).toHaveLength(25);
      expect(listing.truncated).toBe(true);
    });
  });

  describe("encryption", () => {
    it("lists an archive whose content is encrypted and flags every member", async () => {
      const listing = await listSevenZipBytes(fixture("content-encrypted.7z"), {
        maxEntries: 100,
      });
      expect(listing.entries[0]?.path).toBe("privileged.txt");
      expect(listing.entries[0]?.encrypted).toBe(true);
      // A directory has no content stream, so there is nothing about it that is encrypted.
      expect(listing.entries[1]?.encrypted).toBe(false);
    });

    it("refuses an archive whose file list is encrypted, by code", async () => {
      await expect(
        listSevenZipBytes(fixture("file-list-encrypted.7z"), { maxEntries: 100 }),
      ).rejects.toMatchObject({ name: "SevenZipListingError", code: "headerEncrypted" });
    });
  });

  describe("refusals", () => {
    it("refuses bytes that are not a 7z", async () => {
      await expect(
        listSevenZipBytes(new Uint8Array(4096).fill(0x42), { maxEntries: 100 }),
      ).rejects.toMatchObject({ code: "notSevenZip" });
    });

    it("refuses a truncated archive rather than reading past it", async () => {
      const archive = fixture("many-members.7z");
      await expect(
        listSevenZipBytes(archive.subarray(0, archive.byteLength >> 1), { maxEntries: 100 }),
      ).rejects.toBeInstanceOf(SevenZipListingError);
    });

    it("refuses a header larger than the caller allows", async () => {
      await expect(
        listSevenZipBytes(fixture("many-members.7z"), {
          maxEntries: 100,
          maxHeaderBytes: 64,
        }),
      ).rejects.toMatchObject({ code: "tooLarge" });
    });

    it("refuses a short ranged read rather than working around it", async () => {
      const archive = fixture("many-members.7z");
      const short: ArchiveRangeReader = async (offset, length) =>
        archive.subarray(offset, offset + Math.max(1, length - 1));

      await expect(
        readSevenZipListing(archive.byteLength, short, { maxEntries: 100 }),
      ).rejects.toMatchObject({ code: "malformed" });
    });
  });
});

describe("taking one member out", () => {
  const EXTRACT_LIMITS = { maxEntries: 100, maxMemberBytes: 10 * 1024 * 1024 };

  it("takes a member out by the index the listing gave it", async () => {
    const archive = fixture("mixed-members.7z");
    const listing = await listSevenZipBytes(archive, { maxEntries: 100 });
    const wanted = listing.entries.findIndex((entry) => entry.path === "exhibits/a/deposition.txt");
    expect(wanted).toBeGreaterThanOrEqual(0);

    const { read } = rangeReader(archive);
    const bytes = await readSevenZipMember(archive.byteLength, read, wanted, EXTRACT_LIMITS);
    expect(new TextDecoder().decode(bytes)).toBe("content of a");
  });

  it("reads the header and one block, never the archive", async () => {
    const archive = fixture("many-members.7z");
    const listing = await listSevenZipBytes(archive, { maxEntries: 1000 });
    const { read, requests } = rangeReader(archive);

    const bytes = await readSevenZipMember(archive.byteLength, read, 0, EXTRACT_LIMITS);
    expect(new TextDecoder().decode(bytes)).toBe("exhibit 0");
    expect(listing.entries).toHaveLength(400);
    // Four ranges at most, and not one of them the whole object.
    expect(requests.length).toBeLessThanOrEqual(4);
    expect(requests.every((request) => request.length < archive.byteLength)).toBe(true);
  });

  it("refuses an encrypted member by name rather than failing to decode it", async () => {
    const archive = fixture("content-encrypted.7z");
    const listing = await listSevenZipBytes(archive, { maxEntries: 100 });
    const encrypted = listing.entries.findIndex((entry) => entry.encrypted && !entry.isDirectory);
    expect(encrypted).toBeGreaterThanOrEqual(0);

    const { read } = rangeReader(archive);
    await expect(
      readSevenZipMember(archive.byteLength, read, encrypted, EXTRACT_LIMITS),
    ).rejects.toMatchObject({ code: "memberEncrypted" });
  });

  it("refuses an archive whose file list is encrypted before it can name a member", async () => {
    const archive = fixture("file-list-encrypted.7z");
    const { read } = rangeReader(archive);
    await expect(
      readSevenZipMember(archive.byteLength, read, 0, EXTRACT_LIMITS),
    ).rejects.toMatchObject({ code: "headerEncrypted" });
  });

  it("refuses a member past the caller's ceiling", async () => {
    const archive = fixture("mixed-members.7z");
    const listing = await listSevenZipBytes(archive, { maxEntries: 100 });
    const wanted = listing.entries.findIndex((entry) => entry.path === "exhibits/a/deposition.txt");
    const { read } = rangeReader(archive);
    await expect(
      readSevenZipMember(archive.byteLength, read, wanted, {
        maxEntries: 100,
        maxMemberBytes: 4,
      }),
    ).rejects.toBeInstanceOf(SevenZipListingError);
  });

  it("refuses an index the archive does not hold", async () => {
    const archive = fixture("mixed-members.7z");
    const { read } = rangeReader(archive);
    await expect(
      readSevenZipMember(archive.byteLength, read, 999, EXTRACT_LIMITS),
    ).rejects.toMatchObject({ code: "memberNotFound" });
  });
});

// The 7z engine, in the shape `@magna-carta/file-manager` asks for.
//
// Every other archive format on this platform is read by pure TypeScript over a bucket: bytes in,
// arithmetic, members out. A 7z cannot be. Its file list sits at the END of the archive and is
// normally LZMA-compressed, and its members are packed by real coders — so both halves need a
// decoder, and that decoder is `@magna-carta/seven-zip` (crates/seven-zip-core compiled to
// WebAssembly), which takes a range reader rather than a bucket precisely so it does not have to
// know what a firm bucket is. This module is the two-way seam: bucket in, range reader out.
//
// It lives in the worker, not in the domain package, because it is the worker that has the
// WebAssembly module to hand. Under Workers there is no URL to fetch one from — the bundler supplies
// it as a pre-compiled `WebAssembly.Module` at the import site — so a domain package importing this
// engine would carry a binding only one of its consumers could satisfy. `@magna-carta/file-manager`
// declares the port and this fills it, on the same terms `MalwareScanPort` is filled.
//
// COST. Listing: two ranged reads, or three when the file list is compressed. Extraction: those,
// plus the one block the member lives in. Never the archive itself, however large it is.
import {
  ensureReady,
  readSevenZipListing,
  readSevenZipMember,
  SevenZipListingError,
  type SevenZipListing,
} from "@magna-carta/seven-zip";
import sevenZipWasmModule from "@magna-carta/seven-zip/src/pkg/seven_zip_core_bg.wasm";
import type {
  ArchiveExtractionRefusal,
  SevenZipEnginePort,
  SevenZipExtraction,
} from "@magna-carta/file-manager/archive-members";
import type { ArchiveSourceBucket } from "@magna-carta/file-manager/zip-central-directory";

/**
 * Thrown when the object goes away between the head and a range read. It is not a fact about the
 * archive — the bytes were fine and then were not there — so it never reaches the engine, which
 * would report a short read as a malformed archive and blame the file for the object's
 * disappearance.
 */
class ArchiveObjectVanishedError extends Error {}

/**
 * Before the engine's own entry points, which call `ensureReady()` with no argument: the first
 * initialization is the one that is cached, so handing the module in here is what makes those later
 * argument-less calls resolve without looking for a URL.
 */
async function readyEngine(): Promise<void> {
  await ensureReady(sevenZipWasmModule);
}

function rangeReaderOver(bucket: ArchiveSourceBucket, key: string) {
  return async (offset: number, length: number): Promise<Uint8Array> => {
    const object = await bucket.get(key, { range: { offset, length } });
    if (object === null) throw new ArchiveObjectVanishedError();
    return new Uint8Array(await object.arrayBuffer());
  };
}

/**
 * How the engine's refusal reads as a fact about the member.
 *
 * The listing already knows which members are encrypted, so `memberEncrypted` normally never gets
 * here — it is mapped anyway, because an archive can be replaced between the listing and the
 * extraction and the honest answer then is still "this member is encrypted".
 */
function refusalFor(code: SevenZipListingError["code"]): ArchiveExtractionRefusal {
  switch (code) {
    case "memberEncrypted":
    case "headerEncrypted":
      return "encrypted";
    case "notAFile":
      return "not-a-file";
    case "memberNotFound":
      return "malformed";
    case "corrupt":
      return "corrupt";
    case "tooLarge":
      return "too-large";
    case "unsupportedCoder":
    case "unsupportedVersion":
      return "unsupported-compression";
    case "notSevenZip":
    case "malformed":
    case "rangeMismatch":
      return "malformed";
  }
}

/** The engine this deployment has, ready to be handed to the archive module. */
export const sevenZipEngine: SevenZipEnginePort = {
  async list(
    bucket: ArchiveSourceBucket,
    key: string,
    limits: { maxEntries: number },
  ): Promise<SevenZipListing | null> {
    const head = await bucket.head(key);
    if (head === null) return null;
    await readyEngine();
    try {
      return await readSevenZipListing(head.size, rangeReaderOver(bucket, key), limits);
    } catch (caught) {
      if (caught instanceof ArchiveObjectVanishedError) return null;
      throw caught;
    }
  },

  async extract(
    bucket: ArchiveSourceBucket,
    key: string,
    memberIndex: number,
    limits: { maxUncompressedBytes: number },
  ): Promise<SevenZipExtraction> {
    const head = await bucket.head(key);
    if (head === null) return { kind: "refused", reason: "archive-missing" };
    await readyEngine();
    try {
      const bytes = await readSevenZipMember(head.size, rangeReaderOver(bucket, key), memberIndex, {
        maxEntries: 0,
        maxMemberBytes: limits.maxUncompressedBytes,
        // A solid block is decoded up to the member being taken, so the block is what the work
        // actually costs. It is allowed to be larger than one member's ceiling — a firm that caps
        // a single extraction at 100 MB has not said its members may not sit in a 400 MB block —
        // but it is bounded, at four times the member ceiling, so a hostile block is still refused
        // rather than decoded.
        maxBlockBytes: limits.maxUncompressedBytes * 4,
      });
      return { kind: "ok", bytes };
    } catch (caught) {
      if (caught instanceof ArchiveObjectVanishedError) {
        return { kind: "refused", reason: "archive-missing" };
      }
      if (caught instanceof SevenZipListingError) {
        return { kind: "refused", reason: refusalFor(caught.code) };
      }
      throw caught;
    }
  },
};

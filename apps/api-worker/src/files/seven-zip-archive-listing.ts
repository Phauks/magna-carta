// The 7z listing engine, behind the same call shape the zip, tar and rar readers answer.
//
// The other three readers are pure TypeScript over a bucket: bytes in, arithmetic, entries out. A 7z
// cannot be read that way — its file list lives in a header at the END of the archive and is normally
// LZMA-compressed, so listing one needs a real decoder. That decoder is
// `@magna-carta/seven-zip-listing` (crates/seven-zip-listing-core compiled to WebAssembly), which
// takes a range reader rather than a bucket precisely so it does not have to know what a firm bucket
// is. This module is the two-way seam: bucket in, range reader out.
//
// It lives here, in the worker, rather than in `@magna-carta/file-manager`, because it is the worker
// that has the WebAssembly module to hand. Under Workers there is no URL to fetch one from — the
// bundler supplies it as a pre-compiled `WebAssembly.Module` at the import site — so a domain package
// importing this engine would carry a binding only one of its consumers can satisfy.
//
// COST. Two ranged reads for an archive whose file list is stored plain, three when it is compressed,
// and never the archive itself however large it is — the same property the other three listings have.
import {
  ensureReady,
  readSevenZipListing,
  type SevenZipListing,
  type SevenZipListingLimits,
} from "@magna-carta/seven-zip-listing";
import sevenZipWasmModule from "@magna-carta/seven-zip-listing/src/pkg/seven_zip_listing_core_bg.wasm";
import type { ArchiveSourceBucket } from "@magna-carta/file-manager/zip-central-directory";

/**
 * Thrown when the object goes away between the head and a range read. It is not a fact about the
 * archive — the bytes were fine and then were not there — so it never reaches the engine, which would
 * report a short read as a malformed archive and blame the file for the object's disappearance.
 */
class ArchiveObjectVanishedError extends Error {}

/**
 * List a 7z held in a firm bucket, or null when the object is gone.
 *
 * Throws `SevenZipListingError` (see its `code`) for an archive the engine refuses — including the
 * one refusal worth telling a person about separately, an archive whose file list is itself
 * encrypted.
 */
export async function readSevenZipArchiveListing(
  bucket: ArchiveSourceBucket,
  key: string,
  limits: SevenZipListingLimits,
): Promise<SevenZipListing | null> {
  const head = await bucket.head(key);
  if (head === null) return null;

  // Before the engine's own entry points, which call `ensureReady()` with no argument: the first
  // initialization is the one that is cached, so handing the module in here is what makes those
  // later argument-less calls resolve without looking for a URL.
  await ensureReady(sevenZipWasmModule);

  try {
    return await readSevenZipListing(
      head.size,
      async (offset, length) => {
        const object = await bucket.get(key, { range: { offset, length } });
        if (object === null) throw new ArchiveObjectVanishedError();
        return new Uint8Array(await object.arrayBuffer());
      },
      limits,
    );
  } catch (caught) {
    if (caught instanceof ArchiveObjectVanishedError) return null;
    throw caught;
  }
}

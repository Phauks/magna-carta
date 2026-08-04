import { unzipSync, type UnzipFileInfo } from "fflate";

export const MAX_INPUT_BYTES = 15 * 1024 * 1024;

// The total inflated size an archive is allowed to reach, across all of its entries.
//
// This runs inside a single Cloudflare Workers isolate, whose whole-isolate memory ceiling is
// 128 MiB — so the cap has to leave room for everything that is resident AT THE SAME TIME as the
// inflated entries, not just for the entries themselves. On the scrub path that is: the raw input
// (up to MAX_INPUT_BYTES), the inflated entry map, the UTF-16 decode of the part being rewritten
// (two bytes per input byte) plus its parsed node tree (several times the part's byte size again),
// the rebuilt output buffer, and then a SECOND inflated entry map — because scrub re-inspects its
// own output (see metadata.ts) before returning, so input and output entry maps overlap.
//
// 32 MiB keeps two entry maps plus that XML working set comfortably under the ceiling. A cap at or
// above the isolate ceiling is not a guard at all: the isolate dies during inflation, before any
// check downstream of it can fire.
export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;

export const MAX_ENTRY_COUNT = 2048;

// Thrown when an archive expands past the safety caps. Caught at the port boundary and mapped to the
// "decompression-bomb" failure reason.
export class BombError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BombError";
  }
}

export function oversize(bytes: Uint8Array): boolean {
  return bytes.byteLength > MAX_INPUT_BYTES;
}

export interface UnzipLimits {
  maxEntries?: number;
  maxInflated?: number;
}

// Unzip with entry-count and total-inflated-size caps.
//
// Pre-inflation: fflate's unzipSync `filter` callback fires once per entry BEFORE that entry is
// decompressed. We accumulate the entry counter and the declared uncompressed sizes there, and throw
// BombError immediately if either cap is breached — so well-declared bombs never inflate at all.
//
// Post-inflation backstop: after unzipSync returns we re-sum the actual inflated sizes. This catches
// a zip that under-declares its uncompressed sizes (lies in the local/central directory headers).
// A zip that over-declares could be stopped early by the pre-inflation filter even if it is small
// when inflated; that is the conservative, safe direction.
//
// Note: a zip that lies about declared sizes by claiming small values is bounded only by the
// MAX_INPUT_BYTES cap on the raw compressed input. A fully streaming hard cap is a future follow-up.
// The per-entry safety check every zip read in this package shares: the entry-count cap plus the
// running total of DECLARED uncompressed sizes, both evaluated before the entry is inflated. Returns
// a stateful callback, so one instance guards exactly one archive.
function entryGuard(maxEntries: number, maxInflated: number): (file: UnzipFileInfo) => void {
  let entryCount = 0;
  let declaredTotal = 0;
  return (file) => {
    entryCount++;
    if (entryCount > maxEntries) {
      throw new BombError(`archive has more than ${maxEntries} entries`);
    }
    declaredTotal += file.originalSize;
    if (declaredTotal > maxInflated) {
      throw new BombError(`archive declared sizes exceed ${maxInflated} bytes before inflation`);
    }
  };
}

// Answer "does this archive contain entry <name>?" without inflating a single byte: the filter
// applies the same caps as safeUnzip and then returns false for EVERY entry, which is fflate's
// signal to skip decompression. Format detection needs the answer, not the content, and inflating
// there would sidestep the caps entirely — a crafted high-ratio entry would exhaust the isolate
// before any guarded read ran.
export function zipHasEntry(bytes: Uint8Array, name: string, limits: UnzipLimits = {}): boolean {
  const guardEntry = entryGuard(
    limits.maxEntries ?? MAX_ENTRY_COUNT,
    limits.maxInflated ?? MAX_INFLATED_BYTES,
  );
  let found = false;
  unzipSync(bytes, {
    filter(file) {
      guardEntry(file);
      if (file.name === name) found = true;
      return false;
    },
  });
  return found;
}

export function safeUnzip(bytes: Uint8Array, limits: UnzipLimits = {}): Record<string, Uint8Array> {
  const maxEntries = limits.maxEntries ?? MAX_ENTRY_COUNT;
  const maxInflated = limits.maxInflated ?? MAX_INFLATED_BYTES;
  const guardEntry = entryGuard(maxEntries, maxInflated);

  const entries = unzipSync(bytes, {
    filter(file) {
      guardEntry(file);
      return true;
    },
  });

  // Post-inflation backstop: catches under-declared sizes.
  let inflated = 0;
  for (const value of Object.values(entries)) {
    inflated += value.byteLength;
    if (inflated > maxInflated) {
      throw new BombError(`archive inflates past ${maxInflated} bytes`);
    }
  }

  return entries;
}

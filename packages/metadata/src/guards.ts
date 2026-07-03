import { unzipSync } from "fflate";

export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const MAX_INFLATED_BYTES = 200 * 1024 * 1024;
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
export function safeUnzip(bytes: Uint8Array, limits: UnzipLimits = {}): Record<string, Uint8Array> {
  const maxEntries = limits.maxEntries ?? MAX_ENTRY_COUNT;
  const maxInflated = limits.maxInflated ?? MAX_INFLATED_BYTES;

  let entryCount = 0;
  let declaredTotal = 0;

  const entries = unzipSync(bytes, {
    filter(file) {
      entryCount++;
      if (entryCount > maxEntries) {
        throw new BombError(`archive has more than ${maxEntries} entries`);
      }
      declaredTotal += file.originalSize;
      if (declaredTotal > maxInflated) {
        throw new BombError(`archive declared sizes exceed ${maxInflated} bytes before inflation`);
      }
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

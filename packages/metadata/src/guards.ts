import { unzipSync } from "fflate";

export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const MAX_INFLATED_BYTES = 200 * 1024 * 1024;
export const MAX_ENTRY_COUNT = 2048;

// Thrown when an archive expands past the safety caps. Caught at the port boundary and mapped to the
// "decompression-bomb" failure reason — never expands an untrusted archive without bound.
export class BombError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BombError";
  }
}

export function oversize(bytes: Uint8Array): boolean {
  return bytes.byteLength > MAX_INPUT_BYTES;
}

// Unzip with entry-count and total-inflated-size caps. fflate's unzipSync is synchronous and inflates
// eagerly, so the inflated total is summed after the fact and the entry count is checked first against
// the central directory size via the returned record.
export function safeUnzip(bytes: Uint8Array): Record<string, Uint8Array> {
  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  if (names.length > MAX_ENTRY_COUNT) {
    throw new BombError(`archive has ${names.length} entries (cap ${MAX_ENTRY_COUNT})`);
  }
  let inflated = 0;
  for (const name of names) {
    inflated += entries[name].byteLength;
    if (inflated > MAX_INFLATED_BYTES) {
      throw new BombError(`archive inflates past ${MAX_INFLATED_BYTES} bytes`);
    }
  }
  return entries;
}

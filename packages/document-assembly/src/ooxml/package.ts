import { strToU8, unzipSync, zipSync, type UnzipFileInfo } from "fflate";
import { failed, succeeded, type Outcome } from "../types.ts";
import { CONTENT_TYPES_PART, REQUIRED_PARTS } from "./parts.ts";

// The one zip entry point in this package. Nothing else calls fflate's unzipSync: an unguarded inflate
// anywhere makes the caps below decorative, and a template is an untrusted upload. The same discipline
// packages/metadata/src/guards.ts established, sized for this consumer's inputs.

// The largest template package the engine will accept. A firm's real templates are tens to a few
// hundred kilobytes; a package far past that is an embedded-image document rather than a template, and
// refusing it at registration is strictly better than discovering it at assembly time with a user
// waiting.
export const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;

// The total inflated size a template package may reach across all of its entries. This runs inside a
// single Cloudflare Workers isolate whose whole-isolate memory ceiling is 128 MiB, and the cap has to
// leave room for everything resident AT THE SAME TIME: the raw input, the inflated part map, the UTF-16
// decode of each part being rewritten (two bytes per input byte) plus its parsed node tree (several
// times the part's size again), and the rebuilt output map. A cap at or above the isolate ceiling is not
// a guard at all — the isolate dies during inflation, before any check downstream of it can fire.
export const MAX_INFLATED_BYTES = 24 * 1024 * 1024;

// A `.docx` has on the order of a dozen parts; a few hundred is already a document with a large media
// folder. The cap bounds the per-entry work regardless of how small each entry inflates to.
export const MAX_ENTRY_COUNT = 512;

// The three caps as one value, so a reader with a different input in mind can name its own. The
// defaults are the template caps above; the accept-changes pass over a WORKING document (a member's
// own file, images and all, rather than a firm's template) takes larger ones in
// accept-tracked-changes.ts, sized against the same isolate ceiling.
export interface PackageLimits {
  readonly maxPackageBytes: number;
  readonly maxInflatedBytes: number;
  readonly maxEntryCount: number;
}

export const TEMPLATE_PACKAGE_LIMITS: PackageLimits = {
  maxPackageBytes: MAX_TEMPLATE_BYTES,
  maxInflatedBytes: MAX_INFLATED_BYTES,
  maxEntryCount: MAX_ENTRY_COUNT,
};

export type PackageReadFailure =
  | "oversize" // the raw package exceeds MAX_TEMPLATE_BYTES
  | "decompression-bomb" // entry count or inflated size past the caps
  | "not-a-package" // not a readable zip at all
  | "not-a-word-package"; // a readable zip missing the parts a WordprocessingML package requires

// An OOXML package as a part map: full part name to raw bytes. Insertion order is the archive order and
// is preserved on write, so a rewritten package keeps the part ordering the authoring application chose.
export type PartMap = Map<string, Uint8Array>;

class BombError extends Error {}

// The per-entry check every read shares: the entry-count cap plus the running total of DECLARED
// uncompressed sizes, both evaluated BEFORE the entry is inflated, so a well-declared bomb never
// inflates at all. Returns a stateful callback, so one instance guards exactly one archive.
function entryGuard(limits: PackageLimits): (file: UnzipFileInfo) => void {
  let entryCount = 0;
  let declaredTotal = 0;
  return (file) => {
    entryCount += 1;
    if (entryCount > limits.maxEntryCount) {
      throw new BombError(`package has more than ${limits.maxEntryCount} entries`);
    }
    declaredTotal += file.originalSize;
    if (declaredTotal > limits.maxInflatedBytes) {
      throw new BombError(`package declares more than ${limits.maxInflatedBytes} inflated bytes`);
    }
  };
}

export function readPackage(
  bytes: Uint8Array,
  limits: PackageLimits = TEMPLATE_PACKAGE_LIMITS,
): Outcome<PartMap, PackageReadFailure> {
  if (bytes.byteLength > limits.maxPackageBytes) {
    return failed(
      "oversize",
      `package is ${bytes.byteLength} bytes, over ${limits.maxPackageBytes}`,
    );
  }

  const guardEntry = entryGuard(limits);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter(file) {
        guardEntry(file);
        return true;
      },
    });
  } catch (caught) {
    if (caught instanceof BombError) return failed("decompression-bomb", caught.message);
    return failed(
      "not-a-package",
      "the bytes are not a readable Open Packaging Conventions archive",
    );
  }

  // Post-inflation backstop: catches an archive that UNDER-declares its uncompressed sizes in the local
  // and central directory headers, which the pre-inflation filter cannot see through.
  let inflated = 0;
  for (const content of Object.values(entries)) {
    inflated += content.byteLength;
    if (inflated > limits.maxInflatedBytes) {
      return failed("decompression-bomb", `package inflates past ${limits.maxInflatedBytes} bytes`);
    }
  }

  const parts: PartMap = new Map(Object.entries(entries));
  for (const required of REQUIRED_PARTS) {
    if (!parts.has(required)) {
      return failed("not-a-word-package", `package is missing ${required}`);
    }
  }
  return succeeded(parts);
}

// A fixed modification timestamp for every entry we write. Assembly output must be reproducible — the
// same template version plus the same merge context yields the same bytes — and a wall-clock timestamp
// in the local file header would make every re-run differ. 2000-01-01 is comfortably inside the DOS
// date range a zip local header can encode (which starts at 1980).
const FIXED_ENTRY_TIMESTAMP_MS = Date.UTC(2000, 0, 1);

export function writePackage(parts: PartMap): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of parts) entries[name] = content;
  return zipSync(entries, { mtime: FIXED_ENTRY_TIMESTAMP_MS });
}

const decoder = new TextDecoder();

export function readPartText(parts: PartMap, name: string): string | undefined {
  const content = parts.get(name);
  return content === undefined ? undefined : decoder.decode(content);
}

export function writePartText(parts: PartMap, name: string, text: string): void {
  parts.set(name, strToU8(text));
}

// True when the package declares a content type for a part it no longer contains, or contains a part it
// never declared. A package in either state is invalid, and strict validators — court e-filing among
// them — reject it. Used as an integrity assertion over emitted output rather than as a repair.
export function contentTypeOverrides(parts: PartMap): string[] {
  const xml = readPartText(parts, CONTENT_TYPES_PART) ?? "";
  const overrides: string[] = [];
  for (const match of xml.matchAll(/PartName\s*=\s*"([^"]+)"/g)) {
    const name = match[1];
    if (name !== undefined) overrides.push(name.replace(/^\//, ""));
  }
  return overrides;
}

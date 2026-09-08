// Listing a tar without extracting it: walk the member headers by ranged read, skipping each
// member's data.
//
// A tar has no directory. It is a chain of 512-byte headers, each followed by its member's data
// padded up to the next 512-byte boundary, so listing one means seeking header to header: read 512
// bytes, take the name and the size, skip the data, read the next. That is one small ranged read
// per member rather than the archive, which is what makes listing a large tar cheap.
//
// UNTRUSTED, like every container that arrived through the upload path. The size field decides
// where the next header is, so a lying size is a walk that never terminates or that seeks off the
// end; both are bounded here by an entry cap, a byte-position check against the object's real size,
// and a refusal to advance by anything that is not a positive step. A malformed record ends the
// walk with what was read so far marked truncated rather than throwing away the whole listing.
import type { ArchiveSourceBucket } from "./zip-central-directory.ts";

/**
 * What a tar member IS, as its own header declares it.
 *
 * Only a regular file has bytes to take out. The rest are entries a tar carries that name something
 * outside themselves — a link to another path, a device node, a pipe — and they matter to an
 * extractor precisely because they are not content: filing a symlink's zero bytes as a document
 * would put an empty file on the matter under a name that promises something else.
 */
export type TarEntryKind = "file" | "directory" | "link" | "other";

/** One member, in the shape every archive reader on this platform answers with. */
export interface TarEntry {
  readonly path: string;
  readonly isDirectory: boolean;
  readonly compressedSizeBytes: number;
  readonly uncompressedSizeBytes: number;
  readonly modifiedAt: string | null;
  /** What the header says this entry is, which decides whether it can be extracted at all. */
  readonly kind: TarEntryKind;
  /**
   * Where this member's bytes begin in the object. A tar stores its members whole and uncompressed,
   * so this offset and the size are the whole of what an extractor needs — there is no directory to
   * consult and no decoder to run.
   */
  readonly dataOffset: number;
}

export interface TarListing {
  readonly entries: readonly TarEntry[];
  readonly truncated: boolean;
}

const BLOCK = 512;
/** How far into the header each field sits, and how long it is. */
const NAME = { at: 0, length: 100 };
const SIZE = { at: 124, length: 12 };
const MODIFIED = { at: 136, length: 12 };
const TYPE_FLAG = 156;
/** The `prefix` field a POSIX tar uses to carry the front of a long path. */
const PREFIX = { at: 345, length: 155 };

/** GNU's long-name record: the NEXT member's path, held as this member's data. */
const TYPE_GNU_LONG_NAME = "L";

/**
 * The type flag, read as what the entry is. "0" and NUL are both a regular file — the NUL spelling
 * predates the field being defined and is still written by older tars. "7" is the contiguous file,
 * a pre-allocated-on-disk variant nobody writes any more but which still carries real data, so it
 * is a file too. "5" is a directory, "1" and "2" are a hard and a symbolic link, and "3" through
 * "6" are device nodes and pipes, which name something outside themselves rather than holding
 * content of their own.
 */
function kindOfTypeFlag(typeFlag: string, path: string): TarEntryKind {
  if (typeFlag === "5" || path.endsWith("/")) return "directory";
  if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "7") return "file";
  if (typeFlag === "1" || typeFlag === "2") return "link";
  return "other";
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/** A NUL-terminated field, trimmed of the padding tars vary in. */
function textField(block: Uint8Array, at: number, length: number): string {
  const slice = block.subarray(at, at + length);
  const end = slice.indexOf(0);
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end)).trim();
}

/**
 * A numeric field. Tar writes these as octal text, except that GNU writes a value too large for the
 * field with the high bit of the first byte set and the number big-endian binary after it.
 */
function numericField(block: Uint8Array, at: number, length: number): number | null {
  const first = block[at] ?? 0;
  if ((first & 0x80) !== 0) {
    let value = 0n;
    for (let index = at + 1; index < at + length; index += 1) {
      value = (value << 8n) | BigInt(block[index] ?? 0);
    }
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : null;
  }
  const text = textField(block, at, length);
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) return null;
  const value = Number.parseInt(text, 8);
  return Number.isSafeInteger(value) ? value : null;
}

/** A block of nothing but NULs, which is how a tar marks its end. */
function isEndBlock(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0);
}

/** Round a member's size up to the block boundary its data is padded to. */
function paddedLength(size: number): number {
  return Math.ceil(size / BLOCK) * BLOCK;
}

export interface TarListingLimits {
  readonly maxEntries: number;
}

/**
 * Read a tar's member listing over ranged reads, or null when the object is gone.
 *
 * Never reads a member's data except for a GNU long-name record, whose data IS the next member's
 * path — one small read, capped, and the only case where content is touched at all.
 */
export async function readTarListing(
  bucket: ArchiveSourceBucket,
  key: string,
  limits: TarListingLimits,
): Promise<TarListing | null> {
  const head = await bucket.head(key);
  if (head === null) return null;
  const size = head.size;

  const entries: TarEntry[] = [];
  let position = 0;
  let truncated = false;
  // Carried from a GNU long-name record onto the member that follows it.
  let pendingLongName: string | null = null;

  while (position + BLOCK <= size) {
    if (entries.length >= limits.maxEntries) {
      truncated = true;
      break;
    }
    const object = await bucket.get(key, { range: { offset: position, length: BLOCK } });
    if (object === null) return null;
    const block = new Uint8Array(await object.arrayBuffer());
    if (block.byteLength < BLOCK) {
      truncated = true;
      break;
    }
    if (isEndBlock(block)) break;

    const memberSize = numericField(block, SIZE.at, SIZE.length);
    if (memberSize === null || memberSize < 0) {
      // The field that decides where the next header sits is unreadable, so the walk cannot
      // continue honestly. What was read stays, marked short.
      truncated = true;
      break;
    }
    const typeFlag = String.fromCharCode(block[TYPE_FLAG] ?? 0);
    const dataAt = position + BLOCK;
    const nextPosition = dataAt + paddedLength(memberSize);
    // Any step that does not advance, or that leaves the object, ends the walk rather than looping.
    if (nextPosition <= position || nextPosition > size) {
      truncated = true;
      break;
    }

    if (typeFlag === TYPE_GNU_LONG_NAME) {
      // The one read of member data, and it is a path rather than content. Capped so a hostile
      // archive cannot make one name a large read.
      const cap = Math.min(memberSize, 4096);
      const nameObject = await bucket.get(key, { range: { offset: dataAt, length: cap } });
      if (nameObject === null) return null;
      const nameBytes = new Uint8Array(await nameObject.arrayBuffer());
      const end = nameBytes.indexOf(0);
      pendingLongName = decoder.decode(end === -1 ? nameBytes : nameBytes.subarray(0, end)).trim();
      position = nextPosition;
      continue;
    }

    const prefix = textField(block, PREFIX.at, PREFIX.length);
    const shortName = textField(block, NAME.at, NAME.length);
    const rawPath = pendingLongName ?? (prefix === "" ? shortName : `${prefix}/${shortName}`);
    pendingLongName = null;

    const path = normalizeTarPath(rawPath);
    if (path !== null) {
      const modifiedSeconds = numericField(block, MODIFIED.at, MODIFIED.length);
      const kind = kindOfTypeFlag(typeFlag, path);
      entries.push({
        path,
        isDirectory: kind === "directory",
        // A tar does not compress: a member occupies exactly its own length, so the two sizes are
        // the same number rather than one of them being unknown.
        compressedSizeBytes: memberSize,
        uncompressedSizeBytes: memberSize,
        modifiedAt:
          modifiedSeconds === null || modifiedSeconds <= 0
            ? null
            : new Date(modifiedSeconds * 1000).toISOString(),
        kind,
        dataOffset: dataAt,
      });
    }
    position = nextPosition;
  }

  return { entries, truncated };
}

/**
 * A member path as the listing presents it: forward slashes, no leading slash, and never a
 * traversal. Returns null for a path that is empty, absolute, or climbs — the same rule the zip
 * listing applies, so no archive can present a path that reads as somewhere else.
 */
export function normalizeTarPath(raw: string): string | null {
  const path = raw.replaceAll("\\", "/").replace(/^\/+/, "");
  if (path === "" || path === "/") return null;
  if (path.split("/").some((segment) => segment === "..")) return null;
  return path;
}

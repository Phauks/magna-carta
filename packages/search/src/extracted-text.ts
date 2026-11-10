import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import {
  matterScopedObjectDimensions,
  type ObjectDimensions,
} from "@magna-carta/object-dimensions/dimensions";
import type { Passage } from "./port.ts";

// THE KEPT TEXT of a matter's file: what one committed version extracted to, passage by passage, so
// that a search result can quote the sentence it matched.
//
// The file contents index holds which words are on which page and not the sentences, and it is asked
// by a service that is never believed about anything but candidates. So the words a reader is shown
// come from here instead: an object in the firm's own bucket, written by the index job from the one
// extraction it already made, and read by the application only for a file its own statement has
// already returned under the matter binding.
//
// IT IS A THIRD CONSUMER OF ONE EXTRACTION, never a second extraction. The passages written here
// are the ones built into the keyword split in the same job, so the page a result names and the
// sentence it quotes are one reading of the document.
//
// IT LIVES AS LONG AS THE VERSION'S OWN BYTES. A version's text is derived from the version and says
// nothing the version does not, so it is neither collected early nor kept late: whatever destroys a
// version's object destroys this one with it. Nothing destroys a committed version today, and the
// purge point in packages/file-manager/src/file-service.ts is where that will happen.

// ---- the key ---------------------------------------------------------------------------------

// Scope-free, like the version's own key: a rename or a matter reassignment moves no bytes. The
// matter is in the object's stamp. The exact bytes are a compatibility contract with every object
// already written, pinned in the test beside this file.
export const EXTRACTED_TEXT_PREFIX = "extracted-text/";

export function extractedTextObjectKey(fileId: FileId, version: number): string {
  return `${EXTRACTED_TEXT_PREFIX}${fileId}/${version}`;
}

export const EXTRACTED_TEXT_OBJECT_CLASS = "extracted-text" as const;

export function extractedTextObjectDimensions(matterId: MatterId): ObjectDimensions {
  return matterScopedObjectDimensions({ objectClass: EXTRACTED_TEXT_OBJECT_CLASS, matterId });
}

// ---- the bytes -------------------------------------------------------------------------------

// A result quotes ONE passage of a document that may run to thousands of pages, on a request a
// person is waiting for. So the object is laid out to be read in part:
//
//   - eleven bytes: the length of the directory in bytes, as ten decimal digits and a line feed;
//   - the directory: JSON naming every passage and how many bytes its text takes, in order;
//   - the passages' text, UTF-8, one after another with nothing between.
//
// A reader takes the first stretch of the object, which holds the whole directory for all but the
// very longest documents and the whole text for most, and then at most one more stretch for the
// passage it wants.
const FORMAT = 1;
const LENGTH_DIGITS = 10;
const LENGTH_FIELD_BYTES = LENGTH_DIGITS + 1;

interface Directory {
  readonly format: number;
  // [passage identifier, byte length of its text], in the order the text is laid down.
  readonly passages: readonly (readonly [string, number])[];
}

export function encodeExtractedText(passages: readonly Passage[]): Uint8Array {
  const encoder = new TextEncoder();
  const texts = passages.map((passage) => encoder.encode(passage.text));
  const directory: Directory = {
    format: FORMAT,
    passages: passages.map((passage, index) => [passage.chunkId, texts[index]?.byteLength ?? 0]),
  };
  const directoryBytes = encoder.encode(JSON.stringify(directory));
  const lengthField = encoder.encode(
    `${String(directoryBytes.byteLength).padStart(LENGTH_DIGITS, "0")}\n`,
  );
  const total =
    lengthField.byteLength +
    directoryBytes.byteLength +
    texts.reduce((sum, text) => sum + text.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of [lengthField, directoryBytes, ...texts]) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

// ---- reading one passage ---------------------------------------------------------------------

// The first stretch read. Sixty-four kibibytes holds the directory of a document of a few thousand
// pages, and the whole of a document of about twenty.
export const EXTRACTED_TEXT_FIRST_READ_BYTES = 64 * 1024;

// The most of one passage a reader takes. A page is a few kibibytes; a document read as one passage
// (plain text, a spreadsheet) can be megabytes, and a request does not hold megabytes to quote a
// sentence. A match past this point is simply not quoted.
export const LONGEST_PASSAGE_READ_BYTES = 256 * 1024;

// Reads `length` bytes from `offset`, fewer when the object ends first, or null when there is no
// such object. The application supplies it over the firm's bucket.
export type ExtractedTextRangeReader = (
  offset: number,
  length: number,
) => Promise<Uint8Array | null>;

export type ExtractedPassageOutcome =
  | { readonly kind: "text"; readonly text: string }
  // No object, or no such passage in it: a version indexed before text was kept, or a passage the
  // index names from another reading. Not a fault.
  | { readonly kind: "absent" }
  // The object is there and is not in this format. A fault, and the caller's to report.
  | { readonly kind: "malformed" };

function parseDirectory(bytes: Uint8Array): Directory | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { format, passages } = parsed as { format?: unknown; passages?: unknown };
  if (format !== FORMAT || !Array.isArray(passages)) return null;
  for (const entry of passages) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [identifier, length] = entry as unknown[];
    if (typeof identifier !== "string") return null;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) return null;
  }
  return parsed as Directory;
}

export async function readExtractedPassage(
  read: ExtractedTextRangeReader,
  chunkId: string,
): Promise<ExtractedPassageOutcome> {
  let held = await read(0, EXTRACTED_TEXT_FIRST_READ_BYTES);
  if (held === null) return { kind: "absent" };
  if (held.byteLength < LENGTH_FIELD_BYTES) return { kind: "malformed" };
  const lengthField = new TextDecoder().decode(held.subarray(0, LENGTH_FIELD_BYTES));
  if (!/^\d{10}\n$/u.test(lengthField)) return { kind: "malformed" };
  const textStart = LENGTH_FIELD_BYTES + Number(lengthField);

  if (held.byteLength < textStart) {
    // A directory longer than the first stretch: a document of several thousand passages.
    const rest = await read(held.byteLength, textStart - held.byteLength);
    if (rest === null || held.byteLength + rest.byteLength < textStart)
      return { kind: "malformed" };
    const joined = new Uint8Array(held.byteLength + rest.byteLength);
    joined.set(held, 0);
    joined.set(rest, held.byteLength);
    held = joined;
  }
  const directory = parseDirectory(held.subarray(LENGTH_FIELD_BYTES, textStart));
  if (directory === null) return { kind: "malformed" };

  let offset = textStart;
  for (const [identifier, length] of directory.passages) {
    if (identifier !== chunkId) {
      offset += length;
      continue;
    }
    const wanted = Math.min(length, LONGEST_PASSAGE_READ_BYTES);
    // A blank page. Nothing to read, and a stretch of no bytes is not a range a bucket answers.
    if (wanted === 0) return { kind: "text", text: "" };
    const bytes =
      offset + wanted <= held.byteLength
        ? held.subarray(offset, offset + wanted)
        : await read(offset, wanted);
    if (bytes === null || bytes.byteLength < wanted) return { kind: "malformed" };
    // Cut by bytes, so the last character may be cut in half; it decodes to a replacement
    // character, which is dropped instead of being shown.
    const text = new TextDecoder().decode(bytes);
    return { kind: "text", text: wanted < length ? text.replace(/\uFFFD+$/u, "") : text };
  }
  return { kind: "absent" };
}

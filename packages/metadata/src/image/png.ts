import { Unzlib } from "fflate";
import { FieldCollector, momentFromParts, textValue } from "../fields.ts";
import type { Finding } from "../model.ts";
import { readExif } from "./exif.ts";
import { readXmp } from "./xmp.ts";

const SIGNATURE_LENGTH = 8;
// Ancillary metadata chunks we strip. Structural/critical chunks (IHDR, PLTE, IDAT, IEND) and color
// chunks (iCCP, gAMA, cHRM, sRGB) are kept.
const METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

interface Chunk {
  readonly type: string;
  readonly start: number; // index of the length field
  readonly end: number; // exclusive (after CRC)
}

function walkChunks(bytes: Uint8Array): Chunk[] {
  const chunks: Chunk[] = [];
  let i = SIGNATURE_LENGTH;
  while (i + 8 <= bytes.length) {
    const length =
      (((bytes[i] ?? 0) << 24) |
        ((bytes[i + 1] ?? 0) << 16) |
        ((bytes[i + 2] ?? 0) << 8) |
        (bytes[i + 3] ?? 0)) >>>
      0;
    const type = String.fromCharCode(
      bytes[i + 4] ?? 0,
      bytes[i + 5] ?? 0,
      bytes[i + 6] ?? 0,
      bytes[i + 7] ?? 0,
    );
    const end = i + 12 + length; // 4 length + 4 type + length data + 4 crc
    if (end > bytes.length) break; // truncated chunk: stop rather than read past the buffer
    chunks.push({ type, start: i, end });
    if (type === "IEND") break;
    i = end;
  }
  return chunks;
}

// Bytes present after IEND. A decoder stops there, so anything past it rides along invisibly — the
// same appended-file hazard as data after a JPEG's end-of-image marker. The scrub already drops it
// (it copies chunks, not the tail); inspect has to say so, or the tool reports clean on a file that
// is still carrying something.
function trailingByteCount(bytes: Uint8Array, chunks: readonly Chunk[]): number {
  const last = chunks[chunks.length - 1];
  if (last === undefined || last.type !== "IEND") return 0;
  return bytes.length - last.end;
}

// A compressed text chunk inflates to at most this much; past it the text is cut. The input is fed
// to the inflater in small slices so one slice can never expand past the cap by more than deflate's
// maximum ratio, which bounds the memory a crafted chunk can claim.
const MAX_INFLATED_TEXT_BYTES = 64 * 1024;
const INFLATE_SLICE_BYTES = 1024;

class TextCapReached extends Error {}

function inflateBytes(compressed: Uint8Array): Uint8Array | undefined {
  const pieces: Uint8Array[] = [];
  let total = 0;
  const inflater = new Unzlib((chunk) => {
    pieces.push(chunk);
    total += chunk.length;
    if (total >= MAX_INFLATED_TEXT_BYTES) throw new TextCapReached();
  });
  try {
    for (let at = 0; at < compressed.length; at += INFLATE_SLICE_BYTES) {
      const end = Math.min(at + INFLATE_SLICE_BYTES, compressed.length);
      inflater.push(compressed.subarray(at, end), end === compressed.length);
    }
  } catch (error) {
    if (!(error instanceof TextCapReached)) return undefined;
  }
  const joined = new Uint8Array(Math.min(total, MAX_INFLATED_TEXT_BYTES));
  let offset = 0;
  for (const piece of pieces) {
    const room = joined.length - offset;
    if (room <= 0) break;
    joined.set(piece.subarray(0, room), offset);
    offset += Math.min(piece.length, room);
  }
  return joined;
}

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

// The keyword a text chunk is filed under: Latin-1, up to the first NUL.
function keywordOf(data: Uint8Array): { keyword: string; rest: number } | undefined {
  const end = data.indexOf(0);
  if (end <= 0 || end > 79) return undefined;
  return { keyword: latin1(data.subarray(0, end)), rest: end + 1 };
}

const XMP_KEYWORD = "XML:com.adobe.xmp";

// tEXt: keyword, NUL, Latin-1 text. zTXt: keyword, NUL, method, zlib text.
// iTXt: keyword, NUL, compressed flag, method, language, NUL, translated keyword, NUL, UTF-8 text.
function readTextChunk(type: string, data: Uint8Array, fields: FieldCollector): void {
  const header = keywordOf(data);
  if (header === undefined) return;
  const { keyword, rest } = header;
  let text: string | undefined;
  if (type === "tEXt") {
    text = latin1(data.subarray(rest, rest + MAX_INFLATED_TEXT_BYTES));
  } else if (type === "zTXt") {
    const inflated = inflateBytes(data.subarray(rest + 1));
    text = inflated === undefined ? undefined : latin1(inflated);
  } else {
    const compressed = data[rest] === 1;
    const languageEnd = data.indexOf(0, rest + 2);
    const translatedEnd = languageEnd === -1 ? -1 : data.indexOf(0, languageEnd + 1);
    if (translatedEnd === -1) return;
    const body = data.subarray(translatedEnd + 1);
    const utf8 = compressed ? inflateBytes(body) : body.subarray(0, MAX_INFLATED_TEXT_BYTES);
    text = utf8 === undefined ? undefined : new TextDecoder("utf-8").decode(utf8);
  }
  if (text === undefined) return;
  if (keyword === XMP_KEYWORD) {
    readXmp(text, fields);
    return;
  }
  fields.addNamed(keyword, textValue(text));
}

// tIME: the last modification, as seven bytes of UTC.
function readTime(data: Uint8Array, fields: FieldCollector): void {
  if (data.length < 7) return;
  const moment = momentFromParts(
    {
      year: ((data[0] ?? 0) << 8) | (data[1] ?? 0),
      month: data[2] ?? 0,
      day: data[3] ?? 0,
      hour: data[4] ?? 0,
      minute: data[5] ?? 0,
      second: data[6] ?? 0,
    },
    "Z",
  );
  if (moment !== undefined) fields.add({ name: "Modified", value: moment });
}

function readChunk(bytes: Uint8Array, chunk: Chunk, fields: FieldCollector): void {
  const data = bytes.subarray(chunk.start + 8, chunk.end - 4);
  if (chunk.type === "eXIf") readExif(data, fields);
  else if (chunk.type === "tIME") readTime(data, fields);
  else readTextChunk(chunk.type, data, fields);
}

export function inspectPngFindings(bytes: Uint8Array): Finding[] {
  const chunks = walkChunks(bytes);
  const counts = new Map<Finding["category"], number>();
  const fieldsByCategory = new Map<Finding["category"], FieldCollector>();
  for (const chunk of chunks) {
    if (!METADATA_CHUNKS.has(chunk.type)) continue;
    const category: Finding["category"] = chunk.type === "eXIf" ? "image-location" : "image-other";
    counts.set(category, (counts.get(category) ?? 0) + 1);
    const fields = fieldsByCategory.get(category) ?? new FieldCollector();
    fieldsByCategory.set(category, fields);
    readChunk(bytes, chunk, fields);
  }
  const findings: Finding[] = [];
  for (const [category, count] of counts) {
    const finding: Finding = {
      category,
      label:
        category === "image-location"
          ? "EXIF metadata (may include GPS location, device, and timestamps)"
          : "Text or timestamp metadata",
      risk: category === "image-location" ? "high" : "medium",
      count,
      defaultScrub: true,
    };
    findings.push(fieldsByCategory.get(category)?.attachTo(finding) ?? finding);
  }
  if (trailingByteCount(bytes, chunks) > 0) {
    findings.push({
      category: "image-trailing-data",
      label: "Data appended after the end of the image",
      risk: "high",
      count: 1,
      defaultScrub: true,
    });
  }
  return findings;
}

export function scrubPng(bytes: Uint8Array): Uint8Array {
  // Collect the parts to keep (signature + non-metadata chunks), then assemble via Uint8Array.set —
  // never spread a Uint8Array into push(), which overflows the call stack on large images.
  const parts: Uint8Array[] = [bytes.subarray(0, SIGNATURE_LENGTH)];
  for (const chunk of walkChunks(bytes)) {
    if (METADATA_CHUNKS.has(chunk.type)) continue;
    parts.push(bytes.subarray(chunk.start, chunk.end));
  }
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

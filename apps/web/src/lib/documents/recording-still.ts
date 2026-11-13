/*
 * A still taken from a recording, filed into the matter beside the recording it came from.
 *
 * The still is a document in its own right: it is shared, attached and exported by people who were
 * not there when it was taken, so it carries its provenance INSIDE the file as well as in its name.
 * The name says which recording and which moment ("Interview at 0-12-34.png", sorted in order in a
 * folder). The PNG's own text chunks say the rest: the recording and its version, the moment, the
 * matter, who took it and when. Those chunks travel with the file wherever it is exported, and every
 * image viewer that shows a picture's properties reads them. The upload itself is recorded like any
 * other, under the member who took it.
 *
 * Pure apart from the byte splicing, so the words and the chunk layout are tested without a browser.
 */

/** The moment as a reader writes it: H:MM:SS. */
export function momentLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
  const rest = String(whole % 60).padStart(2, "0");
  return `${String(hours)}:${minutes}:${rest}`;
}

export interface StillProvenance {
  readonly recordingName: string;
  readonly versionNumber: number;
  readonly seconds: number;
  /** The matter's title as the page shows it, or null when it could not be read. */
  readonly matterTitle: string | null;
  readonly takenBy: string | null;
  /** When the still was taken, as an ISO-8601 instant. */
  readonly takenAt: string;
}

/**
 * The text a still carries, as PNG keyword and value pairs. The keywords are the ones the PNG
 * specification registers (Title, Author, Description, Creation Time, Source, Comment), so a viewer
 * that knows the registered set labels them without being told.
 */
export function stillTextEntries(provenance: StillProvenance): readonly [string, string][] {
  const moment = momentLabel(provenance.seconds);
  const recording = `${provenance.recordingName}, version ${String(provenance.versionNumber)}`;
  const entries: [string, string][] = [
    ["Title", `${provenance.recordingName} at ${moment}`],
    [
      "Description",
      `A still taken at ${moment} from ${recording}` +
        (provenance.matterTitle === null ? "." : `, in the matter ${provenance.matterTitle}.`),
    ],
    ["Source", recording],
    ["Comment", `Moment: ${moment}`],
    ["Creation Time", provenance.takenAt],
  ];
  if (provenance.takenBy !== null) entries.push(["Author", provenance.takenBy]);
  return entries;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * One iTXt chunk: an international text chunk, uncompressed, whose value is UTF-8, so a recording
 * named in any script survives. (tEXt is Latin-1 only.)
 */
function internationalTextChunk(keyword: string, text: string): Uint8Array {
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword);
  const textBytes = encoder.encode(text);
  // keyword, NUL, compression flag 0, compression method 0, empty language tag NUL, empty
  // translated keyword NUL, then the text.
  const data = new Uint8Array(keywordBytes.length + 5 + textBytes.length);
  data.set(keywordBytes, 0);
  data.set(textBytes, keywordBytes.length + 5);
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(encoder.encode("iTXt"), 0);
  typeAndData.set(data, 4);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeAndData, 4);
  view.setUint32(8 + data.length, crc32(typeAndData));
  return chunk;
}

/**
 * The PNG with the entries written into it, just before its closing IEND chunk. Bytes that are not
 * a PNG, or a PNG with no IEND, come back unchanged: a still without its text is still the still.
 */
export function pngWithText(
  png: Uint8Array<ArrayBuffer>,
  entries: readonly [string, string][],
): Uint8Array<ArrayBuffer> {
  if (png.length < 20 || PNG_SIGNATURE.some((byte, index) => png[index] !== byte)) return png;
  // IEND is the last chunk, twelve bytes long with no data.
  const iend = png.length - 12;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (
    view.getUint32(iend) !== 0 ||
    new TextDecoder().decode(png.subarray(iend + 4, iend + 8)) !== "IEND"
  ) {
    return png;
  }
  const chunks = entries.map(([keyword, text]) => internationalTextChunk(keyword, text));
  const added = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(png.length + added);
  out.set(png.subarray(0, iend), 0);
  let at = iend;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  out.set(png.subarray(iend), at);
  return out;
}

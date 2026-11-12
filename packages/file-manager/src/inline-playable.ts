// Whether a stored video can be handed to a browser's own media decoder and play there: the verdict
// the preview gate (preview-policy.ts) keys off, decided from the file's container structure and the
// codecs it names. The sniffed content type only names the CONTAINER, and a container says little:
// an MP4 holding H.264 plays in every browser, while the same box structure holding ProRes (what an
// editor exports) plays in none. So this reads past the magic bytes to the track descriptions, and
// answers one of three things:
//
//   "playable"      every audio and video track is a codec a current browser can decode
//   "download-only" a track names a codec no browser decodes, so the player is never offered
//   "indeterminate" the structure could not be read within the bounds below
//
// "playable" is a promise about browsers in general, not about the one reading: HEVC plays in Safari,
// Edge and Chrome where the device decodes it, and a Matroska file plays in Chrome and Edge but not in
// Firefox. The player is the last word for the browser in front of it: one that cannot decode the
// address raises a media error, and the player offers the download in its place. What this refuses
// is what NO browser plays, and sound a browser would silently drop (AC-3, DTS), because a recording
// that plays with no sound reads as a recording with nothing said.
//
// Only "playable" ever unlocks inline playback, so every doubt resolves away from it. The bytes still
// reach only the browser's media decoder when it does, never a document parser; the cookieless
// delivery in docs/conventions/security.md is what makes a wrong verdict an undecodable video rather
// than anything worse.
//
// READS ARE RANGED AND BOUNDED. A deposition recording is gigabytes and its track table can sit at
// the END of the file (a recorder that never moved it forward), so the reader is a byte-range port and
// the walk reads only box headers until it finds the table, then the table alone. Every read is
// capped, and a file that would need more than the caps allow is "indeterminate" rather than an
// unbounded allocation in a Worker isolate.

/** The answer, as the `file_version.inline_playable` column stores it. */
export type InlinePlayableVerdict = "playable" | "download-only" | "indeterminate";

/** Reads a span of a stored object. `read` returns at most `length` bytes, fewer only at the end. */
export interface ByteRangeReader {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * The sniffed types worth reading at all. Anything else is not a video container a browser could
 * play, so it is never assessed: its verdict stays absent, which the preview gate already reads as
 * download-only.
 */
const ISO_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
]);
const MATROSKA_TYPES: ReadonlySet<string> = new Set(["video/webm", "video/x-matroska"]);

export function isPlayabilityCandidate(sniffedContentType: string | null): boolean {
  if (sniffedContentType === null) return false;
  return ISO_MEDIA_TYPES.has(sniffedContentType) || MATROSKA_TYPES.has(sniffedContentType);
}

/**
 * The largest track table read into memory. A two-hour recording's table is a few megabytes (it
 * lists every sample's size and offset); a table past this is a file the gate declines to judge.
 */
export const MOVIE_TABLE_CEILING_BYTES = 16 * 1024 * 1024;
/** The most top-level boxes or elements walked before giving up on finding the table. */
const MAXIMUM_TOP_LEVEL_ENTRIES = 64;
/** The largest track list read from a WebM file. Real ones are a few hundred bytes. */
const TRACK_LIST_CEILING_BYTES = 1024 * 1024;

/**
 * The codecs a current browser decodes inside an MP4 or QuickTime container, by the four-letter
 * sample-entry code the track table names them with. H.264 (avc1/avc3), HEVC (hvc1/hev1, what a
 * phone records), AV1 (av01) and VP9 (vp09) for pictures; AAC (mp4a), Opus and FLAC for sound.
 */
const ISO_VIDEO_CODECS: ReadonlySet<string> = new Set([
  "avc1",
  "avc3",
  "hvc1",
  "hev1",
  "av01",
  "vp09",
]);
const ISO_AUDIO_CODECS: ReadonlySet<string> = new Set(["mp4a", "Opus", "fLaC"]);
/**
 * The same promise for WebM and Matroska, by codec identifier. AAC is matched as a family because
 * Matroska spells its profiles into the identifier (`A_AAC/MPEG4/LC`).
 */
const MATROSKA_CODECS: ReadonlySet<string> = new Set([
  "V_VP8",
  "V_VP9",
  "V_AV1",
  "V_MPEG4/ISO/AVC",
  "V_MPEGH/ISO/HEVC",
  "A_OPUS",
  "A_VORBIS",
  "A_FLAC",
  "A_AAC",
]);

function matroskaCodecPlays(codec: string): boolean {
  return MATROSKA_CODECS.has(codec) || codec.startsWith("A_AAC/");
}

export async function assessInlinePlayable(
  sniffedContentType: string | null,
  reader: ByteRangeReader,
): Promise<InlinePlayableVerdict> {
  if (sniffedContentType === null) return "indeterminate";
  try {
    if (ISO_MEDIA_TYPES.has(sniffedContentType)) return await assessIsoMedia(reader);
    if (MATROSKA_TYPES.has(sniffedContentType)) return await assessMatroska(reader);
  } catch (error) {
    // A structure that contradicts itself (a length running past the end, a size that cannot be
    // represented) is a file the gate cannot judge. Anything else is a real fault and is raised.
    if (error instanceof MalformedMediaError) return "indeterminate";
    throw error;
  }
  return "download-only";
}

class MalformedMediaError extends Error {}

function fourCharacterCode(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new MalformedMediaError("truncated 32-bit field");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function readUint64(bytes: Uint8Array, offset: number): number {
  if (offset + 8 > bytes.length) throw new MalformedMediaError("truncated 64-bit field");
  const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new MalformedMediaError("box too large");
  return Number(value);
}

// ---- ISO base media (MP4, QuickTime) ----------------------------------------------------------

interface IsoBox {
  readonly type: string;
  /** Where the box's content starts, after its header. */
  readonly contentStart: number;
  /** Where the box ends (exclusive). */
  readonly end: number;
}

/** Reads one box header at `offset` within `bytes`, whose own length bounds a box that says "to end". */
function isoBoxAt(bytes: Uint8Array, offset: number, limit: number): IsoBox {
  const declared = readUint32(bytes, offset);
  const type = fourCharacterCode(bytes, offset + 4);
  let headerLength = 8;
  let size = declared;
  if (declared === 1) {
    size = readUint64(bytes, offset + 8);
    headerLength = 16;
  } else if (declared === 0) {
    size = limit - offset;
  }
  if (size < headerLength || offset + size > limit) {
    throw new MalformedMediaError(`box ${type} overruns its container`);
  }
  return { type, contentStart: offset + headerLength, end: offset + size };
}

function isoChildren(bytes: Uint8Array, start: number, end: number): IsoBox[] {
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const box = isoBoxAt(bytes, offset, end);
    boxes.push(box);
    offset = box.end;
  }
  return boxes;
}

function isoChild(bytes: Uint8Array, parent: IsoBox, type: string): IsoBox | undefined {
  return isoChildren(bytes, parent.contentStart, parent.end).find((box) => box.type === type);
}

async function assessIsoMedia(reader: ByteRangeReader): Promise<InlinePlayableVerdict> {
  // Walk the top level by headers alone until the movie box turns up, wherever it is.
  let offset = 0;
  for (let walked = 0; walked < MAXIMUM_TOP_LEVEL_ENTRIES && offset + 8 <= reader.size; walked++) {
    const header = await reader.read(offset, 16);
    const relative = isoBoxAt(
      // A header names the box's full size, which may run far past the sixteen bytes read; the
      // bound handed in is the object's own remaining length, measured from this header.
      header,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const size = relative.end === Number.MAX_SAFE_INTEGER ? reader.size - offset : relative.end;
    if (offset + size > reader.size) return "indeterminate";
    if (relative.type === "moov") {
      if (size > MOVIE_TABLE_CEILING_BYTES) return "indeterminate";
      const movie = await reader.read(offset, size);
      if (movie.length !== size) return "indeterminate";
      return judgeMovie(movie, isoBoxAt(movie, 0, movie.length));
    }
    offset += size;
  }
  return "indeterminate";
}

function judgeMovie(bytes: Uint8Array, movie: IsoBox): InlinePlayableVerdict {
  let tracksJudged = 0;
  for (const track of isoChildren(bytes, movie.contentStart, movie.end)) {
    if (track.type !== "trak") continue;
    const media = isoChild(bytes, track, "mdia");
    if (media === undefined) return "indeterminate";
    const handler = isoChild(bytes, media, "hdlr");
    if (handler === undefined) return "indeterminate";
    // A full box: one byte of version and three of flags, then four predefined bytes, then the type.
    const handlerType = fourCharacterCode(bytes, handler.contentStart + 8);
    if (handlerType !== "vide" && handlerType !== "soun") continue;
    const information = isoChild(bytes, media, "minf");
    const sampleTable =
      information === undefined ? undefined : isoChild(bytes, information, "stbl");
    const descriptions =
      sampleTable === undefined ? undefined : isoChild(bytes, sampleTable, "stsd");
    if (descriptions === undefined) return "indeterminate";
    // Version and flags, then the entry count, then the first sample entry's own box header.
    const entryCount = readUint32(bytes, descriptions.contentStart + 4);
    if (entryCount === 0) return "indeterminate";
    const firstEntry = isoBoxAt(bytes, descriptions.contentStart + 8, descriptions.end);
    const supported = handlerType === "vide" ? ISO_VIDEO_CODECS : ISO_AUDIO_CODECS;
    if (!supported.has(firstEntry.type)) return "download-only";
    tracksJudged++;
  }
  return tracksJudged > 0 ? "playable" : "indeterminate";
}

// ---- Matroska (WebM) ---------------------------------------------------------------------------

const EBML_HEADER = 0x1a45dfa3;
const EBML_DOCUMENT_TYPE = 0x4282;
const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const CODEC_IDENTIFIER = 0x86;
const CLUSTER = 0x1f43b675;
const VIDEO_TRACK = 1;
const AUDIO_TRACK = 2;

interface EbmlElement {
  readonly id: number;
  readonly contentStart: number;
  /** Where the element ends (exclusive), or null where its size is declared unknown. */
  readonly end: number | null;
}

function variableLengthWidth(firstByte: number): number {
  for (let width = 1; width <= 8; width++) {
    if ((firstByte & (0x100 >> width)) !== 0) return width;
  }
  throw new MalformedMediaError("invalid variable-length integer");
}

function ebmlElementAt(bytes: Uint8Array, offset: number): EbmlElement {
  const firstIdentifierByte = bytes[offset];
  if (firstIdentifierByte === undefined) throw new MalformedMediaError("truncated element");
  const identifierWidth = variableLengthWidth(firstIdentifierByte);
  if (identifierWidth > 4) throw new MalformedMediaError("element identifier too wide");
  let id = 0;
  for (let index = 0; index < identifierWidth; index++) {
    const byte = bytes[offset + index];
    if (byte === undefined) throw new MalformedMediaError("truncated identifier");
    id = id * 256 + byte;
  }
  const sizeOffset = offset + identifierWidth;
  const firstSizeByte = bytes[sizeOffset];
  if (firstSizeByte === undefined) throw new MalformedMediaError("truncated size");
  const sizeWidth = variableLengthWidth(firstSizeByte);
  let size = firstSizeByte & (0xff >> sizeWidth);
  let allOnes = size === 0xff >> sizeWidth;
  for (let index = 1; index < sizeWidth; index++) {
    const byte = bytes[sizeOffset + index];
    if (byte === undefined) throw new MalformedMediaError("truncated size");
    size = size * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  if (size > Number.MAX_SAFE_INTEGER) throw new MalformedMediaError("element too large");
  const contentStart = sizeOffset + sizeWidth;
  return { id, contentStart, end: allOnes ? null : contentStart + size };
}

function ebmlChildren(bytes: Uint8Array, start: number, end: number): EbmlElement[] {
  const elements: EbmlElement[] = [];
  let offset = start;
  while (offset < end) {
    const element = ebmlElementAt(bytes, offset);
    if (element.end === null || element.end > end) {
      throw new MalformedMediaError("child overruns its parent");
    }
    elements.push(element);
    offset = element.end;
  }
  return elements;
}

function ebmlText(bytes: Uint8Array, element: EbmlElement): string {
  const end = element.end ?? element.contentStart;
  // Strings may be padded with zero bytes to their declared length.
  return new TextDecoder().decode(bytes.subarray(element.contentStart, end)).replace(/\0+$/, "");
}

function ebmlUnsigned(bytes: Uint8Array, element: EbmlElement): number {
  let value = 0;
  for (let index = element.contentStart; index < (element.end ?? index); index++) {
    value = value * 256 + (bytes[index] ?? 0);
  }
  return value;
}

/** The widest an element header can be: a four-byte identifier and an eight-byte size. */
const EBML_HEADER_WINDOW = 12;

async function assessMatroska(reader: ByteRangeReader): Promise<InlinePlayableVerdict> {
  const leading = await reader.read(0, Math.min(reader.size, 4096));
  const header = ebmlElementAt(leading, 0);
  if (header.id !== EBML_HEADER || header.end === null) return "indeterminate";
  if (header.end > leading.length) return "indeterminate";
  const documentType = ebmlChildren(leading, header.contentStart, header.end).find(
    (element) => element.id === EBML_DOCUMENT_TYPE,
  );
  // WebM is Matroska's browser profile; a general Matroska file is judged by the same track list,
  // since what decides whether it plays is the codecs it carries, not which profile it declares.
  if (documentType === undefined) return "indeterminate";
  const profile = ebmlText(leading, documentType);
  if (profile !== "webm" && profile !== "matroska") return "download-only";
  const segmentHeader = await reader.read(header.end, EBML_HEADER_WINDOW);
  const segment = ebmlElementAt(segmentHeader, 0);
  if (segment.id !== SEGMENT) return "indeterminate";
  const segmentEnd =
    segment.end === null ? reader.size : Math.min(reader.size, header.end + segment.end);
  // Walk the segment's children by header until the track list turns up. The clusters hold the
  // media itself; reaching one first means the list is not where a player would look for it either.
  let offset = header.end + segment.contentStart;
  for (let walked = 0; walked < MAXIMUM_TOP_LEVEL_ENTRIES && offset < segmentEnd; walked++) {
    const window = await reader.read(offset, EBML_HEADER_WINDOW);
    const element = ebmlElementAt(window, 0);
    if (element.id === CLUSTER || element.end === null) return "indeterminate";
    if (element.id === TRACKS) {
      if (element.end > TRACK_LIST_CEILING_BYTES) return "indeterminate";
      const tracks = await reader.read(offset, element.end);
      if (tracks.length !== element.end) return "indeterminate";
      return judgeWebmTracks(tracks, element);
    }
    offset += element.end;
  }
  return "indeterminate";
}

function judgeWebmTracks(bytes: Uint8Array, tracks: EbmlElement): InlinePlayableVerdict {
  let tracksJudged = 0;
  for (const entry of ebmlChildren(bytes, tracks.contentStart, tracks.end ?? bytes.length)) {
    if (entry.id !== TRACK_ENTRY || entry.end === null) continue;
    const fields = ebmlChildren(bytes, entry.contentStart, entry.end);
    const typeField = fields.find((field) => field.id === TRACK_TYPE);
    const codecField = fields.find((field) => field.id === CODEC_IDENTIFIER);
    if (typeField === undefined || codecField === undefined) return "indeterminate";
    const trackType = ebmlUnsigned(bytes, typeField);
    if (trackType !== VIDEO_TRACK && trackType !== AUDIO_TRACK) continue;
    if (!matroskaCodecPlays(ebmlText(bytes, codecField))) return "download-only";
    tracksJudged++;
  }
  return tracksJudged > 0 ? "playable" : "indeterminate";
}

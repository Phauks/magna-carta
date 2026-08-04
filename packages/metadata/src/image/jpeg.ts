import type { Finding } from "../model.ts";

// Markers that carry metadata we strip. APP1 (EXIF or XMP), APP13 (IPTC/Photoshop), APP14 (Adobe),
// COM (free-text comment). APP0 (JFIF) is structural and kept.
const APP1 = 0xe1;
const APP13 = 0xed;
const APP14 = 0xee;
const COM = 0xfe;
const SOS = 0xda;
const EOI = 0xd9;
const TEM = 0x01;
const RST_FIRST = 0xd0;
const RST_LAST = 0xd7;

// Thrown when the marker structure does not parse. Mapped to the "corrupt" failure at the port
// boundary. Refusing is the only safe answer: a walk that has lost sync cannot tell metadata from
// picture, and emitting whatever it managed to collect would hand back a destroyed image that still
// looks like a successful scrub.
export class MalformedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedImageError";
  }
}

interface Segment {
  readonly marker: number;
  readonly start: number; // index of 0xFF
  readonly end: number; // exclusive
  readonly payloadStart: number;
}

// Walk marker segments up to (and excluding) SOS. Returns the parsed segments and the offset where
// the entropy-coded scan begins (the SOS marker itself).
function walkSegments(bytes: Uint8Array): { segments: Segment[]; scanStart: number } {
  const segments: Segment[] = [];
  let i = 2; // skip SOI (FF D8)
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) throw new MalformedImageError("expected a marker");
    const marker = bytes[i + 1] ?? 0;
    // Any number of 0xFF bytes may pad the space before a marker.
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === SOS) return { segments, scanStart: i };
    if (marker === EOI) throw new MalformedImageError("end of image before any scan");
    // Standalone markers carry no length field.
    if (marker === TEM || (marker >= RST_FIRST && marker <= RST_LAST)) {
      i += 2;
      continue;
    }
    if (i + 3 >= bytes.length) throw new MalformedImageError("truncated segment header");
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    const end = i + 2 + length;
    if (length < 2 || end > bytes.length)
      throw new MalformedImageError("segment length out of range");
    segments.push({ marker, start: i, end, payloadStart: i + 4 });
    i = end;
  }
  throw new MalformedImageError("no scan found");
}

// Index of the 0xFF of the EOI marker that ends the image, searching from the start of the scan.
// Inside entropy-coded data a literal 0xFF is always byte-stuffed as FF 00, and the only markers
// that legitimately appear between scans are restarts and the headers of further scans, so the first
// FF D9 at or after the scan is the real end of the image. Returns -1 when the stream is truncated.
function findEndOfImage(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === EOI) return i;
  }
  return -1;
}

// Bytes present after the end of the image. A JPEG reader stops at EOI, so anything past it is
// invisible in every viewer while travelling with the file: a motion-photo video, a second image, or
// an appended archive in a polyglot file.
function trailingByteCount(bytes: Uint8Array, scanStart: number): number {
  const endOfImage = findEndOfImage(bytes, scanStart);
  return endOfImage === -1 ? 0 : bytes.length - (endOfImage + 2);
}

function payloadStartsWith(bytes: Uint8Array, at: number, ascii: string): boolean {
  for (let k = 0; k < ascii.length; k++) {
    if (bytes[at + k] !== ascii.charCodeAt(k)) return false;
  }
  return true;
}

function classify(bytes: Uint8Array, segment: Segment): Finding["category"] | undefined {
  if (segment.marker === APP1) {
    if (payloadStartsWith(bytes, segment.payloadStart, "Exif\0\0")) return "image-location";
    if (payloadStartsWith(bytes, segment.payloadStart, "http://ns.adobe.com/xap/")) {
      return "image-software";
    }
    return "image-other";
  }
  if (segment.marker === APP13 || segment.marker === APP14) return "image-software";
  if (segment.marker === COM) return "image-other";
  return undefined;
}

function isMetadataSegment(category: Finding["category"] | undefined): boolean {
  return category !== undefined;
}

export function inspectJpegFindings(bytes: Uint8Array): Finding[] {
  const { segments, scanStart } = walkSegments(bytes);
  const counts = new Map<Finding["category"], number>();
  for (const segment of segments) {
    const category = classify(bytes, segment);
    if (category !== undefined) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const labels: Record<string, string> = {
    "image-location": "EXIF metadata (may include GPS location, device, and timestamps)",
    "image-software": "Editing-software / XMP metadata",
    "image-other": "Other embedded metadata or comments",
  };
  const findings: Finding[] = [];
  for (const [category, count] of counts) {
    findings.push({
      category,
      label: labels[category] ?? "Embedded metadata",
      risk: category === "image-location" ? "high" : "medium",
      count,
      defaultScrub: true,
    });
  }
  if (trailingByteCount(bytes, scanStart) > 0) {
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

export function scrubJpeg(bytes: Uint8Array): Uint8Array {
  const { segments, scanStart } = walkSegments(bytes);
  // Collect the parts to keep (no per-byte spread — large scans would overflow the call stack).
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]; // SOI
  for (const segment of segments) {
    if (!isMetadataSegment(classify(bytes, segment))) {
      parts.push(bytes.subarray(segment.start, segment.end));
    }
  }
  // The entropy-coded scan, truncated at EOI: everything after it is not part of the picture and no
  // reader would show it, so a copy that kept it would carry a whole embedded file through a scrub.
  const endOfImage = findEndOfImage(bytes, scanStart);
  parts.push(bytes.subarray(scanStart, endOfImage === -1 ? bytes.length : endOfImage + 2));

  let total = 0;
  for (const part of parts) total += part.length;
  const assembled = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    assembled.set(part, offset);
    offset += part.length;
  }

  // Guard: ensure EOI terminates the stream even for a truncated input.
  if (
    assembled.length < 2 ||
    assembled[assembled.length - 2] !== 0xff ||
    assembled[assembled.length - 1] !== EOI
  ) {
    const withEoi = new Uint8Array(assembled.length + 2);
    withEoi.set(assembled, 0);
    withEoi.set([0xff, EOI], assembled.length);
    return withEoi;
  }
  return assembled;
}

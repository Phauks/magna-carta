import type { Finding } from "../model.ts";

// Markers that carry metadata we strip. APP1 (EXIF or XMP), APP13 (IPTC/Photoshop), APP14 (Adobe),
// COM (free-text comment). APP0 (JFIF) is structural and kept.
const APP1 = 0xe1;
const APP13 = 0xed;
const APP14 = 0xee;
const COM = 0xfe;
const SOS = 0xda;
const EOI = 0xd9;

interface Segment {
  readonly marker: number;
  readonly start: number; // index of 0xFF
  readonly end: number; // exclusive
  readonly payloadStart: number;
}

// Walk marker segments up to (and excluding) SOS. Returns the parsed segments and the offset where
// the entropy-coded scan begins (the SOS marker itself), which is copied verbatim on strip.
function walkSegments(bytes: Uint8Array): { segments: Segment[]; scanStart: number } {
  const segments: Segment[] = [];
  let i = 2; // skip SOI (FF D8)
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === SOS) return { segments, scanStart: i };
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const end = i + 2 + len;
    segments.push({ marker, start: i, end, payloadStart: i + 4 });
    i = end;
  }
  return { segments, scanStart: bytes.length };
}

function payloadStartsWith(bytes: Uint8Array, at: number, ascii: string): boolean {
  for (let k = 0; k < ascii.length; k++) {
    if (bytes[at + k] !== ascii.charCodeAt(k)) return false;
  }
  return true;
}

function classify(bytes: Uint8Array, seg: Segment): Finding["category"] | undefined {
  if (seg.marker === APP1) {
    if (payloadStartsWith(bytes, seg.payloadStart, "Exif\0\0")) return "image-location";
    if (payloadStartsWith(bytes, seg.payloadStart, "http://ns.adobe.com/xap/")) {
      return "image-software";
    }
    return "image-other";
  }
  if (seg.marker === APP13 || seg.marker === APP14) return "image-software";
  if (seg.marker === COM) return "image-other";
  return undefined;
}

function isMetadataSegment(category: Finding["category"] | undefined): boolean {
  return category !== undefined;
}

export function inspectJpegFindings(bytes: Uint8Array): Finding[] {
  const { segments } = walkSegments(bytes);
  const counts = new Map<Finding["category"], number>();
  for (const seg of segments) {
    const category = classify(bytes, seg);
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
  return findings;
}

export function scrubJpeg(bytes: Uint8Array): Uint8Array {
  const { segments, scanStart } = walkSegments(bytes);
  // Collect the parts to keep (no per-byte spread — large scans would overflow the call stack).
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]; // SOI
  for (const seg of segments) {
    if (!isMetadataSegment(classify(bytes, seg))) parts.push(bytes.subarray(seg.start, seg.end));
  }
  // The entropy-coded scan and everything after (includes EOI) copied verbatim.
  parts.push(bytes.subarray(scanStart));

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

import type { Finding } from "../model.ts";

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
    const len = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const end = i + 12 + len; // 4 length + 4 type + len data + 4 crc
    chunks.push({ type, start: i, end });
    if (type === "IEND") break;
    i = end;
  }
  return chunks;
}

export function inspectPngFindings(bytes: Uint8Array): Finding[] {
  const counts = new Map<Finding["category"], number>();
  for (const c of walkChunks(bytes)) {
    if (!METADATA_CHUNKS.has(c.type)) continue;
    const category: Finding["category"] = c.type === "eXIf" ? "image-location" : "image-other";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const findings: Finding[] = [];
  for (const [category, count] of counts) {
    findings.push({
      category,
      label:
        category === "image-location"
          ? "EXIF metadata (may include GPS location, device, and timestamps)"
          : "Text or timestamp metadata",
      risk: category === "image-location" ? "high" : "medium",
      count,
      defaultScrub: true,
    });
  }
  return findings;
}

export function scrubPng(bytes: Uint8Array): Uint8Array {
  // Collect the parts to keep (signature + non-metadata chunks), then assemble via Uint8Array.set —
  // never spread a Uint8Array into push(), which overflows the call stack on large images.
  const parts: Uint8Array[] = [bytes.subarray(0, SIGNATURE_LENGTH)];
  for (const c of walkChunks(bytes)) {
    if (METADATA_CHUNKS.has(c.type)) continue;
    parts.push(bytes.subarray(c.start, c.end));
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

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

export function inspectPngFindings(bytes: Uint8Array): Finding[] {
  const chunks = walkChunks(bytes);
  const counts = new Map<Finding["category"], number>();
  for (const chunk of chunks) {
    if (!METADATA_CHUNKS.has(chunk.type)) continue;
    const category: Finding["category"] = chunk.type === "eXIf" ? "image-location" : "image-other";
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

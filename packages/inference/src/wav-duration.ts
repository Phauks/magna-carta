// The playing time of a RIFF/WAVE file, read from its own header: the `data` chunk's byte length over
// the `fmt ` chunk's byte rate. Pure and total — anything that is not a readable WAV yields 0 rather
// than a throw, because the callers use this as a fallback measure and a guess dressed as a duration
// would meter audio nobody sent.
//
// It walks the chunk list rather than assuming the canonical 44-byte header, because a writer may put
// other chunks (LIST, fact) between `fmt ` and `data`, and a fixed offset would then read a size field
// out of the wrong chunk.

function fourCharacterCode(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
// Within the `fmt ` chunk body: format (2), channels (2), sample rate (4), then the byte rate (4).
const BYTE_RATE_OFFSET_IN_FORMAT = 8;

export function wavAudioSeconds(audio: Uint8Array): number {
  if (audio.byteLength < RIFF_HEADER_BYTES) return 0;
  if (fourCharacterCode(audio, 0) !== "RIFF" || fourCharacterCode(audio, 8) !== "WAVE") return 0;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  let byteRate = 0;
  let offset = RIFF_HEADER_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= audio.byteLength) {
    const chunkId = fourCharacterCode(audio, offset);
    const declaredSize = view.getUint32(offset + 4, true);
    const bodyStart = offset + CHUNK_HEADER_BYTES;
    if (chunkId === "fmt " && bodyStart + BYTE_RATE_OFFSET_IN_FORMAT + 4 <= audio.byteLength) {
      byteRate = view.getUint32(bodyStart + BYTE_RATE_OFFSET_IN_FORMAT, true);
    }
    if (chunkId === "data") {
      if (byteRate === 0) return 0;
      // A streamed writer may leave the size unset (0 or 0xFFFFFFFF) or overstate it; the bytes
      // actually present are the bound either way.
      const presentBytes = audio.byteLength - bodyStart;
      const dataBytes =
        declaredSize === 0 || declaredSize > presentBytes ? presentBytes : declaredSize;
      return dataBytes / byteRate;
    }
    // Chunk bodies are padded to an even length.
    offset = bodyStart + declaredSize + (declaredSize % 2);
  }
  return 0;
}

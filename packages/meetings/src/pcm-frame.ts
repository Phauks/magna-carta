// ONE FRAME OF A RECORDED TRACK, AS THE ROUTING SERVICE SENDS IT — and the two pieces of arithmetic a
// recorder does to it.
//
// The routing service's WebSocket adapter converts a participant's Opus track to 16-bit signed
// little-endian PCM at 48 kHz, two channels, and sends it one frame per message wrapped in a Protocol
// Buffers envelope with three fields: a sequence number, a timestamp and the payload. Three fields —
// two varints and a length-delimited byte string — are a reader of a few dozen lines, so this is
// written here rather than adding a protobuf runtime for them: a dependency is a supply chain and a
// parse surface, and this one would have bought nothing a loop over the wire format does not.
//
// IT IS A PARSER OF UNTRUSTED BYTES, and it is written as one. It never reads past the end of the
// buffer, refuses a varint longer than ten bytes or larger than a safe integer, refuses a payload
// longer than the adapter's own message ceiling, skips a field it does not know by its wire type, and
// answers a malformed frame with `null` rather than a throw — the recorder counts the frame as dropped
// and carries on, because one bad message must never end a recording.
//
// Pure TypeScript with no binding and no clock: the recorder in the Worker is the only caller, and a
// test drives every branch with hand-built envelopes.

/**
 * THE ENVELOPE'S FIELD NUMBERS, as the adapter's published packet schema declares them
 * (`sequenceNumber = 1`, `timestamp = 2`, `payload = 5`). Named once, because the experiment that
 * proves the sink against the live routing service is also the one that confirms them; if it shows a
 * different numbering, this is the one place it changes.
 */
export const PCM_FRAME_SEQUENCE_NUMBER_FIELD = 1;
export const PCM_FRAME_TIMESTAMP_FIELD = 2;
export const PCM_FRAME_PAYLOAD_FIELD = 5;

/** The adapter's own ceiling on one message: 32 KiB. A payload past it is not one the adapter sent. */
export const MAX_PCM_FRAME_PAYLOAD_BYTES = 32 * 1024;

/** The adapter's sample rate, and its channel count before the recorder folds them into one. */
export const PCM_SAMPLE_RATE = 48_000;
export const PCM_INPUT_CHANNELS = 2;

/** Bytes per sample: 16-bit linear PCM. */
export const PCM_BYTES_PER_SAMPLE = 2;

/** One decoded envelope. A field the envelope did not carry reads as zero, which is protobuf's default. */
export interface PcmFrame {
  readonly sequenceNumber: number;
  readonly timestamp: number;
  readonly payload: Uint8Array;
}

// The four wire types a proto3 message can carry. Groups (3 and 4) are proto2-only and never appear in
// this envelope; meeting one is a malformed frame.
const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

// A varint is at most ten bytes for a 64-bit value; anything longer is not a varint.
const MAX_VARINT_BYTES = 10;

/** A varint and where the next field starts, or null when the bytes are not one. */
function readVarint(
  bytes: Uint8Array,
  offset: number,
): { readonly value: number; readonly next: number } | null {
  let value = 0;
  let multiplier = 1;
  for (let index = 0; index < MAX_VARINT_BYTES; index += 1) {
    const position = offset + index;
    if (position >= bytes.length) return null;
    const byte = bytes[position] ?? 0;
    value += (byte & 0x7f) * multiplier;
    // A value no JavaScript number can carry exactly is a frame this reader will not guess at.
    if (value > Number.MAX_SAFE_INTEGER) return null;
    if ((byte & 0x80) === 0) return { value, next: position + 1 };
    multiplier *= 128;
  }
  return null;
}

/**
 * Decodes one adapter envelope, or answers null for bytes that are not one.
 *
 * Unknown fields are skipped by their wire type, so a later revision of the envelope that adds a field
 * keeps decoding. A payload absent from the envelope decodes as empty, which the recorder records as a
 * frame that carried nothing.
 */
export function decodePcmFrame(bytes: Uint8Array): PcmFrame | null {
  let sequenceNumber = 0;
  let timestamp = 0;
  let payload: Uint8Array = new Uint8Array(0);
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (key === null) return null;
    offset = key.next;
    const field = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    if (field === 0) return null;

    if (wireType === WIRE_VARINT) {
      const read = readVarint(bytes, offset);
      if (read === null) return null;
      offset = read.next;
      if (field === PCM_FRAME_SEQUENCE_NUMBER_FIELD) sequenceNumber = read.value;
      else if (field === PCM_FRAME_TIMESTAMP_FIELD) timestamp = read.value;
      continue;
    }
    if (wireType === WIRE_LENGTH_DELIMITED) {
      const length = readVarint(bytes, offset);
      if (length === null) return null;
      offset = length.next;
      const end = offset + length.value;
      if (end > bytes.length) return null;
      if (field === PCM_FRAME_PAYLOAD_FIELD) {
        if (length.value > MAX_PCM_FRAME_PAYLOAD_BYTES) return null;
        payload = bytes.subarray(offset, end);
      }
      offset = end;
      continue;
    }
    if (wireType === WIRE_FIXED64) {
      if (offset + 8 > bytes.length) return null;
      offset += 8;
      continue;
    }
    if (wireType === WIRE_FIXED32) {
      if (offset + 4 > bytes.length) return null;
      offset += 4;
      continue;
    }
    return null;
  }
  return { sequenceNumber, timestamp, payload };
}

/**
 * Two channels folded into one, by averaging each pair of samples.
 *
 * ADDITION, NOT SIGNAL PROCESSING, and it halves everything downstream — the staged bytes, the
 * compose, the filed document. The average of two 16-bit samples is always a 16-bit sample, so there
 * is nothing to saturate; whether the adapter emits true stereo or a mono microphone copied to both
 * channels, the average is the right answer either way. A trailing partial sample pair is dropped: it
 * is half of a moment, and no frame the adapter sends ends in one.
 */
export function downmixToMono(payload: Uint8Array): Int16Array {
  const bytesPerPair = PCM_BYTES_PER_SAMPLE * PCM_INPUT_CHANNELS;
  const pairs = Math.floor(payload.length / bytesPerPair);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const mono = new Int16Array(pairs);
  for (let index = 0; index < pairs; index += 1) {
    const left = view.getInt16(index * bytesPerPair, true);
    const right = view.getInt16(index * bytesPerPair + PCM_BYTES_PER_SAMPLE, true);
    mono[index] = Math.floor((left + right) / 2);
  }
  return mono;
}

/** Mono samples as the little-endian bytes they are staged as. */
export function monoToBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * PCM_BYTES_PER_SAMPLE);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * PCM_BYTES_PER_SAMPLE, samples[index] ?? 0, true);
  }
  return bytes;
}

// Sequence numbers are 32-bit and wrap; the distance between two of them is measured the way a
// receiver of any wrapping counter measures it.
const SEQUENCE_SPACE = 2 ** 32;

/**
 * HOW MANY FRAMES NEVER ARRIVED between the last one the recorder took and this one.
 *
 * Zero for the next frame in order, and for the first frame of a track (there is nothing to have
 * missed). A frame at or behind the last one taken — a duplicate, or one reordered behind a later one
 * — answers `null`: it is already accounted for, either as itself or as the silence written in its
 * place, and taking it again would move every sample after it.
 *
 * A gap larger than half the sequence space is read as a frame from the past, which is what a wrapping
 * counter's arithmetic means by it.
 */
export function sequenceGap(previous: number | null, current: number): number | null {
  if (previous === null) return 0;
  const distance = (((current - previous) % SEQUENCE_SPACE) + SEQUENCE_SPACE) % SEQUENCE_SPACE;
  if (distance === 0 || distance > SEQUENCE_SPACE / 2) return null;
  return distance - 1;
}

/** Bytes of mono silence for this many samples — zeros, which is what silence is in linear PCM. */
export function monoSilenceBytes(sampleCount: number): Uint8Array {
  return new Uint8Array(Math.max(0, sampleCount) * PCM_BYTES_PER_SAMPLE);
}

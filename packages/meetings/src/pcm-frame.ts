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

// Sequence numbers are 32-bit and wrap; the distance between two of them is measured the way a
// receiver of any wrapping counter measures it.
const SEQUENCE_SPACE = 2 ** 32;

/**
 * HOW MANY FRAMES NEVER ARRIVED between the last one the recorder took and this one.
 *
 * Zero for the next frame in order, and for the first frame of a track (there is nothing to have
 * missed). A frame at or behind the last one taken answers `null`. A gap larger than half the sequence
 * space is read as a frame from the past, which is what a wrapping counter's arithmetic means by it.
 * `sequenceStep` below is the reading the recorder acts on; this is the plain distance.
 */
export function sequenceGap(previous: number | null, current: number): number | null {
  if (previous === null) return 0;
  const distance = (((current - previous) % SEQUENCE_SPACE) + SEQUENCE_SPACE) % SEQUENCE_SPACE;
  if (distance === 0 || distance > SEQUENCE_SPACE / 2) return null;
  return distance - 1;
}

/**
 * HOW FAR BEHIND THE LAST FRAME TAKEN A FRAME MAY BE AND STILL BE READ AS A REPEAT. Fifty frames is one
 * second of the adapter's twenty-millisecond frames. A WebSocket delivers in order, so a frame behind
 * the last one taken is a sender repeating itself, and a sender repeats what it has just sent rather
 * than what it sent minutes ago. Further back than this is not a repeat but a counter that started
 * again — a new adapter, or the same one restarted — and treating it as a repeat would discard every
 * frame until the new counter climbed past the old one, which can be the rest of the meeting.
 */
export const SEQUENCE_REORDER_WINDOW_FRAMES = 50;

/** What one frame's sequence number says about where it belongs. */
export type SequenceStep =
  // The track's first frame: nothing before it to have missed.
  | { readonly kind: "first" }
  // The next frame after `missing` that never arrived (zero for the very next one).
  | { readonly kind: "ahead"; readonly missing: number }
  // A repeat, or a frame reordered behind a later one, within the reorder window: discarded.
  | { readonly kind: "behind" }
  // A jump backwards past the window: the counter started again, and only the wall clock can say
  // where this frame belongs.
  | { readonly kind: "reset" };

/** Reads one frame's sequence number against the last one taken. */
export function sequenceStep(
  previous: number | null,
  current: number,
  reorderWindow: number = SEQUENCE_REORDER_WINDOW_FRAMES,
): SequenceStep {
  if (previous === null) return { kind: "first" };
  const forward = (((current - previous) % SEQUENCE_SPACE) + SEQUENCE_SPACE) % SEQUENCE_SPACE;
  if (forward === 0) return { kind: "behind" };
  if (forward <= SEQUENCE_SPACE / 2) return { kind: "ahead", missing: forward - 1 };
  return SEQUENCE_SPACE - forward <= reorderWindow ? { kind: "behind" } : { kind: "reset" };
}

/** One part ready to upload: bytes from the stager's own buffer, or a whole part of silence. */
export type StagedPart =
  | { readonly kind: "buffer"; readonly bytes: Uint8Array }
  | { readonly kind: "silence" };

/**
 * ONE TRACK'S STAGING, IN ONE FIXED BUFFER — pure, synchronous and allocation-free after construction.
 *
 * WHY IT IS SHAPED THIS WAY. A recorder holds a track's audio in memory only until it is uploaded as a
 * multipart part, and an isolate's memory is a hard ceiling — so what one track may hold has to be a
 * number, not a tendency. The buffer is handed in once, `partBytes` plus an overflow, and every byte
 * the track stages is written into it IN PLACE: no chunk list, no merged copy, no slice per part.
 *
 *   * A part is always the first `partBytes` of the buffer, handed out as a view. While it uploads,
 *     frames keep landing in the overflow behind it; when it has uploaded, the overflow is moved to the
 *     front with `copyWithin` (in place, at most the overflow's size) and the next part begins there.
 *   * At most one part is out at a time (`nextPart` answers null until `partUploaded` or `partFailed`).
 *     A frame that does not fit — the overflow is full because an upload is slow — is DROPPED and its
 *     length becomes silence, so the timeline keeps its place and memory does not grow.
 *   * SILENCE IS A COUNT, not bytes. A gap is written as zeros only where it shares a part with audio
 *     and the buffer has room; a run that covers whole parts is counted as silence PARTS, which the
 *     caller uploads from one shared part of zeros, and the silence that opens the part after a full
 *     first part is counted too and written only when that part moves to the front. A five-minute gap
 *     is a few numbers, never twenty-eight megabytes.
 *
 * ORDER. The timeline is: `silencePartsBeforeBuffer` whole parts of silence; the buffer's first part;
 * `silencePartsAfterHead` whole parts of silence and `leadingSilenceAfterHead` bytes of it (both only
 * ever counted while that first part is exactly full and nothing is behind it yet); the overflow's
 * bytes; and last, `pendingSilence` — silence that could not be placed yet, behind which audio is
 * refused, so nothing is ever written out of order.
 */
export class PcmPartStager {
  private readonly buffer: Uint8Array;
  private readonly partBytes: number;
  private fill = 0;
  private pendingSilence = 0;
  private silencePartsBeforeBuffer = 0;
  private silencePartsAfterHead = 0;
  private leadingSilenceAfterHead = 0;
  private outstanding: StagedPart["kind"] | null = null;

  constructor(buffer: Uint8Array, partBytes: number) {
    if (partBytes <= 0 || partBytes % PCM_BYTES_PER_SAMPLE !== 0 || buffer.length < partBytes) {
      throw new RangeError("a staging buffer holds at least one whole part of whole samples");
    }
    this.buffer = buffer;
    this.partBytes = partBytes;
  }

  /** Bytes written into the buffer and not yet uploaded. */
  get heldBytes(): number {
    return this.fill;
  }

  /** Silence counted but not yet placed, in bytes. */
  get pendingSilenceBytes(): number {
    return this.pendingSilence;
  }

  /** Whole parts of silence counted and not yet uploaded. */
  get silencePartsQueued(): number {
    return this.silencePartsBeforeBuffer + this.silencePartsAfterHead;
  }

  /** The buffer's own size — the most this track ever holds in memory. */
  get capacityBytes(): number {
    return this.buffer.length;
  }

  /** True while a part handed out by `nextPart` has not been answered. */
  get partOutstanding(): boolean {
    return this.outstanding !== null;
  }

  /** What `nextPart` would hand out next, without handing it out. */
  nextPartKind(): StagedPart["kind"] | null {
    if (this.silencePartsBeforeBuffer > 0) return "silence";
    return this.fill >= this.partBytes ? "buffer" : null;
  }

  /** Counts this many samples of silence onto the end of the timeline and places what it can. */
  writeSilence(sampleCount: number): void {
    if (sampleCount <= 0) return;
    this.pendingSilence += sampleCount * PCM_BYTES_PER_SAMPLE;
    this.resolvePendingSilence();
  }

  /**
   * Writes one frame of mono audio after everything already staged. Answers false when it could not
   * be placed — silence still pending ahead of it, or no room left in the overflow — in which case the
   * frame's length is counted as silence, so whatever arrives next still lands at its own instant.
   */
  writeAudio(samples: Int16Array): boolean {
    this.resolvePendingSilence();
    const byteCount = samples.length * PCM_BYTES_PER_SAMPLE;
    if (this.pendingSilence > 0 || this.fill + byteCount > this.buffer.length) {
      this.pendingSilence += byteCount;
      return false;
    }
    let offset = this.fill;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index] ?? 0;
      this.buffer[offset] = sample & 0xff;
      this.buffer[offset + 1] = (sample >> 8) & 0xff;
      offset += PCM_BYTES_PER_SAMPLE;
    }
    this.fill = offset;
    return true;
  }

  /**
   * The next whole part to upload, or null when none is due or one is already out. A buffer part is
   * a VIEW of the stager's own memory, valid until `partUploaded` or `partFailed` is called.
   */
  nextPart(): StagedPart | null {
    if (this.outstanding !== null) return null;
    const kind = this.nextPartKind();
    if (kind === null) return null;
    this.outstanding = kind;
    return kind === "silence" ? { kind } : { kind, bytes: this.buffer.subarray(0, this.partBytes) };
  }

  /** The part handed out has uploaded: let go of it and place whatever silence now fits. */
  partUploaded(): void {
    const kind = this.outstanding;
    this.outstanding = null;
    if (kind === "silence") this.silencePartsBeforeBuffer -= 1;
    else if (kind === "buffer") this.releaseHead(0);
    this.resolvePendingSilence();
  }

  /** The part handed out did not upload: it stays exactly where it is, to be handed out again. */
  partFailed(): void {
    this.outstanding = null;
  }

  /**
   * GIVES UP ON THE BUFFER'S FIRST PART, which could not be uploaded, and puts a part of silence in its
   * place — so the timeline keeps its length and everything after it keeps its instant. Answers the
   * samples of audio given up, for the caller to count. Nothing is given up while a part is out.
   */
  replaceHeadWithSilence(): number {
    if (this.outstanding !== null || this.fill < this.partBytes) return 0;
    this.releaseHead(1);
    this.resolvePendingSilence();
    return this.partBytes / PCM_BYTES_PER_SAMPLE;
  }

  /**
   * Forgets silence that nothing followed. Pending silence is always the end of the timeline, so a
   * track that is letting go has no reason to stage it. Answers the samples forgotten.
   */
  discardPendingSilence(): number {
    const samples = this.pendingSilence / PCM_BYTES_PER_SAMPLE;
    this.pendingSilence = 0;
    return samples;
  }

  /**
   * Completes the part being written with silence, so a track that stops here for now (its participant
   * left, and may come back) ends on a part boundary and can be released — a multipart upload takes
   * only one short part, and it must be the last. Answers the samples of silence added.
   */
  padToPartBoundary(): number {
    const tail = (this.fill + this.leadingSilenceAfterHead + this.pendingSilence) % this.partBytes;
    if (tail === 0) return 0;
    const padding = this.partBytes - tail;
    this.pendingSilence += padding;
    this.resolvePendingSilence();
    return padding / PCM_BYTES_PER_SAMPLE;
  }

  /**
   * The short last part, once every whole part has gone: a view of what the buffer still holds, or
   * null when it holds nothing or whole parts are still due.
   */
  finalPart(): Uint8Array | null {
    if (this.outstanding !== null || this.nextPartKind() !== null || this.fill === 0) return null;
    return this.buffer.subarray(0, this.fill);
  }

  /** The final part has uploaded (or been given up on): the buffer holds nothing any more. */
  finalPartSettled(): void {
    this.fill = 0;
  }

  // The first part is gone — uploaded, or given up as `asSilence` parts of silence. What followed it
  // moves to the front, behind the silence counted to open it, written now that there is room.
  private releaseHead(asSilence: number): void {
    const part = this.partBytes;
    const leading = this.leadingSilenceAfterHead;
    const behind = this.fill - part;
    this.buffer.copyWithin(leading, part, this.fill);
    this.buffer.fill(0, 0, leading);
    this.fill = leading + behind;
    this.leadingSilenceAfterHead = 0;
    this.silencePartsBeforeBuffer += asSilence + this.silencePartsAfterHead;
    this.silencePartsAfterHead = 0;
  }

  // Places as much pending silence as the order rules allow: counted wherever nothing is behind it in
  // the buffer, written where it shares a part with audio and there is room.
  private resolvePendingSilence(): void {
    const part = this.partBytes;
    while (this.pendingSilence > 0) {
      if (this.fill === 0) {
        // Nothing staged: whole parts are counted ahead of the buffer, and the rest opens it.
        const whole = Math.floor(this.pendingSilence / part);
        this.silencePartsBeforeBuffer += whole;
        this.pendingSilence -= whole * part;
        this.buffer.fill(0, 0, this.pendingSilence);
        this.fill = this.pendingSilence;
        this.pendingSilence = 0;
        return;
      }
      if (this.fill < part) {
        // The incomplete first part — never one that is out — is written into.
        const count = Math.min(this.pendingSilence, part - this.fill);
        this.buffer.fill(0, this.fill, this.fill + count);
        this.fill += count;
        this.pendingSilence -= count;
        continue;
      }
      if (this.fill === part) {
        // The first part is full and nothing is behind it: the silence after it is counted, not
        // written — whole parts, and the bytes that open the next one.
        const after = this.leadingSilenceAfterHead + this.pendingSilence;
        this.silencePartsAfterHead += Math.floor(after / part);
        this.leadingSilenceAfterHead = after % part;
        this.pendingSilence = 0;
        return;
      }
      // Audio is already behind the first part: the silence follows it in the overflow, as far as
      // there is room, and the rest waits for the first part to go.
      const count = Math.min(this.pendingSilence, this.buffer.length - this.fill);
      if (count <= 0) return;
      this.buffer.fill(0, this.fill, this.fill + count);
      this.fill += count;
      this.pendingSilence -= count;
    }
  }
}

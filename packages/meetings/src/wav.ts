import { PCM_BYTES_PER_SAMPLE, PCM_SAMPLE_RATE } from "./pcm-frame.ts";

// THE COMPOSED RECORDING'S CONTAINER: a canonical 44-byte WAV header over mono 48 kHz 16-bit PCM —
// and, at a lower rate, over each piece of one speaker's audio the transcript sends to the speech model.
//
// WAV because it is no encoder at all — the header says what the samples are and the samples follow
// it — so there is no codec, no dependency and nothing to get wrong between the staged audio and the
// filed document, and every operating system and every court's media player opens it. FLAC is the
// named follow-up for size; a recording has to exist before its size is worth optimizing.
//
// The header carries two lengths, and both are known before the first sample is composed: the staged
// tracks are complete objects of known size by the time a recording is handed on to be composed, and
// the composite's length is the furthest any of them reaches. So the header is written at the head of
// the first part like any other bytes — which is also the only way R2 allows it, because every part of
// a multipart upload but the last must be one size and a 44-byte part at the head would not be.
//
// Pure TypeScript with no binding and no clock.

/** The canonical header's length in bytes: RIFF (12), `fmt ` (24), and the `data` chunk's head (8). */
export const WAV_HEADER_BYTES = 44;

/** One channel: the recorder folds every track to mono and the mixer sums them to one. */
export const WAV_CHANNELS = 1;

/**
 * THE LARGEST DATA CHUNK A WAV CAN DESCRIBE. Both lengths in the header are unsigned 32-bit, and the
 * RIFF length counts the 36 bytes of header after itself as well — so the data is at most 2^32 − 1 − 36
 * bytes: about twelve and a half hours of mono 48 kHz 16-bit audio, longer than the longest recording
 * the recorder lets run.
 */
export const WAV_MAXIMUM_DATA_BYTES = 0xffff_ffff - 36;

/**
 * THE LONGEST DATA CHUNK EVERY READER OPENS: the same arithmetic as above with the lengths read as
 * SIGNED 32-bit, which some players and libraries do although the format defines them as unsigned.
 * About six hours and twelve minutes of mono 48 kHz 16-bit audio.
 *
 * THE POLICY PAST IT, decided rather than left to fall out: a recording longer than this is still
 * filed as ONE canonical WAV, whole, with its lengths written as the format defines them. Not capped —
 * a seven-hour deposition is an ordinary day, and a recording that stops itself at six hours loses the
 * end of it. Not split into several documents — one recording is one document on the matter, and a
 * record that arrived in pieces would have to be reassembled by whoever relies on it. A reader that
 * misreads the lengths as signed fails on that one file, which is a fault in that reader that every
 * conforming player and every audio tool handles; the format that removes the boundary altogether
 * (FLAC, or the 64-bit RF64 container) is the follow-up the size work already names. Only past
 * `WAV_MAXIMUM_DATA_BYTES`, which no recording reaches inside the recorder's own maximum length, is a
 * composite refused.
 */
export const WAV_SIGNED_READER_MAXIMUM_DATA_BYTES = 0x7fff_ffff - 36;

/**
 * The 44-byte header for `dataBytes` bytes of mono 16-bit little-endian PCM at `sampleRate` — the
 * recorder's 48 kHz unless the caller says otherwise (the transcript's speech pieces are 16 kHz, the
 * rate the speech model works at). Refuses a length that is not a whole number of samples or that the
 * format cannot describe, rather than writing a header whose lengths do not match the data after it.
 */
export function wavHeader(dataBytes: number, sampleRate: number = PCM_SAMPLE_RATE): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(
      `a WAV sample rate is a whole number of samples a second, not ${String(sampleRate)}`,
    );
  }
  if (!Number.isInteger(dataBytes) || dataBytes < 0 || dataBytes % PCM_BYTES_PER_SAMPLE !== 0) {
    throw new RangeError(
      `a WAV data chunk is a whole number of samples, not ${String(dataBytes)} bytes`,
    );
  }
  if (dataBytes > WAV_MAXIMUM_DATA_BYTES) {
    throw new RangeError(`a WAV data chunk cannot describe ${String(dataBytes)} bytes`);
  }
  const header = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(header.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  const blockAlign = WAV_CHANNELS * PCM_BYTES_PER_SAMPLE;
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // the `fmt ` chunk's own length, for plain PCM
  view.setUint16(20, 1, true); // format 1: linear PCM, no compression
  view.setUint16(22, WAV_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // bytes per second
  view.setUint16(32, blockAlign, true); // bytes per sample frame, every channel together
  view.setUint16(34, PCM_BYTES_PER_SAMPLE * 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return header;
}

/** What a header says, read back — for a test, and for anything that must check a composed file. */
export interface WavHeaderReading {
  readonly channels: number;
  readonly sampleRate: number;
  readonly bitsPerSample: number;
  readonly riffBytes: number;
  readonly dataBytes: number;
}

/** Reads a canonical 44-byte header, or answers null for bytes that are not one. */
export function readWavHeader(bytes: Uint8Array): WavHeaderReading | null {
  if (bytes.byteLength < WAV_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, WAV_HEADER_BYTES);
  const text = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
  if (text(0) !== "RIFF" || text(8) !== "WAVE" || text(12) !== "fmt " || text(36) !== "data") {
    return null;
  }
  if (view.getUint16(20, true) !== 1) return null;
  return {
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    riffBytes: view.getUint32(4, true),
    dataBytes: view.getUint32(40, true),
  };
}

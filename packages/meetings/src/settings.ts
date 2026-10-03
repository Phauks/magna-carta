import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// Per-firm meeting configuration, read through the generic firm-setting accessor (a missing row IS
// the default in code). Every switch here defaults OFF, so a firm opts into each deliberately: each
// one sends a privileged conversation somewhere it did not go before — into a stored recording, into
// a speech model, into a reasoning model — and that is a decision a firm takes, never one it finds it
// took.

// Whether a meeting on a matter may be recorded at all. Off, the Record control is not offered and the
// start route answers 503 `meeting-recording-not-configured`, on the same terms a deployment without
// media routing answers `meetings-not-configured`: nothing a member can be granted changes it.
export const recordingEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "meetings.recordingEnabled",
  schema: z.boolean(),
  defaultValue: false,
};

// Whether live captions may run. Read by the caption slice; declared now so the four switches the
// recording design names are one family with one home.
export const captionsEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "meetings.captionsEnabled",
  schema: z.boolean(),
  defaultValue: false,
};

// Whether a recorded meeting's transcript is summarized. Read when a summary RUNS (the Worker's
// summary consumer), not when it is begun, so a firm that switches it off stops summaries already
// queued: off, each is recorded as refused, `disabled`, and no model is asked anything.
export const summariesEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "meetings.summariesEnabled",
  schema: z.boolean(),
  defaultValue: false,
};

// ---------------------------------------------------------------------------------------------
// WHAT ONE RECORDER HOLDS IN MEMORY, AND THEREFORE HOW MANY TRACKS IT MAY RECORD AT ONCE.
//
// The recorder is a Durable Object, and an isolate gets 128 MB. Every number below is either a fact
// about the platform or derived from one, so the ceiling is arithmetic rather than a guess:
//
//   isolate                                     128,000,000 bytes  (read as decimal megabytes, the
//                                                                   smaller reading, = 122.07 MiB)
//   reserved for everything that is not audio   40 MiB             the runtime, the Worker's module
//                                                                   graph, every socket's message
//                                                                   buffers, the per-frame decode
//                                                                   scratch (under 64 KiB a frame),
//                                                                   the track metadata
//   one part of silence, shared                  5 MiB             written once, never written again,
//                                                                   uploaded wherever a gap covers a
//                                                                   whole part
//   parts in flight, copied by the upload        2 x 5 MiB         the storage binding may copy a part
//                                                                   into its request, so each upload
//                                                                   out is counted as a second copy
//   per track: one part + its overflow           5 MiB + 1 MiB     preallocated when the track opens,
//                                                                   released when it closes
//
//   tracks = floor((122.07 - 40 - 5 - 10) MiB / 6 MiB) = floor(11.18) = 11
//   worst case = 40 + 5 + 10 + 11 x 6 = 121 MiB, inside 122.07 MiB with the 40 MiB reserve untouched
//
// THE PART is R2's minimum: every part of a multipart upload but the last must be at least 5 MiB and
// all of them one size, and a smaller part is less memory per track. 5 MiB of 48 kHz 16-bit mono is
// about fifty-five seconds, so a twelve-hour track is about 790 parts, inside R2's 10,000.
//
// THE OVERFLOW is where frames land while a part uploads: 1 MiB is about eleven seconds of mono, which
// covers a track waiting behind the other upload in flight and its own. A frame that arrives when the
// overflow is full is dropped and counted, and its length becomes silence on the timeline — the
// recorder never buffers past this.
//
// THE CEILING is per recorder. Two recordings placed in one isolate share its 128 MB; that is a
// placement the platform decides, and the margin above is what it has to spend.
// ---------------------------------------------------------------------------------------------

/** An isolate's memory, as the platform states it (128 MB), in bytes. */
export const RECORDER_ISOLATE_MEMORY_BYTES = 128 * 1000 * 1000;

/** What the recorder leaves for everything that is not a staged part. */
export const RECORDER_RESERVED_BYTES = 40 * 1024 * 1024;

/** One staged part: R2's minimum multipart part size, which every part but the last must match. */
export const RECORDING_PART_BYTES = 5 * 1024 * 1024;

/** Room behind a part for the frames that arrive while it uploads. */
export const RECORDING_OVERFLOW_BYTES = 1024 * 1024;

/** What one open track holds, preallocated once: a part and its overflow. */
export const RECORDING_TRACK_BUFFER_BYTES = RECORDING_PART_BYTES + RECORDING_OVERFLOW_BYTES;

/** How many parts one recorder uploads at once, across all of its tracks (and one per track). */
export const RECORDING_PART_UPLOADS_IN_FLIGHT = 2;

/** What the recorder holds that does not scale with its tracks: the shared silence part and the copies. */
export const RECORDER_FIXED_STAGING_BYTES =
  RECORDING_PART_BYTES + RECORDING_PART_UPLOADS_IN_FLIGHT * RECORDING_PART_BYTES;

/** THE MOST TRACKS ONE RECORDER CAN HOLD OPEN, derived from the arithmetic above. */
export const RECORDED_TRACK_CEILING_MAXIMUM = Math.floor(
  (RECORDER_ISOLATE_MEMORY_BYTES - RECORDER_RESERVED_BYTES - RECORDER_FIXED_STAGING_BYTES) /
    RECORDING_TRACK_BUFFER_BYTES,
);

/** The most a recorder at its ceiling holds for staging, which the arithmetic keeps inside the isolate. */
export const RECORDER_WORST_CASE_STAGING_BYTES =
  RECORDER_FIXED_STAGING_BYTES + RECORDED_TRACK_CEILING_MAXIMUM * RECORDING_TRACK_BUFFER_BYTES;

// HOW MANY PARTICIPANTS ONE RECORDING MAY HEAR AT ONCE. The recorder holds one open track per stay —
// a stay's further audio tracks are recorded as not heard rather than taking another stay's place —
// so the ceiling counts stays and the memory above is bounded by it. A firm may set it lower; it
// cannot set it above what the memory arithmetic allows, because past that the ceiling would be a
// crash rather than a refusal. A larger room recorded in full is a second recorder sharding the tracks,
// which is a different design.
export const recordedTrackCeilingDefinition: FirmSettingDefinition<number> = {
  key: "meetings.recordedTrackCeiling",
  schema: z.number().int().min(1).max(RECORDED_TRACK_CEILING_MAXIMUM),
  defaultValue: RECORDED_TRACK_CEILING_MAXIMUM,
};

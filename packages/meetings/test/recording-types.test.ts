import { describe, expect, it } from "vitest";
import { PCM_SAMPLE_RATE } from "../src/pcm-frame.ts";
import {
  parseTrackSegments,
  placeTrackSegments,
  type MeetingRecordingTrackSegment,
} from "../src/recording-types.ts";
import {
  WAV_HEADER_BYTES,
  WAV_MAXIMUM_DATA_BYTES,
  WAV_SIGNED_READER_MAXIMUM_DATA_BYTES,
} from "../src/wav.ts";

// WHERE A STAGED TRACK'S AUDIO LANDS ON THE COMPOSITE. What would be a real failure if it stopped
// holding: a participant who left and came back is heard late by the silence that closed their first
// stretch (an answer overlapping the next question, for the rest of the meeting); the padding is placed
// as though it were them; one person's stretches sum over each other; or a row staged before stretches
// were recorded lands anywhere but where it always did.

const STARTED_AT = "2026-10-02T09:00:00.000Z";
const RATE = PCM_SAMPLE_RATE;

/** An instant this many seconds after the recording began. */
function secondsIn(seconds: number): string {
  return new Date(Date.parse(STARTED_AT) + seconds * 1000).toISOString();
}

describe("placing a staged track", () => {
  it("places a row with no stretches as one run from its first frame, as it always was", () => {
    expect(
      placeTrackSegments({
        startedAt: STARTED_AT,
        firstFrameAt: secondsIn(2),
        segments: null,
        objectSamples: 10 * RATE,
      }),
    ).toEqual([{ stagedFromSample: 0, offset: 2 * RATE, samples: 10 * RATE }]);
  });

  it("places a return at its own instant, and never places the padding that closed the stretch before it", () => {
    // Ten seconds of audio from the first instant; the participant leaves and their buffer is padded
    // to a part boundary — about fifty-five seconds of staged silence — and they are back twenty
    // seconds in, well before that silence would have run out.
    const partSamples = (5 * 1024 * 1024) / 2;
    const segments: MeetingRecordingTrackSegment[] = [
      { stagedFromSample: 0, at: secondsIn(0), stagedToSample: 10 * RATE },
      { stagedFromSample: partSamples, at: secondsIn(20), stagedToSample: null },
    ];
    const spans = placeTrackSegments({
      startedAt: STARTED_AT,
      firstFrameAt: secondsIn(0),
      segments,
      objectSamples: partSamples + 5 * RATE,
    });
    expect(spans).toEqual([
      { stagedFromSample: 0, offset: 0, samples: 10 * RATE },
      // Twenty seconds in — not fifty-five — and only the five seconds they spoke.
      { stagedFromSample: partSamples, offset: 20 * RATE, samples: 5 * RATE },
    ]);
  });

  it("ends a stretch at the next one's beginning, and at what the object actually holds", () => {
    const spans = placeTrackSegments({
      startedAt: STARTED_AT,
      firstFrameAt: secondsIn(0),
      segments: [
        { stagedFromSample: 0, at: secondsIn(0), stagedToSample: null },
        { stagedFromSample: 4 * RATE, at: secondsIn(600), stagedToSample: null },
      ],
      // The final part did not reach the bucket: the second stretch has one second, not more.
      objectSamples: 5 * RATE,
    });
    expect(spans).toEqual([
      { stagedFromSample: 0, offset: 0, samples: 4 * RATE },
      { stagedFromSample: 4 * RATE, offset: 600 * RATE, samples: RATE },
    ]);
  });

  it("never lays one person's stretch over their own previous one, and never before the start", () => {
    const spans = placeTrackSegments({
      startedAt: STARTED_AT,
      firstFrameAt: secondsIn(-1),
      segments: [
        { stagedFromSample: 0, at: secondsIn(-1), stagedToSample: 3 * RATE },
        // The wall clock puts it a second before the first stretch's audio ends.
        { stagedFromSample: 3 * RATE, at: secondsIn(2), stagedToSample: null },
      ],
      objectSamples: 5 * RATE,
    });
    expect(spans).toEqual([
      { stagedFromSample: 0, offset: 0, samples: 3 * RATE },
      { stagedFromSample: 3 * RATE, offset: 3 * RATE, samples: 2 * RATE },
    ]);
  });

  it("reads stored stretches back, and refuses anything that is not a list of them", () => {
    const stored = JSON.stringify([
      { stagedFromSample: 0, at: secondsIn(0), stagedToSample: 5 },
      { stagedFromSample: 10, at: secondsIn(1), stagedToSample: null },
    ]);
    expect(parseTrackSegments(stored)).toEqual([
      { stagedFromSample: 0, at: secondsIn(0), stagedToSample: 5 },
      { stagedFromSample: 10, at: secondsIn(1), stagedToSample: null },
    ]);
    expect(parseTrackSegments(null)).toBeNull();
    expect(parseTrackSegments("not json")).toBeNull();
    expect(parseTrackSegments(JSON.stringify({ stagedFromSample: 0 }))).toBeNull();
    expect(
      parseTrackSegments(JSON.stringify([{ stagedFromSample: -1, at: secondsIn(0) }])),
    ).toBeNull();
    expect(
      parseTrackSegments(JSON.stringify([{ stagedFromSample: 0, at: "not an instant" }])),
    ).toBeNull();
    expect(
      parseTrackSegments(
        JSON.stringify([{ stagedFromSample: 10, at: secondsIn(0), stagedToSample: 5 }]),
      ),
    ).toBeNull();
  });
});

describe("how long a WAV every reader opens", () => {
  it("names the signed boundary at about six hours and twelve minutes, inside the unsigned one", () => {
    const hours = (bytes: number) => bytes / 2 / RATE / 3600;
    expect(hours(WAV_SIGNED_READER_MAXIMUM_DATA_BYTES)).toBeGreaterThan(6.2);
    expect(hours(WAV_SIGNED_READER_MAXIMUM_DATA_BYTES)).toBeLessThan(6.3);
    // The RIFF length — everything after its own field — still fits a signed 32-bit integer there.
    expect(36 + WAV_SIGNED_READER_MAXIMUM_DATA_BYTES).toBeLessThanOrEqual(0x7fff_ffff);
    // And the recorder's longest recording, twelve hours, is inside the unsigned limit.
    expect(12 * 3600 * RATE * 2 + WAV_HEADER_BYTES).toBeLessThan(WAV_MAXIMUM_DATA_BYTES);
  });
});

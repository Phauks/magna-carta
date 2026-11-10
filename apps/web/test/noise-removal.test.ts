/*
 * The product's own noise filter, driven against fake tracks and a fake filter, plus the frame
 * bookkeeping the audio thread runs.
 *
 * The rules pinned are the ones a member would notice: nothing changes for a member who never turns
 * the filter on; turning it on sends the cleaned sound and asks the browser's own noise reduction off;
 * a filter that cannot start or stops working leaves them heard as they were, never silent; muting
 * mutes the cleaned sound too; and the client hears every change of track so it can swap what the room
 * receives.
 */
import { describe, expect, it } from "vitest";
import {
  passThroughEffects,
  readAudioTreatment,
  type AppliedEffects,
  type MediaEffectSettings,
} from "$lib/meetings/client/media-effects.ts";
import {
  NOISE_REMOVAL_REFUSED,
  NOISE_REMOVAL_STOPPED,
  noiseRemoval,
  type NoiseSeams,
  type NoiseTreatment,
} from "$lib/meetings/client/noise-removal.ts";
import { readMeetingEffects } from "$lib/meetings/meeting-effects-preference.svelte.ts";
import { FrameBridge } from "$lib/meetings/effects/noise-frames.ts";

class FakeTrack {
  enabled = true;
  stopped = false;
  asked: MediaTrackConstraints[] = [];
  #settings: Record<string, unknown> = { noiseSuppression: true };

  constructor(readonly kind: "audio" | "video") {}

  getSettings(): Record<string, unknown> {
    return this.#settings;
  }

  getCapabilities(): Record<string, unknown> {
    return {};
  }

  applyConstraints(constraints: MediaTrackConstraints): Promise<void> {
    this.asked.push(constraints);
    if (typeof constraints.noiseSuppression === "boolean") {
      this.#settings = { ...this.#settings, noiseSuppression: constraints.noiseSuppression };
    }
    return Promise.resolve();
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}

  getTracks(): FakeTrack[] {
    return this.tracks;
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }
}

class FakeFilter {
  readonly track = new FakeTrack("audio");
  closed = false;
  #failure: (() => void) | null = null;

  onFailure(listener: () => void): void {
    this.#failure = listener;
  }

  close(): void {
    this.closed = true;
  }

  fail(): void {
    this.#failure?.();
  }
}

interface Rig {
  readonly seams: NoiseSeams;
  readonly started: FakeFilter[];
  refuseStart: boolean;
}

function rig(supported = true): Rig {
  const made: Rig = {
    started: [],
    refuseStart: false,
    seams: {
      supported: () => supported,
      start: () => {
        if (made.refuseStart) return Promise.reject(new Error("engine"));
        const filter = new FakeFilter();
        made.started.push(filter);
        return Promise.resolve(filter as unknown as NoiseTreatment);
      },
      createStream: (tracks) =>
        new FakeStream(tracks as unknown as FakeTrack[]) as unknown as MediaStream,
    },
  };
  return made;
}

function capture(): { stream: MediaStream; microphone: FakeTrack; picture: FakeTrack } {
  const microphone = new FakeTrack("audio");
  const picture = new FakeTrack("video");
  return {
    stream: new FakeStream([microphone, picture]) as unknown as MediaStream,
    microphone,
    picture,
  };
}

const PLAIN: MediaEffectSettings = { background: "none", reduceNoise: true, removeNoise: false };
const FILTERED: MediaEffectSettings = { background: "none", reduceNoise: true, removeNoise: true };

function soundOf(stream: MediaStream): FakeTrack | undefined {
  return stream.getAudioTracks()[0] as unknown as FakeTrack | undefined;
}

describe("the product's noise filter", () => {
  it("sends the microphone as it is, and starts nothing, until the filter is turned on", async () => {
    const { seams, started } = rig();
    const { stream, microphone } = capture();
    const effected = await noiseRemoval(passThroughEffects(), seams).applyEffects(stream, PLAIN);
    expect(started).toHaveLength(0);
    expect(soundOf(effected.stream)).toBe(microphone);
    expect(effected.applied.noiseRemoval).toBe("off");
  });

  it("sends the cleaned sound with the same picture, and asks the browser's own reduction off", async () => {
    const { seams, started } = rig();
    const { stream, microphone, picture } = capture();
    const stage = noiseRemoval(passThroughEffects(), seams);
    expect(stage.captureConstraints("video", FILTERED).audio).toMatchObject({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    });
    const effected = await stage.applyEffects(stream, FILTERED);
    expect(started).toHaveLength(1);
    expect(soundOf(effected.stream)).toBe(started[0]?.track);
    expect(effected.stream.getVideoTracks()[0]).toBe(picture);
    expect(effected.applied.noiseRemoval).toBe("on");
    expect(readAudioTreatment(microphone as unknown as MediaStreamTrack).noiseSuppression).toBe(
      true,
    );
  });

  it("tells the client of every change of sound, and stops the filter when it is turned off", async () => {
    const { seams, started } = rig();
    const { stream, microphone } = capture();
    const effected = await noiseRemoval(passThroughEffects(), seams).applyEffects(stream, PLAIN);
    const heard: Array<{ sound: FakeTrack | undefined; applied: AppliedEffects }> = [];
    effected.onChange?.((next, applied) => heard.push({ sound: soundOf(next), applied }));

    await effected.update(FILTERED, "microphone");
    expect(heard.at(-1)?.sound).toBe(started[0]?.track);
    expect(heard.at(-1)?.applied.noiseRemoval).toBe("on");
    expect(microphone.asked.at(-1)?.noiseSuppression).toBe(false);

    await effected.update(PLAIN, "microphone");
    expect(started[0]?.closed).toBe(true);
    expect(heard.at(-1)?.sound).toBe(microphone);
    expect(heard.at(-1)?.applied.noiseRemoval).toBe("off");
    expect(microphone.asked.at(-1)?.noiseSuppression).toBe(true);
  });

  it("keeps the member heard, with the browser's own reduction back, when the filter cannot start", async () => {
    const made = rig();
    made.refuseStart = true;
    const { stream, microphone } = capture();
    const effected = await noiseRemoval(passThroughEffects(), made.seams).applyEffects(
      stream,
      FILTERED,
    );
    expect(soundOf(effected.stream)).toBe(microphone);
    expect(effected.applied.noiseRemoval).toBe("off");
    expect(effected.applied.refusal).toBe(NOISE_REMOVAL_REFUSED);
    expect(microphone.asked.at(-1)?.noiseSuppression).toBe(true);
  });

  it("goes back to the microphone's own sound, and says why, when the filter stops working", async () => {
    const { seams, started } = rig();
    const { stream, microphone } = capture();
    const effected = await noiseRemoval(passThroughEffects(), seams).applyEffects(stream, FILTERED);
    const heard: Array<{ sound: FakeTrack | undefined; applied: AppliedEffects }> = [];
    effected.onChange?.((next, applied) => heard.push({ sound: soundOf(next), applied }));

    started[0]?.fail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started[0]?.closed).toBe(true);
    expect(heard.at(-1)?.sound).toBe(microphone);
    expect(heard.at(-1)?.applied.refusal).toBe(NOISE_REMOVAL_STOPPED);
    expect(microphone.asked.at(-1)?.noiseSuppression).toBe(true);
  });

  it("mutes the cleaned sound with the microphone, and closes the filter with the capture", async () => {
    const { seams, started } = rig();
    const { stream, microphone } = capture();
    const effected = await noiseRemoval(passThroughEffects(), seams).applyEffects(stream, FILTERED);
    effected.setSourceEnabled("audio", false);
    expect(microphone.enabled).toBe(false);
    expect(started[0]?.track.enabled).toBe(false);
    effected.close();
    expect(started[0]?.closed).toBe(true);
    expect(microphone.stopped).toBe(true);
  });

  it("is not offered, and asks for nothing new, where the browser cannot run it", async () => {
    const { seams, started } = rig(false);
    const { stream, microphone } = capture();
    const stage = noiseRemoval(passThroughEffects(), seams);
    expect(stage.captureConstraints("video", FILTERED).audio).toMatchObject({
      noiseSuppression: true,
    });
    const effected = await stage.applyEffects(stream, FILTERED);
    expect(started).toHaveLength(0);
    expect(soundOf(effected.stream)).toBe(microphone);
    expect(effected.applied.noiseRemoval).toBe("unavailable");
  });
});

describe("the remembered choice", () => {
  it("keeps the stronger filter's choice, and reads a choice stored before it existed as off", () => {
    expect(
      readMeetingEffects({ background: "none", reduceNoise: true, removeNoise: true }),
    ).toEqual(FILTERED);
    expect(readMeetingEffects({ background: "none", reduceNoise: true })).toEqual(PLAIN);
  });
});

describe("the frames between the audio thread and the filter", () => {
  it("delays the sound by exactly one frame and never runs dry", () => {
    const bridge = new FrameBridge(480, 128);
    const heard: number[] = [];
    let next = 1;
    for (let block = 0; block < 60; block += 1) {
      const input = Float32Array.from({ length: 128 }, () => next++);
      const output = new Float32Array(128);
      bridge.push(input, output, (frame, cleaned) => cleaned.set(frame));
      heard.push(...output);
    }
    // One frame of silence, then every sample in order.
    expect(heard.slice(0, 480).every((sample) => sample === 0)).toBe(true);
    expect(heard.slice(480)).toEqual(
      Array.from({ length: heard.length - 480 }, (_, index) => index + 1),
    );
  });

  it("answers silence for a block with no input", () => {
    const bridge = new FrameBridge(480, 128);
    const output = new Float32Array(128).fill(1);
    bridge.push(undefined, output, (frame, cleaned) => cleaned.set(frame));
    expect([...output].every((sample) => sample === 0)).toBe(true);
  });
});

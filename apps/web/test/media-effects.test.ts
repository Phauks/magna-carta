/*
 * The stage between capture and publish, driven against fake tracks.
 *
 * WHAT IS ASKED FOR, AND WHAT IS REPORTED, is the whole of this stage's behaviour today, so those are
 * the assertions. A track here is an object with the four members the stage reaches — its settings,
 * its capabilities, `applyConstraints` and `enabled` — which is why none of this needs a browser, a
 * camera or a microphone.
 *
 * The rules pinned are the ones that fail quietly in a real meeting. An EXACT constraint the device
 * cannot meet fails the whole capture and leaves somebody with no microphone; a setting the track
 * does not report read as `false` tells a member their browser is not treating their sound when it
 * is; a camera re-asked for blur alone drops the resolution it was opened at; and a muted camera
 * whose source stays enabled keeps its light on.
 */
import { describe, expect, it } from "vitest";
import {
  AUDIO_TREATMENT_REFUSED,
  audioTreatmentStatement,
  blurRefusal,
  captureConstraints,
  DEFAULT_EFFECT_SETTINGS,
  passThroughEffects,
  readAudioTreatment,
  readBlurCapability,
} from "$lib/meetings/client/media-effects.ts";

/** A track that reports what it is given to report, and records what it was asked. */
class FakeTrack {
  enabled = true;
  stopped = false;
  readonly asked: Record<string, unknown>[] = [];
  /** Whether the next `applyConstraints` is refused, as a browser refuses what it cannot give. */
  refuses = false;

  constructor(
    readonly kind: "audio" | "video",
    public settings: Record<string, unknown> = {},
    public capabilities: Record<string, unknown> | null = {},
  ) {}

  getSettings(): Record<string, unknown> {
    return this.settings;
  }

  getCapabilities(): Record<string, unknown> {
    return this.capabilities ?? {};
  }

  applyConstraints(constraints: Record<string, unknown>): Promise<void> {
    this.asked.push(constraints);
    if (this.refuses) return Promise.reject(new Error("OverconstrainedError"));
    // A browser that honours the ask reports it back, which is what the stage then reads.
    if (typeof constraints.backgroundBlur === "boolean") {
      this.settings = { ...this.settings, backgroundBlur: constraints.backgroundBlur };
    }
    if (typeof constraints.noiseSuppression === "boolean") {
      this.settings = { ...this.settings, noiseSuppression: constraints.noiseSuppression };
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

function asTrack(track: FakeTrack): MediaStreamTrack {
  return track as unknown as MediaStreamTrack;
}

function asStream(stream: FakeStream): MediaStream {
  return stream as unknown as MediaStream;
}

/** Whether any constraint anywhere in a set is an `exact` one, however deeply it is nested. */
function asksExactly(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if ("exact" in value) return true;
  return Object.values(value).some((inner) => asksExactly(inner));
}

describe("what a capture asks for", () => {
  it("asks for the three audio treatments as plain booleans and never exactly", () => {
    const asked = captureConstraints("video", DEFAULT_EFFECT_SETTINGS);
    expect(asked.audio).toEqual({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    });
    expect(asksExactly(asked)).toBe(false);
  });

  it("asks for voice isolation only where the browser knows the name", () => {
    const unknown = captureConstraints("video", DEFAULT_EFFECT_SETTINGS);
    expect(unknown.audio).not.toHaveProperty("voiceIsolation");

    const known = captureConstraints("video", DEFAULT_EFFECT_SETTINGS, { voiceIsolation: true });
    expect(known.audio).toHaveProperty("voiceIsolation", true);
    expect(asksExactly(known)).toBe(false);
  });

  it("follows the member's choice about noise", () => {
    const asked = captureConstraints("video", { background: "none", reduceNoise: false });
    expect(asked.audio).toHaveProperty("noiseSuppression", false);
    // The other two are not the noise choice and stay on.
    expect(asked.audio).toHaveProperty("echoCancellation", true);
  });

  it("asks a call for no camera at all", () => {
    expect(captureConstraints("audio", DEFAULT_EFFECT_SETTINGS).video).toBe(false);
  });

  it("asks a meeting for a camera by ideal, never by exact", () => {
    const { video } = captureConstraints("video", DEFAULT_EFFECT_SETTINGS);
    expect(video).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    });
  });
});

describe("what the browser reports about the microphone", () => {
  it("reads a reported setting as it is", () => {
    const track = new FakeTrack("audio", {
      noiseSuppression: true,
      echoCancellation: false,
      autoGainControl: true,
    });
    expect(readAudioTreatment(asTrack(track))).toEqual({
      noiseSuppression: true,
      echoCancellation: false,
      autoGainControl: true,
      voiceIsolation: null,
    });
  });

  it("answers null, not false, for a setting the track does not report", () => {
    const track = new FakeTrack("audio", { echoCancellation: true });
    const treatment = readAudioTreatment(asTrack(track));
    expect(treatment.noiseSuppression).toBeNull();
    expect(treatment.autoGainControl).toBeNull();
    expect(treatment.echoCancellation).toBe(true);
  });

  it("answers null for everything where there is no track to ask", () => {
    expect(readAudioTreatment(undefined)).toEqual({
      noiseSuppression: null,
      echoCancellation: null,
      autoGainControl: null,
      voiceIsolation: null,
    });
  });

  it("says what else the browser is doing, and says so when it will not say", () => {
    expect(
      audioTreatmentStatement({
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
        voiceIsolation: null,
      }),
    ).toBe("Your browser is also cancelling echo and managing gain.");
    expect(
      audioTreatmentStatement({
        noiseSuppression: null,
        echoCancellation: true,
        autoGainControl: null,
        voiceIsolation: null,
      }),
    ).toBe("Your browser decides this and does not report it.");
  });
});

describe("whether the background can be blurred from here", () => {
  it("is controllable where the camera offers both positions", () => {
    const track = new FakeTrack("video", {}, { backgroundBlur: [false, true] });
    expect(readBlurCapability(asTrack(track))).toBe("controllable");
  });

  it("is the machine's to decide where the camera offers one", () => {
    const track = new FakeTrack("video", {}, { backgroundBlur: [true] });
    expect(readBlurCapability(asTrack(track))).toBe("platform-controlled");
  });

  it("is unavailable where the camera offers none, or has no capabilities at all", () => {
    expect(readBlurCapability(asTrack(new FakeTrack("video", {}, {})))).toBe("unavailable");
    const bare = { kind: "video" } as unknown as MediaStreamTrack;
    expect(readBlurCapability(bare)).toBe("unavailable");
    expect(readBlurCapability(undefined)).toBe("unavailable");
  });
});

describe("the pass-through stage", () => {
  it("hands back the very stream it was given, and stops nothing", async () => {
    const microphone = new FakeTrack("audio", { noiseSuppression: true });
    const camera = new FakeTrack("video");
    const stream = new FakeStream([microphone, camera]);

    const effected = await passThroughEffects().applyEffects(
      asStream(stream),
      DEFAULT_EFFECT_SETTINGS,
    );

    expect(effected.stream).toBe(stream);
    expect(microphone.stopped).toBe(false);
    expect(camera.stopped).toBe(false);
    // An untouched camera is left untouched: nothing asked of it that nobody chose.
    expect(camera.asked).toEqual([]);
    expect(effected.applied.blur).toBe("unavailable");
    expect(effected.applied.refusal).toBeNull();
  });

  it("asks a controllable camera for blur at capture, restating its picture", async () => {
    const camera = new FakeTrack("video", {}, { backgroundBlur: [false, true] });
    const stream = new FakeStream([new FakeTrack("audio"), camera]);

    const effected = await passThroughEffects().applyEffects(asStream(stream), {
      background: "blur",
      reduceNoise: true,
    });

    expect(camera.asked).toEqual([
      {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        backgroundBlur: true,
      },
    ]);
    expect(effected.applied.blur).toBe("on");
  });

  it("changes the blur on a controllable camera without capturing again, and reads it back", async () => {
    const camera = new FakeTrack(
      "video",
      { backgroundBlur: false },
      { backgroundBlur: [false, true] },
    );
    const stream = new FakeStream([new FakeTrack("audio"), camera]);
    const effected = await passThroughEffects().applyEffects(
      asStream(stream),
      DEFAULT_EFFECT_SETTINGS,
    );
    expect(effected.applied.blur).toBe("off");

    const applied = await effected.update({ background: "blur", reduceNoise: true });

    expect(camera.asked.at(-1)).toHaveProperty("backgroundBlur", true);
    expect(applied.blur).toBe("on");
    expect(applied.refusal).toBeNull();
    expect(effected.applied).toEqual(applied);
  });

  it("turns a refused blur into a refusal and leaves the effect off", async () => {
    const camera = new FakeTrack(
      "video",
      { backgroundBlur: false },
      { backgroundBlur: [false, true] },
    );
    const stream = new FakeStream([new FakeTrack("audio"), camera]);
    const effected = await passThroughEffects().applyEffects(
      asStream(stream),
      DEFAULT_EFFECT_SETTINGS,
    );
    camera.refuses = true;

    const applied = await effected.update({ background: "blur", reduceNoise: true });

    expect(applied.refusal).toBe(blurRefusal(true));
    // The browser offered the control and then declined it, so from here the machine decides — and
    // what it decided is off.
    expect(applied.blur).toBe("platform-controlled");
    expect(applied.platformBlur).toBe(false);
  });

  it("asks the microphone for its whole treatment again, and reads what came back", async () => {
    const microphone = new FakeTrack("audio", {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    });
    const stream = new FakeStream([microphone]);
    const effected = await passThroughEffects().applyEffects(
      asStream(stream),
      DEFAULT_EFFECT_SETTINGS,
    );

    const applied = await effected.update({ background: "none", reduceNoise: false });

    // Whole, because `applyConstraints` replaces: noise alone would drop the echo cancellation.
    expect(microphone.asked).toEqual([
      { noiseSuppression: false, echoCancellation: true, autoGainControl: true },
    ]);
    expect(applied.audio.noiseSuppression).toBe(false);
  });

  it("says so where the microphone refuses the change", async () => {
    const microphone = new FakeTrack("audio", { noiseSuppression: true });
    microphone.refuses = true;
    const effected = await passThroughEffects().applyEffects(
      asStream(new FakeStream([microphone])),
      DEFAULT_EFFECT_SETTINGS,
    );

    const applied = await effected.update({ background: "none", reduceNoise: false });

    expect(applied.refusal).toBe(AUDIO_TREATMENT_REFUSED);
    expect(applied.audio.noiseSuppression).toBe(true);
  });

  it("turns the SOURCE off, not only what is published", async () => {
    const camera = new FakeTrack("video");
    const microphone = new FakeTrack("audio");
    const effected = await passThroughEffects().applyEffects(
      asStream(new FakeStream([microphone, camera])),
      DEFAULT_EFFECT_SETTINGS,
    );

    effected.setSourceEnabled("video", false);

    expect(camera.enabled).toBe(false);
    expect(microphone.enabled).toBe(true);
  });

  it("stops every track it holds when it is closed", async () => {
    const camera = new FakeTrack("video");
    const microphone = new FakeTrack("audio");
    const effected = await passThroughEffects().applyEffects(
      asStream(new FakeStream([microphone, camera])),
      DEFAULT_EFFECT_SETTINGS,
    );

    effected.close();

    expect(camera.stopped).toBe(true);
    expect(microphone.stopped).toBe(true);
  });
});

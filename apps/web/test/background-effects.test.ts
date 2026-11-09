/*
 * The product's own background treatment, driven against fake tracks and a fake treatment.
 *
 * The rules pinned are the ones a member would notice in a real meeting: nothing changes for a
 * member who chose no background; a treatment that cannot start or stops working leaves them on
 * camera rather than off it; turning the picture off turns the treated picture off too; and the
 * client hears every change of track so it can swap what the room receives.
 */
import { describe, expect, it } from "vitest";
import {
  BACKGROUND_IMAGE_MISSING,
  BACKGROUND_REFUSED,
  BACKGROUND_STOPPED,
  backgroundEffects,
  type BackgroundSeams,
  type BackgroundTreatment,
} from "$lib/meetings/client/background-effects.ts";
import { passThroughEffects, type AppliedEffects } from "$lib/meetings/client/media-effects.ts";
import {
  coverFit,
  modeCode,
  steadyMask,
  toModelInput,
} from "$lib/meetings/effects/background-compositing.ts";
import { fittedSize } from "$lib/meetings/effects/background-image-store.ts";

class FakeTrack {
  enabled = true;
  stopped = false;

  constructor(readonly kind: "audio" | "video") {}

  getSettings(): Record<string, unknown> {
    return {};
  }

  getCapabilities(): Record<string, unknown> {
    return {};
  }

  applyConstraints(): Promise<void> {
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

class FakeBitmap {
  closed = false;

  constructor(readonly name: string) {}

  close(): void {
    this.closed = true;
  }
}

class FakeTreatment {
  readonly track = new FakeTrack("video");
  readonly asked: Array<{ mode: string; image: string | null }> = [];
  closed = false;
  #failure: (() => void) | null = null;

  setBackground(mode: string, image: FakeBitmap | null): void {
    this.asked.push({ mode, image: image?.name ?? null });
  }

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
  readonly seams: BackgroundSeams;
  readonly started: FakeTreatment[];
  readonly startedWith: Array<{ mode: string; image: string | null }>;
  refuseStart: boolean;
}

function rig(options: { supported?: boolean; remembered?: FakeBitmap | null } = {}): Rig {
  const made: Rig = {
    started: [],
    startedWith: [],
    refuseStart: false,
    seams: {
      supported: () => options.supported ?? true,
      start: (_camera, mode, image) => {
        if (made.refuseStart) return Promise.reject(new Error("engine"));
        const treatment = new FakeTreatment();
        made.started.push(treatment);
        made.startedWith.push({
          mode,
          image: (image as unknown as FakeBitmap | null)?.name ?? null,
        });
        return Promise.resolve(treatment as unknown as BackgroundTreatment);
      },
      loadImage: () =>
        Promise.resolve((options.remembered ?? null) as unknown as ImageBitmap | null),
      copyImage: (image) =>
        Promise.resolve(
          new FakeBitmap(
            `copy of ${(image as unknown as FakeBitmap).name}`,
          ) as unknown as ImageBitmap,
        ),
      createStream: (tracks) =>
        new FakeStream(tracks as unknown as FakeTrack[]) as unknown as MediaStream,
    },
  };
  return made;
}

function camera(): { stream: MediaStream; microphone: FakeTrack; picture: FakeTrack } {
  const microphone = new FakeTrack("audio");
  const picture = new FakeTrack("video");
  return {
    stream: new FakeStream([microphone, picture]) as unknown as MediaStream,
    microphone,
    picture,
  };
}

describe("the product's background treatment", () => {
  it("publishes the camera as it is, and starts nothing, where no background was chosen", async () => {
    const { seams, started } = rig();
    const { stream } = camera();
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "none",
      reduceNoise: true,
    });
    expect(capture.stream).toBe(stream);
    expect(started).toHaveLength(0);
    expect(capture.applied.backgroundByProduct).toBe(true);
    expect(capture.applied.background).toBe("none");
  });

  it("publishes the treated picture beside the same microphone when blur was chosen", async () => {
    const { seams, started } = rig();
    const { stream, microphone } = camera();
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "blur",
      reduceNoise: true,
    });
    const treated = started[0];
    expect(treated).toBeDefined();
    expect(capture.stream.getVideoTracks()[0]).toBe(treated?.track);
    expect(capture.stream.getAudioTracks()[0]).toBe(microphone);
    expect(capture.applied.background).toBe("blur");
    expect(capture.applied.blur).toBe("on");
  });

  it("is the pass-through where the browser cannot draw a background", async () => {
    const { seams, started } = rig({ supported: false });
    const { stream } = camera();
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "image",
      reduceNoise: true,
    });
    expect(started).toHaveLength(0);
    expect(capture.stream).toBe(stream);
    expect(capture.applied.backgroundByProduct).toBe(false);
    expect(capture.applied.refusal).toBeNull();
  });

  it("is the pass-through for a call, which has no camera", async () => {
    const { seams, started } = rig();
    const microphone = new FakeTrack("audio");
    const stream = new FakeStream([microphone]) as unknown as MediaStream;
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "blur",
      reduceNoise: true,
    });
    expect(started).toHaveLength(0);
    expect(capture.applied.backgroundByProduct).toBe(false);
  });

  it("keeps the camera and says why where a treatment cannot start", async () => {
    const made = rig();
    made.refuseStart = true;
    const { stream } = camera();
    const capture = await backgroundEffects(passThroughEffects(), made.seams).applyEffects(stream, {
      background: "blur",
      reduceNoise: true,
    });
    expect(capture.stream).toBe(stream);
    expect(capture.applied.background).toBe("none");
    expect(capture.applied.refusal).toBe(BACKGROUND_REFUSED);
  });

  it("tells the client when the picture to publish changes, both ways", async () => {
    const { seams, started } = rig();
    const { stream } = camera();
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "none",
      reduceNoise: true,
    });
    const heard: Array<{ stream: MediaStream; applied: AppliedEffects }> = [];
    capture.onChange?.((next, applied) => heard.push({ stream: next, applied }));

    await capture.update({ background: "blur", reduceNoise: true });
    expect(heard.at(-1)?.stream.getVideoTracks()[0]).toBe(started[0]?.track);
    expect(heard.at(-1)?.applied.background).toBe("blur");

    await capture.update({ background: "none", reduceNoise: true });
    expect(heard.at(-1)?.stream).toBe(stream);
    expect(started[0]?.closed).toBe(true);
  });

  it("changes the background of a running treatment without starting another", async () => {
    const { seams, started } = rig({ remembered: new FakeBitmap("beach") });
    const { stream } = camera();
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "blur",
      reduceNoise: true,
    });
    await capture.update({ background: "image", reduceNoise: true });
    expect(started).toHaveLength(1);
    expect(started[0]?.asked).toEqual([{ mode: "image", image: "copy of beach" }]);
    expect(capture.applied.background).toBe("image");
  });

  it("starts with the remembered picture, sent as a copy so it can be sent again", async () => {
    const remembered = new FakeBitmap("office");
    const made = rig({ remembered });
    const { stream } = camera();
    const capture = await backgroundEffects(passThroughEffects(), made.seams).applyEffects(stream, {
      background: "image",
      reduceNoise: true,
    });
    expect(made.startedWith).toEqual([{ mode: "image", image: "copy of office" }]);
    expect(remembered.closed).toBe(false);
    expect(capture.applied.imageChosen).toBe(true);
  });

  it("does not stand a member in front of nothing", async () => {
    const { seams, started } = rig();
    const { stream } = camera();
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "image",
      reduceNoise: true,
    });
    expect(started).toHaveLength(0);
    expect(capture.applied.refusal).toBe(BACKGROUND_IMAGE_MISSING);
    expect(capture.applied.imageChosen).toBe(false);
  });

  it("stands the member in front of a newly chosen picture, letting go of the old one", async () => {
    const old = new FakeBitmap("old");
    const { seams, started } = rig({ remembered: old });
    const { stream } = camera();
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "none",
      reduceNoise: true,
    });
    const applied = await capture.chooseBackgroundImage?.(
      new FakeBitmap("new") as unknown as ImageBitmap,
    );
    expect(old.closed).toBe(true);
    expect(applied?.background).toBe("image");
    expect(started).toHaveLength(1);
  });

  it("falls back to the camera, and says so, when a running treatment stops working", async () => {
    const { seams, started } = rig();
    const { stream } = camera();
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "blur",
      reduceNoise: true,
    });
    const heard: AppliedEffects[] = [];
    capture.onChange?.((_stream, applied) => heard.push(applied));
    started[0]?.fail();
    expect(capture.stream).toBe(stream);
    expect(heard.at(-1)?.background).toBe("none");
    expect(heard.at(-1)?.refusal).toBe(BACKGROUND_STOPPED);
  });

  it("turns the treated picture off with the camera, so the room never sees one switched off", async () => {
    const { seams, started } = rig();
    const { stream, picture } = camera();
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "blur",
      reduceNoise: true,
    });
    capture.setSourceEnabled("video", false);
    expect(picture.enabled).toBe(false);
    expect(started[0]?.track.enabled).toBe(false);
  });

  it("closes the treatment and the camera together", async () => {
    const { seams, started } = rig();
    const { stream, picture, microphone } = camera();
    const capture = await backgroundEffects(passThroughEffects(), seams).applyEffects(stream, {
      background: "blur",
      reduceNoise: true,
    });
    capture.close();
    expect(started[0]?.closed).toBe(true);
    expect(picture.stopped).toBe(true);
    expect(microphone.stopped).toBe(true);
  });
});

describe("the background arithmetic", () => {
  it("reads red, green and blue in 0 to 1 and drops alpha", () => {
    const out = new Float32Array(6);
    toModelInput(new Uint8ClampedArray([255, 0, 51, 9, 0, 255, 102, 9]), out);
    const expected = [1, 0, 0.2, 0, 1, 0.4];
    for (const [index, value] of expected.entries()) expect(out[index]).toBeCloseTo(value);
  });

  it("refuses a frame smaller than the model reads", () => {
    expect(() => toModelInput(new Uint8ClampedArray(4), new Float32Array(6))).toThrow(RangeError);
  });

  it("takes the first mask whole, then keeps a share of the last", () => {
    const running = new Float32Array(1);
    const bytes = new Uint8Array(1);
    steadyMask(running, new Float32Array([1]), bytes, true);
    expect(bytes[0]).toBe(255);
    steadyMask(running, new Float32Array([0]), bytes, false);
    expect(bytes[0]).toBe(85);
  });

  it("crops a picture evenly to the camera's shape rather than stretching it", () => {
    expect(coverFit(1920, 1080, 1280, 720)).toEqual([1, 1, 0, 0]);
    const [scaleX, scaleY, offsetX, offsetY] = coverFit(1000, 1000, 1280, 720);
    expect(scaleX).toBe(1);
    expect(scaleY).toBeCloseTo(0.5625);
    expect(offsetX).toBe(0);
    expect(offsetY).toBeCloseTo(0.21875);
    const wide = coverFit(3200, 900, 1600, 900);
    expect(wide[0]).toBeCloseTo(0.5);
    expect(wide[2]).toBeCloseTo(0.25);
  });

  it("names each mode as the shader reads it", () => {
    expect([modeCode("none"), modeCode("blur"), modeCode("image")]).toEqual([0, 1, 2]);
  });

  it("cuts a large picture down to the camera's largest size, keeping its shape", () => {
    expect(fittedSize(6000, 4000)).toEqual({ width: 1620, height: 1080 });
    expect(fittedSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

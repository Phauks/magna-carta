// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserAudioLevelMeter } from "../src/lib/meetings/client/audio-level-meter.ts";

// The speaking meter in a meeting tab that has had no press of its own. A meeting opens in its own
// tab, and a context made there before a press starts suspended and reads silence, so the meter waits
// for the page's first press before it makes one.

class FakeAudioContext {
  static made = 0;
  state: AudioContextState = "running";
  constructor() {
    FakeAudioContext.made += 1;
  }
  createAnalyser() {
    return { fftSize: 0, getFloatTimeDomainData: () => {} };
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

function activation(hasBeenActive: boolean): void {
  vi.stubGlobal("navigator", { ...navigator, userActivation: { hasBeenActive, isActive: false } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudioContext.made = 0;
});

describe("the speaking meter", () => {
  it("waits for the page's first press before it starts sound, then measures", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("MediaStream", class {});
    activation(false);
    const meter = createBrowserAudioLevelMeter({} as MediaStreamTrack);
    meter.start(() => {});
    expect(FakeAudioContext.made).toBe(0);

    activation(true);
    window.dispatchEvent(new Event("pointerdown"));
    expect(FakeAudioContext.made).toBe(1);
    window.dispatchEvent(new Event("keydown"));
    expect(FakeAudioContext.made).toBe(1);
    meter.stop();
  });

  it("starts at once on a page that has been pressed, and a stop before the press makes nothing", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("MediaStream", class {});
    activation(true);
    const pressed = createBrowserAudioLevelMeter({} as MediaStreamTrack);
    pressed.start(() => {});
    expect(FakeAudioContext.made).toBe(1);
    pressed.stop();

    activation(false);
    const unpressed = createBrowserAudioLevelMeter({} as MediaStreamTrack);
    unpressed.start(() => {});
    unpressed.stop();
    window.dispatchEvent(new Event("pointerdown"));
    expect(FakeAudioContext.made).toBe(1);
  });
});

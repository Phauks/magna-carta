/*
 * What a member chose for their own sound and picture, remembered in this browser.
 *
 * Three things are pinned, because each fails quietly: the choice ROUND-TRIPS (a member who blurred
 * once is blurred on the next join without opening the panel); the DEFAULT is no background
 * treatment with noise reduction on (a first-time member gets the treatment almost everybody wants
 * of somebody else's microphone, and nothing done to their picture they did not choose); and a
 * CORRUPT payload reads as the default rather than as nothing (a byte wrong in storage must never
 * send a member into the room with every effect off, or throw on the way in).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEETING_EFFECTS_STORAGE_KEY,
  meetingEffectsCodec,
  meetingEffectsPreference,
  readMeetingEffects,
} from "$lib/meetings/meeting-effects-preference.svelte.ts";
import { DEFAULT_EFFECT_SETTINGS } from "$lib/meetings/client/media-effects.ts";

/** A browser's storage, as far as the preference reaches it: one string per key. */
class MemoryStorage {
  readonly held = new Map<string, string>();

  getItem(key: string): string | null {
    return this.held.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.held.set(key, value);
  }

  removeItem(key: string): void {
    this.held.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the default", () => {
  it("is no background treatment, with noise reduction on", () => {
    expect(DEFAULT_EFFECT_SETTINGS).toEqual({ background: "none", reduceNoise: true });
    expect(meetingEffectsCodec.decode(null)).toEqual({ background: "none", reduceNoise: true });
  });

  it("is what a browser that has stored nothing reads", () => {
    expect(meetingEffectsPreference().current).toEqual(DEFAULT_EFFECT_SETTINGS);
  });
});

describe("a stored choice", () => {
  it("round-trips through storage", () => {
    const first = meetingEffectsPreference();
    first.set({ background: "blur", reduceNoise: false });

    expect(storage.getItem(MEETING_EFFECTS_STORAGE_KEY)).not.toBeNull();
    // A second reader is the next join on the same machine: it reads what the first one wrote.
    expect(meetingEffectsPreference().current).toEqual({ background: "blur", reduceNoise: false });
  });

  it("round-trips through the codec alone", () => {
    const chosen = { background: "blur", reduceNoise: true } as const;
    expect(meetingEffectsCodec.decode(meetingEffectsCodec.encode(chosen))).toEqual(chosen);
  });
});

describe("a corrupt payload", () => {
  it("reads as the default when it does not parse", () => {
    storage.setItem(MEETING_EFFECTS_STORAGE_KEY, "{not json");
    expect(meetingEffectsPreference().current).toEqual(DEFAULT_EFFECT_SETTINGS);
  });

  it("reads as the default when it is not an object", () => {
    expect(meetingEffectsCodec.decode("true")).toEqual(DEFAULT_EFFECT_SETTINGS);
    expect(meetingEffectsCodec.decode("null")).toEqual(DEFAULT_EFFECT_SETTINGS);
    expect(meetingEffectsCodec.decode("[]")).toEqual(DEFAULT_EFFECT_SETTINGS);
  });

  it("keeps the field that reads and defaults the one that does not", () => {
    expect(readMeetingEffects({ background: "blur", reduceNoise: "yes" })).toEqual({
      background: "blur",
      reduceNoise: true,
    });
    expect(readMeetingEffects({ background: "sepia", reduceNoise: false })).toEqual({
      background: "none",
      reduceNoise: false,
    });
  });
});

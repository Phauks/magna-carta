/*
 * What a member has chosen for their own sound and picture, remembered in this browser.
 *
 * PER BROWSER, NOT PER MEMBER, AND DELIBERATELY. Whether an effect is possible at all is a fact about
 * THIS machine — its camera, its driver, its processor — so a choice that followed a member from a
 * workstation that can blur to a laptop that cannot would arrive as a promise the second machine
 * could not keep. It is a device capability choice, the same class as the sidebar's expand-on-hover,
 * and neither a firm setting nor a work preference. Were a firm ever to want "I always blur" to
 * follow a person, it becomes a member setting whose local value here stays the override, and the
 * storage key is the only thing that moves.
 *
 * APPLIED AT EVERY CAPTURE. The room reads the stored value when it captures and again on every
 * rejoin, so somebody who blurs once is blurred every time on this machine without opening the panel
 * again.
 */
import { jsonPreference, type PreferenceCodec } from "$lib/preferences/persisted-preference.ts";
import {
  createPersistedPreference,
  type PersistedPreference,
} from "$lib/preferences/persisted-preference.svelte.ts";
import { DEFAULT_EFFECT_SETTINGS, type MediaEffectSettings } from "./client/media-effects.ts";

/** Where the choice is kept in this browser. */
export const MEETING_EFFECTS_STORAGE_KEY = "magna-carta-meeting-effects";

/**
 * Read a stored choice back, whatever was stored.
 *
 * TOTAL, like every codec: a payload that does not parse, a value that is not an object, or a field
 * of the wrong kind falls back to the default for that field alone. A browser that once stored
 * something this version cannot read must still reach the room with sensible effects, never with
 * none because one byte was wrong.
 */
export function readMeetingEffects(parsed: unknown): MediaEffectSettings {
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_EFFECT_SETTINGS };
  const background: unknown = Reflect.get(parsed, "background");
  const reduceNoise: unknown = Reflect.get(parsed, "reduceNoise");
  return {
    background:
      background === "blur" || background === "none"
        ? background
        : DEFAULT_EFFECT_SETTINGS.background,
    reduceNoise:
      typeof reduceNoise === "boolean" ? reduceNoise : DEFAULT_EFFECT_SETTINGS.reduceNoise,
  };
}

/** The codec: one key, and the reader above. */
export const meetingEffectsCodec: PreferenceCodec<MediaEffectSettings> = jsonPreference(
  MEETING_EFFECTS_STORAGE_KEY,
  readMeetingEffects,
);

/** A live, remembered choice, for the room screen to read and to write when the member changes it. */
export function meetingEffectsPreference(): PersistedPreference<MediaEffectSettings> {
  return createPersistedPreference(meetingEffectsCodec);
}

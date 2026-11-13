/*
 * How a member likes the room drawn, remembered in this browser: which arrangement, and whether
 * their own picture is shown as a mirror.
 *
 * SPEAKER VIEW IS THE DEFAULT. Most meetings are one person talking at a time, and a large picture
 * of whoever that is reads better on a laptop than an even grid of small ones. The gallery stays one
 * press away, and the press is remembered here, so a member who prefers the grid gets it every time
 * on this machine.
 *
 * THE MIRROR IS ONLY EVER THIS BROWSER'S OWN PREVIEW. People expect to see themselves as they see
 * themselves in a mirror, so it is on by default; what is sent to the room is the camera's own
 * picture either way, because text held up to the camera must read the right way round for
 * everybody else.
 *
 * PER BROWSER, NOT PER MEMBER, on the reasoning in meeting-effects-preference.svelte.ts: a screen's
 * size decides which arrangement is comfortable, and a member moving from a desk to a laptop may
 * want the other one.
 */
import { jsonPreference, type PreferenceCodec } from "$lib/preferences/persisted-preference.ts";
import {
  createPersistedPreference,
  type PersistedPreference,
} from "$lib/preferences/persisted-preference.svelte.ts";

/** The two arrangements of the room. */
export type MeetingLayout = "speaker" | "gallery";

export interface MeetingViewSettings {
  readonly layout: MeetingLayout;
  /** This browser's own camera preview is drawn flipped, as a mirror shows it. */
  readonly mirrorSelf: boolean;
}

export const DEFAULT_MEETING_VIEW: MeetingViewSettings = { layout: "speaker", mirrorSelf: true };

/** Where the choice is kept in this browser. */
export const MEETING_VIEW_STORAGE_KEY = "magna-carta-meeting-view";

/** Read a stored choice back, field by field, falling back to the default for anything unreadable. */
export function readMeetingView(parsed: unknown): MeetingViewSettings {
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_MEETING_VIEW };
  const layout: unknown = Reflect.get(parsed, "layout");
  const mirrorSelf: unknown = Reflect.get(parsed, "mirrorSelf");
  return {
    layout: layout === "speaker" || layout === "gallery" ? layout : DEFAULT_MEETING_VIEW.layout,
    mirrorSelf: typeof mirrorSelf === "boolean" ? mirrorSelf : DEFAULT_MEETING_VIEW.mirrorSelf,
  };
}

export const meetingViewCodec: PreferenceCodec<MeetingViewSettings> = jsonPreference(
  MEETING_VIEW_STORAGE_KEY,
  readMeetingView,
);

/** A live, remembered choice, for the room screens to read and to write when the member changes it. */
export function meetingViewPreference(): PersistedPreference<MeetingViewSettings> {
  return createPersistedPreference(meetingViewCodec);
}

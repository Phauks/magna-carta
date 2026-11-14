/*
 * The firm's meeting settings as a settings draft — the four switches the Meetings page renders,
 * and what each staged value means as a change to send. The staging, counting and saving are the
 * shared server-backed draft's ($lib/settings/server-backed-draft.svelte.ts); this module is the
 * field mapping and the words.
 *
 * EACH ROW SAYS WHAT IT DOES, because each one sends a privileged conversation somewhere it did not
 * go before, and a firm-wide choice with that consequence earns its descriptor. What a row cannot
 * say from its own value — that the deployment cannot record yet, that a summary is waiting on the
 * AI settings — the page states beneath the row it bears on, from the read.
 *
 * THE CEILING'S MAXIMUM IS THE SERVER'S. It is arithmetic over what one recorder holds in memory
 * (packages/meetings/src/settings.ts), the read reports it, and the row is composed from that
 * answer (`meetingSettingsDefinitions`), so the number a firm is told and the number the server
 * refuses past cannot disagree. `RECORDED_TRACK_CEILING_DOCUMENTED_MAXIMUM` stands in only while
 * the read is out.
 */
import type { SettingDefinition, SettingValue } from "$lib/settings/settings-definitions.ts";
import {
  ServerBackedSettingsDraft,
  type ServerBackedField,
} from "$lib/settings/server-backed-draft.svelte.ts";
import {
  readMeetingSettings,
  RECORDED_TRACK_CEILING_MINIMUM,
  updateMeetingSettings,
  type MeetingSettings,
  type MeetingSettingsPatch,
} from "./meeting-settings-api.ts";

/** The settings section this draft belongs to (settings-sections.ts). */
export const MEETINGS_SECTION_ID = "meetings";

/**
 * The ceiling's maximum as the platform documents it, for the moment before the read lands. The
 * value in force is always the read's `recordedTrackCeilingMaximum`.
 */
export const RECORDED_TRACK_CEILING_DOCUMENTED_MAXIMUM = 11;

const RECORDING_PLATE = "Recording";
const SUMMARIES_PLATE = "Summaries";
const CAPTIONS_PLATE = "Live Captions";

export const RECORDING_ENABLED_DEFINITION: SettingDefinition = {
  id: "meetings.recording-enabled",
  sectionId: MEETINGS_SECTION_ID,
  plateLabel: RECORDING_PLATE,
  label: "Record Meetings",
  description:
    "Lets a meeting on a matter be recorded. Everyone in the meeting is told when a recording starts, and so is anyone who joins later. The audio is added to the matter's documents.",
  kind: "switch",
  defaultValue: false,
  sensitivity: "open",
  audited: true,
};

/** The ceiling's row, stating the maximum it is given: the read's, once the read has landed. */
export function recordedTrackCeilingDefinition(maximum: number): SettingDefinition {
  return {
    id: "meetings.recorded-track-ceiling",
    sectionId: MEETINGS_SECTION_ID,
    plateLabel: RECORDING_PLATE,
    label: "People Recorded at Once",
    description: `The most people one recording can hear at once, from ${String(RECORDED_TRACK_CEILING_MINIMUM)} to ${String(maximum)}. ${String(maximum)} is the most the recorder can handle. A larger meeting can't start a recording, and anyone who joins past the limit isn't recorded.`,
    kind: "number",
    minimum: RECORDED_TRACK_CEILING_MINIMUM,
    maximum,
    unit: "participant",
    defaultValue: maximum,
    sensitivity: "open",
    audited: true,
  };
}

export const RECORDED_TRACK_CEILING_DEFINITION = recordedTrackCeilingDefinition(
  RECORDED_TRACK_CEILING_DOCUMENTED_MAXIMUM,
);

export const SUMMARIES_ENABLED_DEFINITION: SettingDefinition = {
  id: "meetings.summaries-enabled",
  sectionId: MEETINGS_SECTION_ID,
  plateLabel: SUMMARIES_PLATE,
  label: "Summarize Recorded Meetings",
  description:
    "Writes a summary and its action items from a recorded meeting's transcript, for the matter team to review.",
  kind: "switch",
  defaultValue: false,
  sensitivity: "open",
  audited: true,
};

export const CAPTIONS_ENABLED_DEFINITION: SettingDefinition = {
  id: "meetings.captions-enabled",
  sectionId: MEETINGS_SECTION_ID,
  plateLabel: CAPTIONS_PLATE,
  label: "Live Captions",
  description:
    "Shows what's being said as text during a live meeting. The meeting doesn't need to be recorded, and captions aren't saved.",
  kind: "switch",
  defaultValue: false,
  sensitivity: "open",
  audited: true,
};

/** Every definition the page renders, in reading order, with the ceiling at the given maximum. */
export function meetingSettingsDefinitions(
  maximum: number = RECORDED_TRACK_CEILING_DOCUMENTED_MAXIMUM,
): readonly SettingDefinition[] {
  return [
    RECORDING_ENABLED_DEFINITION,
    recordedTrackCeilingDefinition(maximum),
    SUMMARIES_ENABLED_DEFINITION,
    CAPTIONS_ENABLED_DEFINITION,
  ];
}

export const MEETINGS_DEFINITIONS: readonly SettingDefinition[] = meetingSettingsDefinitions();

/** A staged ceiling as the integer the server takes, or null when it is not one inside the bounds. */
export function recordedTrackCeilingFromValue(value: SettingValue, maximum: number): number | null {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isInteger(count) && count >= RECORDED_TRACK_CEILING_MINIMUM && count <= maximum
    ? count
    : null;
}

function switchField(
  definition: SettingDefinition,
  key: "recordingEnabled" | "captionsEnabled" | "summariesEnabled",
): ServerBackedField<MeetingSettings, MeetingSettingsPatch> {
  return {
    definition,
    valueOf: (settings) => settings[key],
    applyTo: (patch, value) => (typeof value === "boolean" ? { ...patch, [key]: value } : null),
  };
}

export function createMeetingSettingsDraft(
  fetchImpl: typeof fetch,
): ServerBackedSettingsDraft<MeetingSettings, MeetingSettingsPatch> {
  // The maximum the server last reported, so a typed ceiling is refused at the Save button on the
  // same bound the server would refuse it on.
  let maximum = RECORDED_TRACK_CEILING_DOCUMENTED_MAXIMUM;
  const fields: readonly ServerBackedField<MeetingSettings, MeetingSettingsPatch>[] = [
    switchField(RECORDING_ENABLED_DEFINITION, "recordingEnabled"),
    {
      definition: RECORDED_TRACK_CEILING_DEFINITION,
      valueOf: (settings) => settings.recordedTrackCeiling,
      applyTo: (patch, value) => {
        const recordedTrackCeiling = recordedTrackCeilingFromValue(value, maximum);
        return recordedTrackCeiling === null ? null : { ...patch, recordedTrackCeiling };
      },
      // The one field on this page somebody types into, so the one that can hold a value the
      // server would refuse. Said at the Save button rather than sent and reported back as a 422.
      refusalFor: (value) =>
        recordedTrackCeilingFromValue(value, maximum) === null
          ? `People recorded at once is a whole number from ${String(RECORDED_TRACK_CEILING_MINIMUM)} to ${String(maximum)}.`
          : undefined,
    },
    switchField(SUMMARIES_ENABLED_DEFINITION, "summariesEnabled"),
    switchField(CAPTIONS_ENABLED_DEFINITION, "captionsEnabled"),
  ];
  const remember = (outcome: Awaited<ReturnType<typeof readMeetingSettings>>) => {
    if (outcome.kind === "ok") maximum = outcome.value.recordedTrackCeilingMaximum;
    return outcome;
  };
  return new ServerBackedSettingsDraft({
    sectionId: MEETINGS_SECTION_ID,
    fields,
    read: async () => remember(await readMeetingSettings(fetchImpl)),
    write: async (patch, idempotencyKey) =>
      remember(await updateMeetingSettings(fetchImpl, patch, idempotencyKey)),
  });
}

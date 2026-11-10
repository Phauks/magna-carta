/*
 * The firm's meeting settings over the wire: whether its meetings may be recorded, captioned and
 * summarized, and how many people one recording hears at once. One read and one sparse write
 * against GET/PATCH /api/v1/firm/meetings/settings, both behind `meetings:manageSettings`.
 *
 * The `firmMeetingSettings.get` and `firmMeetingSettings.update` operations, reached through the
 * generated client rather than a hand-written path: the contract is generated and diff-gated, and a
 * module mirroring it by hand is a drift surface nothing keeps honest.
 *
 * THE READ CARRIES TWO FACTS THE PAGE NEVER WRITES. `recordingServiceConfigured` says whether this
 * deployment can record at all, so a firm that switched recording on can be told a recording still
 * cannot start; `aiProcessingEligible` is the firm's third-party AI processing gate, which a summary
 * needs as well and which only the AI settings page writes.
 */
import {
  firmMeetingSettingsGet,
  firmMeetingSettingsUpdate,
  type FirmMeetingSettingsResponse,
  type PatchFirmMeetingSettingsRequest,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type MeetingSettings = FirmMeetingSettingsResponse;

/** A sparse change to the settings. An absent field is left exactly as it stands. */
export type MeetingSettingsPatch = PatchFirmMeetingSettingsRequest;

/** The permission both the read and the write name. Owners and administrators hold it by seed. */
export const MANAGE_MEETING_SETTINGS_PERMISSION = "meetings:manageSettings";

/** The fewest people a recording may be set to hear: a recording that hears nobody is no recording. */
export const RECORDED_TRACK_CEILING_MINIMUM = 1;

export async function readMeetingSettings(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<MeetingSettings>> {
  try {
    const { data } = await firmMeetingSettingsGet({ fetch: fetchImpl, throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** Switches the firm's meeting settings, for everybody; audited on the server. */
export async function updateMeetingSettings(
  fetchImpl: typeof fetch,
  patch: MeetingSettingsPatch,
  idempotencyKey: string,
): Promise<ApiOutcome<MeetingSettings>> {
  try {
    const { data } = await firmMeetingSettingsUpdate({
      fetch: fetchImpl,
      body: patch,
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

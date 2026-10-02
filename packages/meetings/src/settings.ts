import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// Per-firm meeting configuration, read through the generic firm-setting accessor (a missing row IS
// the default in code). Every switch here defaults OFF, so a firm opts into each deliberately: each
// one sends a privileged conversation somewhere it did not go before — into a stored recording, into
// a speech model, into a reasoning model — and that is a decision a firm takes, never one it finds it
// took.

// Whether a meeting on a matter may be recorded at all. Off, the Record control is not offered and the
// start route answers 503 `meeting-recording-not-configured`, on the same terms a deployment without
// media routing answers `meetings-not-configured`: nothing a member can be granted changes it.
export const recordingEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "meetings.recordingEnabled",
  schema: z.boolean(),
  defaultValue: false,
};

// Whether live captions may run. Read by the caption slice; declared now so the four switches the
// recording design names are one family with one home.
export const captionsEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "meetings.captionsEnabled",
  schema: z.boolean(),
  defaultValue: false,
};

// Whether a recorded meeting's transcript is summarized. Read by the summary slice; declared now for
// the same reason as the captions switch.
export const summariesEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "meetings.summariesEnabled",
  schema: z.boolean(),
  defaultValue: false,
};

// HOW MANY TRACKS ONE RECORDING MAY HOLD AT ONCE. The recorder keeps one open socket, one open upload
// and a carry buffer of up to eight mebibytes per track, and a Durable Object has a bounded memory
// budget — so the number of simultaneously recorded tracks is bounded whether a number is named or
// not. Naming it is the difference between a refusal and a crash. Thirty-two is 256 MiB of worst-case
// carry and is a knob rather than doctrine: the real number comes from the load-profile harness. The
// upper bound keeps a fat-fingered write from being indistinguishable from no ceiling at all.
export const recordedTrackCeilingDefinition: FirmSettingDefinition<number> = {
  key: "meetings.recordedTrackCeiling",
  schema: z.number().int().min(1).max(64),
  defaultValue: 32,
};

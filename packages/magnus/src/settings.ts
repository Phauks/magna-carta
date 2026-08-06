import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// Per-firm Magnus configuration, read through the generic firm-setting accessor (a missing row IS the
// default in code). Magnus declares NO model setting: it reads the firm's shipped
// `inference.primaryReasoningModel`, so one firm-level model answer is what the firm configures, sees,
// and discloses — a second model axis here would be a second thing to explain and to keep in step.

// The feature-specific consent gate. Default OFF — the strictest posture; nothing a member types
// reaches a provider on an implicit yes. It sits BESIDE the general
// `inference.aiProcessingEligibility` axis rather than replacing it: a firm that enabled inference for
// document drafting has not thereby consented to a free-form assistant, and a firm that switches the
// assistant off should not thereby disable every other AI feature. Both must be open; the route reads
// them before anything is enqueued, and the queue consumer reads this one again before the model call,
// so a firm that switches Magnus off does not have queued turns continue to reach a provider.
export const magnusEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "magnus.enabled",
  schema: z.boolean(),
  defaultValue: false,
};

// The firm's daily turn allowance, counted over member turns and checked at submission. A real,
// non-infinite default: this is the first surface where one member can generate unbounded provider
// spend just by typing, and an unlimited default would make the firm discover that from an invoice.
// The upper bound keeps a fat-fingered write from being indistinguishable from no limit at all.
export const magnusDailyTurnCeilingDefinition: FirmSettingDefinition<number> = {
  key: "magnus.dailyTurnCeiling",
  schema: z.number().int().min(0).max(100000),
  defaultValue: 500,
};

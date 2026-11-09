import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// Per-firm matters configuration, read through the generic firm-setting accessor (a missing row =
// the default in code). The settings UI is a later slice; these are the storage seam.

// How long a Prospective consultation may sit before the Consultations view flags it stale (a filter
// + bulk-close affordance). A year by default — a firm batches consultations and decides on retention
// well within that; a firm can tighten it.
export const staleConsultationAgeDaysDefinition: FirmSettingDefinition<number> = {
  key: "matters.staleConsultationAgeDays",
  schema: z.number().int().positive(),
  defaultValue: 365,
};

// THE FIRM'S MINIMUM RETENTION FOR A CLOSED MATTER'S PAPER FILE, in whole years after the close.
//
// When a matter closes, the person closing it states the date its paper file may be destroyed
// after, or that it has none; this is the floor under that date. The firm sets it, because the
// period is its jurisdiction's and its own policy's. 0 — the value a firm that has never opened the
// setting holds — means the firm has stated NO minimum, never a period this platform chose: a
// default retention period would be a date somebody destroys a client's file on without anybody
// having decided it. A hundred years is the ceiling only so the field is bounded.
export const FILE_RETENTION_MINIMUM_YEARS_MAXIMUM = 100;

export const fileRetentionMinimumYearsDefinition: FirmSettingDefinition<number> = {
  key: "matters.fileRetentionMinimumYears",
  schema: z.number().int().min(0).max(FILE_RETENTION_MINIMUM_YEARS_MAXIMUM),
  defaultValue: 0,
};

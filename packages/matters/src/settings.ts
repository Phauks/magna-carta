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

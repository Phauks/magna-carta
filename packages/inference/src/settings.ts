import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";
import { reasoningModelIds } from "./catalog.ts";

// Per-firm inference configuration, read through the generic firm-setting accessor (a missing row = the
// default in code). The selection UI is a later slice; these are the storage seam.

// The firm's primary reasoning model. The schema is a refinement over the curated ZDR-eligible reasoning
// subset, so the existing setting write-time validation (writeFirmSettingStatement's schema.parse) is
// the enforcement point: an off-catalog or non-ZDR id is rejected at the write path, no new machinery.
// The read stays total — a missing/invalid stored value yields the safe default.
const reasoningModelSchema = z.string().refine((value) => reasoningModelIds().includes(value), {
  message: "not a selectable ZDR-eligible reasoning model",
});

export const primaryReasoningModelDefinition: FirmSettingDefinition<string> = {
  key: "inference.primaryReasoningModel",
  schema: reasoningModelSchema,
  defaultValue: "anthropic/claude-opus-4-8",
};

// The firm-default policy axis: may this firm's content go to a third-party frontier model at all?
// Default OFF — the strictest posture; privilege never rides on an implicit yes. Per-matter granularity,
// enforcement, and the consent surface land with the first concrete AI feature, which owns the caller.
export const aiProcessingEligibilityDefinition: FirmSettingDefinition<boolean> = {
  key: "inference.aiProcessingEligibility",
  schema: z.boolean(),
  defaultValue: false,
};

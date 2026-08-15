import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";
import {
  PLATFORM_DEFAULT_REASONING_TIER,
  reasoningModelForTier,
  reasoningModelIds,
} from "./catalog.ts";

// Per-firm inference configuration, read through the generic firm-setting accessor (a missing row = the
// default in code). The selection UI is a later slice; these are the storage seam.

// The firm's primary reasoning model. The schema is a refinement over the curated ZDR-eligible reasoning
// subset, so the existing setting write-time validation (writeFirmSettingStatement's schema.parse) is
// the enforcement point: an off-catalog or non-ZDR id is rejected at the write path, no new machinery.
// The read stays total — a missing/invalid stored value yields the safe default.
const reasoningModelSchema = z.string().refine((value) => reasoningModelIds().includes(value), {
  message: "not a selectable ZDR-eligible reasoning model",
});

// The default is DERIVED from the platform's reasoning tier rather than written here as a literal. A
// firm that has never chosen a model follows the tier, so moving the platform forward is a catalog edit
// (or a deploy-configuration override) and never an edit to this line — which is exactly the failure
// this indirection removes, because a literal here would have to be found and changed by whoever
// happened to notice the model had been superseded.
//
// A firm that HAS chosen keeps its choice: the stored value is a model id, and nothing rewrites it. That
// asymmetry is deliberate. A firm's explicit selection is a decision it made about its own confidential
// content, and silently moving it to a different model because the platform's default moved would
// override that decision without telling anyone.
export const primaryReasoningModelDefinition: FirmSettingDefinition<string> = {
  key: "inference.primaryReasoningModel",
  schema: reasoningModelSchema,
  defaultValue: reasoningModelForTier(PLATFORM_DEFAULT_REASONING_TIER).modelId,
};

// The firm-default policy axis: may this firm's content go to a third-party frontier model at all?
// Default OFF — the strictest posture; privilege never rides on an implicit yes. Per-matter granularity,
// enforcement, and the consent surface land with the first concrete AI feature, which owns the caller.
export const aiProcessingEligibilityDefinition: FirmSettingDefinition<boolean> = {
  key: "inference.aiProcessingEligibility",
  schema: z.boolean(),
  defaultValue: false,
};

import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { z } from "zod";
import { DEFAULT_SCAN_POLICY, type ScanPolicy } from "./verdict.ts";

// How a firm's flagged files are treated — chosen per firm, applied at ingest AND access.
// `block`: quarantine, inaccessible (today's behaviour). `informed-access`: commit but gate the raw
// download behind an acknowledgment. `allow-and-flag`: commit and serve, visibly marked. No
// reject/delete option, by design.
export type FlaggedTreatment = "block" | "informed-access" | "allow-and-flag";
export const DEFAULT_FLAGGED_TREATMENT: FlaggedTreatment = "block";

const scanPolicySchema: z.ZodType<ScanPolicy> = z.object({
  tier: z.enum(["core", "extended", "full"]),
  suspiciousScoreFloor: z.number().int().min(0).max(100),
});

export const scanPolicyDefinition: FirmSettingDefinition<ScanPolicy> = {
  key: "scan.policy",
  schema: scanPolicySchema,
  defaultValue: DEFAULT_SCAN_POLICY,
};

export const flaggedTreatmentDefinition: FirmSettingDefinition<FlaggedTreatment> = {
  key: "scan.flagged_treatment",
  schema: z.enum(["block", "informed-access", "allow-and-flag"]),
  defaultValue: DEFAULT_FLAGGED_TREATMENT,
};

// Stored now; the actual step-up challenge (a recent-auth check on a flagged download) is wired in a
// later auth slice — there is no session-age / re-verify mechanism yet.
export const stepUpReauthDefinition: FirmSettingDefinition<boolean> = {
  key: "scan.step_up_reauth_on_flagged",
  schema: z.boolean(),
  defaultValue: false,
};

export function readFirmScanPolicy(database: SqlDatabase): Promise<ScanPolicy> {
  return readFirmSetting(database, scanPolicyDefinition);
}
export function readFlaggedTreatment(database: SqlDatabase): Promise<FlaggedTreatment> {
  return readFirmSetting(database, flaggedTreatmentDefinition);
}
export function readStepUpReauthOnFlagged(database: SqlDatabase): Promise<boolean> {
  return readFirmSetting(database, stepUpReauthDefinition);
}

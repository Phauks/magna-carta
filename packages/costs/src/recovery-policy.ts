import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";
import type { RecoverableChargeLine } from "./recoverable-charge.ts";

// Whether a firm recovers a Magna-Carta-absorbed platform fee for a given category. Default off keeps
// the absorbed fee invisible to the client unless the firm deliberately opts to pass it on. One
// definition PER category so a firm can recover, say, the e-signature fee but not the messaging fee.
// The key namespace uses DOTS (`cost.recover_platform_fee.<category>`); the leading segment is `cost`,
// never `cost_` — the underscore-prefix conformance gate is column-name-only and does not touch a
// dotted setting key.
export function recoverPlatformFeeDefinition(category: string): FirmSettingDefinition<boolean> {
  return {
    key: `cost.recover_platform_fee.${category}`,
    schema: z.boolean(),
    defaultValue: false,
  };
}

// The recovery decision for one line. A `pass_through` disbursement is always recovered — the firm
// merely fronted a third-party cost. A `platform_fee` is recovered only when the firm's per-category
// policy is on, leaving the absorbed-fee default in the firm's favour to the client.
export function shouldRecover(line: RecoverableChargeLine, policyOn: boolean): boolean {
  return line.kind === "pass_through" ? true : policyOn;
}

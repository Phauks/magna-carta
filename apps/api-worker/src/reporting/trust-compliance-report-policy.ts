import { z } from "@hono/zod-openapi";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readFirmSetting,
  type FirmSettingDefinition,
} from "@magna-carta/data-access/setting-statements";

// THE FIRM'S TRUST-COMPLIANCE REPORT POLICY — what the firm decides once about what its own
// compliance document lists.
//
// Two choices the pack offers were controls on the report screen: whether a matter ledger that was
// at zero all period appears, and whether the member who authorized each payment out is named. The
// owner's ruling (2026-09-07) moved both to a FIRM setting: a compliance document should read the
// same every time the firm produces it, and a per-run toggle is how two packs for one period end up
// differing in what they list. What a firm's document asserts is a policy, not a preference.
//
// WHY THIS LIVES IN THE WORKER AND NOT IN @magna-carta/reporting. A firm-setting definition carries
// a zod schema, and the reporting package's purity scan refuses zod outright — the package composes
// report shapes and must never grow a request schema or a write. The definitions therefore sit with
// the two routes that read them (the pack, and the policy itself), and the reporting package keeps
// taking the options as plain values, exactly as before.
//
// The defaults are the pack's own: every ledger listed (completeness argues for it) and the
// authorizer named (the ledger records it on every such movement so that it CAN be produced).

export const TRUST_COMPLIANCE_LISTING_VALUES = ["include", "omit"] as const;
export type TrustComplianceListing = (typeof TRUST_COMPLIANCE_LISTING_VALUES)[number];

const listingSchema = z.enum(TRUST_COMPLIANCE_LISTING_VALUES);

export const zeroBalanceLedgersDefinition: FirmSettingDefinition<TrustComplianceListing> = {
  key: "reports.trustCompliance.zeroBalanceLedgers",
  schema: listingSchema,
  defaultValue: "include",
};

export const authorizersDefinition: FirmSettingDefinition<TrustComplianceListing> = {
  key: "reports.trustCompliance.authorizers",
  schema: listingSchema,
  defaultValue: "include",
};

export interface TrustComplianceReportPolicy {
  readonly zeroBalanceLedgers: TrustComplianceListing;
  readonly authorizers: TrustComplianceListing;
}

export async function readTrustComplianceReportPolicy(
  database: SqlDatabase,
): Promise<TrustComplianceReportPolicy> {
  const [zeroBalanceLedgers, authorizers] = await Promise.all([
    readFirmSetting(database, zeroBalanceLedgersDefinition),
    readFirmSetting(database, authorizersDefinition),
  ]);
  return { zeroBalanceLedgers, authorizers };
}

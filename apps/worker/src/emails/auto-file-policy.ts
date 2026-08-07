import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readFirmSetting,
  type FirmSettingDefinition,
} from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// The firm-level ceiling on unattended filing, stored as a per-firm setting so a missing row IS the
// default and a fresh firm reads a valid answer with no seed and no settings screen.
//
// It is a CEILING, not a default: with it down every rule stages whatever its own posture, so an
// individual member cannot opt the firm into unattended filing. Off until an administrator turns it
// on, because filing a message onto a matter is a durable placement of the firm's data — it decides
// what the matter's correspondence record holds, what a bulk download contains, what a discovery
// export sweeps up, and who can see it. A firm should be able to watch what the rules have been
// proposing, and how often somebody agreed, before granting them the power to act.
//
// Both the capture consumer and the settings route read through here, so the queue path and the API
// can never disagree about what the firm chose.
export const autoFileDirectFilingDefinition: FirmSettingDefinition<boolean> = {
  key: "emails.auto_file_direct_filing_permitted",
  schema: z.boolean(),
  defaultValue: false,
};

export function readAutoFileDirectFilingPermitted(database: SqlDatabase): Promise<boolean> {
  return readFirmSetting(database, autoFileDirectFilingDefinition);
}

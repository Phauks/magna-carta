import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readFirmSetting,
  type FirmSettingDefinition,
} from "@magna-carta/data-access/setting-statements";
import {
  AUTO_FILE_CIRCUIT_BREAKER_BOUNDS,
  DEFAULT_AUTO_FILE_CIRCUIT_BREAKER,
  type AutoFileCircuitBreakerThresholds,
} from "@magna-carta/email-filing/auto-file-rules";
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

// The firm's circuit-breaker thresholds. Stored as one object rather than three rows because they are
// read together on every capture that matches a rule and are only meaningful together — the undo
// threshold is a fraction of the recent-fire window, and half-applying a change would mean a firm
// briefly running on a combination it never chose.
//
// The bounds are the domain package's (@magna-carta/email-filing), so the schema that refuses a bad
// write and the guardrail that refuses a bad stored value cannot drift apart. `maxUndosInRecentFires`
// may not exceed `recentFireWindow`: the undo count is capped by the window it is counted over, so a
// higher threshold could never be reached and the breaker would read as configured while never
// tripping. A stored value outside any of this falls back to the platform defaults on read rather
// than bricking the capture path, which is what readFirmSetting does for every setting.
const circuitBreakerSchema: z.ZodType<AutoFileCircuitBreakerThresholds> = z
  .object({
    maxFiresPerWindow: z
      .number()
      .int()
      .min(AUTO_FILE_CIRCUIT_BREAKER_BOUNDS.maxFiresPerWindow.minimum)
      .max(AUTO_FILE_CIRCUIT_BREAKER_BOUNDS.maxFiresPerWindow.maximum),
    recentFireWindow: z
      .number()
      .int()
      .min(AUTO_FILE_CIRCUIT_BREAKER_BOUNDS.recentFireWindow.minimum)
      .max(AUTO_FILE_CIRCUIT_BREAKER_BOUNDS.recentFireWindow.maximum),
    maxUndosInRecentFires: z
      .number()
      .int()
      .min(AUTO_FILE_CIRCUIT_BREAKER_BOUNDS.maxUndosInRecentFires.minimum)
      .max(AUTO_FILE_CIRCUIT_BREAKER_BOUNDS.maxUndosInRecentFires.maximum),
  })
  .refine((value) => value.maxUndosInRecentFires <= value.recentFireWindow, {
    message: "maxUndosInRecentFires may not exceed recentFireWindow",
    path: ["maxUndosInRecentFires"],
  });

export const autoFileCircuitBreakerDefinition: FirmSettingDefinition<AutoFileCircuitBreakerThresholds> =
  {
    key: "emails.auto_file_circuit_breaker",
    schema: circuitBreakerSchema,
    defaultValue: DEFAULT_AUTO_FILE_CIRCUIT_BREAKER,
  };

export function readAutoFileCircuitBreaker(
  database: SqlDatabase,
): Promise<AutoFileCircuitBreakerThresholds> {
  return readFirmSetting(database, autoFileCircuitBreakerDefinition);
}

// The request schema the settings route validates a client's thresholds against. Exported from here
// rather than written out at the route so the API refuses exactly what the stored-value schema
// refuses — one definition of what a firm may set.
export const autoFileCircuitBreakerRequestSchema = circuitBreakerSchema;

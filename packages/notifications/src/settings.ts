import { z } from "zod";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  readFirmSetting,
  writeFirmSettingStatement,
  type FirmSettingDefinition,
} from "@magna-carta/data-access/setting-statements";
import { SCOPED_SETTING_TABLE } from "@magna-carta/data-access/scoped-setting-statements";
import { readLocationTimeZone } from "@magna-carta/calendar/resource-statements";
import { isResolvableTimeZone } from "@magna-carta/civil-time/time-zone";
import { firmDefaultLocationDefinition } from "@magna-carta/locations/settings";
import type { LocationId } from "@magna-carta/identifiers/types";
import {
  DEFAULT_DIGEST_LOCAL_HOUR,
  DEFAULT_RETENTION_DAYS,
  EMAIL_DETAIL_LEVELS,
  MAX_DIGEST_LOCAL_HOUR,
  MAX_RETENTION_DAYS,
  MIN_DIGEST_LOCAL_HOUR,
  MIN_RETENTION_DAYS,
  moreCautiousEmailDetailLevel,
  type EmailDetailLevel,
} from "./types.ts";

// The two firm-configurable facts this subsystem carries, and the shape a member's own choice
// composes with each.

// HOW LONG A POINTER LIVES.
//
// Firm-configurable inside declared bounds rather than fixed, and firm-level rather than
// per-member: retention is a records-management decision a firm makes once, and a per-member window
// would mean two people looking at the same notification disagreeing about whether it still exists.
//
// The bounds are not decoration. Below thirty days a member returning from two weeks' leave opens
// an empty feed, which is the failure the whole idea of a feed exists to avoid. Above a year the
// feed is an unbounded read, and — the argument that actually binds — every extra day is another
// day a pointer outlives the access check that justified writing it. A firm asking for five years
// is asking for the wrong tool: the record it wants is the matter timeline and the audit log, which
// keep their own retention and are not swept by this.
export const notificationRetentionDaysDefinition: FirmSettingDefinition<number> = {
  key: "notifications.retentionDays",
  schema: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS),
  defaultValue: DEFAULT_RETENTION_DAYS,
};

export function readNotificationRetentionDays(database: SqlDatabase): Promise<number> {
  return readFirmSetting(database, notificationRetentionDaysDefinition);
}

export function writeNotificationRetentionDaysStatement(
  database: SqlDatabase,
  days: number,
  now: string,
): SqlStatement {
  return writeFirmSettingStatement(database, notificationRetentionDaysDefinition, days, now);
}

// WHEN A SUMMARY LANDS — the firm's own wall-clock hour, not the platform's.
//
// Firm-level rather than per-member for the same reason retention is: a firm keeps office hours, and
// a per-member hour would turn one nightly pass into a per-member schedule for a fact nobody would
// tune. The zone is not stored beside it — it is READ from the firm's own default office through
// `resolveFirmDigestZone`, because a second copy of "where this firm is" would eventually disagree
// with the one the calendar already books against.
export const notificationDigestLocalHourDefinition: FirmSettingDefinition<number> = {
  key: "notifications.digestLocalHour",
  schema: z.number().int().min(MIN_DIGEST_LOCAL_HOUR).max(MAX_DIGEST_LOCAL_HOUR),
  defaultValue: DEFAULT_DIGEST_LOCAL_HOUR,
};

export function readNotificationDigestLocalHour(database: SqlDatabase): Promise<number> {
  return readFirmSetting(database, notificationDigestLocalHourDefinition);
}

export function writeNotificationDigestLocalHourStatement(
  database: SqlDatabase,
  hour: number,
  now: string,
): SqlStatement {
  return writeFirmSettingStatement(database, notificationDigestLocalHourDefinition, hour, now);
}

// The firm's zone, resolved from its own default office and never stored twice. Null where the firm
// has set no default location or that location predates the zone column — the caller then anchors on
// the platform's clock, which is stated rather than silently substituted because a firm that has not
// told the platform where it is has not been promised a local morning.
export async function resolveFirmDigestZone(database: SqlDatabase): Promise<string | null> {
  const defaultLocationId = await readFirmSetting(database, firmDefaultLocationDefinition);
  if (defaultLocationId === null) return null;
  const timeZone = await readLocationTimeZone(database, defaultLocationId as LocationId);
  return timeZone !== null && isResolvableTimeZone(timeZone) ? timeZone : null;
}

// HOW MUCH AN EMAIL MAY SAY — a MEMBER'S choice under a FIRM'S ceiling.
//
// Two tiers of one key, and they compose in one direction only: a member may choose any level AT OR
// MORE PRIVATE THAN their firm's ceiling, and never a less private one. That asymmetry is the whole
// point. A firm has a legitimate interest in capping what leaves its platform in a mailbox it may
// not administer; it has no legitimate interest in forcing a member's mail to carry MORE about a
// client than that member is comfortable putting there. So the ceiling binds downward and the
// member's choice binds downward, and the resolved answer is the more cautious of the two.
//
// The platform default is `counts-only`: an email states the shape of the queue and never its
// contents. `off` is a member's or a firm's right to say the mail should carry nothing at all.
// `matter-number` is declared and NOT BUILT — it is in the vocabulary because a stored ceiling must
// not be silently rewritten when the level ships, and because a firm choosing it is expressing a
// preference the platform should record rather than lose.
export const EMAIL_DETAIL_LEVEL_KEY = "notifications.emailDetailLevel";

const emailDetailLevelSchema = z.enum(EMAIL_DETAIL_LEVELS);

export const DEFAULT_EMAIL_DETAIL_LEVEL: EmailDetailLevel = "counts-only";

export interface ResolvedEmailDetailLevel {
  // What the firm permits at most.
  readonly firmCeiling: EmailDetailLevel;
  // What the member asked for, or null where they have expressed no preference.
  readonly memberChoice: EmailDetailLevel | null;
  // What actually applies: the more cautious of the two.
  readonly effective: EmailDetailLevel;
}

// One query for both tiers rather than two resolutions of one key. The scope chain's own resolver
// answers "the most specific value", which is the wrong question here — a member's less-private
// choice must not win over a firm's ceiling just because it is more specific, and asking the
// resolver twice would be two round trips on a path that runs once per recipient.
export async function resolveEmailDetailLevel(
  database: SqlDatabase,
  userId: string,
): Promise<ResolvedEmailDetailLevel> {
  const { results } = await database
    .prepare(
      `SELECT scope_tier, scoped_id, value FROM ${SCOPED_SETTING_TABLE} WHERE key = ?1 AND ((scope_tier = 'firm' AND scoped_id IS NULL) OR (scope_tier = 'user' AND scoped_id = ?2))`,
    )
    .bind(EMAIL_DETAIL_LEVEL_KEY, userId)
    .all<{ scope_tier: string; scoped_id: string | null; value: string }>();

  let firmCeiling = DEFAULT_EMAIL_DETAIL_LEVEL;
  let memberChoice: EmailDetailLevel | null = null;
  for (const row of results) {
    const parsed = parseEmailDetailLevel(row.value);
    if (parsed === null) continue; // a bad write must never brick a read — fall through to the default
    if (row.scope_tier === "firm") firmCeiling = parsed;
    else memberChoice = parsed;
  }

  return {
    firmCeiling,
    memberChoice,
    effective:
      memberChoice === null ? firmCeiling : moreCautiousEmailDetailLevel(memberChoice, firmCeiling),
  };
}

function parseEmailDetailLevel(stored: string): EmailDetailLevel | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  const validated = emailDetailLevelSchema.safeParse(parsed);
  return validated.success ? validated.data : null;
}

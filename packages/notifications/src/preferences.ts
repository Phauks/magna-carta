import { z } from "zod";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  SCOPED_SETTING_TABLE,
  writeScopedSettingStatement,
  type ScopedSettingDefinition,
} from "@magna-carta/data-access/scoped-setting-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import { categoryIsMandatory } from "./registry.ts";
import {
  defaultEmailCadenceFor,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EMAIL_CADENCES,
  NOTIFICATION_IN_APP_CHOICES,
  type InAppSuppressionReason,
  type NotificationCategory,
  type NotificationEmailCadence,
  type NotificationInAppChoice,
} from "./types.ts";

// WHO HEARS WHAT, and who gets to decide it.
//
// Two tiers of one scoped-setting key, composing in DIFFERENT DIRECTIONS for the two channels, and
// that asymmetry is the whole content of this file:
//
//   * IN APP, the firm's tier is a FLOOR. A firm may insist a category reaches its members and a
//     member may not switch it back off, because an in-app row is inside the platform: it is behind
//     the session, the chokepoint, and the visible-matter predicate, and it costs the member
//     nothing but a badge.
//   * BY EMAIL, the member's tier WINS. A firm may not force a member's cadence upward, because
//     forcing email is forcing privileged-adjacent metadata into a mailbox that may be a personal
//     address, may be outside the firm's administration, and is beyond both the audit log and the
//     wall. A firm that needs assurance a partner sees trust events has a better instrument: the
//     mandatory in-app row, plus the trust reconciliation reports, which are a firm-scoped read
//     with a permission of their own.
//
// Above both, two categories are non-silenceable in app whatever either tier says — the ones that
// mirror the non-optional stance of the audit log. `categoryIsMandatory` is the one place that is
// decided, so a type cannot quietly opt itself out of the floor.

// ONE KEY holding the whole matrix, not one key per category. Reads of the scope chain are one key
// per call, so eleven category keys would be eleven round trips on a path that runs once per
// recipient per fan-out. One key is one query.
export const NOTIFICATION_PREFERENCES_KEY = "notifications.preferences";

const categoryChoiceSchema = z
  .object({
    inApp: z.enum(NOTIFICATION_IN_APP_CHOICES).optional(),
    email: z.enum(NOTIFICATION_EMAIL_CADENCES).optional(),
  })
  .strict();

export type NotificationCategoryChoice = z.infer<typeof categoryChoiceSchema>;

// Written out category by category rather than generated, so the stored shape is a type the checker
// knows and not a cast. `test/preferences.test.ts` asserts the schema's keys are exactly
// NOTIFICATION_CATEGORIES, which is what stops a category being added to the vocabulary and
// silently having no preference.
//
// Every field is optional and a stored value is a SPARSE patch: a member who has silenced one
// category stores one entry. That is what lets the recommended defaults change later without
// rewriting a row in every firm — an absent entry means "whatever the platform recommends", which
// is a different fact from "the member chose today's recommendation".
const notificationPreferencesSchema = z
  .object({
    deadlines: categoryChoiceSchema.optional(),
    calendar: categoryChoiceSchema.optional(),
    trust: categoryChoiceSchema.optional(),
    billing: categoryChoiceSchema.optional(),
    documents: categoryChoiceSchema.optional(),
    custody: categoryChoiceSchema.optional(),
    email: categoryChoiceSchema.optional(),
    conflicts: categoryChoiceSchema.optional(),
    jobs: categoryChoiceSchema.optional(),
    security: categoryChoiceSchema.optional(),
    system: categoryChoiceSchema.optional(),
  })
  .strict();

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

// The definition the write path composes through, so a preference row is validated by the same
// schema that reads it. The in-code default is the EMPTY patch rather than the expanded matrix: the
// recommended values are computed per category by `resolveCategoryPreference` below, and storing
// them would freeze today's recommendation into every firm's database.
export const notificationPreferencesDefinition: ScopedSettingDefinition<NotificationPreferences> = {
  key: NOTIFICATION_PREFERENCES_KEY,
  schema: notificationPreferencesSchema,
  defaultValue: {},
};

export function writeMemberNotificationPreferencesStatement(
  database: SqlDatabase,
  userId: string,
  preferences: NotificationPreferences,
  now: string,
): SqlStatement {
  return writeScopedSettingStatement(
    database,
    notificationPreferencesDefinition,
    "user",
    userId,
    preferences,
    now,
  );
}

export function writeFirmNotificationPreferencesStatement(
  database: SqlDatabase,
  preferences: NotificationPreferences,
  now: string,
): SqlStatement {
  return writeScopedSettingStatement(
    database,
    notificationPreferencesDefinition,
    "firm",
    null,
    preferences,
    now,
  );
}

// One tier's stored patch, applied to another sparse patch of the same shape. Three states per
// channel, and the middle one is why a plain spread will not do: absent means leave what is there,
// null means CLEAR the choice at this tier so the next one down applies, a value means set it. A
// category left with no choices at all is dropped rather than stored as an empty object, so "this
// tier has expressed nothing here" has one representation in the row.
//
// Shared by both tiers on purpose. The member's PATCH and the firm's PATCH merge identically — what
// differs is only which scope row the result is written to, and which direction the two tiers then
// compose in at resolution (`resolveCategoryPreference`). Two copies of this would be two subtly
// different notions of what clearing a preference means.
export function mergeNotificationPreferences(
  stored: NotificationPreferences,
  patch: Partial<
    Record<NotificationCategory, { inApp?: string | null; email?: string | null } | undefined>
  >,
): NotificationPreferences {
  const merged: Record<string, NotificationCategoryChoice> = {
    ...(stored as Record<string, NotificationCategoryChoice>),
  };
  for (const [category, change] of Object.entries(patch)) {
    if (change === undefined) continue;
    const current = merged[category] ?? {};
    const next: NotificationCategoryChoice = {};
    const inApp = change.inApp === undefined ? current.inApp : (change.inApp ?? undefined);
    if (inApp !== undefined) next.inApp = inApp as NotificationCategoryChoice["inApp"];
    const email = change.email === undefined ? current.email : (change.email ?? undefined);
    if (email !== undefined) next.email = email as NotificationCategoryChoice["email"];

    if (next.inApp === undefined && next.email === undefined) delete merged[category];
    else merged[category] = next;
  }
  return merged as NotificationPreferences;
}

// What actually applies to one member for one category, and — just as important — WHY. A surface
// that could only report the effective value would have to render a switch that silently refuses to
// move; `inAppLockedBy` is what lets it render a locked switch that says who locked it.
export interface ResolvedCategoryPreference {
  readonly category: NotificationCategory;
  readonly inApp: NotificationInAppChoice;
  readonly email: NotificationEmailCadence;
  // Null where the member's own choice decides. `mandatory` is the platform's floor, `firm-policy`
  // the firm's.
  readonly inAppLockedBy: "mandatory" | "firm-policy" | null;
  // Why no in-app row is written, where none is. Null whenever `inApp` is `on`. This is the label
  // the fan-out records against the member, so a suppression is attributable rather than absent.
  readonly inAppSuppressionReason: InAppSuppressionReason | null;
  // The raw tiers, so a surface can show a member what they chose as distinct from what applies.
  readonly memberChoice: NotificationCategoryChoice | null;
  readonly firmChoice: NotificationCategoryChoice | null;
}

export type ResolvedNotificationPreferences = ReadonlyMap<
  NotificationCategory,
  ResolvedCategoryPreference
>;

export function resolveCategoryPreference(
  category: NotificationCategory,
  memberChoice: NotificationCategoryChoice | null,
  firmChoice: NotificationCategoryChoice | null,
): ResolvedCategoryPreference {
  const shared = { category, memberChoice, firmChoice } as const;

  // Email first, and by the plain scope chain: most specific wins. A member who said `off` keeps
  // `off` however loudly the firm's tier says `daily`.
  const email = memberChoice?.email ?? firmChoice?.email ?? defaultEmailCadenceFor(category);

  if (categoryIsMandatory(category)) {
    // Non-silenceable in app, whatever either tier stored. The member may still have set an email
    // cadence for it, and that choice stands — forcing a copy into a mailbox is a different act
    // from putting a row in a feed the platform controls.
    return {
      ...shared,
      inApp: "on",
      email,
      inAppLockedBy: "mandatory",
      inAppSuppressionReason: null,
    };
  }
  if (firmChoice?.inApp === "on") {
    // The firm raised the floor. A member cannot override a floor downward — that is what makes it
    // a floor rather than another default.
    return {
      ...shared,
      inApp: "on",
      email,
      inAppLockedBy: "firm-policy",
      inAppSuppressionReason: null,
    };
  }

  // Nothing is locked, so the member decides; the firm's `off`, where it set one, is a firm-wide
  // DEFAULT the member may raise rather than a ceiling they may not. The firm has no legitimate
  // interest in preventing somebody from hearing about their own work.
  const inApp = memberChoice?.inApp ?? firmChoice?.inApp ?? "on";
  return {
    ...shared,
    inApp,
    email,
    inAppLockedBy: null,
    inAppSuppressionReason:
      inApp === "on" ? null : memberChoice?.inApp === "off" ? "member-preference" : "firm-policy",
  };
}

// THE FIRM'S TRUST-COMPLIANCE DESIGNATION: zero or more members who join the recipient set of every
// trust-category notification, in addition to whoever the kind's own audience already resolves.
//
// A DESIGNATION IS NOT A GRANT OF ACCESS. A designated member is added to the recipient set and
// nothing else: the visible-matter predicate still decides, at read, what any of those rows may
// show them, and a row about a matter they may not see simply is not on their feed and is not in
// their count. There is no placeholder — a "1 item you cannot see" row is an existence oracle, and
// the fix for a partner who needs to hear about a screened matter is granting the access rather
// than leaking around it.
export const TRUST_COMPLIANCE_RECIPIENTS_KEY = "notifications.trustComplianceRecipients";

// A designation is a small named group — a managing partner, a bookkeeper, a compliance officer.
// A list the size of a firm's staff is a firm using this as a broadcast, which the mandatory in-app
// row on the trust category already does better and without a setting anybody has to maintain.
export const MAX_TRUST_COMPLIANCE_RECIPIENTS = 20;

const trustComplianceRecipientsSchema = z
  .array(z.string().min(1))
  .max(MAX_TRUST_COMPLIANCE_RECIPIENTS);

export const trustComplianceRecipientsDefinition: ScopedSettingDefinition<readonly string[]> = {
  key: TRUST_COMPLIANCE_RECIPIENTS_KEY,
  schema: trustComplianceRecipientsSchema,
  defaultValue: [],
};

export function writeTrustComplianceRecipientsStatement(
  database: SqlDatabase,
  recipientUserIds: readonly string[],
  now: string,
): SqlStatement {
  return writeScopedSettingStatement(
    database,
    trustComplianceRecipientsDefinition,
    "firm",
    null,
    // Sorted and deduplicated at the write so the stored value is canonical: two firms that
    // designated the same three people store the same bytes, and a redelivered write is a no-op
    // rather than a reordering.
    [...new Set(recipientUserIds)].sort(),
    now,
  );
}

// THE PER-PASS POLICY READER.
//
// A fan-out resolves a recipient set per event, and one firm's sweep resolves hundreds of them from
// the same handful of members. Reading the preference chain per event would be that many round
// trips for an answer that does not change inside a pass, so the reader is constructed ONCE by
// whoever is running the pass and memoizes per member. It holds a database handle and no clock, and
// the cache lives exactly as long as the pass does — a member who changes a preference mid-sweep is
// answered by the next one, which is the correct severity for this fact.
export interface NotificationPolicyReader {
  preferencesFor(
    userIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, ResolvedNotificationPreferences>>;
  // The designated members who are still ACTIVE. The stored list is the firm's configuration and
  // outlives a departure by design — the firm removes a name when it decides to, not when somebody
  // leaves — but a fan-out must not keep addressing a member who cannot sign in, and this audience
  // reaches email where a deactivated member's feed does not. The same filter the capability-holders
  // and matter-assignment resolvers apply, for the same reason. The configuration read behind the
  // preference API is deliberately UNfiltered, so a firm can see the departed name it needs to remove.
  trustComplianceRecipients(): Promise<readonly UserId[]>;
}

export function createNotificationPolicyReader(database: SqlDatabase): NotificationPolicyReader {
  const resolved = new Map<UserId, ResolvedNotificationPreferences>();
  let designated: readonly UserId[] | null = null;

  return {
    async preferencesFor(userIds) {
      const missing = [...new Set(userIds)].filter((userId) => !resolved.has(userId));
      if (missing.length > 0) {
        const rows = await readPreferenceRows(database, missing);
        for (const userId of missing) {
          resolved.set(userId, resolveAllCategories(rows.byUser.get(userId) ?? null, rows.firm));
        }
      }
      const answer = new Map<UserId, ResolvedNotificationPreferences>();
      for (const userId of userIds) {
        const entry = resolved.get(userId);
        if (entry !== undefined) answer.set(userId, entry);
      }
      return answer;
    },
    async trustComplianceRecipients() {
      designated ??= await activeDesignatedRecipients(database);
      return designated;
    },
  };
}

async function activeDesignatedRecipients(database: SqlDatabase): Promise<readonly UserId[]> {
  const configured = await readTrustComplianceRecipients(database);
  if (configured.length === 0) return [];
  const placeholders = configured.map((_userId, index) => `?${index + 1}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT user_id FROM member WHERE status = 'active' AND user_id IN (${placeholders}) ORDER BY user_id`,
    )
    .bind(...configured)
    .all<{ user_id: string }>();
  return results.map((row) => row.user_id as UserId);
}

// One member's whole matrix, for a surface that is showing it rather than enforcing it.
export async function resolveNotificationPreferencesForMember(
  database: SqlDatabase,
  userId: string,
): Promise<ResolvedNotificationPreferences> {
  const rows = await readPreferenceRows(database, [userId]);
  return resolveAllCategories(rows.byUser.get(userId) ?? null, rows.firm);
}

// What the member themselves stored, unresolved — the value a PATCH merges into. Read separately
// from the resolution because a patch must not accidentally persist the firm's tier or the
// platform's recommendation as though the member had chosen them.
export async function readMemberNotificationPreferences(
  database: SqlDatabase,
  userId: string,
): Promise<NotificationPreferences> {
  const rows = await readPreferenceRows(database, [userId]);
  return rows.byUser.get(userId) ?? {};
}

// What the FIRM stored, unresolved — the value the firm's own PATCH merges into, and the only tier
// an administration surface may show as "what this firm has decided". Read separately from any
// member's resolution for the same reason the member read is: a patch must not persist another
// tier's value, or the platform's recommendation, as though the firm had chosen it.
export async function readFirmNotificationPreferences(
  database: SqlDatabase,
): Promise<NotificationPreferences> {
  const rows = await readPreferenceRows(database, []);
  return rows.firm ?? {};
}

export async function readTrustComplianceRecipients(
  database: SqlDatabase,
): Promise<readonly UserId[]> {
  const { results } = await database
    .prepare(
      `SELECT value FROM ${SCOPED_SETTING_TABLE} WHERE key = ?1 AND scope_tier = 'firm' AND scoped_id IS NULL`,
    )
    .bind(TRUST_COMPLIANCE_RECIPIENTS_KEY)
    .all<{ value: string }>();
  const parsed = parseStored(results[0]?.value, trustComplianceRecipientsSchema);
  return (parsed ?? []).map((recipientUserId) => recipientUserId as UserId);
}

function resolveAllCategories(
  memberChoice: NotificationPreferences | null,
  firmChoice: NotificationPreferences | null,
): ResolvedNotificationPreferences {
  const answer = new Map<NotificationCategory, ResolvedCategoryPreference>();
  for (const category of NOTIFICATION_CATEGORIES) {
    answer.set(
      category,
      resolveCategoryPreference(
        category,
        memberChoice?.[category] ?? null,
        firmChoice?.[category] ?? null,
      ),
    );
  }
  return answer;
}

interface PreferenceRows {
  readonly firm: NotificationPreferences | null;
  readonly byUser: ReadonlyMap<string, NotificationPreferences>;
}

// ONE query for the firm's tier and every member asked about. Bounded by the number of members in
// the fan-out rather than by the firm's whole staff, because a fan-out is capped and a staff list
// is not — and the generic scope-chain resolver, which reads every row for a key, answers a
// different question anyway: it returns the most specific value, where the two channels here need
// both tiers side by side to compose in opposite directions.
async function readPreferenceRows(
  database: SqlDatabase,
  userIds: readonly string[],
): Promise<PreferenceRows> {
  const userPlaceholders = userIds.map((_userId, index) => `?${index + 2}`).join(", ");
  const userArm =
    userIds.length === 0 ? "" : ` OR (scope_tier = 'user' AND scoped_id IN (${userPlaceholders}))`;
  const { results } = await database
    .prepare(
      `SELECT scope_tier, scoped_id, value FROM ${SCOPED_SETTING_TABLE} WHERE key = ?1 AND ((scope_tier = 'firm' AND scoped_id IS NULL)${userArm})`,
    )
    .bind(NOTIFICATION_PREFERENCES_KEY, ...userIds)
    .all<{ scope_tier: string; scoped_id: string | null; value: string }>();

  let firm: NotificationPreferences | null = null;
  const byUser = new Map<string, NotificationPreferences>();
  for (const row of results) {
    const parsed = parseStored(row.value, notificationPreferencesSchema);
    // A stored value that will not parse must never brick a read: the member falls through to the
    // firm's tier and then to the recommended default, which is the same posture every settings
    // read in the platform takes.
    if (parsed === null) continue;
    if (row.scope_tier === "firm") firm = parsed;
    else if (row.scoped_id !== null) byUser.set(row.scoped_id, parsed);
  }
  return { firm, byUser };
}

function parseStored<T>(stored: string | undefined, schema: z.ZodType<T>): T | null {
  if (stored === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  const validated = schema.safeParse(parsed);
  return validated.success ? validated.data : null;
}

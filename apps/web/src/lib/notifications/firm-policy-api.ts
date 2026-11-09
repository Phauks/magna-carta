/*
 * The firm's notification policy — the three levers a firm holds over what the platform tells its
 * members, kept apart from a member's own switches.
 *
 * THE TWO CHANNELS ARE NOT SYMMETRICAL, and the whole page turns on it:
 *
 * - In app, `on` is a FLOOR. The category reaches every member and no member may switch it off.
 *   `off` is only a firm-wide DEFAULT — a member may still turn it on for themselves, because a
 *   firm has no legitimate interest in stopping somebody hearing about their own work. `null` is
 *   the firm expressing nothing, which is a different fact from the firm choosing what the
 *   platform already recommends.
 * - By email, every value is a DEFAULT and none is a ceiling. A member's own cadence always wins,
 *   because forcing a copy into a mailbox that may be personal, may be outside the firm's
 *   administration, and is beyond both the audit log and the visibility filter is not a thing a
 *   firm may do to somebody.
 *
 * Two categories are non-silenceable in app whatever either tier says, so the firm's lever over
 * them is already spent. The composition itself is decided in exactly one place — server-side, in
 * `resolveCategoryPreference` — and this surface only supplies a tier to it.
 *
 * Mirrors the `firmNotificationPolicy.get` and `firmNotificationPolicy.update` operations in
 * apps/api-worker/openapi/openapi.json.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
import type {
  NotificationCategory,
  NotificationEmailCadence,
  NotificationInAppChoice,
} from "./category-vocabulary.ts";

/** The firm's stored tier for one category, unresolved. Null on a channel means it said nothing. */
export interface FirmCategoryPolicy {
  category: NotificationCategory;
  inApp: NotificationInAppChoice | null;
  email: NotificationEmailCadence | null;
}

export interface FirmNotificationPolicy {
  categories: FirmCategoryPolicy[];
  /** How long every member's notification pointers live, in days. */
  retentionDays: number;
  /** The local hour the firm's summary mail lands, 0-23. */
  digestLocalHour: number;
}

/** A sparse change. A field absent is unchanged; a channel set to null clears the firm's tier. */
export interface FirmNotificationPolicyPatch {
  categories?: Partial<
    Record<
      NotificationCategory,
      { inApp?: NotificationInAppChoice | null; email?: NotificationEmailCadence | null }
    >
  >;
  retentionDays?: number;
  digestLocalHour?: number;
}

/** The permission this surface names — Admin by seed, never the member key. */
export const MANAGE_NOTIFICATION_POLICY_PERMISSION = "firm:manageNotificationPolicy";

/** The server's own bounds, mirrored so the page refuses out of range where the value is typed. */
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 365;
export const MIN_DIGEST_LOCAL_HOUR = 0;
export const MAX_DIGEST_LOCAL_HOUR = 23;

export function readFirmNotificationPolicy(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<FirmNotificationPolicy>> {
  return requestJson(fetchImpl, "/api/v1/firm/notifications/policy");
}

export function updateFirmNotificationPolicy(
  fetchImpl: typeof fetch,
  patch: FirmNotificationPolicyPatch,
  idempotencyKey: string,
): Promise<ApiOutcome<FirmNotificationPolicy>> {
  return requestJson(fetchImpl, "/api/v1/firm/notifications/policy", {
    method: "PATCH",
    body: patch,
    idempotencyKey,
  });
}

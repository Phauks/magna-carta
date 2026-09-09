/*
 * A member's own notification preferences — the per-category matrix, what it costs them, and the
 * write that changes one switch.
 *
 * TWO CHANNELS THAT COMPOSE IN OPPOSITE DIRECTIONS, which is the whole content of this surface and
 * the reason the server resolves it rather than the screen. In app, the firm's tier is a FLOOR: a
 * firm may insist a category reaches its members and a member may not switch that back off. By
 * email, the member's tier WINS: a firm may not force a cadence upward, because forcing email is
 * forcing privileged-adjacent metadata into a mailbox that may be personal and is beyond both the
 * audit log and the visibility filter. Above both, two categories cannot be silenced in app at all.
 *
 * So the page never works out what applies. Every row arrives resolved, with `inAppLockedBy` saying
 * whether the member may move it and who decided, and the member's own raw choice beside it — the
 * page renders those answers and sends back only what the member asked for.
 *
 * Mirrors the `notificationPreferences.get` and `notificationPreferences.update` operations in
 * apps/api-worker/openapi/openapi.json.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
import type {
  NotificationCategory,
  NotificationEmailCadence,
  NotificationInAppChoice,
} from "./category-vocabulary.ts";

/** What a member (or the firm) asked for on a category; a channel absent is a channel unstated. */
export interface NotificationChoice {
  inApp?: NotificationInAppChoice;
  email?: NotificationEmailCadence;
}

export interface ResolvedCategoryPreference {
  category: NotificationCategory;
  /** What applies in app — not necessarily what the member asked for; see `inAppLockedBy`. */
  inApp: NotificationInAppChoice;
  email: NotificationEmailCadence;
  /**
   * Why the in-app switch cannot be moved, where it cannot. `mandatory` is the platform's own
   * floor on the categories that mirror the non-optional stance of the audit log; `firm-policy` is
   * this firm raising the floor for itself. Null means the member decides.
   */
  inAppLockedBy: "mandatory" | "firm-policy" | null;
  /** The raw tiers, so a surface can show what was chosen as distinct from what applies. */
  memberChoice: NotificationChoice | null;
  firmChoice: NotificationChoice | null;
}

/**
 * What a choice has COST, reported back to the member who made it. A preference system's failure
 * mode is silence — something that should have arrived did not, and nothing says a setting is the
 * reason — so a suppression is counted rather than left as an absence. These are the member's own
 * counts, never a colleague's.
 */
export interface SuppressionTally {
  category: NotificationCategory;
  reason: string;
  count: number;
  lastSuppressedAt: string;
}

export interface NotificationPreferences {
  categories: ResolvedCategoryPreference[];
  suppressedInApp: SuppressionTally[];
  /** How far back the counts reach — the firm's retention window, the same clock they age out on. */
  suppressedSinceCivilDate: string;
}

/** A sparse change. A category absent is unchanged; a channel set to null clears the member's own
 * choice for it, falling back to the firm's tier and then to the platform's recommendation. */
export type NotificationPreferencesPatch = Partial<
  Record<
    NotificationCategory,
    { inApp?: NotificationInAppChoice | null; email?: NotificationEmailCadence | null }
  >
>;

/**
 * The permission both the read and the write name. Seeded to every default role including
 * Read-only: a member configuring their own feed is the same self-scoped act as reading it.
 */
export const NOTIFICATIONS_READ_PERMISSION = "notifications:read";

export function readNotificationPreferences(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<NotificationPreferences>> {
  return requestJson(fetchImpl, "/api/v1/notifications/preferences");
}

export function updateNotificationPreferences(
  fetchImpl: typeof fetch,
  categories: NotificationPreferencesPatch,
  idempotencyKey: string,
): Promise<ApiOutcome<NotificationPreferences>> {
  return requestJson(fetchImpl, "/api/v1/notifications/preferences", {
    method: "PATCH",
    body: { categories },
    idempotencyKey,
  });
}

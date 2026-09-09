/*
 * The firm's time-capture policy — the increment a captured duration rounds to, and the direction
 * it rounds in.
 *
 * THIS IS THE FIRM TIER, not the resolved answer for a capture. Both keys are scope-overridable: a
 * matter, a client, a timekeeper or a location may carry its own value, and the resolver walks
 * most-specific-first. What a settings screen must show is the firm's own value — the one it is
 * about to overwrite — which equals the resolved one only when no override exists. The resolved
 * answer for a particular capture is a different read on the time-entries surface, and a settings
 * page reading that one would show a matter's override as though it were the firm's rule.
 *
 * Mirrors the `firmTimePolicy.get` and `firmTimePolicy.update` operations in
 * apps/api-worker/openapi/openapi.json.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** How a duration that falls between increments is resolved. */
export type RoundingDirection = "up" | "nearest" | "down";

export interface FirmTimePolicy {
  /** The minimum billing increment, in minutes. Also what one billing unit is worth. */
  incrementMinutes: number;
  roundingDirection: RoundingDirection;
}

/** A sparse change. An absent field is left exactly as it stands. */
export interface FirmTimePolicyPatch {
  incrementMinutes?: number;
  roundingDirection?: RoundingDirection;
}

/** The permission both the read and the write name. A member without it is refused server-side. */
export const MANAGE_TIME_SETTINGS_PERMISSION = "time:manageSettings";

/** The server's own bound, mirrored so the page refuses an out-of-range increment where it is typed. */
export const MAX_INCREMENT_MINUTES = 60;

export function readFirmTimePolicy(fetchImpl: typeof fetch): Promise<ApiOutcome<FirmTimePolicy>> {
  return requestJson(fetchImpl, "/api/v1/firm/time-policy");
}

export function updateFirmTimePolicy(
  fetchImpl: typeof fetch,
  patch: FirmTimePolicyPatch,
  idempotencyKey: string,
): Promise<ApiOutcome<FirmTimePolicy>> {
  return requestJson(fetchImpl, "/api/v1/firm/time-policy", {
    method: "PATCH",
    body: patch,
    idempotencyKey,
  });
}

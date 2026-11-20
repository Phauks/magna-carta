/*
 * How a client found the firm: the firm's list of referral sources, and one record's referral.
 *
 * Mirrors `directory.listReferralSources`, `directory.createReferralSource`,
 * `directory.updateReferralSource`, `directory.entityReferral` and `directory.setEntityReferral` in
 * apps/api-worker/openapi/openapi.json. Every call resolves rather than throws.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** One source on the firm's list. */
export interface ReferralSource {
  id: string;
  name: string;
  position: number;
  /** A retired source stays on the clients recorded under it and is not offered for a new choice. */
  archived: boolean;
}

/** One record's referral: a source, the person or organization who referred them, or both. */
export interface EntityReferral {
  source: { id: string; name: string; archived: boolean } | null;
  referrer: { entityId: string; displayName: string | null; mergedIntoId: string | null } | null;
}

export function listReferralSources(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: ReferralSource[] }>> {
  return requestJson(fetchImpl, "/api/v1/directory/referral-sources");
}

export function createReferralSource(
  fetchImpl: typeof fetch,
  request: { name: string },
  idempotencyKey: string,
): Promise<ApiOutcome<ReferralSource>> {
  return requestJson(fetchImpl, "/api/v1/directory/referral-sources", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** Renames, moves (`position` is the place in the list, from zero), retires or restores a source. */
export function updateReferralSource(
  fetchImpl: typeof fetch,
  sourceId: string,
  request: { name?: string; position?: number; archived?: boolean },
  idempotencyKey: string,
): Promise<ApiOutcome<ReferralSource>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/referral-sources/${encodeURIComponent(sourceId)}`,
    { method: "PATCH", body: request, idempotencyKey },
  );
}

export function readEntityReferral(
  fetchImpl: typeof fetch,
  entityId: string,
): Promise<ApiOutcome<{ referral: EntityReferral | null }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/referral`,
  );
}

/** Records a record's referral. Both null removes it. */
export function setEntityReferral(
  fetchImpl: typeof fetch,
  entityId: string,
  request: { sourceId: string | null; referrerEntityId: string | null },
  idempotencyKey: string,
): Promise<ApiOutcome<{ referral: EntityReferral | null }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/entities/${encodeURIComponent(entityId)}/referral`,
    { method: "PUT", body: request, idempotencyKey },
  );
}

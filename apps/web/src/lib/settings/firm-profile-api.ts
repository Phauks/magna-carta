/*
 * The firm's own name, as its clients read it.
 *
 * THE READ IS THE SESSION, like the release channel's. The bootstrap already returns the firm's
 * display name as `firm.name` — the chokepoint resolves it for every request anyway — so there is
 * no GET here and no second answer for a screen to reconcile against the session it already holds.
 *
 * What the server stores behind that name is two columns, and only one of them is this. `firm.name`
 * is the provisioning handle: unique, and for a self-serve firm generated rather than chosen.
 * `firm.display_name` is the human-facing one, and it is what this writes.
 *
 * Mirrors the `firmProfile.set` operation in apps/api-worker/openapi/openapi.json.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** The permission the write names — Owner/Admin by seed, never the member-administration key. */
export const MANAGE_FIRM_PROFILE_PERMISSION = "firm:manageProfile";

/** The server's own bound, mirrored so the page refuses a too-long name where it is typed. */
export const MAX_FIRM_DISPLAY_NAME_LENGTH = 200;

export function setFirmProfile(
  fetchImpl: typeof fetch,
  displayName: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ displayName: string }>> {
  return requestJson(fetchImpl, "/api/v1/firm/profile", {
    method: "PUT",
    body: { displayName },
    idempotencyKey,
  });
}

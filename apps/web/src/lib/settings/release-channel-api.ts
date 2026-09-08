/*
 * The firm's release channel — whether it runs the shipped build or the one ahead of it.
 *
 * THE READ IS THE SESSION. Every session resolves the channel already, to evaluate the feature
 * flags it carries, so the bootstrap answers it and there is no second endpoint to ask. That is
 * also why a change has to be re-read from the session rather than trusted from the write's own
 * answer: the flags the new channel resolves to are what actually changes the product, and they
 * arrive with the next bootstrap.
 *
 * THE WRITE'S VOCABULARY IS NARROWER THAN THE READ'S, deliberately. A firm may move between stable
 * and beta; `alpha` is a platform channel a firm can neither enter nor leave from inside the
 * product, so a firm on it reads its own state and is offered nothing — the alternative would be a
 * control that answers 422 for reasons the firm cannot act on.
 *
 * ENTERING BETA TAKES AN EXPLICIT ACKNOWLEDGEMENT and returning to stable takes none. That
 * asymmetry is the server's (the route refuses beta without `consentAcknowledged`), and it is the
 * right way round: a firm running pre-release behavior on live client data has accepted something,
 * and a firm stepping back from it has not.
 *
 * Mirrors the `releaseChannel.set` operation in apps/api-worker/openapi/openapi.json.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** What a firm may be on. */
export type ReleaseChannel = "stable" | "beta" | "alpha";

/** What a firm may move to. Alpha is platform-only and deliberately absent. */
export type ChoosableReleaseChannel = "stable" | "beta";

/** The permission the write names. A member without it reads the channel and cannot move it. */
export const MANAGE_RELEASE_CHANNEL_PERMISSION = "firm:manageReleaseChannel";

export function setReleaseChannel(
  fetchImpl: typeof fetch,
  channel: ChoosableReleaseChannel,
  idempotencyKey: string,
): Promise<ApiOutcome<{ channel: ChoosableReleaseChannel }>> {
  return requestJson(fetchImpl, "/api/v1/firm/release-channel", {
    method: "PUT",
    // The acknowledgement is what the server refuses beta without, and it is only ever true on the
    // way in: sending it on the way back to stable would be recording a consent nobody gave.
    body: { channel, consentAcknowledged: channel === "beta" },
    idempotencyKey,
  });
}

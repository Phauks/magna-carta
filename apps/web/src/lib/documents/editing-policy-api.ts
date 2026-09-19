/*
 * The firm's editing policy: whether every document opened in the browser editor records its
 * changes.
 *
 * The `editingPolicy.get` and `editingPolicy.update` operations, reached through the generated
 * client rather than a hand-written path: the contract is generated and diff-gated, and a module
 * mirroring it by hand is a drift surface nothing keeps honest. The same policy is read by the
 * WOPI host on every open, so a change here reaches the next document opened.
 *
 * The outcomes are the three every settings draft renders (ok, a refusal the server described,
 * nothing answered), assembled from the failure the client's own interceptor already recorded —
 * so a refusal here is reported once, structurally, like every other call the app makes.
 */
import {
  editingPolicyGet,
  editingPolicyUpdate,
  type EditingPolicyResponse,
  type PatchEditingPolicyRequest,
} from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type EditingPolicySettings = EditingPolicyResponse;

/** A sparse change to the policy. An absent field is left exactly as it stands. */
export type EditingPolicyPatch = PatchEditingPolicyRequest;

/** The permission both the read and the write name. A member without it is refused server-side. */
export const MANAGE_EDITING_POLICY_PERMISSION = "firm:manageEditingPolicy";

/**
 * The generated operation's answer as an outcome. With `throwOnError` off the client hands back
 * either the data or the error its interceptor assembled; `failureOf` reads the failure out of the
 * latter, and a failure with no problem is one nothing answered.
 */
function outcomeOf<T>(result: { data?: T; error?: unknown }): ApiOutcome<T> {
  if (result.data !== undefined) return { kind: "ok", value: result.data };
  const failure = failureOf(result.error);
  return failure.problem === null
    ? { kind: "transport", failure }
    : { kind: "problem", problem: failure.problem, failure };
}

export async function readEditingPolicy(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<EditingPolicySettings>> {
  return outcomeOf(await editingPolicyGet({ fetch: fetchImpl }));
}

export async function updateEditingPolicy(
  fetchImpl: typeof fetch,
  patch: EditingPolicyPatch,
  idempotencyKey: string,
): Promise<ApiOutcome<EditingPolicySettings>> {
  return outcomeOf(
    await editingPolicyUpdate({
      fetch: fetchImpl,
      body: patch,
      headers: { "idempotency-key": idempotencyKey },
    }),
  );
}

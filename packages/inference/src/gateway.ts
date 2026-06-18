import type { FirmId } from "@magna-carta/identifiers/types";
import { adapterError, type Dispatch } from "@magna-carta/integrations/dispatch";
import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";
import { isZdrEligible } from "./catalog.ts";

// All firms share one gateway per environment. The control plane below is pinned on EVERY request via
// the AI binding's documented `gateway` options object (id/skipCache/collectLog/metadata) — NOT via
// cf-aig-* string headers, which are the REST-API surface the binding does not read. These options are
// the confidentiality and tenant-isolation guarantees the InferencePort promises, realized as gateway
// controls the interface never names.
export const GATEWAY_ID = "magna-carta-inference";

// The exact object passed as { gateway } to env.AI.run. skipCache is pinned true (caching off);
// collectLog is pinned false (the binding's logging toggle is all-or-nothing — there is no payload-only
// option on the binding path — so we turn logging off outright; no prompt/response body is ever logged,
// and authoritative usage is read from the response, not the logs). No cacheKey is ever set.
export interface GatewayOptions {
  readonly id: string;
  readonly skipCache: true;
  readonly collectLog: false;
  readonly metadata: Record<string, string>;
}

// Firm metadata is DERIVED from the firm-scoped call context, never caller-supplied — the tag fails
// open (the request still runs, mis-metered) if omitted, so it must be structural here. Opaque ids only:
// the metadata is logged in cleartext, so it carries no client/matter text. The redundant model tag is
// dropped (model is already a native gateway log/spend dimension). Capped well under the 5-key gateway
// limit so a future matter_id key still fits.
export function deriveFirmMetadata(
  firmId: FirmId,
  slot: string,
  env: string,
): Record<string, string> {
  return { firm_id: firmId, slot, env };
}

// Caching off + logging off, on every firm-data request. The default cache key carries no firm
// dimension under shared Cloudflare-managed billing credentials, so a byte-identical prompt from two
// firms could collide — caching stays off, and no cacheKey is ever set (any future cache key MUST be
// firm-id-prefixed; see the firm-prefixed-cache-key fitness guard).
export function gatewayOptions(firmId: FirmId, slot: string, env: string): GatewayOptions {
  return {
    id: GATEWAY_ID,
    skipCache: true,
    collectLog: false,
    metadata: deriveFirmMetadata(firmId, slot, env),
  };
}

// The fail-closed ZDR guard: before dispatch, assert the selected model is ZDR-eligible in the catalog.
// On a miss it returns a caller-safe problem — never the model id or any upstream text. The category is
// "validation" (non-retryable): this is a LOCAL fail-closed policy refusal, not an upstream failure, so
// it must never be advertised as a retryable upstream error a caller would re-attempt.
export function assertZdrEligible(modelId: string): IntegrationProblem | null {
  if (isZdrEligible(modelId)) return null;
  return integrationProblem("validation", 400, "Model is not eligible for zero-data-retention", {
    detail:
      "The selected model is not zero-data-retention eligible and cannot process firm content.",
  });
}

// AiBinding is a minimal structural type seam over the platform Ai binding so the pure package needs
// no @cloudflare/workers-types dependency. The worker provides the real binding at the composition root.
export interface AiBinding {
  run(model: string, input: unknown, options: { gateway: GatewayOptions }): Promise<unknown>;
}

export function zdrRejection<T>(modelId: string): Dispatch<T> {
  const problem = assertZdrEligible(modelId);
  // Only call this when a rejection is intended; a null here is a programming error, surfaced loud.
  if (problem === null) throw new Error("zdrRejection called for a ZDR-eligible model");
  return adapterError<T>(problem);
}

import {
  decodeSealResponse,
  encodeSealRequest,
  type SealPort,
  type SealRequest,
  type SealResponse,
} from "@magna-carta/signing/port";

// The sign service's HTTP surface, narrowed to the one call the adapter makes. The SIGN_SERVICE
// Fetcher binding satisfies it; tests pass a fake so the adapter is exercised without a real sign
// worker running in the pool.
export interface SignServiceFetcher {
  fetch(request: Request): Promise<Response>;
}

/**
 * Raised when a seal is requested but the sign service cannot apply it because the platform signing
 * identity is not configured (the worker deploys before its secrets are set — deferred activation) or
 * the binding is absent entirely. The route maps it to 503, distinct from a genuine seal failure over
 * a well-formed request (which is a 422 — the document, not the service, is the problem).
 */
export class SealNotConfiguredError extends Error {
  constructor() {
    super("seal-not-configured");
    this.name = "SealNotConfiguredError";
  }
}

/**
 * Raised when the sign service rejects a well-formed seal request — the document could not be sealed
 * (unparseable PDF, no page to anchor the signature, capacity exceeded). Permanent for these bytes, so
 * the route maps it to 422 rather than inviting an endless retry.
 */
export class SealFailedError extends Error {
  constructor(status: number) {
    super(`seal-failed:${status}`);
    this.name = "SealFailedError";
  }
}

// Forwards a seal request to the dedicated sign worker (magna-carta-sign) over its service binding,
// serializing with the shared SealPort wire codec so both sides encode identically and never drift.
// The signing key lives only inside that worker; this adapter never sees key material.
function serviceBindingSealAdapter(service: SignServiceFetcher): SealPort {
  return {
    async seal(request: SealRequest): Promise<SealResponse> {
      const response = await service.fetch(
        new Request("http://sign/seal", { method: "POST", body: encodeSealRequest(request) }),
      );
      // 503 is the sign worker's honest "not configured" while its secrets are unset — a transient
      // operational state, not a bad document, so surface it as such rather than as a seal failure.
      if (response.status === 503) {
        throw new SealNotConfiguredError();
      }
      if (response.status !== 200) {
        throw new SealFailedError(response.status);
      }
      return decodeSealResponse(await response.text());
    },
  };
}

// The no-service adapter: the binding is absent (the sign worker is not deployed, or the local test
// pool has no stub for it), so every seal honestly reports the service unavailable rather than
// pretending to seal. Mirrors resolveScanPort's engine-less fallback.
const sealNotConfiguredAdapter: SealPort = {
  seal(): Promise<SealResponse> {
    return Promise.reject(new SealNotConfiguredError());
  },
};

/**
 * Resolve the active seal port. Sealing runs in the standalone sign worker (magna-carta-sign), reached
 * over the SIGN_SERVICE binding and selected here when the binding is present. Absent in every test
 * environment (a service binding to an unavailable service will not boot the pool, so tests bind a
 * stub) and before the sign worker is deployed, where the not-configured adapter runs (an honest 503,
 * never a fabricated seal).
 */
export function resolveSealPort(service: SignServiceFetcher | undefined): SealPort {
  return service === undefined ? sealNotConfiguredAdapter : serviceBindingSealAdapter(service);
}

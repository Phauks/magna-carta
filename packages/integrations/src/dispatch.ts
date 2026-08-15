import type { IntegrationProblem } from "./problem.ts";

// A dispatch outcome is a typed sum, never a bare throw. `not-connected` (no usable connection),
// `capability-unsupported` (the descriptor says no) and `credential-store-not-implemented` (the
// deployment has no per-firm credential read at all) are first-class so callers branch instead of
// catching; `adapter-error` carries a normalized problem.
//
// `credential-store-not-implemented` is deliberately NOT folded into `not-connected`. They are
// answered by different people: a firm fixes the first by connecting an account, and only a build
// fixes the second — so a surface that reported "connect your account" would send a member at a
// door that cannot open. It is the same first-class deferred-seam state the conversion and search
// ports name (`engine-not-implemented` in packages/conversion/src/port.ts), for the same reason:
// an unbuilt backing is a fact about the platform, and stating it beats throwing at the seam.
export type DispatchFailureReason =
  | "not-connected"
  | "capability-unsupported"
  | "credential-store-not-implemented"
  | "adapter-error";

export type Dispatch<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: DispatchFailureReason;
      readonly problem?: IntegrationProblem;
    };

export function ok<T>(value: T): Dispatch<T> {
  return { ok: true, value };
}

export function notConnected<T = never>(): Dispatch<T> {
  return { ok: false, reason: "not-connected" };
}

export function capabilityUnsupported<T = never>(): Dispatch<T> {
  return { ok: false, reason: "capability-unsupported" };
}

export function credentialStoreNotImplemented<T = never>(): Dispatch<T> {
  return { ok: false, reason: "credential-store-not-implemented" };
}

export function adapterError<T = never>(problem: IntegrationProblem): Dispatch<T> {
  return { ok: false, reason: "adapter-error", problem };
}

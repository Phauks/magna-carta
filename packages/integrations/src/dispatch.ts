import type { IntegrationProblem } from "./problem.ts";

// A dispatch outcome is a typed sum, never a bare throw. `not-connected` (no usable connection) and
// `capability-unsupported` (the descriptor says no) are first-class so callers branch instead of
// catching; `adapter-error` carries a normalized problem.
export type DispatchFailureReason = "not-connected" | "capability-unsupported" | "adapter-error";

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

export function adapterError<T = never>(problem: IntegrationProblem): Dispatch<T> {
  return { ok: false, reason: "adapter-error", problem };
}

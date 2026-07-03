import type { PlatformOperatorAccessRow } from "@magna-carta/data-access/platform-operator-statements";

export type PlatformOperatorDecision =
  | { allow: true }
  | { allow: false; reason: "not-operator" | "mfa-required" };

// Authorize a platform-operator action. Membership must exist AND the acting account must have
// two-factor enabled — a platform-trust identity should not rest on a password alone.
export function decidePlatformOperatorAccess(
  row: PlatformOperatorAccessRow | undefined,
): PlatformOperatorDecision {
  if (row === undefined) return { allow: false, reason: "not-operator" };
  if (!row.two_factor_enabled) return { allow: false, reason: "mfa-required" };
  return { allow: true };
}

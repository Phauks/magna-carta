// Local input shape — deliberately NOT imported from @magna-carta/data-access: that package already
// depends on @magna-carta/access-control (for its resolver), so importing back would create a
// workspace dependency cycle. The decision only needs this row structurally; the data-access
// package's PlatformOperatorAccessRow (packages/data-access/src/platform-operator-statements.ts)
// satisfies this shape and callers pass it straight through.
export interface PlatformOperatorAccessRow {
  readonly user_id: string;
  readonly two_factor_enabled: number;
}

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

import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// The firm's release policy, read from the flat per-firm setting table. Read by hand rather than
// through a schema-validated definition because this package holds no zod (test/purity.test.ts
// enforces that), and validated the same way `packages/conflicts/src/settings.ts` validates its
// policy: a missing, corrupt, or nonsense row reads as the default rather than failing a release.

// A per-firm setting and NOT a platform default, because whether two people must sign an original
// out of a safe is a firm's own risk decision — a small firm where one person is the only person
// present cannot operate under a rule the platform imposed on it. The default is off: turning a gate
// on quietly would make the platform's opinion look like the firm's own practice, and the release
// gate proper (identity and authority captured at all) is unconditional regardless of this setting.
export interface CustodyReleasePolicy {
  readonly requireTwoSignatories: boolean;
}

export const DEFAULT_CUSTODY_RELEASE_POLICY: CustodyReleasePolicy = {
  requireTwoSignatories: false,
};

const SETTING_KEY = "custody.releasePolicy";

export async function readCustodyReleasePolicy(
  database: SqlDatabase,
): Promise<CustodyReleasePolicy> {
  const { results } = await database
    .prepare(`SELECT value FROM setting WHERE key = ?1`)
    .bind(SETTING_KEY)
    .all<{ value: string }>();

  const row = results[0];
  if (row === undefined) return DEFAULT_CUSTODY_RELEASE_POLICY;

  let parsed: Partial<CustodyReleasePolicy>;
  try {
    parsed = JSON.parse(row.value) as Partial<CustodyReleasePolicy>;
  } catch {
    // A corrupt row must not make every release unrecordable — fall back to the default posture.
    return DEFAULT_CUSTODY_RELEASE_POLICY;
  }

  return {
    requireTwoSignatories:
      typeof parsed.requireTwoSignatories === "boolean"
        ? parsed.requireTwoSignatories
        : DEFAULT_CUSTODY_RELEASE_POLICY.requireTwoSignatories,
  };
}

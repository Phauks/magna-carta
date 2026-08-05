import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { CustodyValidationError } from "./validation.ts";

// The firm's custody settings, read from the flat per-firm setting table. Read by hand rather than
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

// The firm's own list of ownership labels — owner, joint owner, life tenant, trustee, executor,
// whatever a firm actually writes. A PER-FIRM CATALOG AND NEVER A PLATFORM ENUM: the forms of
// ownership a document can be held under are jurisdiction-specific, there is no release-authority
// engine that consumes them, and a fixed list would be this subsystem asserting that a firm's real
// arrangement does not exist.
//
// An EMPTY catalog constrains nothing, and that is the default. A firm that has configured no list is
// not made to configure one before it can log a packet — the failure mode this register exists to
// prevent is a firm keeping its safe on a sticky note, and a validation gate on day one produces
// exactly that. Once a firm has written its list down, the label is checked against it, because at
// that point a label outside the list is a typo the firm has told us how to catch.
const OWNERSHIP_ROLE_CATALOG_KEY = "custody.ownershipRoleCatalog";

export async function readCustodyOwnershipRoleCatalog(
  database: SqlDatabase,
): Promise<readonly string[]> {
  const { results } = await database
    .prepare(`SELECT value FROM setting WHERE key = ?1`)
    .bind(OWNERSHIP_ROLE_CATALOG_KEY)
    .all<{ value: string }>();

  const row = results[0];
  if (row === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    // A corrupt row must not make every packet unloggable — fall back to constraining nothing.
    return [];
  }
  const labels = Array.isArray(parsed) ? parsed : (parsed as { roles?: unknown })?.roles;
  if (!Array.isArray(labels)) return [];
  return labels
    .filter((label): label is string => typeof label === "string")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

// Compared case-insensitively and trimmed: a firm writing "Executor" against a catalog entry of
// "executor" has made no mistake, and refusing it would teach people to stop using the field.
export function assertCustodyOwnershipRole(
  ownershipRole: string | null | undefined,
  catalog: readonly string[],
): void {
  if (catalog.length === 0) return;
  const label = ownershipRole?.trim();
  if (label === undefined || label.length === 0) return;
  const permitted = catalog.some((entry) => entry.toLowerCase() === label.toLowerCase());
  if (permitted) return;
  throw new CustodyValidationError(
    "custody-ownership-role-not-in-catalog",
    `"${label}" is not one of the ownership roles this firm has configured (${catalog.join(", ")})`,
  );
}

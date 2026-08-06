import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { MatterAssetValidationError } from "./validation.ts";

// The firm's own list of interest labels — owner, joint owner, life tenant, remainderman, trustee,
// payable-on-death beneficiary, whatever a firm actually writes. A PER-FIRM CATALOG AND NEVER A
// PLATFORM ENUM, and the reuse is deliberate rather than a second mechanism: the custody register
// already settled this exact shape for ownership roles, for the same reason. The forms an interest
// can be held under are jurisdiction-specific and unevenly named, there is no engine here that
// consumes them, and a fixed list would be this subsystem asserting that a firm's real arrangement
// does not exist.
//
// An EMPTY catalog constrains nothing. A firm that has cleared its list is not made to configure one
// before it can log an asset — the failure this register exists to prevent is an inventory kept in a
// spreadsheet, and a validation gate on day one produces exactly that. While the list has entries, a
// label outside it is a typo the firm has told us how to catch.
const INTEREST_ROLE_CATALOG_KEY = "matterAssets.interestRoleCatalog";

export async function readMatterAssetInterestRoleCatalog(
  database: SqlDatabase,
): Promise<readonly string[]> {
  const { results } = await database
    .prepare(`SELECT value FROM setting WHERE key = ?1`)
    .bind(INTEREST_ROLE_CATALOG_KEY)
    .all<{ value: string }>();

  const row = results[0];
  if (row === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    // A corrupt row must not make every asset unloggable — fall back to constraining nothing.
    return [];
  }
  const labels = Array.isArray(parsed) ? parsed : (parsed as { roles?: unknown })?.roles;
  if (!Array.isArray(labels)) return [];
  return labels
    .filter((label): label is string => typeof label === "string")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

// Compared case-insensitively and trimmed: a firm writing "Trustee" against a catalog entry of
// "trustee" has made no mistake, and refusing it would teach people to stop using the field.
export function assertMatterAssetInterestRole(
  interestRole: string | null | undefined,
  catalog: readonly string[],
): void {
  if (catalog.length === 0) return;
  const label = interestRole?.trim();
  if (label === undefined || label.length === 0) return;
  const permitted = catalog.some((entry) => entry.toLowerCase() === label.toLowerCase());
  if (permitted) return;
  throw new MatterAssetValidationError(
    "matter-asset-interest-role-not-in-catalog",
    `"${label}" is not one of the interest roles this firm has configured (${catalog.join(", ")})`,
  );
}

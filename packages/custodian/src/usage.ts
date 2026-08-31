import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { LocationId } from "@magna-carta/identifiers/types";
import { selectCustodyItemCountsByFirmLocationStatement } from "./location-statements.ts";

export interface CustodyItemCountByLocation {
  // The firm office the holding node's root binds to; null collects every item held at an
  // external root (a bank vault, an offsite vendor), which is not one of the firm's offices.
  readonly locationId: LocationId | null;
  readonly items: number;
}

// The firm-usage read: how many items the register holds, per office. Counts only — nothing
// identifying leaves this package, because the register's metadata alone is a disclosure. Offices
// arrive as bare location handles; the caller joins names from the location domain's own read.
export async function readCustodyItemCountsByLocation(
  database: SqlDatabase,
): Promise<readonly CustodyItemCountByLocation[]> {
  const { results } = await selectCustodyItemCountsByFirmLocationStatement(database).all<{
    firm_location_id: LocationId | null;
    items: number;
  }>();
  return results.map((row) => ({ locationId: row.firm_location_id, items: row.items }));
}

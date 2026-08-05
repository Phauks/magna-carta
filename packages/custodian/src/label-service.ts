import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { CustodyLocationId, CustodyPacketId } from "@magna-carta/identifiers/types";
import { CUSTODY_LABELS_PER_SHEET, renderCustodyLabelSheet } from "./labels/label-sheet.ts";
import type { CustodyLabel } from "./labels/label-sheet.ts";
import { CUSTODY_LOCATION_TABLE } from "./location-statements.ts";
import { CUSTODY_PACKET_TABLE } from "./packet-statements.ts";
import { CustodyValidationError } from "./validation.ts";

// Builds the labels a firm sticks on a physical object, from the register rows they name.
//
// The barcode carries the IDENTIFIER HANDLE, not the custody number. A person reads the number; a
// scanner resolves the object, and those want different things. A custody number is firm-defined and
// re-renderable — a firm changes its prefix, migrates a paper register, or carries in a duplicate
// from a prior system — while the handle is the row. Encoding the number would mean a scan resolves
// through a lookup rule that can change under the labels already stuck to boxes in a safe, which is
// the one thing a physical label cannot tolerate.
//
// Only linear Code 128 ships. A records-room scanner reads it, it encodes everything a handle
// contains, and it is a published table plus a checksum. QR would add a much larger encoder
// (Reed-Solomon over GF(256), four mask-evaluation passes, version selection) for capacity nothing
// here needs — a label carries one handle, not a payload — so it waits until scan-to-locate has a
// concrete reason to want it.

export interface BuildCustodyLabelsInput {
  readonly packetIds?: readonly CustodyPacketId[];
  readonly locationIds?: readonly CustodyLocationId[];
  // Where on a partly-used sheet to start printing, zero-based.
  readonly startPosition?: number;
}

export interface BuiltCustodyLabelSheet {
  readonly svg: string;
  readonly labelCount: number;
}

export async function buildCustodyLabelSheet(
  database: SqlDatabase,
  input: BuildCustodyLabelsInput,
): Promise<BuiltCustodyLabelSheet> {
  const packetIds = input.packetIds ?? [];
  const locationIds = input.locationIds ?? [];
  const startPosition = input.startPosition ?? 0;
  if (packetIds.length + locationIds.length === 0) {
    throw new CustodyValidationError(
      "custody-label-selection-invalid",
      "name at least one packet or location to print a label for",
    );
  }
  if (startPosition < 0 || startPosition >= CUSTODY_LABELS_PER_SHEET) {
    throw new CustodyValidationError(
      "custody-label-selection-invalid",
      `a sheet holds ${CUSTODY_LABELS_PER_SHEET} labels, so the starting position is between 0 and ${CUSTODY_LABELS_PER_SHEET - 1}`,
    );
  }
  if (packetIds.length + locationIds.length + startPosition > CUSTODY_LABELS_PER_SHEET) {
    throw new CustodyValidationError(
      "custody-label-selection-invalid",
      `a sheet holds ${CUSTODY_LABELS_PER_SHEET} labels — print the rest on a second sheet rather than losing them off the end of this one`,
    );
  }

  const [packets, locations] = await Promise.all([
    readPacketLabelRows(database, packetIds),
    readLocationLabelRows(database, locationIds),
  ]);
  // An id that resolves to nothing is refused rather than skipped: a sheet with a label silently
  // missing is a sheet somebody sticks on the wrong box.
  assertResolved(
    packetIds,
    packets.map((row) => row.id),
    "packet",
  );
  assertResolved(
    locationIds,
    locations.map((row) => row.id),
    "location",
  );

  // Requested order, so the sheet comes out in the order the person selected — a selection ordered
  // by shelf position prints in shelf order, which is how labels actually get applied.
  const packetById = new Map(packets.map((row) => [row.id, row]));
  const locationById = new Map(locations.map((row) => [row.id, row]));
  const labels: CustodyLabel[] = [
    ...packetIds.map((id) => {
      const row = packetById.get(id);
      return {
        scanPayload: id,
        headline: row?.custody_number ?? id,
        lines: [row?.name ?? ""],
      };
    }),
    ...locationIds.map((id) => {
      const row = locationById.get(id);
      return {
        scanPayload: id,
        headline: row?.name ?? id,
        lines: [row?.kind ?? ""],
      };
    }),
  ];
  return {
    svg: renderCustodyLabelSheet(labels, { startPosition }),
    labelCount: labels.length,
  };
}

interface PacketLabelRow {
  readonly id: CustodyPacketId;
  readonly custody_number: string;
  readonly name: string;
}

async function readPacketLabelRows(
  database: SqlDatabase,
  ids: readonly CustodyPacketId[],
): Promise<PacketLabelRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT id, custody_number, name FROM ${CUSTODY_PACKET_TABLE} WHERE id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<PacketLabelRow>();
  return results;
}

interface LocationLabelRow {
  readonly id: CustodyLocationId;
  readonly name: string;
  readonly kind: string;
}

async function readLocationLabelRows(
  database: SqlDatabase,
  ids: readonly CustodyLocationId[],
): Promise<LocationLabelRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await database
    .prepare(`SELECT id, name, kind FROM ${CUSTODY_LOCATION_TABLE} WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<LocationLabelRow>();
  return results;
}

function assertResolved(
  requested: readonly string[],
  found: readonly string[],
  kind: "packet" | "location",
): void {
  const foundIds = new Set(found);
  const missing = requested.find((id) => !foundIds.has(id));
  if (missing === undefined) return;
  throw new CustodyValidationError(
    kind === "packet" ? "custody-unknown-packet" : "custody-unknown-location",
    `no such custody ${kind}: ${missing}`,
  );
}

/*
 * The register's declarative column model — what the platform's one table is told about the packets
 * a firm holds. Pure: it takes the container tree's names and returns columns, so what a column IS
 * has one home and one test, and the screens own only fetching and rendering.
 *
 * Three decisions worth stating, because each is about not inventing:
 *
 *   - The CUSTODY NUMBER anchors the row. It is what a person writes on a physical label, reads
 *     aloud over the phone, and searches by, so it always leads and is never hidden. It is set in
 *     tabular figures at the cell, because a column of them is read down.
 *   - LOCATION resolves against the firm's own container tree, read once per screen and joined
 *     here — never one request per row. A node the tree does not name renders EMPTY rather than as
 *     the handle: a location that was closed and is no longer listed is an honest gap, and printing
 *     `custodyLocation_01J…` at a person is not an answer.
 *   - A packet that is OUT has no location, and its cell says so with the register's own word
 *     rather than a blank. The shelf really is empty while the deed is at a completion meeting, and
 *     a gap there would read as a record the platform failed to fill.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { CustodyPacketSummary } from "./custody-api.ts";
import { packetStatusEntry } from "./custody-vocabulary.ts";

/** What a packet's location handle resolves to, by handle. */
export interface CustodyRegisterVocabulary {
  locationNames: ReadonlyMap<string, string>;
}

/** An empty vocabulary — what a screen holds before the container tree lands. */
export const EMPTY_CUSTODY_VOCABULARY: CustodyRegisterVocabulary = { locationNames: new Map() };

/** Build the lookup the column model needs from the tree read. */
export function custodyRegisterVocabulary(
  locations: readonly { id: string; name: string }[],
): CustodyRegisterVocabulary {
  return { locationNames: new Map(locations.map((location) => [location.id, location.name])) };
}

/**
 * What the location cell reads for a packet the register holds no shelf for.
 *
 * Tied to the STATUS, not merely to the absent handle. A packet that is out, released, destroyed or
 * lost is at no location by construction and the cell states that; a held packet with no location
 * is a row somebody wrote without one, which is a gap and reads as one.
 */
export const NOT_ON_A_SHELF = "Not on a shelf";

/** The location as it prints. */
export function packetLocationText(
  packet: CustodyPacketSummary,
  vocabulary: CustodyRegisterVocabulary,
): string {
  if (packet.currentLocationId !== null) {
    return vocabulary.locationNames.get(packet.currentLocationId) ?? "";
  }
  return packet.status === "held" ? "" : NOT_ON_A_SHELF;
}

/**
 * The register's columns. Sorting, the per-column filters, show/hide, reorder, pinning and resize
 * are the grid's; this only declares what each column is.
 *
 * Status and Location take the SET filter — a checkbox list with counts — because each is a small
 * closed vocabulary in practice: a person narrows a register by picking the safe they mean, not by
 * typing its name. Name takes the default contains-text filter, and Logged the date range.
 */
export function custodyPacketColumns(
  vocabulary: CustodyRegisterVocabulary,
): GridColumn<CustodyPacketSummary>[] {
  return [
    {
      id: "custodyNumber",
      label: "Custody Number",
      anchored: true,
      value: (packet) => packet.custodyNumber,
    },
    { id: "name", label: "Packet", value: (packet) => packet.name },
    {
      id: "status",
      label: "Status",
      filter: "set",
      // The word, not the enum: the set filter offers what the column shows, and a person filters
      // on "Held", never on `held`.
      value: (packet) => packetStatusEntry(packet.status).label,
    },
    {
      id: "location",
      label: "Location",
      filter: "set",
      value: (packet) => packetLocationText(packet, vocabulary),
    },
    {
      id: "createdAt",
      label: "Logged",
      type: "date",
      // "Logged", not "Deposited": the listing serves the instant the row was created, and a packet
      // handed over years before it reached the register has two different dates. Only the detail
      // read carries the second, so this column names the one it actually has.
      value: (packet) => packet.createdAt,
    },
  ];
}

/** How the register opens: most recently logged first, which is how a register is read. */
export const CUSTODY_REGISTER_INITIAL_SORT = {
  columnId: "createdAt",
  direction: "descending",
} as const;

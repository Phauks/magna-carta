/*
 * The Firm Usage page's pure display decisions — kept out of the components so they are
 * unit-testable without a DOM (the document-presentation.ts pattern), and so the page's tables
 * cannot drift into different answers for the same figure.
 */
import type { FirmUsageLocationRow } from "./firm-usage-api.ts";

/**
 * Shown wherever a cell has no value to give. A plain hyphen, matching the marker the speed test
 * settled on ($lib/tools/speed-test/absence.ts says why an em dash and "N/A" both lost).
 */
export const ABSENT_MARKER = "-";

/**
 * Human-readable size at the natural unit, one decimal from KB up through TB. Whole bytes below
 * 1 KB, because "0.0 KB" for a 12-byte object reads as an error.
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  const gigabytes = megabytes / 1024;
  if (gigabytes < 1024) return `${gigabytes.toFixed(1)} GB`;
  return `${(gigabytes / 1024).toFixed(1)} TB`;
}

/** A whole count with locale grouping — token totals run to millions and need the separators. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/** One class's share of the total, one decimal. An empty bucket's share is honestly 0%. */
export function formatShare(bytes: number, totalBytes: number): string {
  if (totalBytes <= 0) return "0.0%";
  return `${((bytes / totalBytes) * 100).toFixed(1)}%`;
}

/*
 * The server names an unmeterable cost in its own words ("managed index storage"); the table wants
 * the product's label for it. Known strings carry their product name; an unknown one still renders
 * as a named gap rather than vanishing, title-cased from the server's words.
 */
const NOT_METERED_LABELS: Record<string, string> = {
  "managed index storage": "Managed Search Storage",
};

export function notMeteredLabel(meter: string): string {
  const known = NOT_METERED_LABELS[meter];
  if (known !== undefined) return known;
  return meter
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---- the By Location sort ---------------------------------------------------------------------

/** The sortable columns. `custodianItems` is reserved — every value is equal, so its sort holds. */
export type LocationSortKey = "name" | "status" | "matters" | "members" | "custodianItems";

export type LocationSortDirection = "ascending" | "descending";

function compareLocationRows(
  first: FirmUsageLocationRow,
  second: FirmUsageLocationRow,
  key: LocationSortKey,
): number {
  switch (key) {
    case "name":
      return first.name.localeCompare(second.name);
    case "status":
      return first.status.localeCompare(second.status);
    case "matters":
      return first.matters - second.matters;
    case "members":
      return first.members - second.members;
    case "custodianItems":
      // Reserved column — nothing is reported yet, so every row compares equal.
      return 0;
  }
}

/** The rows in the asked-for order. Pure — the caller's array is never reordered in place. */
export function sortedLocationRows(
  rows: readonly FirmUsageLocationRow[],
  key: LocationSortKey,
  direction: LocationSortDirection,
): FirmUsageLocationRow[] {
  const sorted = [...rows].sort((first, second) => compareLocationRows(first, second, key));
  if (direction === "descending") sorted.reverse();
  return sorted;
}

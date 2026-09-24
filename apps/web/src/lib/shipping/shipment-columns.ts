/*
 * The shipping register's columns — what a shipment says about itself.
 *
 * The grid is the product's one table, so nothing about sorting, filtering, hiding, reordering or
 * totalling is decided here. This file says only WHAT the columns are.
 *
 * TWO QUESTIONS, ONE REGISTER. "Where is the certified letter I sent on Tuesday" and "what has this
 * firm spent on postage" are asked by different people of the same rows, so both sets of columns are
 * declared and the reader chooses: recipient, status and tracking for the first; postage, the service
 * fee and the matter for the second. A fixed arrangement would have served one of them.
 *
 * STATUS DECLARES ITS VOCABULARY rather than reading it off the rows in hand. A firm with nothing
 * refunded this week can still refund something, and a set filter that dropped "Refunded" because
 * none was on screen would be telling the reader the register cannot hold one.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { formatInstant } from "@magna-carta/design-system/formatters";
import { format, fromMinor } from "@magna-carta/money/format";
import { currencyFromCode, isRegisteredCurrencyCode } from "@magna-carta/money/money";
import type { ShipmentListItem } from "@magna-carta/api-client";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const SHIPMENT_COLUMN_IDENTIFIERS = {
  recipient: "recipient",
  status: "status",
  carrier: "carrier",
  service: "service",
  trackingCode: "trackingCode",
  postage: "postage",
  serviceFee: "serviceFee",
  matter: "matter",
  createdAt: "createdAt",
} as const;

/** The register opens on what was sent most recently, which is what somebody came back for. */
export const SHIPMENT_REGISTER_INITIAL_SORT = {
  columnId: SHIPMENT_COLUMN_IDENTIFIERS.createdAt,
  direction: "descending",
} as const;

/*
 * What each status is called on the screen, and the whole vocabulary a shipment can be in.
 *
 * The words are the reader's rather than the schema's. `in_transit` is what the row holds; "In
 * transit" is what a person asks about. Drafted/Rated are the two states before any money moves, and
 * keeping them distinct matters: a draft can be thrown away freely, a rated one has a carrier quote
 * behind it that will expire.
 */
export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  draft: "Drafted",
  rated: "Rated",
  purchased: "Label bought",
  in_transit: "In transit",
  delivered: "Delivered",
  refunded: "Refunded",
};

export const SHIPMENT_STATUS_CHOICES: readonly string[] = Object.values(SHIPMENT_STATUS_LABELS);

export function shipmentStatusLabel(status: string): string {
  return SHIPMENT_STATUS_LABELS[status] ?? status;
}

/*
 * An amount the server recorded in minor units, as the reader sees it.
 *
 * The money package does the conversion and the formatting; nothing here divides by a hundred. A bare
 * divide is exact only while the currency's exponent is two, and nothing on such a line checks it —
 * `@magna-carta/money` checks both on every operation, which is why it is the only thing in the
 * product allowed to answer what an amount IS.
 *
 * IT KNOWS USD AND EUR TODAY. A carrier quoting in anything else is stated plainly rather than thrown
 * over: `currencyFromCode` refuses an unregistered code by design, and a register that died because a
 * parcel was quoted in Canadian dollars would be a worse failure than one that prints the figure
 * unconverted and says so. The fix when it happens is one line in the money package's registry, not
 * a workaround here.
 */
export function formatMinorUnits(minor: number | null, currency: string | null): string {
  if (minor === null) return "";
  const code = currency ?? "USD";
  if (!isRegisteredCurrencyCode(code)) return `${code} ${String(minor)} (minor units)`;
  return format(fromMinor(minor, currencyFromCode(code)));
}

export function shipmentRegisterColumns(): readonly GridColumn<ShipmentListItem>[] {
  return [
    {
      // The anchor: whatever else is hidden, the reader can always see WHO it went to. A register
      // whose first column can be turned off is a list of dates.
      id: SHIPMENT_COLUMN_IDENTIFIERS.recipient,
      label: "Recipient",
      type: "text",
      anchored: true,
      value: (row) => row.recipientName ?? "",
    },
    {
      id: SHIPMENT_COLUMN_IDENTIFIERS.status,
      label: "Status",
      type: "text",
      filter: "set",
      filterValues: SHIPMENT_STATUS_CHOICES,
      value: (row) => shipmentStatusLabel(row.status),
    },
    {
      id: SHIPMENT_COLUMN_IDENTIFIERS.carrier,
      label: "Carrier",
      type: "text",
      value: (row) => row.carrier ?? "",
    },
    {
      id: SHIPMENT_COLUMN_IDENTIFIERS.service,
      label: "Service",
      type: "text",
      value: (row) => row.service ?? "",
    },
    {
      // A blank cell is the real answer for a draft nobody has bought a label for, which is what
      // makes this column worth having: it is the difference between a plan and a parcel.
      id: SHIPMENT_COLUMN_IDENTIFIERS.trackingCode,
      label: "Tracking",
      type: "text",
      value: (row) => row.trackingCode ?? "",
    },
    {
      id: SHIPMENT_COLUMN_IDENTIFIERS.postage,
      label: "Postage",
      // Sorted on the stored minor-unit integer, which orders identically to the amount and needs no
      // arithmetic to do it; the cell PRINTS through the money package. No `total: "sum"` is declared
      // here on purpose — a totals row would add these numbers itself, and summing money is the money
      // package's job, so a total on this column wants a different mechanism rather than this value.
      type: "number",
      value: (row) => row.postageCostMinor,
      text: (row) => formatMinorUnits(row.postageCostMinor, row.currency),
    },
    {
      // Kept as its own column rather than folded into postage. The firm is billed two things and a
      // single total would hide which is which — the separation the design fixed at the confirm step
      // is the same separation the register owes anybody reconciling a statement.
      id: SHIPMENT_COLUMN_IDENTIFIERS.serviceFee,
      label: "Service fee",
      type: "number",
      value: (row) => row.serviceFeeMinor,
      text: (row) => formatMinorUnits(row.serviceFeeMinor, row.currency),
    },
    {
      id: SHIPMENT_COLUMN_IDENTIFIERS.matter,
      label: "Matter",
      type: "text",
      value: (row) => row.matterRef ?? "",
    },
    {
      id: SHIPMENT_COLUMN_IDENTIFIERS.createdAt,
      label: "Created",
      type: "date",
      value: (row) => new Date(row.createdAt),
      text: (row) => formatInstant(row.createdAt),
    },
  ];
}

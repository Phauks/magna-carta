/*
 * The reconciliation report, in the house document: the figures, what cleared, what did not, the
 * IOLTA interest, the lines marked Needs Review and every note. It prints at any time; until the
 * reconciliation is finished it is marked DRAFT on every page.
 */
import {
  card,
  figures,
  houseDocument,
  pagedTable,
  tablePages,
  type HouseBlock,
  type HouseColumn,
  type HouseDocument,
} from "@magna-carta/house-document";
import { formatDate, formatInstant } from "@magna-carta/design-system/formatters";
import type { TrustBankReconciliationDetail } from "./reconciliation-api.ts";
import {
  lineDescription,
  lineKey,
  linesNeedingReview,
  periodText,
  statusLabel,
  statusOf,
  typeLabel,
} from "./reconciliation-model.ts";

export interface ReconciliationReportOptions {
  readonly detail: TrustBankReconciliationDetail;
  readonly accountName: string;
  readonly money: (minor: number) => string;
  /** When the report is made, as an instant. */
  readonly made: string;
}

const ITEM_COLUMNS: readonly HouseColumn[] = [
  { heading: "Date", weight: 14 },
  { heading: "Type", weight: 12 },
  { heading: "No.", weight: 9 },
  { heading: "Payee or From", weight: 27 },
  { heading: "Matter", weight: 12 },
  { heading: "Deposit", weight: 13, alignment: "end" },
  { heading: "Withdrawal", weight: 13, alignment: "end" },
];

function table(
  title: string,
  columns: readonly HouseColumn[],
  rows: readonly (readonly string[])[],
): HouseBlock[] {
  if (rows.length === 0) return card(title, { type: "paragraph", text: "None." });
  if (tablePages(columns, rows).length > 1) return pagedTable(title, columns, rows);
  return card(title, { type: "table", columns, rows });
}

/** Whether the report is a draft: every report made before the reconciliation is finished. */
export function isDraftReport(detail: TrustBankReconciliationDetail): boolean {
  return detail.reconciliation.finishedAt === null;
}

export function reconciliationReport(options: ReconciliationReportOptions): HouseDocument {
  const { detail, money } = options;
  const draft = isDraftReport(detail);
  const header = detail.reconciliation;
  const figuresNow = detail.figures;
  const period = periodText(header.startDate, detail.endDate);

  const itemRow = (item: TrustBankReconciliationDetail["items"][number]): string[] => [
    formatDate(item.effectiveDate),
    typeLabel(item.type),
    item.number ?? "",
    `${item.payeeOrFrom ?? item.description}${item.isNew ? " (New)" : ""}`,
    item.firmFunds ? "Firm funds" : (item.matterNumber ?? ""),
    item.amountMinor >= 0 ? money(item.amountMinor) : "",
    item.amountMinor < 0 ? money(-item.amountMinor) : "",
  ];

  const review = linesNeedingReview(detail.notes);
  const reviewRows = [...review].map((key) => {
    const note = detail.notes.find((one) => lineKey(one.line) === key);
    return [note === undefined ? key : lineDescription(note.line, detail, money)];
  });
  const noteRows = detail.notes
    .filter((note) => note.kind === "note")
    .map((note) => [
      lineDescription(note.line, detail, money),
      `${note.writtenByName ?? "Someone"}, ${formatInstant(note.writtenAt)}`,
      note.body ?? "",
    ]);

  const status = statusLabel(
    statusOf({ differenceMinor: figuresNow.differenceMinor, reconciliation: header }),
  );
  const finishedLine =
    header.finishedAt === null
      ? `Draft, made ${formatInstant(options.made)}. Not finished: the figures may still change.`
      : `${status}. Finished by ${header.finishedByName ?? "someone"}, ${formatInstant(header.finishedAt)}.`;

  const blocks: HouseBlock[] = [
    { type: "heading", level: 1, text: period },
    { type: "paragraph", text: finishedLine },
    {
      type: "paragraph",
      text: `Started by ${header.startedByName ?? "someone"}, ${formatInstant(header.startedAt)}. Start ${header.startCarriedOver ? "carried over from the last reconciliation" : "typed by hand"}.`,
    },
    figures([
      { label: "Start Balance", value: money(figuresNow.startBalanceMinor) },
      {
        label: "Deposited",
        value: money(figuresNow.depositedMinor),
        note: `${figuresNow.depositClearedCount} of ${figuresNow.depositCount} cleared`,
      },
      {
        label: "Withdrawn",
        value: money(figuresNow.withdrawnMinor),
        note: `${figuresNow.withdrawalClearedCount} of ${figuresNow.withdrawalCount} cleared`,
      },
    ]),
    // Six figures in one row break a seven-figure balance across two lines; three to a row keep each whole.
    figures([
      { label: "Cleared Balance", value: money(figuresNow.clearedBalanceMinor) },
      {
        label: "End Balance",
        value:
          figuresNow.endBalanceMinor === null ? "Not entered" : money(figuresNow.endBalanceMinor),
      },
      {
        label: "Difference",
        value:
          figuresNow.differenceMinor === null ? "Not known" : money(figuresNow.differenceMinor),
        ...(figuresNow.differenceMinor !== null && figuresNow.differenceMinor !== 0
          ? { alert: true as const }
          : {}),
      },
    ]),
    ...table(
      "Uncleared Items",
      ITEM_COLUMNS,
      detail.items.filter((item) => !item.cleared).map(itemRow),
    ),
    ...table(
      "Cleared Items",
      ITEM_COLUMNS,
      detail.items.filter((item) => item.cleared).map(itemRow),
    ),
    ...table(
      "IOLTA Interest",
      [
        { heading: "Date", weight: 18 },
        { heading: "What", weight: 42 },
        { heading: "Cleared", weight: 12 },
        { heading: "Credited", weight: 14, alignment: "end" },
        { heading: "Swept Out", weight: 14, alignment: "end" },
      ],
      detail.interest.map((line) => [
        formatDate(line.postedOn),
        line.description,
        line.cleared ? "Yes" : "No",
        line.kind === "credited" ? money(line.amountMinor) : "",
        line.kind === "swept" ? money(line.amountMinor) : "",
      ]),
    ),
    ...table("Needs Review", [{ heading: "Line", weight: 100 }], reviewRows),
    ...table(
      "Notes",
      [
        { heading: "Line", weight: 30 },
        { heading: "Written", weight: 25 },
        { heading: "Note", weight: 45 },
      ],
      noteRows,
    ),
    ...table(
      "Files",
      [
        { heading: "Name", weight: 70 },
        { heading: "Attached", weight: 30 },
      ],
      detail.files.map((file) => [file.name, formatInstant(file.recordedAt)]),
    ),
  ];

  return houseDocument({
    name: draft ? "Reconciliation Report (Draft)" : "Reconciliation Report",
    created: options.made,
    reference: { label: options.accountName, value: period },
    ...(draft ? { watermark: "DRAFT" } : {}),
    blocks,
  });
}

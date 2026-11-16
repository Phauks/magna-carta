/*
 * The Change Log, arranged for a screen and a file: who added, changed and removed the firm's people
 * and organizations, matters and trust account rules in a period.
 *
 * Totals first, then a table by person ruled off with the report's own totals, then every change on
 * its own row, newest first as served, sortable. Every count is the payload's; nothing here adds
 * two. A row says when, who, what in plain words and which record, never what the change was: the
 * payload carries no details of a change to print.
 */
import { formatInstant, formatNumber } from "@magna-carta/design-system/formatters";
import type { ReportCell, ReportPresentation, ReportSummaryTile } from "./report-presentation.ts";
import { captionOr, counted, countCell } from "./report-cells.ts";
import type { ChangeCounts, ChangeLog } from "./report-reads.ts";
import type { ReportCaptions } from "./trust-compliance-presenter.ts";

/** Who a change is put down to when no person made it: the platform's own setup and upkeep. */
const NO_PERSON = "System";

function countCells(counts: ChangeCounts): ReportCell[] {
  return [
    countCell(counts.directoryCount),
    countCell(counts.matterCount),
    countCell(counts.accountCount),
    countCell(counts.totalCount),
  ];
}

function who(
  actorUserId: string | null,
  actorName: string | null,
  captions: ReportCaptions,
): string {
  return actorUserId === null ? NO_PERSON : captionOr(actorName, captions.member(actorUserId));
}

export function presentChangeLog(report: ChangeLog, captions: ReportCaptions): ReportPresentation {
  const summary: ReportSummaryTile[] = [
    {
      label: "People and organizations",
      value: formatNumber(report.totals.directoryCount),
      detail: null,
      tone: "plain",
    },
    {
      label: "Matters",
      value: formatNumber(report.totals.matterCount),
      detail: null,
      tone: "plain",
    },
    {
      label: "Accounts",
      value: formatNumber(report.totals.accountCount),
      detail: null,
      tone: "plain",
    },
    {
      label: "Total changes",
      value: formatNumber(report.totals.totalCount),
      detail: counted(
        report.people.filter((person) => person.actorUserId !== null).length,
        "person",
        "people",
      ),
      tone: "total",
    },
  ];
  return {
    title: "Change Log",
    subtitle: null,
    stamp: report.statement,
    reproducible: report.reproducible,
    completeness: report.completeness,
    summary,
    sections: [
      {
        id: "by-person",
        title: "By Person",
        headers: ["Person", "People and organizations", "Matters", "Accounts", "Total"],
        rows: report.people.map((person) => [
          who(person.actorUserId, person.actorName, captions),
          ...countCells(person),
        ]),
        endAlignedColumns: [1, 2, 3, 4],
        totalRow: ["All people", ...countCells(report.totals)],
        whenEmpty: "Nobody changed a record in this period.",
      },
      {
        id: "changes",
        title: "Changes",
        headers: ["When", "Who", "What", "Record"],
        rows: report.entries.map((entry) => [
          formatInstant(entry.at),
          who(entry.actorUserId, entry.actorName, captions),
          entry.eventLabel,
          entry.subjectId ?? "-",
        ]),
        sortable: true,
        whenEmpty: "Nobody changed a record in this period.",
      },
    ],
  };
}

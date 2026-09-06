/*
 * The Firm Usage export — the page's tables as one $lib/export document, so every download format
 * renders the same figures the screen showed, through the same formatters. Pure over the response,
 * unit-testable without a DOM.
 */
import type { TabularExportCell, TabularExportDocument } from "$lib/export/tabular-export.ts";
import type { FirmUsageResponse } from "./firm-usage-api.ts";
import {
  ABSENT_MARKER,
  formatByteSize,
  formatCount,
  formatShare,
  notMeteredLabel,
} from "./firm-usage-format.ts";

const NOT_YET_MEASURED = "Not yet measured";

// A count carries both faces: the grouped text the text and CSV renderers print, and the raw
// number the Excel renderer writes as a real cell, so a reader can sum a column.
function count(value: number): TabularExportCell {
  return { text: formatCount(value), number: value };
}

export function firmUsageExportDocument(
  usage: FirmUsageResponse,
  generatedAt: Date,
): TabularExportDocument {
  const mattersTotals = usage.mattersByType.reduce(
    (sum, row) => ({
      intake: sum.intake + row.intake,
      consultation: sum.consultation + row.consultation,
      open: sum.open + row.open,
      closed: sum.closed + row.closed,
      total: sum.total + row.total,
    }),
    { intake: 0, consultation: 0, open: 0, closed: 0, total: 0 },
  );
  const totalMatters =
    usage.byLocation.rows.reduce((sum, row) => sum + row.matters, 0) +
    usage.byLocation.mattersWithoutLocation;
  const totalMembers = usage.byLocation.rows.reduce((sum, row) => sum + row.members, 0);
  const totalCustodyItems =
    usage.byLocation.rows.reduce((sum, row) => sum + row.custodyItems, 0) +
    usage.byLocation.custodyItemsOffsite;

  return {
    title: "Firm Usage",
    generatedAt,
    sections: [
      {
        title: "Storage",
        headers: ["Storage Class", "Objects", "Size", "Share"],
        endAlignedColumns: [1, 2, 3],
        rows: [
          [
            "Standard",
            count(usage.storage.byStorageClass.standard.objects),
            formatByteSize(usage.storage.byStorageClass.standard.bytes),
            formatShare(usage.storage.byStorageClass.standard.bytes, usage.storage.totalBytes),
          ],
          [
            "Infrequent Access",
            count(usage.storage.byStorageClass.infrequent_access.objects),
            formatByteSize(usage.storage.byStorageClass.infrequent_access.bytes),
            formatShare(
              usage.storage.byStorageClass.infrequent_access.bytes,
              usage.storage.totalBytes,
            ),
          ],
          [
            "Total",
            count(usage.storage.totalObjects),
            formatByteSize(usage.storage.totalBytes),
            formatShare(usage.storage.totalBytes, usage.storage.totalBytes),
          ],
        ],
      },
      {
        title: "Matters by Type",
        headers: ["Matter Type", "Intake", "Consultation", "Open", "Closed", "Total"],
        endAlignedColumns: [1, 2, 3, 4, 5],
        rows: [
          ...usage.mattersByType.map((row) => [
            row.matterTypeName ?? "No Type Assigned",
            count(row.intake),
            count(row.consultation),
            count(row.open),
            count(row.closed),
            count(row.total),
          ]),
          [
            "Total",
            count(mattersTotals.intake),
            count(mattersTotals.consultation),
            count(mattersTotals.open),
            count(mattersTotals.closed),
            count(mattersTotals.total),
          ],
        ],
      },
      {
        title: "Files and Versioning",
        headers: ["Category", "Count", "Size"],
        endAlignedColumns: [1, 2],
        rows: [
          [
            "Current Files",
            count(usage.files.currentFiles.count),
            formatByteSize(usage.files.currentFiles.bytes),
          ],
          [
            "Prior Versions",
            count(usage.files.priorVersions.count),
            formatByteSize(usage.files.priorVersions.bytes),
          ],
          [
            "All Versions",
            count(usage.files.allVersions.count),
            formatByteSize(usage.files.allVersions.bytes),
          ],
          [
            "Deleted Files",
            count(usage.files.deletedFiles.count),
            formatByteSize(usage.files.deletedFiles.bytes),
          ],
        ],
      },
      {
        title: "By Location",
        headers: ["Location", "Status", "Matters", "Members", "Custodian Items"],
        endAlignedColumns: [2, 3, 4],
        rows: [
          ...usage.byLocation.rows.map((row) => [
            row.name,
            row.status === "active" ? "Active" : "Closed",
            count(row.matters),
            count(row.members),
            count(row.custodyItems),
          ]),
          ...(usage.byLocation.mattersWithoutLocation > 0
            ? [
                [
                  "No Location Assigned",
                  ABSENT_MARKER,
                  count(usage.byLocation.mattersWithoutLocation),
                  ABSENT_MARKER,
                  ABSENT_MARKER,
                ],
              ]
            : []),
          ...(usage.byLocation.custodyItemsOffsite > 0
            ? [
                [
                  "Held Offsite",
                  ABSENT_MARKER,
                  ABSENT_MARKER,
                  ABSENT_MARKER,
                  count(usage.byLocation.custodyItemsOffsite),
                ],
              ]
            : []),
          ["Total", "", count(totalMatters), count(totalMembers), count(totalCustodyItems)],
        ],
      },
      {
        title: "People and Organizations",
        headers: ["Record", "Count"],
        endAlignedColumns: [1],
        rows: [
          ["People", count(usage.directory.people)],
          ["Organizations", count(usage.directory.organizations)],
          ["Firm Members", count(usage.directory.activeMembers)],
        ],
      },
      {
        title: "AI Usage",
        headers: ["Meter", "All Time"],
        endAlignedColumns: [1],
        rows: [
          ["Magnus Input Tokens", count(usage.aiUsage.magnusTokens.inputTokens)],
          ["Magnus Output Tokens", count(usage.aiUsage.magnusTokens.outputTokens)],
          ["Magnus Requests", count(usage.aiUsage.magnusTokens.requests)],
          ["Semantic Search Queries", count(usage.aiUsage.searchQueries.semantic)],
          ["Full Text Search Queries", count(usage.aiUsage.searchQueries.fullText)],
          ["AI Detection Documents", count(usage.aiUsage.detection.requests)],
          ["AI Detection Words", count(usage.aiUsage.detection.words)],
          ...usage.aiUsage.notMetered.map((meter) => [notMeteredLabel(meter), NOT_YET_MEASURED]),
        ],
      },
      {
        title: "Compute and Activity",
        headers: ["Measure", "Last 30 Days"],
        endAlignedColumns: [1],
        rows: [
          ["API Requests", NOT_YET_MEASURED],
          ["Workers CPU Time", NOT_YET_MEASURED],
          ["Data Egress", NOT_YET_MEASURED],
        ],
      },
    ],
  };
}

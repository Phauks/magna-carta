/*
 * The Firm Usage export — the page's tables as one $lib/export document, so every download format
 * renders the same figures the screen showed, through the same formatters. Pure over the response,
 * unit-testable without a DOM.
 */
import type { TabularExportDocument } from "$lib/export/tabular-export.ts";
import type { FirmUsageResponse } from "./firm-usage-api.ts";
import {
  ABSENT_MARKER,
  formatByteSize,
  formatCount,
  formatShare,
  notMeteredLabel,
} from "./firm-usage-format.ts";

const NOT_YET_MEASURED = "Not yet measured";
const NOT_YET_REPORTED = "Not yet reported";

export function firmUsageExportDocument(
  usage: FirmUsageResponse,
  generatedAt: Date,
): TabularExportDocument {
  const mattersTotals = usage.mattersByType.reduce(
    (sum, row) => ({
      prospective: sum.prospective + row.prospective,
      open: sum.open + row.open,
      closed: sum.closed + row.closed,
      total: sum.total + row.total,
    }),
    { prospective: 0, open: 0, closed: 0, total: 0 },
  );
  const totalMatters =
    usage.byLocation.rows.reduce((sum, row) => sum + row.matters, 0) +
    usage.byLocation.mattersWithoutLocation;
  const totalMembers = usage.byLocation.rows.reduce((sum, row) => sum + row.members, 0);

  return {
    title: "Firm Usage",
    slug: "firm-usage",
    generatedAt,
    sections: [
      {
        title: "Storage",
        headers: ["Storage Class", "Objects", "Size", "Share"],
        rows: [
          [
            "Standard",
            formatCount(usage.storage.byStorageClass.standard.objects),
            formatByteSize(usage.storage.byStorageClass.standard.bytes),
            formatShare(usage.storage.byStorageClass.standard.bytes, usage.storage.totalBytes),
          ],
          [
            "Infrequent Access",
            formatCount(usage.storage.byStorageClass.infrequent_access.objects),
            formatByteSize(usage.storage.byStorageClass.infrequent_access.bytes),
            formatShare(
              usage.storage.byStorageClass.infrequent_access.bytes,
              usage.storage.totalBytes,
            ),
          ],
          [
            "Total",
            formatCount(usage.storage.totalObjects),
            formatByteSize(usage.storage.totalBytes),
            formatShare(usage.storage.totalBytes, usage.storage.totalBytes),
          ],
        ],
      },
      {
        title: "Matters by Type",
        headers: ["Matter Type", "Prospective", "Open", "Closed", "Total"],
        rows: [
          ...usage.mattersByType.map((row) => [
            row.matterTypeName ?? "No Type Assigned",
            formatCount(row.prospective),
            formatCount(row.open),
            formatCount(row.closed),
            formatCount(row.total),
          ]),
          [
            "Total",
            formatCount(mattersTotals.prospective),
            formatCount(mattersTotals.open),
            formatCount(mattersTotals.closed),
            formatCount(mattersTotals.total),
          ],
        ],
      },
      {
        title: "Files and Versioning",
        headers: ["Category", "Count", "Size"],
        rows: [
          [
            "Current Files",
            formatCount(usage.files.currentFiles.count),
            formatByteSize(usage.files.currentFiles.bytes),
          ],
          [
            "Prior Versions",
            formatCount(usage.files.priorVersions.count),
            formatByteSize(usage.files.priorVersions.bytes),
          ],
          [
            "All Versions",
            formatCount(usage.files.allVersions.count),
            formatByteSize(usage.files.allVersions.bytes),
          ],
          [
            "Deleted Files",
            formatCount(usage.files.deletedFiles.count),
            formatByteSize(usage.files.deletedFiles.bytes),
          ],
        ],
      },
      {
        title: "By Location",
        headers: ["Location", "Status", "Matters", "Members", "Custodian Items"],
        rows: [
          ...usage.byLocation.rows.map((row) => [
            row.name,
            row.status === "active" ? "Active" : "Closed",
            formatCount(row.matters),
            formatCount(row.members),
            NOT_YET_REPORTED,
          ]),
          ...(usage.byLocation.mattersWithoutLocation > 0
            ? [
                [
                  "No Location Assigned",
                  ABSENT_MARKER,
                  formatCount(usage.byLocation.mattersWithoutLocation),
                  ABSENT_MARKER,
                  NOT_YET_REPORTED,
                ],
              ]
            : []),
          ["Total", "", formatCount(totalMatters), formatCount(totalMembers), ABSENT_MARKER],
        ],
      },
      {
        title: "People and Organizations",
        headers: ["Record", "Count"],
        rows: [
          ["People", formatCount(usage.directory.people)],
          ["Organizations", formatCount(usage.directory.organizations)],
          ["Firm Members", formatCount(usage.directory.activeMembers)],
        ],
      },
      {
        title: "AI Usage",
        headers: ["Meter", "All Time"],
        rows: [
          ["Magnus Input Tokens", formatCount(usage.aiUsage.magnusTokens.inputTokens)],
          ["Magnus Output Tokens", formatCount(usage.aiUsage.magnusTokens.outputTokens)],
          ["Magnus Requests", formatCount(usage.aiUsage.magnusTokens.requests)],
          ["Semantic Search Queries", formatCount(usage.aiUsage.searchQueries.semantic)],
          ["Full Text Search Queries", formatCount(usage.aiUsage.searchQueries.fullText)],
          ["AI Detection Documents", formatCount(usage.aiUsage.detection.requests)],
          ["AI Detection Words", formatCount(usage.aiUsage.detection.words)],
          ...usage.aiUsage.notMetered.map((meter) => [notMeteredLabel(meter), NOT_YET_MEASURED]),
        ],
      },
      {
        title: "Compute and Activity",
        headers: ["Measure", "Last 30 Days"],
        rows: [
          ["API Requests", NOT_YET_MEASURED],
          ["Workers CPU Time", NOT_YET_MEASURED],
          ["Data Egress", NOT_YET_MEASURED],
        ],
      },
    ],
  };
}

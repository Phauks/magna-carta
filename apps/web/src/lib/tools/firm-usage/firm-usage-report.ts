/*
 * The downloadable Firm Usage report — the page's tables as one plain-text file, the same
 * delivery the speed test settled on: text pastes into an email, opens anywhere, and carries no
 * markup to mangle. Pure functions over the response so the report is unit-testable without a DOM,
 * and every figure goes through the same formatters the on-screen tables use — the file and the
 * screen cannot disagree.
 */
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

/** One rendered table: the first column left-aligned, every other column right-aligned. */
function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => (row[columnIndex] ?? "").length)),
  );
  const renderRow = (row: readonly string[]): string =>
    row
      .map((cell, columnIndex) =>
        columnIndex === 0
          ? cell.padEnd(widths[columnIndex] ?? 0)
          : cell.padStart(widths[columnIndex] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [renderRow(headers), ...rows.map(renderRow)].join("\n");
}

function section(title: string, body: string): string {
  return `${title.toUpperCase()}\n\n${body}`;
}

export function renderFirmUsageReport(usage: FirmUsageResponse, generatedAt: Date): string {
  const storage = section(
    "Storage",
    renderTable(
      ["Storage Class", "Objects", "Size", "Share"],
      [
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
    ),
  );

  const mattersTotals = usage.mattersByType.reduce(
    (sum, row) => ({
      prospective: sum.prospective + row.prospective,
      open: sum.open + row.open,
      closed: sum.closed + row.closed,
      total: sum.total + row.total,
    }),
    { prospective: 0, open: 0, closed: 0, total: 0 },
  );
  const mattersByType = section(
    "Matters by Type",
    renderTable(
      ["Matter Type", "Prospective", "Open", "Closed", "Total"],
      [
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
    ),
  );

  const files = section(
    "Files and Versioning",
    renderTable(
      ["Category", "Count", "Size"],
      [
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
    ),
  );

  const totalMatters =
    usage.byLocation.rows.reduce((sum, row) => sum + row.matters, 0) +
    usage.byLocation.mattersWithoutLocation;
  const totalMembers = usage.byLocation.rows.reduce((sum, row) => sum + row.members, 0);
  const byLocation = section(
    "By Location",
    renderTable(
      ["Location", "Status", "Matters", "Members", "Custodian Items"],
      [
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
    ),
  );

  const directory = section(
    "People and Organizations",
    renderTable(
      ["Record", "Count"],
      [
        ["People", formatCount(usage.directory.people)],
        ["Organizations", formatCount(usage.directory.organizations)],
        ["Firm Members", formatCount(usage.directory.activeMembers)],
      ],
    ),
  );

  const aiUsage = section(
    "AI Usage",
    renderTable(
      ["Meter", "All Time"],
      [
        ["Magnus Input Tokens", formatCount(usage.aiUsage.magnusTokens.inputTokens)],
        ["Magnus Output Tokens", formatCount(usage.aiUsage.magnusTokens.outputTokens)],
        ["Magnus Requests", formatCount(usage.aiUsage.magnusTokens.requests)],
        ["Semantic Search Queries", formatCount(usage.aiUsage.searchQueries.semantic)],
        ["Full Text Search Queries", formatCount(usage.aiUsage.searchQueries.fullText)],
        ["AI Detection Documents", formatCount(usage.aiUsage.detection.requests)],
        ["AI Detection Words", formatCount(usage.aiUsage.detection.words)],
        ...usage.aiUsage.notMetered.map((meter) => [notMeteredLabel(meter), NOT_YET_MEASURED]),
      ],
    ),
  );

  const compute = section(
    "Compute and Activity",
    renderTable(
      ["Measure", "Last 30 Days"],
      [
        ["API Requests", NOT_YET_MEASURED],
        ["Workers CPU Time", NOT_YET_MEASURED],
        ["Data Egress", NOT_YET_MEASURED],
      ],
    ),
  );

  return [
    "FIRM USAGE",
    `Generated ${generatedAt.toLocaleString()}`,
    "",
    storage,
    "",
    mattersByType,
    "",
    files,
    "",
    byLocation,
    "",
    directory,
    "",
    aiUsage,
    "",
    compute,
    "",
  ].join("\n");
}

/** The saved file's name, dated so two downloads on different days sort and read apart. */
export function firmUsageReportFilename(generatedAt: Date): string {
  const year = generatedAt.getFullYear();
  const month = String(generatedAt.getMonth() + 1).padStart(2, "0");
  const day = String(generatedAt.getDate()).padStart(2, "0");
  return `firm-usage-${year}-${month}-${day}.txt`;
}

import { describe, expect, it } from "vitest";
import type { FirmUsageResponse } from "$lib/tools/firm-usage/firm-usage-api.ts";
import {
  firmUsageReportFilename,
  renderFirmUsageReport,
} from "$lib/tools/firm-usage/firm-usage-report.ts";

const usage: FirmUsageResponse = {
  storage: {
    totalBytes: 2048,
    totalObjects: 3,
    byStorageClass: {
      standard: { bytes: 1024, objects: 2 },
      infrequent_access: { bytes: 1024, objects: 1 },
    },
  },
  mattersByType: [
    { matterTypeName: "Estate Planning", prospective: 1, open: 1, closed: 0, total: 2 },
    { matterTypeName: null, prospective: 0, open: 0, closed: 1, total: 1 },
  ],
  files: {
    currentFiles: { count: 2, bytes: 1024 },
    priorVersions: { count: 1, bytes: 512 },
    allVersions: { count: 3, bytes: 1536 },
    deletedFiles: { count: 0, bytes: 0 },
  },
  byLocation: {
    rows: [{ name: "Main Office", status: "active", matters: 2, members: 4 }],
    mattersWithoutLocation: 1,
  },
  directory: { people: 5, organizations: 2, activeMembers: 4 },
  aiUsage: {
    magnusTokens: { inputTokens: 1_000_000, outputTokens: 250_000, requests: 42 },
    searchQueries: { semantic: 7, fullText: 8 },
    detection: { requests: 3, words: 900 },
    notMetered: ["managed index storage"],
  },
};

describe("renderFirmUsageReport", () => {
  const report = renderFirmUsageReport(usage, new Date(2026, 7, 31, 12, 0, 0));

  it("carries every section in page order", () => {
    const sections = [
      "STORAGE",
      "MATTERS BY TYPE",
      "FILES AND VERSIONING",
      "BY LOCATION",
      "PEOPLE AND ORGANIZATIONS",
      "AI USAGE",
      "COMPUTE AND ACTIVITY",
    ];
    const positions = sections.map((section) => report.indexOf(`\n${section}\n`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((first, second) => first - second)).toEqual(positions);
  });

  it("reports the figures through the shared formatters", () => {
    expect(report).toContain("1,000,000");
    expect(report).toContain("1.0 KB");
    expect(report).toContain("50.0%");
  });

  it("sums the matters-by-type totals row and names the untyped bucket", () => {
    expect(report).toContain("No Type Assigned");
    const totalsLine = report
      .split("\n")
      .find(
        (line, index, lines) =>
          line.startsWith("Total") && lines[index - 2]?.startsWith("Estate Planning"),
      );
    expect(totalsLine).toMatch(/Total\s+1\s+1\s+1\s+3/);
  });

  it("states absences instead of dropping them", () => {
    expect(report).toContain("Not yet reported");
    expect(report).toContain("Managed Search Storage");
    expect(report).toContain("Not yet measured");
    expect(report).toContain("No Location Assigned");
  });

  it("omits the no-location row when every matter has a location", () => {
    const allLocated = {
      ...usage,
      byLocation: { rows: usage.byLocation.rows, mattersWithoutLocation: 0 },
    };
    expect(renderFirmUsageReport(allLocated, new Date())).not.toContain("No Location Assigned");
  });
});

describe("firmUsageReportFilename", () => {
  it("dates the file in the local calendar with padded parts", () => {
    expect(firmUsageReportFilename(new Date(2026, 0, 5))).toBe("firm-usage-2026-01-05.txt");
  });
});

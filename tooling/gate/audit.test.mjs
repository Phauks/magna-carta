import { describe, expect, it } from "vitest";
import {
  OSV_SCANNER_ASSETS,
  assetFor,
  describeOffender,
  highOrCriticalOffenders,
} from "./audit.mjs";

const report = (groups, vulnerabilities = []) => ({
  results: [
    {
      packages: [
        {
          package: { name: "left-pad", ecosystem: "npm" },
          groups,
          vulnerabilities,
        },
      ],
    },
  ],
});

describe("highOrCriticalOffenders", () => {
  it("classifies by the group's max CVSS score when it carries one", () => {
    expect(highOrCriticalOffenders(report([{ ids: ["GHSA-1"], max_severity: "7.5" }]))).toEqual([
      {
        package: "left-pad",
        ecosystem: "npm",
        ids: ["GHSA-1"],
        maxSeverity: "7.5",
        classifiedBy: "cvss>=7.0",
      },
    ]);
    expect(highOrCriticalOffenders(report([{ ids: ["GHSA-1"], max_severity: "6.9" }]))).toEqual([]);
  });

  it("falls back to the severity label only when the group carries no score", () => {
    const labelled = [{ id: "GHSA-2", database_specific: { severity: "high" } }];
    expect(
      highOrCriticalOffenders(report([{ ids: ["GHSA-2"], max_severity: "" }], labelled)),
    ).toHaveLength(1);
    expect(
      highOrCriticalOffenders(report([{ ids: ["GHSA-2"], max_severity: "" }], labelled))[0]
        .classifiedBy,
    ).toBe("severity-text");
    // A score that says MODERATE wins over a label that says HIGH: the score is the better evidence.
    expect(
      highOrCriticalOffenders(report([{ ids: ["GHSA-2"], max_severity: "5.0" }], labelled)),
    ).toEqual([]);
  });

  it("ignores a labelled advisory that is not in the group", () => {
    const labelled = [{ id: "GHSA-other", database_specific: { severity: "CRITICAL" } }];
    expect(
      highOrCriticalOffenders(report([{ ids: ["GHSA-2"], max_severity: "" }], labelled)),
    ).toEqual([]);
  });

  it("is quiet on an empty report and on a report with no groups", () => {
    expect(highOrCriticalOffenders({})).toEqual([]);
    expect(highOrCriticalOffenders(report([]))).toEqual([]);
  });

  it("describes an offender on one line naming the package, the advisories and the rule", () => {
    const [offender] = highOrCriticalOffenders(report([{ ids: ["GHSA-1"], max_severity: "9.8" }]));
    expect(describeOffender(offender)).toBe(
      "  [npm] left-pad: GHSA-1 (max_severity=9.8, cvss>=7.0)",
    );
  });
});

describe("assetFor", () => {
  it("names a pinned asset with a 64-hex hash for every supported platform", () => {
    for (const [key, [name, hash]] of OSV_SCANNER_ASSETS) {
      const [platform, arch] = key.split("-");
      expect(assetFor(platform, arch)).toEqual([name, hash]);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(name.startsWith("osv-scanner_")).toBe(true);
    }
  });

  it("returns null for a platform without a pinned binary", () => {
    expect(assetFor("freebsd", "x64")).toBeNull();
  });
});

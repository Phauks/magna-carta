import { describe, expect, it } from "vitest";
import { reportOf } from "../src/model.ts";
import { SCRUB_ALL } from "../src/options.ts";

describe("model", () => {
  it("reportOf marks an empty findings list clean", () => {
    const report = reportOf("docx", []);
    expect(report.clean).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it("reportOf marks a non-empty findings list not clean", () => {
    const report = reportOf("docx", [
      {
        category: "identifying-metadata",
        label: "Author",
        risk: "high",
        count: 1,
        defaultScrub: true,
      },
    ]);
    expect(report.clean).toBe(false);
  });

  it("SCRUB_ALL enables every category", () => {
    expect(Object.values(SCRUB_ALL).every((v) => v === true)).toBe(true);
  });
});

/*
 * The grammar every paste-ready diagnosis in the app shares, pinned.
 *
 * Two rules, and the reason both exist is that two surfaces used to invent their own: a row is
 * `key: value`, and a titled group indents under its heading. The tests below hold the rules that
 * make a paste readable under time pressure — and the one rule that makes it HONEST: an absent fact
 * is stated, never dropped, because "(none issued)" is a finding and a missing line is
 * indistinguishable from a paste that got truncated.
 */
import { describe, expect, it } from "vitest";
import {
  entry,
  NONE_ISSUED,
  NOT_STATED,
  renderDiagnosticReport,
  renderReportSection,
  section,
} from "../src/lib/diagnostics/diagnostic-report.ts";

describe("a diagnostic report's grammar", () => {
  it("states an absent value rather than dropping the row", () => {
    expect(entry("error id", null, NONE_ISSUED)).toEqual({
      key: "error id",
      value: NONE_ISSUED,
    });
    expect(entry("title", "")).toEqual({ key: "title", value: NOT_STATED });
  });

  it("renders a number or a boolean without the caller stringifying it first", () => {
    expect(entry("status", 503).value).toBe("503");
    expect(entry("online", false).value).toBe("false");
  });

  it("indents a titled section's rows under its heading, and leaves an untitled block flat", () => {
    expect(
      renderReportSection({ title: "Deployment", entries: [entry("api", "a1b2c3d")] }),
    ).toEqual(["Deployment:", "  api: a1b2c3d"]);
    expect(renderReportSection({ title: null, entries: [entry("build", "a1b2c3d")] })).toEqual([
      "build: a1b2c3d",
    ]);
  });

  it("carries free lines — a breadcrumb trail is not a key and a value", () => {
    expect(
      renderReportSection({ title: "breadcrumbs", entries: [], notes: ["12:01 /matters open"] }),
    ).toEqual(["breadcrumbs:", "  12:01 /matters open"]);
  });

  it("drops a section with nothing at all in it, so an empty group never appears as a gap", () => {
    expect(section("Database", [])).toBeNull();
    expect(section("Database", [null, null])).toBeNull();
    expect(section("Database", [entry("state", "ok")])).not.toBeNull();
  });

  it("omits the null sections of a report rather than printing their headings", () => {
    const report = renderDiagnosticReport("Heading", [
      section(null, [entry("build", "a1b2c3d")]),
      null,
      section("Workers", [entry("magna-carta-scan", "a1b2c3d")]),
    ]);
    expect(report).toBe("Heading\nbuild: a1b2c3d\nWorkers:\n  magna-carta-scan: a1b2c3d");
  });
});

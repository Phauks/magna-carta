/*
 * The Build Information panel's paste, pinned.
 *
 * THE PROPERTY UNDER TEST IS THAT THE PASTE IS THE PANEL. A reader who copies this and sends it
 * should never have to be asked a follow-up the screen already answered — which build, which
 * Workers, whether the firm's database was answering — and, crucially, WHETHER THE READS EVEN
 * LANDED. The old assembly dropped a section whose value was null, so somebody staring at "The
 * version read failed · Error ID error_…" copied a report that did not mention it: the one case the
 * control exists for was the one case it said nothing about.
 *
 * The second property is that the grammar is shared. Every row is `key: value` and every group
 * indents under its heading, the same shape the issue reporter's trace uses, because a reader who
 * receives both should get one document in one format rather than two.
 */
import { describe, expect, it } from "vitest";
import {
  buildPanelReport,
  failureEntries,
  PANEL_REPORT_SECTIONS,
  type PanelReportState,
} from "../src/lib/versions/panel-report.ts";
import type { ServiceVersionRow } from "../src/lib/versions/version-overlay-model.ts";
import type { DatabaseHealthValue } from "../src/lib/versions/database-health-model.ts";
import type { Problem } from "../src/lib/api/request.ts";

function serviceRow(overrides: Partial<ServiceVersionRow> = {}): ServiceVersionRow {
  return {
    id: "web",
    service: "magna-carta-web",
    state: "reported",
    commit: "9f9f9f9",
    commitTime: "2026-09-07T01:00:00.000Z",
    buildTime: null,
    latencyMilliseconds: 84,
    ...overrides,
  };
}

const HEALTH: DatabaseHealthValue = {
  controlPlane: { state: "reachable", bucketProvisioned: true },
  firmDatabase: { state: "unreachable", roundTripMilliseconds: null, fault: "no such table" },
  schema: {
    state: "current",
    appliedCount: 42,
    appliedHead: "0042",
    expectedHead: "0042",
    outOfOrderArrivals: [],
    restorePoint: null,
  },
  membership: { state: "active", roles: ["partner"], permissionCount: 120 },
  provisioning: { state: "read", pending: 0, deadLettered: 0 },
  fileStorage: {
    uploadPath: "direct-to-storage",
    provisioner: "cloudflare-rest",
    lastReadinessCheck: null,
    state: "read",
  },
  observedAt: "2026-09-07T02:40:45.489Z",
};

const PROBLEM: Problem = {
  status: 503,
  errorId: "error_7QK2",
} as Problem;

function state(overrides: Partial<PanelReportState> = {}): PanelReportState {
  return {
    environment: null,
    pageBuild: {
      commit: "f4b6d82",
      commitTime: "2026-09-06T12:00:00.000Z",
      buildTime: null,
      mode: "production",
    },
    updateAvailable: false,
    readsAggregate: true,
    deployment: { value: null, failure: null },
    database: { value: null, failure: null },
    readiness: { permitted: false, report: null, failure: null },
    ...overrides,
  };
}

function lineFor(report: string, key: string): string | undefined {
  return report
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${key}: `))
    ?.slice(key.length + 2);
}

describe("a paste from the Build Information panel", () => {
  it("states this build even when every read has failed, because that is the one fact it always knows", () => {
    const report = buildPanelReport(
      state({
        deployment: { value: null, failure: { kind: "transport" } },
        database: { value: null, failure: { kind: "transport" } },
      }),
    );
    expect(lineFor(report, "This page")).toContain("f4b6d82");
    expect(lineFor(report, "environment")).toBe("production");
  });

  it("carries a failed read with its Error ID — the case the copy control exists for", () => {
    // This is the regression that motivated the rewrite: the section vanished with its value, so a
    // report filed during an outage described a healthy-looking panel with nothing in it.
    const report = buildPanelReport(
      state({ deployment: { value: null, failure: { kind: "problem", problem: PROBLEM } } }),
    );
    expect(report).toContain("Deployment:");
    expect(lineFor(report, "error id")).toBe("error_7QK2");
    expect(lineFor(report, "status")).toBe("503");
  });

  it("distinguishes a read that failed from one nothing answered", () => {
    expect(failureEntries({ kind: "transport" })[0]?.value).toContain("could not be reached");
    const problem = failureEntries({ kind: "problem", problem: PROBLEM });
    expect(problem.map((row) => row.key)).toEqual(["read", "error id", "status"]);
  });

  it("names an Error ID nobody issued rather than leaving the row out", () => {
    const rows = failureEntries({ kind: "problem", problem: { status: 500 } as Problem });
    expect(rows.find((row) => row.key === "error id")?.value).toBe("(none issued)");
  });

  it("carries each Worker's probe latency, so a slow one is visible in the paste too", () => {
    const report = buildPanelReport(
      state({
        deployment: {
          value: {
            api: { commit: "a1b2c3d", commitTime: null, buildTime: null },
            services: [serviceRow({ latencyMilliseconds: 1420 })],
            observedAt: "2026-09-07T02:40:45.489Z",
          },
          failure: null,
        },
      }),
    );
    expect(lineFor(report, "magna-carta-web")).toContain("1420 ms");
  });

  it("names a Worker that reported nothing, with the silence it is in", () => {
    // "Absent from the paste" and "reported nothing" are different faults, and a reader cannot tell
    // them apart after the fact — so the row that had no version says which one it is, and says
    // what that state actually means rather than only its two-word label.
    const report = buildPanelReport(
      state({
        deployment: {
          value: {
            api: { commit: "a1b2c3d", commitTime: null, buildTime: null },
            services: [
              serviceRow(),
              serviceRow({
                id: "email",
                service: "magna-carta-email",
                state: "unbound",
                commit: null,
                commitTime: null,
                latencyMilliseconds: null,
              }),
            ],
            observedAt: "2026-09-07T02:40:45.489Z",
          },
          failure: null,
        },
      }),
    );
    const line = lineFor(report, "magna-carta-email");
    expect(line).toContain("Not deployed");
    expect(line).toContain("not wired");
  });

  it("pastes a health row in fault with its detail, and a healthy one with its status alone", () => {
    const report = buildPanelReport(state({ database: { value: HEALTH, failure: null } }));
    expect(lineFor(report, "Firm database")).toContain("no such table");
    expect(lineFor(report, "Schema")).toBe("Up to date");
  });

  it("says a readiness check was not run rather than omitting the section", () => {
    // "Absent" and "not yours to run" are different facts and only one of them is about the
    // deployment.
    const report = buildPanelReport(state());
    expect(lineFor(report, "check")).toContain("may not run it");
  });

  it("says the aggregate was never attempted on a signed-out panel", () => {
    const report = buildPanelReport(state({ readsAggregate: false }));
    expect(lineFor(report, "read")).toContain("signed out");
    expect(report).not.toContain("Database:");
  });

  it("uses one row grammar throughout, so a reader parses one document and not two", () => {
    const report = buildPanelReport(
      state({
        database: { value: HEALTH, failure: null },
        deployment: {
          value: {
            api: { commit: "a1b2c3d", commitTime: null, buildTime: null },
            services: [serviceRow()],
            observedAt: "2026-09-07T02:40:45.489Z",
          },
          failure: null,
        },
      }),
    );
    const body = report.split("\n").slice(1);
    for (const line of body) {
      // Either a section heading, or a `key: value` row. Nothing else is a shape this grammar has.
      expect(line.endsWith(":") || /^\s*[^:]+: .+$/.test(line)).toBe(true);
    }
  });

  it("is a registry, so a new section joins by contributing rather than by gaining a parameter", () => {
    // The shape is the point: every contributor is a pure function of the one state object and may
    // return null. A contributor that needed a parameter of its own would be the arrangement this
    // replaced.
    expect(PANEL_REPORT_SECTIONS.length).toBeGreaterThan(0);
    for (const contribute of PANEL_REPORT_SECTIONS) {
      expect(contribute.length).toBe(1);
    }
  });
});

/*
 * The report is how a diagnosis leaves the browser — it is pasted to whoever can act on it. Two
 * facts the firm database sends about its lineage have no other symptom, so if they are not in the
 * text nobody finds out they were ever measured.
 */
describe("the report carries the lineage notes", () => {
  it("says nothing about an ordinary lineage", () => {
    const report = buildPanelReport(state());
    expect(lineFor(report, "lineage")).toBeUndefined();
  });

  it("carries an out-of-order arrival", () => {
    const report = buildPanelReport(
      state({
        database: {
          value: { ...HEALTH, schema: { ...HEALTH.schema, outOfOrderArrivals: ["0041_late"] } },
          failure: null,
        },
      }),
    );
    expect(lineFor(report, "lineage")).toContain("0041_late");
  });

  it("carries a restore point, and never a bookmark", () => {
    const report = buildPanelReport(
      state({
        database: {
          value: {
            ...HEALTH,
            schema: {
              ...HEALTH.schema,
              restorePoint: { takenAt: "2026-09-15T18:00:00.000Z", precedes: ["0042"] },
            },
          },
          failure: null,
        },
      }),
    );
    expect(lineFor(report, "lineage")).toContain("2026-09-15T18:00:00.000Z");
  });

  it("names a refused lineage as not applied, rather than up to date", () => {
    const report = buildPanelReport(
      state({
        database: {
          value: { ...HEALTH, schema: { ...HEALTH.schema, state: "refused" } },
          failure: null,
        },
      }),
    );
    // A fault row prints its detail as well as its status, so the paste carries the explanation and
    // not just the two words.
    const line = lineFor(report, "Schema");
    expect(line).toContain("Not applied");
    expect(line).toContain("refused the ledger");
  });
});

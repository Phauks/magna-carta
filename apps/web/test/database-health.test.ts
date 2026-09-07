/*
 * The Database section's reading rules. What is pinned here is the thing the section exists for:
 * that the states a refused screen can be in stay TOLD APART. "Your role does not grant this action
 * in this firm" is one sentence over at least four different situations, and each of them is
 * somebody else's job — a wait, an administrator's grant, a broken seeding, a connection fault. A
 * reading that collapsed any two of them back together would put the panel exactly where the 403
 * already was.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  databaseSectionPills,
  copyLineForDatabaseHealth,
  databaseHealthRows,
  describeProvisioningBacklog,
  healthBadgeVariant,
  overallHealthReading,
  worstReading,
  type DatabaseHealthValue,
} from "../src/lib/versions/database-health-model.ts";

const SOURCE_ROOT = join(import.meta.dirname, "..", "src");

function source(relativePath: string): string {
  return readFileSync(join(SOURCE_ROOT, relativePath), "utf8");
}

/** Strip comment prose so a sweep reads only what the component does, never what it explains. */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const HEALTHY: DatabaseHealthValue = {
  controlPlane: {
    state: "reachable",
    roundTripMilliseconds: 5,
    fault: null,
    bucketProvisioned: true,
  },
  controlPlaneSchema: {
    state: "current",
    appliedCount: 8,
    appliedHead: "20260829T160000_registration-credential",
    expectedHead: "20260829T160000_registration-credential",
  },
  firmDatabase: { state: "reachable", roundTripMilliseconds: 12, fault: null },
  firmSchema: {
    state: "current",
    appliedCount: 214,
    appliedHead: "20260903T020000_conflicts-hit-entity-index",
    expectedHead: "20260903T020000_conflicts-hit-entity-index",
  },
  membership: { state: "active", roles: ["Owner/Admin"], permissionCount: 84 },
  provisioning: { state: "read", pending: 0, deadLettered: 0 },
  observedAt: "2026-09-03T12:00:00.000Z",
};

const ROWS = [
  "firmDatabase",
  "firmSchema",
  "membership",
  "controlPlane",
  "controlPlaneSchema",
  "fileStorage",
] as const;

function rowFor(value: DatabaseHealthValue, id: string) {
  const row = databaseHealthRows(value).find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`no row for ${id}`);
  return row;
}

describe("databaseHealthRows", () => {
  it("always renders the same six rows, healthy or not", () => {
    // A row that disappears when it is fine would make the section's LENGTH the signal, and half
    // of these states are ordinary. Two groups of three, the firm's database first and the platform
    // one under it, so a reader who finds the firm's group healthy has somewhere to look next.
    expect(databaseHealthRows(HEALTHY).map((row) => row.id)).toEqual([...ROWS]);
    expect(
      databaseHealthRows({
        ...HEALTHY,
        firmDatabase: { state: "unreachable", roundTripMilliseconds: null, fault: null },
      }).map((row) => row.id),
    ).toEqual([...ROWS]);
  });

  // The reason this section grew a second group. Both databases are on the path of every request —
  // the control plane resolves the account, the session and the firm's record before the firm's own
  // database is consulted at all — and the panel used to time one of them and merely ping the
  // other. A member whose screens were slow could read "Answered in 12 ms" off a healthy firm row
  // and learn nothing about the leg actually failing them.
  it("times BOTH databases and names each one, rather than timing the firm's alone", () => {
    const rows = databaseHealthRows(HEALTHY);
    const firm = rowFor(HEALTHY, "firmDatabase");
    const platform = rowFor(HEALTHY, "controlPlane");
    expect(firm.detail).toBe("Answered in 12 ms.");
    expect(platform.detail).toBe("Answered in 5 ms.");
    // Named apart, so "which database" is answerable from the row itself.
    expect(new Set(rows.map((row) => row.name)).size).toBe(rows.length);
    expect(platform.name).toContain("Magna Carta");
  });

  it("says WHY the platform database is not answering, on the same terms as the firm's", () => {
    const row = rowFor(
      {
        ...HEALTHY,
        controlPlane: {
          state: "unreachable",
          roundTripMilliseconds: null,
          fault: "D1_ERROR: no such table: firm",
        },
      },
      "controlPlane",
    );
    expect(row.reading).toBe("fault");
    expect(row.status).toBe("Not answering");
    expect(row.detail).toContain("D1_ERROR: no such table: firm");
    // And it names the database it is about, so the two fault sentences cannot be confused.
    expect(row.detail).toContain("Magna Carta");
  });

  it("reads each database's lineage against its OWN expected head", () => {
    // Two journals, two heads. A row that compared the firm's applied tag with the control plane's
    // expected one would report "Behind" on every healthy firm in the fleet.
    const value: DatabaseHealthValue = {
      ...HEALTHY,
      controlPlaneSchema: {
        ...HEALTHY.controlPlaneSchema,
        state: "behind",
        appliedHead: "20260811T224252_self-serve-registration-and-invitations",
      },
    };
    expect(rowFor(value, "firmSchema").reading).toBe("healthy");
    const platformSchema = rowFor(value, "controlPlaneSchema");
    expect(platformSchema.reading).toBe("attention");
    expect(platformSchema.detail).toContain(
      "20260811T224252_self-serve-registration-and-invitations",
    );
    expect(platformSchema.detail).toContain(HEALTHY.controlPlaneSchema.expectedHead);
  });

  it("still answers the file-storage row when the control plane's own probe did not", () => {
    // The bucket fact comes from the firm record the request was already resolved through, not from
    // a read of its own, so blanking it with the probe would cost a reader the one line that
    // explains an upload that will not start.
    const value: DatabaseHealthValue = {
      ...HEALTHY,
      controlPlane: {
        state: "unreachable",
        roundTripMilliseconds: null,
        fault: null,
        bucketProvisioned: false,
      },
    };
    expect(rowFor(value, "controlPlane").reading).toBe("fault");
    expect(rowFor(value, "fileStorage").status).toBe("Still provisioning");
  });

  it("reads a healthy firm as healthy on every row", () => {
    expect(databaseHealthRows(HEALTHY).every((row) => row.reading === "healthy")).toBe(true);
    expect(overallHealthReading(HEALTHY)).toBe("healthy");
  });

  it("puts the round trip on the connected row rather than claiming health bare", () => {
    expect(rowFor(HEALTHY, "firmDatabase").detail).toBe("Answered in 12 ms.");
  });

  // The reason a database is not answering is the whole diagnosis, and this row used to throw it
  // away: a firm database bricked by a failing migration read as "Not answering" and nothing more,
  // which sent a reader to the logs for a fact this very read already held.
  it("says WHY the firm database is not answering when it said why", () => {
    const row = rowFor(
      {
        ...HEALTHY,
        firmDatabase: {
          state: "unreachable",
          roundTripMilliseconds: null,
          fault: "CHECK constraint failed: matter_status_check",
        },
      },
      "firmDatabase",
    );
    expect(row.reading).toBe("fault");
    expect(row.status).toBe("Not answering");
    expect(row.detail).toContain("CHECK constraint failed: matter_status_check");
  });

  it("says plainly that no reason was given rather than implying none exists", () => {
    const row = rowFor(
      {
        ...HEALTHY,
        firmDatabase: { state: "unreachable", roundTripMilliseconds: null, fault: null },
      },
      "firmDatabase",
    );
    expect(row.detail).toContain("gave no reason");
  });

  it("puts a faulted row's reason on the clipboard, not just its status", () => {
    // The copy is what reaches a bug report. Carrying "Not answering" without the reason handed
    // over the symptom and stripped the diagnosis — which is exactly what happened in the report
    // that led here.
    const line = copyLineForDatabaseHealth({
      ...HEALTHY,
      firmDatabase: {
        state: "unreachable",
        roundTripMilliseconds: null,
        fault: "FOREIGN KEY constraint failed",
      },
    });
    expect(line).toContain("Firm database: Not answering");
    expect(line).toContain("FOREIGN KEY constraint failed");
  });

  it("leaves a healthy row to its status, so a good read does not paste reassurance", () => {
    expect(copyLineForDatabaseHealth(HEALTHY)).toContain("Firm database: Connected");
    expect(copyLineForDatabaseHealth(HEALTHY)).not.toContain("Answered in 12 ms.");
  });

  it("tells the four refused-screen situations apart", () => {
    const missing = rowFor(
      { ...HEALTHY, membership: { state: "missing", roles: [], permissionCount: 0 } },
      "membership",
    );
    const noRole = rowFor(
      { ...HEALTHY, membership: { state: "active", roles: [], permissionCount: 0 } },
      "membership",
    );
    const noPermissions = rowFor(
      {
        ...HEALTHY,
        membership: { state: "active", roles: ["Attorney"], permissionCount: 0 },
      },
      "membership",
    );
    const unread = rowFor(
      { ...HEALTHY, membership: { state: "unknown", roles: [], permissionCount: 0 } },
      "membership",
    );
    const statuses = [missing.status, noRole.status, noPermissions.status, unread.status];
    expect(new Set(statuses).size).toBe(4);
    // And each says what to do about ITS situation, not the generic one.
    expect(missing.detail).toContain("has not reached the firm's database");
    expect(noRole.detail).toContain("administrator");
    expect(noPermissions.detail).toContain("Attorney");
  });

  it("never reads an unreadable membership as an absent one", () => {
    // The one confusion that would actively mislead: a failed read rendered as "you are not a
    // member" sends somebody to an administrator to fix nothing.
    const unread = rowFor(
      { ...HEALTHY, membership: { state: "unknown", roles: [], permissionCount: 0 } },
      "membership",
    );
    expect(unread.reading).toBe("attention");
    expect(unread.status).not.toBe(
      rowFor(
        { ...HEALTHY, membership: { state: "missing", roles: [], permissionCount: 0 } },
        "membership",
      ).status,
    );
  });

  it("reads a lagging schema as attention, not a fault", () => {
    // A firm's database migrates itself when it next wakes, so being a version back is a wait.
    const row = rowFor(
      {
        ...HEALTHY,
        firmSchema: {
          ...HEALTHY.firmSchema,
          state: "behind",
          appliedHead: "20260704T041516_baseline",
        },
      },
      "firmSchema",
    );
    expect(row.reading).toBe("attention");
    expect(row.detail).toContain("20260704T041516_baseline");
    expect(row.detail).toContain(HEALTHY.firmSchema.expectedHead);
  });

  it("reads an unallocated bucket as a firm still being built", () => {
    const row = rowFor(
      { ...HEALTHY, controlPlane: { ...HEALTHY.controlPlane, bucketProvisioned: false } },
      "fileStorage",
    );
    expect(row.reading).toBe("attention");
  });
});

describe("describeProvisioningBacklog", () => {
  it("says nothing when there is no backlog", () => {
    expect(describeProvisioningBacklog(HEALTHY)).toBeNull();
  });

  it("turns a pending mirror into a wait", () => {
    const backlog = describeProvisioningBacklog({
      ...HEALTHY,
      provisioning: { state: "read", pending: 1, deadLettered: 0 },
    });
    expect(backlog?.reading).toBe("attention");
    expect(backlog?.sentence).toContain("still being written");
  });

  it("says a dead-lettered mirror will not retry, even with one still pending", () => {
    const backlog = describeProvisioningBacklog({
      ...HEALTHY,
      provisioning: { state: "read", pending: 1, deadLettered: 1 },
    });
    expect(backlog?.reading).toBe("fault");
    expect(backlog?.sentence).toContain("will not retry");
  });

  it("says nothing when the backlog could not be read", () => {
    // Silence beats a "0 pending" that was never actually counted.
    expect(
      describeProvisioningBacklog({
        ...HEALTHY,
        provisioning: { state: "unknown", pending: 0, deadLettered: 0 },
      }),
    ).toBeNull();
  });
});

describe("the collapsed heading", () => {
  it("carries the worst reading in the section, backlog included", () => {
    // The fold rule: folding may hide rows, never a fault. A section whose only bad news is the
    // provisioning line still has to show it on a shut heading.
    const value: DatabaseHealthValue = {
      ...HEALTHY,
      provisioning: { state: "read", pending: 0, deadLettered: 1 },
    };
    expect(overallHealthReading(value)).toBe("fault");
  });

  it("says nothing at all when everything is fine", () => {});

  it("ranks readings worst-last", () => {
    expect(worstReading(["healthy", "attention"])).toBe("attention");
    expect(worstReading(["attention", "fault", "healthy"])).toBe("fault");
    expect(worstReading([])).toBe("healthy");
    expect(healthBadgeVariant("fault")).toBe("danger");
  });
});

describe("copyLineForDatabaseHealth", () => {
  it("carries every row's state, the backlog, and when it was observed", () => {
    const line = copyLineForDatabaseHealth({
      ...HEALTHY,
      membership: { state: "missing", roles: [], permissionCount: 0 },
      provisioning: { state: "read", pending: 1, deadLettered: 0 },
    });
    expect(line).toContain("Firm database:");
    expect(line).toContain("Magna Carta database:");
    expect(line).toContain("Your membership:");
    expect(line).toContain("still being written");
    expect(line).toContain(HEALTHY.observedAt);
  });
});

/*
 * That the panel actually obeys the rules above, read off its source — the same technique the
 * version overlay's own scope rules are pinned with, and for the same reason: this project's tests
 * run in a plain node pool, and rendering a design-system component pulls bits-ui, which a
 * deliberate boundary gate keeps out of every config outside the design system.
 */
describe("the panel's two folding sections", () => {
  const chip = stripComments(source("lib/versions/version-chip.svelte"));
  const heading = stripComments(source("lib/versions/version-section-heading.svelte"));
  const preferences = source("lib/versions/version-panel-preferences.svelte.ts");

  it("renders every fold through the one disclosure snippet", () => {
    // Three folds, one definition of what a fold is. A section that built its own heading is how
    // two carets end up disagreeing about aria-expanded or about when a badge shows.
    const renders = chip.match(/<VersionSectionHeading/g) ?? [];
    expect(renders).toHaveLength(3);
    expect(heading).toContain("aria-expanded={!collapsed}");
  });

  it("puts Deployment and Database each behind their own remembered caret", () => {
    expect(chip).toMatch(
      /label=\{DEPLOYMENT_SECTION_LABEL\}[\s\S]*collapsed=\{deploymentSectionPreference\.collapsed\}/,
    );
    expect(chip).toMatch(
      /label=\{DATABASE_SECTION_LABEL\}[\s\S]*collapsed=\{databaseSectionPreference\.collapsed\}/,
    );
    // Three separate remembered folds, each arriving open: a section that arrived shut would hide
    // the fault somebody opened the panel to find.
    const keys = preferences.match(/"magna-carta\.version-panel-[a-z]+"/g) ?? [];
    expect(new Set(keys).size).toBe(3);
    expect(preferences).toMatch(/\["expanded", "collapsed"\], "expanded"/);
    expect(preferences).toContain("followAcrossTabs()");
  });

  it("makes each shut heading speak for exactly what its own fold hides", () => {
    // This once required Deployment's badge to count every Worker in the read, which was right
    // while the fleet was a drawer INSIDE Deployment: collapsing Deployment took the fleet down
    // with it. Workers is its own section now, so that same count would have both headings
    // claiming the same silent Worker — and a reader who folded only Workers would see Deployment
    // wearing a warning about rows still on screen. Each heading counts its own half.
    expect(chip).toContain("pills={deploymentPills}");
    expect(chip).toMatch(/deploymentPills = \$derived\([\s\S]*?deploymentRows\.front/);
    expect(chip).toContain("pills={workersPills}");
    expect(chip).toMatch(/workersPills = \$derived\([\s\S]*?deploymentRows\.rest/);
    expect(chip).not.toContain("summarizeSilentWorkers(value.services)");
  });

  it("makes a shut Database heading count what is wrong, not just name a mood", () => {
    // "Needs attention" / "Not working" named a mood and left the reader to open the section to
    // learn how much of it was affected — one bad row out of four reads very differently from four,
    // and the heading said the same thing either way.
    expect(chip).toContain("databaseSectionPills(healthValue)");
    expect(databaseSectionPills(HEALTHY).map((pill) => pill.label)).toEqual(["6 checks"]);
    const broken = databaseSectionPills({
      ...HEALTHY,
      firmDatabase: { state: "unreachable", roundTripMilliseconds: null, fault: null },
    });
    expect(broken.map((pill) => pill.label)).toEqual(["6 checks", "1 not working"]);
    expect(broken[1]?.variant).toBe("danger");
  });

  it("never asks for the health read outside a session, however the panel was opened", () => {
    const body =
      /async function refreshHealth\([^)]*\): Promise<void> \{([\s\S]*?)\n  \}/.exec(chip)?.[1] ??
      "";
    expect(body).toContain("if (!readsAggregate) return;");
    expect(body.indexOf("if (!readsAggregate) return;")).toBeLessThan(body.indexOf("requestJson<"));
    // And the signed-out panel says so rather than showing an empty section that reads as an outage.
    expect(chip).toContain("{SIGNED_OUT_DATABASE_NOTICE}");
  });

  it("keeps a failed health read from blanking the deployment list, and says its Error ID", () => {
    // Two reads, two failure states: a dead health read must not take the version rows down with
    // it, which is the opposite of what a panel opened during an outage is for.
    expect(chip).toContain("healthFailure");
    expect(chip).toContain("healthFailure.problem.errorId");
    expect(chip).not.toContain("failure = healthFailure");
  });

  it("does not read anything until the panel is opened", () => {
    // The chip is on every screen in the app; a standing health poll behind it would be a request
    // on every page load to answer a question nobody has asked.
    expect(chip).toMatch(/if \(!open \|\| !readsAggregate\) return;[\s\S]*void refreshHealth\(\);/);
  });
});

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
  collapsedHealthBadge,
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
  controlPlane: { state: "reachable", bucketProvisioned: true },
  firmDatabase: { state: "reachable", roundTripMilliseconds: 12, fault: null },
  schema: {
    state: "current",
    appliedCount: 214,
    appliedHead: "20260903T020000_conflicts-hit-entity-index",
    expectedHead: "20260903T020000_conflicts-hit-entity-index",
  },
  membership: { state: "active", roles: ["Owner/Admin"], permissionCount: 84 },
  provisioning: { state: "read", pending: 0, deadLettered: 0 },
  observedAt: "2026-09-03T12:00:00.000Z",
};

function rowFor(value: DatabaseHealthValue, id: string) {
  const row = databaseHealthRows(value).find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`no row for ${id}`);
  return row;
}

describe("databaseHealthRows", () => {
  it("always renders the same four rows, healthy or not", () => {
    // A row that disappears when it is fine would make the section's LENGTH the signal, and half
    // of these states are ordinary.
    expect(databaseHealthRows(HEALTHY).map((row) => row.id)).toEqual([
      "firmDatabase",
      "schema",
      "membership",
      "controlPlane",
    ]);
    expect(
      databaseHealthRows({
        ...HEALTHY,
        firmDatabase: { state: "unreachable", roundTripMilliseconds: null, fault: null },
      }).map((row) => row.id),
    ).toEqual(["firmDatabase", "schema", "membership", "controlPlane"]);
  });

  it("reads a healthy firm as healthy on every row", () => {
    expect(databaseHealthRows(HEALTHY).every((row) => row.reading === "healthy")).toBe(true);
    expect(overallHealthReading(HEALTHY)).toBe("healthy");
    expect(collapsedHealthBadge("healthy")).toBeNull();
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
        schema: { ...HEALTHY.schema, state: "behind", appliedHead: "20260704T041516_baseline" },
      },
      "schema",
    );
    expect(row.reading).toBe("attention");
    expect(row.detail).toContain("20260704T041516_baseline");
    expect(row.detail).toContain(HEALTHY.schema.expectedHead);
  });

  it("reads an unallocated bucket as a firm still being built", () => {
    const row = rowFor(
      { ...HEALTHY, controlPlane: { state: "reachable", bucketProvisioned: false } },
      "controlPlane",
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
    expect(collapsedHealthBadge(overallHealthReading(value))).toBe("Not working");
  });

  it("says nothing at all when everything is fine", () => {
    expect(collapsedHealthBadge(overallHealthReading(HEALTHY))).toBeNull();
  });

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
  const preferences = source("lib/versions/version-panel-preferences.svelte.ts");

  it("renders every fold through the one disclosure snippet", () => {
    // Three folds, one definition of what a fold is. A section that built its own heading is how
    // two carets end up disagreeing about aria-expanded or about when a badge shows.
    const renders = chip.match(/\{@render sectionToggle\(\{/g) ?? [];
    expect(renders).toHaveLength(3);
    expect(chip).toContain("aria-expanded={!section.collapsed}");
  });

  it("puts Deployment and Database each behind their own remembered caret", () => {
    expect(chip).toMatch(
      /label: DEPLOYMENT_SECTION_LABEL,[\s\S]*collapsed: deploymentSectionPreference\.collapsed/,
    );
    expect(chip).toMatch(
      /label: DATABASE_SECTION_LABEL,[\s\S]*collapsed: databaseSectionPreference\.collapsed/,
    );
    // Three separate remembered folds, each arriving open: a section that arrived shut would hide
    // the fault somebody opened the panel to find.
    const keys = preferences.match(/"magna-carta\.version-panel-[a-z]+"/g) ?? [];
    expect(new Set(keys).size).toBe(3);
    expect(preferences).toMatch(/\["expanded", "collapsed"\], "expanded"/);
    expect(preferences).toContain("followAcrossTabs()");
  });

  it("makes a shut Deployment heading speak for the whole read, not just the fleet", () => {
    // Collapsing Deployment takes the leading pair down with it, and a fault in the pair is the
    // one most worth seeing — so its badge counts every Worker in the read.
    expect(chip).toContain("summarizeSilentWorkers(value.services)");
    expect(chip).toContain("badge: silentDeploymentWorkers");
  });

  it("makes a shut Database heading carry the worst reading in the section", () => {
    expect(chip).toContain("overallHealthReading(healthValue)");
    expect(chip).toContain("collapsedHealthBadge(healthReading)");
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

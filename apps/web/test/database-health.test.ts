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
  describeSchemaLineage,
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
    outOfOrderArrivals: [],
    restorePoint: null,
  },
  membership: { state: "active", roles: ["Admin"], permissionCount: 84 },
  provisioning: { state: "read", pending: 0, deadLettered: 0 },
  fileStorage: {
    uploadPath: "direct-to-storage",
    provisioner: "cloudflare-rest",
    lastReadinessCheck: { at: "2026-09-10T15:00:00.000Z", ready: true, failed: [] },
    state: "read",
  },
  observedAt: "2026-09-03T12:00:00.000Z",
};

function rowFor(value: DatabaseHealthValue, id: string) {
  const row = databaseHealthRows(value).find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`no row for ${id}`);
  return row;
}

describe("databaseHealthRows", () => {
  it("always renders the same five rows, healthy or not", () => {
    // A row that disappears when it is fine would make the section's LENGTH the signal, and half
    // of these states are ordinary.
    expect(databaseHealthRows(HEALTHY).map((row) => row.id)).toEqual([
      "firmDatabase",
      "schema",
      "membership",
      "controlPlane",
      "fileStorage",
    ]);
    expect(
      databaseHealthRows({
        ...HEALTHY,
        firmDatabase: { state: "unreachable", roundTripMilliseconds: null, fault: null },
      }).map((row) => row.id),
    ).toEqual(["firmDatabase", "schema", "membership", "controlPlane", "fileStorage"]);
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
  const chip = stripComments(source("lib/versions/version-report.svelte"));
  const heading = stripComments(source("lib/versions/version-section-heading.svelte"));
  const panelSection = stripComments(source("lib/versions/version-panel-section.svelte"));
  const preferences = source("lib/versions/version-panel-preferences.svelte.ts");

  it("renders every section through the one component, heading and all", () => {
    // Four sections, one definition of what a section IS — the heading, the fold, the failure
    // block and the loading region. Each was written out longhand in the panel before, which is
    // how two carets end up disagreeing about aria-expanded, and how two identical failures end up
    // worded differently.
    const renders = chip.match(/<VersionPanelSection/g) ?? [];
    expect(renders).toHaveLength(4);
    expect(chip).not.toContain("<VersionSectionHeading");
    expect(panelSection).toContain("<VersionSectionHeading");
    expect(heading).toContain("aria-expanded={!collapsed}");
  });

  it("puts every section behind its own remembered caret, from the one fold registry", () => {
    expect(chip).toMatch(
      /label=\{DEPLOYMENT_SECTION_LABEL\}\s*preference=\{PANEL_SECTION_FOLDS\.deployment\}/,
    );
    expect(chip).toMatch(
      /label=\{DATABASE_SECTION_LABEL\}\s*preference=\{PANEL_SECTION_FOLDS\.database\}/,
    );
    // Four separate remembered folds, each arriving open: a section that arrived shut would hide
    // the fault somebody opened the panel to find. The keys are DERIVED from the section ids now,
    // so a section cannot ship with its key spelled a second, different way.
    const registered = preferences.match(/createSectionFold\("[a-z]+"\)/g) ?? [];
    expect(new Set(registered).size).toBe(4);
    expect(preferences).toContain("`magna-carta.version-panel-${sectionId}`");
    expect(preferences).toMatch(/\["expanded", "collapsed"\],\s*"expanded",/);
    expect(preferences).toContain("followAcrossTabs()");
  });

  it("shows a section's failed read whether it is folded or not", () => {
    // Folding is a statement about how much detail the reader wants, never a statement that the
    // read succeeded — so the failure block sits OUTSIDE the fold in the one place that draws it.
    const failureBlock = panelSection.indexOf("{#if failure !== null}");
    const foldedBody = panelSection.indexOf("{#if !preference.collapsed");
    expect(failureBlock).toBeGreaterThan(-1);
    expect(failureBlock).toBeLessThan(foldedBody);
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
    expect(databaseSectionPills(HEALTHY).map((pill) => pill.label)).toEqual(["5 checks"]);
    const broken = databaseSectionPills({
      ...HEALTHY,
      firmDatabase: { state: "unreachable", roundTripMilliseconds: null, fault: null },
    });
    expect(broken.map((pill) => pill.label)).toEqual(["5 checks", "1 not working"]);
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
    expect(chip).not.toContain("failure = healthFailure");
    // The section is handed its OWN failure and its own lead sentence — "the database health read
    // failed" and "the version read failed" are different sentences, and a reader needs the word
    // that says which read is out.
    expect(chip).toMatch(
      /label=\{DATABASE_SECTION_LABEL\}[\s\S]*failure=\{healthFailure\}[\s\S]*failureLead="The database health read failed\."/,
    );
    // The Error ID itself is drawn once, by the one component every section's failure goes through.
    expect(panelSection).toContain("failure.problem.errorId");
  });

  it("does not read anything until the panel is opened", () => {
    // The chip is on every screen in the app; a standing health poll behind it would be a request
    // on every page load to answer a question nobody has asked. The report reads only while the
    // surface holding it says it is on screen — the chip passes its popover state (which now lives
    // in build-panel.svelte.ts so the command palette can open it), the Versions page passes true.
    expect(chip).toMatch(/if \(!open \|\| !readsAggregate\) return;[\s\S]*void refreshHealth\(\);/);
  });
});

describe("the file storage row", () => {
  it("reads the last check, not the deployment's hopes: ready is healthy, not-ready names the cause", () => {
    expect(rowFor(HEALTHY, "fileStorage")).toMatchObject({ reading: "healthy", status: "Ready" });
    const notReady = rowFor(
      {
        ...HEALTHY,
        fileStorage: {
          ...HEALTHY.fileStorage,
          lastReadinessCheck: {
            at: "2026-09-10T15:00:00.000Z",
            ready: false,
            failed: ["key-can-sign"],
          },
        },
      },
      "fileStorage",
    );
    expect(notReady.reading).toBe("fault");
    expect(notReady.status).toBe("Not ready");
    // The first failed precondition is the cause; the row says it in the reader's words and where
    // to run the check again.
    expect(notReady.detail).toContain("the storage credential is honoured");
    expect(notReady.detail).toContain("this panel");
  });

  it("treats a firm nobody has checked as a fact, not a fault", () => {
    const unchecked = rowFor(
      { ...HEALTHY, fileStorage: { ...HEALTHY.fileStorage, lastReadinessCheck: null } },
      "fileStorage",
    );
    expect(unchecked.reading).toBe("healthy");
    expect(unchecked.status).toBe("Not yet checked");
    expect(unchecked.detail).toContain("this panel");
  });

  it("says when files go through the application, and asks nothing about a check", () => {
    const local = rowFor(
      {
        ...HEALTHY,
        fileStorage: {
          uploadPath: "through-the-application",
          provisioner: "development",
          lastReadinessCheck: null,
          state: "read",
        },
      },
      "fileStorage",
    );
    expect(local).toMatchObject({ reading: "healthy", status: "Through the application" });
  });

  it("reports a record that could not be read as attention, never as ready", () => {
    const unread = rowFor(
      {
        ...HEALTHY,
        fileStorage: { ...HEALTHY.fileStorage, lastReadinessCheck: null, state: "unknown" },
      },
      "fileStorage",
    );
    expect(unread).toMatchObject({ reading: "attention", status: "Not read" });
  });
});

/*
 * A refused lineage is at head and broken at the same time, which is the shape that defeated the
 * head comparison this row used to be. The firm database was answering nothing, its ledger held a
 * tag the build could not place, and the runner rejects such a ledger BEFORE applying anything — so
 * the tags already in it sat exactly at the expected head and the row printed "Up to date" beside a
 * firm database row reporting an outage.
 */
describe("a refused lineage", () => {
  const REFUSED: DatabaseHealthValue = {
    ...HEALTHY,
    firmDatabase: {
      state: "unreachable",
      roundTripMilliseconds: null,
      fault:
        "the firm database is not migrated: database has applied migration " +
        '"20260911T000000_office-email-address-lines" which this code does not know',
    },
    schema: { ...HEALTHY.schema, state: "refused" },
  };

  it("does not read as healthy while the ledger sits at the expected head", () => {
    // The regression, stated as the thing that must never come back.
    expect(REFUSED.schema.appliedHead).toBe(REFUSED.schema.expectedHead);
    const row = rowFor(REFUSED, "schema");
    expect(row.reading).toBe("fault");
    expect(row.status).not.toBe(rowFor(HEALTHY, "schema").status);
  });

  it("still prints what the database does have, which is the row's actual subject", () => {
    const row = rowFor(REFUSED, "schema");
    expect(row.detail).toContain(String(REFUSED.schema.appliedCount));
    expect(row.detail).toContain(REFUSED.schema.expectedHead);
  });

  it("points at the firm database row instead of repeating its sentence", () => {
    // One home per fact: the refusal is the firm database's own words, and a second copy here would
    // be free to drift from it.
    const row = rowFor(REFUSED, "schema");
    expect(row.detail).not.toContain("which this code does not know");
    expect(row.detail).toContain("firm database row");
  });

  it("makes the section read as a fault, so a folded section cannot hide it", () => {
    expect(overallHealthReading(REFUSED)).toBe("fault");
  });
});

/*
 * Two facts the firm database has always computed and sent, and this model used to read off the
 * wire and drop. Neither is a row: a row blank on every healthy firm teaches a reader to skip it.
 */
describe("describeSchemaLineage", () => {
  it("says nothing about an ordinary firm", () => {
    expect(describeSchemaLineage(HEALTHY)).toEqual([]);
  });

  it("names a migration that arrived behind the ledger head, without calling it a fault", () => {
    // Everything is applied; what differs is the ORDER this database met the pair in. It has no
    // other symptom, which is why it is worth a line at all.
    const notes = describeSchemaLineage({
      ...HEALTHY,
      schema: { ...HEALTHY.schema, outOfOrderArrivals: ["20260911T000000_early"] },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.reading).toBe("attention");
    expect(notes[0]?.sentence).toContain("20260911T000000_early");
  });

  it("counts several arrivals rather than saying 'one migration' about three", () => {
    const notes = describeSchemaLineage({
      ...HEALTHY,
      schema: { ...HEALTHY.schema, outOfOrderArrivals: ["a_one", "b_two", "c_three"] },
    });
    expect(notes[0]?.sentence).toContain("3 migrations");
  });

  it("names a restore point, with the instant and what it precedes", () => {
    const notes = describeSchemaLineage({
      ...HEALTHY,
      schema: {
        ...HEALTHY.schema,
        restorePoint: { takenAt: "2026-09-15T18:00:00.000Z", precedes: ["20260914T191528_intake"] },
      },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.sentence).toContain("2026-09-15T18:00:00.000Z");
    expect(notes[0]?.sentence).toContain("20260914T191528_intake");
  });

  it("says both when both are true", () => {
    const notes = describeSchemaLineage({
      ...HEALTHY,
      schema: {
        ...HEALTHY.schema,
        outOfOrderArrivals: ["20260911T000000_early"],
        restorePoint: { takenAt: "2026-09-15T18:00:00.000Z", precedes: ["20260914T191528_intake"] },
      },
    });
    expect(notes).toHaveLength(2);
  });
});

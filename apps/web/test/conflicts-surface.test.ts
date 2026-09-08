/*
 * The conflicts surface is reachable, and one matter's conflicts record has a home inside the
 * matter.
 *
 * These are registry facts rather than rendering ones, and they are worth a test because each was
 * once wrong in a way nothing failed on. The screens under /conflicts were built and shipped while
 * the sidebar destination still carried `shipped: false`, so for as long as that stood the runner,
 * the firm's check history, a check read back and a matter's standing were all reachable only by
 * typing the address — the surface existed and the product denied it. Nothing failed, because a
 * registry flag disagreeing with the routes beside it is not a type error.
 *
 * The same holds for the timeline. A conflicts check on a matter's Activity chronology opens into
 * whichever section OWNS `conflictsCheck`, and while no section did, every check row on the
 * chronology explained itself instead of opening. The coverage lint proves the source is accounted
 * for either way; only this proves it is accounted for by a section a reader can actually open.
 */
import { describe, expect, it } from "vitest";
import { destinationStage, DESTINATIONS } from "../src/lib/navigation/destinations.ts";
import {
  matterSections,
  matterStrip,
  UNSECTIONED_TIMELINE_SOURCES,
} from "../src/lib/matters/sections.ts";
import { hasSurface } from "@magna-carta/design-system/maturity";

describe("the conflicts destination", () => {
  it("is a live sidebar row rather than an announced Soon stub", () => {
    const conflicts = DESTINATIONS.find((destination) => destination.id === "conflicts");
    expect(conflicts).toBeDefined();
    // `shipped` is what gives the sidebar row an href at all; an unshipped row renders disabled.
    expect(conflicts?.shipped).toBe(true);
    expect(conflicts?.href).toBe("/conflicts");
    // And `announced` is the Soon treatment, which only ever applies to an unshipped destination.
    expect(conflicts?.announced).toBeUndefined();
    expect(hasSurface(destinationStage(conflicts!))).toBe(true);
  });
});

describe("the matter's conflicts section", () => {
  const conflicts = matterSections.find((section) => section.slug === "conflicts");

  it("exists and is a surface a reader can open", () => {
    expect(conflicts).toBeDefined();
    expect(conflicts?.label).toBe("Conflicts");
    expect(hasSurface(conflicts!.stage)).toBe(true);
  });

  it("owns the conflicts-check timeline source, so a chronology row opens into it", () => {
    expect(conflicts?.timelineSources).toContain("conflictsCheck");
    // The other half of the same fact: a source cannot be both owned and declared unowned, and the
    // coverage lint reads this map to decide which.
    expect(UNSECTIONED_TIMELINE_SOURCES["conflictsCheck"]).toBeUndefined();
  });

  it("stands on the strip beside Intake rather than folded into a group", () => {
    // The owner's ruling of 2026-09-07: separate in the matter's strip for the same reason the two
    // are separate destinations in the global sidebar. A group would bury one behind the other.
    const top = matterStrip.map((entry) =>
      entry.kind === "section" ? entry.section.slug : `group:${entry.label}`,
    );
    expect(top).toContain("conflicts");
    expect(top.indexOf("conflicts")).toBe(top.indexOf("intake") + 1);
  });

  it("offers running a check as its create act, within the control's noun budget", () => {
    // Running a check writes a new row in an append-only log, which is a create in the only sense
    // this surface has one. The design system refuses a noun too long for the control's fixed
    // width at module load, so a section that declares one is already inside the budget.
    expect(conflicts?.createNoun).toBe("Check");
  });
});

/*
 * The check register's column model. What is worth a test here is the register's honesty about who
 * asked and about what it is a register OF.
 *
 *   - WHO ASKED has three answers and not two. A manual run names a member; an event- or
 *     clock-driven run is nobody's act and says so; a row written before the trigger source was
 *     recorded can say neither. Collapsing the last two — the tidy-up that is always one edit away
 *     — would have the register claim the firm's own system caught something that a person may in
 *     fact have clicked, which is precisely the claim the trigger column exists to keep honest.
 *   - THE CHECK'S NUMBER ANCHORS THE ROW and is never hideable: it is how a check is referred to,
 *     and a register that could lose it is one nobody can cite from. The opening date sorts it.
 *   - NO COLUMN IS A CONCLUSION. The candidate count is a count of what the search surfaced, and
 *     the model must not grow a column that grades it — that answer belongs to a named reviewer,
 *     recorded against one hit.
 */
import { describe, expect, it } from "vitest";
import type { ConflictsCheckSummary } from "../src/lib/conflicts/conflicts-api.ts";
import {
  AGAINST_A_MATTER,
  AGAINST_NAMED_PARTIES,
  CHECK_REGISTER_INITIAL_SORT,
  EMPTY_CHECK_VOCABULARY,
  FLOOR_AS_ASKED,
  FLOOR_RAISED,
  RAN_AUTOMATICALLY,
  SOURCE_UNRECORDED,
  checkActorText,
  checkRegisterVocabulary,
  conflictsCheckColumns,
} from "../src/lib/conflicts/check-columns.ts";

function check(overrides: Partial<ConflictsCheckSummary> = {}): ConflictsCheckSummary {
  return {
    id: "conflictsCheck_one",
    checkNumber: "CC-0001",
    trigger: "comprehensive",
    matterId: "matter_one",
    createdByUserId: "user_one",
    runCount: 1,
    latestRunId: "conflictsCheck_one",
    runStatus: "completed",
    latestRunAt: "2026-09-08T12:00:00.000Z",
    strictness: "balanced",
    floorRaised: false,
    actorUserId: "user_one",
    triggerSource: "manual",
    hitCount: 3,
    subjectParties: [
      { entityId: "directoryPerson_a", party: { kind: "person", displayName: "Dana Whitfield" } },
      { entityId: "directoryOrganization_b", party: null },
    ],
    createdAt: "2026-09-08T12:00:00.000Z",
    ...overrides,
  };
}

const roster = checkRegisterVocabulary([{ userId: "user_one", displayName: "Dana Reyes" }]);

describe("who asked for a check", () => {
  it("names the member on a manual run", () => {
    expect(checkActorText(check(), roster)).toBe("Dana Reyes");
  });

  it("falls back to the handle rather than a blank when the roster cannot name them", () => {
    // A member who has left, or a roster that has not landed. The row still says a person asked.
    expect(checkActorText(check(), EMPTY_CHECK_VOCABULARY)).toBe("user_one");
  });

  it("says an automated run was automatic rather than leaving the actor blank", () => {
    expect(checkActorText(check({ triggerSource: "event", actorUserId: null }), roster)).toBe(
      RAN_AUTOMATICALLY,
    );
    expect(checkActorText(check({ triggerSource: "schedule", actorUserId: null }), roster)).toBe(
      RAN_AUTOMATICALLY,
    );
  });

  it("distinguishes a row that cannot say what started it from one that was automatic", () => {
    const unrecorded = checkActorText(check({ triggerSource: null, actorUserId: null }), roster);
    expect(unrecorded).toBe(SOURCE_UNRECORDED);
    expect(unrecorded).not.toBe(RAN_AUTOMATICALLY);
  });
});

describe("the register's columns", () => {
  const columns = conflictsCheckColumns(roster);
  const byIdentifier = new Map(columns.map((column) => [column.id, column]));

  it("anchors the row on the check's number and opens most recently opened first", () => {
    const number = byIdentifier.get("checkNumber");
    expect(number?.anchored).toBe(true);
    expect(number?.value(check())).toBe("CC-0001");
    expect(byIdentifier.get("createdAt")?.type).toBe("date");
    expect(CHECK_REGISTER_INITIAL_SORT).toEqual({
      columnId: "createdAt",
      direction: "descending",
    });
  });

  it("counts the runs and says where the latest one is, and carries no depth", () => {
    expect(byIdentifier.get("runCount")?.value(check({ runCount: 3 }))).toBe(3);
    expect(byIdentifier.get("runState")?.value(check())).toBe("Completed");
    expect(byIdentifier.get("runState")?.value(check({ runStatus: null }))).toBeNull();
    expect(byIdentifier.has("depth")).toBe(false);
  });

  it("leaves a run with no record yet blank rather than inventing a band or a floor", () => {
    const pending = check({ strictness: null, floorRaised: null, hitCount: null });
    expect(byIdentifier.get("strictness")?.value(pending)).toBeNull();
    expect(byIdentifier.get("floorRaised")?.value(pending)).toBeNull();
    expect(byIdentifier.get("hitCount")?.value(pending)).toBeNull();
  });

  it("offers every trigger the catalogue names, whether or not a loaded row carries it", () => {
    // A firm that has never had an entity merged can still have one tomorrow; a filter that dropped
    // the word because nothing on screen carries it would say otherwise.
    const trigger = byIdentifier.get("trigger");
    expect(trigger?.filter).toBe("set");
    expect(trigger?.filterValues).toContain("Entity Merged");
    expect(trigger?.filterValues).toContain("Periodic Re-scan");
  });

  it("says whether the search was filed against a matter", () => {
    const against = byIdentifier.get("against");
    expect(against?.value(check())).toBe(AGAINST_A_MATTER);
    expect(against?.value(check({ matterId: null }))).toBe(AGAINST_NAMED_PARTIES);
  });

  it("says when the firm's floor widened the search past what was asked for", () => {
    const floor = byIdentifier.get("floorRaised");
    expect(floor?.value(check({ floorRaised: true }))).toBe(FLOOR_RAISED);
    expect(floor?.value(check())).toBe(FLOOR_AS_ASKED);
  });

  it("counts candidates and grades none of them", () => {
    const candidates = byIdentifier.get("hitCount");
    expect(candidates?.label).toBe("Candidates");
    expect(candidates?.value(check({ hitCount: 0 }))).toBe(0);
    // The register reports the search; what any of it MEANT is a named reviewer's answer, recorded
    // against one hit and never derived into a column here.
    const labels = columns.map((column) => column.label.toLowerCase());
    for (const verdict of ["status", "outcome", "result", "conclusion"]) {
      expect(labels).not.toContain(verdict);
    }
  });

  it("names who each check searched, and never leaves an unresolved party blank", () => {
    const parties = byIdentifier.get("parties");
    expect(parties?.label).toBe("Parties");
    expect(parties?.value(check())).toBe("Dana Whitfield, Entity not resolved");
    expect(parties?.value(check({ subjectParties: [] }))).toBeNull();
  });
});

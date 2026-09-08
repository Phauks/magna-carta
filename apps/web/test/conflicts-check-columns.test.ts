/*
 * The check register's column model. What is worth a test here is the register's honesty about who
 * asked and about what it is a register OF.
 *
 *   - WHO ASKED has three answers and not two. A manual run names a member; an event- or
 *     clock-driven run is nobody's act and says so; a row written before the trigger source was
 *     recorded can say neither. Collapsing the last two — the tidy-up that is always one edit away
 *     — would have the register claim the firm's own system caught something that a person may in
 *     fact have clicked, which is precisely the claim the trigger column exists to keep honest.
 *   - THE RUN DATE ANCHORS THE ROW and is never hideable: a log read months later is read down its
 *     dates, and a register that could lose them is one nobody can walk.
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
    trigger: "comprehensive",
    matterId: "matter_one",
    strictness: "balanced",
    depth: 2,
    floorRaised: false,
    actorUserId: "user_one",
    triggerSource: "manual",
    hitCount: 3,
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

  it("anchors the row on when the check ran", () => {
    const run = byIdentifier.get("createdAt");
    expect(run?.anchored).toBe(true);
    expect(run?.type).toBe("date");
    expect(CHECK_REGISTER_INITIAL_SORT).toEqual({
      columnId: "createdAt",
      direction: "descending",
    });
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
});

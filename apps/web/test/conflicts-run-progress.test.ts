/*
 * A running check reports on itself, and the sequence a person reads is derived from the run row
 * without a DOM. What is worth pinning: the stages come in the engine's own order, a stage carries
 * what it has counted so far, a run that stopped short names the stage it stopped at with the
 * failure in place of the label, and a run that finished is every stage done.
 */
import { describe, expect, it } from "vitest";
import type { RunSummary } from "../src/lib/conflicts/conflicts-api.ts";
import { runProgressSteps, stageCountText } from "../src/lib/conflicts/run-progress.ts";
import { RUN_STAGES, RUN_STAGE_VOCABULARY } from "../src/lib/conflicts/conflicts-vocabulary.ts";

function run(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "conflictsCheck_run",
    ordinal: 1,
    status: "running",
    stage: "walking",
    progress: { sourcesSearched: 2, subjectParties: 3, entitiesReached: 41 },
    trigger: "preliminary",
    triggerSource: "manual",
    requestedByUserId: "user_one",
    createdAt: "2026-09-11T10:00:00.000Z",
    startedAt: "2026-09-11T10:00:01.000Z",
    finishedAt: null,
    failure: null,
    cancelledByUserId: null,
    askedScope: null,
    hitCount: null,
    subjectParties: [],
    ...overrides,
  };
}

describe("where a run is", () => {
  it("marks the stages before the reported one done, the reported one active, the rest pending", () => {
    const steps = runProgressSteps(run());
    expect(steps.map((step) => step.status)).toEqual(["done", "active", "pending", "pending"]);
    // A run asked for none of the firm's own records skips the stage that searches them.
    expect(steps).toHaveLength(RUN_STAGES.length - 1);
  });

  it("shows the search of calls, texts, email, tasks and Magnus on a run that asked for it", () => {
    const steps = runProgressSteps(
      run({
        stage: "places",
        progress: { placeResults: 3 },
        askedScope: {
          sources: ["party"],
          strictness: "balanced",
          trigramMatching: true,
          places: { messaging: [], tasks: [], magnus: true },
        },
      }),
    );
    expect(steps).toHaveLength(RUN_STAGES.length);
    expect(steps[3]).toEqual({
      label: `${RUN_STAGE_VOCABULARY.places} — 3 results found`,
      status: "active",
    });
  });

  it("says what each stage has counted so far, beside its name", () => {
    const steps = runProgressSteps(run());
    expect(steps[0]?.label).toBe(`${RUN_STAGE_VOCABULARY.sources} — 2 sources, 3 parties`);
    expect(steps[1]?.label).toBe(`${RUN_STAGE_VOCABULARY.walking} — 41 entities reached`);
    // A stage that has reported nothing yet is named and nothing more: no invented zero.
    expect(steps[2]?.label).toBe(RUN_STAGE_VOCABULARY.matching);
  });

  it("is every stage done once the run has finished", () => {
    const steps = runProgressSteps(run({ status: "completed", stage: null }));
    expect(steps.every((step) => step.status === "done")).toBe(true);
  });

  it("names the stage a failed run stopped at, with the failure in place of its label", () => {
    const steps = runProgressSteps(
      run({ status: "failed", stage: "matching", failure: "The search stopped." }),
    );
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "failed", "pending"]);
    expect(steps[2]?.failure).toBe("The search stopped.");
  });

  it("treats a failed run that never reported a stage as having failed at the first", () => {
    const steps = runProgressSteps(run({ status: "failed", stage: null, failure: null }));
    expect(steps[0]?.status).toBe("failed");
    expect(steps[0]?.failure).toContain("stopped before it finished");
  });

  it("is every stage pending while the run is queued", () => {
    const steps = runProgressSteps(run({ status: "queued", stage: null, progress: {} }));
    expect(steps.every((step) => step.status === "pending")).toBe(true);
  });
});

describe("the count a stage reports", () => {
  it("counts singular and plural in words", () => {
    expect(stageCountText("sources", { sourcesSearched: 1, subjectParties: 1 })).toBe(
      "1 source, 1 party",
    );
    expect(stageCountText("walking", { entitiesReached: 1 })).toBe("1 entity reached");
    expect(stageCountText("candidates", { candidatesSurfaced: 4, candidatesRecorded: 4 })).toBe(
      "4 surfaced, 4 recorded",
    );
  });

  it("answers nothing for a stage that has reported nothing", () => {
    expect(stageCountText("matching", {})).toBeNull();
  });
});

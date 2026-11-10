/*
 * What a running check says about itself, as the sequence a person reads.
 *
 * WHY A SEQUENCE AND NOT A SPINNER. A search nobody can watch is exactly the one that has to report
 * on itself (owner's ruling, 2026-09-11). "Running" cannot tell a run three seconds in from one
 * that has been going for a minute, and gives somebody watching nothing to say about what has been
 * searched so far. The engine reports its stage and what it has counted, in its own order, and this
 * module turns that into steps — the split the firm-build screen keeps: the server carries states,
 * the browser decides sentences, and the mapping is testable without a DOM.
 *
 * AND NOT A PROGRESS BAR. The stages are of unequal and unknowable length — resolving sources is
 * instant, walking a large corporate group is not — so a bar drawn at a fraction would be a claim
 * about how far along the search is, which is the one thing nobody knows. A stage either has
 * happened or has not, and beside it stands what it has counted so far.
 */
import type { ProgressStep } from "@magna-carta/design-system/progress-steps";
import type { RunProgress, RunStage, RunSummary } from "./conflicts-api.ts";
import { RUN_STAGES, RUN_STAGE_VOCABULARY } from "./conflicts-vocabulary.ts";

/** The count a stage has reached so far, in words, or null where it has reported nothing yet. */
export function stageCountText(stage: RunStage, progress: RunProgress): string | null {
  switch (stage) {
    case "sources": {
      if (progress.sourcesSearched === undefined) return null;
      const parties =
        progress.subjectParties === undefined
          ? ""
          : `, ${String(progress.subjectParties)} ${progress.subjectParties === 1 ? "party" : "parties"}`;
      return `${String(progress.sourcesSearched)} ${progress.sourcesSearched === 1 ? "source" : "sources"}${parties}`;
    }
    case "walking":
      return progress.entitiesReached === undefined
        ? null
        : `${String(progress.entitiesReached)} ${progress.entitiesReached === 1 ? "entity" : "entities"} reached`;
    case "matching":
      return progress.entitiesMatched === undefined
        ? null
        : `${String(progress.entitiesMatched)} compared`;
    case "places":
      return progress.placeResults === undefined
        ? null
        : `${String(progress.placeResults)} ${progress.placeResults === 1 ? "result" : "results"} found`;
    case "candidates": {
      if (progress.candidatesSurfaced === undefined) return null;
      const recorded =
        progress.candidatesRecorded === undefined
          ? ""
          : `, ${String(progress.candidatesRecorded)} recorded`;
      return `${String(progress.candidatesSurfaced)} surfaced${recorded}`;
    }
  }
}

/**
 * The run as a sequence of steps. Every stage before the reported one is done, the reported one is
 * active, the rest are pending; a completed run is every stage done, and a failed run marks the
 * stage it stopped at with the failure sentence in place of its label.
 */
export function runProgressSteps(run: RunSummary): ProgressStep[] {
  // The search of the firm's own records is a stage only on a run that was asked for one.
  const places = run.askedScope?.places;
  const asked =
    places !== undefined &&
    (places.messaging.length > 0 || places.tasks.length > 0 || places.magnus);
  const stages = RUN_STAGES.filter((stage) => stage !== "places" || asked);
  const current = run.stage === null ? -1 : stages.indexOf(run.stage);
  return stages.map((stage, index) => {
    const count = stageCountText(stage, run.progress);
    const label =
      count === null ? RUN_STAGE_VOCABULARY[stage] : `${RUN_STAGE_VOCABULARY[stage]} — ${count}`;
    if (run.status === "completed") return { label, status: "done" };
    if (run.status === "failed") {
      if (index < current) return { label, status: "done" };
      if (index === current || (current === -1 && index === 0)) {
        return {
          label,
          status: "failed",
          failure: run.failure ?? "The search stopped before it finished.",
        };
      }
      return { label, status: "pending" };
    }
    if (index < current) return { label, status: "done" };
    if (index === current) return { label, status: "active" };
    return { label, status: "pending" };
  });
}

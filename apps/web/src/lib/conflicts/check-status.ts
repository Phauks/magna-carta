/*
 * The Status section of a check's report: where each place stands, with its own log.
 *
 * THE LOG IS PART OF THE REPORT (owner's ruling, 2026-11-09: "this verbose status check can be part
 * of the final page"). While a run is in flight each place shows what it has done so far; once it
 * settles the same rows stay, now holding the engine's own account of the search. So the page a
 * person watched is the page they keep, and a place that was never searched says so in the same
 * row it would have reported from.
 *
 * ONE ROW PER PLACE, in the panel's order. The Directory is the place the engine searches today;
 * the others read Not searched until their indexes arrive, and they will report here the same way.
 */
import type { CheckWithHits, RunSummary } from "./conflicts-api.ts";
import { RUN_STAGE_VOCABULARY, RUN_STAGES, SEARCH_LOCATIONS } from "./conflicts-vocabulary.ts";
import { resultCountText } from "./check-results.ts";
import { stageCountText } from "./run-progress.ts";
import type { SearchLocation } from "./conflicts-vocabulary.ts";

export type PlaceState = "waiting" | "searching" | "done" | "stopped" | "failed" | "not-searched";

export interface StatusPlace {
  readonly location: SearchLocation;
  readonly label: string;
  readonly state: PlaceState;
  /** One phrase beside the place's name: where it is, or what it came to. */
  readonly summary: string;
  /** The place's own log, oldest first. */
  readonly lines: readonly string[];
}

/** The word a place's state is announced by, for a reader who cannot see its mark. */
export const PLACE_STATE_LABELS: Readonly<Record<PlaceState, string>> = {
  waiting: "Waiting",
  searching: "Searching",
  done: "Done",
  stopped: "Cancelled",
  failed: "Stopped",
  "not-searched": "Not searched",
};

/** What the Directory has done so far in a run still going: each stage reached, with its count. */
function stagesSoFar(run: RunSummary): string[] {
  if (run.stage === null) return [];
  const current = RUN_STAGES.indexOf(run.stage);
  return RUN_STAGES.slice(0, current + 1).map((stage) => {
    const count = stageCountText(stage, run.progress);
    return count === null
      ? RUN_STAGE_VOCABULARY[stage]
      : `${RUN_STAGE_VOCABULARY[stage]}: ${count}`;
  });
}

function directoryPlace(
  run: RunSummary,
  record: CheckWithHits | null,
): Omit<StatusPlace, "location" | "label"> {
  switch (run.status) {
    case "queued":
      return { state: "waiting", summary: "Waiting to start", lines: [] };
    case "running": {
      const lines = stagesSoFar(run);
      return {
        state: "searching",
        summary: run.stage === null ? "Starting" : RUN_STAGE_VOCABULARY[run.stage],
        lines,
      };
    }
    case "completed":
      return {
        state: "done",
        summary: resultCountText(record?.hits.length ?? run.hitCount ?? 0),
        // The engine's own sentences, in the order it wrote them. A firm defending its procedure
        // quotes these, so nothing here rewrites them.
        lines: record?.statement ?? [],
      };
    case "cancelled":
      return { state: "stopped", summary: "Cancelled before it finished", lines: [] };
    case "failed":
      return {
        state: "failed",
        summary: "Stopped before it finished",
        lines: [run.failure ?? "The search stopped before it finished, and nothing was recorded."],
      };
  }
}

/** Every place, in the panel's order, as it stands for this run. */
export function statusPlaces(run: RunSummary, record: CheckWithHits | null): StatusPlace[] {
  return SEARCH_LOCATIONS.map((entry) => {
    if (!entry.searchable) {
      return {
        location: entry.location,
        label: entry.label,
        state: "not-searched" as const,
        summary: "Not searched",
        lines: [],
      };
    }
    return { location: entry.location, label: entry.label, ...directoryPlace(run, record) };
  });
}

/** The one-line caption beside the Status heading. */
export function statusCaption(places: readonly StatusPlace[]): string {
  const searchable = places.filter((place) => place.state !== "not-searched");
  const finished = searchable.filter((place) => place.state === "done").length;
  if (searchable.some((place) => place.state === "searching" || place.state === "waiting")) {
    return `${String(finished)} of ${String(searchable.length)} ${searchable.length === 1 ? "location" : "locations"} finished`;
  }
  return `${String(finished)} of ${String(searchable.length)} ${searchable.length === 1 ? "location" : "locations"} finished, ${String(places.length - searchable.length)} not searched`;
}

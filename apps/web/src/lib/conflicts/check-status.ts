/*
 * The Status section of a check's report: where each place stands, with its own log.
 *
 * THE LOG IS PART OF THE REPORT (owner's ruling, 2026-11-09: "this verbose status check can be part
 * of the final page"). While a run is in flight each place shows what it has done so far; once it
 * settles the same rows stay, now holding the engine's own account of the search. So the page a
 * person watched is the page they keep, and a place that was never searched says so in the same
 * row it would have reported from.
 *
 * ONE ROW PER PLACE, in the panel's order. The Directory reports the engine's own stages. Messaging,
 * Tasks and Magnus each report whether they were asked for, where the run is with them, and — once
 * it settles — the engine's sentence about that place and how many results were found there. Files
 * reads Not searched until its index arrives.
 *
 * WHICH SENTENCE BELONGS TO WHICH PLACE. The engine leads each sentence about the firm's own
 * records with the place's name ("Messaging — ..."), so a line is filed under the place it names
 * and every other line is the Directory's.
 */
import type { CheckWithHits, HitDetail, PlacesRequest, RunSummary } from "./conflicts-api.ts";
import {
  FOUND_IN_VOCABULARY,
  MAGNUS_OPTION,
  MESSAGING_OPTIONS,
  RUN_STAGE_VOCABULARY,
  RUN_STAGES,
  SEARCH_LOCATIONS,
  TASK_STATUS_OPTIONS,
  FILE_STATUS_OPTIONS,
  FILES_SOURCE,
} from "./conflicts-vocabulary.ts";
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

/** The name each place's sentences in the engine's account begin with. */
const STATEMENT_LEADS: Readonly<Partial<Record<SearchLocation, string>>> = {
  files: "Files —",
  messaging: "Messaging —",
  tasks: "Tasks —",
  magnus: "Magnus —",
};

/** Which place a result belongs to. */
export function locationOfHit(hit: HitDetail): SearchLocation {
  return hit.foundIn === null ? "directory" : FOUND_IN_VOCABULARY[hit.foundIn.kind].location;
}

/** Whether a run was asked to search a place beyond the Directory. */
export function placeWasAsked(location: SearchLocation, places: PlacesRequest | null): boolean {
  if (places === null) return false;
  if (location === "messaging") return places.messaging.length > 0;
  if (location === "tasks") return places.tasks.length > 0;
  if (location === "magnus") return places.magnus;
  if (location === "files") return (places.files ?? []).length > 0;
  return false;
}

/**
 * What a run asked of a place beyond the Directory, in the panel's own words: "Calls, Texts, Email",
 * or null where the place was not asked for.
 */
export function placeSettingsText(
  location: SearchLocation,
  places: PlacesRequest | null,
): string | null {
  if (places === null || !placeWasAsked(location, places)) return null;
  if (location === "messaging") {
    return MESSAGING_OPTIONS.filter((option) => places.messaging.includes(option.key))
      .map((option) => option.label)
      .join(", ");
  }
  if (location === "tasks") {
    return TASK_STATUS_OPTIONS.filter((option) => places.tasks.includes(option.key))
      .map((option) => option.label)
      .join(", ");
  }
  if (location === "files") {
    const files = places.files ?? [];
    return FILE_STATUS_OPTIONS.filter((option) => files.includes(option.key))
      .map((option) => option.label)
      .join(", ");
  }
  return MAGNUS_OPTION;
}

/** What the Directory has done so far in a run still going: each of its stages reached. */
function stagesSoFar(run: RunSummary): string[] {
  if (run.stage === null) return [];
  const current = RUN_STAGES.indexOf(run.stage);
  return RUN_STAGES.slice(0, current + 1)
    .filter((stage) => stage !== "places")
    .map((stage) => {
      const count = stageCountText(stage, run.progress);
      return count === null
        ? RUN_STAGE_VOCABULARY[stage]
        : `${RUN_STAGE_VOCABULARY[stage]}: ${count}`;
    });
}

type PlaceReading = Omit<StatusPlace, "location" | "label">;

/** How a run that did not finish reads, in every place it was searching. */
function unfinished(run: RunSummary): PlaceReading | null {
  if (run.status === "queued") return { state: "waiting", summary: "Waiting to start", lines: [] };
  if (run.status === "cancelled") {
    return { state: "stopped", summary: "Cancelled before it finished", lines: [] };
  }
  if (run.status === "failed") {
    return {
      state: "failed",
      summary: "Stopped before it finished",
      lines: [run.failure ?? "The search stopped before it finished, and nothing was recorded."],
    };
  }
  return null;
}

function statementFor(location: SearchLocation, statement: readonly string[]): string[] {
  const lead = STATEMENT_LEADS[location];
  if (lead !== undefined) return statement.filter((line) => line.startsWith(lead));
  const leads = Object.values(STATEMENT_LEADS);
  return statement.filter((line) => !leads.some((other) => line.startsWith(other)));
}

function directoryPlace(run: RunSummary, record: CheckWithHits | null): PlaceReading {
  const stopped = unfinished(run);
  if (stopped !== null) return stopped;
  if (run.status === "running") {
    return {
      state: "searching",
      summary: run.stage === null ? "Starting" : RUN_STAGE_VOCABULARY[run.stage],
      lines: stagesSoFar(run),
    };
  }
  const hits =
    record?.hits.filter((hit) => locationOfHit(hit) === "directory").length ?? run.hitCount ?? 0;
  return {
    state: "done",
    summary: resultCountText(hits),
    // The engine's own sentences, in the order it wrote them. A firm defending its procedure
    // quotes these, so nothing here rewrites them.
    lines: statementFor("directory", record?.statement ?? []),
  };
}

function recordsPlace(
  location: SearchLocation,
  run: RunSummary,
  record: CheckWithHits | null,
): PlaceReading {
  const stopped = unfinished(run);
  if (stopped !== null) return stopped;
  if (run.status === "running") {
    const at = run.stage === null ? -1 : RUN_STAGES.indexOf(run.stage);
    if (at < RUN_STAGES.indexOf("places")) {
      return { state: "waiting", summary: "Waiting for the Directory", lines: [] };
    }
    const found = run.progress.placeResults;
    return {
      state: "searching",
      summary: "Searching",
      lines:
        found === undefined ? [] : [`${resultCountText(found)} found so far across these places`],
    };
  }
  // Files is asked of the file index, which a check records as not searched when the firm does not
  // index its files or the index could not be reached: that reads as not searched, never as
  // searched and empty. The record does not say which of the two it was, so the line names both.
  if (location === "files" && record?.check.scope[FILES_SOURCE] === "unavailable") {
    return {
      state: "not-searched",
      summary: "Not searched",
      lines: [
        "No file's text was read. File indexing is not turned on for this firm, or the file index could not be reached. An administrator turns it on in Settings, under Search and Indexing.",
      ],
    };
  }
  const hits = record?.hits.filter((hit) => locationOfHit(hit) === location).length ?? 0;
  return {
    state: "done",
    summary: resultCountText(hits),
    lines: statementFor(location, record?.statement ?? []),
  };
}

/** Every place, in the panel's order, as it stands for this run. */
export function statusPlaces(run: RunSummary, record: CheckWithHits | null): StatusPlace[] {
  const places = run.askedScope?.places ?? null;
  return SEARCH_LOCATIONS.map((entry) => {
    const named = { location: entry.location, label: entry.label };
    if (entry.location === "directory") return { ...named, ...directoryPlace(run, record) };
    if (!entry.searchable || !placeWasAsked(entry.location, places)) {
      return { ...named, state: "not-searched" as const, summary: "Not searched", lines: [] };
    }
    return { ...named, ...recordsPlace(entry.location, run, record) };
  });
}

/** The one-line caption beside the Status heading. */
export function statusCaption(places: readonly StatusPlace[]): string {
  const searchable = places.filter((place) => place.state !== "not-searched");
  const finished = searchable.filter((place) => place.state === "done").length;
  const noun = searchable.length === 1 ? "location" : "locations";
  if (searchable.some((place) => place.state === "searching" || place.state === "waiting")) {
    return `${String(finished)} of ${String(searchable.length)} ${noun} finished`;
  }
  return `${String(finished)} of ${String(searchable.length)} ${noun} finished, ${String(places.length - searchable.length)} not searched`;
}

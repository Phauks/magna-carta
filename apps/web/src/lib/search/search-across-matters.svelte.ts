/*
 * The Search page's state: one question, asked of every matter the reader may see.
 *
 * THREE READS, ONE ANSWER. Records (notes, time, costs, calls, file names) come from the search
 * across matters, which answers a group per place. Matters and people are found by name through
 * the reads their own screens already use, the matters listing and the directory's name search,
 * so a name is matched here exactly as it is matched there. The page presents the three as one
 * list of places; this module is the only part that knows they arrive separately.
 *
 * AN OVERVIEW AND A PLACE. With no place chosen the page shows a few results from every place.
 * Choosing a place asks that one place again for a full page, and keeps the overview so the list
 * of places beside it still says where else the words were found. The overview is asked once per
 * question, not once per place.
 *
 * NO TOTALS. Every count here is a count of what is on screen, with a "+" where the server
 * measured that there is more. Nothing counts the whole answer, so nothing claims to.
 */
import type { ApiOutcome, Page } from "$lib/api/request.ts";
import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
import type { DirectorySearchHit, DirectorySearchResult } from "$lib/directory/directory-api.ts";
import { readDirectoryNameMatches } from "$lib/directory/directory-search-place.ts";
import { listMatters, type MatterSummary } from "$lib/matters/matters-api.ts";
import { presentationFor } from "$lib/matters/matter-search-presentation.ts";
import { LatestOnly } from "../api/latest-only.ts";
import {
  searchAcrossMatters,
  type AcrossMattersAnswer,
  type AcrossMattersGroup,
} from "./search-across-matters-api.ts";
import { ALL_PLACES, MATTERS_PLACE, PEOPLE_PLACE, isRecordPlace } from "./search-address.ts";

/** How many results each place shows in the overview. */
export const OVERVIEW_LIMIT = 5;
/** How many results a chosen place shows. The most the read answers for one place. */
export const PLACE_LIMIT = 50;

/**
 * How a read by name stands. A refusal is kept apart from a failure because they are different
 * sentences to a reader: one is theirs to raise with an administrator, the other is worth trying
 * again.
 */
export type NameReadStanding = "answered" | "no-access" | "unavailable";

export interface NameGroup<Row> {
  readonly rows: readonly Row[];
  /** Whether the firm holds more matches than these. Measured by the read, never estimated. */
  readonly more: boolean;
  readonly standing: NameReadStanding;
}

/** One question's answer from every place, a few results each. */
export interface SearchOverview {
  readonly query: string;
  readonly matters: NameGroup<MatterSummary>;
  readonly people: NameGroup<DirectorySearchHit>;
  /** Null where the search across matters failed; `failure` on the model says how. */
  readonly records: AcrossMattersAnswer | null;
}

export interface RailPlace {
  /** The value the address carries in `in`. */
  readonly key: string;
  readonly label: string;
  /** Results on screen for this place, or null where it could not answer. */
  readonly shown: number | null;
  /** Whether the place holds more than `shown`. */
  readonly more: boolean;
}

export interface UnsearchedPlace {
  readonly key: string;
  readonly label: string;
  /** One or two words for the mark beside the name. */
  readonly mark: string;
  /** Why, as a sentence a reader can act on. */
  readonly reason: string;
}

function standingOf<Value>(outcome: ApiOutcome<Value>): NameReadStanding {
  if (outcome.kind === "ok") return "answered";
  if (outcome.kind === "problem" && outcome.problem.status === 403) return "no-access";
  return "unavailable";
}

function mattersGroup(outcome: ApiOutcome<Page<MatterSummary>>): NameGroup<MatterSummary> {
  if (outcome.kind !== "ok") return { rows: [], more: false, standing: standingOf(outcome) };
  return {
    rows: outcome.value.data,
    more: outcome.value.nextCursor !== null,
    standing: "answered",
  };
}

function peopleGroup(outcome: ApiOutcome<DirectorySearchResult>): NameGroup<DirectorySearchHit> {
  if (outcome.kind !== "ok") return { rows: [], more: false, standing: standingOf(outcome) };
  return { rows: outcome.value.data, more: outcome.value.capped, standing: "answered" };
}

/** Whether a group is a place this search reads at all, as opposed to one it names and skips. */
function answersAcrossMatters(group: AcrossMattersGroup): boolean {
  return group.skipped !== "one-matter-only" && group.skipped !== "permission";
}

function shownOf<Row>(group: NameGroup<Row>): number | null {
  return group.standing === "answered" ? Math.min(group.rows.length, PLACE_LIMIT) : null;
}

/**
 * The places beside the results, in the order the page reads in: everything, then matters and
 * people, then each record place in the order a matter's own sections read in.
 *
 * A record place's count comes from the overview, which read a few results from each: it says
 * "5+" where there are more, never a total. A place the reader may not read, or one that is not
 * searched across matters, is not here; `unsearchedPlaces` names those.
 */
export function railPlaces(overview: SearchOverview | null): readonly RailPlace[] {
  if (overview === null) return [];
  const records = (overview.records?.groups ?? []).filter(answersAcrossMatters);
  const named: RailPlace[] = [
    {
      key: MATTERS_PLACE,
      label: "Matters",
      shown: shownOf(overview.matters),
      more: overview.matters.more,
    },
    {
      key: PEOPLE_PLACE,
      label: "People",
      shown: shownOf(overview.people),
      more: overview.people.more,
    },
    ...records.map((group) => ({
      key: group.source,
      label: presentationFor(group.source).heading,
      shown: group.skipped === null ? group.hits.length : null,
      more: group.hasMore,
    })),
  ];
  const total = named.reduce((sum, place) => sum + (place.shown ?? 0), 0);
  return [
    {
      key: ALL_PLACES,
      label: "All Places",
      shown: total,
      more: named.some((place) => place.more),
    },
    ...named,
  ];
}

/**
 * What this search did not look at, and why. Read from the server's own answer for the places it
 * names, so a place that starts answering across matters leaves this list with no edit here.
 *
 * Discovery review sets are named always. They are not a place the server skipped this time: a
 * review set is searched only from inside the set, by the people on its access list, and a reader
 * should be told that here instead of concluding the firm holds nothing there.
 */
export function unsearchedPlaces(overview: SearchOverview | null): readonly UnsearchedPlace[] {
  const skipped = (overview?.records?.groups ?? []).flatMap((group): UnsearchedPlace[] => {
    const label = presentationFor(group.source).heading;
    if (group.skipped === "one-matter-only") {
      return [
        {
          key: group.source,
          label,
          mark: "In A Matter",
          reason: `${label} is searched from inside a matter, with that matter's own search.`,
        },
      ];
    }
    if (group.skipped === "permission") {
      return [
        {
          key: group.source,
          label,
          mark: "No Access",
          reason: `Your role does not include reading ${label}.`,
        },
      ];
    }
    return [];
  });
  return [
    ...skipped,
    {
      key: "discovery-sets",
      label: "Discovery Sets",
      mark: "Never",
      reason:
        "A discovery review set is searched only from inside the set, by the people on its access list.",
    },
  ];
}

export class SearchAcrossMatters {
  /** A few results from every place, for the question last asked. */
  overview = $state<SearchOverview | null>(null);
  /** A full page from the one record place the reader chose, or null where none is chosen. */
  place = $state<AcrossMattersGroup | null>(null);
  /** The search across matters failing. A read by name failing is on its own group instead. */
  failure = $state<StatedFailure | null>(null);
  busy = $state(false);

  readonly #latest = new LatestOnly();
  #inFlight: AbortController | null = null;

  /** Abandons whatever is in flight and clears the answer: the reader emptied the field. */
  clear(): void {
    this.#inFlight?.abort();
    this.#inFlight = null;
    this.#latest.supersede();
    this.overview = null;
    this.place = null;
    this.failure = null;
    this.busy = false;
  }

  async run(fetchImpl: typeof fetch, query: string, place: string): Promise<void> {
    const question = query.trim();
    if (question === "") {
      this.clear();
      return;
    }
    this.#inFlight?.abort();
    const controller = new AbortController();
    this.#inFlight = controller;
    const attempt = this.#latest.begin();
    this.busy = true;

    // The overview is one question's, so a second place on the same question does not ask again.
    const keptOverview =
      this.overview !== null && this.overview.query === question && this.overview.records !== null
        ? this.overview
        : null;
    if (keptOverview === null) {
      this.overview = null;
      this.place = null;
    }

    const overviewRead =
      keptOverview === null
        ? Promise.all([
            listMatters(fetchImpl, { scope: "caseload", search: question }),
            readDirectoryNameMatches(fetchImpl, question),
            searchAcrossMatters(fetchImpl, question, {
              sources: [],
              limit: OVERVIEW_LIMIT,
              signal: controller.signal,
            }),
          ])
        : null;
    const placeRead = isRecordPlace(place)
      ? searchAcrossMatters(fetchImpl, question, {
          sources: [place],
          limit: PLACE_LIMIT,
          signal: controller.signal,
        })
      : null;

    const [overviewOutcome, placeOutcome] = await Promise.all([overviewRead, placeRead]);
    // A superseded search says nothing about the screen, whether it was aborted or merely slow.
    if (!attempt.current) return;
    this.busy = false;
    this.#inFlight = null;
    this.failure = null;

    if (overviewOutcome !== null) {
      const [matters, people, records] = overviewOutcome;
      this.overview = {
        query: question,
        matters: mattersGroup(matters),
        people: peopleGroup(people),
        records: records.kind === "ok" ? records.value : null,
      };
      if (records.kind !== "ok") this.failure = this.#stated(records.failure);
    }

    if (placeOutcome === null) {
      this.place = null;
      return;
    }
    if (placeOutcome.kind !== "ok") {
      this.place = null;
      this.failure = this.#stated(placeOutcome.failure);
      return;
    }
    this.place = placeOutcome.value.groups.find((group) => group.source === place) ?? null;
  }

  #stated(failure: StatedFailure["failure"]): StatedFailure {
    // Two sentences, because they say different things: a refusal means the search ran and was
    // turned down, where silence means nothing was searched and the firm may hold a great deal
    // the reader is not being shown.
    return stated(
      failure,
      "The search could not be run.",
      "Nothing answered. The firm's records were not searched.",
    );
  }
}

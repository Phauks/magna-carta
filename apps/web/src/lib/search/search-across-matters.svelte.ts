/*
 * The Search page's state: one question under the reader's filters, asked of every matter they
 * may see.
 *
 * THREE READS, ONE ANSWER. Records (notes, time, costs, invoices, parties, calls, custody packets,
 * file names, the words inside files) come from the search across matters, which answers a group
 * per place. Matters and people are found by name through the reads their own screens already use,
 * the matters listing and the directory's name search, and only where the reader ticked them. This
 * module is the only part that knows the three arrive separately.
 *
 * EVERY PLACE IS ASKED, WHICHEVER ARE TICKED. The ticks decide what the list shows, not what the
 * server is asked, so the panel can count a place the reader has unticked and ticking it back shows
 * its results at once. A change of matters, days or person is a new question and asks again.
 *
 * ONE LIST, NEWEST FIRST. The places answer apart and the page reads them as one list, each record
 * labelled with its place, ordered by the date each place lists by.
 *
 * MATTERS AND PEOPLE HAVE NO DATE AND NO AUTHOR. A search held to some days or to one person does
 * not ask for them, and the panel says why instead of showing nobody. People are not asked under a
 * narrowed choice of matters either, because the directory is the firm's and not divided by matter.
 *
 * NO TOTALS. Every count here is a count of what is on screen, with a "+" where the server measured
 * that there is more. Nothing counts the whole answer, so nothing claims to.
 */
import type { ApiOutcome, Page } from "$lib/api/request.ts";
import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
import type { DirectorySearchHit, DirectorySearchResult } from "$lib/directory/directory-api.ts";
import { readDirectoryNameMatches } from "$lib/directory/directory-search-place.ts";
import { listMatters, type MatterSummary } from "$lib/matters/matters-api.ts";
import {
  emptyGroupLine,
  presentationFor,
  skippedBadge,
} from "$lib/matters/matter-search-presentation.ts";
import { LatestOnly } from "../api/latest-only.ts";
import {
  searchAcrossMatters,
  type AcrossMattersAnswer,
  type AcrossMattersGroup,
  type AcrossMattersHit,
} from "./search-across-matters-api.ts";
import {
  MATTERS_PLACE,
  PEOPLE_PLACE,
  askedKey,
  isNarrowed,
  placeTicked,
  type SearchFilters,
} from "./search-address.ts";

/** How many results each place answers with. */
export const PLACE_LIMIT = 25;

/**
 * How a read by name stands. A refusal is kept apart from a failure because they are different
 * sentences to a reader: one is theirs to raise with an administrator, the other is worth trying
 * again.
 */
export type NameReadStanding =
  | "answered"
  | "no-access"
  | "unavailable"
  /** Not asked: the reader left it unticked, or a filter it cannot be held to is set. */
  | "not-searched";

export interface NameGroup<Row> {
  readonly rows: readonly Row[];
  /** Whether the firm holds more matches than these. Measured by the read, never estimated. */
  readonly more: boolean;
  readonly standing: NameReadStanding;
}

/** One question's answer under one set of filters. */
export interface SearchAnswer {
  readonly query: string;
  /** The filters the question was asked under. */
  readonly filters: SearchFilters;
  readonly matters: NameGroup<MatterSummary>;
  readonly people: NameGroup<DirectorySearchHit>;
  /** Null where the search across matters failed; `failure` on the model says how. */
  readonly records: AcrossMattersAnswer | null;
}

/** A row of the panel's Places list. */
export interface PanelPlace {
  /** The value the address carries in `in`. */
  readonly key: string;
  readonly label: string;
  /** Results this place answered with, or null where it was not searched. */
  readonly shown: number | null;
  /** Whether the place holds more than `shown`. */
  readonly more: boolean;
  /** Where the place was not searched: one or two words for the mark beside its name. */
  readonly mark: string | null;
  /** Why it was not searched, as a sentence a reader can act on. */
  readonly reason: string | null;
  /** Whether the reason is worth writing out under the list, not only on the mark's hover. */
  readonly writtenOut: boolean;
}

/** One record in the list, with the place it came from. */
export interface ListedHit {
  readonly place: string;
  readonly hit: AcrossMattersHit;
}

/** Why a search of some matters does not look for people. */
export const PEOPLE_NOT_SEARCHED_REASON =
  "People and organizations are in the firm's directory, not on matters. Choose every matter to find one by name.";

/** Why a search held to some days or one person does not look for matters or people by name. */
export const NAMES_NOT_FILTERED_REASON =
  "Matters and people are found by name, which has no date and no author. Clear the date and the person to find them.";

/**
 * Why a place asked one matter at a time did not answer, as something a reader can act on. The
 * number is the server's own, from the answer.
 */
export function tooManyMattersLine(label: string, fewMattersLimit: number): string {
  return (
    `${label} is searched when a search reaches ${fewMattersLimit} matters or fewer. ` +
    `Choose fewer matters, or open a matter and use its own search.`
  );
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

const NOT_SEARCHED = { rows: [], more: false, standing: "not-searched" } as const;

/** Whether a filter is set that a name cannot be held to. */
function namesFiltered(filters: SearchFilters): boolean {
  return filters.days !== null || filters.by !== null;
}

/** Whether matters are asked for by name under these filters. */
export function mattersAsked(filters: SearchFilters): boolean {
  return placeTicked(filters, MATTERS_PLACE) && !namesFiltered(filters);
}

/** Whether people are asked for by name under these filters. */
export function peopleAsked(filters: SearchFilters): boolean {
  return (
    placeTicked(filters, PEOPLE_PLACE) && !namesFiltered(filters) && !isNarrowed(filters.reach)
  );
}

/** Why a record place did not answer, or null where it did. */
function recordPlaceSkip(
  group: AcrossMattersGroup,
  label: string,
  fewMattersLimit: number,
): Pick<PanelPlace, "mark" | "reason" | "writtenOut"> | null {
  switch (group.skipped) {
    case null:
    case "query-too-short":
      return null;
    case "one-matter-only":
      return {
        mark: "In A Matter",
        reason: `${label} is searched from inside a matter, with that matter's own search.`,
        writtenOut: false,
      };
    case "permission":
      return {
        mark: "No Access",
        reason: `Your role does not include reading ${label}.`,
        writtenOut: false,
      };
    case "too-many-matters":
      return {
        mark: "Fewer Matters",
        reason: tooManyMattersLine(label, fewMattersLimit),
        writtenOut: true,
      };
    case "no-author":
      return {
        mark: "No Author",
        reason: `${label} does not record who wrote it, so a search for one person leaves it out.`,
        writtenOut: false,
      };
    default:
      // A place whose own index is off, not part of this deployment or not answering, in the words
      // a matter's own search uses for the same thing.
      return {
        mark: skippedBadge(group.skipped),
        reason: emptyGroupLine(group.skipped, group.source),
        writtenOut: true,
      };
  }
}

function namePlace(
  key: string,
  label: string,
  group: NameGroup<unknown>,
  asked: boolean,
  filters: SearchFilters,
): PanelPlace {
  if (!asked && placeTicked(filters, key)) {
    const reason =
      key === PEOPLE_PLACE && !namesFiltered(filters)
        ? PEOPLE_NOT_SEARCHED_REASON
        : NAMES_NOT_FILTERED_REASON;
    return { key, label, shown: null, more: false, mark: "By Name", reason, writtenOut: true };
  }
  return {
    key,
    label,
    shown: group.standing === "answered" ? group.rows.length : null,
    more: group.more,
    mark: null,
    reason: null,
    writtenOut: false,
  };
}

/**
 * The panel's Places list: each record place in the order a matter's own sections read in, then
 * matters and people by name. A place the server did not search carries a mark and the reason.
 */
export function panelPlaces(
  answer: SearchAnswer | null,
  filters: SearchFilters,
): readonly PanelPlace[] {
  if (answer === null) return [];
  const fewMattersLimit = answer.records?.fewMattersLimit ?? 0;
  const records = (answer.records?.groups ?? []).map((group): PanelPlace => {
    const label = presentationFor(group.source).heading;
    const skip = recordPlaceSkip(group, label, fewMattersLimit);
    return {
      key: group.source,
      label,
      shown: skip === null ? group.hits.length : null,
      more: group.hasMore,
      mark: skip?.mark ?? null,
      reason: skip?.reason ?? null,
      writtenOut: skip?.writtenOut ?? false,
    };
  });
  return [
    ...records,
    namePlace(MATTERS_PLACE, "Matters by Name", answer.matters, mattersAsked(filters), filters),
    namePlace(PEOPLE_PLACE, "People by Name", answer.people, peopleAsked(filters), filters),
  ];
}

/**
 * The records of the ticked places as one list, newest first by the date each place lists by. Two
 * records on the same moment keep the order a matter's own sections read in.
 */
export function listedHits(
  answer: SearchAnswer | null,
  filters: SearchFilters,
): readonly ListedHit[] {
  const groups = (answer?.records?.groups ?? []).filter(
    (group) => group.skipped === null && placeTicked(filters, group.source),
  );
  const listed = groups.flatMap((group, order) =>
    group.hits.map((hit) => ({ place: group.source, hit, order })),
  );
  listed.sort((left, right) => {
    if (left.hit.sortKey !== right.hit.sortKey)
      return left.hit.sortKey < right.hit.sortKey ? 1 : -1;
    return left.order - right.order;
  });
  return listed.map(({ place, hit }) => ({ place, hit }));
}

/** Whether a ticked place holds more than it answered with. */
export function tickedPlacesHoldMore(answer: SearchAnswer | null, filters: SearchFilters): boolean {
  return (answer?.records?.groups ?? []).some(
    (group) => group.hasMore && placeTicked(filters, group.source),
  );
}

export class SearchAcrossMatters {
  /** The question last asked, under the filters it was asked with. */
  answer = $state<SearchAnswer | null>(null);
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
    this.answer = null;
    this.failure = null;
    this.busy = false;
  }

  async run(fetchImpl: typeof fetch, query: string, filters: SearchFilters): Promise<void> {
    const question = query.trim();
    if (question === "") {
      this.clear();
      return;
    }
    // The same question under the same matters, days and person keeps what it already read: a
    // different tick asks only for the names it newly needs.
    const kept =
      this.answer !== null &&
      this.answer.query === question &&
      askedKey(this.answer.filters) === askedKey(filters) &&
      this.answer.records !== null
        ? this.answer
        : null;
    const needMatters =
      mattersAsked(filters) && (kept === null || kept.matters.standing === "not-searched");
    const needPeople =
      peopleAsked(filters) && (kept === null || kept.people.standing === "not-searched");
    if (kept !== null && !needMatters && !needPeople) {
      this.answer = { ...kept, filters };
      return;
    }

    this.#inFlight?.abort();
    const controller = new AbortController();
    this.#inFlight = controller;
    const attempt = this.#latest.begin();
    this.busy = true;
    if (kept === null) this.answer = null;

    const reach = filters.reach;
    const [matters, people, records] = await Promise.all([
      // The matters list narrows by the same choices the search does, resolved to the same matters
      // on the server, so the matters named here are the ones searched.
      needMatters
        ? listMatters(fetchImpl, {
            scope: "caseload",
            search: question,
            ...(reach.kind === "mine" ? { mine: true } : {}),
            ...(reach.kind === "client" ? { clientEntityId: reach.entityId } : {}),
          })
        : null,
      needPeople ? readDirectoryNameMatches(fetchImpl, question) : null,
      kept === null
        ? searchAcrossMatters(fetchImpl, question, {
            sources: [],
            limit: PLACE_LIMIT,
            reach,
            days: filters.days,
            by: filters.by,
            signal: controller.signal,
          })
        : null,
    ]);
    // A superseded search says nothing about the screen, whether it was aborted or merely slow.
    if (!attempt.current) return;
    this.busy = false;
    this.#inFlight = null;
    this.failure = null;

    const mattersByName =
      matters === null
        ? (kept?.matters ?? NOT_SEARCHED)
        : reach.kind === "matters"
          ? onChosenMatters(mattersGroup(matters), reach.matterIds)
          : mattersGroup(matters);
    this.answer = {
      query: question,
      filters,
      matters: mattersByName,
      people: people === null ? (kept?.people ?? NOT_SEARCHED) : peopleGroup(people),
      records:
        records === null ? (kept?.records ?? null) : records.kind === "ok" ? records.value : null,
    };
    if (records !== null && records.kind !== "ok") this.failure = this.#stated(records.failure);
  }

  #stated(failure: StatedFailure["failure"]): StatedFailure {
    // Two sentences, because they say different things: a refusal means the search ran and was
    // turned down, where silence means nothing was searched and the firm may hold a great deal
    // the reader is not being shown.
    return stated(
      failure,
      "The search could not be run.",
      "Couldn't connect. The firm's records weren't searched.",
    );
  }
}

/**
 * The matters listing has no "these matters" narrowing, so a search of chosen matters keeps the
 * name matches among them here. The listing already held every row to what the reader may see.
 */
function onChosenMatters(
  group: NameGroup<MatterSummary>,
  matterIds: readonly string[],
): NameGroup<MatterSummary> {
  return { ...group, rows: group.rows.filter((matter) => matterIds.includes(matter.id)) };
}

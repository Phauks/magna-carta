/*
 * The matter search's state, in one place so the panel under the field and the full results page
 * are the same search rather than two that agree by coincidence.
 *
 * It owns the scope, the last answer, and the in-flight request. It does NOT own the query string
 * or the debounce — ScreenSearch owns those, and the results page owns its own field — because a
 * second timer would make the two surfaces disagree about when a search has settled.
 */
import { searchMatter, type MatterSearchAnswer } from "$lib/matters/matter-search-api.ts";
import { matterSections, type MatterSection } from "$lib/matters/sections.ts";

/**
 * A scope the reader can choose. `sources` is what goes on the wire: EMPTY means every source the
 * member may read, which is how "Everything on this matter" is expressed — there is no key meaning
 * "everything", because the vocabulary must never grow a word wider than this matter.
 */
export interface SearchScope {
  /** Stable value for the dropdown. The section slug, or "everything". */
  readonly value: string;
  readonly label: string;
  readonly sources: readonly string[];
  /** A section with no source yet: the option renders disabled carrying this line. */
  readonly waitingOn?: string;
}

export const EVERYTHING_SCOPE = "everything";

function scopeForSection(section: MatterSection): SearchScope {
  if (section.searchSource === null) {
    return {
      value: section.slug,
      label: section.label,
      sources: [],
      waitingOn: section.searchWaitingOn ?? "Not searchable yet",
    };
  }
  return { value: section.slug, label: section.label, sources: [section.searchSource] };
}

/**
 * The scope options, in the order the dropdown shows them: the section the reader is standing on
 * first, then the whole matter, then every other section in the section strip's own order — so the
 * dropdown reads in the same order as the tabs above it.
 *
 * A section that cannot be searched is present and disabled rather than omitted. A reader who
 * cannot find Time in the list learns nothing; one who sees why it is not offered learns exactly
 * where they stand.
 */
export function scopeOptions(current: MatterSection | undefined): readonly SearchScope[] {
  const everything: SearchScope = {
    value: EVERYTHING_SCOPE,
    label: "Everything on this matter",
    sources: [],
  };
  const rest = matterSections
    .filter((section) => section.slug !== current?.slug)
    .map(scopeForSection);
  if (current === undefined) return [everything, ...rest];
  return [
    { ...scopeForSection(current), label: `This section: ${current.label}` },
    everything,
    ...rest,
  ];
}

/**
 * The scope a search opens on: the section the reader is standing on. A section that cannot be
 * searched falls back to the whole matter rather than opening on a disabled option — the control
 * never opens in a state that cannot answer.
 */
export function defaultScope(current: MatterSection | undefined): string {
  if (current === undefined || current.searchSource === null) return EVERYTHING_SCOPE;
  return current.slug;
}

export class MatterSearch {
  matterId = $state("");
  scope = $state(EVERYTHING_SCOPE);
  answer = $state<MatterSearchAnswer | null>(null);
  failure = $state<string | null>(null);
  busy = $state(false);

  /**
   * Every dispatch takes a ticket. An answer that arrives after a newer search started is dropped —
   * which is what makes a slow early request unable to overwrite a later one's results, and is also
   * why an aborted request needs no outcome of its own to be handled.
   */
  #latest = 0;
  #inFlight: AbortController | null = null;

  constructor(matterId: string) {
    this.matterId = matterId;
  }

  sourcesForScope(options: readonly SearchScope[]): readonly string[] {
    return options.find((option) => option.value === this.scope)?.sources ?? [];
  }

  /** Abandons whatever is in flight and clears the answer — the reader emptied the field. */
  clear(): void {
    this.#inFlight?.abort();
    this.#inFlight = null;
    this.#latest += 1;
    this.answer = null;
    this.failure = null;
    this.busy = false;
  }

  async run(
    fetchImpl: typeof fetch,
    query: string,
    sources: readonly string[],
    limit: number,
  ): Promise<void> {
    if (query.trim() === "") {
      this.clear();
      return;
    }
    this.#inFlight?.abort();
    const controller = new AbortController();
    this.#inFlight = controller;
    const ticket = (this.#latest += 1);
    this.busy = true;
    const outcome = await searchMatter(fetchImpl, this.matterId, query, {
      sources,
      limit,
      signal: controller.signal,
    });
    // A superseded search says nothing about the screen, whether it was aborted or merely slow.
    if (ticket !== this.#latest) return;
    this.busy = false;
    this.#inFlight = null;
    if (outcome.kind === "ok") {
      this.answer = outcome.value;
      this.failure = null;
      return;
    }
    this.answer = null;
    this.failure =
      outcome.kind === "transport"
        ? "Nothing answered. The search could not be run."
        : `${outcome.problem.detail ?? "The search could not be run."}${
            outcome.problem.errorId === undefined ? "" : ` Error ID ${outcome.problem.errorId}.`
          }`;
  }
}

/** Total hits across every group that answered — what the field's in-field count would report. */
export function totalHits(answer: MatterSearchAnswer | null): number {
  if (answer === null) return 0;
  return answer.groups.reduce((sum, group) => sum + group.hits.length, 0);
}

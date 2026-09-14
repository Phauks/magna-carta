/*
 * The view state behind one calendar: which view, anchored on which day, over which scope, and the
 * entries the window holds.
 *
 * THE VIEW AND THE ANCHOR BELONG TO THE HOST. They are bindable on the component, so a screen can
 * open on a view, follow the anchor into a Record form, or hand both to a second surface — and the
 * controller therefore reads and writes them through the host rather than holding a copy that would
 * drift from the prop the moment either side wrote first. Everything the host does not own (the
 * Mine/Everyone choice, the entries, the failures, the ceiling) is held here.
 *
 * THE ADDRESS IS A MIRROR, NEVER A DESTINATION. View, date and Mine/Everyone are refinements of the
 * screen the reader is already on, so they are written into the query string with `replaceState`
 * and never navigated to: a `goto` would reload the page and lose the read in flight. Other keys
 * (`entry`, the open record) are left exactly as they were. On start, the address is read first,
 * because an address somebody was handed is a promise about what they will see.
 *
 * A READ IS DISCARDED WHEN IT ARRIVES LATE. Every read carries the generation it started under, and
 * a result that lands after a newer read began is dropped rather than painted over the newer one.
 *
 * "TODAY" IS THE READER'S, resolved once through Intl: the today mark answers where the reader is.
 *
 * THREE REFINEMENTS BEYOND THE VIEW, all on the firm side and all mirrored: whose calendar (Mine,
 * Everyone, or one colleague, which is the same member filter the read already takes), which LAYERS
 * are turned on (the timeline's other date-bearing sources, custody dates first), and whether the
 * agenda hides what is settled. Layers and the hide are refinements of the read and of the
 * painting respectively; neither is a destination.
 */
import { replaceState } from "$app/navigation";
import { page } from "$app/state";
import type { CalendarEntry, EntryContext } from "./calendar-entries.ts";
import { readCalendarWindow, type CalendarReadFailure } from "./calendar-reads.ts";
import {
  isFirmSideScope,
  scopeKey,
  type CalendarScope,
  type ScopeChoice,
} from "./calendar-scope.ts";
import { calendarLayer } from "./calendar-vocabulary.ts";
import {
  anchorFromAddress,
  calendarWindow,
  shiftAnchor,
  todayCivil,
  viewFromAddress,
  windowTitle,
  type CalendarView as CalendarViewKind,
  type CalendarWindow,
  type WeekStart,
  MEMBER_SCOPE_PREFIX,
} from "./calendar-window.ts";

export type { ScopeChoice };

/** The address keys the controller mirrors. */
const VIEW_KEY = "view";
const DATE_KEY = "date";
const SCOPE_KEY = "scope";
const LAYERS_KEY = "layers";
const HIDE_KEY = "hide";
const HIDE_SETTLED = "settled";

/** What an address says about the firm-side refinements, read once on start. */
export interface AddressRefinements {
  /** Mine, Everyone or one colleague, or undefined where the address says nothing about it. */
  readonly scopeChoice: ScopeChoice | undefined;
  /** The colleague named, where the choice is a colleague. */
  readonly memberChoice: string | null;
  /** The layers the address turns on, of those the vocabulary carries. */
  readonly layers: ReadonlySet<string>;
  readonly hideSettled: boolean;
}

/**
 * The refinements an address carries. A `scope` the controller does not know (a colleague with no
 * identifier after the prefix, a word that is neither Mine nor Everyone) says nothing, and a layer
 * the vocabulary does not carry is dropped rather than sent: the read refuses an unknown source
 * key, and a mistyped address is a wrong turn, not a fault.
 */
export function refinementsFromAddress(parameters: URLSearchParams): AddressRefinements {
  const scope = parameters.get(SCOPE_KEY);
  let scopeChoice: ScopeChoice | undefined;
  let memberChoice: string | null = null;
  if (scope === "mine" || scope === "everyone") scopeChoice = scope;
  if (scope !== null && scope.startsWith(MEMBER_SCOPE_PREFIX)) {
    const memberId = scope.slice(MEMBER_SCOPE_PREFIX.length);
    if (memberId !== "") {
      scopeChoice = "member";
      memberChoice = memberId;
    }
  }
  const layers = (parameters.get(LAYERS_KEY) ?? "")
    .split(",")
    .filter((key) => calendarLayer(key) !== undefined);
  return {
    scopeChoice,
    memberChoice,
    layers: new Set(layers),
    hideSettled: parameters.get(HIDE_KEY) === HIDE_SETTLED,
  };
}

/** The view state an address is written from. */
export interface MirroredState {
  readonly view: CalendarViewKind;
  readonly anchor: string;
  /** Whether the scope and the layers are written at all: they are refinements of the firm side only. */
  readonly firmSide: boolean;
  readonly scopeChoice: ScopeChoice;
  readonly memberChoice: string | null;
  readonly layers: ReadonlySet<string>;
  readonly hideSettled: boolean;
}

/**
 * The address with view, date and (on the firm side) scope, layers and the hide written in, and
 * every other key left as it was. A colleague choice with no colleague reads as Everyone, which is
 * the calendar that is actually being read. The given address is never written to.
 */
export function mirroredAddress(current: URL, state: MirroredState): URL {
  const url = new URL(current);
  url.searchParams.set(VIEW_KEY, state.view);
  url.searchParams.set(DATE_KEY, state.anchor);
  if (state.firmSide) {
    url.searchParams.set(
      SCOPE_KEY,
      state.scopeChoice === "member" && state.memberChoice !== null
        ? `${MEMBER_SCOPE_PREFIX}${state.memberChoice}`
        : state.scopeChoice === "member"
          ? "everyone"
          : state.scopeChoice,
    );
    if (state.layers.size > 0) {
      url.searchParams.set(LAYERS_KEY, [...state.layers].toSorted().join(","));
    } else {
      url.searchParams.delete(LAYERS_KEY);
    }
  } else {
    url.searchParams.delete(SCOPE_KEY);
    url.searchParams.delete(LAYERS_KEY);
  }
  if (state.hideSettled) {
    url.searchParams.set(HIDE_KEY, HIDE_SETTLED);
  } else {
    url.searchParams.delete(HIDE_KEY);
  }
  return url;
}

/** What the controller reads from, and writes back to, the component that owns it. */
export interface CalendarHost {
  /** The scope the host embeds the calendar with. */
  scope(): CalendarScope;
  view(): CalendarViewKind;
  setView(view: CalendarViewKind): void;
  anchor(): string;
  setAnchor(anchor: string): void;
  /** Whether view, date and scope are mirrored into the page's query string. */
  address(): boolean;
  /** The day the firm's week begins on. A firm setting, never a personal one. */
  weekStartsOn(): WeekStart;
  /** How many days the agenda spans from its anchor; the default is a fortnight. */
  agendaDays(): number;
  /** The member asking, once the session is known. Mine reads through it. */
  memberId(): string | null;
  /** The names identifiers resolve to. */
  context(): EntryContext;
  /** Whether the context has settled enough for a chip to paint honestly. */
  contextReady(): boolean;
}

/*
 * The entries a term reaches, matched against exactly what the grid PAINTS: the entry's own label
 * and the second line under it, which is where the matter number and the place already are. Nothing
 * else — matching a field the reader cannot see would make a cell appear for a reason with no
 * evidence on screen for it.
 *
 * A plain case-insensitive substring, no stemming and no fuzziness, which is what every other
 * search in this product matches by.
 */
function narrowToSearch(
  entries: readonly CalendarEntry[],
  search: string,
): readonly CalendarEntry[] {
  const term = search.trim().toLowerCase();
  if (term === "") return entries;
  return entries.filter((entry) =>
    `${entry.label} ${entry.detail ?? ""}`.toLowerCase().includes(term),
  );
}

export class CalendarController {
  readonly #host: CalendarHost;
  #generation = 0;

  /** The reader's civil date today, in their own zone. */
  readonly today: string;

  /** Mine, Everyone or one colleague, on the firm side. Meaningless for a matter scope. */
  scopeChoice = $state<ScopeChoice>("everyone");
  /** The colleague chosen, when the choice is `member`. */
  memberChoice = $state<string | null>(null);
  /** The layers turned on over the firm calendar, by key (calendar-vocabulary.ts). */
  layers = $state<ReadonlySet<string>>(new Set());
  /** Whether the agenda leaves out what is settled: cancelled, satisfied, vacated, superseded. */
  hideSettled = $state(false);
  /*
   * What the reader is looking for in the window on screen, as the search control last settled it.
   *
   * IT NARROWS THE WINDOW, and the window is the scope on purpose rather than by omission. A
   * calendar is always a view of some stretch of time — the toolbar's whole job is moving it — and
   * the entries for the stretch on screen are already in the browser, walked by the read plan. So
   * this is a real answer to "which of these is the Henderson hearing", answered as fast as the
   * reader types, with no request.
   *
   * What it is NOT is a search across the record. The horizon on each of the three reads is capped
   * server-side and REFUSED rather than clamped, so asking them for "all time" is not a request
   * that can be made today; a search that spanned the record is its own build on all three, and
   * until it exists this control must not imply it — which is why the surface states the window the
   * count belongs to rather than reporting a bare number of matches.
   */
  search = $state("");
  /** The entries the window holds, or null while they are being read. */
  entries = $state<readonly CalendarEntry[] | null>(null);
  failures = $state<readonly CalendarReadFailure[]>([]);
  /** True when a read hit its page ceiling, so the surface says the answer is the first N. */
  truncated = $state(false);

  constructor(host: CalendarHost) {
    this.#host = host;
    this.today = todayCivil();
    if (host.scope().kind === "mine") this.scopeChoice = "mine";
    if (host.address()) {
      const parameters = page.url.searchParams;
      host.setView(viewFromAddress(parameters.get(VIEW_KEY), host.view()));
      host.setAnchor(anchorFromAddress(parameters.get(DATE_KEY), host.anchor()));
      const refinements = refinementsFromAddress(parameters);
      if (refinements.scopeChoice !== undefined) this.scopeChoice = refinements.scopeChoice;
      this.memberChoice = refinements.memberChoice;
      this.layers = refinements.layers;
      this.hideSettled = refinements.hideSettled;
    }
  }

  get view(): CalendarViewKind {
    return this.#host.view();
  }

  get anchor(): string {
    return this.#host.anchor();
  }

  /** True when the host's scope is the firm's side, where Mine, Everyone, a colleague and the layers are on offer. */
  get firmSide(): boolean {
    return isFirmSideScope(this.#host.scope());
  }

  /**
   * The scope the reads are made with, or null while Mine is wanted and the member is not yet
   * known: reading Everyone in the meantime would paint the wrong calendar and call it the reader's.
   */
  get scope(): CalendarScope | null {
    const hostScope = this.#host.scope();
    if (hostScope.kind === "matter" || hostScope.kind === "resource") return hostScope;
    if (this.scopeChoice === "everyone") return { kind: "firm" };
    if (this.scopeChoice === "member") {
      // A colleague's calendar is the same member filter the reader's own is: what is on THEIR
      // calendar, read under the reader's own visibility.
      return this.memberChoice === null
        ? { kind: "firm" }
        : { kind: "mine", memberId: this.memberChoice };
    }
    const memberId = hostScope.kind === "mine" ? hostScope.memberId : this.#host.memberId();
    return memberId === null ? null : { kind: "mine", memberId };
  }

  /** Why Mine cannot be chosen yet, or undefined when it can. */
  get mineRefusal(): string | undefined {
    const hostScope = this.#host.scope();
    if (hostScope.kind === "mine" || this.#host.memberId() !== null) return undefined;
    return "Reading your session.";
  }

  // The derived fields read the host through a closure: a field initializer runs before the
  // constructor assigns the host, and a derived is only evaluated when something reads it.
  readonly window: CalendarWindow = $derived.by(() =>
    calendarWindow(this.view, this.anchor, this.#host.weekStartsOn(), this.#host.agendaDays()),
  );

  /** The window's own name, as the toolbar reads it. */
  readonly title: string = $derived(windowTitle(this.window));

  /** The day the week's columns begin on: the firm's setting, read through the host. */
  get weekStartsOn(): WeekStart {
    return this.#host.weekStartsOn();
  }

  /** True until the first read of the window lands. */
  get loading(): boolean {
    return this.entries === null;
  }

  readonly entriesById: ReadonlyMap<string, CalendarEntry> = $derived(
    new Map((this.entries ?? []).map((entry) => [entry.id, entry])),
  );

  /**
   * What the grid paints: everything, except that the agenda leaves out settled entries when the
   * reader asked it to. The month and the week keep them (struck where they were called off),
   * because on a grid a thing that was cancelled and a thing that never existed are different facts.
   */
  readonly visibleEntries: readonly CalendarEntry[] | null = $derived.by(() => {
    if (this.entries === null) return null;
    const settledHidden =
      this.view !== "agenda" || !this.hideSettled
        ? this.entries
        : this.entries.filter((entry) => !entry.settled);
    return narrowToSearch(settledHidden, this.search);
  });

  /**
   * How many entries the agenda's hide left out, so the surface can say so.
   *
   * Measured against the settled filter ALONE, not against the search: a search that narrowed forty
   * entries to one would otherwise report thirty-nine "settled entries hidden", which is a sentence
   * about the wrong thing and is false besides.
   */
  readonly hiddenCount: number = $derived.by(() => {
    if (this.entries === null || this.view !== "agenda" || !this.hideSettled) return 0;
    return this.entries.filter((entry) => entry.settled).length;
  });

  /** True while a query is holding entries back, so a surface can say what it is looking at. */
  readonly searching: boolean = $derived(this.search.trim() !== "");

  /**
   * Everything a fresh read depends on, as one string. The component reads it in an effect and
   * re-reads when it changes, so the dependencies of a read are stated here once rather than
   * discovered by whatever the effect happened to touch.
   */
  readonly readKey: string = $derived.by(() =>
    [
      this.scope === null ? "waiting" : scopeKey(this.scope),
      this.window.from,
      this.window.to,
      [...this.layers].toSorted().join(","),
      this.#host.contextReady() ? "ready" : "settling",
    ].join("|"),
  );

  setView(view: CalendarViewKind): void {
    this.#host.setView(view);
  }

  /** One step back or forward: a month, a week, or the agenda's span. */
  navigate(direction: -1 | 1): void {
    this.#host.setAnchor(shiftAnchor(this.view, this.anchor, direction, this.#host.agendaDays()));
  }

  goToday(): void {
    this.#host.setAnchor(this.today);
  }

  /** A day's overflow control opens that day in the agenda. */
  showDay(date: string): void {
    this.#host.setAnchor(date);
    this.#host.setView("agenda");
  }

  chooseScope(choice: ScopeChoice): void {
    this.scopeChoice = choice;
  }

  /** One colleague's calendar; null returns to Everyone. */
  chooseMember(memberId: string | null): void {
    this.memberChoice = memberId;
    this.scopeChoice = memberId === null ? "everyone" : "member";
  }

  toggleLayer(key: string): void {
    if (calendarLayer(key) === undefined) return;
    const next = new Set(this.layers);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.layers = next;
  }

  toggleHideSettled(): void {
    this.hideSettled = !this.hideSettled;
  }

  /**
   * Read the window. `fresh` blanks the grid first, for a window the reader has moved to; `refresh`
   * keeps what is on screen while the same window is read again, for a record that was just written,
   * so nothing flashes under the reader.
   */
  async read(fetchImpl: typeof fetch, mode: "fresh" | "refresh"): Promise<void> {
    this.#generation += 1;
    const generation = this.#generation;
    if (mode === "fresh") {
      // A window the reader moved to starts clean: a notice about the last window's read would
      // stand over this one's skeleton and read as a failure of a read that has not happened.
      this.entries = null;
      this.failures = [];
      this.truncated = false;
    }
    const scope = this.scope;
    if (scope === null || !this.#host.contextReady()) return;
    const result = await readCalendarWindow(fetchImpl, scope, this.window, this.#host.context(), {
      layers: this.layers,
    });
    if (generation !== this.#generation) return;
    this.entries = result.entries;
    this.failures = result.failures;
    this.truncated = result.truncated;
  }

  /** Read the same window again, keeping what is on screen until the answer lands. */
  reload(fetchImpl: typeof fetch): Promise<void> {
    return this.read(fetchImpl, "refresh");
  }

  /**
   * Write view, date and (on the firm side) scope into the query string, leaving every other key
   * as it was. A no-op when the address already says this, so an effect that calls it converges.
   */
  mirrorAddress(): void {
    const url = mirroredAddress(page.url, {
      view: this.view,
      anchor: this.anchor,
      firmSide: this.firmSide,
      scopeChoice: this.scopeChoice,
      memberChoice: this.memberChoice,
      layers: this.layers,
      hideSettled: this.hideSettled,
    });
    if (url.href === page.url.href) return;
    replaceState(url, page.state);
  }
}

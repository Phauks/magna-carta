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
 */
import { replaceState } from "$app/navigation";
import { page } from "$app/state";
import type { CalendarEntry, EntryContext } from "./calendar-entries.ts";
import { readCalendarWindow, type CalendarReadFailure } from "./calendar-reads.ts";
import { scopeKey, type CalendarScope } from "./calendar-scope.ts";
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
} from "./calendar-window.ts";

/** The two halves of the firm-side scope toggle. */
export type ScopeChoice = "everyone" | "mine";

/** The address keys the controller mirrors. */
const VIEW_KEY = "view";
const DATE_KEY = "date";
const SCOPE_KEY = "scope";

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
  /** The member asking, once the session is known. Mine reads through it. */
  memberId(): string | null;
  /** The names identifiers resolve to. */
  context(): EntryContext;
  /** Whether the context has settled enough for a chip to paint honestly. */
  contextReady(): boolean;
}

export class CalendarController {
  readonly #host: CalendarHost;
  #generation = 0;

  /** The reader's civil date today, in their own zone. */
  readonly today: string;

  /** Mine or Everyone, on the firm side. Meaningless for a matter scope. */
  scopeChoice = $state<ScopeChoice>("everyone");
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
      const scope = parameters.get(SCOPE_KEY);
      if (scope === "mine") this.scopeChoice = "mine";
      if (scope === "everyone") this.scopeChoice = "everyone";
    }
  }

  get view(): CalendarViewKind {
    return this.#host.view();
  }

  get anchor(): string {
    return this.#host.anchor();
  }

  /** True when the host's scope is the firm's side, where Mine and Everyone are both on offer. */
  get firmSide(): boolean {
    return this.#host.scope().kind !== "matter";
  }

  /**
   * The scope the reads are made with, or null while Mine is wanted and the member is not yet
   * known: reading Everyone in the meantime would paint the wrong calendar and call it the reader's.
   */
  get scope(): CalendarScope | null {
    const hostScope = this.#host.scope();
    if (hostScope.kind === "matter") return hostScope;
    if (this.scopeChoice === "everyone") return { kind: "firm" };
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
    calendarWindow(this.view, this.anchor, this.#host.weekStartsOn()),
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
   * Everything a fresh read depends on, as one string. The component reads it in an effect and
   * re-reads when it changes, so the dependencies of a read are stated here once rather than
   * discovered by whatever the effect happened to touch.
   */
  readonly readKey: string = $derived.by(() =>
    [
      this.scope === null ? "waiting" : scopeKey(this.scope),
      this.window.from,
      this.window.to,
      this.#host.contextReady() ? "ready" : "settling",
    ].join("|"),
  );

  setView(view: CalendarViewKind): void {
    this.#host.setView(view);
  }

  /** One step back or forward: a month, a week, or a fortnight. */
  navigate(direction: -1 | 1): void {
    this.#host.setAnchor(shiftAnchor(this.view, this.anchor, direction));
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
    const result = await readCalendarWindow(fetchImpl, scope, this.window, this.#host.context());
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
    const url = new URL(page.url);
    url.searchParams.set(VIEW_KEY, this.view);
    url.searchParams.set(DATE_KEY, this.anchor);
    if (this.firmSide) {
      url.searchParams.set(SCOPE_KEY, this.scopeChoice);
    } else {
      url.searchParams.delete(SCOPE_KEY);
    }
    if (url.href === page.url.href) return;
    replaceState(url, page.state);
  }
}

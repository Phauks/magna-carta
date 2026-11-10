/*
 * What every calendar surface on a page needs to know before it can paint or record anything, read
 * once and held.
 *
 * Seven reads, none of them about the calendar's rows: who is asking and what they may do (the
 * session), the event-type catalog (a chip on the firm grid paints a type's NAME from a type CODE,
 * and the record forms choose from it), the firm's roster (a participant is a member handle the
 * grid cannot name without it, and every member is a calendar in the rail), the firm's offices (a
 * firm event is held at one, and an office is an answer the Location field offers), the firm's
 * bookable resources (a room is a calendar in the rail and another answer that field offers), the
 * firm's matters (a chip paints a matter NUMBER from a matter identifier), and the firm's calendar
 * settings (which day its week begins on, so every grid on the page draws the same week). Each
 * changes at the pace of a working week, so re-reading any of them per navigation would spend a
 * round trip to learn nothing.
 *
 * ONE INSTANCE, LOADED ON FIRST USE. The calendar component and the screen that embeds it both
 * reach for the same instance, so the screen's Record menu and the grid's chips agree about the
 * catalog; the first caller does the work and the rest await it. The matters walk is the Time
 * Sheet's own (firm-matters.svelte.ts), reused rather than written a second time.
 *
 * THE READS FAIL INDEPENDENTLY, AND A FAILURE IS A FACT THE SURFACE STATES. A catalog that could not
 * be read leaves the grid painting "Event" for every setting, which is honest; a session that could
 * not be read leaves every write refused, which is also honest. Each failure is held whole so the
 * surface can render it with its Error ID rather than a sentence squeezed out of it.
 */
import type { Failure } from "$lib/api/request.ts";
import { listFirmMembers, type FirmMemberSummary } from "$lib/members/members-api.ts";
import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
import { listOffices, type OfficeSummary } from "$lib/offices/offices-api.ts";
import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
import {
  listEventTypes,
  listResources,
  readCalendarSettings,
  readerTimeZone,
  type EventType,
  type FirmResource,
  type WeekStartsOn,
} from "./calendar-api.ts";
import { mayManageCalendar } from "./calendar-permission.ts";
import type { EntryContext } from "./calendar-entries.ts";
import { eventTypesByCode } from "./calendar-vocabulary.ts";
import { todayCivil } from "./calendar-window.ts";
import { readHasOwnAccountCalendars } from "./own-account-events.ts";

export class CalendarContext {
  session = $state<SessionBootstrap | null>(null);
  sessionFailure = $state<Failure | null>(null);
  eventTypes = $state<readonly EventType[]>([]);
  eventTypesFailure = $state<Failure | null>(null);
  members = $state<readonly FirmMemberSummary[]>([]);
  membersFailure = $state<Failure | null>(null);
  /*
   * The firm's offices, WHOLE — addresses included — rather than the matters API's summary of them.
   * Same endpoint, wider reading: the Location field offers an office by its street address, so a
   * hearing recorded "at the North Office" carries where that is (owner, 2026-09-18).
   */
  locations = $state<readonly OfficeSummary[]>([]);
  locationsFailure = $state<Failure | null>(null);
  /** The firm's bookable things: every room is a calendar the rail offers and a place to meet. */
  /**
   * Whether the reader chose any of their own account's calendars to be shown. False until the
   * read answers and where it fails, so the rail never lists a calendar with nothing behind it.
   */
  hasOwnAccountCalendars = $state(false);
  resources = $state<readonly FirmResource[]>([]);
  resourcesFailure = $state<Failure | null>(null);
  /**
   * The day the firm's week begins on. Sunday until the firm's own answer arrives, and Sunday where
   * that read fails: a grid that draws the default week is still a grid, and the failure is stated
   * beside it rather than blocking every calendar on the page.
   */
  weekStartsOn = $state<WeekStartsOn>(0);
  settingsFailure = $state<Failure | null>(null);
  /** The firm's matters, walked once and held for the session. */
  readonly firmMatters = new FirmMatters();

  /** The reader's own zone, resolved once: a wall-clock time shows its zone only where it differs. */
  readonly readerTimeZone: string = readerTimeZone();

  /** Which reads have answered, whether or not they succeeded. */
  #settled = $state({
    session: false,
    eventTypes: false,
    members: false,
    locations: false,
    resources: false,
    settings: false,
  });
  #inFlight: Promise<void> | null = null;

  /** The member asking, once the session is known. */
  get memberId(): string | null {
    return this.session?.user.id ?? null;
  }

  /** Whether this account may record, change, cancel and settle calendar records. */
  get mayManage(): boolean {
    return mayManageCalendar(this.session);
  }

  /** Whether the session read has answered, so a refusal can say "not held" rather than "reading". */
  get sessionSettled(): boolean {
    return this.#settled.session;
  }

  get matters(): readonly SheetMatter[] {
    return this.firmMatters.matters ?? [];
  }

  /**
   * Whether the firm's matters are still being read.
   *
   * The grid no longer waits for them, so a record form can open before they land — and an empty
   * picker saying "No matters were read" then states something false. This is the difference
   * between the two, and the picker words itself from it.
   */
  get mattersReading(): boolean {
    return this.firmMatters.matters === null;
  }

  /** Whether the matters list is a page of the record rather than all of it. */
  get mattersCapped(): boolean {
    return this.firmMatters.capped;
  }

  /** What to say when the matters could not be read; null while it is fine or still in flight. */
  get mattersFailure(): string | null {
    return this.firmMatters.failure;
  }

  /**
   * Whether the grid can paint honestly: the catalog and the week start have answered (or failed),
   * so a chip's type name will not change under the reader a moment after it paints and the week's
   * columns will not shift once the firm's answer lands.
   *
   * THE FIRM'S MATTERS ARE DELIBERATELY NOT PART OF THIS, and taking them out is the whole of why
   * the calendar opens quickly. They used to be: the read plan refuses to issue anything until this
   * is true, so the grid stayed blank until every page of the firm's matter listing had come back —
   * a walk of up to ten pages, each of them two requests, run one after another. That made the time
   * to first paint scale with how many matters the firm has ever opened, which is the wrong thing
   * for it to scale with and gets worse every year a firm uses the product.
   *
   * What the walk contributes to the grid is a matter NUMBER on a chip, which is the one thing on a
   * chip that does not come back with its own row. So it is filled in afterwards instead
   * (`numbered` in calendar-entries.ts), and the two facts a chip CANNOT be painted without — what
   * kind of thing it is, and which seven days the week holds — are what this still waits for. Those
   * are two parallel reads of fixed size, not a walk.
   */
  get ready(): boolean {
    return this.#settled.eventTypes && this.#settled.settings;
  }

  /**
   * The settings page saved a new week start. Told here so a calendar opened later in the same
   * session draws the firm's week without a reload; the page's own read stays the record.
   */
  noteWeekStartsOn(weekStartsOn: WeekStartsOn): void {
    this.weekStartsOn = weekStartsOn;
  }

  readonly matterNumbers: ReadonlyMap<string, string> = $derived.by(() => {
    const numbers = new Map<string, string>();
    for (const matter of this.matters) {
      // An unnumbered matter (a consultation) paints its title rather than nothing at all.
      numbers.set(matter.id, matter.matterNumber ?? matter.title);
    }
    return numbers;
  });

  readonly eventTypesByCode: ReadonlyMap<string, EventType> = $derived(
    eventTypesByCode(this.eventTypes),
  );

  /** What the projection needs beyond a row: the names identifiers resolve to. */
  readonly entryContext: EntryContext = $derived({
    matterNumbers: this.matterNumbers,
    eventTypesByCode: this.eventTypesByCode,
    readerTimeZone: this.readerTimeZone,
  });

  /** The type behind an identifier, where the catalog knows it. */
  eventTypeById(eventTypeId: string | null): EventType | undefined {
    if (eventTypeId === null) return undefined;
    return this.eventTypes.find((type) => type.id === eventTypeId);
  }

  /** A member's display name, where the roster knows them; the handle otherwise. */
  memberName(userId: string): string {
    return this.members.find((member) => member.userId === userId)?.displayName ?? userId;
  }

  /** An office's name, where the firm's locations know it. */
  locationName(locationId: string | null): string | null {
    if (locationId === null) return null;
    return this.locations.find((location) => location.id === locationId)?.name ?? null;
  }

  /**
   * Read everything, at most once. Safe to call from an effect: the first call does the work, the
   * rest await it, and a call after it has landed is a no-op.
   */
  async load(fetchImpl: typeof fetch): Promise<void> {
    this.#inFlight ??= this.#read(fetchImpl);
    await this.#inFlight;
  }

  /**
   * Ask again. `load` is single-flight for the life of the context so every host mounting on the
   * same page shares one read; a Retry after a failed read is a different request, and this is the
   * one path that makes it. A read still in flight is awaited rather than doubled.
   */
  async reload(fetchImpl: typeof fetch): Promise<void> {
    if (this.#inFlight !== null) {
      await this.#inFlight;
    }
    this.#inFlight = this.#read(fetchImpl);
    await this.#inFlight;
  }

  async #readOwnAccount(): Promise<void> {
    this.hasOwnAccountCalendars = await readHasOwnAccountCalendars(todayCivil());
  }

  async #read(fetchImpl: typeof fetch): Promise<void> {
    await Promise.all([
      this.#readOwnAccount(),
      this.#readSession(fetchImpl),
      this.#readEventTypes(fetchImpl),
      this.#readMembers(fetchImpl),
      this.#readLocations(fetchImpl),
      this.#readResources(fetchImpl),
      this.#readSettings(fetchImpl),
      this.firmMatters.load(fetchImpl),
    ]);
  }

  async #readSettings(fetchImpl: typeof fetch): Promise<void> {
    const outcome = await readCalendarSettings(fetchImpl);
    if (outcome.kind === "ok") {
      this.weekStartsOn = outcome.value.weekStartsOn;
      this.settingsFailure = null;
    } else {
      this.settingsFailure = outcome.failure;
    }
    this.#settled.settings = true;
  }

  async #readSession(fetchImpl: typeof fetch): Promise<void> {
    const outcome = await readSession(fetchImpl);
    if (outcome.kind === "ok") {
      this.session = outcome.value;
      this.sessionFailure = null;
    } else {
      this.sessionFailure = outcome.failure;
    }
    this.#settled.session = true;
  }

  async #readEventTypes(fetchImpl: typeof fetch): Promise<void> {
    const outcome = await listEventTypes(fetchImpl);
    if (outcome.kind === "ok") {
      this.eventTypes = outcome.value.data;
      this.eventTypesFailure = null;
    } else {
      this.eventTypesFailure = outcome.failure;
    }
    this.#settled.eventTypes = true;
  }

  async #readMembers(fetchImpl: typeof fetch): Promise<void> {
    const outcome = await listFirmMembers(fetchImpl);
    if (outcome.kind === "ok") {
      this.members = outcome.value.data;
      this.membersFailure = null;
    } else {
      this.membersFailure = outcome.failure;
    }
    this.#settled.members = true;
  }

  async #readResources(fetchImpl: typeof fetch): Promise<void> {
    const outcome = await listResources(fetchImpl);
    if (outcome.kind === "ok") {
      this.resources = outcome.value.data;
      this.resourcesFailure = null;
    } else {
      this.resourcesFailure = outcome.failure;
    }
    this.#settled.resources = true;
  }

  async #readLocations(fetchImpl: typeof fetch): Promise<void> {
    const outcome = await listOffices(fetchImpl);
    if (outcome.kind === "ok") {
      this.locations = outcome.value.data;
      this.locationsFailure = null;
    } else {
      this.locationsFailure = outcome.failure;
    }
    this.#settled.locations = true;
  }
}

/** The page's one context. The first surface to need it loads it; every other one shares it. */
export const calendarContext = new CalendarContext();

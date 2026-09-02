/*
 * What every calendar surface on a page needs to know before it can paint or record anything, read
 * once and held.
 *
 * Five reads, none of them about the calendar's rows: who is asking and what they may do (the
 * session), the event-type catalog (a chip on the firm grid paints a type's NAME from a type CODE,
 * and the record forms choose from it), the firm's roster (a participant is a member handle the
 * grid cannot name without it), the firm's offices (a firm event is held at one), and the firm's
 * matters (a chip paints a matter NUMBER from a matter identifier). Each changes at the pace of a
 * working week, so re-reading any of them per navigation would spend a round trip to learn nothing.
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
import {
  listLocations,
  readSession,
  type LocationSummary,
  type SessionBootstrap,
} from "$lib/matters/matters-api.ts";
import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
import {
  listEventTypes,
  MANAGE_CALENDAR_PERMISSION,
  readerTimeZone,
  type EventType,
} from "./calendar-api.ts";
import type { EntryContext } from "./calendar-entries.ts";
import { eventTypesByCode } from "./calendar-vocabulary.ts";

export class CalendarContext {
  session = $state<SessionBootstrap | null>(null);
  sessionFailure = $state<Failure | null>(null);
  eventTypes = $state<readonly EventType[]>([]);
  eventTypesFailure = $state<Failure | null>(null);
  members = $state<readonly FirmMemberSummary[]>([]);
  membersFailure = $state<Failure | null>(null);
  locations = $state<readonly LocationSummary[]>([]);
  locationsFailure = $state<Failure | null>(null);
  /** The firm's matters, walked once and held for the session. */
  readonly firmMatters = new FirmMatters();

  /** The reader's own zone, resolved once: a wall-clock time shows its zone only where it differs. */
  readonly readerTimeZone: string = readerTimeZone();

  /** Which reads have answered, whether or not they succeeded. */
  #settled = $state({ session: false, eventTypes: false, members: false, locations: false });
  #inFlight: Promise<void> | null = null;

  /** The member asking, once the session is known. */
  get memberId(): string | null {
    return this.session?.user.id ?? null;
  }

  /** Whether this account may record, change, cancel and settle calendar records. */
  get mayManage(): boolean {
    return this.session?.permissions.includes(MANAGE_CALENDAR_PERMISSION) ?? false;
  }

  /** Whether the session read has answered, so a refusal can say "not held" rather than "reading". */
  get sessionSettled(): boolean {
    return this.#settled.session;
  }

  get matters(): readonly SheetMatter[] {
    return this.firmMatters.matters ?? [];
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
   * Whether the grid can paint honestly: the catalog and the matters have answered (or failed), so
   * a chip's type name and matter number will not change under the reader a moment after it paints.
   */
  get ready(): boolean {
    return this.#settled.eventTypes && this.firmMatters.matters !== null;
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

  async #read(fetchImpl: typeof fetch): Promise<void> {
    await Promise.all([
      this.#readSession(fetchImpl),
      this.#readEventTypes(fetchImpl),
      this.#readMembers(fetchImpl),
      this.#readLocations(fetchImpl),
      this.firmMatters.load(fetchImpl),
    ]);
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

  async #readLocations(fetchImpl: typeof fetch): Promise<void> {
    const outcome = await listLocations(fetchImpl);
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

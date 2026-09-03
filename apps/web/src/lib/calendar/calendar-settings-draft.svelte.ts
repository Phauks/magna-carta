/*
 * The firm's calendar settings as a draft the settings page can stage and save — server-backed,
 * where every other draft on the settings surface is still local storage.
 *
 * The settings pages share one anatomy: a row renders a definition through a draft, the footer
 * counts what is staged and commits it, the masthead reads the same draft. That anatomy is typed
 * on `SettingsDraft`, whose committed values are a per-browser store. A FIRM setting with a server
 * behind it cannot keep a per-browser copy that can disagree with the firm, so this draft keeps the
 * shape the rows and the footer already understand and answers every question from the one read
 * it made of `GET /api/v1/calendar/settings`; a save is `PATCH` on the same route, audited there,
 * and the value in force is whatever the server said back.
 *
 * A SAVE THAT FAILS KEEPS THE STAGE. The member's choice is still on screen with the failure and
 * its Error ID beside it, and Save tries again under a fresh idempotency key; discarding it is the
 * member's call, never the failure's.
 *
 * NOTHING IS WRITTEN TO THE PER-BROWSER LEDGER. The other draft pages append a history entry to
 * local storage on save; for a firm setting that history would be one browser's recollection of a
 * firm-wide fact, silent about every change a colleague made. The record is the audit row the
 * server writes with the change; the page shows history once a per-record audit read exists.
 */
import type { Failure } from "$lib/api/request.ts";
import type { SettingDefinition, SettingValue } from "$lib/settings/settings-definitions.ts";
import { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
import {
  readCalendarSettings,
  updateCalendarSettings,
  type CalendarSettings,
  type WeekStartsOn,
} from "./calendar-api.ts";
import { calendarContext } from "./calendar-context.svelte.ts";

/** The settings section this draft belongs to (settings-sections.ts). */
export const CALENDAR_SETTINGS_SECTION_ID = "calendar";

/**
 * The one definition today. A select over the two starts practice uses, carried as the strings a
 * select control binds to; the wire value is the number behind them.
 */
export const WEEK_STARTS_ON_DEFINITION: SettingDefinition = {
  id: "calendar.week-starts-on",
  sectionId: CALENDAR_SETTINGS_SECTION_ID,
  plateLabel: "The Week",
  label: "First Day of the Week",
  description: "The day every calendar in the firm begins its week on.",
  kind: "select",
  options: [
    { value: "0", label: "Sunday" },
    { value: "1", label: "Monday" },
  ],
  defaultValue: "0",
  sensitivity: "open",
  audited: true,
};

/** The wire value a select choice stands for; null for a string the vocabulary does not carry. */
export function weekStartsOnFromValue(value: SettingValue): WeekStartsOn | null {
  if (value === "0") return 0;
  if (value === "1") return 1;
  return null;
}

function valueOf(weekStartsOn: WeekStartsOn): SettingValue {
  return String(weekStartsOn);
}

export class CalendarSettingsDraft extends SettingsDraft {
  /** What the server said the firm's settings are; null until the read lands. */
  committed = $state<CalendarSettings | null>(null);
  readFailure = $state<Failure | null>(null);
  /** The staged week start, held only while it differs from the committed one. */
  #stagedWeekStartsOn = $state<WeekStartsOn | null>(null);
  saving = $state(false);
  saveFailure = $state<Failure | null>(null);
  #fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch) {
    super(CALENDAR_SETTINGS_SECTION_ID);
    this.#fetchImpl = fetchImpl;
  }

  /** Whether the read has answered with a value. The page renders its rows only once it has. */
  get loaded(): boolean {
    return this.committed !== null;
  }

  async load(): Promise<void> {
    const outcome = await readCalendarSettings(this.#fetchImpl);
    if (outcome.kind === "ok") {
      this.committed = outcome.value;
      this.readFailure = null;
    } else {
      this.readFailure = outcome.failure;
    }
  }

  #committedWeekStartsOn(): WeekStartsOn {
    return this.committed?.weekStartsOn ?? 0;
  }

  override value(definition: SettingDefinition): SettingValue {
    if (definition.id !== WEEK_STARTS_ON_DEFINITION.id) return definition.defaultValue;
    return valueOf(this.#committedWeekStartsOn());
  }

  override stagedValue(definition: SettingDefinition): SettingValue {
    if (definition.id !== WEEK_STARTS_ON_DEFINITION.id) return definition.defaultValue;
    return valueOf(this.#stagedWeekStartsOn ?? this.#committedWeekStartsOn());
  }

  override stage(definition: SettingDefinition, next: SettingValue): void {
    if (definition.id !== WEEK_STARTS_ON_DEFINITION.id) return;
    const weekStartsOn = weekStartsOnFromValue(next);
    // A value the vocabulary does not carry, or the committed value staged back, is no change.
    if (weekStartsOn === null || weekStartsOn === this.#committedWeekStartsOn()) {
      this.#stagedWeekStartsOn = null;
      return;
    }
    this.#stagedWeekStartsOn = weekStartsOn;
  }

  override isStaged(definition: SettingDefinition): boolean {
    return definition.id === WEEK_STARTS_ON_DEFINITION.id && this.#stagedWeekStartsOn !== null;
  }

  override get stagedCount(): number {
    return this.#stagedWeekStartsOn === null ? 0 : 1;
  }

  override get stagedEntries(): ReadonlyArray<{
    definition: SettingDefinition;
    from: SettingValue;
    to: SettingValue;
  }> {
    if (this.#stagedWeekStartsOn === null) return [];
    return [
      {
        definition: WEEK_STARTS_ON_DEFINITION,
        from: valueOf(this.#committedWeekStartsOn()),
        to: valueOf(this.#stagedWeekStartsOn),
      },
    ];
  }

  override get requiresConfirm(): boolean {
    return false;
  }

  override discard(): void {
    this.#stagedWeekStartsOn = null;
    this.saveFailure = null;
  }

  /**
   * The footer calls this without awaiting it, as it does every draft's save; the outcome lands on
   * `saving` and `saveFailure`, which the page renders. `commit()` is the awaitable form.
   */
  override save(): void {
    void this.commit();
  }

  async commit(): Promise<void> {
    const weekStartsOn = this.#stagedWeekStartsOn;
    if (weekStartsOn === null || this.saving) return;
    this.saving = true;
    this.saveFailure = null;
    // One key per attempt: a retry after a failure is a new attempt, and a duplicate of a landed
    // one is what the key on the server catches.
    const outcome = await updateCalendarSettings(
      this.#fetchImpl,
      { weekStartsOn },
      crypto.randomUUID(),
    );
    this.saving = false;
    if (outcome.kind !== "ok") {
      this.saveFailure = outcome.failure;
      return;
    }
    this.committed = outcome.value;
    this.#stagedWeekStartsOn = null;
    calendarContext.noteWeekStartsOn(outcome.value.weekStartsOn);
  }
}

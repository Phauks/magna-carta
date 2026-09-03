<script lang="ts">
  /*
   * A calendar entry, opened.
   *
   * The window is the product's one record window: the left pane is the record — dense,
   * top-aligned, the changeable facts — and the right pane is the context somebody goes looking for
   * beside it. Nothing about that shape is decided here; this file contributes the field list, the
   * tab set and the action bar for the three kinds of record a calendar holds, which is the whole
   * of what a record kind is allowed to contribute.
   *
   * THREE KINDS, ONE WINDOW. A setting on a matter, a deadline and a firm event open here, each
   * fetched by its own read when the window opens, so the firm grid — which paints kinds and matter
   * numbers and never titles — costs one request for the ONE row somebody pressed. The record pane
   * renders the kind's own fields; the tabs (who is at it, what it is linked to, its history) and
   * the action bar (the verbs the kind's state allows) are shaped by the kind but placed by the
   * shell.
   *
   * CHANGING A RECORD HAPPENS IN THIS WINDOW. Edit raises the shell's own mode, the ONE pane below
   * renders either the values or the fields in the same geometry, and the commit is the shell's.
   * What this file supplies is the drafts, the handlers, and the honest answer to whether walking
   * away would lose anything. A refused commit stays in editing with the refusal in the pane; a
   * landed one lowers the mode, tells the host, and re-reads the record so the pane shows what the
   * server now holds rather than what was typed.
   *
   * EVERY VERB IS AN ACT ASKED FOR IN THE ONE PANEL. Cancel, Continue, Satisfy and Vacate each open
   * an ActionDialog over their own write; Supersede opens the deadline form with this deadline as
   * the one being replaced. A verb the state refuses is drawn disabled with its reason, never
   * removed, so the action bar's geometry never changes under the reader.
   *
   * A DEADLINE HAS NO READ OF ITS OWN. It is read through the matter and the day the grid already
   * knows; a deadline reached by an address alone cannot be, and the pane says so in one sentence
   * rather than reading a matter's whole record to find it.
   */
  import { parseDate, type CalendarDate } from "@internationalized/date";
  import { untrack } from "svelte";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import {
    formatCivilDateLong,
    parseCivilDate,
  } from "@magna-carta/design-system/calendar-grid";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { formatInstant, placeholderOf } from "@magna-carta/design-system/formatters";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import * as Select from "@magna-carta/design-system/select";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Textarea from "@magna-carta/design-system/textarea";
  import type { ApiOutcome, Failure } from "$lib/api/request.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { MaturityBadge } from "@magna-carta/design-system/maturity";
  import {
    cancelFirmEvent,
    cancelMatterEvent,
    continueMatterEvent,
    deadlineStateLabel,
    deadlineTone,
    eventStatusLabel,
    eventStatusTone,
    firmEventAudienceLabel,
    formatWallClock,
    listDeadlines,
    readFirmEvent,
    readMatterEvent,
    satisfyDeadline,
    updateDeadline,
    updateFirmEvent,
    updateMatterEvent,
    vacateDeadline,
    type Acknowledged,
    type CalendarDeadline,
    type ContinuanceDeadlineReference,
    type ContinueEventRequest,
    type CreateDeadlineRequest,
    type CreateEventRequest,
    type CreateFirmEventRequest,
    type DeadlineState,
    type EventParticipant,
    type EventStatus,
    type UpdateDeadlineRequest,
    type UpdateEventRequest,
    type UpdateFirmEventRequest,
    createBooking,
    deleteBooking,
    listEventBookings,
    listResources,
    resourceKindLabel,
    type EventBooking,
    type FirmResource,
  } from "./calendar-api.ts";
  import type { CalendarContext } from "./calendar-context.svelte.ts";
  import {
    deadlineDraftFrom,
    deadlineDraftRequest,
    deadlineDraftShortfalls,
    deadlineDraftStarted,
    deadlineSourceLabel,
    DEADLINE_PRIORITY_MAX,
    type DeadlineDraft,
  } from "./deadline-draft.ts";
  import { entrySheet } from "./entry-print-sheet.ts";
  import {
    entryRecordDate,
    entryRecordMatterId,
    entryRecordTitle,
    entryReferenceKey,
    type EntryRecord,
    type EntryReference,
    type EntryReferenceKind,
  } from "./entry-reference.ts";
  import {
    eventDraftFrom,
    eventDraftRequest,
    eventDraftShortfalls,
    eventDraftStarted,
    timingShortfalls,
    type EventDraft,
    type EventTimingDraft,
  } from "./event-draft.ts";
  import {
    firmEventDraftFrom,
    firmEventDraftRequest,
    firmEventDraftShortfalls,
    firmEventDraftStarted,
    type FirmEventDraft,
  } from "./firm-event-draft.ts";
  import RecordDeadlineDialog from "./record-deadline-dialog.svelte";
  import { timeZoneOptions } from "./time-zone-options.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  let {
    open = $bindable(false),
    reference = null,
    deadline = null,
    context,
    onChanged,
  }: {
    open?: boolean;
    /** Which record the window is on. Null draws an empty window; the host opens it on a record. */
    reference?: EntryReference | null;
    /**
     * The deadline row, where the host already holds it. There is no single-deadline read, so a
     * host that has the row spares the window a listing; one that does not hands over the matter
     * and the day on the reference and the window reads the deadline through them.
     */
    deadline?: CalendarDeadline | null;
    context: CalendarContext;
    /** Fired after any write lands, so the host re-reads what it paints. */
    onChanged: () => void;
  } = $props();

  // ---- which record, and the record itself ----------------------------------------------------

  /*
   * The record on screen. It starts as the host's reference and moves when the reader follows a
   * link in the Links tab to a neighbouring setting, which re-opens this same window on the other
   * record rather than opening a second one.
   */
  let current = $state<EntryReference | null>(null);
  $effect(() => {
    current = reference;
  });

  let record = $state<EntryRecord | null>(null);
  let reading = $state(false);
  let readFailure = $state<StatedFailure | null>(null);
  /** A deadline the window has no way to read: no matter and no day to read it through. */
  let unreachableDeadline = $state(false);
  let editing = $state(false);
  let readGeneration = 0;
  let loadedKey: string | null = null;

  $effect(() => {
    if (!open) {
      loadedKey = null;
      record = null;
      readFailure = null;
      unreachableDeadline = false;
      return;
    }
    const target = current;
    const key = target === null ? null : entryReferenceKey(target);
    if (target === null || key === loadedKey) return;
    loadedKey = key;
    untrack(() => void readRecord(target));
  });

  async function readRecord(target: EntryReference): Promise<void> {
    readGeneration += 1;
    const generation = readGeneration;
    record = null;
    readFailure = null;
    unreachableDeadline = false;
    editing = false;
    saveFailure = null;
    reading = true;

    let next: EntryRecord | null = null;
    let failure: Failure | null = null;
    let unreachable = false;

    switch (target.kind) {
      case "event": {
        const outcome = await readMatterEvent(fetch, target.recordId);
        if (outcome.kind === "ok") {
          next = {
            kind: "event",
            event: outcome.value.event,
            participants: outcome.value.participants,
          };
        } else {
          failure = outcome.failure;
        }
        break;
      }
      case "firmEvent": {
        const outcome = await readFirmEvent(fetch, target.recordId);
        if (outcome.kind === "ok") {
          next = {
            kind: "firmEvent",
            event: outcome.value.event,
            participants: outcome.value.participants,
          };
        } else {
          failure = outcome.failure;
        }
        break;
      }
      case "deadline": {
        const held = deadline;
        if (held !== null && held.id === target.recordId) {
          next = { kind: "deadline", deadline: held };
          break;
        }
        const matterId = target.matterId ?? null;
        if (matterId === null || target.date === undefined) {
          unreachable = true;
          break;
        }
        const outcome = await listDeadlines(fetch, {
          matterId,
          from: target.date,
          through: target.date,
        });
        if (outcome.kind !== "ok") {
          failure = outcome.failure;
          break;
        }
        const found = outcome.value.data.find((row) => row.id === target.recordId);
        if (found === undefined) {
          unreachable = true;
        } else {
          next = { kind: "deadline", deadline: found };
        }
        break;
      }
    }

    if (generation !== readGeneration) return;
    record = next;
    unreachableDeadline = unreachable;
    void readBookings(next);
    readFailure = failure === null ? null : stated(failure, "The record could not be read.");
    reading = false;
    seedDrafts();
  }

  function reread(): void {
    const target = current;
    if (target !== null) void readRecord(target);
  }

  /** Re-open this window on a neighbouring setting. */
  function openEvent(eventId: string): void {
    current = { kind: "event", recordId: eventId };
  }

  // ---- the rooms an event has booked ------------------------------------------------------------
  //
  // A booking belongs to exactly one event, so the event's window is where its rooms are read and
  // booked. The catalog is read once per window, lazily, because a deadline never books anything.

  let bookings = $state<readonly EventBooking[] | null>(null);
  let bookingsFailure = $state<StatedFailure | null>(null);
  let resources = $state<readonly FirmResource[] | null>(null);
  let bookingsGeneration = 0;

  async function readBookings(target: EntryRecord | null): Promise<void> {
    bookingsGeneration += 1;
    const generation = bookingsGeneration;
    bookings = null;
    bookingsFailure = null;
    if (target === null || target.kind === "deadline") return;
    const event = { kind: target.kind === "event" ? "matterEvent" : "firmEvent", id: target.event.id } as const;
    const [outcome] = await Promise.all([listEventBookings(fetch, event), readResources()]);
    if (generation !== bookingsGeneration) return;
    if (outcome.kind === "ok") {
      bookings = outcome.value.data;
    } else {
      bookingsFailure = stated(outcome.failure, "The event's bookings could not be read.");
    }
  }

  async function readResources(): Promise<void> {
    if (resources !== null) return;
    const outcome = await listResources(fetch, true);
    if (outcome.kind === "ok") resources = outcome.value.data;
  }

  function resourceName(resourceId: string): string {
    const resource = resources?.find((candidate) => candidate.id === resourceId);
    return resource === undefined ? "A resource" : `${resource.name} · ${resourceKindLabel(resource.kind)}`;
  }

  const bookingCount = $derived(bookings?.length ?? 0);

  let bookOpen = $state(false);
  let bookResourceId = $state("");
  let bookFailure = $state<StatedFailure | null>(null);
  let bookConflicts = $state(0);
  let bookAttemptKey: string | null = null;

  const bookableResources = $derived(
    (resources ?? [])
      .filter((resource) => resource.active)
      .map((resource) => ({ value: resource.id, label: `${resource.name} · ${resourceKindLabel(resource.kind)}` })),
  );
  const bookRefusal = $derived(
    bookResourceId === "" ? "Choose what to book." : undefined,
  );

  function openBook(): void {
    bookResourceId = "";
    bookFailure = null;
    bookConflicts = 0;
    bookAttemptKey = null;
    verbFailure = null;
    bookOpen = true;
  }

  /*
   * The booking takes the event's own window: the room is busy because the event is happening in
   * it. A booking that double-books LANDS and says so; refusing would make the platform referee
   * rooms it does not own, and must never be why a hearing cannot be recorded.
   */
  async function commitBook(): Promise<ActionOutcome> {
    if (record === null || record.kind === "deadline" || bookResourceId === "") return "refused";
    bookFailure = null;
    bookAttemptKey ??= crypto.randomUUID();
    const outcome = await createBooking(
      fetch,
      record.kind === "event"
        ? { resourceId: bookResourceId, matterEventId: record.event.id }
        : { resourceId: bookResourceId, firmEventId: record.event.id },
      bookAttemptKey,
    );
    if (outcome.kind === "ok") {
      bookAttemptKey = null;
      bookConflicts = outcome.value.conflicts.length;
      void readBookings(record);
      onChanged();
      return "committed";
    }
    if (outcome.kind === "problem") bookAttemptKey = null;
    bookFailure = stated(
      outcome.failure,
      "The booking was not made.",
      "Nothing answered. The booking was not made, so pressing again makes it once.",
    );
    return "refused";
  }

  async function releaseBooking(bookingId: string): Promise<void> {
    if (record === null) return;
    verbFailure = null;
    const outcome = await deleteBooking(fetch, bookingId, crypto.randomUUID());
    if (outcome.kind === "ok") {
      void readBookings(record);
      onChanged();
      return;
    }
    verbFailure = stated(outcome.failure, "The booking was not released.");
  }

  // ---- the drafts the fields edit ---------------------------------------------------------------

  let eventDraft = $state<EventDraft | null>(null);
  let eventSeed: EventDraft | null = null;
  let deadlineDraft = $state<DeadlineDraft | null>(null);
  let deadlineSeed: DeadlineDraft | null = null;
  let firmEventDraft = $state<FirmEventDraft | null>(null);
  let firmEventSeed: FirmEventDraft | null = null;

  /** Member handles to names, so a participant chip reads as a person. */
  const memberNames = $derived(
    new Map(context.members.map((member) => [member.userId, member.displayName])),
  );

  /*
   * The fields are seeded from the record whenever one is read, and put back from the same seed
   * when a change is abandoned. Two copies are taken — one the fields edit, one held still — so
   * the window can answer honestly whether walking away would lose anything.
   */
  function seedDrafts(): void {
    eventDraft = null;
    eventSeed = null;
    deadlineDraft = null;
    deadlineSeed = null;
    firmEventDraft = null;
    firmEventSeed = null;
    if (record === null) return;
    switch (record.kind) {
      case "event":
        eventDraft = eventDraftFrom(record.event, record.participants, memberNames);
        eventSeed = eventDraftFrom(record.event, record.participants, memberNames);
        break;
      case "deadline":
        deadlineDraft = deadlineDraftFrom(record.deadline);
        deadlineSeed = deadlineDraftFrom(record.deadline);
        break;
      case "firmEvent":
        firmEventDraft = firmEventDraftFrom(record.event, record.participants, memberNames);
        firmEventSeed = firmEventDraftFrom(record.event, record.participants, memberNames);
        break;
    }
  }

  const unsavedChanges = $derived.by((): boolean => {
    if (!editing) return false;
    if (eventDraft !== null && eventSeed !== null) return eventDraftStarted(eventDraft, eventSeed);
    if (deadlineDraft !== null && deadlineSeed !== null) {
      return deadlineDraftStarted(deadlineDraft, deadlineSeed);
    }
    if (firmEventDraft !== null && firmEventSeed !== null) {
      return firmEventDraftStarted(firmEventDraft, firmEventSeed);
    }
    return false;
  });

  /** Why the change cannot be committed as it stands, or undefined when it can. */
  const shortfall = $derived.by((): string | undefined => {
    if (eventDraft !== null) return eventDraftShortfalls(eventDraft)[0];
    if (deadlineDraft !== null) return deadlineDraftShortfalls(deadlineDraft)[0];
    if (firmEventDraft !== null) return firmEventDraftShortfalls(firmEventDraft)[0];
    return "There is no record to change.";
  });

  let saving = $state(false);
  let saveFailure = $state<StatedFailure | null>(null);
  const saveRefusal = $derived(saving ? "Saving this record." : shortfall);

  // ---- what this account may do ---------------------------------------------------------------

  const MANAGE_SENTENCE =
    permissionRefusal("Changing a calendar record", "calendar:manage");

  /** Why nothing here may be written, or undefined when it may. */
  const manageRefusal = $derived.by((): string | undefined => {
    if (context.mayManage) return undefined;
    return context.sessionSettled ? MANAGE_SENTENCE : "Reading your session.";
  });

  /*
   * Why Edit refuses. It gates ENTRY into the fields: a cancelled setting and a settled deadline
   * are kept as they were recorded, because what the record said at the moment it was cancelled or
   * satisfied is itself a fact the firm relies on.
   */
  const editRefusal = $derived.by((): string | undefined => {
    if (manageRefusal !== undefined) return manageRefusal;
    if (record === null) return reading ? "Reading the record." : "There is no record to change.";
    if (record.kind === "deadline" && record.deadline.state !== "open") {
      return "A settled deadline is kept as it was recorded.";
    }
    if (record.kind !== "deadline" && record.event.status === "cancelled") {
      return "A cancelled setting is kept as it was recorded.";
    }
    return undefined;
  });

  function settingRefusal(status: EventStatus): string | undefined {
    switch (status) {
      case "scheduled":
        return undefined;
      case "occurred":
        return "This setting has already occurred.";
      case "cancelled":
        return "This setting is already cancelled.";
    }
  }

  function deadlineRefusal(state: DeadlineState): string | undefined {
    return state === "open"
      ? undefined
      : `This deadline is already ${deadlineStateLabel(state).toLowerCase()}.`;
  }

  /** Why a setting's verbs refuse, or undefined when the setting is open to them. */
  const eventVerbRefusal = $derived.by((): string | undefined => {
    if (manageRefusal !== undefined) return manageRefusal;
    if (record === null) return reading ? "Reading the record." : "There is no record to act on.";
    if (record.kind === "deadline") return "Not a setting.";
    return settingRefusal(record.event.status);
  });

  /** Why a deadline's verbs refuse, or undefined when the deadline is open to them. */
  const deadlineVerbRefusal = $derived.by((): string | undefined => {
    if (manageRefusal !== undefined) return manageRefusal;
    if (record === null) return reading ? "Reading the record." : "There is no record to act on.";
    if (record.kind !== "deadline") return "Not a deadline.";
    return deadlineRefusal(record.deadline.state);
  });

  // ---- the commit ------------------------------------------------------------------------------

  /*
   * The record forms send everything; a correction sends the fields this pane edits and nothing
   * else, so the participants on a setting are never re-sent by a window that did not touch them.
   */
  function eventUpdateOf(request: CreateEventRequest): UpdateEventRequest {
    return {
      eventTypeId: request.eventTypeId,
      title: request.title,
      description: request.description,
      startsOn: request.startsOn,
      startsAtTime: request.startsAtTime,
      endsOn: request.endsOn,
      endsAtTime: request.endsAtTime,
      timeZone: request.timeZone,
      locationText: request.locationText,
      courtReference: request.courtReference,
    };
  }

  function deadlineUpdateOf(request: CreateDeadlineRequest): UpdateDeadlineRequest {
    return {
      title: request.title,
      dueOn: request.dueOn,
      dueAtTime: request.dueAtTime,
      timeZone: request.timeZone,
      authorityText: request.authorityText,
      triggerEventId: request.triggerEventId,
      priority: request.priority,
    };
  }

  function firmEventUpdateOf(request: CreateFirmEventRequest): UpdateFirmEventRequest {
    return {
      eventTypeId: request.eventTypeId,
      title: request.title,
      description: request.description,
      startsOn: request.startsOn,
      startsAtTime: request.startsAtTime,
      endsOn: request.endsOn,
      endsAtTime: request.endsAtTime,
      timeZone: request.timeZone,
      locationId: request.locationId,
      locationText: request.locationText,
    };
  }

  async function save(): Promise<void> {
    if (record === null || saving || shortfall !== undefined) return;
    saving = true;
    saveFailure = null;
    // Every attempt carries its own key: a retry of the same attempt is answered with the first
    // result, and two attempts are never mistaken for one.
    const key = crypto.randomUUID();
    let outcome: ApiOutcome<Acknowledged> | null = null;
    if (record.kind === "event" && eventDraft !== null) {
      outcome = await updateMatterEvent(
        fetch,
        record.event.id,
        eventUpdateOf(eventDraftRequest(eventDraft)),
        key,
      );
    } else if (record.kind === "deadline" && deadlineDraft !== null) {
      outcome = await updateDeadline(
        fetch,
        record.deadline.id,
        deadlineUpdateOf(deadlineDraftRequest(deadlineDraft)),
        key,
      );
    } else if (record.kind === "firmEvent" && firmEventDraft !== null) {
      outcome = await updateFirmEvent(
        fetch,
        record.event.id,
        firmEventUpdateOf(firmEventDraftRequest(firmEventDraft)),
        key,
      );
    }
    saving = false;
    if (outcome === null) return;
    if (outcome.kind !== "ok") {
      saveFailure = stated(
        outcome.failure,
        "The change was not saved.",
        "Nothing answered. The change was not saved and the record is unchanged.",
      );
      return;
    }
    editing = false;
    onChanged();
    reread();
  }

  /** Abandoning: the window has already left editing; the fields go back to the seed. */
  function forgetChanges(): void {
    saveFailure = null;
    seedDrafts();
  }

  // ---- the verbs ------------------------------------------------------------------------------

  let verbFailure = $state<StatedFailure | null>(null);

  let cancelOpen = $state(false);
  let cancelReason = $state("");
  let satisfyOpen = $state(false);
  let satisfyNote = $state("");
  let vacateOpen = $state(false);
  let vacateReason = $state("");
  let continueOpen = $state(false);
  let continuedOpen = $state(false);
  let continuedDeadlines = $state<readonly ContinuanceDeadlineReference[]>([]);
  let supersedeOpen = $state(false);

  type ContinueDraft = EventTimingDraft & {
    locationText: string;
    courtReference: string;
    statusReason: string;
  };
  let continueDraft = $state<ContinueDraft>({
    startsOn: null,
    startsAtTime: "",
    endsOn: null,
    endsAtTime: "",
    timeZone: "",
    locationText: "",
    courtReference: "",
    statusReason: "",
  });
  const continueRefusal = $derived(timingShortfalls(continueDraft)[0]);
  const continueStarted = $derived(
    continueDraft.startsOn !== null ||
      continueDraft.endsOn !== null ||
      continueDraft.statusReason !== "",
  );

  function optionalText(text: string): string | null {
    const trimmed = text.trim();
    return trimmed === "" ? null : trimmed;
  }

  function openCancel(): void {
    cancelReason = "";
    verbFailure = null;
    cancelOpen = true;
  }

  function openSatisfy(): void {
    satisfyNote = "";
    verbFailure = null;
    satisfyOpen = true;
  }

  function openVacate(): void {
    vacateReason = "";
    verbFailure = null;
    vacateOpen = true;
  }

  /*
   * The new setting starts from the old one's zone, place and court, because a continuance moves
   * the DATE and rarely anything else; the date itself is left for the reader to state.
   */
  function openContinue(): void {
    if (record === null || record.kind !== "event") return;
    continueDraft = {
      startsOn: null,
      startsAtTime: record.event.startsAtTime ?? "",
      endsOn: null,
      endsAtTime: record.event.endsAtTime ?? "",
      timeZone: record.event.timeZone,
      locationText: record.event.locationText ?? "",
      courtReference: record.event.courtReference ?? "",
      statusReason: "",
    };
    verbFailure = null;
    continueOpen = true;
  }

  function openSupersede(): void {
    supersedeOpen = true;
  }

  function verbRefused(failure: Failure, fallback: string, whenSilent: string): ActionOutcome {
    verbFailure = stated(failure, fallback, whenSilent);
    return "refused";
  }

  function landed(): ActionOutcome {
    onChanged();
    reread();
    return "committed";
  }

  async function commitCancel(): Promise<ActionOutcome> {
    if (record === null || record.kind === "deadline") return "refused";
    const reason = optionalText(cancelReason);
    const key = crypto.randomUUID();
    const outcome =
      record.kind === "event"
        ? await cancelMatterEvent(fetch, record.event.id, reason, key)
        : await cancelFirmEvent(fetch, record.event.id, reason, key);
    if (outcome.kind !== "ok") {
      return verbRefused(
        outcome.failure,
        "The setting was not cancelled.",
        "Nothing answered. The setting was not cancelled and stays as it was.",
      );
    }
    return landed();
  }

  async function commitSatisfy(): Promise<ActionOutcome> {
    if (record === null || record.kind !== "deadline") return "refused";
    const outcome = await satisfyDeadline(
      fetch,
      record.deadline.id,
      { satisfactionNote: optionalText(satisfyNote) },
      crypto.randomUUID(),
    );
    if (outcome.kind !== "ok") {
      return verbRefused(
        outcome.failure,
        "The deadline was not satisfied.",
        "Nothing answered. The deadline is still open.",
      );
    }
    return landed();
  }

  async function commitVacate(): Promise<ActionOutcome> {
    if (record === null || record.kind !== "deadline") return "refused";
    const reason = optionalText(vacateReason);
    if (reason === null) return "refused";
    const outcome = await vacateDeadline(
      fetch,
      record.deadline.id,
      { stateReason: reason },
      crypto.randomUUID(),
    );
    if (outcome.kind !== "ok") {
      return verbRefused(
        outcome.failure,
        "The deadline was not vacated.",
        "Nothing answered. The deadline is still open.",
      );
    }
    return landed();
  }

  async function commitContinue(): Promise<ActionOutcome> {
    if (record === null || record.kind !== "event" || continueRefusal !== undefined) {
      return "refused";
    }
    const request: ContinueEventRequest = {
      startsOn: continueDraft.startsOn ?? "",
      startsAtTime: optionalText(continueDraft.startsAtTime),
      endsOn: continueDraft.endsOn,
      endsAtTime: optionalText(continueDraft.endsAtTime),
      timeZone: continueDraft.timeZone,
      locationText: optionalText(continueDraft.locationText),
      courtReference: optionalText(continueDraft.courtReference),
      statusReason: optionalText(continueDraft.statusReason),
    };
    const outcome = await continueMatterEvent(fetch, record.event.id, request, crypto.randomUUID());
    if (outcome.kind !== "ok") {
      return verbRefused(
        outcome.failure,
        "The setting was not continued.",
        "Nothing answered. The setting was not continued and stays as it was.",
      );
    }
    // Nothing moved: what a continuance does to the deadlines hanging off the old setting is a
    // judgement, so the reader is told which ones there are and left to make it.
    continuedDeadlines = outcome.value.triggerLinkedOpenDeadlines;
    if (continuedDeadlines.length > 0) continuedOpen = true;
    return landed();
  }

  function acknowledgeContinued(): Promise<ActionOutcome> {
    return Promise.resolve("committed");
  }

  // ---- how the record reads ---------------------------------------------------------------------

  const KIND_WORDS: Record<EntryReferenceKind, string> = {
    event: "Event",
    deadline: "Deadline",
    firmEvent: "Firm Event",
  };

  const heading = $derived(
    record !== null ? entryRecordTitle(record) : KIND_WORDS[current?.kind ?? "event"],
  );

  /** The kind, as the subtitle names it: the type's name where the record has one. */
  const kindLine = $derived.by((): string => {
    if (record === null) return KIND_WORDS[current?.kind ?? "event"];
    switch (record.kind) {
      case "event":
        return record.event.eventTypeName ?? KIND_WORDS.event;
      case "deadline":
        return KIND_WORDS.deadline;
      case "firmEvent":
        return context.eventTypeById(record.event.eventTypeId)?.name ?? KIND_WORDS.firmEvent;
    }
  });

  const matterNumber = $derived.by((): string | null => {
    if (record === null) return null;
    const matterId = entryRecordMatterId(record);
    return matterId === null ? null : (context.matterNumbers.get(matterId) ?? null);
  });

  function longDate(civilDate: string): string {
    try {
      return formatCivilDateLong(parseCivilDate(civilDate));
    } catch {
      return civilDate;
    }
  }

  const dateLine = $derived(record === null ? null : longDate(entryRecordDate(record)));

  function participantName(participant: EventParticipant): string {
    if (participant.participantName !== null) return participant.participantName;
    if (participant.memberUserId !== null) return context.memberName(participant.memberUserId);
    return "Directory record";
  }

  const PARTICIPANT_KIND_WORDS = {
    member: "Firm member",
    entity: "Directory record",
    external: "External",
  } as const;

  /** A civil date as the picker holds it, or undefined while the field is empty or half-entered. */
  function civilValue(text: string | null): CalendarDate | undefined {
    if (text === null) return undefined;
    try {
      return parseDate(text);
    } catch {
      return undefined;
    }
  }

  /** The catalog as the type select offers it: the active types, plus the record's own if retired. */
  const typeItems = $derived.by(() => {
    const currentId =
      record === null || record.kind === "deadline" ? null : record.event.eventTypeId;
    return context.eventTypes
      .filter((type) => type.active || type.id === currentId)
      .map((type) => ({ value: type.id, label: type.name }));
  });

  /** The zones on offer: the record's own first, then the reader's, then everything. */
  const zoneItems = $derived.by(() => {
    const recordZone =
      record === null
        ? null
        : record.kind === "deadline"
          ? record.deadline.timeZone
          : record.event.timeZone;
    return timeZoneOptions(
      [recordZone, context.readerTimeZone].filter((zone): zone is string => zone !== null),
    );
  });

  const officeItems = $derived.by(() => {
    const currentId = record?.kind === "firmEvent" ? record.event.locationId : null;
    return context.locations
      .filter((location) => location.status === "active" || location.id === currentId)
      .map((location) => ({ value: location.id, label: location.name }));
  });

  let printOpen = $state(false);
  const sheet = $derived(
    record === null
      ? null
      : entrySheet(record, {
          matterNumber,
          typeName:
            record.kind === "event"
              ? record.event.eventTypeName
              : record.kind === "firmEvent"
                ? (context.eventTypeById(record.event.eventTypeId)?.name ?? null)
                : null,
          officeName: record.kind === "firmEvent" ? context.locationName(record.event.locationId) : null,
          participantName,
          date: longDate,
          time: (time, timeZone) => formatWallClock(time, timeZone, context.readerTimeZone),
          printedAt: formatInstant(new Date()),
        }),
  );

  const linkCount = $derived.by((): number | undefined => {
    if (record === null) return undefined;
    if (record.kind === "event") {
      return [record.event.continuedFromEventId, record.event.continuedToEventId].filter(
        (id) => id !== null,
      ).length;
    }
    if (record.kind === "deadline") return record.deadline.triggerEventId === null ? 0 : 1;
    return 0;
  });

  const participantCount = $derived.by((): number | undefined => {
    if (record === null || record.kind === "deadline") return undefined;
    if (record.kind === "firmEvent" && record.event.audience === "all_members") return undefined;
    return record.participants.length;
  });
</script>

{#snippet subtitle()}
  <span>{kindLine}</span>
  {#if matterNumber !== null}
    <span aria-hidden="true">&middot;</span>
    <span class="tabular-nums">{matterNumber}</span>
  {/if}
  {#if dateLine !== null}
    <span aria-hidden="true">&middot;</span>
    <span>{dateLine}</span>
  {/if}
  {#if record !== null}
    {#if record.kind === "deadline"}
      <Badge variant={deadlineTone(record.deadline)}>
        {record.deadline.overdue && record.deadline.state === "open"
          ? "Past due"
          : deadlineStateLabel(record.deadline.state)}
      </Badge>
    {:else}
      <Badge variant={eventStatusTone(record.event.status)}>
        {eventStatusLabel(record.event.status)}
      </Badge>
    {/if}
  {/if}
{/snippet}

<!--
  ONE pane, both modes. The window hands it whether the fields are open; the values and the fields
  are the same rows in the same order at the same width, so a reader never loses their place when
  they press Edit. The rows break against THIS PANE's width through a container query, because the
  pane is one column of a window with its own measure.
-->
{#snippet recordPane({ editing: fieldsOpen }: { editing: boolean })}
  {@const readOnly = !fieldsOpen}
  <div class="@container flex flex-col gap-16">
    {#if saveFailure !== null}
      <FailureNotice
        failure={saveFailure.failure}
        title="The Change Was Not Saved"
        fallback={saveFailure.fallback}
        whenSilent={saveFailure.whenSilent}
      />
    {/if}

    {#if readFailure !== null}
      <FailureNotice
        failure={readFailure.failure}
        title="The Record Could Not Be Read"
        fallback={readFailure.fallback}
        onRetry={reread}
      />
    {:else if unreachableDeadline}
      <p class="text-sm text-text-muted">
        This deadline is not in the window on screen. Move to its month to open it.
      </p>
    {:else if record === null}
      <div class="flex flex-col gap-12" aria-busy="true" aria-label="Reading the record">
        <Skeleton class="h-32 w-full" />
        <Skeleton class="h-32 w-2/3" />
        <Skeleton class="h-32 w-full" />
      </div>
    {:else if record.kind === "event" && eventDraft !== null}
      {@const draft = eventDraft}
      <div class="flex flex-col gap-4">
        <Label for="entry-title">Title</Label>
        <Input id="entry-title" disabled={readOnly} bind:value={draft.title} />
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label id="entry-type-label">Type</Label>
          <Select.Root
            type="single"
            items={typeItems}
            value={draft.eventTypeId ?? ""}
            onValueChange={(value) => (draft.eventTypeId = value === "" ? null : value)}
            disabled={readOnly}
          >
            <Select.Trigger aria-labelledby="entry-type-label">
              <Select.Value placeholder={placeholderOf("Type")} />
            </Select.Trigger>
            <Select.Content>
              {#each typeItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="flex flex-col gap-4">
          <Label id="entry-zone-label">Time Zone</Label>
          <Select.Root
            type="single"
            items={zoneItems}
            value={draft.timeZone}
            onValueChange={(value) => (draft.timeZone = value)}
            allowDeselect={false}
            disabled={readOnly}
          >
            <Select.Trigger aria-labelledby="entry-zone-label">
              <Select.Value placeholder={placeholderOf("Time Zone")} />
            </Select.Trigger>
            <Select.Content>
              {#each zoneItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <DatePicker
            label="Date"
            value={civilValue(draft.startsOn)}
            disabled={readOnly}
            onValueChange={(picked) => (draft.startsOn = picked === undefined ? null : picked.toString())}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-time">Time</Label>
          <Input
            id="entry-time"
            inputmode="numeric"
            placeholder={placeholderOf("Time")}
            title="HH:MM in the time zone above, or empty for all day"
            disabled={readOnly}
            bind:value={draft.startsAtTime}
          />
        </div>
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <DatePicker
            label="End Date"
            value={civilValue(draft.endsOn)}
            disabled={readOnly}
            onValueChange={(picked) => (draft.endsOn = picked === undefined ? null : picked.toString())}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-end-time">End Time</Label>
          <Input
            id="entry-end-time"
            inputmode="numeric"
            placeholder={placeholderOf("End Time")}
            title="HH:MM in the time zone above, or empty"
            disabled={readOnly}
            bind:value={draft.endsAtTime}
          />
        </div>
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label for="entry-where">Where</Label>
          <Input id="entry-where" disabled={readOnly} bind:value={draft.locationText} />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-court-reference">Court Reference</Label>
          <Input id="entry-court-reference" disabled={readOnly} bind:value={draft.courtReference} />
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <Label for="entry-description">Description</Label>
        <Textarea
          id="entry-description"
          class="resize-none"
          rows={3}
          disabled={readOnly}
          bind:value={draft.description}
        />
      </div>
    {:else if record.kind === "deadline" && deadlineDraft !== null}
      {@const draft = deadlineDraft}
      <div class="flex flex-col gap-4">
        <Label for="entry-title">Title</Label>
        <Input id="entry-title" disabled={readOnly} bind:value={draft.title} />
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <DatePicker
            label="Due"
            value={civilValue(draft.dueOn)}
            disabled={readOnly}
            onValueChange={(picked) => (draft.dueOn = picked === undefined ? null : picked.toString())}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-time">Time</Label>
          <Input
            id="entry-time"
            inputmode="numeric"
            placeholder={placeholderOf("Time")}
            title="HH:MM in the time zone below, or empty for the end of the day"
            disabled={readOnly}
            bind:value={draft.dueAtTime}
          />
        </div>
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label id="entry-zone-label">Time Zone</Label>
          <Select.Root
            type="single"
            items={zoneItems}
            value={draft.timeZone}
            onValueChange={(value) => (draft.timeZone = value)}
            allowDeselect={false}
            disabled={readOnly}
          >
            <Select.Trigger aria-labelledby="entry-zone-label">
              <Select.Value placeholder={placeholderOf("Time Zone")} />
            </Select.Trigger>
            <Select.Content>
              {#each zoneItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-priority">Priority</Label>
          <Input
            id="entry-priority"
            inputmode="numeric"
            placeholder={placeholderOf("Priority")}
            title="1 is the most urgent, {DEADLINE_PRIORITY_MAX} the least; empty for none"
            disabled={readOnly}
            bind:value={draft.priority}
          />
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <Label for="entry-authority">Authority</Label>
        <Input
          id="entry-authority"
          title="The rule, statute or order this comes from, in the firm's own words"
          disabled={readOnly}
          bind:value={draft.authorityText}
        />
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label for="entry-source">Source</Label>
          <!-- Frozen on the record: where a deadline came from is a fact about its recording. -->
          <Input id="entry-source" value={deadlineSourceLabel(draft.source)} disabled />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-state">State</Label>
          <Input
            id="entry-state"
            value={record.deadline.overdue && record.deadline.state === "open"
              ? "Open, past due"
              : deadlineStateLabel(record.deadline.state)}
            disabled
          />
        </div>
      </div>
      {#if record.deadline.state !== "open" && record.deadline.stateReason !== null}
        <div class="flex flex-col gap-4">
          <Label for="entry-state-reason">Reason</Label>
          <Textarea
            id="entry-state-reason"
            class="resize-none"
            rows={2}
            value={record.deadline.stateReason}
            disabled
          />
        </div>
      {/if}
    {:else if record.kind === "firmEvent" && firmEventDraft !== null}
      {@const draft = firmEventDraft}
      <div class="flex flex-col gap-4">
        <Label for="entry-title">Title</Label>
        <Input id="entry-title" disabled={readOnly} bind:value={draft.title} />
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label id="entry-type-label">Type</Label>
          <Select.Root
            type="single"
            items={typeItems}
            value={draft.eventTypeId ?? ""}
            onValueChange={(value) => (draft.eventTypeId = value === "" ? null : value)}
            disabled={readOnly}
          >
            <Select.Trigger aria-labelledby="entry-type-label">
              <Select.Value placeholder={placeholderOf("Type")} />
            </Select.Trigger>
            <Select.Content>
              {#each typeItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="flex flex-col gap-4">
          <Label id="entry-zone-label">Time Zone</Label>
          <Select.Root
            type="single"
            items={zoneItems}
            value={draft.timeZone}
            onValueChange={(value) => (draft.timeZone = value)}
            allowDeselect={false}
            disabled={readOnly}
          >
            <Select.Trigger aria-labelledby="entry-zone-label">
              <Select.Value placeholder={placeholderOf("Time Zone")} />
            </Select.Trigger>
            <Select.Content>
              {#each zoneItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <DatePicker
            label="Date"
            value={civilValue(draft.startsOn)}
            disabled={readOnly}
            onValueChange={(picked) => (draft.startsOn = picked === undefined ? null : picked.toString())}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-time">Time</Label>
          <Input
            id="entry-time"
            inputmode="numeric"
            placeholder={placeholderOf("Time")}
            title="HH:MM in the time zone above, or empty for all day"
            disabled={readOnly}
            bind:value={draft.startsAtTime}
          />
        </div>
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <DatePicker
            label="End Date"
            value={civilValue(draft.endsOn)}
            disabled={readOnly}
            onValueChange={(picked) => (draft.endsOn = picked === undefined ? null : picked.toString())}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-end-time">End Time</Label>
          <Input
            id="entry-end-time"
            inputmode="numeric"
            placeholder={placeholderOf("End Time")}
            title="HH:MM in the time zone above, or empty"
            disabled={readOnly}
            bind:value={draft.endsAtTime}
          />
        </div>
      </div>
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label for="entry-audience">Audience</Label>
          <!-- Who an event is for is decided when it is recorded; a list that grew or shrank
               afterwards would change whose calendar it is on without anybody choosing that. -->
          <Input id="entry-audience" value={firmEventAudienceLabel(draft.audience)} disabled />
        </div>
        <div class="flex flex-col gap-4">
          <Label id="entry-office-label">Office</Label>
          <Select.Root
            type="single"
            items={officeItems}
            value={draft.locationId ?? ""}
            onValueChange={(value) => (draft.locationId = value === "" ? null : value)}
            disabled={readOnly || officeItems.length === 0}
          >
            <Select.Trigger aria-labelledby="entry-office-label">
              <Select.Value placeholder={placeholderOf("Office")} />
            </Select.Trigger>
            <Select.Content>
              {#each officeItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <Label for="entry-venue">Venue</Label>
        <Input id="entry-venue" disabled={readOnly} bind:value={draft.locationText} />
      </div>
      <div class="flex flex-col gap-4">
        <Label for="entry-description">Description</Label>
        <Textarea
          id="entry-description"
          class="resize-none"
          rows={3}
          disabled={readOnly}
          bind:value={draft.description}
        />
      </div>
    {/if}
  </div>
{/snippet}

{#snippet participantsTab()}
  {#if record === null}
    <p class="text-sm text-text-muted">&nbsp;</p>
  {:else if record.kind === "deadline"}
    <p class="text-sm text-text-muted">Nobody is listed.</p>
  {:else if record.kind === "firmEvent" && record.event.audience === "all_members"}
    <p class="text-sm">Everyone at the firm.</p>
  {:else if record.participants.length === 0}
    <p class="text-sm text-text-muted">Nobody is listed.</p>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Who is at this event</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Name</DataTable.Head>
          <DataTable.Head>Role</DataTable.Head>
          <DataTable.Head>Kind</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each record.participants as participant (participant.id)}
          <DataTable.Row>
            <DataTable.Cell>
              {#if participant.participantKind === "entity" && participant.entityId !== null && participant.participantName === null}
                <a class="underline underline-offset-2" href="/contacts/{participant.entityId}">
                  {participantName(participant)}
                </a>
              {:else}
                {participantName(participant)}
              {/if}
            </DataTable.Cell>
            <DataTable.Cell>
              {#if participant.role === null}
                <span class="text-text-muted">Not recorded</span>
              {:else}
                {participant.role}
              {/if}
            </DataTable.Cell>
            <DataTable.Cell>{PARTICIPANT_KIND_WORDS[participant.participantKind]}</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  {/if}
{/snippet}

<!-- What acts like a link looks like a link: these re-open this window on the other record, so
     they are buttons under the hood and wear the link register on top. -->
{#snippet roomsTab()}
  {#if record === null}
    <p class="text-sm text-text-muted">&nbsp;</p>
  {:else if record.kind === "deadline"}
    <p class="text-sm text-text-muted">A deadline books nothing.</p>
  {:else if bookingsFailure !== null}
    <FailureNotice
      failure={bookingsFailure.failure}
      title="The Bookings Could Not Be Read"
      fallback={bookingsFailure.fallback}
      onRetry={() => void readBookings(record)}
    />
  {:else if bookings === null}
    <Skeleton class="h-16 w-full" />
  {:else if bookConflicts > 0 && bookings.length > 0}
    <!-- Reported once, after the booking that made it: the room grid shows the pair. -->
    <p class="text-sm">
      Double-booked with {bookConflicts} other {bookConflicts === 1 ? "booking" : "bookings"}. The
      booking stands; the room grid shows the pair.
    </p>
    {@render bookingRows(bookings)}
  {:else if bookings.length === 0}
    <p class="text-sm text-text-muted">Nothing booked for this event.</p>
  {:else}
    {@render bookingRows(bookings)}
  {/if}
{/snippet}

{#snippet bookingRows(rows: readonly EventBooking[])}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">What this event has booked</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Resource</DataTable.Head>
        <DataTable.Head>When</DataTable.Head>
        <DataTable.Head class="sr-only">Release</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as booking (booking.id)}
        <DataTable.Row>
          <DataTable.Cell>{resourceName(booking.resourceId)}</DataTable.Cell>
          <DataTable.Cell>
            {booking.startsOn}{booking.startsAtTime === null ? "" : ` ${formatWallClock(booking.startsAtTime, booking.timeZone, context.readerTimeZone) ?? ""}`}
            {#if booking.endsAtTime !== null}
              to {formatWallClock(booking.endsAtTime, booking.timeZone, context.readerTimeZone) ?? ""}
            {/if}
          </DataTable.Cell>
          <DataTable.Cell class="text-end">
            <Button
              variant="ghost"
              size="sm"
              disabled={eventVerbRefusal !== undefined}
              title={eventVerbRefusal ?? "Free the resource; the event stays as it is"}
              onclick={() => void releaseBooking(booking.id)}
            >
              Release
            </Button>
          </DataTable.Cell>
        </DataTable.Row>
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

{#snippet linksTab()}
  {#if record === null}
    <p class="text-sm text-text-muted">&nbsp;</p>
  {:else if record.kind === "event" && (record.event.continuedFromEventId !== null || record.event.continuedToEventId !== null)}
    {@const event = record.event}
    <dl class="flex flex-col gap-8 text-sm">
      {#if event.continuedFromEventId !== null}
        {@const fromId = event.continuedFromEventId}
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Continued from</dt>
          <dd>
            <button
              type="button"
              class="underline underline-offset-2"
              onclick={() => openEvent(fromId)}
            >
              The earlier setting
            </button>
          </dd>
        </div>
      {/if}
      {#if event.continuedToEventId !== null}
        {@const toId = event.continuedToEventId}
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Continued to</dt>
          <dd>
            <button
              type="button"
              class="underline underline-offset-2"
              onclick={() => openEvent(toId)}
            >
              The later setting
            </button>
          </dd>
        </div>
      {/if}
    </dl>
  {:else if record.kind === "deadline" && record.deadline.triggerEventId !== null}
    {@const triggerId = record.deadline.triggerEventId}
    <dl class="flex flex-col gap-8 text-sm">
      <div class="flex items-baseline justify-between gap-16">
        <dt class="text-text-muted">Started by</dt>
        <dd>
          <button
            type="button"
            class="underline underline-offset-2"
            onclick={() => openEvent(triggerId)}
          >
            The setting that started the clock
          </button>
        </dd>
      </div>
    </dl>
  {:else}
    <p class="text-sm text-text-muted">No links.</p>
  {/if}
{/snippet}

{#snippet historyTab()}
  <div class="flex flex-col items-start gap-8">
    <MaturityBadge stage="soon" />
    <p class="text-sm text-text-muted">
      The record's own history waits on the per-record audit read.
    </p>
  </div>
{/snippet}

<!--
  This file's verbs only. While the fields are open the window appends the commit after these, so
  Save is the same control in the same place on every kind of record in the product. Every verb the
  kind has is drawn whatever the state; a state that refuses one disables it and says why.
-->
{#snippet actions({ editing: fieldsOpen }: { editing: boolean })}
  {#if !fieldsOpen}
    {#if current?.kind === "event"}
      <Button
        variant="secondary"
        disabled={eventVerbRefusal !== undefined}
        title={eventVerbRefusal ?? "Take this setting off the calendar; it stays on the record as cancelled"}
        onclick={openCancel}
      >
        Cancel Setting
      </Button>
      <Button
        variant="secondary"
        disabled={eventVerbRefusal !== undefined}
        title={eventVerbRefusal ?? "The court moved it: record the new setting and link the two"}
        onclick={openContinue}
      >
        Continue Setting
      </Button>
      <Button
        variant="secondary"
        disabled={eventVerbRefusal !== undefined}
        title={eventVerbRefusal ?? "Book a room, a car or equipment for this setting's window"}
        onclick={openBook}
      >
        Book a Room
      </Button>
    {:else if current?.kind === "deadline"}
      <Button
        variant="secondary"
        disabled={deadlineVerbRefusal !== undefined}
        title={deadlineVerbRefusal ?? "The firm did the thing"}
        onclick={openSatisfy}
      >
        Satisfy
      </Button>
      <Button
        variant="secondary"
        disabled={deadlineVerbRefusal !== undefined}
        title={deadlineVerbRefusal ?? "No longer in force; the reason is required"}
        onclick={openVacate}
      >
        Vacate
      </Button>
      <Button
        variant="secondary"
        disabled={deadlineVerbRefusal !== undefined}
        title={deadlineVerbRefusal ?? "A new deadline replaces this one; both stay on the record"}
        onclick={openSupersede}
      >
        Supersede
      </Button>
    {:else if current?.kind === "firmEvent"}
      <Button
        variant="secondary"
        disabled={eventVerbRefusal !== undefined}
        title={eventVerbRefusal ?? "Take this event off the firm's calendar; it stays on the record as cancelled"}
        onclick={openCancel}
      >
        Cancel Event
      </Button>
      <Button
        variant="secondary"
        disabled={eventVerbRefusal !== undefined}
        title={eventVerbRefusal ?? "Book a room, a car or equipment for this event's window"}
        onclick={openBook}
      >
        Book a Room
      </Button>
    {/if}
    <Button onclick={() => (open = false)}>Close</Button>
  {/if}
{/snippet}

<RecordWindow
  bind:open
  bind:editing
  {heading}
  {subtitle}
  record={recordPane}
  {actions}
  tabs={[
    { key: "participants", label: "Participants", count: participantCount, content: participantsTab },
    { key: "links", label: "Links", count: linkCount, content: linksTab },
    { key: "rooms", label: "Rooms", count: bookingCount, content: roomsTab },
    { key: "history", label: "History", content: historyTab },
  ] satisfies RecordWindowTab[]}
  editDisabledReason={editRefusal}
  saveDisabledReason={saveRefusal}
  {unsavedChanges}
  onSave={() => void save()}
  onCancel={forgetChanges}
  onPrint={() => (printOpen = true)}
  style="block-size: min(92vh, calc(var(--mc-size-record-window) * 0.625))"
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}

{#snippet verbNotice()}
  {#if verbFailure !== null}
    <FailureNotice
      failure={verbFailure.failure}
      title="That Did Not Land"
      fallback={verbFailure.fallback}
      whenSilent={verbFailure.whenSilent}
    />
  {/if}
{/snippet}

{#snippet recordSubtitle()}
  {heading}{#if dateLine !== null}, {dateLine}{/if}
{/snippet}

<ActionDialog
  bind:open={cancelOpen}
  heading={current?.kind === "firmEvent" ? "Cancel This Event" : "Cancel This Setting"}
  subtitle={recordSubtitle}
  notice={verbNotice}
  commitLabel={current?.kind === "firmEvent" ? "Cancel Event" : "Cancel Setting"}
  commitBusyLabel="Cancelling"
  unsavedChanges={cancelReason.trim() !== ""}
  onCommit={commitCancel}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-4">
      <Label for="entry-cancel-reason">Reason</Label>
      <Textarea id="entry-cancel-reason" rows={2} disabled={busy} bind:value={cancelReason} />
    </div>
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={satisfyOpen}
  heading="Satisfy This Deadline"
  subtitle={recordSubtitle}
  notice={verbNotice}
  commitLabel="Satisfy"
  commitBusyLabel="Satisfying"
  unsavedChanges={satisfyNote.trim() !== ""}
  onCommit={commitSatisfy}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-4">
      <Label for="entry-satisfy-note">Note</Label>
      <Textarea id="entry-satisfy-note" rows={2} disabled={busy} bind:value={satisfyNote} />
    </div>
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={vacateOpen}
  heading="Vacate This Deadline"
  subtitle={recordSubtitle}
  notice={verbNotice}
  commitLabel="Vacate"
  commitBusyLabel="Vacating"
  commitRefusal={vacateReason.trim() === "" ? "A reason is needed." : undefined}
  unsavedChanges={vacateReason.trim() !== ""}
  onCommit={commitVacate}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-4">
      <Label for="entry-vacate-reason">Reason</Label>
      <Textarea id="entry-vacate-reason" rows={2} disabled={busy} bind:value={vacateReason} />
    </div>
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={continueOpen}
  heading="Continue This Setting"
  subtitle={recordSubtitle}
  notice={verbNotice}
  commitLabel="Continue Setting"
  commitBusyLabel="Continuing"
  commitRefusal={continueRefusal}
  unsavedChanges={continueStarted}
  width="wide"
  onCommit={commitContinue}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-4">
          <DatePicker
            label="New Date"
            value={civilValue(continueDraft.startsOn)}
            disabled={busy}
            onValueChange={(picked) =>
              (continueDraft.startsOn = picked === undefined ? null : picked.toString())}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-continue-time">Time</Label>
          <Input
            id="entry-continue-time"
            inputmode="numeric"
            placeholder={placeholderOf("Time")}
            title="HH:MM in the time zone below, or empty for all day"
            disabled={busy}
            bind:value={continueDraft.startsAtTime}
          />
        </div>
      </div>
      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-4">
          <DatePicker
            label="End Date"
            value={civilValue(continueDraft.endsOn)}
            disabled={busy}
            onValueChange={(picked) =>
              (continueDraft.endsOn = picked === undefined ? null : picked.toString())}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-continue-end-time">End Time</Label>
          <Input
            id="entry-continue-end-time"
            inputmode="numeric"
            placeholder={placeholderOf("End Time")}
            title="HH:MM in the time zone below, or empty"
            disabled={busy}
            bind:value={continueDraft.endsAtTime}
          />
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <Label id="entry-continue-zone-label">Time Zone</Label>
        <Select.Root
          type="single"
          items={zoneItems}
          value={continueDraft.timeZone}
          onValueChange={(value) => (continueDraft.timeZone = value)}
          allowDeselect={false}
          disabled={busy}
        >
          <Select.Trigger aria-labelledby="entry-continue-zone-label">
            <Select.Value placeholder={placeholderOf("Time Zone")} />
          </Select.Trigger>
          <Select.Content>
            {#each zoneItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label for="entry-continue-where">Where</Label>
          <Input id="entry-continue-where" disabled={busy} bind:value={continueDraft.locationText} />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="entry-continue-court-reference">Court Reference</Label>
          <Input
            id="entry-continue-court-reference"
            disabled={busy}
            bind:value={continueDraft.courtReference}
          />
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <Label for="entry-continue-reason">Reason</Label>
        <Textarea
          id="entry-continue-reason"
          rows={2}
          title="Why the old setting is not happening"
          disabled={busy}
          bind:value={continueDraft.statusReason}
        />
      </div>
    </div>
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={continuedOpen}
  kind="confirm"
  heading="Deadlines Linked to the Vacated Setting"
  commitLabel="Understood"
  unsavedChanges={false}
  onCommit={acknowledgeContinued}
>
  {#snippet subtitle()}
    No deadline was moved. Review each one against the new setting.
  {/snippet}
  {#snippet fields()}
    <ul class="flex flex-col gap-8 text-sm">
      {#each continuedDeadlines as linked (linked.id)}
        <li class="flex items-baseline justify-between gap-16">
          <span>{linked.title}</span>
          <span class="text-text-muted tabular-nums">{longDate(linked.dueOn)}</span>
        </li>
      {/each}
    </ul>
  {/snippet}
</ActionDialog>

{#if record?.kind === "deadline"}
  <RecordDeadlineDialog
    bind:open={supersedeOpen}
    matterId={record.deadline.matterId}
    matters={context.matters}
    mattersCapped={context.mattersCapped}
    preferredTimeZones={[context.readerTimeZone]}
    initialDate={record.deadline.dueOn}
    supersedes={record.deadline}
    onRecorded={() => landed()}
  />
{/if}

<ActionDialog
  bind:open={bookOpen}
  heading="Book a Room"
  commitLabel="Book"
  commitBusyLabel="Booking"
  commitRefusal={bookRefusal}
  unsavedChanges={bookResourceId !== ""}
  onCommit={commitBook}
>
  {#snippet notice()}
    {#if bookFailure !== null}
      <FailureNotice
        failure={bookFailure.failure}
        title="The Booking Was Not Made"
        fallback={bookFailure.fallback}
        whenSilent={bookFailure.whenSilent}
      />
    {/if}
  {/snippet}
  {#snippet fields()}
  <div class="flex flex-col gap-16">
    <p class="text-sm text-text-muted">
      The booking takes this event's own window. A resource already taken is booked anyway and the
      double-booking is reported, never refused.
    </p>
    <div class="flex flex-col gap-4">
      <Label for="entry-book-resource">Resource</Label>
      {#if bookableResources.length === 0}
        <p class="text-sm text-text-muted">
          The firm has no rooms or resources yet. They are added under Settings › Practice › Rooms
          and Resources.
        </p>
      {:else}
        <Select.Root type="single" items={bookableResources} bind:value={bookResourceId} allowDeselect={false}>
          <Select.Trigger id="entry-book-resource" class="w-full">
            <Select.Value placeholder={placeholderOf("Resource")} />
          </Select.Trigger>
          <Select.Content>
            {#each bookableResources as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      {/if}
    </div>
  </div>
  {/snippet}
</ActionDialog>

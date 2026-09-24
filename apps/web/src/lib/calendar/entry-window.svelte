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
  import { formatInstant, formatInstantDate, placeholderOf } from "@magna-carta/design-system/formatters";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SAMPLE_SENTENCE, sampleCivilDate, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import * as Select from "@magna-carta/design-system/select";
  import Textarea from "@magna-carta/design-system/textarea";
  import type { ApiOutcome, Failure } from "$lib/api/request.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { MaturityBadge } from "@magna-carta/design-system/maturity";
  import {
    cancelFirmEvent,
    cancelMatterEvent,
    continueMatterEvent,
    deadlineStateBadgeLabel,
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
    createBooking,
    deleteBooking,
    listEventBookings,
    updateFirmEvent,
    updateMatterEvent,
    vacateDeadline,
    type Acknowledged,
    type CalendarDeadline,
    type ContinuanceDeadlineReference,
    type EventParticipant,
  } from "./calendar-api.ts";
  import type { CalendarContext } from "./calendar-context.svelte.ts";
  import { calendarManageRefusal } from "./calendar-permission.ts";
  import { ENTRY_KIND_WORDS, PARTICIPANT_KIND_WORDS } from "./calendar-vocabulary.ts";
  import {
    continueDraftFrom,
    continueDraftRequest,
    continueDraftShortfalls,
    continueDraftStarted,
    emptyContinueDraft,
    type ContinueDraft,
  } from "./continue-draft.ts";
  import {
    deadlineDraftFrom,
    deadlineDraftRequest,
    deadlineDraftShortfalls,
    deadlineDraftStarted,
    deadlineSourceLabel,
    DEADLINE_PRIORITY_MAX,
    type DeadlineDraft,
  } from "./deadline-draft.ts";
  import { civilDateValue, optionalText } from "./draft-text.ts";
  import EntryLinksTab from "./entry-links-tab.svelte";
  import { entrySheet } from "./entry-print-sheet.ts";
  import {
    entryRecordDate,
    entryRecordKindLine,
    entryRecordMatterId,
    entryRecordTitle,
    entryReferenceKey,
    type EntryRecord,
    type EntryReference,
    type EntryReferenceKind,
  } from "./entry-reference.ts";
  import EntryRoomsTab from "./entry-rooms-tab.svelte";
  import { shortfallFor, type Shortfall } from "./shortfall.ts";
  import {
    deadlineUpdateOf,
    eventUpdateOf,
    firmEventUpdateOf,
  } from "./entry-updates.ts";
  import { reconcileRoomBooking, roomNotHeldSentence } from "./room-location.ts";
  import ParticipantPicker from "./participant-picker.svelte";
  import {
    deadlineVerbRefusal as deadlineVerbRefusalOf,
    editRefusal as editRefusalOf,
    eventVerbRefusal as eventVerbRefusalOf,
    linkCount as linkCountOf,
    participantCount as participantCountOf,
    type EntryVerbState,
  } from "./entry-verbs.ts";
  import {
    eventDraftFrom,
    eventDraftRequest,
    eventDraftShortfalls,
    eventDraftStarted,
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
  import EventTypeSelect from "./event-type-select.svelte";
  import RecordDeadlineDialog from "./record-deadline-dialog.svelte";
  import RecordTimingFields from "./record-timing-fields.svelte";
  import RecurrenceField from "./recurrence-field.svelte";
  import LocationPicker from "./location-picker.svelte";
  import TimeZonePicker from "./time-zone-picker.svelte";
  import MeetingEntryAction from "$lib/meetings/meeting-entry-action.svelte";

  /** Makes the ids the panes mint unique: the window is one of several forms a page may hold. */
  const idPrefix = $props.id();

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
  /*
   * Whether the Participants pane was edited in THIS editing session. A correction sends the
   * participants only when it did — the standing rule that a window which did not touch who is at a
   * setting cannot change it — and the flag is what says so, because the projection cannot tell
   * from the lists themselves: a draft's participants carry local keys and display names the server
   * never sent, so any comparison would report a change on every open.
   */
  let participantsEdited = $state(false);
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
    participantsEdited = false;
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
    readFailure = failure === null ? null : stated(failure, "The record could not be read.");
    reading = false;
    seedDrafts();
  }

  function reread(): void {
    const target = current;
    if (target !== null) void readRecord(target);
  }

  /** Re-open this window on a neighbouring record; the Links tab follows links this way. */
  function openReference(reference: EntryReference): void {
    current = reference;
  }

  // ---- the tabs that own their own reads --------------------------------------------------------
  //
  // The Links tab and the Rooms tab each read, form and fail on their own (entry-links-tab.svelte,
  // entry-rooms-tab.svelte). The shell holds only what the action bar needs: the way in to their
  // dialogs, and the counts the tab strip shows.

  let linksTab = $state<EntryLinksTab>();
  /*
   * The Rooms tab's own handle. It no longer carries a verb on the ACTION BAR — holding the room a
   * setting is held in is the Location field's gesture, and a second control for the same act read
   * as a second feature (owner, 2026-09-16) — but the handle stays, because the tab is still where
   * a SECOND room, or a car, is held by hand.
   */
  let roomsTab = $state<EntryRoomsTab>();
  let relatedCount = $state(0);
  let bookingCount = $state(0);

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

  /**
   * Everything the change still needs, each knowing which field it is about.
   *
   * The bar shows the FIRST sentence and the fields carry their own once a save has been refused,
   * so the reader is told why the commit will not press AND where to go — one wording, written in
   * the draft and rendered twice.
   */
  const shortfalls = $derived.by((): readonly Shortfall[] => {
    if (eventDraft !== null) return eventDraftShortfalls(eventDraft);
    if (deadlineDraft !== null) return deadlineDraftShortfalls(deadlineDraft);
    if (firmEventDraft !== null) return firmEventDraftShortfalls(firmEventDraft);
    return [{ field: "", sentence: "There is no record to change." }];
  });
  const shortfall = $derived(shortfalls[0]?.sentence);
  /*
   * Fields are marked only once a save was asked for and refused. A form that opens with every
   * unanswered field already marked has told the reader they are wrong for not having typed yet.
   */
  let saveAttempted = $state(false);
  const fieldShortfalls = $derived(saveAttempted ? shortfalls : []);

  let saving = $state(false);
  let saveFailure = $state<StatedFailure | null>(null);
  const saveRefusal = $derived(saving ? "Saving this record." : shortfall);

  // ---- what this account may do ---------------------------------------------------------------
  //
  // Every answer is entry-verbs.ts's, over the session's own refusal (calendar-permission.ts); this
  // file only hands them the record, whether it is still being read, and that refusal.

  const verbState = $derived.by(
    (): EntryVerbState => ({
      record,
      reading,
      manageRefusal: calendarManageRefusal("Changing a calendar record", context),
    }),
  );
  const editRefusal = $derived(editRefusalOf(verbState));
  const eventVerbRefusal = $derived(eventVerbRefusalOf(verbState));
  const deadlineVerbRefusal = $derived(deadlineVerbRefusalOf(verbState));

  // ---- the commit ------------------------------------------------------------------------------

  async function save(): Promise<void> {
    saveAttempted = true;
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
        eventUpdateOf(eventDraftRequest(eventDraft), { edited: participantsEdited }),
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
        firmEventUpdateOf(firmEventDraftRequest(firmEventDraft), { edited: participantsEdited }),
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
    // The room the location names is held, and one it no longer names is released — so a setting
    // MOVED from the Boardroom to Conference Room B leaves both room calendars saying what the
    // record says. Booking at the record was already true; this is the correction's half of it,
    // and its absence is what kept Location and Book a Room reading as two features.
    await reconcileRooms();
    editing = false;
    participantsEdited = false;
    saveAttempted = false;
    onChanged();
    reread();
  }

  /**
   * Make the event's room bookings say what its location says.
   *
   * It runs AFTER the record saved, because the location it reconciles to is the one that landed.
   * A booking that could not be moved does not unwind the correction — the correction is a real
   * change the reader asked for — so the window states which half did not happen and leaves the
   * record as saved, exactly as the record form does.
   *
   * Only the room the location names is touched. A pool car, or a second room somebody held from
   * the Rooms tab, was never named by this field and is not swept away by an edit to it.
   */
  async function reconcileRooms(): Promise<void> {
    if (record === null || record.kind === "deadline") return;
    const locationText =
      record.kind === "event" ? (eventDraft?.locationText ?? "") : (firmEventDraft?.locationText ?? "");
    const held = await listEventBookings(fetch, {
      kind: record.kind === "event" ? "matterEvent" : "firmEvent",
      id: record.event.id,
    });
    if (held.kind !== "ok") return;
    const plan = reconcileRoomBooking(
      locationText,
      held.value.data,
      context.resources,
      context.locations,
    );
    for (const bookingId of plan.release) {
      await deleteBooking(fetch, bookingId, crypto.randomUUID());
    }
    if (plan.book === null) return;
    const booked = await createBooking(
      fetch,
      {
        resourceId: plan.book.id,
        matterEventId: record.kind === "event" ? record.event.id : null,
        firmEventId: record.kind === "firmEvent" ? record.event.id : null,
      },
      crypto.randomUUID(),
    );
    if (booked.kind !== "ok") {
      saveFailure = stated(
        booked.failure,
        roomNotHeldSentence(plan.book.name),
        roomNotHeldSentence(plan.book.name),
      );
    }
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

  let continueDraft = $state<ContinueDraft>(emptyContinueDraft());
  const continueRefusal = $derived(continueDraftShortfalls(continueDraft)[0]);
  const continueStarted = $derived(continueDraftStarted(continueDraft));

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
    continueDraft = continueDraftFrom(record.event);
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
    const outcome = await continueMatterEvent(
      fetch,
      record.event.id,
      continueDraftRequest(continueDraft),
      crypto.randomUUID(),
    );
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

  const heading = $derived(
    record !== null ? entryRecordTitle(record) : ENTRY_KIND_WORDS[current?.kind ?? "event"],
  );

  /** The kind, as the subtitle names it: the type's name where the record has one. */
  const kindLine = $derived(
    entryRecordKindLine(
      record,
      current?.kind ?? "event",
      ENTRY_KIND_WORDS,
      (eventTypeId) => context.eventTypeById(eventTypeId)?.name,
    ),
  );

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

  /** The catalog as the type select offers it: the active types, plus the record's own if retired. */
  const typeItems = $derived.by(() => {
    const currentId =
      record === null || record.kind === "deadline" ? null : record.event.eventTypeId;
    return context.eventTypes
      .filter((type) => type.active || type.id === currentId)
      .map((type) => ({ value: type.id, label: type.name }));
  });

  /** The zones offered first: the record's own, then the reader's. */
  const preferredZones = $derived.by((): readonly string[] => {
    const recordZone =
      record === null
        ? null
        : record.kind === "deadline"
          ? record.deadline.timeZone
          : record.event.timeZone;
    return [recordZone, context.readerTimeZone].filter((zone): zone is string => zone !== null);
  });

  /** The State field's word: the state, and whether an open one is already past its day. */
  function deadlineStateWord(deadline: CalendarDeadline): string {
    return deadline.overdue && deadline.state === "open"
      ? "Open, past due"
      : deadlineStateLabel(deadline.state);
  }

  /** What the Location field offers: the firm's own offices and its rooms, from the shared context. */
  const locations = $derived(context.locations);
  const resources = $derived(context.resources);

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
          // This sheet keeps its own long form ("Tuesday, September 15, 2026") rather than the
          // standard one, which is a per-sheet choice; the instant half is the shared answer.
          date: longDate,
          instantDate: formatInstantDate,
          time: (time, timeZone, on) => formatWallClock(time, timeZone, context.readerTimeZone, on),
          printedAt: formatInstant(new Date()),
        }),
  );

  const linkCount = $derived(linkCountOf(record, relatedCount));
  const participantCount = $derived(participantCountOf(record));

  // ---- the shapes drawn while a read is in flight -----------------------------------------------
  //
  // The record pane's shape is the kind's own field groups over sample words, greyed by the loading
  // region; the kind is on the reference before the read lands, so a deadline never opens on an
  // event's shape. The timing fields bind a draft, so the sample timing is state the fields could
  // write into and never do (the region is inert). Sample words only, never a record's own: the
  // names and the description are the sample vocabulary's; the civil dates stay literal because
  // the pickers take the wire shape, which the vocabulary does not carry.
  const FIXTURE_DATE = civilDateValue(sampleCivilDate(3));
  let fixtureTiming = $state<EventTimingDraft>({
    startsOn: sampleCivilDate(3),
    startsAtTime: "10:30",
    endsOn: null,
    endsAtTime: "11:30",
    timeZone: "America/Chicago",
  });
  const PARTICIPANT_FIXTURE: readonly EventParticipant[] = [
    {
      id: "fixture-participant-counsel",
      participantKind: "member",
      memberUserId: null,
      entityId: null,
      participantName: samplePerson(0).name,
      role: "Lead counsel",
    },
    {
      id: "fixture-participant-reporter",
      participantKind: "external",
      memberUserId: null,
      entityId: null,
      participantName: samplePerson(1).name,
      role: "Court reporter",
    },
  ];
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
      <Badge variant={deadlineTone(record.deadline)}>{deadlineStateBadgeLabel(record.deadline)}</Badge>
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
{#snippet fixtureFields(kind: EntryReferenceKind)}
  <div class="flex flex-col gap-4">
    <Label for="{idPrefix}-fixture-title">Title</Label>
    <Input
      id="{idPrefix}-fixture-title"
      value={kind === "deadline" ? "Responses to the first set of interrogatories" : "Status conference"}
      disabled
    />
  </div>
  {#if kind === "deadline"}
    <div class="grid gap-12 @md:grid-cols-2">
      <div class="flex flex-col gap-4">
        <DatePicker label="Due" value={FIXTURE_DATE} disabled />
      </div>
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-fixture-time">Time</Label>
        <Input id="{idPrefix}-fixture-time" value="17:00" disabled />
      </div>
    </div>
    <div class="grid gap-12 @md:grid-cols-2">
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-fixture-time-zone">Time zone</Label>
        <TimeZonePicker
          inputId="{idPrefix}-fixture-time-zone"
          label="Time zone"
          preferred={preferredZones}
          value="America/Chicago"
          disabled
        />
      </div>
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-fixture-priority">Priority</Label>
        <Input id="{idPrefix}-fixture-priority" value="2" disabled />
      </div>
    </div>
    <div class="flex flex-col gap-4">
      <Label for="{idPrefix}-fixture-authority">Authority</Label>
      <Input id="{idPrefix}-fixture-authority" value="Fed. R. Civ. P. 33(b)(2)" disabled />
    </div>
    <div class="grid gap-12 @md:grid-cols-2">
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-fixture-source">Source</Label>
        <Input id="{idPrefix}-fixture-source" value={deadlineSourceLabel("member")} disabled />
      </div>
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-fixture-state">State</Label>
        <Input id="{idPrefix}-fixture-state" value={deadlineStateLabel("open")} disabled />
      </div>
    </div>
  {:else}
    <EventTypeSelect
      id="{idPrefix}-fixture-type"
      items={typeItems}
      value={null}
      disabled
      onchange={() => undefined}
    />
    <RecordTimingFields
      bind:draft={fixtureTiming}
      idPrefix="{idPrefix}-fixture-timing"
      preferred={preferredZones}
      disabled
    />
    {#if kind === "event"}
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label for="{idPrefix}-fixture-location">Location</Label>
          <Input id="{idPrefix}-fixture-location" value="Department 12" disabled />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="{idPrefix}-fixture-court-reference">Court reference</Label>
          <Input id="{idPrefix}-fixture-court-reference" value="A-26-901234-C" disabled />
        </div>
      </div>
    {:else}
      <div class="grid gap-12 @md:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label for="{idPrefix}-fixture-audience">Audience</Label>
          <Input
            id="{idPrefix}-fixture-audience"
            value={firmEventAudienceLabel("all_members")}
            disabled
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label id="{idPrefix}-fixture-office-label">Office</Label>
          <Select.Root type="single" items={officeItems} value="" disabled>
            <Select.Trigger aria-labelledby="{idPrefix}-fixture-office-label">
              <Select.Value placeholder={placeholderOf("Office")} />
            </Select.Trigger>
          </Select.Root>
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-fixture-location">Location</Label>
        <Input id="{idPrefix}-fixture-location" value="Main office, the boardroom" disabled />
      </div>
    {/if}
    <div class="flex flex-col gap-4">
      <Label for="{idPrefix}-fixture-description">Description</Label>
      <Textarea
        id="{idPrefix}-fixture-description"
        class="resize-none"
        rows={3}
        value={SAMPLE_SENTENCE}
        disabled
      />
    </div>
  {/if}
{/snippet}

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

    {#if unreachableDeadline}
      <p class="text-sm text-text-muted">
        This deadline is not in the window on screen. Move to its month to open it.
      </p>
    {:else}
      <LoadingRegion
        loading={record === null}
        failed={readFailure !== null}
        label="Reading the record"
        onRetry={reread}
        class="flex flex-col gap-16"
      >
        {#snippet failure()}
          {#if readFailure !== null}
            <FailureNotice
              failure={readFailure.failure}
              title="The Record Could Not Be Read"
              fallback={readFailure.fallback}
              onRetry={reread}
            />
          {/if}
        {/snippet}
        {#snippet fixture()}
          {@render fixtureFields(current?.kind ?? "event")}
        {/snippet}
        {#if record?.kind === "event" && eventDraft !== null}
          {@const draft = eventDraft}
          <div class="flex flex-col gap-4">
            <Label for="{idPrefix}-title">Title</Label>
            <Input id="{idPrefix}-title" disabled={readOnly} bind:value={draft.title} />
          </div>
          <EventTypeSelect
            id="{idPrefix}-type"
            items={typeItems}
            value={draft.eventTypeId}
            disabled={readOnly}
            onchange={(value) => (draft.eventTypeId = value)}
          />
          <RecordTimingFields
            bind:draft={eventDraft}
            idPrefix="{idPrefix}-timing"
            preferred={preferredZones}
            shortfalls={fieldShortfalls}
            disabled={readOnly}
          />
          <RecurrenceField
            bind:rule={draft.recurrence}
            startsOn={draft.startsOn}
            idPrefix="{idPrefix}-repeat"
            disabled={readOnly}
            unreadable={record.event.recurrenceRule !== null && draft.recurrence === null}
          />
          <div class="grid gap-12 @md:grid-cols-2">
            <div class="flex flex-col gap-4">
              <Label for="{idPrefix}-location">Location</Label>
              <LocationPicker
                inputId="{idPrefix}-location"
                {locations}
                {resources}
                disabled={readOnly}
                bind:value={draft.locationText}
              />
            </div>
            <div class="flex flex-col gap-4">
              <Label for="{idPrefix}-court-reference">Court reference</Label>
              <Input
                id="{idPrefix}-court-reference"
                disabled={readOnly}
                bind:value={draft.courtReference}
              />
            </div>
          </div>
          <!-- Where it is JOINED, where it is online: its own field, because a setting can be in a
               room and on a call at once. -->
          <div class="flex flex-col gap-4">
            <Label for="{idPrefix}-conference-url">Conference link</Label>
            <Input
              id="{idPrefix}-conference-url"
              type="url"
              inputmode="url"
              autocomplete="off"
              spellcheck={false}
              disabled={readOnly}
              bind:value={draft.conferenceUrl}
            />
          </div>
          <div class="flex flex-col gap-4">
            <Label for="{idPrefix}-description">Description</Label>
            <Textarea
              id="{idPrefix}-description"
              class="resize-none"
              rows={3}
              disabled={readOnly}
              bind:value={draft.description}
            />
          </div>
        {:else if record?.kind === "deadline" && deadlineDraft !== null}
          {@const draft = deadlineDraft}
          <div class="flex flex-col gap-4">
            <Label for="{idPrefix}-title">Title</Label>
            <Input id="{idPrefix}-title" disabled={readOnly} bind:value={draft.title} />
          </div>
          <div class="grid gap-12 @md:grid-cols-2">
            <div class="flex flex-col gap-4">
              <DatePicker
                label="Due"
                value={civilDateValue(draft.dueOn)}
                disabled={readOnly}
                onValueChange={(picked) => (draft.dueOn = picked === undefined ? null : picked.toString())}
              />
            </div>
            <div class="flex flex-col gap-4">
              <Label for="{idPrefix}-time">Time</Label>
              <Input
                id="{idPrefix}-time"
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
              <Label for="{idPrefix}-time-zone">Time zone</Label>
              <TimeZonePicker
                inputId="{idPrefix}-time-zone"
                label="Time zone"
                preferred={preferredZones}
                disabled={readOnly}
                bind:value={draft.timeZone}
              />
            </div>
            <div class="flex flex-col gap-4">
              <Label for="{idPrefix}-priority">Priority</Label>
              <Input
                id="{idPrefix}-priority"
                inputmode="numeric"
                placeholder={placeholderOf("Priority")}
                title="1 is the most urgent, {DEADLINE_PRIORITY_MAX} the least; empty for none"
                disabled={readOnly}
                bind:value={draft.priority}
              />
            </div>
          </div>
          <div class="flex flex-col gap-4">
            <Label for="{idPrefix}-authority">Authority</Label>
            <Input
              id="{idPrefix}-authority"
              title="The rule, statute or order this comes from, in the firm's own words"
              disabled={readOnly}
              bind:value={draft.authorityText}
            />
          </div>
          <div class="grid gap-12 @md:grid-cols-2">
            <div class="flex flex-col gap-4">
              <Label for="{idPrefix}-source">Source</Label>
              <!-- Frozen on the record: where a deadline came from is a fact about its recording. -->
              <Input id="{idPrefix}-source" value={deadlineSourceLabel(draft.source)} disabled />
            </div>
            <div class="flex flex-col gap-4">
              <Label for="{idPrefix}-state">State</Label>
              <Input id="{idPrefix}-state" value={deadlineStateWord(record.deadline)} disabled />
            </div>
          </div>
          {#if record.deadline.state !== "open" && record.deadline.stateReason !== null}
            <div class="flex flex-col gap-4">
              <Label for="{idPrefix}-state-reason">Reason</Label>
              <Textarea
                id="{idPrefix}-state-reason"
                class="resize-none"
                rows={2}
                value={record.deadline.stateReason}
                disabled
              />
            </div>
          {/if}
        {:else if record?.kind === "firmEvent" && firmEventDraft !== null}
          {@const draft = firmEventDraft}
          <div class="flex flex-col gap-4">
            <Label for="{idPrefix}-title">Title</Label>
            <Input id="{idPrefix}-title" disabled={readOnly} bind:value={draft.title} />
          </div>
          <EventTypeSelect
            id="{idPrefix}-type"
            items={typeItems}
            value={draft.eventTypeId}
            disabled={readOnly}
            onchange={(value) => (draft.eventTypeId = value)}
          />
          <RecordTimingFields
            bind:draft={firmEventDraft}
            idPrefix="{idPrefix}-timing"
            preferred={preferredZones}
            shortfalls={fieldShortfalls}
            disabled={readOnly}
          />
          <RecurrenceField
            bind:rule={draft.recurrence}
            startsOn={draft.startsOn}
            idPrefix="{idPrefix}-repeat"
            disabled={readOnly}
            unreadable={record.event.recurrenceRule !== null && draft.recurrence === null}
          />
          <div class="grid gap-12 @md:grid-cols-2">
            <div class="flex flex-col gap-4">
              <Label for="{idPrefix}-audience">Audience</Label>
              <!-- Who an event is for is decided when it is recorded; a list that grew or shrank
                   afterwards would change whose calendar it is on without anybody choosing that. -->
              <Input id="{idPrefix}-audience" value={firmEventAudienceLabel(draft.audience)} disabled />
            </div>
            <div class="flex flex-col gap-4">
              <Label id="{idPrefix}-office-label">Office</Label>
              <Select.Root
                type="single"
                items={officeItems}
                value={draft.locationId ?? ""}
                onValueChange={(value) => (draft.locationId = value === "" ? null : value)}
                disabled={readOnly || officeItems.length === 0}
              >
                <Select.Trigger aria-labelledby="{idPrefix}-office-label">
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
            <Label for="{idPrefix}-location">Location</Label>
            <LocationPicker
              inputId="{idPrefix}-location"
              {locations}
              {resources}
              disabled={readOnly}
              bind:value={draft.locationText}
            />
          </div>
          <!-- Where it is JOINED, where it is online: its own field, because a setting can be in a
               room and on a call at once. -->
          <div class="flex flex-col gap-4">
            <Label for="{idPrefix}-conference-url">Conference link</Label>
            <Input
              id="{idPrefix}-conference-url"
              type="url"
              inputmode="url"
              autocomplete="off"
              spellcheck={false}
              disabled={readOnly}
              bind:value={draft.conferenceUrl}
            />
          </div>
          <div class="flex flex-col gap-4">
            <Label for="{idPrefix}-description">Description</Label>
            <Textarea
              id="{idPrefix}-description"
              class="resize-none"
              rows={3}
              disabled={readOnly}
              bind:value={draft.description}
            />
          </div>
        {/if}
      </LoadingRegion>
    {/if}
  </div>
{/snippet}

{#snippet participantTable(rows: readonly EventParticipant[])}
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
      {#each rows as participant (participant.id)}
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
{/snippet}

{#snippet participantsTab()}
  {#if record === null && !reading}
    <!-- No record and no read in flight: the record pane states why, so this pane stays quiet. -->
    <p class="text-sm text-text-muted">&nbsp;</p>
  {:else}
    <LoadingRegion loading={record === null} label="Reading who is at this event">
      {#snippet fixture()}
        {@render participantTable(PARTICIPANT_FIXTURE)}
      {/snippet}
      {#if record?.kind === "deadline"}
        <p class="text-sm text-text-muted">Nobody is listed.</p>
      {:else if record?.kind === "firmEvent" && record.event.audience === "all_members"}
        <p class="text-sm">Everyone at the firm.</p>
      {:else if editing && record?.kind === "event" && eventDraft !== null}
        <!--
          Editing: the same picker the record form uses, over the draft's own list, so adding
          somebody to a setting already recorded is the gesture it is on the form (owner,
          2026-09-14: "in the modal it doesn't allow me to set new participants"). Touching it is
          what marks the list as this correction's to send; a correction that never opens this tab
          still sends no participants at all, which is the rule that mattered.
        -->
        {@render participantEditor()}
        <ParticipantPicker
          inputId="{idPrefix}-edit-participants"
          members={context.members}
          disabled={saving}
          bind:participants={
            () => eventDraft?.participants ?? [],
            (next) => {
              if (eventDraft === null) return;
              eventDraft.participants = next;
              participantsEdited = true;
            }
          }
        />
      {:else if editing && record?.kind === "firmEvent" && firmEventDraft !== null}
        {@render participantEditor()}
        <ParticipantPicker
          inputId="{idPrefix}-edit-firm-participants"
          members={context.members}
          disabled={saving}
          bind:participants={
            () => firmEventDraft?.participants ?? [],
            (next) => {
              if (firmEventDraft === null) return;
              firmEventDraft.participants = next;
              participantsEdited = true;
            }
          }
        />
      {:else if record !== null && record.participants.length === 0}
        <p class="text-sm text-text-muted">Nobody is listed.</p>
      {:else if record !== null}
        {@render participantTable(record.participants)}
      {/if}
    </LoadingRegion>
  {/if}
{/snippet}

<!-- What the editing pane says above the picker, so a reader knows the change rides the window's
     own Save rather than landing as they type. -->
{#snippet participantEditor()}
  <p class="mb-8 text-xs text-text-muted">
    Who is at this setting. Changes here are saved with the rest of the record.
  </p>
{/snippet}

{#snippet roomsTabContent()}
  <EntryRoomsTab
    bind:this={roomsTab}
    {record}
    {reading}
    readerTimeZone={context.readerTimeZone}
    verbRefusal={eventVerbRefusal}
    bind:bookingCount
    {onChanged}
  />
{/snippet}

{#snippet linksTabContent()}
  <EntryLinksTab
    bind:this={linksTab}
    {record}
    {reading}
    verbRefusal={eventVerbRefusal}
    bind:relatedCount
    onOpen={openReference}
  />
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
        title={eventVerbRefusal ?? "Link this setting to another on the same matter"}
        onclick={() => void linksTab?.openRelate()}
      >
        Link Settings
      </Button>
      <!-- Where the setting is JOINED, beside the verbs that change it. A meeting hangs off this
           one entry, so this is where it is opened and where it is gone back into. -->
      <MeetingEntryAction
        eventKind="matter"
        eventId={current.recordId}
        startable={record === null || record.kind !== "event" || record.event.status !== "cancelled"}
      />
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
        title={eventVerbRefusal ?? "Link this event to another of the firm's"}
        onclick={() => void linksTab?.openRelate()}
      >
        Link Events
      </Button>
      <MeetingEntryAction
        eventKind="firm"
        eventId={current.recordId}
        startable={record === null ||
          record.kind !== "firmEvent" ||
          record.event.status !== "cancelled"}
      />
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
    { key: "links", label: "Links", count: linkCount, content: linksTabContent },
    { key: "rooms", label: "Rooms", count: bookingCount, content: roomsTabContent },
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
  commitRefusal={continueRefusal?.sentence}
  unsavedChanges={continueStarted}
  width="wide"
  onCommit={commitContinue}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <!-- The same timing fields the record forms ask; the date is the one the old setting lacks. -->
      <RecordTimingFields
        bind:draft={continueDraft}
        idPrefix="{idPrefix}-continue"
        preferred={preferredZones}
        disabled={busy}
      />
      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label for="{idPrefix}-continue-location">Location</Label>
          <LocationPicker
            inputId="{idPrefix}-continue-location"
            {locations}
            {resources}
            disabled={busy}
            bind:value={continueDraft.locationText}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="{idPrefix}-continue-court-reference">Court reference</Label>
          <Input
            id="{idPrefix}-continue-court-reference"
            disabled={busy}
            bind:value={continueDraft.courtReference}
          />
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-continue-conference-url">Conference link</Label>
        <Input
          id="{idPrefix}-continue-conference-url"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck={false}
          disabled={busy}
          bind:value={continueDraft.conferenceUrl}
        />
      </div>
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-continue-reason">Reason</Label>
        <Textarea
          id="{idPrefix}-continue-reason"
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
  heading="Review the Linked Deadlines"
  commitLabel="Understood"
  unsavedChanges={false}
  onCommit={acknowledgeContinued}
>
  {#snippet fields()}
    <p class="text-sm text-text-muted">
      No deadline was moved. Each one still stands where it was against the vacated setting.
    </p>
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
  mattersReading={context.mattersReading}
    preferredTimeZones={[context.readerTimeZone]}
    initialDate={record.deadline.dueOn}
    supersedes={record.deadline}
    onRecorded={() => landed()}
  />
{/if}


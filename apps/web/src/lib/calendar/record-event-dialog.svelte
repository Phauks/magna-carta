<script lang="ts">
  /*
   * Recording a setting on a matter: a hearing, a deposition, a closing, a meeting.
   *
   * THREE ANSWERS ARE REQUIRED AND THE REST ARE NOT. A title, a date, and the zone the event
   * happens in. The zone is asked rather than assumed because a hearing's zone is the court's, and
   * nothing about the firm can work that out. Everything else is optional, and the form refuses
   * only where the optional parts contradict each other. Those rules live in event-draft.ts, so the
   * refusal shown beside the commit is asserted without a browser; this file renders it.
   *
   * THIS IS THE ONLY RECORD FORM FOR AN EVENT, and the first question it asks is who the event
   * BELONGS TO. There were two forms until 2026-09-16 — this one and a firm-event form beside it —
   * which meant a reader had to know, before opening anything, whether the thing they were about to
   * record was firm business, and had to close one panel and open the other on finding out they had
   * guessed wrong. They asked for nearly the same answers in nearly the same order and drifted
   * anyway (owner: "firm events and events should be the exact same"). One form now, and the
   * question that used to be answered by which menu item you picked is a control at the top of it.
   *
   * TWO CHOICES AND NO THIRD (owner ruling, 2026-09-16). Matter writes a `matter_event`; Firm writes
   * a `firm_event`. There is no None, because there is no third table for one to land in and
   * inventing a third word for the same row would put two records on the calendar that nothing
   * could tell apart afterwards. A personal appointment is a firm event with only the one person on
   * it, which is what the `participants` audience already means.
   *
   * WHAT THE CHOICE REVEALS IS THE PART THAT GENUINELY DIFFERS. Matter reveals the matter picker
   * beside it; Firm reveals the audience — everyone at the firm, or the people listed — and the
   * office, which is a real foreign key on a firm event because it is what says which rooms are
   * nearby. Everything else is the same question in the same order for both, which is what the two
   * forms were failing to be.
   *
   * THE MATTER IS FIXED WHERE THE FORM WAS OPENED FROM ONE. On a matter's own calendar there is
   * nothing to choose, and nothing to fall back to.
   *
   * THE DAY BEING BOOKED STANDS BESIDE THE FIELDS. A person choosing a time needs to know who is
   * already busy at it, so the panel's context pane carries that day's calendar (owner ruling,
   * 2026-09-14). It is the product's one calendar with a day view and no toolbar — never a second
   * rendering of one — and it follows the date field as it is answered.
   *
   * THE KEY IS MINTED PER ATTEMPT. A retried submit must not put a second hearing on the calendar:
   * the key is minted when an attempt starts and kept while nothing answered, so pressing again
   * after a dropped connection repeats the same write rather than making a second one. A server
   * that answered, with a record or a refusal, ends the attempt and the next press is a new one.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import {
    createBooking,
    createFirmEvent,
    createMatterEvent,
    type CreateFirmEventRequest,
    type EventType,
    type FirmEventAudience,
    type FirmResource,
  } from "./calendar-api.ts";
  import {
    emptyEventDraft,
    eventDraftReady,
    eventDraftRequest,
    eventDraftShortfalls,
    EVENT_FIELDS,
    eventDraftStarted,
    type EventDraft,
    type ParticipantDraft,
  } from "./event-draft.ts";
  import ParticipantPicker from "./participant-picker.svelte";
  import EventTypeSelect from "./event-type-select.svelte";
  import RecordTimingFields from "./record-timing-fields.svelte";
  import RecurrenceField from "./recurrence-field.svelte";
  import FieldRefusal from "./field-refusal.svelte";
  import { shortfallFor } from "./shortfall.ts";
  import LocationPicker from "./location-picker.svelte";
  import { roomForLocation, roomNotHeldSentence } from "./room-location.ts";
  import DaySchedule from "./day-schedule.svelte";
  import { firmEventDraftRequest, type FirmEventDraft } from "./firm-event-draft.ts";
  import type { LocationSummary } from "$lib/matters/matters-api.ts";

  let {
    open = $bindable(false),
    matterId,
    matters,
    mattersCapped,
    mattersReading = false,
    eventTypes,
    members,
    locations = [],
    resources = [],
    preferredTimeZones,
    initialDate,
    initialTitle = "",
    initialParticipants = [],
    initialTime = null,
    onRecorded,
  }: {
    open?: boolean;
    /** The matter the form was opened from, or null where the reader picks one. */
    matterId: string | null;
    /** The firm's matters, for the picker. Unused where the matter is fixed. */
    matters: readonly SheetMatter[];
    /** Whether `matters` is a page of the record rather than all of it. */
    mattersCapped: boolean;
    /** Whether the firm's matters are still being read, so the picker does not say there are none. */
    mattersReading?: boolean;
    /** The firm's event-type catalog. Inactive types are dropped here. */
    eventTypes: readonly EventType[];
    /** The firm's roster, for the participant picker. */
    members: readonly FirmMemberSummary[];
    /** The firm's offices, which the Location field offers. */
    locations?: readonly LocationSummary[];
    /** The firm's bookable things; its rooms are the other half of what Location offers. */
    resources?: readonly FirmResource[];
    /** The zones offered first: the reader's own and the firm's offices, in that order. */
    preferredTimeZones: readonly string[];
    /** The date the form opens on, where it was opened from a day. */
    initialDate: string | null;
    /** The wall clock the form opens on, where it was opened from an hour on a day grid. */
    initialTime?: string | null;
    /** A title the surface already knows — "Consultation with Rosalind Chase" from the intake desk. */
    initialTitle?: string;
    /** People the surface already knows are attending: the client, the responsible attorney. Editable. */
    initialParticipants?: readonly ParticipantDraft[];
    onRecorded: (recorded: { id: string; matterId: string | null }) => void;
  } = $props();

  const idPrefix = $props.id();

  let draft = $state<EventDraft>(emptyEventDraft("", null));
  /** The draft as it was when the panel opened, so "anything entered" is a comparison, not a flag. */
  let since = $state<EventDraft>(emptyEventDraft("", null));
  let chosenMatterId = $state<string | null>(null);
  /**
   * Who the event belongs to. Two arms and no third, because there are two tables and a third word
   * for the same row would be a distinction nothing could read back.
   */
  let belongsTo = $state<"matter" | "firm">("matter");
  /** Only a firm event has these: who sees it, and which office it is at. */
  let audience = $state<FirmEventAudience>("participants");
  let officeId = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);
  /** The idempotency key of the attempt in flight or left unanswered; null between attempts. */
  let attemptKey: string | null = null;

  /*
   * The matter this will be recorded on, or null for a firm event. Opened FROM a matter there is
   * nothing to choose and nothing to fall back to, so the switch is not drawn at all; otherwise it
   * is the picked matter, and choosing Firm discards it rather than carrying a matter on a record
   * that has no column for one.
   */
  const targetMatterId = $derived(
    matterId ?? (belongsTo === "matter" ? chosenMatterId : null),
  );
  const recordingForFirm = $derived(matterId === null && belongsTo === "firm");

  const BELONGS_TO = [
    { value: "matter", label: "A matter" },
    { value: "firm", label: "The firm" },
  ] as const;

  const AUDIENCES: readonly { value: FirmEventAudience; label: string }[] = [
    { value: "all_members", label: "Everyone at the firm" },
    { value: "participants", label: "The people listed" },
  ];

  /** The firm's offices, as the Office field offers them. A firm with none offers none. */
  const officeItems = $derived(
    locations.map((location) => ({ value: location.id, label: location.name })),
  );

  const typeItems = $derived(
    eventTypes
      .filter((eventType) => eventType.active)
      .map((eventType) => ({ value: eventType.id, label: eventType.name })),
  );

  const shortfalls = $derived(eventDraftShortfalls(draft));
  /*
   * Fields are marked only once a save was asked for and refused. A form that opens with every
   * unanswered field already marked has told the reader they are wrong for not having typed yet.
   */
  let saveAttempted = $state(false);
  const fieldShortfalls = $derived(saveAttempted ? shortfalls : []);
  const titleRefusal = $derived(shortfallFor(fieldShortfalls, EVENT_FIELDS.title));
  const conferenceRefusal = $derived(shortfallFor(fieldShortfalls, EVENT_FIELDS.conferenceUrl));

  /*
   * Why the commit is unavailable, or undefined when it is available. Stated beside the control it
   * refuses rather than hiding the control, so a reader is told which answer is still missing.
   */
  const refusal = $derived(eventDraftReady(draft) ? undefined : shortfalls[0]?.sentence);

  /**
   * What the commit will write. A matter makes it a setting on that case; no matter makes it the
   * firm's own event, which is the table an event belonging to no case has always lived in.
   */
  const commitLabel = $derived(recordingForFirm ? "Record Firm Event" : "Record Event");
  const commitBusyLabel = $derived(recordingForFirm ? "Recording Firm Event" : "Recording Event");

  const started = $derived(
    eventDraftStarted(draft, since) ||
      chosenMatterId !== null ||
      belongsTo !== "matter" ||
      officeId !== null,
  );

  function reset(): void {
    const timeZone = preferredTimeZones[0] ?? "";
    // The seeds are the draft's starting point and the baseline alike, so a window opened with a
    // title and two people and closed untouched does not ask about unsaved work.
    const seeded = (): EventDraft => ({
      ...emptyEventDraft(timeZone, initialDate),
      title: initialTitle,
      // The drafts are immutable records, so a fresh array is a fresh draft.
      participants: [...initialParticipants],
    });
    draft = seeded();
    since = seeded();
    chosenMatterId = null;
    saveAttempted = false;
    belongsTo = "matter";
    audience = "participants";
    officeId = null;
    failure = null;
    attemptKey = null;
  }

  /**
   * The same answers as a firm event, where the firm is who it belongs to. Every field the two
   * records share is carried straight across; the audience and the office are the two the reader
   * answered on the firm arm of the form, and nowhere else.
   */
  function asFirmEvent(): CreateFirmEventRequest {
    const asFirm: FirmEventDraft = {
      title: draft.title,
      eventTypeId: draft.eventTypeId,
      description: draft.description,
      startsOn: draft.startsOn,
      startsAtTime: draft.startsAtTime,
      endsOn: draft.endsOn,
      endsAtTime: draft.endsAtTime,
      timeZone: draft.timeZone,
      audience,
      locationId: officeId,
      locationText: draft.locationText,
      conferenceUrl: draft.conferenceUrl,
      recurrence: draft.recurrence,
      participants: draft.participants,
    };
    return firmEventDraftRequest(asFirm);
  }

  /**
   * A setting held in one of the firm's own rooms HOLDS that room.
   *
   * Location and Book a Room were two ways to say one thing and only one of them reached the room's
   * calendar (room-location.ts). The booking is a second write because it needs the event's id, so
   * it can fail after the event has landed — and a form that closed silently on that would leave
   * somebody believing a room was held that is not. The event is not unwound (it is a real record
   * and the reader asked for it); the dialog stays open and says which half did not happen.
   */
  async function holdTheRoom(event: { kind: "matterEvent" | "firmEvent"; id: string }): Promise<
    boolean
  > {
    const room = roomForLocation(draft.locationText, resources, locations);
    if (room === null) return true;
    const outcome = await createBooking(
      fetch,
      {
        resourceId: room.id,
        matterEventId: event.kind === "matterEvent" ? event.id : null,
        firmEventId: event.kind === "firmEvent" ? event.id : null,
      },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") return true;
    failure = stated(
      outcome.failure,
      roomNotHeldSentence(room.name),
      roomNotHeldSentence(room.name),
    );
    return false;
  }

  async function submit(): Promise<ActionOutcome> {
    saveAttempted = true;
    failure = null;
    const target = targetMatterId;
    attemptKey ??= crypto.randomUUID();
    const outcome =
      target === null
        ? await createFirmEvent(fetch, asFirmEvent(), attemptKey)
        : await createMatterEvent(fetch, target, eventDraftRequest(draft), attemptKey);
    if (outcome.kind === "ok") {
      attemptKey = null;
      const held = await holdTheRoom({
        kind: target === null ? "firmEvent" : "matterEvent",
        id: outcome.value.id,
      });
      // The event landed either way, so the grid is told either way; only the dialog's own
      // disposition differs.
      onRecorded({ id: outcome.value.id, matterId: target });
      return held ? "committed" : "refused";
    }
    // A refusal is an answer, so the attempt is over; silence is not, so the key is kept for the
    // retry and the same write is repeated rather than a second one made.
    if (outcome.kind === "problem") attemptKey = null;
    failure = stated(
      outcome.failure,
      "The event could not be recorded.",
      "Nothing answered. The event was not recorded, so pressing again records it once.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Record an Event"
  {commitLabel}
  {commitBusyLabel}
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet context()}
    <!-- Who is already busy that day, while the time is still being chosen. -->
    <DaySchedule date={draft.startsOn} />
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Event Was Not Recorded"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      {#if matterId === null}
        <!-- The first question, and the one that decides which record is written. The matter picker
             sits beside it on the same line rather than under it, because "a matter" and WHICH
             matter are one answer given in two presses (owner, 2026-09-16). -->
        <div class="grid gap-16 sm:grid-cols-2">
          <div class="flex flex-col gap-8">
            <Label id="{idPrefix}-belongs-to-label">Belongs to</Label>
            <RadioGroup.Root
              aria-labelledby="{idPrefix}-belongs-to-label"
              class="flex flex-row flex-wrap gap-16"
              disabled={busy}
              bind:value={
                () => belongsTo,
                (next) => {
                  if (next === "matter" || next === "firm") belongsTo = next;
                }
              }
            >
              {#each BELONGS_TO as choice (choice.value)}
                <div class="flex items-center gap-8">
                  <RadioGroup.Item value={choice.value} id="{idPrefix}-belongs-{choice.value}" />
                  <Label for="{idPrefix}-belongs-{choice.value}">{choice.label}</Label>
                </div>
              {/each}
            </RadioGroup.Root>
          </div>
          {#if belongsTo === "matter"}
            <div class="flex flex-col gap-8">
              <Label for="{idPrefix}-matter">Matter</Label>
              <MatterPicker
                inputId="{idPrefix}-matter"
                {matters}
                capped={mattersCapped}
                reading={mattersReading}
                value={chosenMatterId}
                disabled={busy}
                onpick={(picked) => (chosenMatterId = picked)}
              />
            </div>
          {/if}
        </div>
      {/if}

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-title">Title</Label>
          <Input
            id="{idPrefix}-title"
            aria-invalid={titleRefusal === undefined ? undefined : "true"}
            disabled={busy}
            bind:value={draft.title}
          />
          <FieldRefusal refusal={titleRefusal} />
        </div>
        <EventTypeSelect
          id="{idPrefix}-type"
          items={typeItems}
          value={draft.eventTypeId}
          disabled={busy}
          onchange={(value) => (draft.eventTypeId = value)}
        />
      </div>

      <RecordTimingFields
        bind:draft
        idPrefix="{idPrefix}-timing"
        preferred={preferredTimeZones}
        shortfalls={fieldShortfalls}
        disabled={busy}
      />

      <RecurrenceField
        bind:rule={draft.recurrence}
        startsOn={draft.startsOn}
        idPrefix="{idPrefix}-repeat"
        disabled={busy}
      />

      {#if recordingForFirm}
        <!-- The two questions only a firm event answers. Audience decides whether the participants
             list below means anything at all: an all-members event is on every calendar by
             construction and carries no list to decay when somebody joins or leaves. -->
        <div class="flex flex-col gap-8">
          <Label id="{idPrefix}-audience-label">Audience</Label>
          <RadioGroup.Root
            aria-labelledby="{idPrefix}-audience-label"
            class="flex flex-row flex-wrap gap-16"
            disabled={busy}
            bind:value={
              () => audience,
              (next) => {
                if (next === "all_members" || next === "participants") audience = next;
              }
            }
          >
            {#each AUDIENCES as choice (choice.value)}
              <div class="flex items-center gap-8">
                <RadioGroup.Item value={choice.value} id="{idPrefix}-audience-{choice.value}" />
                <Label for="{idPrefix}-audience-{choice.value}">{choice.label}</Label>
              </div>
            {/each}
          </RadioGroup.Root>
        </div>
      {/if}

      <div class="grid gap-16 sm:grid-cols-2">
        {#if recordingForFirm}
          <!-- The office is a real foreign key on a firm event — it is what says which rooms are
               nearby — where the location beside it is the free text a venue is. -->
          <div class="flex flex-col gap-8">
            <Label id="{idPrefix}-office-label">Office</Label>
            <Select.Root
              type="single"
              items={officeItems}
              value={officeId ?? ""}
              onValueChange={(value) => (officeId = value === "" ? null : value)}
              disabled={busy || officeItems.length === 0}
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
        {/if}
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-location">Location</Label>
          <LocationPicker
            inputId="{idPrefix}-location"
            {locations}
            {resources}
            disabled={busy}
            bind:value={draft.locationText}
          />
        </div>
        {#if !recordingForFirm}
          <!-- The court's own number for the case. A firm meeting has no court, so the field is
               absent rather than shown empty and ignored. -->
          <div class="flex flex-col gap-8">
            <Label for="{idPrefix}-court-reference">Court reference</Label>
            <Input
              id="{idPrefix}-court-reference"
              disabled={busy}
              bind:value={draft.courtReference}
            />
          </div>
        {/if}
      </div>

      <!-- Where it is JOINED, where it is online. Its own field, because a deposition can be in a
           conference room and on a call at once and a firm that typed the link where the room goes
           has lost the room. -->
      <div class="flex flex-col gap-8">
        <Label for="{idPrefix}-conference-url">Conference link</Label>
        <Input
          id="{idPrefix}-conference-url"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck={false}
          aria-invalid={conferenceRefusal === undefined ? undefined : "true"}
          disabled={busy}
          bind:value={draft.conferenceUrl}
        />
        <FieldRefusal refusal={conferenceRefusal} />
      </div>

      <div class="flex flex-col gap-8">
        <Label for="{idPrefix}-description">Description</Label>
        <Textarea
          id="{idPrefix}-description"
          rows={2}
          disabled={busy}
          bind:value={draft.description}
        />
      </div>

      <!-- An all-members firm event lists nobody: it is on every calendar by construction, so a
           list here would be a list the record ignores. -->
      {#if !recordingForFirm || audience === "participants"}
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-participants">Participants</Label>
          <ParticipantPicker
            inputId="{idPrefix}-participants"
            {members}
            disabled={busy}
            bind:participants={draft.participants}
          />
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

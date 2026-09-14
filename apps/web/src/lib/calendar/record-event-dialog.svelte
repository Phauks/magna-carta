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
   * A MATTER IS NOT ONE OF THEM (owner ruling, 2026-09-14: "matter is not needed"). The form used
   * to stand refused, under "A matter is needed.", until a matter was picked — which made every
   * firm meeting somebody started from the calendar a dead end. NO MATTER IS A CHOICE, NOT AN
   * ABSENCE: the picker's own no-matter row says what the record becomes, and the form writes a
   * FIRM EVENT instead. That is not a fudge, it is the shape the data already has — `matter_event`
   * requires its matter by design, because every read of that table is "what happened on this
   * case"; an event that belongs to no case is what `firm_event` is, audience and all. So one
   * question ("which case, if any") decides which record is written, rather than a reader having to
   * know which of two menu items to have started from.
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
    type FirmResource,
  } from "./calendar-api.ts";
  import {
    emptyEventDraft,
    eventDraftReady,
    eventDraftRequest,
    eventDraftShortfalls,
    eventDraftStarted,
    type EventDraft,
    type ParticipantDraft,
  } from "./event-draft.ts";
  import ParticipantPicker from "./participant-picker.svelte";
  import EventTypeSelect from "./event-type-select.svelte";
  import RecordTimingFields from "./record-timing-fields.svelte";
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
  let failure = $state<StatedFailure | null>(null);
  /** The idempotency key of the attempt in flight or left unanswered; null between attempts. */
  let attemptKey: string | null = null;

  const targetMatterId = $derived(matterId ?? chosenMatterId);

  const typeItems = $derived(
    eventTypes
      .filter((eventType) => eventType.active)
      .map((eventType) => ({ value: eventType.id, label: eventType.name })),
  );

  const shortfalls = $derived(eventDraftShortfalls(draft));

  /*
   * Why the commit is unavailable, or undefined when it is available. Stated beside the control it
   * refuses rather than hiding the control, so a reader is told which answer is still missing.
   */
  const refusal = $derived(eventDraftReady(draft) ? undefined : shortfalls[0]);

  /**
   * What the commit will write. A matter makes it a setting on that case; no matter makes it the
   * firm's own event, which is the table an event belonging to no case has always lived in.
   */
  const commitLabel = $derived(targetMatterId === null ? "Record Firm Event" : "Record Event");
  const commitBusyLabel = $derived(
    targetMatterId === null ? "Recording Firm Event" : "Recording Event",
  );

  const started = $derived(eventDraftStarted(draft, since) || chosenMatterId !== null);

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
    failure = null;
    attemptKey = null;
  }

  /**
   * The same answers as a firm event, where no matter was chosen. Every field the two records share
   * is carried straight across; the audience is `participants`, because an event somebody recorded
   * for particular people is not a firm-wide holiday, and the participants they named ride with it.
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
      audience: "participants",
      locationId: null,
      locationText: draft.locationText,
      conferenceUrl: draft.conferenceUrl,
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
    const room = roomForLocation(draft.locationText, resources);
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
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-matter">Matter</Label>
          <!-- No matter is a CHOICE and the row says what choosing it writes, so nobody has to
               discover that an event with no case is the firm's own. -->
          <MatterPicker
            inputId="{idPrefix}-matter"
            {matters}
            capped={mattersCapped}
            value={chosenMatterId}
            noMatterLabel="No matter — record it as a firm event"
            disabled={busy}
            onpick={(picked) => (chosenMatterId = picked)}
          />
        </div>
      {/if}

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-title">Title</Label>
          <Input id="{idPrefix}-title" disabled={busy} bind:value={draft.title} />
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
        disabled={busy}
      />

      <div class="grid gap-16 sm:grid-cols-2">
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
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-court-reference">Court reference</Label>
          <Input
            id="{idPrefix}-court-reference"
            disabled={busy}
            bind:value={draft.courtReference}
          />
        </div>
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
          disabled={busy}
          bind:value={draft.conferenceUrl}
        />
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

      <div class="flex flex-col gap-8">
        <Label for="{idPrefix}-participants">Participants</Label>
        <ParticipantPicker
          inputId="{idPrefix}-participants"
          {members}
          disabled={busy}
          bind:participants={draft.participants}
        />
      </div>
    </div>
  {/snippet}
</ActionDialog>

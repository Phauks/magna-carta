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
   * THREE OWNERS AND TWO RECORDS. A matter writes a `matter_event`; the firm and a staff member both
   * write a `firm_event`, because a person's own appointment is a firm event with only that person
   * on it — the `participants` audience already means exactly that — and a third table for one
   * would put two records on the calendar that nothing could tell apart. The staff arm was added on
   * 2026-09-18 (owner: "we also need to be able to set for individual staff calendars") so a reader
   * can put something on ONE colleague's calendar without first working out that "the firm,
   * audience the people listed, participant: them" is how that is said. The control is the
   * product's one field for a closed choice (a combobox, never a select), and the second field on
   * its line is the answer the owner needs: WHICH matter, WHICH member, or — for the firm — who
   * sees it. One slot for all three, so switching between them moves nothing beneath (owner,
   * 2026-09-18: "changing between firm and matter causes reflow").
   *
   * THE LEFT SIDE IS IN TABS. The form asks about a matter, a title, a type, two dates, two times,
   * a zone, a repeat, a location, a court reference, a link, a description and a list of people;
   * one column of that scrolled beside the day being booked. Details, When, Where and Who each hold
   * their own group (event-draft.ts, `EVENT_FORM_TABS`), the way the new-matter panel's intake is
   * segmented. What differs by owner is placed on the tab the answer belongs to — the court
   * reference on Where for a matter, the office on Where for the firm, the audience on Details for
   * the firm — and in the same slot as its counterpart, so the tab keeps its shape whichever is
   * chosen.
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
  import * as Tabs from "@magna-carta/design-system/tabs";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import MemberPicker from "$lib/matters/member-picker.svelte";
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
    EVENT_FORM_TABS,
    EVENT_OWNER_OPTIONS,
    eventDraftStarted,
    isEventOwner,
    isMeetingChoice,
    MEETING_CHOICE_OPTIONS,
    meetingGuestsSentence,
    withMemberListed,
    type EventDraft,
    type EventFormTab,
    type EventOwner,
    type MeetingChoice,
    type ParticipantDraft,
  } from "./event-draft.ts";
  import MemberAvailability from "./member-availability.svelte";
  import { calendarContext } from "./calendar-context.svelte.ts";
  import ParticipantPicker from "./participant-picker.svelte";
  import EventTypeSelect from "./event-type-select.svelte";
  import RecordTimingFields from "./record-timing-fields.svelte";
  import RecurrenceField from "./recurrence-field.svelte";
  import FieldRefusal from "./field-refusal.svelte";
  import { shortfallFor } from "./shortfall.ts";
  import LocationPicker from "./location-picker.svelte";
  import { roomForLocation, roomNotHeldSentence, type OfficePlace } from "./room-location.ts";
  import DaySchedule from "./day-schedule.svelte";
  import { firmEventDraftRequest, type FirmEventDraft } from "./firm-event-draft.ts";

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
    initialMeeting = "none",
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
    /** The firm's offices, which the Location and Office fields offer. */
    locations?: readonly OfficePlace[];
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
    /**
     * The meeting the form opens on, for a surface that already knows the answer — the Meetings
     * page opens it on a video meeting, because that is what somebody arriving from there came to
     * do. Still editable: a preset is an opening answer, never a decision taken for the reader.
     */
    initialMeeting?: MeetingChoice;
    onRecorded: (recorded: {
      id: string;
      matterId: string | null;
      meetingId: string | null;
    }) => void;
  } = $props();

  const idPrefix = $props.id();

  let draft = $state<EventDraft>(emptyEventDraft("", null));
  /** The draft as it was when the panel opened, so "anything entered" is a comparison, not a flag. */
  let since = $state<EventDraft>(emptyEventDraft("", null));
  let chosenMatterId = $state<string | null>(null);
  /**
   * Who the event belongs to: a matter, the firm, or one staff member. Three arms over two
   * records, for the reason the file's comment gives.
   */
  let owner = $state<EventOwner>("matter");
  /** The colleague whose calendar this is, where the owner is a staff member. */
  let staffUserId = $state<string | null>(null);
  /** Only a firm event has these: who sees it, and which office it is at. */
  let audience = $state<FirmEventAudience>("participants");
  let officeId = $state<string | null>(null);
  /** The tab the reader is on. Details first, because that is where the first question is. */
  let section = $state<EventFormTab>("details");
  let failure = $state<StatedFailure | null>(null);
  /** The idempotency key of the attempt in flight or left unanswered; null between attempts. */
  let attemptKey: string | null = null;

  /*
   * The matter this will be recorded on, or null for a firm event. Opened FROM a matter there is
   * nothing to choose and nothing to fall back to, so the switch is not drawn at all; otherwise it
   * is the picked matter, and choosing the firm or a member discards it rather than carrying a
   * matter on a record that has no column for one.
   */
  const targetMatterId = $derived(matterId ?? (owner === "matter" ? chosenMatterId : null));
  /** Whether a firm event is what will be written: the firm's own, or one member's. */
  const recordingForFirm = $derived(matterId === null && owner !== "matter");
  /** The member a staff-owned event is for, where the owner is a staff member and one was picked. */
  const staffMember = $derived(
    owner === "staff" && staffUserId !== null
      ? (members.find((member) => member.userId === staffUserId) ?? null)
      : null,
  );
  /** Whether the people listed mean anything: an all-members firm event lists nobody. */
  const listsParticipants = $derived(!(owner === "firm" && audience === "all_members"));

  const AUDIENCES: readonly { value: FirmEventAudience; label: string }[] = [
    { value: "all_members", label: "Everyone at the firm" },
    { value: "participants", label: "The people listed" },
  ];

  function isAudience(value: string): value is FirmEventAudience {
    return AUDIENCES.some((choice) => choice.value === value);
  }

  /** The firm's offices, as the Office field offers them. A firm with none offers none. */
  const officeItems = $derived(
    locations.map((location) => ({ value: location.id, label: location.name })),
  );
  const NO_OFFICES = "The firm has no offices recorded, so there is none to choose.";

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
   * A staff-owned event needs its member, and says so where the commit is refused: without one
   * there is no calendar for it to land on, and a firm event with nobody listed would be the
   * firm's rather than theirs.
   */
  const STAFF_MEMBER_NEEDED = "A staff member is needed: whose calendar this is.";
  const ownerRefusal = $derived(
    owner === "staff" && staffMember === null ? STAFF_MEMBER_NEEDED : undefined,
  );

  /*
   * Why the commit is unavailable, or undefined when it is available. Stated beside the control it
   * refuses rather than hiding the control, so a reader is told which answer is still missing.
   */
  const refusal = $derived(
    ownerRefusal ?? (eventDraftReady(draft) ? undefined : shortfalls[0]?.sentence),
  );

  /**
   * What the commit will write. A matter makes it a setting on that case; no matter makes it the
   * firm's own event, which is the table an event belonging to no case has always lived in.
   */
  const commitLabel = $derived(recordingForFirm ? "Record Firm Event" : "Record Event");
  const commitBusyLabel = $derived(recordingForFirm ? "Recording Firm Event" : "Recording Event");

  const started = $derived(
    eventDraftStarted(draft, since) ||
      chosenMatterId !== null ||
      owner !== "matter" ||
      staffUserId !== null ||
      audience !== "participants" ||
      officeId !== null,
  );

  function reset(): void {
    const timeZone = preferredTimeZones[0] ?? "";
    // The seeds are the draft's starting point and the baseline alike, so a window opened with a
    // title and two people and closed untouched does not ask about unsaved work.
    const seeded = (): EventDraft => ({
      ...emptyEventDraft(timeZone, initialDate, initialMeeting),
      // The hour a day grid was double-clicked on, where it was; a day alone opens as all day.
      startsAtTime: initialTime ?? "",
      title: initialTitle,
      // The drafts are immutable records, so a fresh array is a fresh draft.
      participants: [...initialParticipants],
    });
    draft = seeded();
    since = seeded();
    chosenMatterId = null;
    saveAttempted = false;
    owner = "matter";
    staffUserId = null;
    audience = "participants";
    officeId = null;
    section = "details";
    failure = null;
    attemptKey = null;
  }

  /**
   * The same answers as a firm event, where the firm or one of its members is who it belongs to.
   * Every field the two records share is carried straight across; the audience and the office are
   * the two the reader answered on the firm arm of the form. A STAFF MEMBER'S event is the people-
   * listed audience with that member listed first, whether or not the reader also picked them —
   * that is what puts it on their calendar and nobody else's.
   */
  function asFirmEvent(): CreateFirmEventRequest {
    const member = staffMember;
    const asFirm: FirmEventDraft = {
      title: draft.title,
      eventTypeId: draft.eventTypeId,
      description: draft.description,
      startsOn: draft.startsOn,
      startsAtTime: draft.startsAtTime,
      endsOn: draft.endsOn,
      endsAtTime: draft.endsAtTime,
      timeZone: draft.timeZone,
      audience: member === null ? audience : "participants",
      locationId: officeId,
      locationText: draft.locationText,
      conferenceUrl: draft.conferenceUrl,
      recurrence: draft.recurrence,
      participants:
        member === null
          ? draft.participants
          : withMemberListed(draft.participants, member.userId, member.displayName),
      meeting: draft.meeting,
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
      onRecorded({
        id: outcome.value.id,
        matterId: target,
        meetingId: outcome.value.meetingId,
      });
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
    <Tabs.Root
      bind:value={
        () => section,
        (next) => {
          if (EVENT_FORM_TABS.some((tab) => tab.value === next)) section = next as EventFormTab;
        }
      }
      class="flex flex-col gap-16"
    >
      <Tabs.List>
        {#each EVENT_FORM_TABS as tab (tab.value)}
          <Tabs.Trigger value={tab.value}>{tab.label}</Tabs.Trigger>
        {/each}
      </Tabs.List>

      <!-- ---------- Details ---------- -->
      <Tabs.Content value="details" class="flex flex-col gap-16">
        {#if matterId === null}
          <!-- The first question, and the one that decides which record is written. The second
               field on the line is the answer the owner needs — WHICH matter, WHICH member, or who
               sees a firm event — in ONE slot, so choosing between them moves nothing beneath. -->
          <div class="grid gap-16 sm:grid-cols-2">
            <div class="flex flex-col gap-8">
              <Label for="{idPrefix}-belongs-to">Belongs to</Label>
              <ChoicePicker
                inputId="{idPrefix}-belongs-to"
                label="Belongs to"
                options={EVENT_OWNER_OPTIONS}
                value={owner}
                disabled={busy}
                onchange={(next) => {
                  if (isEventOwner(next)) owner = next;
                }}
              />
            </div>
            {#if owner === "matter"}
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
            {:else if owner === "staff"}
              <div class="flex flex-col gap-8">
                <Label for="{idPrefix}-staff-member">Staff member</Label>
                <MemberPicker
                  inputId="{idPrefix}-staff-member"
                  label="Staff member"
                  {members}
                  disabled={busy}
                  bind:value={staffUserId}
                />
                <FieldRefusal refusal={saveAttempted ? ownerRefusal : undefined} />
              </div>
            {:else}
              <!-- Audience decides whether the list on Who means anything at all: an all-members
                   event is on every calendar by construction and carries no list to decay when
                   somebody joins or leaves. -->
              <div class="flex flex-col gap-8">
                <Label for="{idPrefix}-audience">Audience</Label>
                <ChoicePicker
                  inputId="{idPrefix}-audience"
                  label="Audience"
                  options={AUDIENCES}
                  value={audience}
                  disabled={busy}
                  onchange={(next) => {
                    if (isAudience(next)) audience = next;
                  }}
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

        <!-- The description's height is the form's to decide, not the reader's: a grab corner
             here only pushed the tabs and the footer around (owner, 2026-09-18). -->
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-description">Description</Label>
          <Textarea
            id="{idPrefix}-description"
            rows={4}
            resizable={false}
            disabled={busy}
            bind:value={draft.description}
          />
        </div>
      </Tabs.Content>

      <!-- ---------- When ---------- -->
      <Tabs.Content value="when" class="flex flex-col gap-16">
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
      </Tabs.Content>

      <!-- ---------- Where ---------- -->
      <Tabs.Content value="where" class="flex flex-col gap-16">
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
          {#if recordingForFirm}
            <!-- The office is a real foreign key on a firm event — it is what says which rooms are
                 nearby — where the location beside it is the free text a venue is. -->
            <div class="flex flex-col gap-8">
              <Label for="{idPrefix}-office">Office</Label>
              <ChoicePicker
                inputId="{idPrefix}-office"
                label="Office"
                options={officeItems}
                value={officeId ?? ""}
                disabled={busy || officeItems.length === 0}
                title={officeItems.length === 0 ? NO_OFFICES : undefined}
                onchange={(next) => (officeId = next === "" ? null : next)}
              />
            </div>
          {:else}
            <!-- The court's own number for the case. A firm meeting has no court, so the office
                 takes this slot instead of the field being shown empty and ignored. -->
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

        <!-- SCHEDULING A MEETING IS RECORDING AN EVENT WITH A MEDIUM ON IT. One more answer on the
             form somebody was filling in anyway, and the entry window offers Join from the moment
             the event exists rather than from the moment somebody presses Start. It sits above the
             conference link because both answer where the setting is JOINED — and a reader who has
             chosen one can see they do not also need to paste the other. -->
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-meeting">Meeting</Label>
          <ChoicePicker
            inputId="{idPrefix}-meeting"
            label="Meeting"
            options={MEETING_CHOICE_OPTIONS}
            value={draft.meeting}
            disabled={busy}
            onchange={(next) => {
              if (isMeetingChoice(next)) draft.meeting = next;
            }}
          />
          {#if draft.meeting !== "none"}
            <!-- Said here rather than discovered later from a client who never arrived: only
                 colleagues are invited, because an external guest has no way in yet. It is the
                 record's own sentence, because a firm event tells NOBODY yet — a form promising a
                 message nothing sends would stop a member doing the one thing that gets their
                 colleagues into the room. -->
            <p class="text-sm text-text-muted">{meetingGuestsSentence(owner)}</p>
          {/if}
        </div>

        <!-- Where it is JOINED, where it is online. Its own field, because a deposition can be in a
             conference room and on a call at once and a firm that typed the link where the room
             goes has lost the room. -->
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
      </Tabs.Content>

      <!-- ---------- Who ---------- -->
      <Tabs.Content value="who" class="flex flex-col gap-16">
        {#if listsParticipants}
          {#if staffMember !== null}
            <!-- The member the event belongs to is on it by construction; the list beneath is who
                 else is there. -->
            <p class="text-sm text-text-muted">
              On {staffMember.displayName}'s calendar. Anyone else at the setting is listed here.
            </p>
          {/if}
          <div class="flex flex-col gap-8">
            <Label for="{idPrefix}-participants">Participants</Label>
            <ParticipantPicker
              inputId="{idPrefix}-participants"
              {members}
              disabled={busy}
              bind:participants={draft.participants}
            />
          </div>
          <!-- A read, never a refusal: the platform does not referee whether two things at once are
               wrong, and it does not decide who a member may book over. -->
          <MemberAvailability
            {open}
            participants={draft.participants}
            timing={draft}
            context={calendarContext.entryContext}
          />
        {:else}
          <!-- An all-members firm event lists nobody: it is on every calendar by construction, so a
               list here would be a list the record ignores. -->
          <p class="text-sm text-text-muted">
            Everyone at the firm is on this event, so there is no list to keep. Choose "The people
            listed" as the audience on Details to name who is at it.
          </p>
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  {/snippet}
</ActionDialog>

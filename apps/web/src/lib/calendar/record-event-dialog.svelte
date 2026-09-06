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
   * THE MATTER IS FIXED WHERE THE FORM WAS OPENED FROM ONE. On a matter's own calendar there is
   * nothing to choose; on the firm calendar the first field is the matter, picked from the docket.
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
  import MatterPicker from "$lib/matters/matter-picker.svelte";
  import type { SheetMatter } from "$lib/matters/matter-choice.ts";
  import { createMatterEvent, type EventType } from "./calendar-api.ts";
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

  let {
    open = $bindable(false),
    matterId,
    matters,
    mattersCapped,
    eventTypes,
    members,
    preferredTimeZones,
    initialDate,
    initialTitle = "",
    initialParticipants = [],
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
    /** The zones offered first: the reader's own and the firm's offices, in that order. */
    preferredTimeZones: readonly string[];
    /** The date the form opens on, where it was opened from a day. */
    initialDate: string | null;
    /** A title the surface already knows — "Consultation with Rosalind Chase" from the intake desk. */
    initialTitle?: string;
    /** People the surface already knows are attending: the client, the responsible attorney. Editable. */
    initialParticipants?: readonly ParticipantDraft[];
    onRecorded: (recorded: { id: string; matterId: string }) => void;
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
  const refusal = $derived.by(() => {
    if (targetMatterId === null) return "A matter is needed.";
    return eventDraftReady(draft) ? undefined : shortfalls[0];
  });

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

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    const target = targetMatterId;
    if (target === null) return "refused";
    attemptKey ??= crypto.randomUUID();
    const outcome = await createMatterEvent(fetch, target, eventDraftRequest(draft), attemptKey);
    if (outcome.kind === "ok") {
      attemptKey = null;
      onRecorded({ id: outcome.value.id, matterId: target });
      return "committed";
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
  commitLabel="Record Event"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  width="wide"
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
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
          <MatterPicker
            inputId="{idPrefix}-matter"
            {matters}
            capped={mattersCapped}
            value={chosenMatterId}
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
          <Label for="{idPrefix}-where">Where</Label>
          <Input id="{idPrefix}-where" disabled={busy} bind:value={draft.locationText} />
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

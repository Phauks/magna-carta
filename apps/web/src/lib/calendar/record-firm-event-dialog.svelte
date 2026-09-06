<script lang="ts">
  /*
   * Recording a firm event: a meeting, a closure, a holiday, a training. It belongs to the firm
   * rather than to any case, so it has no matter and, in place of one, an AUDIENCE.
   *
   * EVERYONE, OR THE PEOPLE LISTED. An all-members event is on every calendar by construction and
   * carries no list to decay when somebody joins or leaves; a participants event is on the
   * calendars of the people named. The picker therefore renders only for the second: a list under
   * "everyone" would be a list the record ignores, and the draft sends none for it
   * (firm-event-draft.ts).
   *
   * THE TIMING IS THE SAME FIELDS A MATTER EVENT HAS, through the one shared component, so the two
   * forms cannot disagree about how a date, a time or a zone is asked for. The office is optional
   * and so is the venue: a firm event usually happens at one of the firm's own offices, sometimes
   * offsite, and occasionally at both a named office and a room within it.
   *
   * THE KEY IS MINTED PER ATTEMPT, kept while nothing answered so a retry repeats the same write,
   * and dropped once the server has answered.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Select from "@magna-carta/design-system/select";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { LocationSummary } from "$lib/matters/matters-api.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import { createFirmEvent, type EventType, type FirmEventAudience } from "./calendar-api.ts";
  import {
    emptyFirmEventDraft,
    firmEventDraftReady,
    firmEventDraftRequest,
    firmEventDraftShortfalls,
    firmEventDraftStarted,
    type FirmEventDraft,
  } from "./firm-event-draft.ts";
  import ParticipantPicker from "./participant-picker.svelte";
  import EventTypeSelect from "./event-type-select.svelte";
  import RecordTimingFields from "./record-timing-fields.svelte";

  const AUDIENCES: readonly { value: FirmEventAudience; label: string }[] = [
    { value: "all_members", label: "Everyone at the firm" },
    { value: "participants", label: "The people listed" },
  ];

  let {
    open = $bindable(false),
    eventTypes,
    members,
    locations,
    preferredTimeZones,
    initialDate,
    onRecorded,
  }: {
    open?: boolean;
    /** The firm's event-type catalog. Inactive types are dropped here; the firm's own lead. */
    eventTypes: readonly EventType[];
    /** The firm's roster, for the participant picker. */
    members: readonly FirmMemberSummary[];
    /** The firm's offices. Closed ones are dropped here. */
    locations: readonly LocationSummary[];
    /** The zones offered first: the reader's own and the firm's offices, in that order. */
    preferredTimeZones: readonly string[];
    /** The date the form opens on, where it was opened from a day. */
    initialDate: string | null;
    onRecorded: (recorded: { id: string }) => void;
  } = $props();

  const idPrefix = $props.id();

  let draft = $state<FirmEventDraft>(emptyFirmEventDraft("", null));
  let since = $state<FirmEventDraft>(emptyFirmEventDraft("", null));
  let failure = $state<StatedFailure | null>(null);
  let attemptKey: string | null = null;

  /*
   * The firm's own category first, because that is what a firm event nearly always is; the rest
   * follow in catalog order so a firm that files its retreat under "other" still finds it.
   */
  const typeItems = $derived.by(() => {
    const active = eventTypes.filter((eventType) => eventType.active);
    const firm = active.filter((eventType) => eventType.category === "firm");
    const rest = active.filter((eventType) => eventType.category !== "firm");
    return [...firm, ...rest].map((eventType) => ({ value: eventType.id, label: eventType.name }));
  });

  const officeItems = $derived(
    locations
      .filter((location) => location.status === "active")
      .map((location) => ({ value: location.id, label: location.name })),
  );

  const shortfalls = $derived(firmEventDraftShortfalls(draft));
  const refusal = $derived(firmEventDraftReady(draft) ? undefined : shortfalls[0]);
  const started = $derived(firmEventDraftStarted(draft, since));

  function reset(): void {
    const timeZone = preferredTimeZones[0] ?? "";
    draft = emptyFirmEventDraft(timeZone, initialDate);
    since = emptyFirmEventDraft(timeZone, initialDate);
    failure = null;
    attemptKey = null;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    attemptKey ??= crypto.randomUUID();
    const outcome = await createFirmEvent(fetch, firmEventDraftRequest(draft), attemptKey);
    if (outcome.kind === "ok") {
      attemptKey = null;
      onRecorded({ id: outcome.value.id });
      return "committed";
    }
    if (outcome.kind === "problem") attemptKey = null;
    failure = stated(
      outcome.failure,
      "The firm event could not be recorded.",
      "Nothing answered. The firm event was not recorded, so pressing again records it once.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Record a Firm Event"
  commitLabel="Record Firm Event"
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
        title="The Firm Event Was Not Recorded"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
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

      <div class="flex flex-col gap-8">
        <Label id="{idPrefix}-audience-label">Audience</Label>
        <RadioGroup.Root
          aria-labelledby="{idPrefix}-audience-label"
          class="flex flex-row flex-wrap gap-16"
          disabled={busy}
          bind:value={
            () => draft.audience,
            (next) => {
              if (next === "all_members" || next === "participants") draft.audience = next;
            }
          }
        >
          {#each AUDIENCES as audience (audience.value)}
            <div class="flex items-center gap-8">
              <RadioGroup.Item value={audience.value} id="{idPrefix}-audience-{audience.value}" />
              <Label for="{idPrefix}-audience-{audience.value}">{audience.label}</Label>
            </div>
          {/each}
        </RadioGroup.Root>
      </div>

      {#if draft.audience === "participants"}
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

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label id="{idPrefix}-office-label">Office</Label>
          <Select.Root
            type="single"
            items={officeItems}
            value={draft.locationId ?? ""}
            onValueChange={(value) => (draft.locationId = value === "" ? null : value)}
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
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-venue">Venue</Label>
          <Input id="{idPrefix}-venue" disabled={busy} bind:value={draft.locationText} />
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
    </div>
  {/snippet}
</ActionDialog>

<script lang="ts">
  /*
   * Recording a deadline on a matter, or replacing one that is no longer the right date.
   *
   * A DEADLINE IS NOT AN EVENT. Two things are true of it that are not true of a hearing: it can be
   * satisfied, and it came from somewhere. So the form asks for the authority in the reader's own
   * words (the rule, the statute, the order) and never parses it, and it asks nothing that would
   * let the platform compute a date: every date here is one a person recorded. The rules that
   * decide whether the commit is available live in deadline-draft.ts; this file renders them.
   *
   * SUPERSEDING IS TWO WRITES, AND THE FORM SAYS WHICH ONE FAILED. A superseded deadline stays on
   * the record, marked as replaced and naming what replaced it, so the new deadline has to exist
   * before the old one can point at it. The new one is recorded first; if marking the old one then
   * fails, the notice says exactly that: the new deadline was recorded, the old one still stands.
   * The created id is held for the attempt, so pressing again retries only the second write and
   * never records the new deadline twice.
   *
   * THE KEYS ARE MINTED PER ATTEMPT, one per write, kept while nothing answered so a retry after a
   * dropped connection repeats the same write, and dropped once the server has answered.
   *
   * THE TIME IS A TIME FIELD, as it is on the event form (record-timing-fields.svelte): a text box
   * hoping for `HH:MM` accepted anything typed into it and said nothing until the commit refused.
   * A half-typed time reports an empty value, so the control's own `badInput` is read on every
   * input and handed to the draft, which refuses it rather than recording "end of day".
   *
   * A FIELD THAT IS WRONG SAYS SO BENEATH ITSELF, once the reader has left it: the same sentence
   * the commit bar shows, from the draft, with `aria-invalid` on the control (shortfall.ts states
   * the convention). Nothing is marked before the reader has been in the field.
   *
   * THERE IS NO "NO MATTER" HERE. A deadline is recorded on a matter and nowhere else, so the
   * matter picker leaves that row out rather than offering an answer the commit then refuses.
   */
  import DaySchedule from "./day-schedule.svelte";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { DateValue } from "@internationalized/date";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import {
    createDeadline,
    formatWallClock,
    supersedeDeadline,
    type CalendarDeadline,
    type DeadlineSource,
  } from "./calendar-api.ts";
  import {
    DEADLINE_FIELDS,
    deadlineDraftFrom,
    deadlineDraftRequest,
    deadlineDraftShortfalls,
    deadlineDraftStarted,
    deadlineSourceLabel,
    emptyDeadlineDraft,
    type DeadlineDraft,
  } from "./deadline-draft.ts";
  import { civilDateValue } from "./draft-text.ts";
  import FieldRefusal from "./field-refusal.svelte";
  import { shortfallFor } from "./shortfall.ts";
  import TimeZonePicker from "./time-zone-picker.svelte";
  import { civilDateText } from "$lib/dates";

  const SOURCES: readonly DeadlineSource[] = ["court_order", "member"];

  let {
    open = $bindable(false),
    matterId,
    matters,
    mattersCapped,
    mattersReading = false,
    preferredTimeZones,
    initialDate,
    supersedes,
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
    /** The zones offered first: the reader's own and the firm's offices, in that order. */
    preferredTimeZones: readonly string[];
    /** The date the form opens on, where it was opened from a day. */
    initialDate: string | null;
    /** The deadline the new one replaces, where this is a supersession; null to record afresh. */
    supersedes: CalendarDeadline | null;
    onRecorded: (recorded: { id: string; matterId: string }) => void;
  } = $props();

  const idPrefix = $props.id();

  let draft = $state<DeadlineDraft>(emptyDeadlineDraft("", null));
  let since = $state<DeadlineDraft>(emptyDeadlineDraft("", null));
  /** Why the old deadline is being replaced. Required only when superseding. */
  let reason = $state("");
  let chosenMatterId = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let failureTitle = $state("The Deadline Was Not Recorded");
  /** The new deadline's id once it exists, held so a retry never records it twice. */
  let createdId: string | null = null;
  let createKey: string | null = null;
  let supersedeKey: string | null = null;
  /** The time control holds a partial entry its empty value does not show. */
  let timeEntryUnfinished = $state(false);
  /** The reader has left the time field, so a refusal about it may be shown beneath it. */
  let timeVisited = $state(false);

  const superseding = $derived(supersedes !== null);
  const targetMatterId = $derived(supersedes?.matterId ?? matterId ?? chosenMatterId);
  const matterFixed = $derived(supersedes !== null || matterId !== null);

  const sourceItems = SOURCES.map((source) => ({
    value: source,
    label: deadlineSourceLabel(source),
  }));

  const shortfalls = $derived(deadlineDraftShortfalls(draft, { timeEntryUnfinished }));
  const timeRefusal = $derived(
    timeVisited ? shortfallFor(shortfalls, DEADLINE_FIELDS.dueAtTime) : undefined,
  );

  function readTimeEntry(event: Event & { currentTarget: HTMLInputElement }): void {
    timeEntryUnfinished = event.currentTarget.validity.badInput;
  }

  const refusal = $derived.by(() => {
    if (targetMatterId === null) return "A matter is needed.";
    if (shortfalls.length > 0) return shortfalls[0]?.sentence;
    if (superseding && reason.trim() === "") return "A reason is needed.";
    return undefined;
  });

  const started = $derived(
    deadlineDraftStarted(draft, since) || reason.trim() !== "" || chosenMatterId !== null,
  );

  const dueOnValue = $derived(civilDateValue(draft.dueOn));

  function recordDueOn(next: DateValue | undefined): void {
    draft.dueOn = civilDateText(next);
  }

  /** The replaced deadline, named once in the subtitle. */
  const supersededLine = $derived.by(() => {
    if (supersedes === null) return "";
    const clock = formatWallClock(
      supersedes.dueAtTime,
      supersedes.timeZone,
      undefined,
      supersedes.dueOn,
    );
    const due = formatDate(supersedes.dueOn);
    return `Replacing "${supersedes.title}", due ${clock === null ? due : `${due}, ${clock}`}.`;
  });

  /**
   * The draft the panel opens with. A supersession starts from the deadline it replaces, minus its
   * date: the title and the authority usually survive a continuance, and the date is the one thing
   * that certainly does not. The since-draft is the same object, so nothing reads as entered until
   * something is.
   */
  function openingDraft(): DeadlineDraft {
    const timeZone = preferredTimeZones[0] ?? "";
    if (supersedes === null) return emptyDeadlineDraft(timeZone, initialDate);
    return { ...deadlineDraftFrom(supersedes), dueOn: initialDate, dueAtTime: "" };
  }

  function reset(): void {
    draft = openingDraft();
    since = openingDraft();
    reason = "";
    chosenMatterId = null;
    failure = null;
    failureTitle = "The Deadline Was Not Recorded";
    createdId = null;
    createKey = null;
    supersedeKey = null;
    timeEntryUnfinished = false;
    timeVisited = false;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    const target = targetMatterId;
    if (target === null) return "refused";

    if (createdId === null) {
      createKey ??= crypto.randomUUID();
      const created = await createDeadline(fetch, target, deadlineDraftRequest(draft), createKey);
      if (created.kind !== "ok") {
        if (created.kind === "problem") createKey = null;
        failureTitle = "The Deadline Was Not Recorded";
        failure = stated(
          created.failure,
          "The deadline could not be recorded.",
          "Nothing answered. The deadline was not recorded, so pressing again records it once.",
        );
        return "refused";
      }
      createdId = created.value.id;
      createKey = null;
      onRecorded({ id: createdId, matterId: target });
      if (supersedes === null) return "committed";
    }

    if (supersedes === null) return "committed";
    supersedeKey ??= crypto.randomUUID();
    const marked = await supersedeDeadline(
      fetch,
      supersedes.id,
      { stateReason: reason.trim(), supersededByDeadlineId: createdId },
      supersedeKey,
    );
    if (marked.kind === "ok") {
      supersedeKey = null;
      onRecorded({ id: createdId, matterId: target });
      return "committed";
    }
    if (marked.kind === "problem") supersedeKey = null;
    failureTitle = "The Old Deadline Still Stands";
    failure = stated(
      marked.failure,
      "The new deadline was recorded, but the one it replaces could not be marked superseded. It still stands.",
      "Nothing answered. The new deadline was recorded; the one it replaces still stands, so pressing again marks it once.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading={superseding ? "Supersede a Deadline" : "Record a Deadline"}
  commitLabel={superseding ? "Supersede Deadline" : "Record Deadline"}
  commitBusyLabel={superseding ? "Superseding" : "Recording"}
  commitRefusal={refusal}

  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet subtitle()}
    {#if superseding}
      {supersededLine}
    {/if}
  {/snippet}

  {#snippet context()}
    <!-- The day the deadline falls on, so a person setting one can see what else is already due
         and who is in court that morning. -->
    <DaySchedule date={draft.dueOn} heading="That day" />
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title={failureTitle}
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      {#if !matterFixed}
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-matter">Matter</Label>
          <MatterPicker
            inputId="{idPrefix}-matter"
            {matters}
            capped={mattersCapped}
            reading={mattersReading}
            value={chosenMatterId}
            offerNoMatter={false}
            disabled={busy}
            onpick={(picked) => (chosenMatterId = picked)}
          />
        </div>
      {/if}

      <div class="flex flex-col gap-8">
        <Label for="{idPrefix}-title">Title</Label>
        <Input id="{idPrefix}-title" disabled={busy} bind:value={draft.title} />
      </div>

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <DatePicker label="Due date" value={dueOnValue} onValueChange={recordDueOn} disabled={busy} />
        </div>
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-due-at-time">Time</Label>
          <Input
            id="{idPrefix}-due-at-time"
            type="time"
            autocomplete="off"
            aria-invalid={timeRefusal === undefined ? undefined : "true"}
            disabled={busy}
            bind:value={draft.dueAtTime}
            oninput={readTimeEntry}
            onchange={readTimeEntry}
            onblur={(event: FocusEvent & { currentTarget: HTMLInputElement }) => {
              readTimeEntry(event);
              timeVisited = true;
            }}
          />
          <FieldRefusal refusal={timeRefusal} />
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="{idPrefix}-time-zone">Time zone</Label>
        <TimeZonePicker
          inputId="{idPrefix}-time-zone"
          label="Time zone"
          preferred={preferredTimeZones}
          disabled={busy}
          bind:value={draft.timeZone}
        />
      </div>

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label id="{idPrefix}-source-label">Source</Label>
          <Select.Root
            type="single"
            items={sourceItems}
            allowDeselect={false}
            bind:value={
              () => draft.source,
              (next) => {
                if (next === "member" || next === "court_order") draft.source = next;
              }
            }
            disabled={busy}
          >
            <Select.Trigger aria-labelledby="{idPrefix}-source-label">
              <Select.Value placeholder={placeholderOf("Source")} />
            </Select.Trigger>
            <Select.Content>
              {#each sourceItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-priority">Priority</Label>
          <Input
            id="{idPrefix}-priority"
            inputmode="numeric"
            autocomplete="off"
            disabled={busy}
            bind:value={draft.priority}
          />
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="{idPrefix}-authority">Authority</Label>
        <Textarea
          id="{idPrefix}-authority"
          rows={2}
          disabled={busy}
          bind:value={draft.authorityText}
        />
      </div>

      {#if superseding}
        <div class="flex flex-col gap-8">
          <Label for="{idPrefix}-reason">Reason</Label>
          <Textarea id="{idPrefix}-reason" rows={2} disabled={busy} bind:value={reason} />
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

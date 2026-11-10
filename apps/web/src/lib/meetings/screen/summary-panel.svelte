<script lang="ts">
  /*
   * The summary of one recording: a reading panel opened from the recording's row in the Recordings
   * panel, over it, the way the transcript is opened from the same row.
   *
   * WHAT IT SHOWS. The summary's text under one quiet line saying it is the platform's
   * characterization of the conversation and not a record of it, so nobody quotes it as the
   * transcript; then the action items as a numbered list, each with its owner (or "No owner" where
   * the transcript named nobody exactly), the day it is due where the transcript stated one, and
   * Create Task, which becomes Open Task once the task exists. The words live in `summary-panel.ts`.
   *
   * THE STATES. Loading draws the summary's own shape over sample words. A summary being written,
   * one that could not be written, one that was not written and why, and a ready one whose words the
   * read withholds are facts about the summary rather than an absence of words, so each is the design
   * system's empty state with its own title, decided by `summaryBody`; the failure carries its Error
   * ID. A ready summary with no action items says "No Results" inside its own list. A read that
   * failed (no summary, a walled matter, nothing answering) is the failure notice with Retry.
   *
   * IT READS WHEN IT OPENS, and while the summary is being written it asks again on the transcript
   * panel's slow interval, so a panel left open turns into the summary without being closed; the
   * moment it settles the screen that opened it is told, so the row beneath agrees with the panel.
   *
   * RE-RUN IS A HOST'S, AND IT ASKS FIRST. Writing the summary again replaces its text and its action
   * items, so the press opens a confirmation that says so and says that tasks already made are kept;
   * only a member holding the key to host meetings is offered it.
   *
   * CREATE TASK ASKS FIRST, because anybody in a meeting can say an action item aloud for somebody
   * else. The press opens a confirmation stating who the task will be assigned to (the item's owner,
   * or nobody where none was named) with a box to take the name off; a member who may not put a task
   * in another member's name sees the box refused and why. Only the confirmation's commit sends the
   * request, through the task subsystem's own path on the recording's matter with a fresh
   * idempotency key. A task somebody else made first is said plainly on the row, which reads again to
   * link to it; any other refusal stands in the confirmation, where pressing again is the retry.
   *
   * THE WORDS ARE PRIVILEGED. The summary's text and every item's text reach the screen and nothing
   * else: the read's address and the task's address carry identifiers only, a failure is reported
   * from the response's problem record, and nothing here writes to a log.
   */
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { untrack } from "svelte";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    meetingsGetOptions,
    meetingsRecordingSummaryOptions,
    meetingsRecordingSummaryQueryKey,
  } from "@magna-carta/api-client";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import NoResults from "@magna-carta/design-system/no-results";
  import {
    SAMPLE_SENTENCE,
    sampleCivilDate,
    samplePerson,
  } from "@magna-carta/design-system/loading-fixtures";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { queryClient } from "$lib/api/screen-data.ts";
  import {
    createMeetingActionItemTask,
    refusedAs,
    rerunMeetingSummary,
    taskAddress,
    type MeetingSummaryActionItemView,
    type MeetingSummaryReadView,
    type MeetingSummaryStateView,
  } from "../meetings-api.ts";
  import {
    ALREADY_TASKED_WORDS,
    MADE_WITHOUT_OWNER_WORDS,
    PENDING_SUMMARY_REREAD_MILLISECONDS,
    SUMMARY_CHARACTERIZATION,
    SUMMARY_RERUN_CONSEQUENCE,
    actionItemDueWords,
    actionItemOwnerWords,
    assignsToOwner,
    mayAssignToOwner,
    taskAssigneeWords,
    orderedActionItems,
    summaryBody,
    summarySettled,
    withTaskMade,
    type SummaryBody,
  } from "./summary-panel.ts";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { Failure } from "$lib/api/problem.ts";

  let {
    open = $bindable(false),
    meetingId,
    recordingId,
    subject,
    canHost = false,
    canAssign = false,
    viewerUserId = null,
    insideRoom = false,
    onChanged,
  }: {
    open?: boolean;
    /** The meeting the recording was made in. */
    meetingId: string;
    /** The recording whose summary this is. Empty while no row has been chosen. */
    recordingId: string;
    /** Which recording this is about, named once. */
    subject: RecordSubject;
    /** Whether the reader holds the key to host meetings, which is what offers Re-run. */
    canHost?: boolean;
    /** Whether the reader may put a task in another member's name. */
    canAssign?: boolean;
    /** Who is reading, so an item they own is put in their own name without the key to assign. */
    viewerUserId?: string | null;
    /**
     * Whether the panel is drawn inside a meeting room. There, Open Task opens beside the reader,
     * because moving the page would hang up their call.
     */
    insideRoom?: boolean;
    /**
     * Told when the summary this panel shows changes where the recordings list would say so: a
     * summary being written settles, or a re-run starts one. The opener reads its own list again.
     */
    onChanged?: () => void;
  } = $props();

  const summaryKey = $derived(meetingsRecordingSummaryQueryKey({ path: { meetingId, recordingId } }));

  const summaryRead = createQuery(() => ({
    ...meetingsRecordingSummaryOptions({ path: { meetingId, recordingId } }),
    enabled: open && meetingId !== "" && recordingId !== "",
    // Every opening reads afresh: a summary settles while nobody is looking.
    staleTime: 0,
    // Only while it is being written, and only while the panel is open: a settled summary changes
    // only when somebody asks for it again, and a closed panel has nobody to tell.
    refetchInterval: (query) =>
      open && query.state.data?.summary.state === "pending"
        ? PENDING_SUMMARY_REREAD_MILLISECONDS
        : false,
  }));

  /*
   * The meeting, for the matter its tasks are made on, so a made task links into that matter's
   * Tasks section. The room reads the same meeting under the same key, so there it costs nothing.
   */
  const meetingRead = createQuery(() => ({
    ...meetingsGetOptions({ path: { meetingId } }),
    enabled: open && meetingId !== "",
  }));
  const matterId = $derived(meetingRead.data?.matterId ?? null);

  const view = $derived<MeetingSummaryReadView | null>(summaryRead.data ?? null);

  /*
   * What the body shows, from the one function that decides it. With no answer yet, the read is in
   * flight or failed, and the region's own fixture and failure stand instead of this body.
   */
  const body = $derived<SummaryBody>(
    view === null ? { kind: "summary" } : summaryBody(view.summary, view.withheld),
  );

  /** The items somebody else had already made a task of when this member asked for one. */
  let alreadyTasked = $state<Readonly<Record<string, boolean>>>({});

  /*
   * Tell the opener once when a summary this panel watched being written settles. A different
   * recording starts the watch again, so one recording's settle is never reported as another's.
   */
  let watchedRecording = untrack(() => recordingId);
  let lastState: MeetingSummaryStateView | null = null;
  $effect(() => {
    const now = view?.summary.state ?? null;
    const forRecording = recordingId;
    if (forRecording !== watchedRecording) {
      watchedRecording = forRecording;
      lastState = now;
      alreadyTasked = {};
      return;
    }
    if (now === null) return;
    const before = lastState;
    lastState = now;
    if (summarySettled(before, now)) untrack(() => onChanged?.());
  });

  // ---- Create Task, per item ----------------------------------------------------------------------

  /*
   * NOTHING IS MADE ON THE ROW'S PRESS. Anybody in a meeting can say an action item aloud for
   * somebody else, and one press would then put that person's name on a task, so Create Task opens a
   * confirmation that states who the task will be assigned to and lets the reader untick it. The
   * request is sent only from there, with a fresh idempotency key.
   */
  let taskOf = $state<MeetingSummaryActionItemView | null>(null);
  /** Where that item stands in the numbered list, which is how the confirmation names it. */
  let taskNumber = $state(0);
  let taskOpen = $state(false);
  /** Whether the reader left the task in its owner's name. Ticked again for every item opened. */
  let assignTicked = $state(true);
  let taskFailure = $state<Failure | null>(null);

  /** The recording a confirmation is about, and which of its action items. */
  const taskSubject = $derived<RecordSubject>({
    ...subject,
    facts: [...(subject.facts ?? []), `Action Item ${String(taskNumber)}`],
  });
  const mayAssign = $derived(
    taskOf !== null && mayAssignToOwner(taskOf, viewerUserId, canAssign),
  );
  const assigning = $derived(
    taskOf !== null && assignsToOwner(taskOf, viewerUserId, canAssign, assignTicked),
  );

  function confirmTask(item: MeetingSummaryActionItemView, number: number): void {
    taskOf = item;
    taskNumber = number;
    assignTicked = true;
    taskFailure = null;
    taskOpen = true;
  }

  async function createTask(): Promise<ActionOutcome> {
    const item = taskOf;
    if (item === null) return "committed";
    taskFailure = null;
    alreadyTasked = without(alreadyTasked, item.id);
    const outcome = await createMeetingActionItemTask(
      meetingId,
      recordingId,
      item.id,
      assignsToOwner(item, viewerUserId, canAssign, assignTicked),
    );
    if (outcome.kind === "ok") {
      const made = outcome.value;
      queryClient.setQueryData<MeetingSummaryReadView>(summaryKey, (held) =>
        held === undefined ? held : withTaskMade(held, made),
      );
      return "committed";
    }
    if (refusedAs(outcome.failure, "meeting-summary-action-item-tasked")) {
      // Somebody else's press landed first. Their task is the item's: the row says so, and reading
      // again links to it. There is nothing left to ask here.
      alreadyTasked = { ...alreadyTasked, [item.id]: true };
      void summaryRead.refetch();
      return "committed";
    }
    taskFailure = outcome.failure;
    // Written again or withheld since this panel read it: what stands now is what the reader needs.
    if (refusedAs(outcome.failure, "meeting-summary-not-ready")) void summaryRead.refetch();
    return "refused";
  }

  function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
    return Object.fromEntries(Object.entries(record).filter(([held]) => held !== key));
  }

  // ---- Re-run, a host's, behind a confirmation -----------------------------------------------------

  let rerunOpen = $state(false);
  let rerunFailure = $state<Failure | null>(null);

  async function rerun(): Promise<ActionOutcome> {
    rerunFailure = null;
    const outcome = await rerunMeetingSummary(meetingId, recordingId);
    if (outcome.kind === "failed") {
      rerunFailure = outcome.failure;
      return "refused";
    }
    // The answer is the summary as it now stands, being written: the panel shows that at once and
    // its own interval reads on from there.
    queryClient.setQueryData<MeetingSummaryReadView>(summaryKey, outcome.value);
    alreadyTasked = {};
    onChanged?.();
    return "committed";
  }

  /** The summary's shape over words that are plainly invented, for the read in flight. */
  const FIXTURE: MeetingSummaryReadView = {
    summary: {
      id: "fixture-summary",
      transcriptId: "fixture-transcript",
      recordingId: "fixture-recording",
      state: "ready",
      refusalReason: null,
      failureErrorId: null,
      modelId: null,
      createdAt: "",
      updatedAt: "",
    },
    text: SAMPLE_SENTENCE,
    actionItems: [0, 1].map((index) => ({
      id: `fixture-item-${String(index)}`,
      ordinal: index,
      text: SAMPLE_SENTENCE,
      owner: { userId: `fixture-user-${String(index)}`, displayName: samplePerson(index).name },
      dueOn: sampleCivilDate(index),
      taskId: null,
    })),
    withheld: null,
  };
</script>

{#snippet fixture()}
  {@render summary(FIXTURE)}
{/snippet}

{#snippet summary(shown: MeetingSummaryReadView)}
  <div class="flex flex-col gap-16">
    <!-- One quiet line, so the summary is never mistaken for the transcript it was written from. -->
    <p class="text-xs text-text-muted">{SUMMARY_CHARACTERIZATION}</p>
    <p class="text-sm whitespace-pre-line">{shown.text ?? ""}</p>
    <section class="flex flex-col gap-8">
      <h3 class="text-sm font-medium">Action Items</h3>
      <ol class="flex flex-col gap-12">
        {#each orderedActionItems(shown.actionItems) as item, index (item.id)}
          {@const due = actionItemDueWords(item)}
          <li class="flex items-start gap-12">
            <span class="shrink-0 text-sm text-text-muted tabular-nums" aria-hidden="true">
              {index + 1}.
            </span>
            <div class="flex min-w-0 flex-1 flex-col gap-4">
              <p class="text-sm">{item.text}</p>
              <p class="flex flex-wrap gap-x-12 text-xs text-text-muted">
                <span>{actionItemOwnerWords(item)}</span>
                {#if due !== null && item.dueOn !== null}
                  <time datetime={item.dueOn}>{due}</time>
                {/if}
              </p>
              {#if alreadyTasked[item.id] === true}
                <p class="text-xs text-text-muted">{ALREADY_TASKED_WORDS}</p>
              {/if}
            </div>
            <div class="shrink-0">
              {#if item.taskId !== null}
                <!-- The task, where the task subsystem keeps it: the matter's Tasks section. -->
                <Button
                  variant="ghost"
                  size="sm"
                  href={taskAddress(matterId, item.taskId)}
                  {...insideRoom ? opensBeside("live-meeting") : {}}
                >
                  <ListChecks class="size-16" aria-hidden="true" />
                  Open Task
                </Button>
              {:else}
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Create Task: action item ${String(index + 1)}`}
                  onclick={() => confirmTask(item, index + 1)}
                >
                  <ListPlus class="size-16" aria-hidden="true" />
                  Create Task
                </Button>
              {/if}
            </div>
          </li>
        {:else}
          <li><NoResults /></li>
        {/each}
      </ol>
    </section>
  </div>
{/snippet}

<ActionDialog bind:open kind="reading" heading="Summary" subtitle={subject} width="wide">
  {#snippet fields()}
    <LoadingRegion
      loading={summaryRead.isPending}
      failed={summaryRead.isError}
      label="Reading this recording's summary"
      {fixture}
      onRetry={() => void summaryRead.refetch()}
    >
      {#snippet failure()}
        <FailureNotice
          failure={failureOf(summaryRead.error)}
          subject="This recording"
          fallback="This recording's summary could not be read."
          whenSilent="Nothing answered. This recording's summary could not be read."
          onRetry={() => void summaryRead.refetch()}
        />
      {/snippet}
      <div class="flex flex-col gap-16">
        {#if canHost}
          <!-- Writing it again is a host's act, offered beside what it replaces and asked first. -->
          <div class="flex justify-end">
            <Button variant="secondary" size="sm" onclick={() => (rerunOpen = true)}>
              <RefreshCw class="size-16" aria-hidden="true" />
              Re-run
            </Button>
          </div>
        {/if}
        {#if body.kind !== "summary" && body.detail}
          <EmptyState title={body.title}>{body.detail}</EmptyState>
        {:else if body.kind !== "summary"}
          <EmptyState title={body.title} />
        {:else if view !== null}
          {@render summary(view)}
        {/if}
      </div>
    </LoadingRegion>
  {/snippet}
</ActionDialog>

{#if canHost}
  <ActionDialog
    bind:open={rerunOpen}
    kind="destructive"
    heading="Write the Summary Again"
    subtitle={subject}
    commitLabel="Re-run"
    commitBusyLabel="Re-running"
    onOpen={() => (rerunFailure = null)}
    onCommit={rerun}
  >
    {#snippet notice()}
      {#if rerunFailure !== null}
        <FailureNotice
          failure={rerunFailure}
          subject="This summary"
          fallback="This summary could not be written again."
          whenSilent="Nothing answered. This summary could not be written again."
        />
      {/if}
    {/snippet}
    {#snippet fields()}
      <p class="text-sm">{SUMMARY_RERUN_CONSEQUENCE}</p>
    {/snippet}
  </ActionDialog>
{/if}

<!-- Who the task will carry is said before anything is made, and the reader may take the name off. -->
<ActionDialog
  bind:open={taskOpen}
  heading="New Task"
  subtitle={taskSubject}
  commitLabel="Create Task"
  commitBusyLabel="Creating Task"
  unsavedChanges={false}
  onCommit={createTask}
>
  {#snippet notice()}
    {#if taskFailure !== null}
      <FailureNotice
        failure={taskFailure}
        subject="This action item"
        fallback="A task could not be made of this action item."
        whenSilent="Nothing answered. A task could not be made of this action item."
      />
    {/if}
  {/snippet}
  {#snippet fields()}
    {#if taskOf !== null}
      {@const due = actionItemDueWords(taskOf)}
      <div class="flex flex-col gap-12">
        <p class="text-sm">{taskOf.text}</p>
        <p class="flex flex-wrap gap-x-12 text-sm">
          <span>{taskAssigneeWords(taskOf, assigning)}</span>
          {#if due !== null && taskOf.dueOn !== null}
            <time class="text-text-muted" datetime={taskOf.dueOn}>{due}</time>
          {/if}
        </p>
        {#if taskOf.owner !== null}
          <!-- Standing whether or not it may be ticked, so the form never moves under the hand. -->
          <div class="flex flex-col gap-4">
            <div class="flex items-center gap-8">
              <Checkbox
                id="summary-task-assign"
                disabled={!mayAssign}
                bind:checked={() => assigning, (next) => (assignTicked = next === true)}
              />
              <Label for="summary-task-assign">Assign to {taskOf.owner.displayName}</Label>
            </div>
            {#if !mayAssign}
              <p class="text-xs text-text-muted">{MADE_WITHOUT_OWNER_WORDS}</p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/snippet}
</ActionDialog>

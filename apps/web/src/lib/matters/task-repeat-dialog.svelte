<script lang="ts">
  /*
   * MAKING A TASK REPEAT, OR CHANGING HOW IT DOES, IS ITS OWN WINDOW.
   *
   * A repeat decides work that does not exist yet: every copy made from here on is made by this
   * rule. Edited in place among the task's other fields, one stray click on a unit or a weekday
   * changed the series, so the rule is asked here instead and nothing is written until the commit.
   * The task window shows the rule as a sentence and a button that opens this panel; it has no
   * repeat control of its own.
   *
   * The questions are task-repeat-field.svelte's, which are the calendar's own repeat control plus
   * the Next One choice, so a repeating task and a repeating hearing ask the same things.
   *
   * Stopping is here too, beside the rule it ends, so it is as deliberate as starting.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    formatRecurrence,
    weeklyRecurrence,
    type RecurrenceRule,
  } from "@magna-carta/civil-time/recurrence";
  import TaskRepeatField from "./task-repeat-field.svelte";
  import type { TaskRecurrenceMode } from "./tasks-api.ts";

  let {
    open = $bindable(false),
    repeating,
    rule,
    mode,
    dueOn,
    startsOn,
    occurrenceOn = null,
    unreadable = false,
    onSave,
    onStop,
  }: {
    open?: boolean;
    /** Whether the task already repeats: the panel changes a rule rather than making one. */
    repeating: boolean;
    /** The rule the task has, or null. Read when the panel opens and never written back. */
    rule: RecurrenceRule | null;
    mode: TaskRecurrenceMode;
    dueOn: string | null;
    startsOn: string | null;
    occurrenceOn?: string | null;
    /** The stored rule has parts this product cannot show. */
    unreadable?: boolean;
    /** Keeps the rule. Answers the failure, or null when it was kept. */
    onSave: (rule: RecurrenceRule, mode: TaskRecurrenceMode) => Promise<StatedFailure | null>;
    /** Ends the repeat. Answers the failure, or null when it ended. */
    onStop: () => Promise<StatedFailure | null>;
  } = $props();

  let draftRule = $state<RecurrenceRule | null>(null);
  let draftMode = $state<TaskRecurrenceMode>("completed");
  let failure = $state<StatedFailure | null>(null);
  let stopping = $state(false);

  function seed(): void {
    // A task that does not repeat yet opens on a rule to adjust, not on a switch to find first.
    draftRule = rule ?? (unreadable ? null : weeklyRecurrence());
    draftMode = mode;
    failure = null;
    stopping = false;
  }

  const changed = $derived(
    (draftRule === null ? null : formatRecurrence(draftRule)) !==
      (rule === null ? null : formatRecurrence(rule)) || draftMode !== mode,
  );

  async function commit(): Promise<ActionOutcome> {
    if (draftRule === null) return "refused";
    failure = await onSave(draftRule, draftMode);
    return failure === null ? "committed" : "refused";
  }

  async function stop(): Promise<void> {
    stopping = true;
    failure = await onStop();
    stopping = false;
    if (failure === null) open = false;
  }
</script>

<ActionDialog
  bind:open
  heading={repeating ? "Change How This Task Repeats" : "Make This Task Repeat"}
  commitLabel={repeating ? "Save Changes" : "Make It Repeat"}
  commitBusyLabel="Saving"
  commitRefusal={draftRule === null
    ? "Turn Repeats on to choose how it repeats."
    : repeating && !changed
      ? "Nothing has changed."
      : undefined}
  unsavedChanges={changed}
  onOpen={seed}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Changed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy }: { busy: boolean })}
    <div class="flex flex-col gap-16">
      <TaskRepeatField
        bind:rule={draftRule}
        bind:mode={draftMode}
        {dueOn}
        {startsOn}
        {occurrenceOn}
        unreadable={unreadable && draftRule === null}
        disabled={busy || stopping}
      />
      {#if repeating}
        <p class="text-sm text-text-muted">
          A change reaches this task and the ones made after it. Earlier ones stay as they are.
        </p>
        <div>
          <Button
            variant="ghost"
            size="sm"
            class="text-status-danger"
            disabled={busy || stopping}
            onclick={() => void stop()}
          >
            Stop Repeating
          </Button>
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

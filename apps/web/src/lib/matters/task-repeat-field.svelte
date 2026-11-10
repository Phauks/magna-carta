<script lang="ts">
  /*
   * WHETHER A TASK REPEATS, on what rule, and when the next one appears.
   *
   * The rule is asked by the calendar's own repeat control, so a repeating task and a repeating
   * hearing are the same four questions in the same order. What a task adds is the Next One choice:
   * the next copy can appear when this one is marked complete, so the work never doubles up, or on
   * its own start date whether or not this one is done. Both are real ways a firm works, so the firm
   * chooses on each task, and completion is where a new repeat starts.
   *
   * A task repeats from its DUE DATE, which is the day the series falls on. Without one the control
   * says so rather than offering a rule with nothing to count from.
   */
  import Label from "@magna-carta/design-system/label";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import type { RecurrenceRule } from "@magna-carta/civil-time/recurrence";
  import RecurrenceField from "$lib/calendar/recurrence-field.svelte";
  import { nextCopySentence } from "./task-recurrence.ts";
  import type { TaskRecurrenceMode } from "./tasks-api.ts";

  let {
    rule = $bindable(),
    mode = $bindable(),
    dueOn,
    startsOn,
    occurrenceOn = null,
    unreadable = false,
    disabled = false,
  }: {
    /** The rule being edited, or null for a task that happens once. Bindable. */
    rule: RecurrenceRule | null;
    /** When the next copy appears. Bindable. */
    mode: TaskRecurrenceMode;
    dueOn: string | null;
    startsOn: string | null;
    /** The day of the series this copy stands for, where it already repeats. */
    occurrenceOn?: string | null;
    /** Whether the stored rule has parts this product cannot show. */
    unreadable?: boolean;
    disabled?: boolean;
  } = $props();

  const MODES: { value: TaskRecurrenceMode; label: string }[] = [
    { value: "completed", label: "Appears when this one is marked complete" },
    { value: "scheduled", label: "Appears on its start date, even if this one is still open" },
  ];

  const nextLine = $derived(
    rule === null || dueOn === null
      ? ""
      : nextCopySentence(rule, mode, occurrenceOn ?? dueOn, dueOn, startsOn),
  );
</script>

<div class="flex flex-col gap-12">
  {#if dueOn === null && rule === null}
    <div class="flex flex-col gap-4">
      <span class="text-sm font-semibold">Repeats</span>
      <p class="text-xs text-text-muted">A task repeats from its due date. Give it one first.</p>
    </div>
  {:else}
    <RecurrenceField bind:rule startsOn={dueOn} idPrefix="task" {unreadable} {disabled} />
    {#if rule !== null}
      <div class="flex flex-col gap-8">
        <Label id="task-repeat-next-label">Next One</Label>
        <RadioGroup.Root
          aria-labelledby="task-repeat-next-label"
          value={mode}
          onValueChange={(picked) => (mode = picked === "scheduled" ? "scheduled" : "completed")}
          {disabled}
        >
          {#each MODES as choice (choice.value)}
            <div class="flex min-h-32 items-center gap-8">
              <RadioGroup.Item value={choice.value} id="task-repeat-next-{choice.value}" />
              <Label for="task-repeat-next-{choice.value}">{choice.label}</Label>
            </div>
          {/each}
        </RadioGroup.Root>
        <p class="text-xs text-text-muted">{nextLine}</p>
      </div>
    {/if}
  {/if}
</div>

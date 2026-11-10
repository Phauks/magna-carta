<script lang="ts">
  /*
   * A task's start or due date, edited where it is read: the date is the control, and pressing it
   * opens a calendar. Choosing a day is the change, and Clear takes the date away.
   *
   * A due date that has passed on a task still owed is drawn red and never labelled: the colour is
   * the whole statement, and the date itself is what a reader needs.
   */
  import * as Popover from "@magna-carta/design-system/popover";
  import { Calendar } from "@magna-carta/design-system/calendar";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import Button from "@magna-carta/design-system/button";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import { civilDateText, civilDateValue } from "$lib/dates";

  let {
    value,
    label,
    past = false,
    disabled = false,
    emptyText = "Add",
    onchange,
  }: {
    /** A civil date, or null when there is none. */
    value: string | null;
    /** What the date is, for the control's name: "Start", "Due". */
    label: string;
    /** Drawn red: a due date that has passed on a task still owed. */
    past?: boolean;
    disabled?: boolean;
    emptyText?: string;
    onchange: (next: string | null) => void;
  } = $props();

  let open = $state(false);

  function choose(next: string | null): void {
    open = false;
    if (next === value) return;
    onchange(next);
  }
</script>

{#if disabled}
  <span class:text-status-danger={past} class:text-text-muted={value === null}>
    {value === null ? "" : formatDate(value)}
  </span>
{:else}
  <Popover.Root bind:open>
    <Popover.Trigger
      class={`${buttonClasses({ variant: "ghost", size: "sm" })} px-4 font-normal tabular-nums${past ? " text-status-danger" : value === null ? " text-text-muted" : ""}`}
      aria-label={value === null ? `Set the ${label.toLowerCase()} date` : `${label} ${formatDate(value)}. Change it`}
    >
      {value === null ? emptyText : formatDate(value)}
    </Popover.Trigger>
    <Popover.Content class="flex w-auto flex-col gap-8">
      <Calendar
        type="single"
        density="compact"
        value={civilDateValue(value ?? "")}
        onValueChange={(next) => {
          // Pressing the chosen day again clears it in the calendar; Clear is the way to do that
          // here, so a second press on the same day changes nothing.
          const day = civilDateText(next);
          if (day !== null) choose(day);
        }}
        aria-label={`${label} date`}
      />
      {#if value !== null}
        <Button variant="ghost" size="sm" onclick={() => choose(null)}>Clear</Button>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/if}

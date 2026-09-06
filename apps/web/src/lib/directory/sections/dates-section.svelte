<script lang="ts">
  /*
   * A person's dates, in the clear: born, and died where the firm knows it. A date of death
   * marks the person deceased on the record; there is no separate box to tick here, because at
   * creation the date is the fact and the flag follows it.
   *
   * The dates are typed and picked through the one date field the product has, and handed to
   * the draft as the calendar string the record stores (YYYY-MM-DD), or empty.
   */
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { parseDate, type DateValue } from "@internationalized/date";

  let {
    dateOfBirth = $bindable(""),
    dateOfDeath = $bindable(""),
    disabled = false,
  }: {
    dateOfBirth: string;
    dateOfDeath: string;
    disabled?: boolean;
  } = $props();

  /** The stored string as a calendar date, or undefined while it is empty or half-entered. */
  function calendarDate(stored: string): DateValue | undefined {
    if (stored === "") return undefined;
    try {
      return parseDate(stored);
    } catch {
      return undefined;
    }
  }

  const outOfOrder = $derived(
    dateOfBirth !== "" && dateOfDeath !== "" && dateOfDeath < dateOfBirth,
  );
</script>

<section class="flex flex-col gap-12">
  <div class="grid gap-12 sm:grid-cols-2" style="max-width: 26rem">
    <div class="flex flex-col gap-8">
      <DatePicker
        label="Date of birth"
        value={calendarDate(dateOfBirth)}
        onValueChange={(next) => (dateOfBirth = next === undefined ? "" : next.toString())}
        {disabled}
      />
    </div>
    <div class="flex flex-col gap-8">
      <DatePicker
        label="Date of death"
        value={calendarDate(dateOfDeath)}
        onValueChange={(next) => (dateOfDeath = next === undefined ? "" : next.toString())}
        {disabled}
      />
      {#if outOfOrder}
        <p class="text-xs text-status-danger-subtle-foreground">Cannot precede the date of birth.</p>
      {/if}
    </div>
  </div>
</section>

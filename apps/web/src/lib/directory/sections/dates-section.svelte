<script lang="ts">
  /*
   * A person's dates, in the clear: born, and died where the firm knows it. A date of death
   * marks the person deceased on the record; there is no separate box to tick here, because at
   * creation the date is the fact and the flag follows it.
   */
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";

  let {
    dateOfBirth = $bindable(""),
    dateOfDeath = $bindable(""),
    disabled = false,
  }: {
    dateOfBirth: string;
    dateOfDeath: string;
    disabled?: boolean;
  } = $props();

  const outOfOrder = $derived(
    dateOfBirth !== "" && dateOfDeath !== "" && dateOfDeath < dateOfBirth,
  );
</script>

<section class="flex flex-col gap-12">
  <div class="grid gap-12 sm:grid-cols-2" style="max-width: 26rem">
    <LabelledField label="Date of birth">
      {#snippet children({ props })}
        <Input {...props} type="date" class="tabular-nums" bind:value={dateOfBirth} {disabled} placeholder={placeholderOf("Date of birth")} />
      {/snippet}
    </LabelledField>
    <LabelledField label="Date of death" error={outOfOrder ? "Cannot precede the date of birth." : undefined}>
      {#snippet children({ props })}
        <Input {...props} type="date" class="tabular-nums" bind:value={dateOfDeath} {disabled} placeholder={placeholderOf("Date of death")} />
      {/snippet}
    </LabelledField>
  </div>
</section>

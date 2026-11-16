<script lang="ts">
  /*
   * Every part of a person's name, in the order a name is written: the three names on one row, the
   * prefix and the suffixes on the row beneath, because the honorific field holds several
   * comma-separated values and grows as they are added.
   *
   * ONE COMPONENT FOR EVERY PLACE A PERSON'S NAME IS TYPED. New Person's current name, each other
   * name, and the record's Edit Name and Add Other Name all render this, so a name reads and is
   * entered the same way wherever it is. Two copies drifted into two layouts once (owner,
   * 2026-11-16: "They look different").
   */
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import HonorificField from "$lib/names/honorific-field.svelte";
  import type { PersonNameDraft } from "../person-draft.ts";

  let {
    parts = $bindable(),
    disabled = false,
  }: {
    parts: PersonNameDraft;
    disabled?: boolean;
  } = $props();
</script>

<div class="grid gap-12 sm:grid-cols-3">
  <LabelledField label="First Name">
    {#snippet children({ props })}
      <Input {...props} bind:value={parts.given} {disabled} placeholder={placeholderOf("First Name")} />
    {/snippet}
  </LabelledField>
  <LabelledField label="Middle Name">
    {#snippet children({ props })}
      <Input {...props} bind:value={parts.middle} {disabled} placeholder={placeholderOf("Middle Name")} />
    {/snippet}
  </LabelledField>
  <LabelledField label="Last Name">
    {#snippet children({ props })}
      <Input {...props} bind:value={parts.family} {disabled} placeholder={placeholderOf("Last Name")} />
    {/snippet}
  </LabelledField>
</div>
<div class="grid gap-12 sm:grid-cols-2">
  <LabelledField label="Prefix">
    {#snippet children({ props })}
      <HonorificField part="prefix" bind:value={parts.prefix} {disabled} inputProps={props} />
    {/snippet}
  </LabelledField>
  <LabelledField label="Suffix">
    {#snippet children({ props })}
      <HonorificField part="suffix" bind:value={parts.suffix} {disabled} inputProps={props} />
    {/snippet}
  </LabelledField>
</div>

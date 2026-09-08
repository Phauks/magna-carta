<script lang="ts">
  /*
   * A person's names at creation: the name they answer to now, and any they have answered to.
   *
   * The current name is the record's identity and the duplicate gate's question, so it stands
   * first and is bound live; the other names — a maiden name, an alias — are a list beneath it
   * with the product's add row, each kept findable from the day the record exists.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import HonorificField from "$lib/names/honorific-field.svelte";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { DirectoryNameRole } from "../directory-api.ts";
  import { appendableNameRoles, nameRoleLabel } from "../directory-vocabulary.ts";
  import type { OtherNameDraft, PersonNameDraft } from "../person-draft.ts";
  import SectionHeading from "./section-heading.svelte";

  let {
    name = $bindable(),
    otherNames,
    disabled = false,
    onAddOtherName,
    onRemoveOtherName,
  }: {
    name: PersonNameDraft;
    otherNames: readonly OtherNameDraft[];
    disabled?: boolean;
    onAddOtherName: (draft: Omit<OtherNameDraft, "id">) => void;
    onRemoveOtherName: (draft: OtherNameDraft) => void;
  } = $props();

  const identity = $props.id();
  const roleLabelId = `${identity}-role`;

  const roleItems = appendableNameRoles("person").map((entry) => ({
    value: entry.role,
    label: entry.label,
  }));

  let otherGiven = $state("");
  let otherFamily = $state("");
  let otherRole = $state<DirectoryNameRole>("former");

  // A name the person also answers to needs something to answer to, and that is all — the same
  // rule the current name is held to, and for the same reason: a one-name alias is a real alias.
  const otherReady = $derived(otherGiven.trim() !== "" || otherFamily.trim() !== "");

  function addOther(): void {
    if (!otherReady || disabled) return;
    onAddOtherName({
      prefix: "",
      given: otherGiven.trim(),
      middle: "",
      family: otherFamily.trim(),
      suffix: "",
      nameRole: otherRole,
    });
    otherGiven = "";
    otherFamily = "";
  }
</script>

<section class="flex flex-col gap-16">
  <!-- The three names on one row, in the order a name is written and under the words a person
       actually uses for them; the prefix and the suffixes take the row beneath, because the
       honorific field holds several comma-separated values and grows as they are added. -->
  <div class="grid gap-12 sm:grid-cols-3">
    <LabelledField label="First Name">
      {#snippet children({ props })}
        <Input {...props} bind:value={name.given} {disabled} placeholder={placeholderOf("First Name")} />
      {/snippet}
    </LabelledField>
    <LabelledField label="Middle Name">
      {#snippet children({ props })}
        <Input {...props} bind:value={name.middle} {disabled} placeholder={placeholderOf("Middle Name")} />
      {/snippet}
    </LabelledField>
    <LabelledField label="Last Name">
      {#snippet children({ props })}
        <Input {...props} bind:value={name.family} {disabled} placeholder={placeholderOf("Last Name")} />
      {/snippet}
    </LabelledField>
  </div>

  <div class="grid gap-12 sm:grid-cols-2">
    <LabelledField label="Prefix">
      {#snippet children({ props })}
        <HonorificField part="prefix" bind:value={name.prefix} {disabled} inputProps={props} />
      {/snippet}
    </LabelledField>
    <LabelledField label="Suffix">
      {#snippet children({ props })}
        <HonorificField part="suffix" bind:value={name.suffix} {disabled} inputProps={props} />
      {/snippet}
    </LabelledField>
  </div>

  <div class="flex flex-col gap-12">
    <SectionHeading label="Other Names" count={otherNames.length} />
    {#if otherNames.length > 0}
      <ul class="flex flex-col">
        {#each otherNames as other (other.id)}
          <li class="flex items-center gap-8 border-b border-border-default py-4">
            <span class="flex min-w-0 flex-auto flex-wrap items-baseline gap-x-8">
              <span>{[other.given, other.family].filter((part) => part !== "").join(" ")}</span>
              <span class="text-xs text-text-muted">{nameRoleLabel(other.nameRole)}</span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              {disabled}
              title="Remove"
              aria-label="Remove {other.given} {other.family}"
              onclick={() => onRemoveOtherName(other)}
            >
              <Trash2 class="size-16" aria-hidden="true" />
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="grid items-end gap-8" style="grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 9rem auto">
      <LabelledField label="First Name">
        {#snippet children({ props })}
          <Input {...props} bind:value={otherGiven} {disabled} placeholder={placeholderOf("First Name")} />
        {/snippet}
      </LabelledField>
      <LabelledField label="Last Name">
        {#snippet children({ props })}
          <Input {...props} bind:value={otherFamily} {disabled} placeholder={placeholderOf("Last Name")} />
        {/snippet}
      </LabelledField>
      <div class="flex flex-col gap-8">
        <Label id={roleLabelId}>Kind</Label>
        <Select.Root
          type="single"
          items={roleItems}
          bind:value={() => otherRole, (chosen) => (otherRole = chosen as DirectoryNameRole)}
          allowDeselect={false}
          {disabled}
        >
          <Select.Trigger aria-labelledby={roleLabelId}>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each roleItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <Button
        variant="secondary"
        size="icon"
        disabled={disabled || !otherReady}
        title={otherReady ? "Add" : "A name to add."}
        aria-label="Add this name"
        onclick={addOther}
      >
        <Plus class="size-16" aria-hidden="true" />
      </Button>
    </div>
  </div>
</section>

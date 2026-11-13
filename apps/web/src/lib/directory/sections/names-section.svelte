<script lang="ts">
  /*
   * A person's names at creation: the name they answer to now, and any they have answered to.
   *
   * The current name is the record's identity and the duplicate gate's question, so it stands
   * first and is bound live. An OTHER NAME — a maiden name, an alias — is the same set of fields
   * again, not a cut-down row (owner ruling 2026-11-13: "other name should be just a button, but if
   * invoked, duplicates all functionality of the general name area"). Add Other Name opens one
   * block with every part of a name, prefixes and suffixes included, and its kind beside it. A
   * block left empty is not a name and is not sent (person-draft.ts, `filledOtherNames`).
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
  import { appendableNameRoles } from "../directory-vocabulary.ts";
  import { blankOtherName, type OtherNameDraft, type PersonNameDraft } from "../person-draft.ts";
  import SectionHeading from "./section-heading.svelte";

  let {
    name = $bindable(),
    otherNames = $bindable(),
    disabled = false,
  }: {
    name: PersonNameDraft;
    otherNames: OtherNameDraft[];
    disabled?: boolean;
  } = $props();

  const identity = $props.id();

  const roleItems = appendableNameRoles("person").map((entry) => ({
    value: entry.role,
    label: entry.label,
  }));

  function addOther(): void {
    if (disabled) return;
    otherNames = [...otherNames, blankOtherName()];
  }

  function removeOther(other: OtherNameDraft): void {
    otherNames = otherNames.filter((entry) => entry.id !== other.id);
  }
</script>

<!-- Every part of a name, in the order a name is written: the three names on one row, the prefix
     and the suffixes on the row beneath, because the honorific field holds several comma-separated
     values and grows as they are added. The current name and every other name use this one. -->
{#snippet nameFields(parts: PersonNameDraft)}
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
{/snippet}

<section class="flex flex-col gap-16">
  {@render nameFields(name)}

  {#each otherNames as other (other.id)}
    {@const roleLabelId = `${identity}-role-${other.id}`}
    <div class="flex flex-col gap-12 border-t border-border-default pt-16">
      <div class="flex items-end gap-8">
        <div class="flex min-w-0 flex-auto flex-col gap-4">
          <SectionHeading label="Other Name" />
        </div>
        <div class="flex flex-col gap-8" style="width: 12rem">
          <Label id={roleLabelId}>Kind</Label>
          <Select.Root
            type="single"
            items={roleItems}
            bind:value={
              () => other.nameRole, (chosen) => (other.nameRole = chosen as DirectoryNameRole)
            }
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
          variant="ghost"
          size="icon"
          {disabled}
          title="Remove this name"
          aria-label="Remove this other name"
          onclick={() => removeOther(other)}
        >
          <Trash2 class="size-16" aria-hidden="true" />
        </Button>
      </div>
      {@render nameFields(other)}
    </div>
  {/each}

  <div>
    <Button variant="secondary" size="sm" {disabled} onclick={addOther}>
      <Plus class="size-16" aria-hidden="true" />
      Add Other Name
    </Button>
  </div>
</section>

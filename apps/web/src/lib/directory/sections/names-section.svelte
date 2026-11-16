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
  import Label from "@magna-carta/design-system/label";
  import * as Select from "@magna-carta/design-system/select";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { DirectoryNameRole } from "../directory-api.ts";
  import PersonNameFields from "./person-name-fields.svelte";
  import { appendableNameRoles } from "../directory-vocabulary.ts";
  import { blankOtherName, type OtherNameDraft, type PersonNameDraft } from "../person-draft.ts";

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

<section class="flex flex-col gap-16">
  <PersonNameFields bind:parts={name} {disabled} />

  {#each otherNames as other, index (other.id)}
    {@const roleLabelId = `${identity}-role-${other.id}`}
    <div class="flex flex-col gap-12 border-t border-border-default pt-16">
      <!-- The kind's own label names the block, so the block needs no heading of its own. -->
      <div class="flex items-end justify-between gap-8">
        <div class="flex flex-col gap-8" style="width: 12rem">
          <Label id={roleLabelId}>Other Name</Label>
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
      <PersonNameFields
        bind:parts={
          () => other, (next) => (otherNames[index] = { ...other, ...next })
        }
        {disabled}
      />
    </div>
  {/each}

  <div>
    <Button variant="secondary" size="sm" {disabled} onclick={addOther}>
      <Plus class="size-16" aria-hidden="true" />
      Add Other Name
    </Button>
  </div>
</section>

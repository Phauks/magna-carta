<script lang="ts">
  /*
   * The one control that classifies an event: the catalog as a select, labelled Type.
   *
   * The two record forms and the entry window's two event panes all ask this question and were
   * each drawing the select by hand; four copies of one control drift in their ids, their labels
   * and their empty behaviour. The items are the caller's (the active types, plus the record's own
   * where it is retired); this file renders them and decides nothing.
   */
  import Label from "@magna-carta/design-system/label";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";

  let {
    id,
    items,
    value,
    disabled = false,
    onchange,
  }: {
    /** Makes the ids this control mints unique on a page that may hold more than one form. */
    id: string;
    items: readonly { readonly value: string; readonly label: string }[];
    /** The chosen type's identifier, or null for an event classified under nothing. */
    value: string | null;
    disabled?: boolean;
    onchange: (value: string | null) => void;
  } = $props();
</script>

<div class="flex flex-col gap-8">
  <Label id="{id}-label">Type</Label>
  <Select.Root
    type="single"
    items={[...items]}
    value={value ?? ""}
    onValueChange={(chosen) => onchange(chosen === "" ? null : chosen)}
    disabled={disabled || items.length === 0}
  >
    <Select.Trigger aria-labelledby="{id}-label">
      <Select.Value placeholder={placeholderOf("Type")} />
    </Select.Trigger>
    <Select.Content>
      {#each items as item (item.value)}
        <Select.Item value={item.value} label={item.label} />
      {/each}
    </Select.Content>
  </Select.Root>
</div>

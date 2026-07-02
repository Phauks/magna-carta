<script lang="ts">
  /*
   * Combobox.Input — the editable field that filters the list (role="combobox"). Wrapped with a
   * trailing Trigger button (a ChevronsUpDown, Lucide deep-imported) that toggles the listbox, both
   * inside one bordered control that shows the single focus shape on :focus-within. The input is
   * borderless and fills the row. bits sets no aria-controls on the combobox input, so we point it at
   * the shared Content listbox id (from context).
   */
  import { Combobox as ComboboxPrimitive } from "bits-ui";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import { getContext } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { COMBOBOX_LISTBOX_ID } from "./context.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<ComboboxPrimitive.InputProps> = $props();

  const listboxId = getContext<string>(COMBOBOX_LISTBOX_ID);
</script>

<div class={mergeClasses("mc-combobox-input-wrapper w-full", className)}>
  <ComboboxPrimitive.Input
    bind:ref
    aria-controls={listboxId}
    class="mc-combobox-input grow min-w-0"
    {...restProps}
  />
  <ComboboxPrimitive.Trigger class="mc-combobox-trigger" aria-label="Toggle options">
    <ChevronsUpDown class="mc-combobox-trigger-icon" aria-hidden="true" />
  </ComboboxPrimitive.Trigger>
</div>

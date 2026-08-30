<script lang="ts">
  /*
   * Combobox.Input — the editable field that filters the list (role="combobox"). Wrapped with a
   * trailing Trigger button (a ChevronsUpDown, Lucide deep-imported) that toggles the listbox, both
   * inside one bordered control that shows the single focus shape on :focus-within. The input is
   * borderless and fills the row. bits sets no aria-controls on the combobox input, so we point it at
   * the shared Content listbox id (from context).
   *
   * The ghost text is the FIELD'S NAME and nothing else — not a description of the field, not an
   * example, and above all not an instruction about how to use the control. Ghost text vanishes the
   * instant somebody types, which is precisely when an instruction would be needed, so a placeholder
   * carrying information loses it at the worst possible moment; anything a person must be told belongs
   * in a hint under the field, where it stays. So the field name is what this component takes, and the
   * placeholder is derived from it rather than authored a second time — the two cannot drift apart if
   * there is only one of them.
   */
  import { Combobox as ComboboxPrimitive } from "bits-ui";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import { getContext } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { placeholderOf } from "../../formatters/placeholder.ts";
  import { COMBOBOX_LISTBOX_ID } from "./context.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    fieldName,
    placeholder,
    ...restProps
  }: WithoutChild<ComboboxPrimitive.InputProps> & {
    /**
     * The field's own name, written as it is beside the control ("Payee", "Document Type"). It is
     * also the field's ghost text, which is why it is one prop and not two.
     */
    fieldName?: string;
  } = $props();

  const listboxId = getContext<string>(COMBOBOX_LISTBOX_ID);

  // A name given either way lands in the same place; a trailing colon or required-field asterisk from
  // the written label comes off. Nothing at all stays nothing, rather than becoming an empty string a
  // reader would announce.
  const ghostText = $derived.by(() => {
    const written = fieldName ?? placeholder;
    if (written === undefined) return undefined;
    const name = placeholderOf(String(written));
    return name === "" ? undefined : name;
  });
</script>

<div class={mergeClasses("mc-combobox-input-wrapper w-full", className)}>
  <ComboboxPrimitive.Input
    bind:ref
    aria-controls={listboxId}
    placeholder={ghostText}
    class="mc-combobox-input grow min-w-0"
    {...restProps}
  />
  <ComboboxPrimitive.Trigger class="mc-combobox-trigger" aria-label="Toggle options">
    <ChevronsUpDown class="mc-combobox-trigger-icon" aria-hidden="true" />
  </ComboboxPrimitive.Trigger>
</div>

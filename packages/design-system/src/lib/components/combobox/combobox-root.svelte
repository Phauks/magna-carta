<script lang="ts">
  /*
   * Combobox.Root — owns the selected value and the open state; pairs the Input with its Content.
   * Renders no visible DOM of its own. Thin wrapper over Bits UI Combobox.Root. Filtering is
   * CONSUMER-controlled: the caller captures the query from the Input's `oninput` and renders only the
   * matching Items (a `$derived` filter), which is what lets the list virtualize at any scale. (bits'
   * `inputValue` is non-bindable and has no change event, so `oninput` is the observation point.)
   *
   * `allowDeselect` defaults to true so a single combobox can clear its selection. Root also mints the
   * listbox id the Input and Content share for aria-controls.
   */
  import { Combobox as ComboboxPrimitive } from "bits-ui";
  import { setContext } from "svelte";
  import { COMBOBOX_LISTBOX_ID } from "./context.ts";

  const listboxId = $props.id();

  let { allowDeselect = true, ...restProps }: ComboboxPrimitive.RootProps = $props();

  setContext(COMBOBOX_LISTBOX_ID, listboxId);
</script>

<ComboboxPrimitive.Root {allowDeselect} {...restProps} />

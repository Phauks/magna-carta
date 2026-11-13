<script lang="ts">
  /*
   * Combobox.Root — owns the selected value and the open state; pairs the Input with its Content.
   * Renders no visible DOM of its own. Thin wrapper over Bits UI Combobox.Root. Filtering is
   * CONSUMER-controlled: the caller captures the query from the Input's `oninput` and renders only the
   * matching Items (a `$derived` filter), which is what lets the list virtualize at any scale. (bits'
   * `inputValue` is non-bindable and has no change event, so `oninput` is the observation point.)
   *
   * `allowDeselect` defaults to true so a single combobox can clear its selection. Root also mints the
   * listbox id the Input and Content share for aria-controls, and the opener Input uses to open the
   * list when the text box itself is clicked (see context.ts).
   */
  import { Combobox as ComboboxPrimitive } from "bits-ui";
  import { setContext } from "svelte";
  import {
    COMBOBOX_FIELD_ANCHOR,
    COMBOBOX_LISTBOX_ID,
    COMBOBOX_OPENER,
    type ComboboxFieldAnchor,
    type ComboboxOpener,
  } from "./context.ts";

  const listboxId = $props.id();

  let { allowDeselect = true, open = $bindable(false), onOpenChange, ...restProps }: ComboboxPrimitive.RootProps =
    $props();

  setContext(COMBOBOX_LISTBOX_ID, listboxId);

  // The field box Input renders and Content anchors to (see context.ts). One reactive slot, so the
  // Content re-anchors if the field is ever re-rendered.
  const fieldAnchor = $state<ComboboxFieldAnchor>({ element: null });
  setContext(COMBOBOX_FIELD_ANCHOR, fieldAnchor);

  // Setting `open` from here does not pass through bits' own setter, so the caller's onOpenChange is
  // told directly — a caller that holds `open` itself (rather than binding it) hears the change the
  // same way it hears a chevron press.
  const opener: ComboboxOpener = {
    get isOpen() {
      return open;
    },
    open() {
      if (open || restProps.disabled === true) return;
      open = true;
      onOpenChange?.(true);
    },
  };
  setContext(COMBOBOX_OPENER, opener);
</script>

<ComboboxPrimitive.Root {allowDeselect} bind:open {onOpenChange} {...restProps} />

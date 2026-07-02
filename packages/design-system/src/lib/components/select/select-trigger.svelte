<script lang="ts">
  /*
   * Select.Trigger — the styled control that opens the listbox. Unlike a DropdownMenu/Popover trigger
   * (a caller-styled button), a Select trigger IS a form control: it carries the mc-select-trigger
   * recipe (an input-like box that shares the Input focus shape) and a trailing ChevronDown (Lucide,
   * deep-imported). Bits sets `data-placeholder` when nothing is selected (the recipe mutes the text)
   * and `data-state="open"|"closed"`; behaviour, a11y (aria-haspopup, aria-expanded, typeahead,
   * keyboard open) come from Bits. The caller renders the Value as children. Like Input/Textarea, the
   * control is `w-full` (it fills its container — size it with a wrapper); the recipe owns only the look.
   */
  import { Select as SelectPrimitive } from "bits-ui";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { Snippet } from "svelte";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithoutChild<SelectPrimitive.TriggerProps> & { children?: Snippet } = $props();
</script>

<SelectPrimitive.Trigger
  bind:ref
  class={mergeClasses("mc-select-trigger w-full", className)}
  {...restProps}
>
  {@render children?.()}
  <ChevronDown class="mc-select-trigger-icon" aria-hidden="true" />
</SelectPrimitive.Trigger>

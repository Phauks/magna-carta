<script lang="ts">
  /* Select.ScrollDownButton — the counterpart to ScrollUpButton, mounted at the bottom of the
     Viewport only when there is content scrolled below. Thin wrapper over Bits UI
     Select.ScrollDownButton rendering a centred ChevronDown (Lucide, deep-imported); the look is the
     mc-select-scroll-button recipe. */
  import { Select as SelectPrimitive } from "bits-ui";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<SelectPrimitive.ScrollDownButtonProps> = $props();
</script>

<SelectPrimitive.ScrollDownButton
  bind:ref
  class={mergeClasses("mc-select-scroll-button", className)}
  {...restProps}
>
  <ChevronDown class="mc-select-scroll-button-icon" aria-hidden="true" />
</SelectPrimitive.ScrollDownButton>

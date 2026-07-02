<script lang="ts">
  /* Select.ScrollUpButton — the auto-scroll affordance Bits mounts at the top of the Viewport only
     when there is content scrolled above; it auto-scrolls on hover/keyboard. Thin wrapper over Bits
     UI Select.ScrollUpButton rendering a centred ChevronUp (Lucide, deep-imported); the look is the
     mc-select-scroll-button recipe. */
  import { Select as SelectPrimitive } from "bits-ui";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<SelectPrimitive.ScrollUpButtonProps> = $props();
</script>

<SelectPrimitive.ScrollUpButton
  bind:ref
  class={mergeClasses("mc-select-scroll-button", className)}
  {...restProps}
>
  <ChevronUp class="mc-select-scroll-button-icon" aria-hidden="true" />
</SelectPrimitive.ScrollUpButton>

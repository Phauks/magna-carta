<script lang="ts">
  /* Select.GroupHeading — the label for a Group (Bits links it to the Group via aria-labelledby). Thin
     wrapper over Bits UI Select.GroupHeading; the look is the mc-select-group-heading recipe (a muted,
     small heading, matching the DropdownMenu group heading). */
  import { Select as SelectPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<SelectPrimitive.GroupHeadingProps> = $props();
</script>

<SelectPrimitive.GroupHeading
  bind:ref
  class={mergeClasses("mc-select-group-heading", className)}
  {...restProps}
/>

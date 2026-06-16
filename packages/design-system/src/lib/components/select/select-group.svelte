<script lang="ts">
  /* Select.Group — groups related items under a GroupHeading (role="group", aria-labelledby wired by
     Bits). Thin pass-through over Bits UI Select.Group; no recipe of its own — spacing comes from the
     items and heading it contains. */
  import { Select as SelectPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<SelectPrimitive.GroupProps> = $props();
</script>

<SelectPrimitive.Group bind:ref class={mergeClasses(className)} {...restProps} />

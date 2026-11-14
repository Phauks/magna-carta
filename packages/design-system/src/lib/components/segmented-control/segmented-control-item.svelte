<script lang="ts">
  /*
   * SegmentedControl.Item — one choice in the track. Its words are its children and its name; a
   * choice that is not built yet stays visible and disabled, with the reason in `title`, so a
   * reader learns the choice exists.
   */
  import type { Snippet } from "svelte";
  import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> & {
    /** The choice's words. */
    children: Snippet;
  } = $props();
</script>

<RadioGroupPrimitive.Item
  bind:ref
  class={mergeClasses("mc-segmented-control-item", className)}
  {...restProps}
>
  {@render children()}
</RadioGroupPrimitive.Item>

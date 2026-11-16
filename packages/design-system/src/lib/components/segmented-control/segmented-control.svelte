<script lang="ts">
  /*
   * SegmentedControl.Root — two to four choices shown side by side in one track, the chosen one
   * raised. A closed choice that small is answered faster by looking than by opening a list, so it
   * is never a Select or a Combobox (owner-approved data-entry mockup, 2026-11-13). Five or more
   * choices belong in a Select.
   *
   * It IS a radio group: Bits RadioGroup supplies role="radiogroup", one tab stop, arrow keys that
   * move and choose, and `value` stays bindable. Only the look differs from RadioGroup.
   */
  import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    value = $bindable(""),
    class: className,
    ...restProps
  }: WithoutChild<RadioGroupPrimitive.RootProps> = $props();
</script>

<RadioGroupPrimitive.Root
  bind:ref
  bind:value
  orientation="horizontal"
  class={mergeClasses("mc-segmented-control", className)}
  {...restProps}
/>

<script lang="ts">
  /* RadioGroup.Item — one radio option (role="radio"); the wrapper renders the inner dot indicator,
     shown by `data-state="checked"`. Thin wrapper over Bits UI RadioGroup.Item. */
  import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> = $props();
</script>

<RadioGroupPrimitive.Item bind:ref class={mergeClasses("mc-radio-item", className)} {...restProps}>
  <span class="mc-radio-indicator"></span>
</RadioGroupPrimitive.Item>

<script lang="ts">
  /*
   * Switch (Tier 2) — a styled on/off toggle over Bits UI Switch. Self-contained: the wrapper
   * renders the track (Switch.Root) with the sliding Thumb inside, so callers use a single
   * <Switch>. Behaviour + a11y (role="switch", keyboard) come from Bits; the look is the mc-switch
   * recipe keyed off `data-state`. `checked` is bindable.
   */
  import { Switch as SwitchPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<SwitchPrimitive.RootProps> = $props();
</script>

<SwitchPrimitive.Root
  bind:ref
  bind:checked
  class={mergeClasses("mc-switch", className)}
  {...restProps}
>
  <SwitchPrimitive.Thumb class="mc-switch-thumb" />
</SwitchPrimitive.Root>

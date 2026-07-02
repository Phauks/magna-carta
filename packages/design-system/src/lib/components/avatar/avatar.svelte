<script lang="ts">
  /*
   * Avatar.Root (Tier 2) — a circular avatar container over Bits UI Avatar.Root. Compose with
   * Avatar.Image (shown when it loads) and Avatar.Fallback (shown while loading or on error). Bits
   * manages the load state; the look is the mc-avatar recipe.
   */
  import { Avatar as AvatarPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AvatarPrimitive.RootProps> = $props();
</script>

<AvatarPrimitive.Root bind:ref class={mergeClasses("mc-avatar", className)} {...restProps} />

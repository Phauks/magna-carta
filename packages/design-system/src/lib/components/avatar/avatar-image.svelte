<script lang="ts">
  /* Avatar.Image — the avatar photo (object-fit: cover, fills the root). Thin wrapper over Bits UI
     Avatar.Image, which only shows it once the src loads. */
  import { Avatar as AvatarPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<AvatarPrimitive.ImageProps> = $props();
</script>

<AvatarPrimitive.Image
  bind:ref
  class={mergeClasses("mc-avatar-image size-full", className)}
  {...restProps}
/>
